const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parseWorkbook, classifyDay, calculatePayroll, normalizeSettings, advanceForMonth, advanceSchedule, resolveStaffIds, renumberDuplicateIds, DEFAULT_RULES, DEFAULT_SHIFT, SETTINGS_VERSION } = require('../lib/payroll');
const { unzipSync } = require('fflate');
const { buildSlipPdf, buildSlipsZip } = require('../lib/slip');
const { buildBankTransfer } = require('../lib/export');

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

// Rules before version 3: 2 paid absences, Sunday ends 14:30, a single punch is present + fine, no overtime.
const OLD = { ...DEFAULT_RULES, allowed_absences: 2, sunday_logout_time: '14:30', missing_punch_as_leave: 0, overtime_pay: 0 };

test('old rules: missing Clock In or Clock Out on a workday is a missing punch, not an absence', () => {
  const d = classifyDay(day('', '19:30', 'Present(P)'), OLD);
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
  const halfPunch = classifyDay(on('2026-09-05', '09:20', '', 'Week Off(WO)'), OLD);
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

test('old rules: Sunday: leaving at the Sunday finish time is a full day, not a half day', () => {
  const sun = classifyDay(on('2026-09-06', '09:20', '14:30', 'Half Day(HD)'), OLD);
  assert.equal(sun.half, 0);
  assert.equal(sun.paid, 1);
  const tooEarly = classifyDay(on('2026-09-06', '09:20', '12:00', 'Half Day(HD)'), OLD);
  assert.equal(tooEarly.half, 1);
  const monday = classifyDay(on('2026-09-07', '09:20', '14:30', 'Half Day(HD)'), OLD);
  assert.equal(monday.half, 1);
});

test('old rules: clock-out with no clock-in is Present with a missing punch fine, never late', () => {
  const shift = { ...DEFAULT_SHIFT, login_time: '09:30', logout_time: '20:00' };
  const d = classifyDay(on('2026-09-01', '', '20:12', 'Present(P)'), OLD, shift);
  assert.equal(d.category, 'Present');
  assert.equal(d.late, 0);
  assert.equal(d.missing_in, 1);
  assert.equal(d.missing_fine, 50);
});

test('old rules: a lone evening punch in the Clock In column is read as the log-off', () => {
  const shift = { ...DEFAULT_SHIFT, login_time: '09:30', logout_time: '20:00' };
  // Device marked this Absent; the only punch (19:23) is a log-off.
  const d = classifyDay(on('2026-09-10', '19:23', '', 'Absent(A)'), OLD, shift);
  assert.equal(d.category, 'Present');
  assert.equal(d.absent, 0);
  assert.equal(d.late, 0);
  assert.equal(d.clock_in, '');
  assert.equal(d.clock_out, '19:23');
  assert.equal(d.moved, 1);
  assert.equal(d.missing_in, 1);
  assert.equal(d.missing_fine, 50);
});

test('old rules: a lone morning punch is still a clock-in: late if after login, fined for missing clock-out', () => {
  const shift = { ...DEFAULT_SHIFT, login_time: '09:30', logout_time: '20:00' };
  const d = classifyDay(on('2026-09-01', '09:45', '', 'Late(LT)'), OLD, shift);
  assert.equal(d.late, 1);
  assert.equal(d.missing_out, 1);
  assert.equal(d.moved, 0);
});

test('old rules: Sunday: a lone afternoon punch after the Sunday midpoint is the log-off', () => {
  // Sunday 09:30–14:30 → midpoint 12:00.
  const d = classifyDay(on('2026-09-06', '14:20', '', 'Week Off(WO)'), OLD, { ...DEFAULT_SHIFT, login_time: '09:30' });
  assert.equal(d.clock_out, '14:20');
  assert.equal(d.late, 0);
  assert.equal(d.category, 'Present');
});

test('absent days get no late or missing punch fines', () => {
  const d = classifyDay(day('09:45', '', 'Absent(A)'), DEFAULT_RULES);
  assert.equal(d.late + d.missing, 0);
});

const V2 = { version: SETTINGS_VERSION };

test('old rules: salary: base is the default monthly; excess absences and half days deducted at monthly ÷ 30.5', () => {
  const days = [
    ['01-09-2026', '09:20', '19:40', 'Present(P)'],
    ['02-09-2026', '09:45', '19:40', 'Late(LT)'],      // late fine 50
    ['03-09-2026', '09:10', '', 'Present(P)'],         // missing out fine 50
    ['04-09-2026', '', '', 'Absent(A)'],
    ['05-09-2026', '', '', 'Absent(A)'],
    ['06-09-2026', '', '', 'Absent(A)'],               // 1 excess absence -> 500
    ['07-09-2026', '09:00', '14:00', 'Half Day(HD)'],  // half day -> 250
  ];
  const r = calculatePayroll(parseWorkbook(reportWorkbook([{ id: '1', name: 'A', days }])), { ...V2, rules: OLD });
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
    { ...V2, rules: OLD, staff: { 1: { salary: 18300 } } }).employees[0];
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
  const r = calculatePayroll(parseWorkbook(reportWorkbook([{ id: '1', name: 'A', days }])), { ...V2, rules: OLD, staff: { 1: { salary: 10000 } } });
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

test('Leave (LE) is an absence without punches and a workday with them', () => {
  const leave = classifyDay(day('', '', 'Leave(LE)'), DEFAULT_RULES);
  assert.equal(leave.absent, 1);
  assert.equal(leave.unknown, false);
  const worked = classifyDay(day('09:20', '19:40', 'Leave(LE)'), DEFAULT_RULES);
  assert.equal(worked.absent, 0);
  assert.equal(worked.paid, 1);
});

test('advance is recovered at the monthly deduction from its start month until repaid', () => {
  const adv = { amount: 5000, installment: 2000, start_month: '2026-09' };
  assert.deepEqual(advanceForMonth(adv, '2026-08'), { deduction: 0, recovered: 0, balance: 5000 });
  assert.deepEqual(advanceForMonth(adv, '2026-09'), { deduction: 2000, recovered: 2000, balance: 3000 });
  assert.deepEqual(advanceForMonth(adv, '2026-11'), { deduction: 1000, recovered: 5000, balance: 0 });
  assert.deepEqual(advanceForMonth(adv, '2026-12'), { deduction: 0, recovered: 5000, balance: 0 });
  assert.deepEqual(advanceForMonth(adv, '2027-01'), { deduction: 0, recovered: 5000, balance: 0 }, 'year rollover');
});

test('a month override changes that month and pushes the rest of the schedule', () => {
  const adv = { amount: 5000, installment: 2000, start_month: '2026-11', overrides: { '2026-12': 0 } };
  assert.equal(advanceForMonth(adv, '2026-12').deduction, 0, 'skipped');
  assert.deepEqual(advanceForMonth(adv, '2027-01'), { deduction: 2000, recovered: 4000, balance: 1000 });
  assert.equal(advanceForMonth({ ...adv, overrides: { '2026-11': 9999 } }, '2026-11').deduction, 5000, 'never more than the balance');
});

test('salary: advance deduction for the sheet month comes off the net salary', () => {
  const days = [['01-09-2026', '09:20', '19:40', 'Present(P)']];
  const r = calculatePayroll(parseWorkbook(reportWorkbook([{ id: '1', name: 'A', days }, { id: '2', name: 'B', days }])), {
    ...V2,
    advances: {
      a1: { emp_id: '1', date: '2026-08-20', amount: 3000, installment: 1000, start_month: '2026-08' },
      a2: { emp_id: '1', date: '2026-09-05', amount: 500, installment: 500, start_month: '2026-10' }, // not started
    },
  });
  const [a, b] = r.employees;
  assert.equal(r.month, '2026-09');
  assert.equal(a.advance_deduction, 1000);
  assert.equal(a.advance_balance, 1000 + 500);
  assert.deepEqual(a.advances.map(x => [x.id, x.deduction]), [['a2', 0], ['a1', 1000]], 'upcoming advance listed, not deducted');
  assert.equal(a.net_salary, 15250 - 1000);
  assert.equal(b.advance_deduction, 0);
  assert.equal(r.totals.advance_deduction, 1000);
});

test('advance schedule lists every month until repaid, with overrides', () => {
  const rows = advanceSchedule({ amount: 5000, installment: 2000, start_month: '2026-12', overrides: { '2027-01': 0 } });
  assert.deepEqual(rows.map(r => [r.month, r.deduction, r.balance, r.overridden]), [
    ['2026-12', 2000, 3000, false], ['2027-01', 0, 3000, true], ['2027-02', 2000, 1000, false], ['2027-03', 1000, 0, false],
  ]);
});

test('salary slips: one PDF per employee, zipped as "<Name> - <Month YYYY>.pdf"', async () => {
  const days = [['01-09-2026', '09:45', '19:40', 'Late(LT)'], ['02-09-2026', '', '', 'Absent(A)'], ['03-09-2026', '', '19:30', 'Absent(A)']];
  const r = calculatePayroll(parseWorkbook(reportWorkbook([{ id: '1', name: 'ASHA', days }, { id: '2', name: 'ASHA', days }, { id: '3', name: 'RAVI/K', days }])), {
    ...V2, advances: { a1: { emp_id: '1', date: '2026-09-01', amount: 2000, installment: 500, start_month: '2026-09' } },
  });
  const pdf = Buffer.from(await buildSlipPdf(r, r.employees[0]));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const files = unzipSync(await buildSlipsZip(r));
  assert.deepEqual(Object.keys(files).sort(), ['ASHA - September 2026 (2).pdf', 'ASHA - September 2026.pdf', 'RAVI K - September 2026.pdf']);
  for (const f of Object.values(files)) assert.equal(Buffer.from(f.subarray(0, 5)).toString(), '%PDF-');
});

test('bank transfer sheet: one company, staff with bank details, paid from the company account', () => {
  const days = [['01-09-2026', '09:20', '19:40', 'Present(P)']];
  const settings = normalizeSettings({
    ...V2,
    companies: { a: { name: 'Firm A', account_number: '111122223333', ifsc: 'HDFC0000001' }, b: { name: 'Firm B' } },
    staff: {
      1: { name: 'ASHA', company_id: 'a', salary: 12000, bank_account_number: '0012345678', bank_ifsc: 'HDFC0000999' },
      2: { name: 'RAVI', company_id: 'a', bank_account_name: 'RAVI KUMAR', bank_account_number: '55556666', bank_ifsc: 'SBIN0001234' },
      3: { name: 'MANI', company_id: 'a' },                          // no bank details
      4: { name: 'GONE', company_id: 'b', bank_account_number: '1', bank_ifsc: 'SBIN0001234' },
      5: { name: 'X', company_id: 'deleted' },
    },
  });
  assert.equal(settings.staff[5].company_id, undefined, 'unknown company is dropped');
  const parsed = parseWorkbook(reportWorkbook(['1', '2', '3', '4'].map(id => ({ id, name: settings.staff[id].name, days }))));
  const r = calculatePayroll(parsed, settings);
  assert.equal(r.employees[0].company_name, 'Firm A');
  const wb = XLSX.read(buildBankTransfer(r, settings, 'a'), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Transfers, { header: 1, defval: '' });
  assert.deepEqual(rows.slice(1), [
    [1, 'ASHA', '0012345678', 'HDFC0000999', 12000, 'IFT', '111122223333', 'Salary September 2026', '1'],
    [2, 'RAVI KUMAR', '55556666', 'SBIN0001234', 15250, 'NEFT', '111122223333', 'Salary September 2026', '2'],
    [3, 'MANI', '', '', 15250, 'NEFT', '111122223333', 'Salary September 2026', '3'], // bank details blank, salary filled
  ]);
  assert.equal(wb.SheetNames.includes('Not included'), false);
  const summary = Object.fromEntries(XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1 }).slice(1));
  assert.equal(summary['Total amount ₹'], 42500);
  assert.equal(summary['Missing bank details'], 1);
});

test('a new sheet never takes over another person saved with the same employee ID', () => {
  const staff = {
    2: { name: 'SAMUVEL', salary: 12000 },
    3: { name: 'M SANJAY' },
    '4': { name: 'NANDHA' }, '4_1': { name: 'SUDHARSAN', device_id: '4' },
  };
  const parsed = { warnings: [], employees: [
    { id: '2', name: 'SARAVANAN' },   // same ID, different person
    { id: '3', name: 'Sanjay M.' },   // same person, name written differently
    { id: '4', name: 'SUDHARSAN' },   // matches the earlier separate record
    { id: '9', name: 'NEW' },
  ] };
  resolveStaffIds(staff, parsed);
  assert.deepEqual(parsed.employees.map(e => [e.id, e.device_id]), [['2_1', '2'], ['3', '3'], ['4_1', '4'], ['9', '9']]);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /SAMUVEL is already saved with ID 2 — added SARAVANAN as employee 2_1/);
});

