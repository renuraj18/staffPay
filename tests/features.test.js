const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { calculatePayroll, applyPaid, normalizeSettings } = require('../lib/payroll');
const { createStore } = require('../lib/store');
const { buildStaffWorkbook, parseStaffWorkbook } = require('../lib/staffio');
const { buildReports } = require('../lib/reports');
const { hashPin, verifyPin, createSessions, IDLE_MS } = require('../lib/auth');
const { createBackup, restoreBackup } = require('../lib/backup');

const day = (date, clock_in, clock_out, status) => ({ date, clock_in, clock_out, total_wt: '', status });
const parsed = () => ({
  company: 'TEST', period: { from: '2026-09-01', to: '2026-09-03' }, warnings: [],
  employees: [{ id: '1', name: 'ASHA', sheet: '1', days: [
    day('2026-09-01', '09:30', '19:30', 'Present(P)'),
    day('2026-09-02', '', '', 'Absent(A)'),
    day('2026-09-03', '10:30', '19:30', 'Late(LT)'),
  ] }],
});
const settings = () => normalizeSettings({ version: 5, staff: { 1: { name: 'ASHA', salary: 30500 } } }); // daily rate 1000

test('day corrections: paid leave removes the absence, present removes the late fine', () => {
  const plain = calculatePayroll(parsed(), settings()).employees[0];
  assert.equal(plain.absences, 1);
  assert.equal(plain.late_arrivals, 1);
  const edits = { days: { 1: { '2026-09-02': { status: 'leave', note: 'approved' }, '2026-09-03': { status: 'present' } } } };
  const e = calculatePayroll(parsed(), settings(), edits).employees[0];
  assert.equal(e.absences, 0);
  assert.equal(e.leave_days, 1);
  assert.equal(e.late_arrivals, 0);
  assert.equal(e.corrections, 2);
  assert.equal(e.net_salary, 30500);
  assert.deepEqual(e.days[1].corrected, { status: 'leave', note: 'approved', was: 'Absent' });
});

test('adjustments add earnings and deductions to net', () => {
  const edits = { adjustments: { 1: [
    { id: 'a', kind: 'earning', label: 'Bonus', amount: 2000 },
    { id: 'b', kind: 'deduction', label: 'Uniform', amount: 500 },
  ] } };
  const plain = calculatePayroll(parsed(), settings()).employees[0];
  const e = calculatePayroll(parsed(), settings(), edits).employees[0];
  assert.equal(e.extra_earnings, 2000);
  assert.equal(e.extra_deductions, 500);
  assert.equal(e.net_salary, plain.net_salary + 1500);
});

test('paid status on a calculated and on a frozen report', () => {
  const r = calculatePayroll(parsed(), settings(), { paid: { 1: { date: '2026-10-05' } } });
  assert.equal(r.employees[0].paid_on, '2026-10-05');
  assert.equal(r.totals.paid_count, 1);
  const frozen = applyPaid(r, {});
  assert.equal(frozen.totals.paid_count, 0);
  assert.equal(frozen.employees[0].paid_on, '');
});

