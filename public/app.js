const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => inr.format(Number(n || 0));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const initials = name => String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const ICON = {
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M16 15h2"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};

let report = null;
let settings = null;
const openRows = new Set();
const selected = new Set();
let staffFilter = 'all';
const shiftDrafts = new Map();   // shift id -> edited (unsaved) shift
const newShifts = new Set();     // ids of shifts added but not saved yet

// ---------- Helpers ----------
function toast(msg, error = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 4000);
}

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function flashSaved() {
  const els = document.querySelectorAll('[data-saved]');
  els.forEach(el => (el.textContent = '✓ Saved'));
  clearTimeout(flashSaved.timer);
  flashSaved.timer = setTimeout(() => els.forEach(el => (el.textContent = '')), 1600);
}

async function saveSettings(patch) {
  try {
    const res = await api('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    settings = res.settings;
    report = res.report;
    renderAll();
    flashSaved();
    return true;
  } catch (err) {
    toast(err.message, true);
    renderAll(); // show the saved values again
    return false;
  }
}

const divisor = () => Number(settings.rules.salary_divisor) || 30.5;
const savedShifts = () => settings.shifts;
const shiftById = id => savedShifts().find(s => s.id === id) || savedShifts()[0];
const reportEmployee = id => report?.employees.find(e => e.id === id);

// ---------- Rendering ----------
function setTab(tab) {
  if (!['salary', 'staff', 'shifts'].includes(tab)) tab = 'salary';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('hidden', s.id !== `tab-${tab}`));
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}
$('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));

// Re-rendering replaces inputs; keep focus and caret on the field being edited.
function renderAll() {
  const active = document.activeElement;
  const key = active?.dataset?.key;
  let caret = null;
  try { caret = active.selectionStart; } catch { /* not a text input */ }

  renderSheetCard();
  renderSalary();
  renderStaff();
  renderShifts();
  fillRules();
  $('staff-count').textContent = Object.keys(settings.staff).length || '';
  $('shift-count').textContent = settings.shifts.length;
  document.querySelectorAll('[data-divisor]').forEach(el => (el.textContent = divisor()));
  setTab(location.hash.slice(1));

  if (key) {
    const el = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el && el !== document.activeElement) {
      el.focus();
      try { if (caret !== null) el.setSelectionRange(caret, caret); } catch { /* number inputs */ }
    }
  }
}

function renderSheetCard() {
  $('sheet-card').classList.toggle('hidden', !report);
  if (!report) return;
  $('sheet-company').textContent = report.company || 'Attendance report';
  $('sheet-period').textContent = report.period.from ? `${fmtDate(report.period.from)} – ${fmtDate(report.period.to)}` : '';
  $('sheet-file').textContent = report.file;
  $('sheet-file').title = report.file;
}

// ---------- Upload ----------
function showUpload(on) {
  $('upload-view').classList.toggle('hidden', !on);
  $('report-view').classList.toggle('hidden', on);
  $('salary-actions').classList.toggle('hidden', on || !report);
  $('cancel-upload').classList.toggle('hidden', !(on && report));
}

async function uploadFile(file) {
  if (!file) return;
  $('upload-error').classList.add('hidden');
  $('progress').classList.remove('hidden');
  const body = new FormData();
  body.append('file', file);
  try {
    ({ settings, report } = await api('/api/upload', { method: 'POST', body }));
    openRows.clear();
    selected.clear();
    showUpload(false);
    renderAll();
    toast(`Read ${report.employees.length} employees from ${file.name}`);
  } catch (e) {
    $('upload-error').textContent = e.message;
    $('upload-error').classList.remove('hidden');
  } finally {
    $('progress').classList.add('hidden');
    $('file').value = '';
  }
}

const dz = $('dropzone');
$('file').addEventListener('change', e => uploadFile(e.target.files[0]));
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e => uploadFile(e.dataTransfer.files[0]));
for (const id of ['btn-new', 'btn-new-mobile']) {
  $(id)?.addEventListener('click', () => { setTab('salary'); showUpload(true); });
}
$('btn-cancel').addEventListener('click', () => showUpload(false));

