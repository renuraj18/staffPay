// Month history: every uploaded sheet is kept as data/months/YYYY-MM.json
//   { month, file, uploaded_at, parsed, edits: {days, adjustments, paid}, locked: null | {at, report} }
// and data/meta.json remembers which month is open ({active_month}).
const fs = require('fs');
const path = require('path');
const { reportMonth } = require('./payroll');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function createStore(dataDir) {
  const monthsDir = () => path.join(dataDir(), 'months');
  const metaFile = () => path.join(dataDir(), 'meta.json');
  const monthFile = m => {
    if (!MONTH.test(String(m))) throw Object.assign(new Error('Invalid month'), { status: 400 });
    return path.join(monthsDir(), `${m}.json`);
  };

  // Newest first.
  function listMonths() {
    let names;
    try { names = fs.readdirSync(monthsDir()); } catch { return []; }
    return names.map(n => n.replace(/\.json$/, '')).filter(m => MONTH.test(m)).sort().reverse();
  }

  function loadMonth(m) {
    if (!m) return null;
    const rec = readJson(monthFile(m), null);
    if (!rec) return null;
    rec.edits = { days: {}, adjustments: {}, paid: {}, ...rec.edits };
    return rec;
  }
  const saveMonth = rec => writeJson(monthFile(rec.month), rec);
  const deleteMonth = m => fs.rmSync(monthFile(m), { force: true });

  // The open month: the one chosen last, else the newest.
  function activeMonth() {
    const months = listMonths();
    const chosen = readJson(metaFile(), {}).active_month;
    return months.includes(chosen) ? chosen : months[0] || null;
  }
  const setActive = m => writeJson(metaFile(), { ...readJson(metaFile(), {}), active_month: m });

  // Before month history the one sheet lived in data/current_upload.json: move it into months/ (kept as .migrated).
  function migrateLegacy() {
    const legacy = path.join(dataDir(), 'current_upload.json');
    const upload = readJson(legacy, null);
    if (!upload?.parsed) return null;
    const month = reportMonth(upload.parsed);
    if (!MONTH.test(month)) return null;
    if (!fs.existsSync(monthFile(month))) {
      saveMonth({ month, file: upload.file, uploaded_at: upload.uploaded_at, parsed: upload.parsed, edits: {}, locked: null });
    }
    if (!activeMonth() || !readJson(metaFile(), {}).active_month) setActive(month);
    fs.renameSync(legacy, `${legacy}.migrated`);
    return month;
  }

  return { monthsDir, metaFile, monthFile, listMonths, loadMonth, saveMonth, deleteMonth, activeMonth, setActive, migrateLegacy };
}

module.exports = { createStore, readJson, writeJson, MONTH };