test('two people with the same ID in one sheet: the second becomes <id>_1, the third <id>_2', () => {
  const parsed = { warnings: [], employees: [
    { id: '5', name: 'ASHA' }, { id: '5', name: 'RAVI' }, { id: '7', name: 'MEENA' }, { id: '5', name: 'KUMAR' },
  ] };
  resolveStaffIds({}, parsed);
  assert.deepEqual(parsed.employees.map(e => [e.id, e.device_id]), [['5', '5'], ['5_1', '5'], ['7', '7'], ['5_2', '5']]);
  assert.match(parsed.warnings[0], /ASHA also has ID 5 in this sheet — added RAVI as employee 5_1/);
  assert.match(parsed.warnings[1], /ASHA, RAVI also has ID 5 in this sheet — added KUMAR as employee 5_2/);
  // Uploading the same sheet again finds the same records.
  const staff = Object.fromEntries(parsed.employees.map(e => [e.id, { name: e.name, ...(e.id !== e.device_id && { device_id: e.device_id }) }]));
  const again = { warnings: [], employees: ['ASHA', 'RAVI', 'KUMAR'].map(name => ({ id: '5', name })) };
  resolveStaffIds(staff, again);
  assert.deepEqual(again.employees.map(e => e.id), ['5', '5_1', '5_2']);
  assert.equal(again.warnings.length, 0);
});

test('settings v5 renumbers old "<id>_2" duplicate keys to "<id>_1"', () => {
  const settings = {
    staff: {
      4: { name: 'NANDHA' }, '4_2': { name: 'SUDHARSAN', device_id: '4', salary: 9000 }, '4_3': { name: 'X', device_id: '4' },
      6: { name: 'A' }, '6_1': { name: 'B', device_id: '6' }, '6_2': { name: 'C', device_id: '6' },  // already new style
      '8_2': { name: 'not a duplicate key', device_id: '8_2' },
    },
    advances: { a1: { emp_id: '4_2' }, a2: { emp_id: '6' } },
  };
  const renames = renumberDuplicateIds(settings);
  assert.deepEqual(renames, { '4_2': '4_1', '4_3': '4_2' });
  assert.deepEqual(Object.keys(settings.staff).sort(), ['4', '4_1', '4_2', '6', '6_1', '6_2', '8_2']);
  assert.equal(settings.staff['4_1'].salary, 9000);
  assert.equal(settings.advances.a1.emp_id, '4_1');
});

// ---------- Version 3 salary rules ----------
const SHIFT = { ...DEFAULT_SHIFT, login_time: '09:30', logout_time: '20:00', grace_minutes: 0 }; // 10.5 h

test('only a clock in or only a clock out is leave: deducted, no fines', () => {
  for (const [ci, co, status] of [['', '20:12', 'Present(P)'], ['09:20', '', 'Present(P)'], ['19:23', '', 'Absent(A)']]) {
    const d = classifyDay(on('2026-09-01', ci, co, status), DEFAULT_RULES, SHIFT);
    assert.equal(d.absent, 1, `${ci}-${co}`);
    assert.equal(d.category, 'Absent');
    assert.equal(d.missing, 1);
    assert.equal(d.late_fine + d.missing_fine, 0);
  }
});

