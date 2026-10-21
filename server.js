const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const { DEFAULT_RULES, normalizeSettings, parseWorkbook, parseSheets, calculatePayroll, advanceSummary, resolveStaffIds, reportMonth,
  renumberDuplicateIds, applyPaid, SETTINGS_VERSION, DAY_FIXES, ADJUST_KINDS } = require('./lib/payroll');
const { pdfToSheets } = require('./lib/pdf');
const { buildWorkbook, buildBankTransfer, monthLabel } = require('./lib/export');
const { buildSlipPdf, buildSlips, buildSlipsPdf, buildSlipsZip, slipName } = require('./lib/slip');
const { monthDir, defaultOutputDir, cleanDir, pickFolder, openFolder } = require('./lib/folders');
const { versionInfo, canSelfUpdate, downloadSetup, runInstaller } = require('./lib/update');
const { createBackup, listBackups, restoreBackup, dataFiles } = require('./lib/backup');
const { createStore, readJson, writeJson, MONTH: MONTH_RE } = require('./lib/store');
const { buildStaffWorkbook, parseStaffWorkbook } = require('./lib/staffio');
const { buildReports } = require('./lib/reports');
const auth = require('./lib/auth');
const pkg = require('./package.json');

const PORT = Number(process.env.PORT || 8000);
const URL = `http://127.0.0.1:${PORT}`;
// Packaged Windows app (pkg sets process.pkg): keep data in the user's profile so
// reinstalling or updating never touches it. From source: ./data.
const PACKAGED = Boolean(process.pkg);
const DEFAULT_DATA_DIR = PACKAGED ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'StaffPay', 'data') : path.join(__dirname, 'data');
// App choices live outside the data folder (it can be moved): {data_dir, output_dir, backup_dir, auto_update, pin}.
const CONFIG_FILE = PACKAGED ? path.join(path.dirname(DEFAULT_DATA_DIR), 'config.json') : path.join(DEFAULT_DATA_DIR, 'config.json');
const DATA_DIR_LOCKED = Boolean(process.env.STAFFPAY_DATA_DIR);
let config = readJson(CONFIG_FILE, {});
let DATA_DIR = process.env.STAFFPAY_DATA_DIR || config.data_dir || DEFAULT_DATA_DIR;
const settingsFile = () => path.join(DATA_DIR, 'settings.json');
const outputDir = () => config.output_dir || defaultOutputDir();
const backupDir = () => config.backup_dir || path.join(defaultOutputDir(), 'Backups');
const autoUpdate = () => config.auto_update !== false;
fs.mkdirSync(DATA_DIR, { recursive: true });
const store = createStore(() => DATA_DIR);

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const activeRecord = () => store.loadMonth(store.activeMonth());

function loadSettings() {
  const settings = normalizeSettings(readJson(settingsFile(), {}));
  const rec = activeRecord();
  return rec ? registerStaff(settings, rec.parsed) : settings;
}

// A month's report: the frozen copy when the month is locked, else recalculated from today's settings
// (so changes apply to open months). Payment status always comes from edits.paid.
function monthReport(rec, settings) {
  if (!rec) return null;
  const meta = { file: rec.file, uploaded_at: rec.uploaded_at, locked: rec.locked?.at || null };
  if (rec.locked?.report) return { ...applyPaid(rec.locked.report, rec.edits.paid), ...meta };
  return { ...calculatePayroll(rec.parsed, settings, rec.edits), ...meta };
}
const currentReport = (settings = loadSettings()) => monthReport(activeRecord(), settings);

function monthsSummary(settings) {
  return store.listMonths().map(m => {
    const rec = store.loadMonth(m);
    const r = monthReport(rec, settings);
    return {
      month: m, file: rec.file, uploaded_at: rec.uploaded_at, locked: rec.locked?.at || null,
      employees: r.employees.length, net: r.totals.net_salary, paid_count: r.totals.paid_count || 0,
    };
  });
}

// Advances are listed for the open month (or this month when nothing is uploaded).
function stateResponse(settings) {
  const report = currentReport(settings);
  const month = report?.month || thisMonth();
  return {
    settings, report, month, advances: advanceSummary(settings.advances, month),
    months: monthsSummary(settings), active_month: store.activeMonth(), undo: undoStack.at(-1)?.label || null,
  };
}

// Make sure every employee in the sheet has a staff entry (keeps the name current). parsed.employees[].id
// is already the staff key (resolveStaffIds), so this never renames a different person's record.
function registerStaff(settings, parsed) {
  for (const e of parsed.employees) {
    const cur = { shift_id: settings.shifts[0].id, ...settings.staff[e.id], name: e.name };
    if (e.device_id && e.device_id !== e.id) cur.device_id = e.device_id;
    settings.staff[e.id] = cur;
  }
  return settings;
}

// ---------- Undo ----------
// Before each change the files it touches are copied into memory; "Undo" puts the last copy back.
const undoStack = [];
function snapshot(label, months = [store.activeMonth()]) {
  const files = [settingsFile(), store.metaFile(), ...months.filter(Boolean).map(m => store.monthFile(m))];
  undoStack.push({ label, dataDir: DATA_DIR, files: files.map(f => [f, fs.existsSync(f) ? fs.readFileSync(f) : null]) });
  if (undoStack.length > 20) undoStack.shift();
}
// Runs a change with an undo point that is dropped again when the change is refused.
function undoable(label, months, fn) {
  snapshot(label, months);
  try { return fn(); } catch (e) { undoStack.pop(); throw e; }
}

