const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parseWorkbook, classifyDay, calculatePayroll, normalizeSettings, DEFAULT_RULES, DEFAULT_SHIFT, SETTINGS_VERSION } = require('../lib/payroll');

// Builds a workbook shaped like the biometric "Daily Details Report": one sheet per employee.
function reportWorkbook(employees, { from = 'September 01 2026', to = 'September 30 2026' } = {}) {
  const wb = XLSX.utils.book_new();
  for (const emp of employees) {
    const rows = [
      ['Daily Details Report'],
      [`From  ${from}  To  ${to}`],
      [],
      ['Company : TEST CO', '', '', '', 'Generated On : Thursday, October 01, 2026 11:23:06'],
      [],
      [`Employee Name : ${emp.name} , Employee ID : ${emp.id}, Gender : , Department : Department`],
      ['No.', 'Date', 'Check In', 'Check Out', 'Clock In', 'Clock Out', 'Total WT', 'Status'],
      ...emp.days.map((d, i) => [String(i + 1), d[0], '09:30', '19:55', d[1], d[2], '', d[3]]),
      ['Total', '', '', '', '', '', '10:00', ''],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), emp.id);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const day = (clock_in, clock_out, status) => ({ date: '2026-09-01', clock_in, clock_out, total_wt: '', status });

test('parses company, period, employee header and day rows', () => {
  const buf = reportWorkbook([{ id: '7', name: 'ASHA', days: [['01-09-2026', '09:20', '19:40', 'Present(P)'], ['02-09-2026', '', '', 'Absent(A)']] }]);
  const p = parseWorkbook(buf);
  assert.equal(p.company, 'TEST CO');
  assert.deepEqual(p.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(p.employees[0].id, '7');
  assert.equal(p.employees[0].name, 'ASHA');
  assert.equal(p.employees[0].days.length, 2, 'Total footer row is skipped');
  assert.deepEqual(p.employees[0].days[0], { date: '2026-09-01', clock_in: '09:20', clock_out: '19:40', total_wt: '', status: 'Present(P)' });
});

test('Clock In after shift login (+ grace) is late', () => {
  assert.equal(classifyDay(day('09:31', '19:30', 'Late(LT)'), DEFAULT_RULES).late, 1);
  assert.equal(classifyDay(day('09:30', '19:30', 'Present(P)'), DEFAULT_RULES).late, 0);
  assert.equal(classifyDay(day('09:40', '19:30', 'Late(LT)'), DEFAULT_RULES, { ...DEFAULT_SHIFT, grace_minutes: 10 }).late, 0);
});

test('early leave is never marked or fined', () => {
  const d = classifyDay(day('09:00', '15:00', 'Early Leave(EL)'), DEFAULT_RULES, { ...DEFAULT_SHIFT, logout_time: '19:30' });
  assert.equal(d.category, 'Present');
  assert.equal(d.early_leave, undefined);
  assert.equal(d.late_fine + d.missing_fine, 0);
});

test('staff in a different shift bucket are judged against that shift', () => {
  const buf = reportWorkbook([
    { id: '1', name: 'DAY', days: [['01-09-2026', '10:05', '19:30', 'Present(P)']] },
    { id: '2', name: 'LATE SHIFT', days: [['01-09-2026', '10:05', '19:30', 'Present(P)']] },
  ]);
  const r = calculatePayroll(parseWorkbook(buf), {
    shifts: [DEFAULT_SHIFT, { id: 'b', name: 'B', login_time: '10:30', logout_time: '19:30', grace_minutes: 0 }],
    staff: { 2: { shift_id: 'b' } },
  });
  assert.equal(r.employees[0].late_arrivals, 1);
  assert.equal(r.employees[0].shift_name, 'General');
  assert.equal(r.employees[1].late_arrivals, 0);
  assert.equal(r.employees[1].shift_name, 'B');
});

test('missing Clock In or Clock Out on a workday is a missing punch, not an absence', () => {
  const d = classifyDay(day('', '19:30', 'Present(P)'), DEFAULT_RULES);
  assert.equal(d.missing_in, 1);
  assert.equal(d.absent, 0);
  assert.equal(d.missing_fine, 50);
});

const on = (date, clock_in, clock_out, status) => ({ date, clock_in, clock_out, total_wt: '', status });

test('weekends are working days: device Week Off is judged by punches', () => {
  // 2026-09-05 is a Saturday, 2026-09-06 a Sunday.
  const worked = classifyDay(on('2026-09-05', '09:45', '19:30', 'Weekoff Present(WOP)'), DEFAULT_RULES);
  assert.equal(worked.category, 'Late');
  assert.equal(worked.off, 0);
  assert.equal(worked.paid, 1);
  const noPunch = classifyDay(on('2026-09-06', '', '', 'Week Off(WO)'), DEFAULT_RULES);
  assert.equal(noPunch.absent, 1);
  const halfPunch = classifyDay(on('2026-09-05', '09:20', '', 'Week Off(WO)'), DEFAULT_RULES);
  assert.equal(halfPunch.missing_out, 1);
});

test('with weekends_working off, Week Off days are paid offs with no fines', () => {
  const rules = { ...DEFAULT_RULES, weekends_working: 0 };
  for (const status of ['Week Off(WO)', 'Weekoff Present(WOP)']) {
    const d = classifyDay(on('2026-09-06', '09:45', '', status), rules);
    assert.equal(d.off, 1, status);
    assert.equal(d.late + d.missing, 0, status);
  }
});

test('Sunday: leaving at the Sunday finish time is a full day, not a half day', () => {
  const sun = classifyDay(on('2026-09-06', '09:20', '14:30', 'Half Day(HD)'), DEFAULT_RULES);
  assert.equal(sun.half, 0);
  assert.equal(sun.paid, 1);
  const tooEarly = classifyDay(on('2026-09-06', '09:20', '12:00', 'Half Day(HD)'), DEFAULT_RULES);
  assert.equal(tooEarly.half, 1);
  const monday = classifyDay(on('2026-09-07', '09:20', '14:30', 'Half Day(HD)'), DEFAULT_RULES);
  assert.equal(monday.half, 1);
});

test('clock-out with no clock-in is Present with a missing punch fine, never late', () => {
  const shift = { ...DEFAULT_SHIFT, login_time: '09:30', logout_time: '20:00' };
  const d = classifyDay(on('2026-09-01', '', '20:12', 'Present(P)'), DEFAULT_RULES, shift);
  assert.equal(d.category, 'Present');
  assert.equal(d.late, 0);
  assert.equal(d.missing_in, 1);
  assert.equal(d.missing_fine, 50);
});

test('a lone evening punch in the Clock In column is read as the log-off', () => {
  const shift = { ...DEFAULT_SHIFT, login_time: '09:30', logout_time: '20:00' };
  // Device marked this Absent; the only punch (19:23) is a log-off.
  const d = classifyDay(on('2026-09-10', '19:23', '', 'Absent(A)'), DEFAULT_RULES, shift);
  assert.equal(d.category, 'Present');
  assert.equal(d.absent, 0);
  assert.equal(d.late, 0);
  assert.equal(d.clock_in, '');
  assert.equal(d.clock_out, '19:23');
  assert.equal(d.moved, 1);
  assert.equal(d.missing_in, 1);
  assert.equal(d.missing_fine, 50);
});

test('a lone morning punch is still a clock-in: late if after login, fined for missing clock-out', () => {
  const shift = { ...DEFAULT_SHIFT, login_time: '09:30', logout_time: '20:00' };
  const d = classifyDay(on('2026-09-01', '09:45', '', 'Late(LT)'), DEFAULT_RULES, shift);
  assert.equal(d.late, 1);
  assert.equal(d.missing_out, 1);
  assert.equal(d.moved, 0);
});

test('Sunday: a lone afternoon punch after the Sunday midpoint is the log-off', () => {
  // Sunday 09:30–14:30 → midpoint 12:00.
  const d = classifyDay(on('2026-09-06', '14:20', '', 'Week Off(WO)'), DEFAULT_RULES, { ...DEFAULT_SHIFT, login_time: '09:30' });
  assert.equal(d.clock_out, '14:20');
  assert.equal(d.late, 0);
  assert.equal(d.category, 'Present');
});

test('absent days get no late or missing punch fines', () => {
  const d = classifyDay(day('09:45', '', 'Absent(A)'), DEFAULT_RULES);
  assert.equal(d.late + d.missing, 0);
});

const V2 = { version: SETTINGS_VERSION };

test('salary: base is the default monthly; excess absences and half days deducted at monthly ÷ 30.5', () => {
  const days = [
    ['01-09-2026', '09:20', '19:40', 'Present(P)'],
    ['02-09-2026', '09:45', '19:40', 'Late(LT)'],      // late fine 50
    ['03-09-2026', '09:10', '', 'Present(P)'],         // missing out fine 50
    ['04-09-2026', '', '', 'Absent(A)'],
    ['05-09-2026', '', '', 'Absent(A)'],
    ['06-09-2026', '', '', 'Absent(A)'],               // 1 excess absence -> 500
    ['07-09-2026', '09:00', '14:00', 'Half Day(HD)'],  // half day -> 250
  ];
  const r = calculatePayroll(parseWorkbook(reportWorkbook([{ id: '1', name: 'A', days }])));
  const e = r.employees[0];
  assert.equal(e.calendar_days, 30);
  assert.equal(e.monthly_salary, 15250);
  assert.equal(e.base_salary, 15250);
  assert.equal(e.daily_salary, 500);
  assert.equal(e.excess_absences, 1);
  assert.equal(e.attendance_deduction, 750);
  assert.equal(e.total_fines, 100);
  assert.equal(e.net_salary, 15250 - 750 - 100);
});

test('mapped monthly salary: base is the same whatever the month length', () => {
  const absent = d => [d, '', '', 'Absent(A)'];
  const run = (from, to, date) => calculatePayroll(
    parseWorkbook(reportWorkbook([{ id: '1', name: 'A', days: [absent(date), absent(date), absent(date)] }], { from, to })),
    { ...V2, staff: { 1: { salary: 18300 } } }).employees[0];
  const feb = run('February 01 2026', 'February 28 2026', '01-02-2026');
  const oct = run('October 01 2026', 'October 31 2026', '01-10-2026');
  for (const e of [feb, oct]) {
    assert.equal(e.base_salary, 18300);
    assert.equal(e.daily_salary, 600);         // 18300 / 30.5
    assert.equal(e.attendance_deduction, 600); // 1 absence beyond the 2 allowed
    assert.equal(e.net_salary, 17700);
  }
});

test('daily rate rounds deductions to the rupee', () => {
  const days = [['01-09-2026', '', '', 'Absent(A)'], ['02-09-2026', '', '', 'Absent(A)'], ['03-09-2026', '', '', 'Absent(A)']];
  const r = calculatePayroll(parseWorkbook(reportWorkbook([{ id: '1', name: 'A', days }])), { ...V2, staff: { 1: { salary: 10000 } } });
  assert.equal(r.employees[0].daily_salary, 327.87);
  assert.equal(r.employees[0].attendance_deduction, 328);
});

test('older settings files are migrated once: shifts from login rules, daily salaries × 30.5', () => {
  const s = normalizeSettings({
    rules: { login_time: '10:00', late_grace_minutes: 5, late_fine: 30, daily_salary: 400 },
    employee_rates: { 7: 650 },
    staff: { 2: { name: 'B', salary: 325 }, 3: { name: 'C', salary_type: 'monthly', salary: 20000 } },
  });
  assert.equal(s.version, SETTINGS_VERSION);
  assert.equal(s.shifts[0].login_time, '10:00');
  assert.equal(s.shifts[0].grace_minutes, 5);
  assert.equal(s.rules.late_fine, 30);
  assert.equal(s.rules.monthly_salary, 12200);
  assert.equal(s.rules.login_time, undefined);
  assert.equal(s.staff[7].salary, 19825);
  assert.equal(s.staff[2].salary, 9912.5);
  assert.deepEqual(s.staff[3], { name: 'C', salary: 20000, shift_id: 'general' });
  // Running it again on migrated settings must not change salaries.
  assert.deepEqual(normalizeSettings(s), s);
});

test('unrecognised status is flagged for review', () => {
  const buf = reportWorkbook([{ id: '1', name: 'A', days: [['01-09-2026', '09:00', '19:00', 'On Duty(OD)']] }]);
  const r = calculatePayroll(parseWorkbook(buf));
  assert.equal(r.employees[0].days[0].unknown, true);
  assert.ok(r.warnings.some(w => w.includes('On Duty(OD)')));
});
