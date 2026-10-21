// Backups: one ZIP with the folder config and all data (settings, month history, open month).
const fs = require('fs');
const path = require('path');
const { zipSync, unzipSync } = require('fflate');

// Data folder files that make up StaffPay's data (current_upload.json: before month history).
const ROOT_FILES = ['settings.json', 'meta.json', 'current_upload.json'];
const PREFIX = 'StaffPay backup ';
const MONTH_FILE = /^\d{4}-(0[1-9]|1[0-2])\.json$/;

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// The data files as {relative path: absolute path}: settings.json, meta.json, months/YYYY-MM.json, …
function dataFiles(dataDir) {
  const files = {};
  for (const f of ROOT_FILES) if (fs.existsSync(path.join(dataDir, f))) files[f] = path.join(dataDir, f);
  let months = [];
  try { months = fs.readdirSync(path.join(dataDir, 'months')).filter(n => MONTH_FILE.test(n)); } catch { /* none yet */ }
  for (const n of months) files[`months/${n}`] = path.join(dataDir, 'months', n);
  return files;
}

// Zip layout: config.json, data/<data files>, backup.json (missing files are skipped).
function createBackup({ configFile, dataDir, backupDir, reason = '', now = new Date() }) {
  const files = {};
  if (fs.existsSync(configFile)) files['config.json'] = fs.readFileSync(configFile);
  for (const [rel, abs] of Object.entries(dataFiles(dataDir))) files[`data/${rel}`] = fs.readFileSync(abs);
  if (!Object.keys(files).some(f => f.startsWith('data/'))) throw Object.assign(new Error('Nothing to back up yet'), { status: 400 });
  files['backup.json'] = Buffer.from(JSON.stringify({ created_at: now.toISOString(), reason, data_dir: dataDir }, null, 2));
  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `${PREFIX}${stamp(now)}${reason ? ` (${reason})` : ''}.zip`);
  fs.writeFileSync(file, zipSync(files));
  return file;
}

// Newest first: [{name, size, created_at}].
function listBackups(backupDir, limit = 8) {
  let names;
  try { names = fs.readdirSync(backupDir); } catch { return []; }
  return names
    .filter(n => n.startsWith(PREFIX) && n.endsWith('.zip'))
    .map(name => { const st = fs.statSync(path.join(backupDir, name)); return { name, size: st.size, created_at: st.mtime.toISOString() }; })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

// Replaces the data folder's StaffPay files with the backup's data/ files (config.json — the folder
// choices — is left as it is). Returns the restored relative paths.
function restoreBackup(zipFile, dataDir) {
  const zip = unzipSync(fs.readFileSync(zipFile));
  const entries = Object.entries(zip).filter(([n]) => n.startsWith('data/'))
    .map(([n, buf]) => [n.slice(5), buf])
    .filter(([rel]) => ROOT_FILES.includes(rel) || (rel.startsWith('months/') && MONTH_FILE.test(rel.slice(7))));
  if (!entries.some(([rel]) => rel === 'settings.json')) throw Object.assign(new Error('This backup has no StaffPay data'), { status: 400 });
  for (const [rel, buf] of entries) {
    try { JSON.parse(Buffer.from(buf).toString('utf8')); } catch {
      throw Object.assign(new Error(`The backup's ${rel} is damaged — nothing was restored`), { status: 400 });
    }
  }
  for (const [rel, abs] of Object.entries(dataFiles(dataDir))) if (!zip[`data/${rel}`]) fs.rmSync(abs, { force: true });
  for (const [rel, buf] of entries) {
    const dest = path.join(dataDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  return entries.map(([rel]) => rel);
}

module.exports = { createBackup, listBackups, restoreBackup, dataFiles };