// Async route handlers: Express 4 doesn't catch their rejections.
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class BadRequest extends Error { constructor(msg) { super(msg); this.status = 400; } }
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^[0-9A-Z]{6,20}$/;
// Bank fields: '' clears; IFSC upper-cased, spaces removed from account numbers.
function bankField(v, kind) {
  const raw = String(v ?? '').trim();
  if (kind === 'account_number') {
    const s = raw.replace(/[\s-]/g, '').toUpperCase();
    if (s && !ACCOUNT.test(s)) throw new BadRequest('Account number must be 6–20 digits');
    return s;
  }
  if (kind === 'ifsc') {
    const s = raw.toUpperCase();
    if (s && !IFSC.test(s)) throw new BadRequest('IFSC must be 11 characters, like SBIN0001234');
    return s;
  }
  return raw.slice(0, 100);
}
const BANK_FIELDS = ['account_name', 'account_number', 'ifsc'];
function nonNegative(v, label) {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n) || n < 0) throw new BadRequest(`${label} must be a number of 0 or more`);
  return n;
}

// Validate a partial rules patch into `target` (the default rules or a company's own rules).
function applyRules(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULT_RULES)) continue;
    if (k === 'sunday_logout_time') {
      if (!TIME.test(String(v))) throw new BadRequest('Sunday finish time must be HH:MM');
      target[k] = String(v);
      continue;
    }
    if (k === 'late_mode') {
      if (!['fine', 'hourly'].includes(v)) throw new BadRequest('Late arrival must be a fine or an hourly deduction');
      target[k] = v;
      continue;
    }
    if (k === 'overtime_mode') {
      if (!['hourly', 'fixed'].includes(v)) throw new BadRequest('Overtime must be paid at the hourly rate or a fixed rate');
      target[k] = v;
      continue;
    }
    if (['weekends_working', 'missing_punch_as_leave', 'overtime_pay'].includes(k)) { target[k] = v === true || Number(v) === 1 ? 1 : 0; continue; }
    target[k] = nonNegative(v, k.replace(/_/g, ' '));
    if (['salary_divisor', 'late_hour_block', 'overtime_block_minutes'].includes(k) && target[k] === 0) throw new BadRequest(`${k.replace(/_/g, ' ')} must be more than 0`);
  }
  return target;
}