// ---------- Salary page ----------
function renderSalary() {
  if (!report) {
    $('salary-sub').textContent = 'Upload the biometric attendance sheet to calculate salary.';
    showUpload(true);
    return;
  }
  if ($('upload-view').classList.contains('hidden')) showUpload(false);
  const r = report;
  $('salary-sub').textContent = `${r.company || 'Attendance'} · ${r.period.from ? `${fmtDate(r.period.from)} – ${fmtDate(r.period.to)}` : ''} · ${r.calendar_days} days`;

  const w = $('warnings');
  w.classList.toggle('hidden', !r.warnings.length);
  w.innerHTML = r.warnings.length
    ? `<details><summary>${r.warnings.length} item${r.warnings.length > 1 ? 's' : ''} to check</summary><ul>${r.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`
    : '';

  const t = r.totals;
  const stat = (label, value, icon, cls = '') =>
    `<div class="stat ${cls}"><div class="top"><span class="label">${label}</span><span class="chip">${icon}</span></div><div class="value">${value}</div></div>`;
  $('stats').innerHTML =
    stat('Employees', r.employees.length, ICON.people) +
    stat('Monthly salaries', money(t.base_salary), ICON.wallet) +
    stat('Attendance deductions', money(t.attendance_deduction), ICON.minus, 'ded') +
    stat('Fines', money(t.total_fines), ICON.alert, 'fine') +
    stat('Net payable', money(t.net_salary), ICON.check, 'net');

  $('salary-table').tBodies[0].innerHTML = r.employees.map(e => {
    const open = openRows.has(e.id);
    const row = `
      <tr class="emp ${open ? 'open' : ''}" data-id="${esc(e.id)}">
        <td><div class="person">${ICON.chev}<span class="avatar">${esc(initials(e.name))}</span>
          <div><div class="name">${esc(e.name)}</div><div class="id">#${esc(e.id)}</div></div></div></td>
        <td><span class="pill shift" title="${esc(e.shift_time)}">${esc(e.shift_name)}</span></td>
        <td class="num">${money(e.monthly_salary)}${e.salary_mapped ? '' : '<div class="default-note" title="No salary entered — using the default monthly salary">default</div>'}</td>
        <td class="num">${e.present_days}</td>
        <td class="num">${e.half_days || '<span class="dim">–</span>'}</td>
        <td class="num">${e.absences}${e.excess_absences ? ` <span class="excess">(${e.excess_absences})</span>` : ''}</td>
        <td class="num">${e.off_days}</td>
        <td class="num">${e.late_arrivals}</td>
        <td class="num">${e.missing_punches ? `<span class="count-miss">${e.missing_punches}</span>` : '0'}</td>
        <td class="num ${e.attendance_deduction ? 'neg' : 'dim'}">${e.attendance_deduction ? '−' + money(e.attendance_deduction) : '–'}</td>
        <td class="num ${e.total_fines ? 'neg' : 'dim'}">${e.total_fines ? '−' + money(e.total_fines) : '–'}</td>
        <td class="num net">${money(e.net_salary)}</td>
      </tr>`;
    return row + (open ? detailRow(e) : '');
  }).join('');

  $('salary-table').tFoot.innerHTML = `
    <tr>
      <td>Total · ${r.employees.length} staff</td><td></td>
      <td class="num">${money(t.base_salary)}</td>
      <td class="num">${t.present_days}</td><td class="num">${t.half_days}</td><td class="num">${t.absences}</td>
      <td class="num">${t.off_days}</td><td class="num">${t.late_arrivals}</td>
      <td class="num">${t.missing_punches}</td>
      <td class="num">${money(t.attendance_deduction)}</td><td class="num">${money(t.total_fines)}</td>
      <td class="num">${money(t.net_salary)}</td>
    </tr>`;
}

function dayClass(d) {
  if (d.off || d.holiday) return 'c-off';
  if (d.absent) return 'c-absent';
  if (d.half) return 'c-half';
  if (d.missing) return 'c-missing';
  if (d.late) return 'c-late';
  return 'c-present';
}