test('every day is a working day: holidays and week offs without punches are absences', () => {
  assert.equal(classifyDay(on('2026-09-02', '', '', 'Holiday(H)'), DEFAULT_RULES, SHIFT).absent, 1);
  assert.equal(classifyDay(on('2026-09-02', '09:20', '20:00', 'Holiday(H)'), DEFAULT_RULES, SHIFT).paid, 1);
  assert.equal(classifyDay(on('2026-09-06', '', '', 'Week Off(WO)'), DEFAULT_RULES, SHIFT).absent, 1);
});

test('Sunday ends at 15:00: leaving then is a full day, later is overtime', () => {
  const full = classifyDay(on('2026-09-06', '09:30', '15:00', 'Half Day(HD)'), DEFAULT_RULES, SHIFT);
  assert.equal(full.half, 0);
  assert.equal(full.ot_minutes, 0);
  const longer = classifyDay(on('2026-09-06', '09:30', '18:00', 'Weekoff Present(WOP)'), DEFAULT_RULES, SHIFT);
  assert.equal(longer.ot_minutes, 180); // 3 h beyond 09:30–15:00
});

test('overtime: from logout, minimum 1 hour, then every 30 minutes', () => {
  const ot = (ci, co, rules = DEFAULT_RULES) => classifyDay(on('2026-09-01', ci, co, 'Present(P)'), rules, SHIFT).ot_minutes; // logout 20:00
  assert.equal(ot('09:30', '20:59'), 0, 'under the 1 hour minimum');
  assert.equal(ot('09:30', '21:00'), 60);
  assert.equal(ot('09:30', '21:29'), 60, 'next 30 min block not complete');
  assert.equal(ot('09:30', '21:35'), 90);
  assert.equal(ot('09:30', '22:10'), 120);
  assert.equal(ot('10:00', '21:00'), 60, 'counted from logout, not hours worked');
  assert.equal(ot('09:30', '00:30'), 270, 'clock out after midnight');
  assert.equal(ot('09:30', '21:40', { ...DEFAULT_RULES, overtime_min_minutes: 30, overtime_block_minutes: 15 }), 90);
  assert.equal(ot('09:30', '21:00', { ...DEFAULT_RULES, overtime_pay: 0 }), 0);
});