function applyPatch(settings, body) {
  applyRules(settings.rules, body.rules);

  if (body.shifts !== undefined) {
    if (!Array.isArray(body.shifts) || !body.shifts.length) throw new BadRequest('Keep at least one shift');
    const seen = new Set();
    settings.shifts = body.shifts.map(s => {
      const name = String(s.name || '').trim();
      if (!name) throw new BadRequest('Every shift needs a name');
      if (!TIME.test(s.login_time || '') || !TIME.test(s.logout_time || '')) throw new BadRequest(`${name}: times must be HH:MM`);
      let id = String(s.id || '').trim() || `shift_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      if (seen.has(id)) throw new BadRequest('Duplicate shift id');
      seen.add(id);
      return { id, name, login_time: s.login_time, logout_time: s.logout_time, grace_minutes: nonNegative(s.grace_minutes ?? 0, `${name} grace`) };
    });
    // Staff in a deleted shift move to the first shift.
    for (const s of Object.values(settings.staff)) if (!seen.has(s.shift_id)) s.shift_id = settings.shifts[0].id;
  }

  // companies: {id: {name, bank_name, account_name, account_number, ifsc} | null}; deleting unassigns its staff.
  for (const [id, patch] of Object.entries(body.companies || {})) {
    if (!/^[\w-]{1,64}$/.test(id)) throw new BadRequest('Invalid company id');
    if (patch === null) {
      delete settings.companies[id];
      for (const s of Object.values(settings.staff)) if (s.company_id === id) delete s.company_id;
      continue;
    }
    const cur = { ...settings.companies[id] };
    if (patch.name !== undefined) cur.name = String(patch.name).trim().slice(0, 100);
    if (!cur.name) throw new BadRequest('Give the company a name');
    if (patch.bank_name !== undefined) cur.bank_name = bankField(patch.bank_name, 'bank_name');
    for (const k of BANK_FIELDS) if (patch[k] !== undefined) cur[k] = bankField(patch[k], k);
    // rules: partial patch of the company's own salary rules; true starts them from the defaults; null = use the defaults.
    if (patch.rules === null) delete cur.rules;
    else if (patch.rules !== undefined) {
      const base = cur.rules || { ...settings.rules };
      cur.rules = patch.rules === true ? base : applyRules(base, patch.rules);
    }
    settings.companies[id] = cur;
  }

  const shiftIds = new Set(settings.shifts.map(s => s.id));
  for (const [id, patch] of Object.entries(body.staff || {})) {
    if (patch === null) { delete settings.staff[id]; continue; }
    const cur = { shift_id: settings.shifts[0].id, ...settings.staff[id] };
    if (patch.name !== undefined) cur.name = String(patch.name).trim();
    if (patch.shift_id !== undefined) {
      if (!shiftIds.has(patch.shift_id)) throw new BadRequest('Unknown shift');
      cur.shift_id = patch.shift_id;
    }
    if (patch.salary !== undefined) {
      if (patch.salary === null || patch.salary === '') delete cur.salary;
      else cur.salary = nonNegative(patch.salary, 'Monthly salary');
    }
    if (patch.company_id !== undefined) {
      if (!patch.company_id) delete cur.company_id;
      else if (!settings.companies[patch.company_id]) throw new BadRequest('Unknown company');
      else cur.company_id = String(patch.company_id);
    }
    // Left: the date they left (hidden from the Staff page by default, history kept); '' = still working.
    if (patch.left_on !== undefined) {
      if (!patch.left_on) delete cur.left_on;
      else if (!DATE.test(String(patch.left_on))) throw new BadRequest('Left on must be a date');
      else cur.left_on = String(patch.left_on);
    }
    // Staff bank account: bank_account_name / bank_account_number / bank_ifsc.
    for (const k of BANK_FIELDS) {
      if (patch[`bank_${k}`] === undefined) continue;
      const v = bankField(patch[`bank_${k}`], k);
      if (v) cur[`bank_${k}`] = v; else delete cur[`bank_${k}`];
    }
    settings.staff[id] = cur;
  }

  // advances: {id: {emp_id, date, amount, installment, start_month, note, overrides: {month: amount|null}} | null}
  for (const [id, patch] of Object.entries(body.advances || {})) {
    if (!/^[\w-]{1,64}$/.test(id)) throw new BadRequest('Invalid advance id');
    if (patch === null) { delete settings.advances[id]; continue; }
    const cur = { note: '', overrides: {}, ...settings.advances[id] };
    if (patch.emp_id !== undefined) {
      if (!settings.staff[patch.emp_id]) throw new BadRequest('Choose a staff member');
      cur.emp_id = String(patch.emp_id);
    }
    if (patch.date !== undefined) {
      if (!DATE.test(String(patch.date))) throw new BadRequest('Advance date must be a valid date');
      cur.date = String(patch.date);
    }
    if (patch.start_month !== undefined) {
      if (!MONTH.test(String(patch.start_month))) throw new BadRequest('Choose the month to start deducting');
      cur.start_month = String(patch.start_month);
    }
    if (patch.amount !== undefined) {
      cur.amount = nonNegative(patch.amount, 'Advance amount');
      if (!cur.amount) throw new BadRequest('Advance amount must be more than 0');
    }
    if (patch.installment !== undefined) {
      cur.installment = nonNegative(patch.installment, 'Monthly deduction');
      if (!cur.installment) throw new BadRequest('Monthly deduction must be more than 0');
    }
    if (patch.note !== undefined) cur.note = String(patch.note).trim().slice(0, 200);
    for (const [m, v] of Object.entries(patch.overrides || {})) {
      if (!MONTH.test(m)) throw new BadRequest('Invalid month');
      if (v === null || v === '') delete cur.overrides[m];
      else cur.overrides[m] = nonNegative(v, 'Deduction for the month');
    }
    for (const k of ['emp_id', 'date', 'amount', 'installment', 'start_month']) {
      if (cur[k] === undefined) throw new BadRequest(`Advance is missing ${k.replace('_', ' ')}`);
    }
    settings.advances[id] = cur;
  }
  return settings;
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.use(express.json());
// Last time someone used the app (status polls don't count): automatic updates install only when idle.
let lastActivity = Date.now();
app.use('/api', (req, res, next) => {
  if (!/^\/(version|update)\b/.test(req.path)) lastActivity = Date.now();
  next();
});

// PIN lock: with a PIN set, every API call except unlocking and the version check needs an unlocked session.
const sessions = auth.createSessions();
app.use('/api', (req, res, next) => {
  if (!config.pin || /^\/(auth|version|update)\b/.test(req.path)) return next();
  if (sessions.touch(auth.readCookie(req))) return next();
  res.status(401).json({ error: 'StaffPay is locked — enter your PIN', code: 'locked' });
});
// no-cache: the browser always checks for a newer app.js/style.css (after an update or restart).
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

// What to check after an upload: new staff, renamed duplicate IDs, people marked as left, missing details.
function uploadSummary(parsed, settings, before) {
  const staffOf = e => settings.staff[e.id] || {};
  const names = list => list.map(e => ({ id: e.id, name: e.name }));
  const hasCompanies = Object.keys(settings.companies).length > 0;
  return {
    month: reportMonth(parsed), employees: parsed.employees.length,
    new_staff: names(parsed.employees.filter(e => !before.has(e.id))),
    renamed: names(parsed.employees.filter(e => e.device_id && e.device_id !== e.id && !before.has(e.id))),
    left: names(parsed.employees.filter(e => staffOf(e).left_on)),
    no_salary: names(parsed.employees.filter(e => staffOf(e).salary === undefined || staffOf(e).salary === null)),
    no_company: hasCompanies ? names(parsed.employees.filter(e => !staffOf(e).company_id)) : [],
    no_bank: names(parsed.employees.filter(e => !staffOf(e).bank_account_number || !staffOf(e).bank_ifsc)),
    warnings: parsed.warnings,
  };
}

// Upload a month's sheet. Uploading a month that is already saved needs ?replace=1 (its corrections,
// adjustments and payments are kept); a locked month must be unlocked first.
app.post('/api/upload', upload.single('file'), handle(async (req, res) => {
  if (!req.file) throw new BadRequest('Choose an attendance sheet');
  const pdf = /\.pdf$/i.test(req.file.originalname);
  if (!pdf && !/\.(xlsx|xlsm|xls)$/i.test(req.file.originalname)) throw new BadRequest('Upload an Excel (.xlsx, .xls) or PDF file');
  let parsed;
  try { parsed = pdf ? parseSheets(await pdfToSheets(req.file.buffer)) : parseWorkbook(req.file.buffer); } catch (e) {
    throw new BadRequest(`Could not read ${pdf ? 'PDF' : 'workbook'}: ${e.message || e}`);
  }
  if (!parsed.employees.length) return res.status(400).json({ error: `No employee attendance found in this ${pdf ? 'PDF' : 'workbook'}`, warnings: parsed.warnings });
  const month = reportMonth(parsed);
  if (!MONTH_RE.test(month)) throw new BadRequest('Could not tell which month this sheet is for');
  const existing = store.loadMonth(month);
  if (existing?.locked) return res.status(409).json({ error: `${monthLabel(month)} is locked. Unlock it before uploading its sheet again.`, code: 'locked', month });
  if (existing && req.query.replace !== '1') {
    return res.status(409).json({ error: `${monthLabel(month)} is already uploaded`, code: 'exists', month, file: existing.file });
  }
  snapshot(`upload of ${monthLabel(month)}`, [month]);
  // Match sheet employees to saved staff by ID and name before saving, so a new sheet never takes over
  // another person's record (and with it their salary, company and advances).
  const settings = normalizeSettings(readJson(settingsFile(), {}));
  const before = new Set(Object.keys(settings.staff));
  resolveStaffIds(settings.staff, parsed);
  store.saveMonth({ month, file: req.file.originalname, uploaded_at: new Date().toISOString(), parsed, edits: existing?.edits || {}, locked: null });
  store.setActive(month);
  registerStaff(settings, parsed);
  writeJson(settingsFile(), settings);
  res.json({ ...stateResponse(settings), upload_summary: uploadSummary(parsed, settings, before) });
}));

app.get('/api/state', (req, res) => {
  res.json(stateResponse(loadSettings()));
});

app.put('/api/settings', (req, res) => {
  const body = req.body || {};
  const settings = loadSettings();
  undoable(body.label ? String(body.label).slice(0, 80) : 'change', undefined, () => applyPatch(settings, body));
  writeJson(settingsFile(), settings);
  res.json(stateResponse(settings));
});

app.post('/api/undo', (req, res) => {
  const last = undoStack.pop();
  if (!last) throw new BadRequest('Nothing to undo');
  if (last.dataDir !== DATA_DIR) { undoStack.length = 0; throw new BadRequest('Nothing to undo'); }
  for (const [file, content] of last.files) {
    if (content === null) fs.rmSync(file, { force: true });
    else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  }
  res.json({ ...stateResponse(loadSettings()), undone: last.label });
});

// ---------- Months ----------

app.put('/api/months/active', (req, res) => {
  const m = String(req.body?.month || '');
  if (!store.loadMonth(m)) throw new BadRequest('That month is not saved');
  store.setActive(m);
  res.json(stateResponse(loadSettings()));
});

app.delete('/api/months/:month', (req, res) => {
  const rec = store.loadMonth(req.params.month);
  if (!rec) throw new BadRequest('That month is not saved');
  if (rec.locked) throw new BadRequest(`${monthLabel(rec.month)} is locked — unlock it before deleting`);
  snapshot(`delete ${monthLabel(rec.month)}`, [rec.month]);
  store.deleteMonth(rec.month);
  res.json(stateResponse(loadSettings()));
});

// Locking freezes the month's salaries (later changes to rules, salaries or advances leave it alone).
app.post('/api/months/:month/lock', (req, res) => {
  const rec = store.loadMonth(req.params.month);
  if (!rec) throw new BadRequest('That month is not saved');
  const lock = req.body?.locked !== false;
  snapshot(`${lock ? 'lock' : 'unlock'} ${monthLabel(rec.month)}`, [rec.month]);
  if (lock) {
    const settings = registerStaff(normalizeSettings(readJson(settingsFile(), {})), rec.parsed);
    rec.locked = { at: new Date().toISOString(), report: calculatePayroll(rec.parsed, settings, rec.edits) };
  } else rec.locked = null;
  store.saveMonth(rec);
  res.json(stateResponse(loadSettings()));
});

// Corrections for the open month: {days: {empId: {date: {status, note} | null}},
// adjustments: {empId: {id: {kind, label, amount} | null}}, paid: {empId: {date, note} | null}}.
app.put('/api/month/edits', (req, res) => {
  const rec = activeRecord();
  if (!rec) throw new BadRequest('Upload an attendance sheet first');
  const body = req.body || {};
  if (rec.locked && (body.days || body.adjustments)) throw new BadRequest(`${monthLabel(rec.month)} is locked — unlock it to change attendance or adjustments`);
  const emps = new Map(rec.parsed.employees.map(e => [e.id, e]));
  const empOf = id => { const e = emps.get(id); if (!e) throw new BadRequest('Employee not in this month\'s sheet'); return e; };
  const ed = rec.edits;
  undoable(body.label ? String(body.label).slice(0, 80) : 'change', [rec.month], () => {

    for (const [id, days] of Object.entries(body.days || {})) {
      const e = empOf(id);
      const dates = new Set(e.days.map(d => d.date));
      const cur = { ...ed.days[id] };
      for (const [date, fix] of Object.entries(days || {})) {
        if (!dates.has(date)) throw new BadRequest('That day is not in the sheet');
        if (fix === null) { delete cur[date]; continue; }
        if (!DAY_FIXES[fix?.status]) throw new BadRequest('Choose present, half day, absent, paid leave or off day');
        cur[date] = { status: fix.status, note: String(fix.note || '').trim().slice(0, 120) };
      }
      if (Object.keys(cur).length) ed.days[id] = cur; else delete ed.days[id];
    }

    for (const [id, items] of Object.entries(body.adjustments || {})) {
      empOf(id);
      const list = [...(ed.adjustments[id] || [])];
      for (const [aid, a] of Object.entries(items || {})) {
        if (!/^[\w-]{1,40}$/.test(aid)) throw new BadRequest('Invalid adjustment id');
        const i = list.findIndex(x => x.id === aid);
        if (a === null) { if (i >= 0) list.splice(i, 1); continue; }
        const label = String(a.label || '').trim().slice(0, 60);
        if (!label) throw new BadRequest('Describe the adjustment, e.g. Diwali bonus');
        if (!ADJUST_KINDS.includes(a.kind)) throw new BadRequest('Adjustment must be an earning or a deduction');
        const amount = nonNegative(a.amount, 'Amount');
        if (!amount) throw new BadRequest('Amount must be more than 0');
        const item = { id: aid, kind: a.kind, label, amount };
        if (i >= 0) list[i] = item; else list.push(item);
      }
      if (list.length) ed.adjustments[id] = list; else delete ed.adjustments[id];
    }

    for (const [id, p] of Object.entries(body.paid || {})) {
      empOf(id);
      if (p === null) { delete ed.paid[id]; continue; }
      if (!DATE.test(String(p?.date))) throw new BadRequest('Payment date must be a valid date');
      ed.paid[id] = { date: String(p.date), note: String(p.note || '').trim().slice(0, 120) };
    }
    store.saveMonth(rec);
  });
  res.json(stateResponse(loadSettings()));
});

app.get('/api/export.xlsx', (req, res) => {
  const report = currentReport();
  if (!report) return res.status(404).json({ error: 'Upload an attendance sheet first' });
  const label = report.period.from ? report.period.from.slice(0, 7) : 'report';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="salary_${label}.xlsx"`);
  res.send(buildWorkbook(report, report.file));
});

// Download header with a UTF-8 file name; inline opens it in the browser (to print).
const disposition = (name, inline) => attachment(name).replace(/^attachment/, inline ? 'inline' : 'attachment');
const attachment = name => `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

// Bank bulk-transfer sheet for one company's staff, paid from that company's account.
app.get('/api/companies/:id/bank-transfer.xlsx', (req, res) => {
  const settings = loadSettings();
  const report = currentReport(settings);
  if (!report) return res.status(404).json({ error: 'Upload an attendance sheet first' });
  const company = settings.companies[req.params.id];
  if (!company) return res.status(404).json({ error: 'Unknown company' });
  const name = `Bank transfer - ${company.name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim()} - ${monthLabel(report.month)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', attachment(name));
  res.send(buildBankTransfer(report, settings, req.params.id));
});

