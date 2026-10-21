// Builds the salary workbook: Salary Summary, Daily Attendance and Assumptions sheets.
const XLSX = require('xlsx');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}-${MONTHS[m - 1]}-${y}`;
}
// Minutes as decimal hours for Excel (90 -> 1.5).
const hours = mins => Math.round((Number(mins) || 0) / 60 * 100) / 100;
const weekday = iso => WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// '2026-09' -> 'September 2026'
const monthLabel = ym => { const [y, m] = String(ym || '').split('-').map(Number); return m ? `${FULL_MONTHS[m - 1]} ${y}` : 'Attendance'; };

function sheet(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = rows[0].map((_, i) => ({ wch: Math.min(28, Math.max(10, ...rows.map(r => String(r[i] ?? '').length + 2))) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}

function buildWorkbook(report, sourceFile = '') {
  const t = report.totals;
  const summary = [
    ['Employee ID', 'Employee', 'Company', 'Shift', 'Calendar Days', 'Present / Late Days', 'Half Days', 'Absences', 'Off Days',
      'Late Arrivals', 'Missing Punches', 'Allowed Absence Days', 'Excess Absence Days',
      'Monthly Salary ₹', 'Daily Rate ₹', 'Base Salary ₹', 'Attendance Deduction ₹', 'Late Fine / Deduction ₹', 'Missing Punch Fine ₹',
      'Total Fines ₹', 'Advance Deduction ₹', 'Overtime Hours', 'Hourly Rate ₹', 'Overtime Rate ₹/h', 'Overtime Incentive ₹',
      'Paid Leave Days', 'Other Earnings ₹', 'Other Deductions ₹', 'Net Salary ₹', 'Paid On'],
    ...report.employees.map(e => [
      e.id, e.name, e.company_name, `${e.shift_name} (${e.shift_time})`, e.calendar_days, e.present_days, e.half_days, e.absences, e.off_days, e.late_arrivals,
      e.missing_punches, e.allowed_absences, e.excess_absences,
      e.monthly_salary, e.daily_salary, e.base_salary,
      e.attendance_deduction, e.late_fine, e.missing_punch_fine, e.total_fines, e.advance_deduction,
      hours(e.overtime_minutes), e.hourly_rate, e.overtime_rate, e.overtime_incentive,
      e.leave_days || 0, e.extra_earnings || 0, e.extra_deductions || 0, e.net_salary, e.paid_on || '']),
    ['TOTAL', `${report.employees.length} employees`, '', '', '', t.present_days, t.half_days, t.absences, t.off_days,
      t.late_arrivals, t.missing_punches, t.allowed_absences, t.excess_absences, '', '', t.base_salary,
      t.attendance_deduction, t.late_fine, t.missing_punch_fine, t.total_fines, t.advance_deduction,
      hours(t.overtime_minutes), '', '', t.overtime_incentive,
      t.leave_days || 0, t.extra_earnings || 0, t.extra_deductions || 0, t.net_salary, `${t.paid_count || 0} paid`],
  ];

  const advances = [
    ['Employee ID', 'Employee', 'Date Given', 'Advance ₹', 'Monthly Deduction ₹', 'Deduct From', `Deducted ${monthLabel(report.month)} ₹`,
      'Recovered So Far ₹', 'Balance ₹', 'Note'],
  ];
  for (const e of report.employees) {
    for (const a of e.advances) {
      advances.push([e.id, e.name, fmtDate(a.date), a.amount, a.installment, monthLabel(a.start_month), a.deduction, a.recovered, a.balance, a.note || '']);
    }
  }

  const adjustments = [['Employee ID', 'Employee', 'Type', 'Description', 'Amount ₹']];
  for (const e of report.employees) {
    for (const a of e.adjustments || []) adjustments.push([e.id, e.name, a.kind === 'earning' ? 'Earning' : 'Deduction', a.label, a.amount]);
  }

  const daily = [
    ['Employee ID', 'Employee', 'Shift', 'Date', 'Day', 'Clock In', 'Clock Out', 'Total WT', 'Source Status',
      'Attendance Category', 'Late', 'Missing In', 'Missing Out', 'Paid Day Equivalent',
      'Late Fine ₹', 'Missing Punch Fine ₹', 'Worked Hours', 'Overtime Hours', 'Corrected By Hand'],
  ];
  for (const e of report.employees) {
    for (const d of e.days) {
      daily.push([e.id, e.name, e.shift_name, fmtDate(d.date), weekday(d.date), d.clock_in, d.clock_out, d.total_wt, d.status,
        d.category, d.late, d.missing_in, d.missing_out, d.paid, d.late_fine, d.missing_fine,
        d.worked_minutes ? hours(d.worked_minutes) : '', d.ot_minutes ? hours(d.ot_minutes) : '',
        d.corrected ? `was ${d.corrected.was}${d.corrected.note ? ` — ${d.corrected.note}` : ''}` : '']);
    }
  }

  // Rules written out once for the defaults and once for each company with its own rules.
  const ruleRows = r => [
    ['Salary basis', `Base = monthly salary. Daily rate = monthly ÷ ${r.salary_divisor}; hourly rate = daily rate ÷ shift hours.`],
    ['Default monthly salary', `₹${r.monthly_salary} for staff with no salary entered`],
    ['Late arrival', r.late_mode === 'hourly'
      ? `Late time from shift login, rounded up to ${r.late_hour_block} min, deducted at the hourly rate`
      : `₹${r.late_fine} fine per late arrival`],
    ['Missing punch', Number(r.missing_punch_as_leave) ? 'A day with only a clock in or only a clock out is leave (deducted like an absence)'
      : `Present, fined ₹${r.missing_punch_fine} per missing Clock In or Clock Out`],
    ['Working days', Number(r.weekends_working) ? 'Every day incl. weekends and holidays (device "Week Off"/"Holiday" ignored; no punches = absent)' : 'Device "Week Off" days and holidays are paid off days'],
    ['Sunday', `Short day ending ${r.sunday_logout_time}; leaving from then is a full day`],
    ['Absences', Number(r.allowed_absences) ? `First ${r.allowed_absences} full absences paid; the rest deducted at daily rate` : 'Every absence deducted at daily rate'],
    ['Half day', `Deduct ${r.half_day_deduction} day at daily rate`],
    ['Overtime incentive', Number(r.overtime_pay)
      ? `Clock out after logout (Sunday: after ${r.sunday_logout_time}): from ${r.overtime_min_minutes} min past logout, counted every ${r.overtime_block_minutes} min, paid ${r.overtime_mode === 'fixed' ? `₹${r.overtime_fixed_rate} per hour` : 'at the hourly rate'}`
      : 'Not paid'],
  ];
  const assumptions = [
    ['Setting', 'Value used'],
    ['Company', report.company || '-'],
    ['Period', `${report.period.from || '?'} to ${report.period.to || '?'} (${report.calendar_days} days)`],
    ['Source workbook', sourceFile || '-'],
    ...report.shifts.map(s => [`Shift: ${s.name}`, `Login ${s.login_time}, logout ${s.logout_time}, grace ${s.grace_minutes} min`]),
    ['Early leave', 'Not marked or fined'],
    ['Advances', 'Monthly deduction from the chosen month until the advance is repaid; deducted after fines'],
    [],
    ['DEFAULT RULES', 'Staff with no company, or whose company uses the defaults'],
    ...ruleRows(report.rules),
    ...Object.values(report.companies || {}).filter(c => c.rules).flatMap(c => [[], [`${c.name.toUpperCase()} RULES`, 'Own salary rules for this company'], ...ruleRows(c.rules)]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(summary), 'Salary Summary');
  XLSX.utils.book_append_sheet(wb, sheet(daily), 'Daily Attendance');
  if (advances.length > 1) XLSX.utils.book_append_sheet(wb, sheet(advances), 'Advances');
  if (adjustments.length > 1) XLSX.utils.book_append_sheet(wb, sheet(adjustments), 'Adjustments');
  XLSX.utils.book_append_sheet(wb, sheet(assumptions), 'Assumptions');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Bulk salary transfer file for one company: a "Transfers" sheet with one row per employee of that company in
 * the current sheet — amount = net salary, bank details from the Staff page (left blank when not entered, so
 * the row can be completed in Excel) — and a "Summary" sheet with the debit account and total.
 * Payment mode is IFT (same bank) when the employee's IFSC bank code matches the company's, else NEFT.
 */
function buildBankTransfer(report, settings, companyId) {
  const company = settings.companies[companyId];
  const label = monthLabel(report.month);
  const narration = `Salary ${label}`.slice(0, 30);
  const bankCode = ifsc => String(ifsc || '').slice(0, 4);
  const rows = [['Sr No', 'Beneficiary Name', 'Beneficiary Account No', 'IFSC Code', 'Amount', 'Payment Mode',
    'Debit Account No', 'Narration', 'Employee ID']];
  let total = 0, missing = 0;
  for (const e of report.employees.filter(x => x.company_id === companyId)) {
    const s = settings.staff[e.id] || {};
    const amount = Math.round(e.net_salary * 100) / 100;
    total += amount;
    if (!s.bank_account_number || !s.bank_ifsc) missing++;
    rows.push([rows.length, s.bank_account_name || e.name, String(s.bank_account_number || ''), s.bank_ifsc || '', amount,
      company.ifsc && s.bank_ifsc && bankCode(s.bank_ifsc) === bankCode(company.ifsc) ? 'IFT' : 'NEFT',
      String(company.account_number || ''), narration, e.id]);
  }
  const transfers = sheet(rows);
  delete transfers['!autofilter']; // bank upload tools expect a plain table
  // Keep account numbers as text so Excel never shows them as 1.23E+13 or drops leading zeros.
  for (let r = 1; r < rows.length; r++) {
    for (const c of [2, 6]) { const cell = transfers[XLSX.utils.encode_cell({ r, c })]; if (cell) { cell.t = 's'; cell.z = '@'; } }
  }
  const summary = [
    ['Field', 'Value'],
    ['Company', company.name],
    ['Salary month', label],
    ['Debit bank', company.bank_name || ''],
    ['Debit account name', company.account_name || company.name],
    ['Debit account no', String(company.account_number || '')],
    ['Debit IFSC', company.ifsc || ''],
    ['Employees', rows.length - 1],
    ['Total amount ₹', Math.round(total * 100) / 100],
    ['Missing bank details', missing],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, transfers, 'Transfers');
  XLSX.utils.book_append_sheet(wb, sheet(summary), 'Summary');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildWorkbook, buildBankTransfer, monthLabel };