test('salary: every absence deducted; overtime paid at daily rate ÷ shift hours', () => {
  const days = [
    ['01-09-2026', '09:30', '22:00', 'Present(P)'],  // 2 h overtime (12.5 h on a 10.5 h shift)
    ['02-09-2026', '', '', 'Absent(A)'],              // deducted
    ['03-09-2026', '09:20', '', 'Present(P)'],       // leave: deducted
  ];
  const r = calculatePayroll(parseWorkbook(reportWorkbook([{ id: '1', name: 'A', days }])), {
    version: SETTINGS_VERSION, shifts: [SHIFT], staff: { 1: { salary: 21000 } },
  });
  const e = r.employees[0];
  // daily = 21000 / 30.5 = 688.52; hourly = 688.52 / 10.5 = 65.57
  assert.equal(e.absences, 2);
  assert.equal(e.excess_absences, 2);
  assert.equal(e.attendance_deduction, 1377);
  assert.equal(e.hourly_rate, 65.57);
  assert.equal(e.overtime_minutes, 120);
  assert.equal(e.overtime_incentive, 131);
  assert.equal(e.net_salary, 21000 - 1377 + 131);
});

test('settings saved before version 3 switch to the new absence and Sunday rules once', () => {
  const s = normalizeSettings({ version: 2, rules: { allowed_absences: 2, sunday_logout_time: '14:30', late_fine: 20 } });
  assert.equal(s.version, SETTINGS_VERSION);
  assert.equal(s.rules.allowed_absences, 0);
  assert.equal(s.rules.sunday_logout_time, '15:00');
  assert.equal(s.rules.late_fine, 20);
  assert.equal(s.rules.missing_punch_as_leave, 1);
  // Once on version 3, the user's own choices are kept.
  assert.equal(normalizeSettings({ ...s, rules: { ...s.rules, allowed_absences: 1 } }).rules.allowed_absences, 1);
});