// Salary & attendance slips to send to staff: one PDF, or a ZIP with every employee's PDF.

app.get('/api/staff/:id/slip.pdf', async (req, res, next) => {
  try {
    const report = currentReport();
    if (!report) return res.status(404).json({ error: 'Upload an attendance sheet first' });
    const emp = report.employees.find(e => e.id === req.params.id);
    if (!emp) return res.status(404).json({ error: 'Employee not in the current sheet' });
    const pdf = await buildSlipPdf(report, emp);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', disposition(`${slipName(emp, report.month)}.pdf`, req.query.inline === '1'));
    res.send(Buffer.from(pdf));
  } catch (e) { next(e); }
});

app.get('/api/slips.zip', async (req, res, next) => {
  try {
    const report = currentReport();
    if (!report) return res.status(404).json({ error: 'Upload an attendance sheet first' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', attachment(`Salary slips - ${monthLabel(report.month)}.zip`));
    res.send(await buildSlipsZip(report));
  } catch (e) { next(e); }
});

// Every slip in one PDF to print (?company=<id> for one company's staff).
app.get('/api/slips.pdf', handle(async (req, res) => {
  const report = currentReport();
  if (!report) return res.status(404).json({ error: 'Upload an attendance sheet first' });
  const emps = req.query.company ? report.employees.filter(e => e.company_id === req.query.company) : report.employees;
  if (!emps.length) throw new BadRequest('No staff to print');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', disposition(`Salary slips - ${monthLabel(report.month)}.pdf`, true));
  res.send(await buildSlipsPdf(report, emps));
}));

// ---------- Staff: Excel import/export, profile ----------

app.get('/api/staff.xlsx', (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', attachment('StaffPay staff list.xlsx'));
  res.send(buildStaffWorkbook(loadSettings()));
});

// Each row is applied on its own, so one bad row doesn't stop the rest; the reply lists what happened.
app.post('/api/staff/import', upload.single('file'), (req, res) => {
  if (!req.file) throw new BadRequest('Choose the staff Excel file');
  if (!/\.(xlsx|xls)$/i.test(req.file.originalname)) throw new BadRequest('Import an Excel (.xlsx) file');
  const settings = loadSettings();
  let parsed;
  try { parsed = parseStaffWorkbook(req.file.buffer, settings); } catch (e) {
    if (e.status) throw e;
    throw new BadRequest(`Could not read the file: ${e.message}`);
  }
  snapshot('staff import');
  const result = { added: 0, updated: 0, unchanged: 0, errors: [...parsed.errors] };
  for (const { row, id, patch } of parsed.rows) {
    const before = settings.staff[id] ? JSON.stringify(settings.staff[id]) : null;
    try {
      applyPatch(settings, { staff: { [id]: patch } });
      result[before === null ? 'added' : before === JSON.stringify(settings.staff[id]) ? 'unchanged' : 'updated']++;
    } catch (e) {
      result.errors.push({ row, error: `${id}: ${e.message}` });
    }
  }
  if (!result.added && !result.updated) undoStack.pop();
  else writeJson(settingsFile(), settings);
  res.json({ ...stateResponse(loadSettings()), import: result });
});

// One person across every saved month, plus their advances.
app.get('/api/staff/:id/profile', (req, res) => {
  const settings = loadSettings();
  const staff = settings.staff[req.params.id];
  if (!staff) return res.status(404).json({ error: 'Unknown staff member' });
  const history = [];
  for (const m of store.listMonths()) {
    const e = monthReport(store.loadMonth(m), settings).employees.find(x => x.id === req.params.id);
    if (!e) continue;
    history.push({
      month: m, net: e.net_salary, base: e.base_salary, present: e.present_days, absences: e.absences, half_days: e.half_days,
      late: e.late_arrivals, overtime_minutes: e.overtime_minutes, leave_days: e.leave_days || 0,
      extra: (e.extra_earnings || 0) - (e.extra_deductions || 0), paid_on: e.paid_on || '',
      locked: Boolean(store.loadMonth(m).locked),
    });
  }
  const advances = advanceSummary(settings.advances, store.activeMonth() || thisMonth()).filter(a => a.emp_id === req.params.id);
  res.json({ id: req.params.id, staff, company: settings.companies[staff.company_id]?.name || '',
    shift: settings.shifts.find(x => x.id === staff.shift_id), history, advances });
});

// ---------- Reports ----------

app.get('/api/reports', (req, res) => {
  const settings = loadSettings();
  const entries = store.listMonths().map(m => { const rec = store.loadMonth(m); return { month: m, locked: rec.locked, report: monthReport(rec, settings) }; });
  res.json(buildReports(entries, store.activeMonth()));
});

// ---------- Folders: data folder (settings + current sheet) and output folder (saved payslips) ----------

function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  writeJson(CONFIG_FILE, config);
}
const sameDir = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

function foldersResponse() {
  const month = store.activeMonth() || thisMonth();
  return {
    data_dir: DATA_DIR, data_locked: DATA_DIR_LOCKED, output_dir: outputDir(), month_dir: monthDir(outputDir(), month),
    backup_dir: backupDir(), backups: listBackups(backupDir()),
    pin_set: Boolean(config.pin),
  };
}

app.get('/api/folders', (req, res) => res.json(foldersResponse()));

// {data_dir?, output_dir?}. A new, empty data folder gets a copy of the current settings and sheet;
// a folder that already has StaffPay data is used as it is. The old folder is left untouched.
app.put('/api/folders', (req, res) => {
  const body = req.body || {};
  let note = '';
  if (body.output_dir !== undefined) {
    const dir = cleanDir(body.output_dir, 'output folder');
    fs.mkdirSync(dir, { recursive: true });
    if (sameDir(dir, defaultOutputDir())) delete config.output_dir; else config.output_dir = dir;
  }
  if (body.backup_dir !== undefined) {
    const dir = cleanDir(body.backup_dir, 'backup folder');
    fs.mkdirSync(dir, { recursive: true });
    if (sameDir(dir, path.join(defaultOutputDir(), 'Backups'))) delete config.backup_dir; else config.backup_dir = dir;
  }
  if (body.data_dir !== undefined && !sameDir(cleanDir(body.data_dir, 'data folder'), DATA_DIR)) {
    if (DATA_DIR_LOCKED) throw new BadRequest('The data folder is set by STAFFPAY_DATA_DIR');
    const dir = cleanDir(body.data_dir, 'data folder');
    fs.mkdirSync(dir, { recursive: true });
    backupQuietly('before changing data folder');
    if (Object.keys(dataFiles(dir)).length) {
      note = 'That folder already had StaffPay data — now using it.';
    } else {
      for (const [rel, abs] of Object.entries(dataFiles(DATA_DIR))) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.copyFileSync(abs, path.join(dir, rel));
      }
      note = 'Your data was copied to the new folder.';
    }
    undoStack.length = 0;
    DATA_DIR = dir;
    migrateData();
    if (sameDir(dir, DEFAULT_DATA_DIR)) delete config.data_dir; else config.data_dir = dir;
  }
  saveConfig();
  res.json({ folders: foldersResponse(), note, ...stateResponse(loadSettings()) });
});