function detailRow(e) {
  const tiles = e.days.map(d => {
    const [y, m, dd] = d.date.split('-').map(Number);
    const wd = WEEKDAYS[new Date(y, m - 1, dd).getDay()];
    const flags = [d.late && 'LATE', d.missing_in && 'NO IN', d.missing_out && 'NO OUT']
      .filter(Boolean).map(f => `<span class="flag">${f}</span>`).join('');
    const times = d.clock_in || d.clock_out ? `${d.clock_in || '—'} → ${d.clock_out || '—'}` : '&nbsp;';
    return `<div class="day ${dayClass(d)} ${d.unknown ? 'c-unknown' : ''}" title="${esc((d.status || 'No status') + (d.moved ? ' · single evening punch read as log-off' : ''))}">
      <div class="d">${dd} <span>${wd}${d.sunday && !d.absent && !d.off ? ' · short' : ''}</span></div>
      <div class="cat">${esc(d.category)}</div>
      <div class="t">${times}</div>
      ${flags ? `<div class="flags">${flags}</div>` : ''}
    </div>`;
  }).join('');

  const parts = [
    `Monthly <b>${money(e.monthly_salary)}</b>`,
    `Daily rate ${inr2.format(e.daily_salary)} <span class="dim">(÷ ${divisor()})</span>`,
    e.excess_absences ? `Excess absences ${e.excess_absences} <span class="dim">of ${e.absences}, ${e.allowed_absences} paid</span>` : `Absences ${e.absences} <span class="dim">within allowance</span>`,
    e.half_days ? `Half days ${e.half_days}` : '',
    e.attendance_deduction ? `Deduction <b class="neg">−${money(e.attendance_deduction)}</b>` : '',
    e.late_fine ? `Late fines −${money(e.late_fine)}` : '',
    e.missing_punch_fine ? `Missing punch fines −${money(e.missing_punch_fine)}` : '',
    `Net <b>${money(e.net_salary)}</b>`,
  ].filter(Boolean);

  return `<tr class="detail"><td colspan="12">
    <div class="legend">
      <span><i class="c-present"></i>Present</span><span><i class="c-late"></i>Late</span><span><i class="c-missing"></i>Missing punch</span>
      <span><i class="c-half"></i>Half day</span><span><i class="c-absent"></i>Absent</span><span><i class="c-off"></i>Weekly off / holiday</span>
    </div>
    <div class="days">${tiles}</div>
    <div class="breakdown">${parts.map(p => `<span>${p}</span>`).join('')}</div>
  </td></tr>`;
}

$('salary-table').tBodies[0].addEventListener('click', e => {
  const tr = e.target.closest('tr.emp');
  if (!tr) return;
  const id = tr.dataset.id;
  openRows.has(id) ? openRows.delete(id) : openRows.add(id);
  renderSalary();
});