// ---------- Late as hourly cut, per-company rules ----------
test('late as hourly cut: late time from login rounded up to the block, deducted at the hourly rate', () => {
  const rules = { ...DEFAULT_RULES, late_mode: 'hourly', late_hour_block: 60 };
  const shift = { ...SHIFT, login_time: '09:00', logout_time: '19:00', grace_minutes: 10 };
  assert.equal(classifyDay(on('2026-09-01', '09:15', '19:00', 'Late(LT)'), rules, shift).late_hours, 1, '15 min late = 1 hour');
  assert.equal(classifyDay(on('2026-09-01', '10:05', '19:00', 'Late(LT)'), rules, shift).late_hours, 2, '65 min late = 2 hours');
  assert.equal(classifyDay(on('2026-09-01', '09:08', '19:00', 'Late(LT)'), rules, shift).late, 0, 'within grace');
  assert.equal(classifyDay(on('2026-09-01', '09:15', '19:00', 'Late(LT)'), { ...rules, late_hour_block: 30 }, shift).late_hours, 0.5);
  const d = classifyDay(on('2026-09-01', '09:15', '19:00', 'Late(LT)'), rules, shift);
  assert.equal(d.late_fine, 0, 'no fixed fine in hourly mode');
});

test('each company can have its own salary rules; others use the defaults', () => {
  const days = [['01-09-2026', '09:15', '19:00', 'Late(LT)'], ['02-09-2026', '09:00', '', 'Present(P)']];
  const shift = { ...SHIFT, id: 's', login_time: '09:00', logout_time: '19:00' };  // 10 h
  const settings = normalizeSettings({
    version: SETTINGS_VERSION, shifts: [shift],
    rules: { late_fine: 50, missing_punch_as_leave: 1 },
    companies: {
      a: { name: 'A', rules: { late_mode: 'hourly', missing_punch_as_leave: 0, missing_punch_fine: 100 } },
      b: { name: 'B' },
    },
    staff: { 1: { company_id: 'a', salary: 30500 }, 2: { company_id: 'b', salary: 30500 } },
  });
  assert.equal(settings.companies.a.rules.salary_divisor, 30.5, 'own rules are filled from the defaults');
  const r = calculatePayroll(parseWorkbook(reportWorkbook([{ id: '1', name: 'A1', days }, { id: '2', name: 'B1', days }])), settings);
  const [a, b] = r.employees;
  // daily 1000, hourly 100: 1 h late cut; missing punch is a ₹100 fine, not leave
  assert.equal(a.rules_name, 'A');
  assert.equal(a.late_fine, 100);
  assert.equal(a.missing_punch_fine, 100);
  assert.equal(a.absences, 0);
  // defaults: ₹50 late fine; missing punch = leave (1 day deducted)
  assert.equal(b.rules_name, 'Default');
  assert.equal(b.late_fine, 50);
  assert.equal(b.absences, 1);
  assert.equal(b.attendance_deduction, 1000);
});

test('settings saved before version 4 move to overtime from logout: 60 min minimum, 30 min blocks', () => {
  const s = normalizeSettings({ version: 3, rules: { overtime_min_minutes: 30 }, companies: { a: { name: 'A', rules: { overtime_min_minutes: 30, late_fine: 5 } } } });
  assert.equal(s.rules.overtime_min_minutes, 60);
  assert.equal(s.rules.overtime_block_minutes, 30);
  assert.equal(s.companies.a.rules.overtime_min_minutes, 60);
  assert.equal(s.companies.a.rules.late_fine, 5);
  const again = normalizeSettings({ ...s, rules: { ...s.rules, overtime_min_minutes: 45 } });
  assert.equal(again.rules.overtime_min_minutes, 45, 'user changes after the upgrade are kept');
});

test('overtime paid at a fixed rate per hour instead of the hourly rate', () => {
  const days = [['01-09-2026', '09:30', '21:35', 'Present(P)']]; // 1.5 h after 20:00 logout
  const run = rules => calculatePayroll(parseWorkbook(reportWorkbook([{ id: '1', name: 'A', days }])), {
    version: SETTINGS_VERSION, shifts: [SHIFT], rules, staff: { 1: { salary: 21000 } },
  }).employees[0];
  assert.equal(run({}).overtime_incentive, Math.round(1.5 * 65.57));
  const fixed = run({ overtime_mode: 'fixed', overtime_fixed_rate: 80 });
  assert.equal(fixed.overtime_rate, 80);
  assert.equal(fixed.overtime_incentive, 120);
});