app.post('/api/folders/pick', async (req, res, next) => {
  try {
    const which = ['data', 'backup'].includes(req.body?.which) ? req.body.which : 'output';
    const dir = await pickFolder({ data: 'StaffPay data folder', backup: 'Folder for StaffPay backups', output: 'Folder to save payslips in' }[which],
      { data: DATA_DIR, backup: backupDir(), output: outputDir() }[which]);
    res.json({ dir });
  } catch (e) { next(e); }
});

// Opens one of StaffPay's own folders in Explorer/Finder (never an arbitrary path).
app.post('/api/folders/open', (req, res) => {
  const f = foldersResponse();
  const dir = { data: f.data_dir, output: f.output_dir, month: f.month_dir, backup: f.backup_dir }[req.body?.which];
  if (!dir) throw new BadRequest('Unknown folder');
  openFolder(dir);
  res.json({ dir });
});

// Writes every employee's slip into <output>/<YYYY>/<MM - Month>/ (same-name files are replaced).
app.post('/api/slips/save', async (req, res, next) => {
  try {
    const report = currentReport();
    if (!report) return res.status(404).json({ error: 'Upload an attendance sheet first' });
    const dir = monthDir(outputDir(), report.month);
    fs.mkdirSync(dir, { recursive: true });
    const slips = await buildSlips(report);
    for (const { name, pdf } of slips) {
      try { fs.writeFileSync(path.join(dir, name), pdf); } catch (e) {
        throw e.code === 'EBUSY' || e.code === 'EPERM' ? new BadRequest(`Close "${name}" (open in another program) and save again`) : e;
      }
    }
    res.json({ dir, count: slips.length });
  } catch (e) { next(e); }
});

