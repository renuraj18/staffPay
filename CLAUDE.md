# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm start                              # http://127.0.0.1:8000 (override with PORT)
npm run dev                            # node --watch auto-restart
npm test                               # node:test over tests/*.test.js
node --test --test-name-pattern="late" tests/payroll.test.js   # single test
```

No lint or bundler; the frontend is plain HTML/CSS/JS served from `public/`. `npm run build:exe` packages the server + `public/` with Node 22 into `dist/StaffPay.exe` using `@yao-pkg/pkg` (works from macOS too; test a packaged build locally with `npx pkg . --targets node22-macos-arm64` and run it with `--no-open`).

## Windows distribution & releases
- Packaged runs (`process.pkg` set) store data in `%LOCALAPPDATA%\StaffPay\data` (override: `STAFFPAY_DATA_DIR`), open the browser on start (`--no-open` disables), and if the port is already serving StaffPay they just open the browser and exit.
- `installer/StaffPay.iss` (Inno Setup, per-user, no admin) installs to `%LOCALAPPDATA%\Programs\StaffPay` with Start menu + desktop shortcuts. Asset names are fixed (`StaffPay-Setup.exe`, `StaffPay-Portable.zip`) so `releases/latest/download/…` links always work — don't add versions to them.
- `.github/workflows/release.yml` runs on `v*` tags (tag must equal `package.json` version): tests, build exe, installer, portable zip, GitHub release. `ci.yml` runs tests on pushes/PRs.
- `lib/update.js` + `GET /api/version` compare `package.json` version with the latest GitHub release of the repo in `package.json` `repository`; the sidebar shows an update card. Offline failures are silent.
- `data/` is gitignored (real staff data) — never commit it.

## Architecture

Single flow: upload biometric workbook → parse → calculate salary → view/adjust → export Excel.

- `lib/payroll.js` — pure functions, no I/O. `parseWorkbook(buffer)` reads the "Daily Details Report" format: one sheet per employee, `Employee Name : X , Employee ID : N` header line, `Company :` and `From … To …` lines, then a table with `Date / Check In / Check Out / Clock In / Clock Out / Total WT / Status`. **Check In/Out are the shift schedule; Clock In/Out are the actual punches** — only Clock columns are used. Text dates are DD-MM-YYYY. `classifyDay(day, rules, shift)` maps the bracketed status code (`P`, `LT`, `EL`, `HD`, `A`, `WO`, `WOP`, `H`) via `STATUS_KIND`; late and missing punch are computed from punch times against the employee's **shift**, not taken from the device status. **Early leave is not marked at all** (user request; the device's `EL` is treated as a normal workday). Unknown codes fall back to punches and produce a warning. `calculatePayroll(parsed, settings)` produces per-employee totals and the full day list. `normalizeSettings` fills defaults and migrates older formats; it is gated on `settings.version` (`SETTINGS_VERSION` = 2) so daily→monthly salary conversion (× divisor) runs only once — bump the version for any future migration.
- `lib/export.js` — builds the 3-sheet output workbook (Salary Summary, Daily Attendance, Assumptions).
- `server.js` — Express, binds to 127.0.0.1 only (no auth). Stores the parsed upload in `data/current_upload.json` and settings in `data/settings.json` as `{version, rules, shifts: [{id, name, login_time, logout_time, grace_minutes}], staff: {empId: {name, shift_id, salary}}}` (salary is monthly). The report is **recalculated on every request** from those two, so settings changes apply retroactively to the current upload. `loadSettings()` always merges employees from the current upload into `staff`. `PUT /api/settings` takes a patch: `rules` (partial), `shifts` (full replacement; staff in removed shifts move to the first), `staff` (per-id partial, `null` removes). Endpoints: `POST /api/upload`, `GET /api/state`, `PUT /api/settings`, `GET /api/export.xlsx`.
- `public/app.js` — sidebar with three pages (Salary, Staff, Shifts; page kept in the URL hash); salary rules live in a slide-out drawer. Every edit `PUT`s a settings patch and re-renders from the returned `{settings, report}`; `renderAll` restores focus via `data-key` attributes. **Shift cards are edited as local drafts and saved only with their Save button/Enter — never re-render a shift card's inputs while typing** (Chrome time inputs lose their hour/minute segment position and produce wrong times).

## Salary rules

Attendance classification was validated against the user's `Sample_Attendance_Salary_Output_Sep_2026.xlsx`. The salary basis was later changed at the user's request (so totals no longer match that sample):
- Salary is entered **monthly** only. Base = the monthly salary (or `rules.monthly_salary` when blank) regardless of month length. Daily rate = monthly ÷ `rules.salary_divisor` (30.5); deductions at that rate are rounded to the rupee.
- First `allowed_absences` (2) full absences are paid; excess deducted at daily rate. Half day deducts `half_day_deduction` (0.5) day.
- **Saturday and Sunday are working days** (`rules.weekends_working` = 1): the device marks every weekend day `WO`/`WOP`, so those are re-classified by punches — punches → workday (late/missing apply), no punches → absent. With the flag at 0 they are paid offs with no fines.
- **Sunday is a short day** ending `rules.sunday_logout_time` (14:30): a device Half Day on Sunday with Clock Out at/after that time (− grace) counts as a full day.
- **Single punches** (`readPunches`): the device fills Clock In first, so a lone evening punch arrives as Clock In. A lone Clock In at/after the shift midpoint (login→logout; Sunday login→`sunday_logout_time`) is moved to Clock Out (`moved: 1`). A day with a clock-out but no clock-in is **Present** with a missing-punch fine and never late — even when the device marked it Absent. Late is judged only from a real Clock In.
- Late / missing-punch fines never apply on Absent (no punches) or holiday days.
- UI colours: missing punch = orange (`c-missing`, takes priority over late), late = yellow, absent = red.

## Notes
- `_old_version/` holds the previous multi-page app (groups, approvals, retention, PDF) kept for reference; it is not used.
- Money is INR (`en-IN` formatting).