// ---------- Rules drawer ----------
const form = $('rules-form');
function openRules(open) {
  $('rules-drawer').classList.toggle('open', open);
  $('rules-drawer').setAttribute('aria-hidden', String(!open));
  $('drawer-backdrop').classList.toggle('hidden', !open);
  if (open) setTimeout(() => form.elements[0].focus(), 50);
}
$('btn-rules').addEventListener('click', () => openRules(true));
$('btn-close-rules').addEventListener('click', () => openRules(false));
$('drawer-backdrop').addEventListener('click', () => openRules(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') openRules(false); });

function fillRules() {
  for (const [k, v] of Object.entries(settings.rules)) {
    const el = form.elements[k];
    if (!el || document.activeElement === el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(Number(v)); else el.value = v;
  }
}
let rulesTimer;
form.addEventListener('input', () => {
  clearTimeout(rulesTimer);
  rulesTimer = setTimeout(() => {
    const rules = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') rules[el.name] = el.checked ? 1 : 0;
      else if (el.value !== '') rules[el.name] = el.value;
    }
    saveSettings({ rules });
  }, 500);
});
form.addEventListener('submit', e => e.preventDefault());

// ---------- Staff page ----------
const shiftOptions = current => savedShifts().map(s =>
  `<option value="${esc(s.id)}" ${s.id === current ? 'selected' : ''}>${esc(s.name)} · ${esc(s.login_time)}–${esc(s.logout_time)}</option>`).join('');

function staffList() {
  const inSheet = new Set(report?.employees.map(e => e.id) || []);
  return Object.entries(settings.staff)
    .map(([id, s]) => ({ id, ...s, inSheet: inSheet.has(id) }))
    .sort((a, b) => (b.inSheet - a.inSheet) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function renderStaff() {
  const all = staffList();
  if (staffFilter !== 'all' && !savedShifts().some(s => s.id === staffFilter)) staffFilter = 'all';
  const count = id => all.filter(s => s.shift_id === id).length;
  $('staff-filter').innerHTML =
    `<button data-filter="all" class="${staffFilter === 'all' ? 'active' : ''}">All<span class="n">${all.length}</span></button>` +
    savedShifts().map(s => `<button data-filter="${esc(s.id)}" class="${staffFilter === s.id ? 'active' : ''}">${esc(s.name)}<span class="n">${count(s.id)}</span></button>`).join('');

  const bulk = $('bulk-shift');
  const keep = bulk.value;
  bulk.innerHTML = shiftOptions(savedShifts().some(s => s.id === keep) ? keep : savedShifts()[0].id);

  for (const id of [...selected]) if (!settings.staff[id]) selected.delete(id);
  const rows = all.filter(s => staffFilter === 'all' || s.shift_id === staffFilter);
  $('staff-empty').classList.toggle('hidden', all.length > 0);
  $('staff-toolbar').classList.toggle('hidden', all.length === 0);

  const def = Number(settings.rules.monthly_salary);
  $('staff-table').tBodies[0].innerHTML = rows.map(s => {
    const e = reportEmployee(s.id);
    const monthly = s.salary ?? '';
    const rate = (monthly === '' ? def : Number(monthly)) / divisor();
    return `<tr data-id="${esc(s.id)}" class="${selected.has(s.id) ? 'selected' : ''}">
      <td class="check"><input type="checkbox" class="pick" ${selected.has(s.id) ? 'checked' : ''} aria-label="Select ${esc(s.name)}"></td>
      <td><div class="person"><span class="avatar">${esc(initials(s.name))}</span>
        <div><div class="name">${esc(s.name || 'Unnamed')}</div><div class="id">#${esc(s.id)}${s.inSheet ? '' : ' · not in current sheet'}</div></div></div></td>
      <td><select class="input" data-field="shift_id" data-key="staff:${esc(s.id)}:shift" aria-label="Shift">${shiftOptions(s.shift_id)}</select></td>
      <td class="num"><input class="input amount" data-field="salary" data-key="staff:${esc(s.id)}:salary" type="number" min="0" step="1"
        value="${esc(monthly)}" placeholder="${esc(def)}" title="Leave blank to use the default monthly salary" aria-label="Monthly salary for ${esc(s.name)}"></td>
      <td class="num rate-cell">${inr2.format(rate)}</td>
      <td class="num">${e ? `<b>${money(e.net_salary)}</b>` : '<span class="dim">–</span>'}</td>
    </tr>`;
  }).join('');
  updateSelection();
}

function updateSelection() {
  $('selected-count').textContent = `${selected.size} selected`;
  $('btn-bulk-shift').disabled = selected.size === 0;
  const boxes = [...document.querySelectorAll('#staff-table .pick')];
  const checkAll = $('check-all');
  checkAll.checked = boxes.length > 0 && boxes.every(b => b.checked);
  checkAll.indeterminate = !checkAll.checked && boxes.some(b => b.checked);
}

$('staff-filter').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  staffFilter = b.dataset.filter;
  renderStaff();
});

// Live daily-rate preview while typing a monthly salary.
$('staff-table').addEventListener('input', e => {
  if (e.target.dataset.field !== 'salary') return;
  const v = e.target.value.trim();
  const monthly = v === '' ? Number(settings.rules.monthly_salary) : Number(v);
  e.target.closest('tr').querySelector('.rate-cell').textContent = Number.isFinite(monthly) ? inr2.format(monthly / divisor()) : '–';
});

$('staff-table').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.field === 'salary') e.target.blur();
});