// ---------- Backups ----------

const backupNow = reason => createBackup({ configFile: CONFIG_FILE, dataDir: DATA_DIR, backupDir: backupDir(), reason });
// Safety backup before risky steps; never blocks them.
function backupQuietly(reason) {
  try { backupNow(reason); } catch (e) { if (e.status !== 400) console.error('Backup failed:', e.message); }
}

app.post('/api/backup', (req, res) => {
  const file = backupNow('');
  res.json({ file, folders: foldersResponse() });
});

// Restore: a safety backup of the current data first, then the backup's data files replace the current ones.
app.post('/api/backup/restore', (req, res) => {
  const name = String(req.body?.name || '');
  if (!listBackups(backupDir(), 1000).some(b => b.name === name)) throw new BadRequest('Backup not found');
  backupQuietly('before restore');
  restoreBackup(path.join(backupDir(), name), DATA_DIR);
  undoStack.length = 0;
  migrateData();
  res.json({ ...stateResponse(loadSettings()), folders: foldersResponse() });
});

// ---------- App version and updates ----------
// The installed Windows app checks GitHub every 30 minutes; with automatic updates on it downloads a new
// release straight away and installs it once nobody has used the app for IDLE_MS (or at once on "Update now").

const IDLE_MS = 5 * 60 * 1000;
let update = { status: 'idle', progress: 0, version: null, error: null, file: null };
const updateStatus = () => ({ status: update.status, progress: update.progress, version: update.version, error: update.error });

