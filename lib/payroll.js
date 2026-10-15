// Parsing of biometric "Daily Details Report" workbooks and salary calculation.
// Pure functions only: no file or network access, so tests can import this directly.
const XLSX = require('xlsx');

const DEFAULT_RULES = {
  monthly_salary: 15250,      // ₹ per month for staff with no salary mapped
  salary_divisor: 30.5,       // daily rate = monthly salary ÷ this (used for deductions)
  late_fine: 50,              // ₹ per late arrival
  missing_punch_fine: 50,     // ₹ per missing Clock In or Clock Out on a workday
  weekends_working: 1,        // 1: device "Week Off" days (Sat/Sun) are working days; 0: paid weekly offs
  sunday_logout_time: '14:30', // Sunday is a short day: leaving from this time is a full day
  allowed_absences: 2,        // full absences per month that are not deducted
  half_day_deduction: 0.5,    // fraction of a day deducted for Half Day(HD)
};

const SETTINGS_VERSION = 2;

// Shift bucket: late = Clock In after login + grace. Logout is the scheduled end (early leave is not marked).
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
  const migrated = raw.version >= SETTINGS_VERSION;
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

  return { version: SETTINGS_VERSION, rules, shifts, staff };
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
  if (kind === 'off' && Number(rules.weekends_working)) kind = punched ? 'work' : 'absent';
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
    missing_in: 0, missing_out: 0, missing: 0, absent: 0, half: 0, off: 0, holiday: 0, paid: 0,
    late_fine: 0, missing_fine: 0,
  };
  if (kind === 'off') return { ...out, category: code === 'WOP' ? 'Weekly Off (worked)' : 'Weekly Off', off: 1 };
  if (kind === 'holiday') return { ...out, category: 'Holiday', holiday: 1 };
  if (kind === 'absent') return { ...out, category: 'Absent', absent: 1 };

  // Late is judged only from a real (morning) Clock In.
  const ci = toMinutes(punches.clock_in);
  const login = toMinutes(shift.login_time);
  out.half = kind === 'half' ? 1 : 0;
  out.late = ci !== null && login !== null && ci > login + grace ? 1 : 0;
  out.missing_in = !punches.clock_in && punches.clock_out ? 1 : 0;
  out.missing_out = punches.clock_in && !punches.clock_out ? 1 : 0;
  out.missing = out.missing_in + out.missing_out;
  out.category = out.half ? 'Half Day' : out.late ? 'Late' : 'Present';
  out.paid = out.half ? 1 - Number(rules.half_day_deduction) : 1;
  out.late_fine = out.late * Number(rules.late_fine || 0);
  out.missing_fine = out.missing * Number(rules.missing_punch_fine || 0);
  return out;
}

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
function calculatePayroll(parsed, settings = {}) {
  const { rules, shifts, staff } = normalizeSettings(settings);
  const calendarDays = daysInPeriod(parsed);
  const warnings = [...parsed.warnings];

  const employees = parsed.employees.map(emp => {
    const s = staff[emp.id] || {};
    const shift = shifts.find(x => x.id === s.shift_id) || shifts[0];
    const mapped = s.salary !== null && s.salary !== undefined && s.salary !== '';
    const monthly = Number(mapped ? s.salary : rules.monthly_salary);
    const rate = monthly / Number(rules.salary_divisor);
    const days = emp.days.map(d => classifyDay(d, rules, shift));
    for (const d of days) if (d.unknown) warnings.push(`${emp.name} ${d.date}: unrecognised status "${d.status}"`);
    if (days.length !== calendarDays) warnings.push(`${emp.name}: ${days.length} days in sheet, expected ${calendarDays}`);

    const sum = k => days.reduce((s, d) => s + d[k], 0);
    const absences = sum('absent');
    const allowed = Math.min(absences, Math.max(0, Number(rules.allowed_absences)));
    const excess = absences - allowed;
    const half = sum('half');
    const base = monthly;
    const attendanceDeduction = Math.round((excess + half * Number(rules.half_day_deduction)) * rate);
    const lateFine = sum('late_fine'), missingFine = sum('missing_fine');
    const totalFines = lateFine + missingFine;
    return {
      id: emp.id, name: emp.name, sheet: emp.sheet,
      shift_id: shift.id, shift_name: shift.name, shift_time: `${shift.login_time}–${shift.logout_time}`,
      salary_mapped: mapped, monthly_salary: monthly,
      calendar_days: calendarDays,
      present_days: days.filter(d => d.category === 'Present' || d.category === 'Late').length,
      half_days: half, absences, off_days: sum('off'), holidays: sum('holiday'),
      late_arrivals: sum('late'), missing_punches: sum('missing'),
      allowed_absences: allowed, excess_absences: excess,
      daily_salary: Math.round(rate * 100) / 100, base_salary: base, attendance_deduction: attendanceDeduction,
      late_fine: lateFine, missing_punch_fine: missingFine,
      total_fines: totalFines, net_salary: base - attendanceDeduction - totalFines,
      days,
    };
  });

  const total = k => employees.reduce((s, e) => s + e[k], 0);
  const totals = Object.fromEntries(
    ['present_days', 'half_days', 'absences', 'off_days', 'late_arrivals', 'missing_punches',
      'allowed_absences', 'excess_absences', 'base_salary', 'attendance_deduction', 'late_fine',
      'missing_punch_fine', 'total_fines', 'net_salary'].map(k => [k, total(k)]));

  return { company: parsed.company, period: parsed.period, calendar_days: calendarDays, rules, shifts, employees, totals, warnings };
}

module.exports = {
  DEFAULT_RULES, DEFAULT_SHIFT, SETTINGS_VERSION, normalizeSettings, parseWorkbook, parseSheets, classifyDay, calculatePayroll,
  normDate, normTime, statusCode,
};