test('month store: legacy upload moves to months/, newest month is active by default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-store-'));
  try {
    fs.writeFileSync(path.join(dir, 'current_upload.json'), JSON.stringify({ file: 'a.xlsx', uploaded_at: 'x', parsed: parsed() }));
    const store = createStore(() => dir);
    assert.equal(store.migrateLegacy(), '2026-09');
    assert.ok(fs.existsSync(path.join(dir, 'current_upload.json.migrated')));
    assert.equal(store.activeMonth(), '2026-09');
    store.saveMonth({ month: '2026-10', parsed: parsed(), edits: {} });
    assert.deepEqual(store.listMonths(), ['2026-10', '2026-09']);
    assert.equal(store.activeMonth(), '2026-09'); // the chosen month stays open
    store.setActive('2026-10');
    assert.equal(store.activeMonth(), '2026-10');
    assert.deepEqual(store.loadMonth('2026-10').edits, { days: {}, adjustments: {}, paid: {} });
    store.deleteMonth('2026-10');
    assert.equal(store.activeMonth(), '2026-09');
    assert.throws(() => store.monthFile('../x'), /Invalid month/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('backup and restore include every month', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-restore-'));
  try {
    const dataDir = path.join(root, 'data');
    const store = createStore(() => dataDir);
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'settings.json'), '{"version":5}');
    store.saveMonth({ month: '2026-09', parsed: parsed(), edits: {} });
    const zip = createBackup({ configFile: path.join(root, 'none.json'), dataDir, backupDir: path.join(root, 'b') });
    store.saveMonth({ month: '2026-10', parsed: parsed(), edits: {} });
    fs.writeFileSync(path.join(dataDir, 'settings.json'), '{"version":5,"changed":true}');
    restoreBackup(zip, dataDir);
    assert.deepEqual(store.listMonths(), ['2026-09']);
    assert.equal(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'), '{"version":5}');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('staff Excel round trip: blank clears, unknown company is reported, new rows need a name', () => {
  const s = normalizeSettings({ version: 5, companies: { c1: { name: 'GKRS' } },
    staff: { 1: { name: 'ASHA', salary: 12000, company_id: 'c1', bank_ifsc: 'SBIN0001234' } } });
  const wb = XLSX.read(buildStaffWorkbook(s), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Staff, { header: 1, defval: '' });
  assert.deepEqual(rows[1].slice(0, 5), ['1', 'ASHA', 'GKRS', 'General', 12000]);
  rows[1][2] = ''; rows[1][4] = 15000; rows[1][8] = '05-11-2026';
  rows.push(['2', 'RAVI', 'gkrs', '', '', '', '', '', ''], ['3', '', '', '', '', '', '', '', ''], ['4', 'X', 'Nope', '', '', '', '', '', '']);
  const edited = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(edited, XLSX.utils.aoa_to_sheet(rows), 'Staff');
  const out = parseStaffWorkbook(XLSX.write(edited, { type: 'buffer', bookType: 'xlsx' }), s);
  assert.deepEqual(out.rows[0].patch, { name: 'ASHA', company_id: '', shift_id: 'general', salary: 15000, bank_account_name: '', bank_account_number: '', bank_ifsc: 'SBIN0001234', left_on: '2026-11-05' });
  assert.equal(out.rows[1].patch.company_id, 'c1');
  assert.deepEqual(out.errors.map(e => e.row), [4, 5]);
});

test('reports: cost per month and company, people totals', () => {
  const r1 = calculatePayroll(parsed(), settings());
  const r2 = calculatePayroll({ ...parsed(), period: { from: '2026-10-01', to: '2026-10-03' } }, settings());
  const out = buildReports([{ month: '2026-10', report: r2 }, { month: '2026-09', report: r1, locked: { at: 'x' } }], '2026-10');
  assert.deepEqual(out.months.map(m => m.month), ['2026-09', '2026-10']);
  assert.equal(out.months[0].locked, true);
  assert.deepEqual(out.months[0].by_company, { 'No company': r1.totals.net_salary });
  assert.equal(out.people_all[0].months, 2);
  assert.equal(out.people_all[0].absences, 2);
  assert.equal(out.people_month[0].months, 1);
});

test('PIN: hashed, verified, sessions expire when idle, five wrong PINs block for 30 s', () => {
  const rec = hashPin('4321');
  assert.ok(!JSON.stringify(rec).includes('4321'));
  assert.ok(verifyPin('4321', rec));
  assert.ok(!verifyPin('1234', rec));
  let now = 0;
  const s = createSessions({ now: () => now });
  const t = s.create();
  now += IDLE_MS - 1;
  assert.ok(s.touch(t));
  now += IDLE_MS + 1;
  assert.ok(!s.touch(t));
  for (let i = 0; i < 5; i++) s.failed();
  assert.equal(s.waitSeconds(), 30);
  now += 30 * 1000;
  assert.equal(s.waitSeconds(), 0);
});