async function appInfo(force = false) {
  return { ...(await versionInfo(pkg, { force })), can_self_update: canSelfUpdate(), auto_update: autoUpdate(), update: updateStatus() };
}

function installUpdate() {
  update.status = 'installing';
  backupQuietly(`before v${update.version}`);
  try {
    runInstaller(update.file);
  } catch (e) {
    update = { ...update, status: 'error', error: `Could not start the installer: ${e.message}` };
    return;
  }
  console.log(`Installing StaffPay ${update.version} — StaffPay will restart.`);
  setTimeout(() => process.exit(0), 1500); // let the status response reach the page first
}

async function updateTick({ force = false, installNow = false } = {}) {
  if (!canSelfUpdate() || ['downloading', 'installing'].includes(update.status)) return;
  const info = await versionInfo(pkg, { force });
  if (!info.update_available || !info.setup || (!installNow && !autoUpdate())) return;
  if (update.status !== 'ready' || update.version !== info.latest) {
    update = { status: 'downloading', progress: 0, version: info.latest, error: null, file: null };
    try {
      update.file = await downloadSetup(info.setup, info.latest, p => (update.progress = p));
      update.status = 'ready';
      update.progress = 1;
    } catch (e) {
      update = { ...update, status: 'error', error: e.message || String(e) };
      return;
    }
  }
  if (installNow || Date.now() - lastActivity >= IDLE_MS) installUpdate();
}

app.get('/api/version', async (req, res) => res.json(await appInfo(req.query.force === '1')));
app.get('/api/update', (req, res) => res.json(updateStatus()));

app.put('/api/app', handle(async (req, res) => {
  if (typeof req.body?.auto_update !== 'boolean') throw new BadRequest('auto_update must be true or false');
  config.auto_update = req.body.auto_update;
  saveConfig();
  if (config.auto_update) updateTick().catch(() => {});
  res.json(await appInfo());
}));

