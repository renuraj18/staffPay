// One-page A4 salary & attendance slip per employee (PDF), and a ZIP with every employee's slip.
// Uses pdf-lib's built-in Helvetica (no font files to package), so amounts are written "Rs." — the
// standard PDF fonts have no ₹ glyph.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { zipSync } = require('fflate');
const { monthLabel } = require('./export');

const W = 595.28, H = 841.89, M = 36;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const C = {
  ink: '#0f172a', text2: '#334155', muted: '#64748b', faint: '#94a3b8', line: '#e2e8f0', soft: '#f8fafc',
  accent: '#4f46e5', accentSoft: '#eef0ff', onAccent: '#c7d2fe', white: '#ffffff',
  bad: '#dc2626', good: '#047857', warn: '#a16207', miss: '#ea580c', missSoft: '#fff7ed', missLine: '#fed7aa',
};
// [background, text] per day kind — same colours as the web app.
const DAY = {
  present: ['#e7f7ef', '#047857'], late: ['#fef9c3', '#a16207'], half: ['#eef0ff', '#4338ca'],
  absent: ['#fdecec', '#dc2626'], missing: ['#ffedd5', '#ea580c'], off: ['#f1f3f7', '#64748b'],
};
const LEGEND = [['present', 'Present'], ['late', 'Late'], ['missing', 'Missing punch'], ['half', 'Half day'], ['absent', 'Absent'], ['off', 'Off / holiday']];

const hex = h => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

// Indian digit grouping (1,20,000) without relying on Intl data, which packaged Node may lack.
function indian(n, decimals = 0) {
  const [int, frac] = Math.abs(Number(n) || 0).toFixed(decimals).split('.');
  const grouped = int.length > 3 ? `${int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${int.slice(-3)}` : int;
  return `${Number(n) < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}
const rs = (n, decimals = 0) => `Rs. ${indian(n, decimals)}`;
const hrs = mins => { const h = Math.floor((mins || 0) / 60), m = Math.round((mins || 0) % 60); return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`; };
const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`; };
const shortMonth = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const dayIndex = iso => Math.round(Date.UTC(...iso.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0))) / 86400000);

function dayKind(d) {
  if (d.off || d.holiday) return 'off';
  if (d.absent) return 'absent';
  if (d.half) return 'half';
  if (d.missing) return 'missing';
  if (d.late) return 'late';
  return 'present';
}

const roundedPath = (w, h, r) =>
  `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;

/** File name (without extension) for an employee's slip: "<Name> - <Month YYYY>". */
function slipName(e, month) {
  const name = String(e.name).replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim() || e.id;
  return `${name} - ${monthLabel(month)}`;
}

