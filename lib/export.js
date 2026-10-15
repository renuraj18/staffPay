// Builds the salary workbook: Salary Summary, Daily Attendance and Assumptions sheets.
const XLSX = require('xlsx');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}-${MONTHS[m - 1]}-${y}`;
}
const weekday = iso => WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()];

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
    ['Employee ID', 'Employee', 'Shift', 'Calendar Days', 'Present / Late Days', 'Half Days', 'Absences', 'Off Days',
      'Late Arrivals', 'Missing Punches', 'Allowed Absence Days', 'Excess Absence Days',
      'Monthly Salary ₹', 'Daily Rate ₹', 'Base Salary ₹', 'Attendance Deduction ₹', 'Late Fine ₹', 'Missing Punch Fine ₹',
      'Total Fines ₹', 'Net Salary ₹'],
    ...report.employees.map(e => [
      e.id, e.name, `${e.shift_name} (${e.shift_time})`, e.calendar_days, e.present_days, e.half_days, e.absences, e.off_days, e.late_arrivals,
      e.missing_punches, e.allowed_absences, e.excess_absences,
      e.monthly_salary, e.daily_salary, e.base_salary,
      e.attendance_deduction, e.late_fine, e.missing_punch_fine, e.total_fines, e.net_salary]),
    ['TOTAL', `${report.employees.length} employees`, '', '', t.present_days, t.half_days, t.absences, t.off_days,
      t.late_arrivals, t.missing_punches, t.allowed_absences, t.excess_absences, '', '', t.base_salary,
      t.attendance_deduction, t.late_fine, t.missing_punch_fine, t.total_fines, t.net_salary],
  ];

  const daily = [
    ['Employee ID', 'Employee', 'Shift', 'Date', 'Day', 'Clock In', 'Clock Out', 'Total WT', 'Source Status',
      'Attendance Category', 'Late', 'Missing In', 'Missing Out', 'Paid Day Equivalent',
      'Late Fine ₹', 'Missing Punch Fine ₹'],
  ];
  for (const e of report.employees) {
    for (const d of e.days) {
      daily.push([e.id, e.name, e.shift_name, fmtDate(d.date), weekday(d.date), d.clock_in, d.clock_out, d.total_wt, d.status,
        d.category, d.late, d.missing_in, d.missing_out, d.paid, d.late_fine, d.missing_fine]);
    }
  }

  const r = report.rules;
  const assumptions = [
    ['Setting', 'Value used'],
    ['Company', report.company || '-'],
    ['Period', `${report.period.from || '?'} to ${report.period.to || '?'} (${report.calendar_days} days)`],
    ['Source workbook', sourceFile || '-'],
    ['Salary basis', `Base = monthly salary. Daily rate = monthly ÷ ${r.salary_divisor}, used for absence and half day deductions.`],
    ['Default monthly salary', `₹${r.monthly_salary} for staff with no salary mapped`],
    ...report.shifts.map(s => [`Shift: ${s.name}`, `Login ${s.login_time}, logout ${s.logout_time}, grace ${s.grace_minutes} min`]),
    ['Late fine', `₹${r.late_fine} per late arrival`],
    ['Missing punch fine', `₹${r.missing_punch_fine} per missing Clock In or Clock Out on a workday`],
    ['Weekends', Number(r.weekends_working) ? 'Saturday and Sunday are working days (device "Week Off" ignored; no punches = absent)' : 'Device "Week Off" days are paid off days'],
    ['Sunday', `Short day ending ${r.sunday_logout_time}; leaving from then is a full day (no half day deduction)`],
    ['Early leave', 'Not marked or fined'],
    ['Absence allowance', `First ${r.allowed_absences} full absences paid; excess deducted at daily rate`],
    ['Half day', `Deduct ${r.half_day_deduction} day at daily rate`],
    ['Holidays', 'Paid; no late or missing punch fines'],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(summary), 'Salary Summary');
  XLSX.utils.book_append_sheet(wb, sheet(daily), 'Daily Attendance');
  XLSX.utils.book_append_sheet(wb, sheet(assumptions), 'Assumptions');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildWorkbook };
