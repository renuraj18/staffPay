// Parsing of biometric "Daily Details Report" workbooks and salary calculation.
// Pure functions only: no file or network access, so tests can import this directly.
const XLSX = require('xlsx');

const DEFAULT_RULES = {
  monthly_salary: 15250,      // ₹ per month for staff with no salary mapped
  salary_divisor: 30.5,       // daily rate = monthly salary ÷ this (used for deductions)
  late_mode: 'fine',          // 'fine': late_fine per late day; 'hourly': deduct late time (rounded up to late_hour_block) at the hourly rate
  late_fine: 50,              // ₹ per late arrival (late_mode 'fine')
  late_hour_block: 60,        // late_mode 'hourly': late minutes rounded up to this block (60: 9:15 for 9:00 = 1 hour)
  early_leave: 1,             // 1: clock out before logout − grace is early leave, charged like late arrival (late_mode / late_fine / late_hour_block)
  missing_punch_fine: 50,     // ₹ per missing Clock In or Clock Out on a workday (when missing_punch_as_leave is 0)
  weekends_working: 1,        // 1: every day is a working day (device "Week Off" and holidays judged by punches); 0: paid offs
  sunday_logout_time: '15:00', // Sunday is a short day: leaving from this time is a full day
  allowed_absences: 0,        // full absences per month that are not deducted
  half_day_deduction: 0.5,    // fraction of a day deducted for Half Day(HD)
  missing_punch_as_leave: 1,  // 1: a day with only a clock in or only a clock out is leave (deducted); 0: present + missing punch fine
  overtime_pay: 1,            // 1: pay time after the shift's logout (Sunday: after sunday_logout_time) at the hourly rate
  overtime_min_minutes: 60,   // overtime starts only once clock out is this long after logout…
  overtime_block_minutes: 30, // …and is then counted in whole blocks of this many minutes (rounded down)
  overtime_mode: 'hourly',    // 'hourly': overtime hours × the employee's hourly rate; 'fixed': × overtime_fixed_rate
  overtime_fixed_rate: 50,    // ₹ per overtime hour (overtime_mode 'fixed'), the same for everyone
};

// 2: salaries are monthly. 3: every absence deducted, Sunday ends 15:00, missing punch = leave, overtime pay.
// 4: overtime from logout time — minimum 60 min, then every 30 min.
const SETTINGS_VERSION = 5;
const V4_OVERTIME = { overtime_min_minutes: 60, overtime_block_minutes: 30 };

// Shift bucket: late = Clock In after login + grace; early leave = Clock Out before logout − grace (rules.early_leave).
const DEFAULT_SHIFT = { id: 'general', name: 'General', login_time: '09:30', logout_time: '19:30', grace_minutes: 0 };

/**
 * Fill defaults and migrate older settings files to {rules, shifts, staff}:
 * rules.login_time/late_grace_minutes → a General shift; daily salaries
 * (rules.daily_salary, employee_rates, staff without salary_type 'monthly') → monthly = daily × divisor.
 */
