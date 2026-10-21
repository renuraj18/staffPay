// Reports across the saved months: salary cost per month and company, and who is most often late/absent.

// reports: [{month, report}] in any order. Returns {months: [...oldest first], people_month, people_all}.
function buildReports(entries, activeMonth) {
  const sorted = [...entries].filter(x => x.report).sort((a, b) => a.month.localeCompare(b.month));
  const months = sorted.map(({ month, report: r, locked }) => {
    const byCompany = {};
    for (const e of r.employees) {
      const name = e.company_name || 'No company';
      byCompany[name] = (byCompany[name] || 0) + e.net_salary;
    }
    const t = r.totals;
    return {
      month, locked: Boolean(locked), employees: r.employees.length,
      base: t.base_salary, net: t.net_salary, attendance_deduction: t.attendance_deduction, fines: t.total_fines,
      advance_deduction: t.advance_deduction, overtime: t.overtime_incentive, overtime_minutes: t.overtime_minutes,
      extra_earnings: t.extra_earnings || 0, extra_deductions: t.extra_deductions || 0,
      absences: t.absences, late: t.late_arrivals, paid_count: t.paid_count || 0,
      by_company: byCompany,
    };
  });
  const people = list => {
    const map = {};
    for (const { report } of list) {
      for (const e of report.employees) {
        const p = map[e.id] ||= { id: e.id, name: e.name, months: 0, absences: 0, late: 0, half_days: 0, overtime_minutes: 0, net: 0 };
        p.name = e.name;
        p.months++;
        p.absences += e.absences;
        p.late += e.late_arrivals;
        p.half_days += e.half_days;
        p.overtime_minutes += e.overtime_minutes;
        p.net += e.net_salary;
      }
    }
    return Object.values(map);
  };
  return {
    months,
    people_month: people(sorted.filter(x => x.month === activeMonth)),
    people_all: people(sorted),
  };
}

module.exports = { buildReports };