// "Update now": download (if needed) and install the latest release.
app.post('/api/update', handle(async (req, res) => {
  if (!canSelfUpdate()) throw new BadRequest('This copy of StaffPay can\'t update itself — download the installer instead');
  const info = await versionInfo(pkg, { force: true });
  if (!info.latest) throw new BadRequest('Could not reach GitHub — check the internet connection');
  if (!info.update_available) throw new BadRequest(`StaffPay ${pkg.version} is the latest version`);
  updateTick({ installNow: true }).catch(e => (update = { ...update, status: 'error', error: e.message }));
  res.json(updateStatus());
}));

if (canSelfUpdate()) {
  setTimeout(() => updateTick().catch(() => {}), 15 * 1000);
  setInterval(() => updateTick().catch(() => {}), 5 * 60 * 1000).unref();
}

// ---------- PIN lock ----------

app.get('/api/auth', (req, res) => {
  res.json({ pin_set: Boolean(config.pin), unlocked: !config.pin || sessions.touch(auth.readCookie(req)) });
});

app.post('/api/auth/unlock', (req, res) => {
  if (!config.pin) return res.json({ unlocked: true });
  const wait = sessions.waitSeconds();
  if (wait) return res.status(429).json({ error: `Too many wrong PINs — try again in ${wait} seconds` });
  if (!auth.verifyPin(req.body?.pin, config.pin)) { sessions.failed(); throw new BadRequest('Wrong PIN'); }
  sessions.succeeded();
  res.setHeader('Set-Cookie', auth.sessionCookie(sessions.create()));
  res.json({ unlocked: true });
});

app.post('/api/auth/lock', (req, res) => {
  sessions.remove(auth.readCookie(req));
  res.setHeader('Set-Cookie', auth.clearCookie());
  res.json({ unlocked: false });
});

// {current, pin}: set, change ('current' needed once a PIN exists) or remove (pin '') the PIN.
app.put('/api/auth/pin', (req, res) => {
  const { current, pin } = req.body || {};
  if (config.pin) {
    // Only from an unlocked app, and wrong guesses count like at the lock screen.
    if (!sessions.touch(auth.readCookie(req))) return res.status(401).json({ error: 'StaffPay is locked — enter your PIN', code: 'locked' });
    const wait = sessions.waitSeconds();
    if (wait) return res.status(429).json({ error: `Too many wrong PINs — try again in ${wait} seconds` });
    if (!auth.verifyPin(current, config.pin)) { sessions.failed(); throw new BadRequest('Current PIN is wrong'); }
    sessions.succeeded();
  }
  sessions.clear();
  if (!pin) {
    delete config.pin;
    saveConfig();
    res.setHeader('Set-Cookie', auth.clearCookie());
    return res.json({ pin_set: false });
  }
  if (!auth.PIN.test(String(pin))) throw new BadRequest('PIN must be 4 to 8 digits');
  config.pin = auth.hashPin(pin);
  saveConfig();
  res.setHeader('Set-Cookie', auth.sessionCookie(sessions.create()));
  res.json({ pin_set: true });
});

// ---------- Data migrations ----------
// Month history: data/current_upload.json moves to data/months/. v5: duplicate-ID staff keys "<id>_2"…
// become "<id>_1"… (in staff, advances and every saved month).
function migrateData() {
  const moved = store.migrateLegacy();
  if (moved) console.log(`Moved the current sheet into month history (${moved})`);
  const raw = readJson(settingsFile(), null);
  if (!raw || raw.version >= 5) return;
  const renames = renumberDuplicateIds(raw);
  if (Object.keys(renames).length) {
    backupQuietly('before employee ID update');
    for (const m of store.listMonths()) {
      const rec = store.loadMonth(m);
      let changed = false;
      for (const e of rec.parsed.employees) if (renames[e.id]) { e.id = renames[e.id]; changed = true; }
      if (changed) store.saveMonth(rec);
    }
    console.log(`Renamed duplicate employee IDs: ${Object.entries(renames).map(([a, b]) => `${a} → ${b}`).join(', ')}`);
  }
  writeJson(settingsFile(), { ...normalizeSettings(raw), version: SETTINGS_VERSION });
}
migrateData();

app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
const shouldOpen = (PACKAGED || process.argv.includes('--open')) && !process.argv.includes('--no-open');

// Is the thing on our port already StaffPay? (e.g. the shortcut was clicked twice)
function isStaffPayRunning() {
  return new Promise(resolve => {
    const req = http.get(`${URL}/api/version`, { timeout: 2000 }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => { try { resolve(Boolean(JSON.parse(body).version)); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// No login: only listen on this machine.
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`StaffPay ${pkg.version} running at ${URL}`);
  console.log(`Data folder: ${DATA_DIR}`);
  console.log(`Payslips folder: ${outputDir()}`);
  if (PACKAGED) console.log('\nKeep this window open while using StaffPay. Close it to stop the app.');
  if (shouldOpen) openBrowser(URL);
});
server.on('error', async err => {
  if (err.code === 'EADDRINUSE' && await isStaffPayRunning()) {
    console.log(`StaffPay is already running — opening ${URL}`);
    if (shouldOpen) openBrowser(URL);
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  console.error(err.code === 'EADDRINUSE'
    ? `Port ${PORT} is used by another program. Close it, or set the PORT environment variable.`
    : err.message);
  // Give the user time to read the message before the window closes.
  setTimeout(() => process.exit(1), PACKAGED ? 20000 : 0);
});