function normalizeSettings(raw = {}) {
  const old = raw.rules || {};
  const rules = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES)) if (old[k] !== undefined) rules[k] = old[k];
  // Version 3 salary rules replace the old paid-absence allowance and 14:30 Sunday finish once.
  if (raw.version < 3 || raw.version === undefined) {
    rules.allowed_absences = DEFAULT_RULES.allowed_absences;
    rules.sunday_logout_time = DEFAULT_RULES.sunday_logout_time;
  }
  const beforeV4 = !(raw.version >= 4);
  if (beforeV4) Object.assign(rules, V4_OVERTIME);
  const divisor = Number(rules.salary_divisor);
  const toMonthly = daily => Math.round(Number(daily) * divisor * 100) / 100;
  if (old.monthly_salary === undefined && old.daily_salary !== undefined) rules.monthly_salary = toMonthly(old.daily_salary);

  let shifts = Array.isArray(raw.shifts) && raw.shifts.length ? raw.shifts : null;
  if (!shifts) {
    shifts = [{
      ...DEFAULT_SHIFT,
      login_time: old.login_time || DEFAULT_SHIFT.login_time,
      grace_minutes: Number(old.late_grace_minutes ?? DEFAULT_SHIFT.grace_minutes),
    }];
  }

  const staff = {};
  const migrated = raw.version >= 2; // daily → monthly salary conversion already done
  if (!migrated) for (const [id, rate] of Object.entries(raw.employee_rates || {})) staff[id] = { salary: toMonthly(rate) };
  for (const [id, s] of Object.entries(raw.staff || {})) {
    const { salary_type, ...rest } = s;
    const hasSalary = rest.salary !== undefined && rest.salary !== null && rest.salary !== '';
    // Before version 2 a salary was daily unless salary_type was 'monthly'.
    if (!migrated && hasSalary && salary_type !== 'monthly') rest.salary = toMonthly(rest.salary);
    staff[id] = { ...staff[id], ...rest };
  }
  const shiftIds = new Set(shifts.map(s => s.id));
  for (const s of Object.values(staff)) if (!shiftIds.has(s.shift_id)) s.shift_id = shifts[0].id;

  const isMap = v => v && typeof v === 'object' && !Array.isArray(v);
  const advances = isMap(raw.advances) ? raw.advances : {};
  // companies: {id: {name, bank_name, account_name, account_number, ifsc}} — the firm whose account pays the staff.
  const companies = isMap(raw.companies) ? raw.companies : {};
  for (const s of Object.values(staff)) if (s.company_id && !companies[s.company_id]) delete s.company_id;
  // A company can have its own salary rules (full set, filled from the defaults); without them it uses `rules`.
  for (const c of Object.values(companies)) {
    if (!isMap(c.rules)) { delete c.rules; continue; }
    const own = { ...rules };
    for (const k of Object.keys(DEFAULT_RULES)) if (c.rules[k] !== undefined) own[k] = c.rules[k];
    if (beforeV4) Object.assign(own, V4_OVERTIME);
    c.rules = own;
  }
  return { version: SETTINGS_VERSION, rules, shifts, staff, advances, companies };
}

// ---------- Staff identity ----------
// Device employee IDs are not unique across attendance devices/reports (ID 2 can be a different person in
// another firm's report), so a sheet employee is matched to a saved staff record by ID *and* name.

/** Name compared ignoring case, punctuation and word order ("M SANJAY" = "Sanjay M."). */
const nameKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ');

/**
 * Point each sheet employee at its staff record, mutating parsed.employees[].id (the staff key) and setting
 * device_id (the ID printed in the report). A saved record with the same device ID but a different name is
 * someone else — saved before, or earlier in the same sheet: the sheet employee gets the next free key
 * "<id>_1", "<id>_2", … (shown as their employee ID) and a warning. Returns the parsed object.
 */
function resolveStaffIds(staff, parsed) {
  const taken = new Set();
  parsed.employees.forEach((e, i) => {
    const deviceId = e.device_id || e.id;
    e.device_id = deviceId;
    const sameDevice = Object.entries(staff).filter(([k, s]) => String(s.device_id ?? k) === deviceId && !taken.has(k));
    const match = sameDevice.find(([, s]) => !s.name || nameKey(s.name) === nameKey(e.name));
    let key = match ? match[0] : null;
    if (!key && !staff[deviceId] && !taken.has(deviceId)) key = deviceId;
    if (!key) {
      let n = 1;
      while (staff[`${deviceId}_${n}`] || taken.has(`${deviceId}_${n}`)) n++;
      key = `${deviceId}_${n}`;
      const inSheet = parsed.employees.slice(0, i).filter(o => o.device_id === deviceId).map(o => o.name);
      const where = inSheet.length ? `${inSheet.join(', ')} also has ID ${deviceId} in this sheet`
        : `${sameDevice.map(([, s]) => s.name).filter(Boolean).join(', ') || 'someone else'} is already saved with ID ${deviceId}`;
      parsed.warnings.push(`${where} — added ${e.name} as employee ${key}. Set their salary, shift and company on the Staff page.`);
    }
    taken.add(key);
    e.id = key;
  });
  return parsed;
}