async function buildSlipPdf(report, e, { generatedOn = new Date() } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const clean = s => [...String(s ?? '').replace(/₹/g, 'Rs.').replace(/→/g, '-')]
    .map(ch => (charset.has(ch.codePointAt(0)) ? ch : '?')).join('');
  doc.setTitle(clean(slipName(e, report.month)));
  const companyName = e.company_name || report.company || 'Attendance report';
  doc.setAuthor(clean(companyName));
  doc.setCreator('StaffPay');
  doc.setProducer('StaffPay');
  const page = doc.addPage([W, H]);

  // Coordinates below are measured from the top of the page; `top` for text is the baseline.
  function text(s, x, top, size = 10, { f = font, color = C.ink, align = 'left', maxWidth } = {}) {
    let str = clean(s);
    if (maxWidth) while (str.length > 1 && f.widthOfTextAtSize(str, size) > maxWidth) str = `${str.replace(/…$/, '').slice(0, -1)}…`;
    const w = f.widthOfTextAtSize(str, size);
    page.drawText(str, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y: H - top, size, font: f, color: hex(color) });
  }
  const box = (x, top, w, h, { fill, stroke, r = 6 } = {}) => page.drawSvgPath(roundedPath(w, h, r), {
    x, y: H - top, color: fill ? hex(fill) : undefined, borderColor: stroke ? hex(stroke) : undefined, borderWidth: stroke ? 0.8 : 0,
  });
  const line = (x1, x2, top, color = C.line, thickness = 0.7) =>
    page.drawLine({ start: { x: x1, y: H - top }, end: { x: x2, y: H - top }, thickness, color: hex(color) });

  const month = monthLabel(report.month);
  const period = report.period.from ? `${fmtDate(report.period.from)} - ${fmtDate(report.period.to)}` : '';

  // ---- Header band ----
  page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: hex(C.accent) });
  text(companyName.toUpperCase(), M, 30, 9, { f: bold, color: C.onAccent, maxWidth: 330 });
  text('Salary & Attendance Statement', M, 58, 20, { f: bold, color: C.white });
  text(period, M, 78, 10, { color: C.onAccent });
  text('PAY MONTH', W - M, 30, 9, { f: bold, color: C.onAccent, align: 'right' });
  text(month, W - M, 58, 18, { f: bold, color: C.white, align: 'right' });

  // ---- Employee ----
  page.drawCircle({ x: M + 18, y: H - 134, size: 18, color: hex(C.accentSoft) });
  const initials = String(e.name).trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  text(initials, M + 18, 138, 12, { f: bold, color: C.accent, align: 'center' });
  text(e.name, M + 46, 131, 16, { f: bold, maxWidth: W - 2 * M - 46 });
  text(`Employee ID ${e.device_id || e.id}   ·   Shift: ${e.shift_name} (${e.shift_time})`, M + 46, 147, 9.5, { color: C.muted });

  // ---- Attendance tiles ----
  const tiles = [
    ['Worked days', e.present_days, C.ink, 'present / late'],
    ['Absences / leave', e.absences, e.excess_absences ? C.bad : C.ink, e.excess_absences ? `${e.excess_absences} deducted` : e.absences ? 'paid' : ''],
    ['Half days', e.half_days, C.ink, ''],
    ['Late arrivals', e.late_arrivals, e.late_arrivals ? C.warn : C.ink, ''],
    ['Overtime', hrs(e.overtime_minutes), e.overtime_minutes ? C.good : C.ink, ''],
  ];
  const tileW = (W - 2 * M - 4 * 8) / 5;
  tiles.forEach(([label, value, color, sub], i) => {
    const x = M + i * (tileW + 8);
    box(x, 168, tileW, 54, { fill: C.soft, stroke: C.line });
    text(label, x + 10, 184, 8.5, { color: C.muted });
    text(value, x + 10, 210, 19, { f: bold, color });
    if (sub) text(sub, x + tileW - 10, 210, 7.5, { color: C.muted, align: 'right' });
  });

  // ---- Salary breakdown (left) ----
  const r = e.rules || report.rules; // the employee's company rules (or the defaults)
  const advDeduction = e.advance_deduction;
  const hasAdvances = e.advances.length > 0;
  const leftW = 300;
  text('Salary breakdown', M, 252, 11, { f: bold });
  const parts = [
    `${e.excess_absences} ${e.allowed_absences ? 'extra ' : ''}absence${e.excess_absences === 1 ? '' : 's'}`,
    e.half_days ? `${e.half_days} half day${e.half_days === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' + ');
  const rows = [
    ['Monthly salary', rs(e.monthly_salary), C.ink],
    [`Daily rate (monthly ÷ ${r.salary_divisor})`, rs(e.daily_salary, 2), C.muted],
    [`Attendance deduction${e.attendance_deduction ? ` (${parts})` : ''}`, e.attendance_deduction ? `- ${rs(e.attendance_deduction)}` : rs(0), e.attendance_deduction ? C.bad : C.ink],
    [r.late_mode === 'hourly' ? `Late deduction (${e.late_arrivals} late, ${hrs(e.late_hours * 60)} × ${rs(e.hourly_rate, 2)}/h)` : `Late fines (${e.late_arrivals} × ${rs(r.late_fine)})`,
      e.late_fine ? `- ${rs(e.late_fine)}` : rs(0), e.late_fine ? C.bad : C.ink],
    ...(Number(r.missing_punch_as_leave) ? [] : [[`Missing punch fines (${e.missing_punches} × ${rs(r.missing_punch_fine)})`, e.missing_punch_fine ? `- ${rs(e.missing_punch_fine)}` : rs(0), e.missing_punch_fine ? C.bad : C.ink]]),
    ...(Number(r.overtime_pay) ? [[`Overtime incentive (${hrs(e.overtime_minutes)} × ${rs(e.overtime_rate, r.overtime_mode === 'fixed' ? 0 : 2)}/h)`, e.overtime_incentive ? `+ ${rs(e.overtime_incentive)}` : rs(0), e.overtime_incentive ? C.good : C.ink]] : []),
    ...(hasAdvances ? [['Advance deduction', advDeduction ? `- ${rs(advDeduction)}` : rs(0), advDeduction ? C.bad : C.ink]] : []),
  ];
  let y = 274;
  for (const [label, value, color] of rows) {
    text(label, M, y, 9.5, { color: C.text2, maxWidth: leftW - 68 });
    text(value, M + leftW, y, 9.5, { f: bold, color, align: 'right' });
    line(M, M + leftW, y + 7);
    y += 20;
  }
  line(M, M + leftW, y - 13, C.ink, 1.2);
  text('Net salary', M, y + 4, 11, { f: bold });
  text(rs(e.net_salary), M + leftW, y + 4, 11, { f: bold, color: C.accent, align: 'right' });
  const leftBottom = y + 14;

  // ---- Net payable + advance summary (right) ----
  const rx = M + leftW + 22, rw = W - M - rx;
  box(rx, 240, rw, 74, { fill: C.accent, r: 8 });
  text('NET PAYABLE', rx + 14, 260, 8.5, { f: bold, color: C.onAccent });
  text(rs(e.net_salary), rx + 14, 290, 24, { f: bold, color: C.white });
  text(`for ${month}`, rx + 14, 306, 8.5, { color: C.onAccent });
  let rightBottom = 314;
  if (hasAdvances) {
    const sum = k => e.advances.reduce((s, a) => s + Number(a[k] || 0), 0);
    const items = [
      ['Advance taken', rs(sum('amount')), C.ink],
      ['Paid before this month', rs(sum('recovered') - sum('deduction')), C.ink],
      [`Paid in ${shortMonth(report.month)}`, rs(sum('deduction')), C.ink],
      ['Balance to repay', rs(sum('balance')), sum('balance') ? C.bad : C.ink],
    ];
    const h = 34 + items.length * 18;
    box(rx, 324, rw, h, { fill: C.missSoft, stroke: C.missLine, r: 8 });
    text('ADVANCE', rx + 14, 342, 8.5, { f: bold, color: C.miss });
    items.forEach(([label, value, color], i) => {
      const ty = 362 + i * 18;
      text(label, rx + 14, ty, 9, { color: C.text2 });
      text(value, rx + rw - 14, ty, 9.5, { f: bold, color, align: 'right' });
    });
    rightBottom = 324 + h;
  }
  y = Math.max(leftBottom, rightBottom) + 22;

  // ---- Advance details (every advance being repaid) ----
  if (hasAdvances) {
    text('Advance details', M, y, 11, { f: bold });
    const cols = [
      ['Date given', M + 8, 'left'], ['Advance', M + 200, 'right'], ['Per month', M + 262, 'right'],
      ['Paid before', M + 330, 'right'], [`Paid ${shortMonth(report.month)}`, M + 398, 'right'],
      ['Total paid', M + 460, 'right'], ['Balance', W - M - 8, 'right'],
    ];
    box(M, y + 8, W - 2 * M, 18, { fill: C.soft, r: 4 });
    cols.forEach(([label, x, align]) => text(label, x, y + 20, 8, { f: bold, color: C.muted, align }));
    y += 26;
    for (const a of e.advances.slice(0, 5)) {
      const started = a.start_month <= report.month;
      const cells = [
        `${fmtDate(a.date)}${started ? '' : `  (starts ${shortMonth(a.start_month)})`}`, rs(a.amount), rs(a.installment),
        rs(a.recovered - a.deduction), rs(a.deduction), rs(a.recovered), rs(a.balance),
      ];
      y += 16;
      cells.forEach((v, i) => text(v, cols[i][1], y, 9, {
        f: i === 6 ? bold : font, color: i === 6 && a.balance ? C.bad : C.ink, align: cols[i][2],
      }));
      line(M, W - M, y + 6);
    }
    if (e.advances.length > 5) { y += 14; text(`+ ${e.advances.length - 5} more`, M + 8, y, 8, { color: C.muted }); }
    y += 26;
  }

  // ---- Attendance calendar ----
  text(`Attendance - ${month}`, M, y, 11, { f: bold });
  let lx = W - M;
  const legend = LEGEND.filter(([kind]) => kind !== 'missing' || !Number(r.missing_punch_as_leave));
  for (const [kind, label] of [...legend].reverse()) {
    lx -= font.widthOfTextAtSize(label, 7.5);
    text(label, lx, y - 1, 7.5, { color: C.muted });
    lx -= 11;
    box(lx, y - 8, 7, 7, { fill: DAY[kind][0], stroke: DAY[kind][1], r: 1.5 });
    lx -= 10;
  }
  const days = e.days;
  const gap = 4, cellW = (W - 2 * M - 6 * gap) / 7;
  const first = days.length ? dayIndex(days[0].date) : 0;
  const offset = days.length ? new Date(`${days[0].date}T00:00:00`).getDay() : 0;
  const span = days.length ? dayIndex(days[days.length - 1].date) - first + 1 : 0;
  const weeks = Math.max(1, Math.ceil((offset + span) / 7));
  WEEKDAYS.forEach((wd, i) => text(wd, M + i * (cellW + gap) + cellW / 2, y + 18, 8, { f: bold, color: C.muted, align: 'center' }));
  const gridTop = y + 24, gridBottom = H - 50;
  const cellH = Math.min(56, (gridBottom - gridTop) / weeks - gap);
  for (const d of days) {
    const slot = offset + dayIndex(d.date) - first;
    const x = M + (slot % 7) * (cellW + gap), top = gridTop + Math.floor(slot / 7) * (cellH + gap);
    const [bg, fg] = DAY[dayKind(d)];
    box(x, top, cellW, cellH, { fill: bg, stroke: d.missing ? fg : undefined, r: 5 });
    text(Number(d.date.slice(8)), x + 6, top + 13, 10, { f: bold, color: fg });
    const flag = [d.late && (d.late_hours ? `LATE -${hrs(d.late_hours * 60)}` : 'LATE'), d.missing_in && 'NO IN', d.missing_out && 'NO OUT', d.ot_minutes && `+${hrs(d.ot_minutes)}`].filter(Boolean).join(' ');
    if (flag) text(flag, x + cellW - 5, top + 12, 6.5, { f: bold, color: fg, align: 'right' });
    text(d.category, x + 6, top + 25, 7.5, { f: bold, color: fg, maxWidth: cellW - 10 });
    if (cellH >= 34 && (d.clock_in || d.clock_out)) {
      text(`${d.clock_in || '--:--'} - ${d.clock_out || '--:--'}`, x + 6, top + Math.min(37, cellH - 6), 7.5, { color: C.text2 });
    }
  }

  // ---- Footer ----
  line(M, W - M, H - 38);
  const g = generatedOn;
  text(`Generated by StaffPay on ${fmtDate(`${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, '0')}-${String(g.getDate()).padStart(2, '0')}`)}.  `
    + `${Number(r.allowed_absences) ? `First ${r.allowed_absences} absences paid; others` : 'Absences'}${Number(r.missing_punch_as_leave) ? ' (incl. missing punch)' : ''} and half days deducted at daily rate.`
    + `${Number(r.overtime_pay) ? ' Extra hours paid hourly.' : ''}`, M, H - 26, 7.5, { color: C.faint, maxWidth: W - 2 * M });

  return doc.save();
}

/** ZIP of every employee's slip, one "<Name> - <Month YYYY>.pdf" each. */
async function buildSlipsZip(report) {
  const files = {};
  const used = new Set();
  for (const e of report.employees) {
    let name = slipName(e, report.month);
    if (used.has(name.toLowerCase())) name = `${name} (${e.id})`;
    used.add(name.toLowerCase());
    files[`${name}.pdf`] = [await buildSlipPdf(report, e), { level: 0 }]; // PDFs are already compressed
  }
  return Buffer.from(zipSync(files));
}

module.exports = { buildSlipPdf, buildSlipsZip, slipName };
