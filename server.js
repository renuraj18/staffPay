const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const { DEFAULT_RULES, normalizeSettings, parseWorkbook, calculatePayroll } = require('./lib/payroll');
const { buildWorkbook } = require('./lib/export');
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

// Make sure every employee in the sheet has a staff entry (keeps the name current).
function registerStaff(settings, parsed) {
  for (const e of parsed.employees) {
    settings.staff[e.id] = { shift_id: settings.shifts[0].id, ...settings.staff[e.id], name: e.name };
  }
  return settings;
}

class BadRequest extends Error { constructor(msg) { super(msg); this.status = 400; } }
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
function nonNegative(v, label) {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n) || n < 0) throw new BadRequest(`${label} must be a number of 0 or more`);
  return n;
}

function applyPatch(settings, body) {
  for (const [k, v] of Object.entries(body.rules || {})) {
    if (!(k in DEFAULT_RULES)) continue;
    if (k === 'sunday_logout_time') {
      if (!TIME.test(String(v))) throw new BadRequest('Sunday finish time must be HH:MM');
      settings.rules[k] = String(v);
      continue;
    }
    if (k === 'weekends_working') { settings.rules[k] = v === true || Number(v) === 1 ? 1 : 0; continue; }
    settings.rules[k] = nonNegative(v, k.replace(/_/g, ' '));
    if (k === 'salary_divisor' && settings.rules[k] === 0) throw new BadRequest('Salary divisor must be more than 0');
  }

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
    settings.staff[id] = cur;
  }
  return settings;
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an attendance workbook' });
  if (!/\.(xlsx|xlsm|xls)$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Upload an Excel file (.xlsx, .xls)' });
  let parsed;
  try { parsed = parseWorkbook(req.file.buffer); } catch (e) {
    return res.status(400).json({ error: `Could not read workbook: ${e.message}` });
  }
  if (!parsed.employees.length) return res.status(400).json({ error: 'No employee attendance found in this workbook', warnings: parsed.warnings });
  writeJson(UPLOAD_FILE, { file: req.file.originalname, uploaded_at: new Date().toISOString(), parsed });
  const settings = registerStaff(loadSettings(), parsed);
  writeJson(SETTINGS_FILE, settings);
  res.json({ settings, report: currentReport(settings) });
});

app.get('/api/version', async (req, res) => res.json(await versionInfo(pkg)));

app.get('/api/state', (req, res) => {
  const settings = loadSettings();
  res.json({ settings, report: currentReport(settings) });
});

app.put('/api/settings', (req, res) => {
  const settings = applyPatch(loadSettings(), req.body || {});
  writeJson(SETTINGS_FILE, settings);
  res.json({ settings, report: currentReport(settings) });
});

app.get('/api/export.xlsx', (req, res) => {
  const report = currentReport();
  if (!report) return res.status(404).json({ error: 'Upload an attendance sheet first' });
  const label = report.period.from ? report.period.from.slice(0, 7) : 'report';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="salary_${label}.xlsx"`);
  res.send(buildWorkbook(report, report.file));
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