/**
 * Settings v5: duplicate-ID staff used to start at "<id>_2"; they now start at "<id>_1". Renumbers each
 * device ID's suffixed keys down by one (only when "<id>_1" is free), in staff and advances.
 * Returns {oldKey: newKey} so the caller can rename the stored upload too.
 */
function renumberDuplicateIds(settings) {
  const renames = {};
  const staff = settings.staff || {};
  const groups = {};
  for (const k of Object.keys(staff)) {
    const m = k.match(/^(.+)_(\d+)$/);
    if (m && String(staff[k].device_id ?? m[1]) === m[1]) (groups[m[1]] ||= []).push([Number(m[2]), k]);
  }
  for (const [dev, keys] of Object.entries(groups)) {
    if (staff[`${dev}_1`] || keys.some(([n]) => n < 2)) continue;
    for (const [n, k] of keys.sort((a, b) => a[0] - b[0])) renames[k] = `${dev}_${n - 1}`;
  }
  const next = {};
  for (const [k, v] of Object.entries(staff)) next[renames[k] || k] = v;
  settings.staff = next;
  for (const a of Object.values(settings.advances || {})) if (renames[a.emp_id]) a.emp_id = renames[a.emp_id];
  return renames;
}

// ---------- Salary advances ----------
// advance = { emp_id, date: 'YYYY-MM-DD', amount, installment, start_month: 'YYYY-MM', note, overrides: {'YYYY-MM': amount} }
// Each month from start_month recovers the installment (or that month's override) until the amount is repaid.

const nextMonth = ym => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; };

/** Recovery of one advance in `month`: { deduction, recovered (incl. this month), balance (after this month) }. */
function advanceForMonth(adv, month) {
  const amount = Number(adv.amount) || 0;
  const overrides = adv.overrides || {};
  let remaining = amount;
  for (let m = adv.start_month; m && m <= month; m = nextMonth(m)) {
    const planned = overrides[m] !== undefined ? Number(overrides[m]) : Number(adv.installment) || 0;
    const due = Math.max(0, Math.min(remaining, planned));
    remaining -= due;
    if (m === month) return { deduction: due, recovered: amount - remaining, balance: remaining };
  }
  return { deduction: 0, recovered: amount - remaining, balance: remaining };
}

/** Month-by-month recovery from start_month until repaid: [{month, deduction, balance, overridden}]. */
function advanceSchedule(adv, maxMonths = 240) {
  const overrides = adv.overrides || {};
  let remaining = Number(adv.amount) || 0;
  const rows = [];
  for (let m = adv.start_month; m && remaining > 0 && rows.length < maxMonths; m = nextMonth(m)) {
    const overridden = overrides[m] !== undefined;
    const due = Math.max(0, Math.min(remaining, overridden ? Number(overrides[m]) : Number(adv.installment) || 0));
    remaining -= due;
    rows.push({ month: m, deduction: due, balance: remaining, overridden });
  }
  return rows;
}

