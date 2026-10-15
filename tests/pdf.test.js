const test = require('node:test');
const assert = require('node:assert/strict');
const { pdfToSheets } = require('../lib/pdf');
const { parseSheets } = require('../lib/payroll');

// Minimal one-page-per-employee PDF: each page is a list of [x, y, text] (points, y from the top).
function buildPdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const items of pages) {
    const esc = s => s.replace(/[\\()]/g, m => `\\${m}`);
    const stream = items.map(([x, y, t]) => `BT /F1 8 Tf ${x} ${842 - y} Td (${esc(t)}) Tj ET`).join('\n');
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const COLS = [40, 110, 170, 230, 290, 350, 420]; // Date, Check In, Check Out, Clock In, Clock Out, Actual WT, Status
const HEAD = ['Date', 'Check In', 'Check Out', 'Clock In', 'Clock Out', 'Actual WT', 'Status'];
function reportPage(id, name, days) {
  const items = [
    [180, 20, 'Daily Attendance Report(Detailed Report)'],
    [200, 32, 'September 01 2026 To September 30 2026'],
    [20, 44, 'Company:'], [300, 44, 'Generated On: Thu Oct 15 2026 13:13:03'],
    [20, 56, `Employee Name: ${name} , Employee ID: ${id}, Gender: Male, Department: X`],
    ...HEAD.map((h, i) => [COLS[i], 70, h]),
  ];
  days.forEach((cells, r) => cells.forEach((c, i) => { if (c) items.push([COLS[i], 82 + r * 10, c]); }));
  items.push([40, 82 + days.length * 10, 'Total']);
  return items;
}

test('PDF report: one employee per page, cells placed by column position', async () => {
  const buf = buildPdf([
    reportPage('1', 'ASHA', [
      ['01-09-2026', '08:30', '21:30', '09:38', '19:53', '10:15', 'Late(LT)'],
      ['03-09-2026', '08:30', '21:30', '', '20:13', '13:00', 'Early Leave(EL)'],
      ['05-09-2026', '08:30', '21:30', '', '', '', 'Leave(LE)'],
    ]),
    reportPage('10', 'RAVI KUMAR', [['01-09-2026', '08:30', '21:30', '09:41', '', '', 'Late(LT)']]),
  ]);
  const p = parseSheets(await pdfToSheets(buf));
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(p.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(p.employees.map(e => [e.id, e.name, e.days.length]), [['1', 'ASHA', 3], ['10', 'RAVI KUMAR', 1]]);
  assert.deepEqual(p.employees[0].days[0], { date: '2026-09-01', clock_in: '09:38', clock_out: '19:53', total_wt: '10:15', status: 'Late(LT)' });
  assert.deepEqual(p.employees[0].days[1], { date: '2026-09-03', clock_in: '', clock_out: '20:13', total_wt: '13:00', status: 'Early Leave(EL)' });
  assert.equal(p.employees[1].days[0].clock_in, '09:41');
  assert.equal(p.employees[1].days[0].clock_out, '');
});

test('PDF page without an employee header continues the previous employee', async () => {
  const cont = reportPage('', '', [['02-09-2026', '08:30', '21:30', '09:10', '19:00', '09:50', 'Present(P)']])
    .filter(([, , t]) => !t.startsWith('Employee Name'));
  const buf = buildPdf([reportPage('1', 'ASHA', [['01-09-2026', '08:30', '21:30', '09:00', '19:00', '10:00', 'Present(P)']]), cont]);
  const p = parseSheets(await pdfToSheets(buf));
  assert.equal(p.employees.length, 1);
  assert.deepEqual(p.employees[0].days.map(d => d.date), ['2026-09-01', '2026-09-02']);
});
