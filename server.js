const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const { DEFAULT_RULES, normalizeSettings, parseWorkbook, parseSheets, calculatePayroll, advanceSummary, resolveStaffIds } = require('./lib/payroll');
const { pdfToSheets } = require('./lib/pdf');
const { buildWorkbook, buildBankTransfer, monthLabel } = require('./lib/export');
const { buildSlipPdf, buildSlipsZip, slipName } = require('./lib/slip');
const { versionInfo } = require('./lib/update');
const pkg = require('./package.json');

const PORT = Number(process.env.PORT || 8000);
const URL = `http://127.0.0.1:${PORT}`;
// Packaged Windows app (pkg sets process.pkg): keep data in the user's profile so
// reinstalling or updating never touches it. From source: ./data.
const PACKAGED = Boolean(process.pkg);
const DATA_DIR = process.env.STAFFPAY_DATA_DIR
  || (PACKAGED ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'StaffPay', 'data') : path.join(__dirname, 'data'));
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const UPLOAD_FILE = path.join(DATA_DIR, 'current_upload.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
const loadUpload = () => readJson(UPLOAD_FILE, null);
function loadSettings() {
  const settings = normalizeSettings(readJson(SETTINGS_FILE, {}));
  const upload = loadUpload();
  return upload ? registerStaff(settings, upload.parsed) : settings;
}

function currentReport(settings = loadSettings()) {
  const upload = loadUpload();
  if (!upload) return null;
  return { file: upload.file, uploaded_at: upload.uploaded_at, ...calculatePayroll(upload.parsed, settings) };
}

// Advances are listed for the uploaded sheet's month (or this month when nothing is uploaded).
function stateResponse(settings) {
  const report = currentReport(settings);
  const now = new Date();
  const month = report?.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { settings, report, month, advances: advanceSummary(settings.advances, month) };
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
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an attendance sheet' });
  const pdf = /\.pdf$/i.test(req.file.originalname);
  if (!pdf && !/\.(xlsx|xlsm|xls)$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Upload an Excel (.xlsx, .xls) or PDF file' });
  let parsed;
  try { parsed = pdf ? parseSheets(await pdfToSheets(req.file.buffer)) : parseWorkbook(req.file.buffer); } catch (e) {
    return res.status(400).json({ error: `Could not read ${pdf ? 'PDF' : 'workbook'}: ${e.message || e}` });
  }
  if (!parsed.employees.length) return res.status(400).json({ error: `No employee attendance found in this ${pdf ? 'PDF' : 'workbook'}`, warnings: parsed.warnings });
  // Match sheet employees to saved staff by ID and name before saving, so a new sheet never takes over
  // another person's record (and with it their salary, company and advances).
  const settings = normalizeSettings(readJson(SETTINGS_FILE, {}));
  resolveStaffIds(settings.staff, parsed);
  writeJson(UPLOAD_FILE, { file: req.file.originalname, uploaded_at: new Date().toISOString(), parsed });
  registerStaff(settings, parsed);
  writeJson(SETTINGS_FILE, settings);
  res.json(stateResponse(settings));
});

app.get('/api/version', async (req, res) => res.json(await versionInfo(pkg)));

app.get('/api/state', (req, res) => {
  res.json(stateResponse(loadSettings()));
});

app.put('/api/settings', (req, res) => {
  const settings = applyPatch(loadSettings(), req.body || {});
  writeJson(SETTINGS_FILE, settings);
  res.json(stateResponse(settings));
});

app.get('/api/export.xlsx', (req, res) => {
  const report = currentReport();
  if (!report) return res.status(404).json({ error: 'Upload an attendance sheet first' });
  const label = report.period.from ? report.period.from.slice(0, 7) : 'report';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="salary_${label}.xlsx"`);
  res.send(buildWorkbook(report, report.file));
});

// Download header with a UTF-8 file name.
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
    res.setHeader('Content-Disposition', attachment(`${slipName(emp, report.month)}.pdf`));
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
