# StaffPay — attendance sheet to salary

Upload the biometric attendance report — the **Daily Details Report** Excel workbook (one worksheet per employee) or the **Daily Attendance Report (Detailed Report)** PDF (one page per employee) — and the app extracts every day's punches and status, then calculates each employee's monthly salary. Results can be downloaded as an Excel workbook (Salary Summary, Daily Attendance, Assumptions).

## Install on Windows
1. Download **[StaffPay-Setup.exe](../../releases/latest/download/StaffPay-Setup.exe)** from the latest release (no admin rights needed).
2. Run it and keep **Create a desktop shortcut** ticked.
3. Double-click **StaffPay** on the desktop. A small window opens (keep it open while you work) and the app opens in your browser at http://127.0.0.1:8000.

No installer? Download **StaffPay-Portable.zip**, unzip it anywhere, and run **Create Desktop Shortcut.cmd** once.

**Updating:** when a new version is released the app shows an *Update available* card in the sidebar. Click it, run the new installer over the old one. Your data stays in `%LOCALAPPDATA%\StaffPay\data` and is never touched by installing, updating or uninstalling — back up that folder to keep a copy.

## Develop
```bash
npm install
npm start        # http://127.0.0.1:8000 (data in ./data)
npm run dev      # auto-restart on changes
npm test
npm run build:exe   # dist/StaffPay.exe (Windows, Node bundled)
```
Requires Node.js 20+.

## Git workflow
- `main` is always releasable. Work on a branch (`feature/…`, `fix/…`), open a pull request; the **CI** workflow runs the tests on every push and PR.
- **Release:** on `main`, run `npm version patch` (or `minor` / `major`) — this bumps `package.json` and creates a `vX.Y.Z` tag — then `git push --follow-tags`. The **Release** workflow builds `StaffPay.exe`, the installer and the portable zip on Windows and publishes them as the latest GitHub release. The download links above always point at the newest release.

## Tabs
- **Salary** — upload the sheet (Excel or PDF), see each employee's salary and day-by-day attendance, download Excel. Fines, allowances and the default salary are under **Salary rules**.
- **Staff** — enter each employee's monthly salary and shift; select several staff to move them to a shift together.
- **Shifts** — create shift buckets with login time, logout time and grace minutes (press Save on the card).

## How salary is calculated
- **Base** = monthly salary (staff with no salary entered use the default monthly salary)
- **Daily rate** = monthly salary ÷ 30.5 (divisor editable in Salary rules)
- **Attendance deduction** = (absences beyond the paid allowance + half days × 0.5) × daily rate
- **Fines** = late arrivals × late fine + missing Clock In/Out × missing punch fine
- **Net** = base − attendance deduction − fines

Late means Clock In after the employee's shift login time plus grace. Early leave is not marked. Saturday and Sunday are working days: the device's "Week Off" is ignored, a weekend day with punches is a normal workday and one without punches is an absence (switchable in Salary rules). Sunday ends at 14:30, so leaving then is a full day. A day with a clock-out but no clock-in is Present with a missing punch fine (never late); a single evening punch that the device put under Clock In is read as the clock-out. Holidays are paid; absent days are not fined for missing punches. Missing punches are highlighted in orange.

Rules, shifts and staff salaries are editable in the app and saved to `data/settings.json`. The last uploaded sheet is kept in `data/current_upload.json`, so the report survives a restart.

## Important
Confirm the salary rules before paying real salaries. The app has no login: it only listens on 127.0.0.1, so don't expose it to the internet.