/** All advances with their recovery in `month` and full schedule, newest first. */
function advanceSummary(advances = {}, month) {
  return Object.entries(advances)
    .map(([id, a]) => ({ id, ...a, month, ...advanceForMonth(a, month), schedule: advanceSchedule(a) }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/** Month of a parsed upload as YYYY-MM. */
function reportMonth(parsed) {
  if (parsed.period.from) return parsed.period.from.slice(0, 7);
  const first = parsed.employees.flatMap(e => e.days)[0];
  return first ? first.date.slice(0, 7) : '';
}

// Status code in brackets, e.g. "Present(P)" -> P.
const STATUS_KIND = {
  P: 'work', LT: 'work', EL: 'work', HD: 'half',
  A: 'absent', LE: 'leave',
  WO: 'off', WOP: 'off',
  H: 'holiday', PH: 'holiday', HO: 'holiday', HL: 'holiday',
};

const pad = n => String(n).padStart(2, '0');

function toMinutes(s) {
  const m = String(s ?? '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function normTime(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const total = Math.round(v * 24 * 60);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }
  const mins = toMinutes(v);
  return mins === null ? '' : `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

// Returns YYYY-MM-DD. Text dates are read as day-month-year (Indian format).
function normDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : '';
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return '';
}

function parsePeriodDate(s) {
  const d = new Date(String(s).replace(/\s+/g, ' ').trim());
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const hs = rows[i].map(v => String(v ?? '').trim().toLowerCase());
    if (hs.includes('date') && hs.includes('status')) return { index: i, headers: hs };
  }
  return null;
}

const colIndex = (headers, name) => headers.findIndex(h => h === name);

/**
 * Parse a workbook with one worksheet per employee.
 * Returns { company, period: {from, to}, employees: [{id, name, sheet, days: [...]}], warnings }.
 */
function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return parseSheets(wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }),
    textRows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }),
  })));
}

/**
 * Parse employee sheets given as rows of cells ({name, rows, textRows?}); used for both
 * Excel worksheets and PDF pages (lib/pdf.js).
 */
function parseSheets(sheets) {
  const result = { company: '', period: { from: '', to: '' }, employees: [], warnings: [] };

  for (const { name: sheet, rows, textRows = rows } of sheets) {
    let name = '', id = '';
    for (const row of textRows.slice(0, 15)) {
      const text = row.join(' ');
      const emp = text.match(/Employee\s*Name\s*:\s*(.*?)\s*,\s*Employee\s*ID\s*:\s*([^,]+)/i);
      if (emp) { name = emp[1].trim(); id = emp[2].trim(); }
      const co = text.match(/Company\s*:\s*(.*?)(?:\s{2,}|Generated On|$)/i);
      if (co && !result.company) result.company = co[1].trim();
      // "From Sep 01 2026 To Sep 30 2026" (Excel) or "September 01 2026 To September 30 2026" (PDF)
      const per = text.match(/From\s+(.+?)\s+To\s+(.+?)\s*$/i)
        || text.match(/([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s+To\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
      if (per && !result.period.from) result.period = { from: parsePeriodDate(per[1]), to: parsePeriodDate(per[2]) };
    }

    const header = findHeader(rows);
    if (!header) { result.warnings.push(`Sheet "${sheet}": no table with Date and Status columns, skipped`); continue; }
    if (!id) { id = sheet; result.warnings.push(`Sheet "${sheet}": employee ID not found in header, using sheet name`); }
    if (!name) name = `Employee ${id}`;

    const h = header.headers;
    const c = {
      date: colIndex(h, 'date'), in: colIndex(h, 'clock in'), out: colIndex(h, 'clock out'),
      wt: Math.max(colIndex(h, 'total wt'), colIndex(h, 'actual wt')), status: colIndex(h, 'status'),
    };
    if (c.in < 0 || c.out < 0) result.warnings.push(`Sheet "${sheet}": Clock In / Clock Out columns not found`);

    const days = [];
    for (let r = header.index + 1; r < rows.length; r++) {
      const row = rows[r];
      const date = normDate(row[c.date]);
      if (!date) continue; // blank rows and the "Total" footer
      const get = i => (i >= 0 ? row[i] : '');
      days.push({
        date,
        clock_in: normTime(get(c.in)),
        clock_out: normTime(get(c.out)),
        total_wt: normTime(get(c.wt)),
        status: String(get(c.status) || '').trim(),
      });
    }
    result.employees.push({ id: String(id), name, sheet, days });
  }

  const ids = result.employees.map(e => e.id);
  for (const dup of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) {
    result.warnings.push(`Employee ID ${dup} appears on more than one sheet`);
  }
  return result;
}

function statusCode(status) {
  const m = String(status).match(/\(([A-Za-z]+)\)\s*$/);
  if (m) return m[1].toUpperCase();
  const s = String(status).toLowerCase();
  if (s.includes('weekoff present')) return 'WOP';
  if (s.includes('week off') || s.includes('weekoff')) return 'WO';
  if (s.includes('half')) return 'HD';
  if (s.includes('absent')) return 'A';
  if (s.includes('late')) return 'LT';
  if (s.includes('early')) return 'EL';
  if (s.includes('holiday')) return 'H';
  if (s.includes('present')) return 'P';
  return '';
}

const isSunday = iso => new Date(`${iso}T00:00:00`).getDay() === 0;

/**
 * The device fills Clock In first, so a day with a single evening punch arrives as
 * "Clock In 19:34". A lone punch in the second half of the working day is really the log-off:
 * move it to Clock Out. Returns { clock_in, clock_out, moved }.
 */
function readPunches(day, shift, rules, sunday) {
  const login = toMinutes(shift.login_time);
  const end = toMinutes(sunday ? rules.sunday_logout_time : shift.logout_time);
  const ci = toMinutes(day.clock_in);
  if (day.clock_in && !day.clock_out && login !== null && end !== null && end > login && ci >= (login + end) / 2) {
    return { clock_in: '', clock_out: day.clock_in, moved: 1 };
  }
  return { clock_in: day.clock_in, clock_out: day.clock_out, moved: 0 };
}

/** Classify one day using its source status, punches and the employee's shift. */
function classifyDay(day, rules, shift = DEFAULT_SHIFT) {
  rules = { ...DEFAULT_RULES, ...rules };
  const sunday = isSunday(day.date);
  const punches = readPunches(day, shift, rules, sunday);
  const code = statusCode(day.status);
  const punched = Boolean(punches.clock_in || punches.clock_out);
  let kind = STATUS_KIND[code];
  let unknown = false;
  if (!kind) { unknown = true; kind = punched ? 'work' : 'absent'; }
  // The device marks every Saturday/Sunday as Week Off; when weekends are working days,
  // judge those days by their punches like any other day.
  if ((kind === 'off' || kind === 'holiday') && Number(rules.weekends_working)) kind = punched ? 'work' : 'absent';
  // Leave (LE, PDF report) is an absence unless they punched anyway.
  if (kind === 'leave') kind = punched ? 'work' : 'absent';
  // A clock-out with no clock-in means they came to work: Present, fined for the missing punch
  // (the device marks these days Absent).
  if (kind === 'absent' && !punches.clock_in && punches.clock_out) kind = 'work';

  const grace = Number(shift.grace_minutes || 0);
  const co = toMinutes(punches.clock_out);
  // Sunday ends at sunday_logout_time, so a device "Half Day" for leaving then is a full day.
  const sundayEnd = toMinutes(rules.sunday_logout_time);
  if (kind === 'half' && sunday && co !== null && sundayEnd !== null && co >= sundayEnd - grace) kind = 'work';

  const out = {
    ...day, ...punches, code, unknown, sunday: sunday ? 1 : 0, category: '', late: 0,
    missing_in: 0, missing_out: 0, missing: 0, absent: 0, half: 0, off: 0, holiday: 0, paid: 0, leave: 0,
    late_fine: 0, missing_fine: 0, worked_minutes: 0, ot_minutes: 0, late_minutes: 0, late_hours: 0,
    early: 0, early_minutes: 0, early_hours: 0, early_fine: 0,
  };
  if (kind === 'off') return { ...out, category: code === 'WOP' ? 'Weekly Off (worked)' : 'Weekly Off', off: 1 };
  if (kind === 'holiday') return { ...out, category: 'Holiday', holiday: 1 };
  if (kind === 'absent') return { ...out, category: 'Absent', absent: 1 };
  // Only a clock in or only a clock out: leave (deducted like an absence, no fines).
  if (Number(rules.missing_punch_as_leave) && !(punches.clock_in && punches.clock_out)) {
    const missing_in = punches.clock_in ? 0 : 1, missing_out = punches.clock_out ? 0 : 1;
    return { ...out, category: 'Absent', absent: 1, missing_in, missing_out, missing: missing_in + missing_out };
  }

  // Late is judged only from a real (morning) Clock In.
  const ci = toMinutes(punches.clock_in);
  const login = toMinutes(shift.login_time);
  out.half = kind === 'half' ? 1 : 0;
  out.late = ci !== null && login !== null && ci > login + grace ? 1 : 0;
  out.missing_in = !punches.clock_in && punches.clock_out ? 1 : 0;
  out.missing_out = punches.clock_in && !punches.clock_out ? 1 : 0;
  out.missing = out.missing_in + out.missing_out;
  // Early leave: on a full day with both punches, Clock Out before the day's logout (shift logout; Sunday: Sunday finish)
  // minus the shift's grace. A clock out earlier than the clock in is after midnight, never early.
  const dayEnd = toMinutes(sunday ? rules.sunday_logout_time : shift.logout_time);
  out.early = Number(rules.early_leave) && !out.half && ci !== null && co !== null && dayEnd !== null && co >= ci && co < dayEnd - grace ? 1 : 0;
  out.category = out.half ? 'Half Day' : out.late && out.early ? 'Late + Early' : out.late ? 'Late' : out.early ? 'Early Leave' : 'Present';
  out.paid = out.half ? 1 - Number(rules.half_day_deduction) : 1;
  // Late and early leave: a fixed fine per day, or the time (rounded up to whole blocks) deducted at the hourly rate later.
  const block = Math.max(1, Number(rules.late_hour_block) || 60);
  const toHours = mins => (Math.ceil(mins / block) * block) / 60;
  const hourlyCut = rules.late_mode === 'hourly';
  out.late_minutes = out.late ? ci - login : 0;
  out.late_hours = out.late && hourlyCut ? toHours(out.late_minutes) : 0;
  out.late_fine = hourlyCut ? 0 : out.late * Number(rules.late_fine || 0);
  out.early_minutes = out.early ? dayEnd - co : 0;
  out.early_hours = out.early && hourlyCut ? toHours(out.early_minutes) : 0;
  out.early_fine = hourlyCut ? 0 : out.early * Number(rules.late_fine || 0);
  out.missing_fine = out.missing * Number(rules.missing_punch_fine || 0);
  // Overtime: clock out after the day's logout (shift logout; Sunday: Sunday finish). Paid from overtime_min_minutes
  // past logout, counted in whole overtime_block_minutes blocks (min 60, block 30: 21:10 for 20:00 = 1 h, 21:35 = 1.5 h).
  if (ci !== null && co !== null && !out.half) {
    const out_ = co < ci ? co + 1440 : co; // clocked out after midnight
    out.worked_minutes = out_ - ci;
    const extra = dayEnd !== null ? out_ - dayEnd : 0;
    const otBlock = Math.max(1, Number(rules.overtime_block_minutes) || 30);
    if (Number(rules.overtime_pay) && extra > 0 && extra >= Number(rules.overtime_min_minutes || 0)) {
      out.ot_minutes = Math.floor(extra / otBlock) * otBlock;
    }
  }
  return out;
}

// ---------- Manual corrections (month edits) ----------
// A day can be corrected by hand: present (full day, no fines), half day, absent, paid leave or paid off day.
const DAY_FIXES = {
  present: { category: 'Present', paid: 1 },
  half: { category: 'Half Day', half: 1 },
  absent: { category: 'Absent', absent: 1 },
  leave: { category: 'Paid Leave', paid: 1, leave: 1 },
  off: { category: 'Weekly Off', off: 1 },
};

/** Day `d` (from classifyDay) with a manual correction {status, note}; the device's reading is kept in `corrected`. */
function correctDay(d, fix, rules) {
  const f = DAY_FIXES[fix?.status];
  if (!f) return d;
  const zero = { late: 0, missing_in: 0, missing_out: 0, missing: 0, absent: 0, half: 0, off: 0, holiday: 0, paid: 0, leave: 0,
    late_fine: 0, missing_fine: 0, late_minutes: 0, late_hours: 0, early: 0, early_minutes: 0, early_hours: 0, early_fine: 0, unknown: false };
  const out = { ...d, ...zero, ...f, corrected: { status: fix.status, note: fix.note || '', was: d.category } };
  if (f.half) out.paid = 1 - Number(rules.half_day_deduction);
  if (fix.status !== 'present') out.ot_minutes = 0;
  return out;
}

const ADJUST_KINDS = ['earning', 'deduction'];

function daysInPeriod(parsed) {
  const { from, to } = parsed.period;
  if (from && to) return Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const first = parsed.employees.flatMap(e => e.days)[0];
  if (!first) return 0;
  const [y, m] = first.date.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Calculate salary for every employee in a parsed workbook.
 * settings = { rules, shifts: [shift], staff: {id: {shift_id, salary}} } where salary is monthly.
 * Base = the monthly salary (or rules.monthly_salary when none is mapped), whatever the month length.
 * Daily rate = monthly ÷ rules.salary_divisor (30.5); absences beyond the allowance and half days
 * are deducted at that rate.
 */
/**
 * edits = { days: {empId: {date: {status, note}}}, adjustments: {empId: [{id, kind: 'earning'|'deduction', label, amount}]},
 *           paid: {empId: {date, note}} } — hand corrections, bonuses/deductions and payment status for the month.
 */
function calculatePayroll(parsed, settings = {}, edits = {}) {
  const { rules: defaultRules, shifts, staff, advances, companies } = normalizeSettings(settings);
  const calendarDays = daysInPeriod(parsed);
  const month = reportMonth(parsed);
  const advanceList = advanceSummary(advances, month);
  const warnings = [...parsed.warnings];

  const employees = parsed.employees.map(emp => {
    const s = staff[emp.id] || {};
    const company = companies[s.company_id];
    const rules = company?.rules || defaultRules; // the company's own salary rules, or the defaults
    const shift = shifts.find(x => x.id === s.shift_id) || shifts[0];
    const mapped = s.salary !== null && s.salary !== undefined && s.salary !== '';
    const monthly = Number(mapped ? s.salary : rules.monthly_salary);
    const rate = monthly / Number(rules.salary_divisor);
    const fixes = edits.days?.[emp.id] || {};
    const days = emp.days.map(d => correctDay(classifyDay(d, rules, shift), fixes[d.date], rules));
    for (const d of days) if (d.unknown) warnings.push(`${emp.name} ${d.date}: unrecognised status "${d.status}"`);
    if (days.length !== calendarDays) warnings.push(`${emp.name}: ${days.length} days in sheet, expected ${calendarDays}`);

    const sum = k => days.reduce((s, d) => s + d[k], 0);
    const absences = sum('absent');
    const allowed = Math.min(absences, Math.max(0, Number(rules.allowed_absences)));
    const excess = absences - allowed;
    const half = sum('half');
    const base = monthly;
    const attendanceDeduction = Math.round((excess + half * Number(rules.half_day_deduction)) * rate);
    // Hourly rate = daily rate ÷ the shift's hours (login → logout).
    const shiftMinutes = ((toMinutes(shift.logout_time) - toMinutes(shift.login_time)) + 1440) % 1440 || 1440;
    const hourly = rate / (shiftMinutes / 60);
    const lateHours = sum('late_hours');
    const lateFine = rules.late_mode === 'hourly' ? Math.round(lateHours * hourly) : sum('late_fine');
    const earlyHours = sum('early_hours');
    const earlyFine = rules.late_mode === 'hourly' ? Math.round(earlyHours * hourly) : sum('early_fine');
    const missingFine = sum('missing_fine');
    const totalFines = lateFine + earlyFine + missingFine;
    const otMinutes = sum('ot_minutes');
    const otRate = rules.overtime_mode === 'fixed' ? Number(rules.overtime_fixed_rate) || 0 : hourly;
    const incentive = Math.round((otMinutes / 60) * otRate);
    // Advances still being repaid (or starting later), with this month's recovery.
    const empAdvances = advanceList.filter(a => a.emp_id === emp.id && (a.deduction || a.balance));
    const advanceDeduction = empAdvances.reduce((s, a) => s + a.deduction, 0);
    const adjustments = (edits.adjustments?.[emp.id] || []).filter(a => ADJUST_KINDS.includes(a.kind) && Number(a.amount));
    const adjSum = kind => Math.round(adjustments.filter(a => a.kind === kind).reduce((s, a) => s + Number(a.amount), 0));
    const extraEarnings = adjSum('earning');
    const extraDeductions = adjSum('deduction');
    const net = base - attendanceDeduction - totalFines - advanceDeduction + incentive + extraEarnings - extraDeductions;
    if (net < 0 && advanceDeduction) warnings.push(`${emp.name}: net salary is negative after advance deduction`);
    return {
      id: emp.id, device_id: emp.device_id || emp.id, name: emp.name, sheet: emp.sheet,
      company_id: s.company_id || '', company_name: company?.name || '',
      rules, rules_name: company?.rules ? company.name : 'Default',
      shift_id: shift.id, shift_name: shift.name, shift_time: `${shift.login_time}–${shift.logout_time}`,
      salary_mapped: mapped, monthly_salary: monthly,
      calendar_days: calendarDays,
      present_days: days.filter(d => !d.absent && !d.half && !d.off && !d.holiday && !d.leave).length,
      half_days: half, absences, off_days: sum('off'), holidays: sum('holiday'),
      late_arrivals: sum('late'), late_minutes: sum('late_minutes'), late_hours: lateHours, missing_punches: sum('missing'),
      early_leaves: sum('early'), early_minutes: sum('early_minutes'), early_hours: earlyHours, early_fine: earlyFine,
      allowed_absences: allowed, excess_absences: excess,
      daily_salary: Math.round(rate * 100) / 100, base_salary: base, attendance_deduction: attendanceDeduction,
      late_fine: lateFine, missing_punch_fine: missingFine,
      total_fines: totalFines, advance_deduction: advanceDeduction,
      hourly_rate: Math.round(hourly * 100) / 100, overtime_minutes: otMinutes, overtime_incentive: incentive,
      overtime_rate: Math.round(otRate * 100) / 100,
      advance_balance: empAdvances.reduce((s, a) => s + a.balance, 0),
      advances: empAdvances, adjustments, extra_earnings: extraEarnings, extra_deductions: extraDeductions,
      leave_days: sum('leave'), corrections: days.filter(d => d.corrected).length,
      paid_on: edits.paid?.[emp.id]?.date || '', net_salary: net,
      days,
    };
  });

  const total = k => employees.reduce((s, e) => s + e[k], 0);
  const totals = Object.fromEntries(
    ['present_days', 'half_days', 'absences', 'off_days', 'late_arrivals', 'early_leaves', 'early_fine', 'missing_punches',
      'allowed_absences', 'excess_absences', 'base_salary', 'attendance_deduction', 'late_fine',
      'missing_punch_fine', 'total_fines', 'advance_deduction', 'overtime_minutes', 'overtime_incentive',
      'extra_earnings', 'extra_deductions', 'leave_days', 'net_salary'].map(k => [k, total(k)]));
  totals.paid_count = employees.filter(e => e.paid_on).length;
  totals.paid_amount = employees.filter(e => e.paid_on).reduce((s, e) => s + e.net_salary, 0);

  return { company: parsed.company, period: parsed.period, month, calendar_days: calendarDays, rules: defaultRules, companies, shifts, employees, totals, warnings };
}

/** Report with payment status from edits.paid (also used on a locked month's frozen report). */
function applyPaid(report, paid = {}) {
  const employees = report.employees.map(e => ({ ...e, paid_on: paid[e.id]?.date || '' }));
  const done = employees.filter(e => e.paid_on);
  return { ...report, employees, totals: { ...report.totals, paid_count: done.length, paid_amount: done.reduce((s, e) => s + e.net_salary, 0) } };
}

module.exports = {
  applyPaid,
  DEFAULT_RULES, DEFAULT_SHIFT, SETTINGS_VERSION, normalizeSettings, parseWorkbook, parseSheets, classifyDay, calculatePayroll,
  advanceForMonth, advanceSchedule, advanceSummary, reportMonth, resolveStaffIds, renumberDuplicateIds, nameKey,
  normDate, normTime, statusCode, DAY_FIXES, ADJUST_KINDS,
};