$('staff-table').addEventListener('change', e => {
  if (e.target.id === 'check-all') {
    document.querySelectorAll('#staff-table tbody tr[data-id]').forEach(row => {
      e.target.checked ? selected.add(row.dataset.id) : selected.delete(row.dataset.id);
      row.classList.toggle('selected', e.target.checked);
      row.querySelector('.pick').checked = e.target.checked;
    });
    return updateSelection();
  }
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const id = tr.dataset.id;
  if (e.target.classList.contains('pick')) {
    e.target.checked ? selected.add(id) : selected.delete(id);
    tr.classList.toggle('selected', e.target.checked);
    return updateSelection();
  }
  const field = e.target.dataset.field;
  if (field === 'salary') {
    const v = e.target.value.trim();
    saveSettings({ staff: { [id]: { salary: v === '' ? null : v } } });
  } else if (field === 'shift_id') {
    saveSettings({ staff: { [id]: { shift_id: e.target.value } } });
  }
});

$('btn-bulk-shift').addEventListener('click', async () => {
  const shift_id = $('bulk-shift').value;
  const staff = Object.fromEntries([...selected].map(id => [id, { shift_id }]));
  const n = selected.size;
  selected.clear();
  if (await saveSettings({ staff })) toast(`Moved ${n} staff to ${shiftById(shift_id).name}`);
});

// ---------- Shifts page ----------
// Shift cards are edited locally and only saved with the card's Save button (or Enter),
// so typing into time fields is never interrupted by a save + re-render.
const toMin = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

function cardShifts() {
  return [...savedShifts().map(s => shiftDrafts.get(s.id) || s), ...[...newShifts].map(id => shiftDrafts.get(id))];
}

function timelineHTML(s) {
  const a = toMin(s.login_time), b = toMin(s.logout_time);
  if (a === null || b === null || b <= a) return '<div class="timeline"></div><div class="timeline-labels"><span>00:00</span><span>24:00</span></div>';
  const hrs = ((b - a) / 60).toFixed(1).replace(/\.0$/, '');
  return `<div class="timeline"><div class="bar" style="left:${(a / 1440) * 100}%;width:${((b - a) / 1440) * 100}%"></div></div>
    <div class="timeline-labels"><span>00:00</span><span>${hrs} h shift</span><span>24:00</span></div>`;
}

function renderShifts() {
  const members = id => Object.entries(settings.staff).filter(([, s]) => s.shift_id === id);
  const total = savedShifts().length + newShifts.size;
  $('shift-grid').innerHTML = cardShifts().map(s => {
    const m = members(s.id);
    const isNew = newShifts.has(s.id);
    const dirty = isNew || shiftDrafts.has(s.id);
    return `<div class="shift-card ${dirty ? 'dirty' : ''}" data-id="${esc(s.id)}">
      <div class="head">
        <span class="icon">${ICON.clock}</span>
        <input class="input name" data-field="name" data-key="shift:${esc(s.id)}:name" value="${esc(s.name)}" aria-label="Shift name">
      </div>
      <div class="times">
        <label class="field-label">Login<input class="input" type="time" data-field="login_time" data-key="shift:${esc(s.id)}:login" value="${esc(s.login_time)}"></label>
        <label class="field-label">Logout<input class="input" type="time" data-field="logout_time" data-key="shift:${esc(s.id)}:logout" value="${esc(s.logout_time)}"></label>
        <label class="field-label">Grace (min)<input class="input" type="number" min="0" step="1" data-field="grace_minutes" data-key="shift:${esc(s.id)}:grace" value="${esc(s.grace_minutes)}"></label>
      </div>
      <div class="tl">${timelineHTML(s)}</div>
      <div class="members">${m.length
        ? m.map(([id, x]) => `<span class="pill">${esc(x.name || id)}</span>`).join('')
        : `<span class="muted small">${isNew ? 'Save this shift, then assign staff on the Staff page' : 'No staff yet — assign them on the Staff page'}</span>`}</div>
      <div class="foot">${footHTML(s.id, m.length, total)}</div>
    </div>`;
  }).join('');
}

function footHTML(id, memberCount, total) {
  const isNew = newShifts.has(id);
  if (isNew || shiftDrafts.has(id)) {
    return `<span class="dirty-note">${isNew ? 'New shift — not saved' : 'Unsaved changes'}</span>
      <div class="actions"><button class="btn sm ghost" data-action="discard">Discard</button><button class="btn sm primary" data-action="save">Save</button></div>`;
  }
  return `<span class="muted small">${memberCount} staff</span>
    <button class="btn sm danger-text" data-action="delete" ${total < 2 ? 'disabled title="Keep at least one shift"' : ''}>Delete</button>`;
}

$('shift-grid').addEventListener('input', e => {
  const card = e.target.closest('.shift-card');
  const field = e.target.dataset.field;
  if (!card || !field) return;
  const id = card.dataset.id;
  const base = shiftDrafts.get(id) || savedShifts().find(s => s.id === id);
  const draft = { ...base, [field]: e.target.value };
  const saved = savedShifts().find(s => s.id === id);
  const same = saved && ['name', 'login_time', 'logout_time', 'grace_minutes'].every(k => String(saved[k]) === String(draft[k]));
  if (same && !newShifts.has(id)) shiftDrafts.delete(id); else shiftDrafts.set(id, draft);
  // Update only this card's timeline, border and footer: never replace the inputs while typing
  // (re-rendering a time input mid-entry resets which hour/minute segment the caret is in).
  const isDirty = newShifts.has(id) || shiftDrafts.has(id);
  card.querySelector('.tl').innerHTML = timelineHTML(draft);
  if (card.classList.contains('dirty') !== isDirty) {
    card.classList.toggle('dirty', isDirty);
    const memberCount = Object.values(settings.staff).filter(s => s.shift_id === id).length;
    card.querySelector('.foot').innerHTML = footHTML(id, memberCount, savedShifts().length + newShifts.size);
  }
});

async function saveShift(id) {
  const draft = shiftDrafts.get(id);
  if (!draft) return;
  if (!String(draft.name).trim()) return toast('Give the shift a name', true);
  if (toMin(draft.login_time) === null || toMin(draft.logout_time) === null) return toast('Enter login and logout times', true);
  const shifts = newShifts.has(id)
    ? [...savedShifts(), draft]
    : savedShifts().map(s => (s.id === id ? draft : s));
  shiftDrafts.delete(id);
  newShifts.delete(id);
  if (!(await saveSettings({ shifts }))) {
    // Keep the user's edits if the server rejected them.
    shiftDrafts.set(id, draft);
    if (!savedShifts().some(s => s.id === id)) newShifts.add(id);
    renderShifts();
  } else {
    toast(`Saved ${draft.name}`);
  }
}

$('shift-grid').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input')) {
    e.preventDefault();
    saveShift(e.target.closest('.shift-card').dataset.id);
  }
});

$('shift-grid').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.shift-card').dataset.id;
  const action = btn.dataset.action;
  if (action === 'save') return saveShift(id);
  if (action === 'discard') {
    shiftDrafts.delete(id);
    newShifts.delete(id);
    return renderShifts();
  }
  if (action === 'delete') {
    const rest = savedShifts().filter(s => s.id !== id);
    const n = Object.values(settings.staff).filter(s => s.shift_id === id).length;
    const name = shiftById(id).name;
    if (confirm(n ? `Delete "${name}"? Its ${n} staff will move to "${rest[0].name}".` : `Delete "${name}"?`)) {
      saveSettings({ shifts: rest });
    }
  }
});

$('btn-add-shift').addEventListener('click', () => {
  const id = `shift_${Date.now().toString(36)}`;
  newShifts.add(id);
  shiftDrafts.set(id, { id, name: `Shift ${savedShifts().length + newShifts.size}`, login_time: '09:00', logout_time: '18:00', grace_minutes: 0 });
  renderShifts();
  const input = document.querySelector(`.shift-card[data-id="${id}"] .name`);
  input?.focus();
  input?.select();
});

// ---------- Version / updates ----------
async function checkVersion() {
  try {
    const v = await api('/api/version');
    $('version').textContent = `StaffPay v${v.version}`;
    if (v.update_available) {
      const card = $('update-card');
      card.href = v.download_url || v.releases_url;
      card.title = `Download StaffPay v${v.latest}`;
      $('update-title').textContent = `v${v.latest} is ready`;
      card.classList.remove('hidden');
    }
  } catch { /* offline: ignore */ }
}

// ---------- Start ----------
checkVersion();
(async function init() {
  try {
    ({ settings, report } = await api('/api/state'));
    renderAll();
  } catch (e) {
    toast(e.message, true);
  }
})();
