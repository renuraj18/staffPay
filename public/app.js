const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => inr.format(Number(n || 0));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
// Avatar colour from the name, so each person keeps their colour.
const avatar = name => `<span class="avatar" style="--h:${[...String(name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)}">${esc(initials(name))}</span>`;
const initials = name => String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const ICON = {
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M16 15h2"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
  rupee: '<svg viewBox="0 0 24 24"><path d="M7 5h10M7 9.5h10M10 5c5 0 5 9 0 9H7l7 6"/></svg>',
  building: '<svg viewBox="0 0 24 24"><path d="M4 20V6.5L11 4v16"/><path d="M11 9h9v11"/><path d="M3 20h18"/><path d="M7 9h.01M7 12.5h.01M7 16h.01M14.5 12.5h2M14.5 16h2"/></svg>',
  bank: '<svg viewBox="0 0 24 24"><path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20h18"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  print: '<svg viewBox="0 0 24 24"><path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
};
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtMonth = ym => { const [y, m] = String(ym || '').split('-').map(Number); return m ? `${MONTHS[m - 1]} ${y}` : ''; };
const fullMonth = ym => { const [y, m] = String(ym || '').split('-').map(Number); return m ? `${FULL_MONTHS[m - 1]} ${y}` : ''; };
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const fmtHours = mins => { const h = Math.floor(mins / 60), m = Math.round(mins % 60); return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`; };
const staffDownloadUrl = id => `/api/staff/${encodeURIComponent(id)}/slip.pdf`;

let report = null;
let settings = null;
let advances = [];   // advances with their recovery in `month` (from the server)
let month = '';      // YYYY-MM: the uploaded sheet's month, or this month
let advanceFilter = 'active';
const openAdvances = new Set();
const openRows = new Set();
const selected = new Set();
let staffFilter = 'all';
let staffCompanyFilter = 'all';   // 'all' | '' (no company) | company id
let salaryCompanyFilter = 'all';
let rulesScope = '';               // '' = default rules, else a company id
let months = [];                   // saved months, newest first: [{month, file, locked, employees, net, paid_count}]
let activeMonth = null;            // the month open on the Salary page
let undoLabel = null;              // the change "Undo" would revert (from the server)
let salarySearch = '';
let salarySort = { key: '', dir: 1 };
let staffSearch = '';
let staffView = 'active';          // active | left | all | no_salary | no_bank | no_company
const shiftDrafts = new Map();   // shift id -> edited (unsaved) shift
const newShifts = new Set();     // ids of shifts added but not saved yet

// ---------- Helpers ----------
// toast(msg, error) — or toast(msg, {undo: true}) to offer "Undo" for the change just made.
function toast(msg, opts = false) {
  const { error = opts === true, undo = false } = typeof opts === 'object' ? opts : {};
  const t = $('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo && undoLabel ? '<button class="toast-btn" data-undo>Undo</button>' : ''}`;
  t.classList.toggle('error', error);
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), undo ? 7000 : 4000);
}
$('toast').addEventListener('click', async e => {
  if (!e.target.closest('[data-undo]')) return;
  $('toast').classList.add('hidden');
  try {
    const res = await api('/api/undo', { method: 'POST' });
    applyState(res);
    renderAll();
    toast(`Undone: ${res.undone}`);
  } catch (err) { toast(err.message, true); }
});

// ---------- Dialog ----------
function openModal(html, { wide = false } = {}) {
  $('modal-box').innerHTML = html;
  $('modal-box').classList.toggle('wide', wide);
  $('modal').classList.remove('hidden');
  ($('modal-box').querySelector('[autofocus]') || $('modal-box').querySelector('input, select, button'))?.focus();
}
const closeModal = () => $('modal').classList.add('hidden');
$('modal').addEventListener('click', e => { if (e.target === $('modal') || e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal(); });

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'locked') showLock();
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data, status: res.status });
  return data;
}
const putJson = (url, body, method = 'PUT') => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function flashSaved() {
  const els = document.querySelectorAll('[data-saved]');
  els.forEach(el => (el.textContent = '✓ Saved'));
  clearTimeout(flashSaved.timer);
  flashSaved.timer = setTimeout(() => els.forEach(el => (el.textContent = '')), 1600);
}

async function saveSettings(patch, msg = 'Saved') {
  try {
    const res = await putJson('/api/settings', patch);
    applyState(res);
    renderAll();
    flashSaved();
    toast(msg, { undo: true });
    return true;
  } catch (err) {
    toast(err.message, true);
    renderAll(); // show the saved values again
    return false;
  }
}

function applyState(res) {
  ({ settings, report, advances, month } = res);
  months = res.months || [];
  activeMonth = res.active_month || null;
  undoLabel = res.undo || null;
}

// Corrections, adjustments and payments for the open month.
async function editMonth(patch, msg = 'Saved') {
  try {
    applyState(await putJson('/api/month/edits', patch));
    renderAll();
    toast(msg, { undo: true });
    return true;
  } catch (err) { toast(err.message, true); return false; }
}

const divisor = () => Number(settings.rules.salary_divisor) || 30.5;
const savedShifts = () => settings.shifts;
const shiftById = id => savedShifts().find(s => s.id === id) || savedShifts()[0];
const reportEmployee = id => report?.employees.find(e => e.id === id);

// ---------- Rendering ----------
function setTab(tab) {
  if (!['salary', 'rules', 'staff', 'companies', 'shifts', 'advances', 'reports', 'settings'].includes(tab)) tab = 'salary';
  if (tab === 'reports' && setTab.current !== 'reports') loadReports();
  setTab.current = tab;
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
  renderCompanies();
  renderAdvances();
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

async function uploadFile(file, replace = false) {
  if (!file) return;
  $('upload-error').classList.add('hidden');
  $('progress').classList.remove('hidden');
  const body = new FormData();
  body.append('file', file);
  try {
    const res = await api(`/api/upload${replace ? '?replace=1' : ''}`, { method: 'POST', body });
    applyState(res);
    openRows.clear();
    selected.clear();
    showUpload(false);
    renderAll();
    showUploadSummary(res.upload_summary, file.name);
    api('/api/folders').then(f => ($('month-dir').textContent = f.month_dir)).catch(() => {});
  } catch (e) {
    // Same month uploaded before: replace its attendance (corrections, adjustments and payments are kept)?
    if (e.data?.code === 'exists' && confirm(`${fullMonth(e.data.month)} is already in StaffPay (from “${e.data.file}”).\n\nReplace its attendance with this sheet? Corrections, adjustments and payments for the month are kept.`)) {
      return uploadFile(file, true);
    }
    $('upload-error').textContent = e.message;
    $('upload-error').classList.remove('hidden');
  } finally {
    $('progress').classList.add('hidden');
    $('file').value = '';
  }
}

// After an upload: what was read and what needs attention.
function showUploadSummary(s, fileName) {
  if (!s) return;
  const list = (items, more = 8) => items.length
    ? `<span class="names">${items.slice(0, more).map(x => esc(`${x.name} (#${x.id})`)).join(', ')}${items.length > more ? ` and ${items.length - more} more` : ''}</span>` : '';
  const rows = [
    [ICON.check, 'good', `${s.employees} employees read for ${fullMonth(s.month)}`, ''],
    s.new_staff.length && [ICON.people, 'info', `${s.new_staff.length} new staff added`, list(s.new_staff), 'no_salary'],
    s.renamed.length && [ICON.alert, 'warn', `${s.renamed.length} share an employee ID with someone else and were added with a new ID`, list(s.renamed)],
    s.left.length && [ICON.alert, 'warn', `${s.left.length} marked as left are in this sheet`, list(s.left), 'left'],
    s.no_salary.length && [ICON.wallet, 'warn', `${s.no_salary.length} have no salary entered (default salary used)`, list(s.no_salary), 'no_salary'],
    s.no_company.length && [ICON.building, 'warn', `${s.no_company.length} have no company`, list(s.no_company), 'no_company'],
    s.no_bank.length && [ICON.bank, 'warn', `${s.no_bank.length} have no bank account / IFSC`, list(s.no_bank, 5), 'no_bank'],
    s.warnings.length && [ICON.alert, 'warn', `${s.warnings.length} other item${s.warnings.length > 1 ? 's' : ''} to check`,
      `<details><summary>Show</summary><ul>${s.warnings.slice(0, 50).map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>`],
  ].filter(Boolean);
  openModal(`<h2>Sheet uploaded</h2><p class="hint">${esc(fileName)}</p>
    <ul class="summary-list">${rows.map(([icon, tone, title, body, fix]) => `<li class="${tone}"><span class="sum-icon">${icon}</span>
      <div><b>${esc(title)}</b>${body ? `<div>${body}</div>` : ''}${fix ? `<button class="link" data-fix="${fix}">Fix on Staff page →</button>` : ''}</div></li>`).join('')}</ul>
    <div class="modal-actions"><span class="spacer"></span><button class="btn primary" data-close autofocus>Done</button></div>`, { wide: true });
  $('modal-box').querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', () => {
    closeModal();
    staffView = b.dataset.fix; staffFilter = 'all'; staffCompanyFilter = 'all'; staffSearch = '';
    renderStaff();
    setTab('staff');
  }));
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
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isLocked = () => Boolean(report?.locked);
const adjustOf = e => (e.extra_earnings || 0) - (e.extra_deductions || 0);
const matches = (q, ...fields) => !q || fields.some(f => String(f || '').toLowerCase().includes(q.toLowerCase()));
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));

function renderMonthBar() {
  $('month-select').innerHTML = months.map(m =>
    `<option value="${esc(m.month)}" ${m.month === activeMonth ? 'selected' : ''}>${esc(fullMonth(m.month))}${m.locked ? ' 🔒' : ''} · ${m.employees} staff · ${money(m.net)}${m.paid_count ? ` · ${m.paid_count} paid` : ''}</option>`).join('');
  const locked = isLocked();
  $('lock-badge').classList.toggle('hidden', !locked);
  $('lock-badge').textContent = locked ? `Locked ${fmtDate(report.locked.slice(0, 10))}` : '';
  $('btn-lock-month').innerHTML = locked
    ? '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg> Unlock month'
    : '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg> Lock month';
  $('btn-lock-month').title = locked ? 'Allow changes to this month again (salaries are recalculated with today\'s settings)' : 'Freeze this month\'s salaries — later changes to rules, salaries or advances won\'t change it';
  $('btn-delete-month').disabled = locked;
  $('locked-note').classList.toggle('hidden', !locked);
  $('locked-note').innerHTML = locked ? `<b>${esc(fullMonth(report.month))} is locked.</b> Salaries are frozen as they were on ${fmtDate(report.locked.slice(0, 10))}; changes to rules, salaries or advances don't affect it. You can still mark staff as paid.` : '';
}

// What still needs doing before paying: missing salaries, companies, bank details; people who left.
let checklistOpen = (() => { try { return localStorage.getItem('checklist') !== 'closed'; } catch { return true; } })();
function renderChecklist() {
  const st = id => settings.staff[id] || {};
  const emps = report.employees;
  const items = [
    ['no_salary', emps.filter(e => !e.salary_mapped).length, n => `${n} staff on the default salary (${money(settings.rules.monthly_salary)}) — enter their monthly salary`],
    ['no_company', companyList().length ? emps.filter(e => !e.company_id).length : 0, n => `${n} staff without a company`],
    ['no_bank', emps.filter(e => !hasBank(st(e.id))).length, n => `${n} staff without bank account or IFSC (needed for the bank transfer sheet)`],
    ['left', emps.filter(e => st(e.id).left_on).length, n => `${n} staff in this sheet are marked as left`],
  ].filter(([, n]) => n);
  const unpaid = emps.length - (report.totals.paid_count || 0);
  const el = $('checklist');
  el.classList.toggle('hidden', !items.length);
  if (!items.length) return;
  el.innerHTML = `<button class="checklist-head" data-toggle aria-expanded="${checklistOpen}">
      <span class="check-icon">${ICON.alert}</span><b>${items.length} thing${items.length > 1 ? 's' : ''} to finish setting up</b>
      <span class="muted small">${unpaid ? `${unpaid} not paid yet` : 'everyone paid'}</span>${ICON.chev}</button>
    ${checklistOpen ? `<ul>${items.map(([view, n, text]) => `<li><span>${esc(text(n))}</span>
      <button class="link" data-fix="${view}">Fix on Staff page →</button></li>`).join('')}</ul>` : ''}`;
  el.classList.toggle('open', checklistOpen);
}
$('checklist').addEventListener('click', e => {
  if (e.target.closest('[data-toggle]')) {
    checklistOpen = !checklistOpen;
    try { localStorage.setItem('checklist', checklistOpen ? 'open' : 'closed'); } catch { /* private window */ }
    return renderChecklist();
  }
  const fix = e.target.closest('[data-fix]')?.dataset.fix;
  if (fix) { staffView = fix === 'left' ? 'left' : fix; staffFilter = 'all'; staffCompanyFilter = 'all'; staffSearch = ''; renderStaff(); setTab('staff'); }
});

function sortedEmployees(list) {
  const { key, dir } = salarySort;
  if (!key) return list;
  const val = e => (key === 'adjust' ? adjustOf(e) : e[key]);
  return [...list].sort((a, b) => {
    const x = val(a), y = val(b);
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x || '').localeCompare(String(y || ''), undefined, { numeric: true })) * dir;
  });
}

function renderSalary() {
  if (!report) {
    $('salary-sub').textContent = 'Upload the biometric attendance sheet to calculate salary.';
    showUpload(true);
    return;
  }
  if ($('upload-view').classList.contains('hidden')) showUpload(false);
  const r = report;
  $('salary-sub').textContent = `${r.company || 'Attendance'} · ${r.period.from ? `${fmtDate(r.period.from)} – ${fmtDate(r.period.to)}` : ''} · ${r.calendar_days} days`;
  renderMonthBar();
  renderChecklist();

  const w = $('warnings');
  w.classList.toggle('hidden', !r.warnings.length);
  w.innerHTML = r.warnings.length
    ? `<details><summary>${r.warnings.length} item${r.warnings.length > 1 ? 's' : ''} to check</summary><ul>${r.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`
    : '';

  const comps = companyList();
  if (salaryCompanyFilter !== 'all' && salaryCompanyFilter !== '' && !settings.companies[salaryCompanyFilter]) salaryCompanyFilter = 'all';
  const cf = $('salary-company-filter');
  cf.classList.toggle('hidden', !comps.length);
  const inCompany = id => r.employees.filter(e => e.company_id === id).length;
  cf.innerHTML = comps.length ? [['all', 'All', r.employees.length], ...comps.map(c => [c.id, c.name, inCompany(c.id)]),
    ...(inCompany('') ? [['', 'No company', inCompany('')]] : [])]
    .map(([id, label, n]) => `<button data-filter="${esc(id)}" class="${salaryCompanyFilter === id ? 'active' : ''}">${esc(label)}<span class="n">${n}</span></button>`).join('') : '';
  const inFilter = r.employees.filter(e => salaryCompanyFilter === 'all' || e.company_id === salaryCompanyFilter);
  const emps = sortedEmployees(inFilter.filter(e => matches(salarySearch, e.name, e.id)));
  const t = salaryCompanyFilter === 'all' ? r.totals : Object.fromEntries(Object.keys(r.totals).map(k => [k, inFilter.reduce((s, e) => s + (e[k] || 0), 0)]));
  t.paid_count = inFilter.filter(e => e.paid_on).length;
  const stat = (label, value, icon, cls = '') =>
    `<div class="stat ${cls}"><div class="top"><span class="label">${label}</span><span class="chip">${icon}</span></div><div class="value">${value}</div></div>`;
  const statCount = 5 + (t.advance_deduction ? 1 : 0) + (t.overtime_incentive ? 1 : 0);
  $('stats').style.setProperty('--n', statCount - 1);
  $('stats').innerHTML =
    stat('Employees', `${inFilter.length}<span class="stat-sub">${t.paid_count ? `${t.paid_count} paid` : 'none paid yet'}</span>`, ICON.people, 'people') +
    stat('Monthly salaries', money(t.base_salary), ICON.wallet, 'pay') +
    stat('Attendance deductions', money(t.attendance_deduction), ICON.minus, 'ded') +
    stat('Fines', money(t.total_fines), ICON.alert, 'fine') +
    (t.advance_deduction ? stat('Advance recovery', money(t.advance_deduction), ICON.rupee, 'adv') : '') +
    (t.overtime_incentive ? stat(`Overtime incentive · ${fmtHours(t.overtime_minutes)}`, money(t.overtime_incentive), ICON.clock, 'ot') : '') +
    stat('Net payable', money(t.net_salary), ICON.check, 'net');

  const printUrl = `/api/slips.pdf${settings.companies[salaryCompanyFilter] ? `?company=${encodeURIComponent(salaryCompanyFilter)}` : ''}`;
  $('btn-print-slips').href = printUrl;
  $('btn-mark-paid').disabled = !emps.some(e => !e.paid_on);
  document.querySelectorAll('#salary-table th[data-sort]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === salarySort.key);
    th.dataset.dir = th.dataset.sort === salarySort.key ? (salarySort.dir > 0 ? 'asc' : 'desc') : '';
  });

  $('salary-table').tBodies[0].innerHTML = emps.map(e => {
    const open = openRows.has(e.id);
    const adj = adjustOf(e);
    const row = `
      <tr class="emp ${open ? 'open' : ''} ${e.paid_on ? 'is-paid' : ''}" data-id="${esc(e.id)}">
        <td><div class="person">${ICON.chev}${avatar(e.name)}
          <div><div class="name">${esc(e.name)}</div><div class="id">#${esc(e.id)}${e.corrections ? ` · <span class="corr-note" title="Days corrected by hand">✎ ${e.corrections}</span>` : ''}</div></div></div></td>
        <td><span class="pill shift" title="${esc(e.shift_time)}">${esc(e.shift_name)}</span></td>
        <td>${e.company_name ? `<span class="pill company">${esc(e.company_name)}</span>` : '<span class="dim">–</span>'}</td>
        <td class="num">${money(e.monthly_salary)}${e.salary_mapped ? '' : '<div class="default-note" title="No salary entered — using the default monthly salary">default</div>'}</td>
        <td class="num">${e.present_days}${e.leave_days ? ` <span class="leave-note" title="Paid leave">+${e.leave_days}L</span>` : ''}</td>
        <td class="num">${e.half_days || '<span class="dim">–</span>'}</td>
        <td class="num">${e.absences}${e.excess_absences && e.excess_absences !== e.absences ? ` <span class="excess">(${e.excess_absences})</span>` : ''}</td>
        <td class="num">${e.off_days}</td>
        <td class="num">${e.late_arrivals}${e.early_leaves ? ` <span class="early-note" title="Left early">· ${e.early_leaves}</span>` : ''}</td>
        <td class="num">${e.missing_punches ? `<span class="count-miss">${e.missing_punches}</span>` : '0'}</td>
        <td class="num ${e.attendance_deduction ? 'neg' : 'dim'}">${e.attendance_deduction ? '−' + money(e.attendance_deduction) : '–'}</td>
        <td class="num ${e.total_fines ? 'neg' : 'dim'}">${e.total_fines ? '−' + money(e.total_fines) : '–'}</td>
        <td class="num ${e.advance_deduction ? 'neg' : 'dim'}">${e.advance_deduction ? '−' + money(e.advance_deduction) : '–'}</td>
        <td class="num ${e.overtime_incentive ? 'pos' : 'dim'}" title="${e.overtime_minutes ? fmtHours(e.overtime_minutes) + ' extra' : ''}">${e.overtime_incentive ? '+' + money(e.overtime_incentive) : '–'}</td>
        <td class="num ${adj > 0 ? 'pos' : adj < 0 ? 'neg' : 'dim'}" title="${esc((e.adjustments || []).map(a => `${a.label}: ${a.kind === 'earning' ? '+' : '−'}${money(a.amount)}`).join('\n'))}">${adj ? signed(adj) : '–'}</td>
        <td class="num net">${money(e.net_salary)}</td>
        <td>${e.paid_on
          ? `<button class="paid-pill" data-unpay title="Paid on ${esc(fmtDate(e.paid_on))} — click to mark as not paid">✓ ${esc(fmtDate(e.paid_on).replace(/ \d{4}$/, ''))}</button>`
          : '<button class="pay-btn" data-pay title="Mark as paid today">Mark paid</button>'}</td>
        <td class="num nowrap"><a class="icon-btn" href="${staffDownloadUrl(e.id)}?inline=1" target="_blank" rel="noopener" title="Print ${esc(e.name)}'s slip" aria-label="Print salary slip for ${esc(e.name)}">${ICON.print}</a><a class="icon-btn dl" href="${staffDownloadUrl(e.id)}" title="Download ${esc(e.name)}'s salary slip for ${esc(fullMonth(r.month))} (PDF)" aria-label="Download salary slip for ${esc(e.name)}">${ICON.download}</a></td>
      </tr>`;
    return row + (open ? detailRow(e) : '');
  }).join('') || `<tr><td colspan="18" class="empty">No one matches “${esc(salarySearch)}”.</td></tr>`;

  $('salary-table').tFoot.innerHTML = `
    <tr>
      <td>Total · ${inFilter.length} staff</td><td></td><td></td>
      <td class="num">${money(t.base_salary)}</td>
      <td class="num">${t.present_days}</td><td class="num">${t.half_days}</td><td class="num">${t.absences}</td>
      <td class="num">${t.off_days}</td><td class="num">${t.late_arrivals}${t.early_leaves ? ` · ${t.early_leaves}` : ''}</td>
      <td class="num">${t.missing_punches}</td>
      <td class="num">${money(t.attendance_deduction)}</td><td class="num">${money(t.total_fines)}</td>
      <td class="num">${money(t.advance_deduction)}</td><td class="num">${money(t.overtime_incentive)}</td>
      <td class="num">${signed((t.extra_earnings || 0) - (t.extra_deductions || 0))}</td>
      <td class="num">${money(t.net_salary)}</td><td>${t.paid_count}/${inFilter.length}</td><td></td>
    </tr>`;
}

function dayClass(d) {
  if (d.leave) return 'c-leave';
  if (d.off || d.holiday) return 'c-off';
  if (d.absent) return 'c-absent';
  if (d.half) return 'c-half';
  if (d.missing) return 'c-missing';
  if (d.late || d.early) return 'c-late';
  return 'c-present';
}

function detailRow(e) {
  const locked = isLocked();
  const tiles = e.days.map(d => {
    const [y, m, dd] = d.date.split('-').map(Number);
    const wd = WEEKDAYS[new Date(y, m - 1, dd).getDay()];
    const flags = [d.late && (d.late_hours ? `LATE −${fmtHours(d.late_hours * 60)}` : 'LATE'), d.early && (d.early_hours ? `EARLY −${fmtHours(d.early_hours * 60)}` : 'EARLY'), d.missing_in && 'NO IN', d.missing_out && 'NO OUT', d.ot_minutes && `+${fmtHours(d.ot_minutes)}`]
      .filter(Boolean).map(f => `<span class="flag">${f}</span>`).join('');
    const times = d.clock_in || d.clock_out ? `${d.clock_in || '—'} → ${d.clock_out || '—'}` : '&nbsp;';
    const tip = [d.status || 'No status', d.moved && 'single evening punch read as log-off',
      d.corrected && `Corrected by hand (was ${d.corrected.was})${d.corrected.note ? `: ${d.corrected.note}` : ''}`,
      !locked && 'Click to correct this day'].filter(Boolean).join(' · ');
    return `<button type="button" class="day ${dayClass(d)} ${d.unknown ? 'c-unknown' : ''} ${d.corrected ? 'corrected' : ''}" data-day="${esc(d.date)}" ${locked ? 'disabled' : ''} title="${esc(tip)}">
      <div class="d">${dd} <span>${wd}${d.sunday && !d.absent && !d.off ? ' · short' : ''}</span></div>
      <div class="cat">${d.corrected ? '✎ ' : ''}${esc(d.category)}</div>
      <div class="t">${times}</div>
      ${flags ? `<div class="flags">${flags}</div>` : ''}
    </button>`;
  }).join('');

  const parts = [
    `Monthly <b>${money(e.monthly_salary)}</b>`,
    `Daily rate ${inr2.format(e.daily_salary)} <span class="dim">(÷ ${e.rules.salary_divisor})</span> · hourly ${inr2.format(e.hourly_rate)}`,
    e.rules_name !== 'Default' ? `<span class="pill company">${esc(e.rules_name)} rules</span>` : '',
    !e.absences ? 'No absences'
      : e.allowed_absences ? `Absences ${e.absences} <span class="dim">(${e.allowed_absences} paid, ${e.excess_absences} deducted)</span>` : `Absences ${e.absences} <span class="dim">deducted</span>`,
    e.leave_days ? `Paid leave ${e.leave_days}` : '',
    e.half_days ? `Half days ${e.half_days}` : '',
    e.attendance_deduction ? `Deduction <b class="neg">−${money(e.attendance_deduction)}</b>` : '',
    e.late_fine ? (e.rules.late_mode === 'hourly' ? `Late ${fmtHours(e.late_hours * 60)} cut −${money(e.late_fine)}` : `Late fines −${money(e.late_fine)}`) : '',
    e.early_fine ? (e.rules.late_mode === 'hourly' ? `Early leave ${fmtHours(e.early_hours * 60)} cut −${money(e.early_fine)}` : `Early leave fines (${e.early_leaves}) −${money(e.early_fine)}`) : '',
    e.missing_punch_fine ? `Missing punch fines −${money(e.missing_punch_fine)}` : '',
    e.overtime_incentive ? `Overtime ${fmtHours(e.overtime_minutes)} × ${inr2.format(e.overtime_rate)}/h${e.rules.overtime_mode === 'fixed' ? ' <span class="dim">(fixed)</span>' : ''} <b class="pos">+${money(e.overtime_incentive)}</b>` : '',
    ...e.advances.map(a => a.start_month > report.month
      ? `Advance ${money(a.amount)} <span class="dim">deducting from ${fmtMonth(a.start_month)}</span>`
      : a.deduction
        ? `Advance −${money(a.deduction)} <span class="dim">(${money(a.balance)} left of ${money(a.amount)})</span>`
        : `Advance <span class="dim">skipped this month (${money(a.balance)} left)</span>`),
    `Net <b>${money(e.net_salary)}</b>`,
  ].filter(Boolean);

  const adjustments = (e.adjustments || []).map(a => `<li>
      <span class="adj-kind ${a.kind}">${a.kind === 'earning' ? '+' : '−'}</span><span class="adj-label">${esc(a.label)}</span>
      <b class="${a.kind === 'earning' ? 'pos' : 'neg'}">${a.kind === 'earning' ? '+' : '−'}${money(a.amount)}</b>
      ${locked ? '' : `<button class="icon-btn sm" data-adj-del="${esc(a.id)}" title="Remove" aria-label="Remove ${esc(a.label)}">${ICON.x}</button>`}</li>`).join('');

  return `<tr class="detail" data-id="${esc(e.id)}"><td colspan="18"><div class="detail-inner">
    <div class="legend">
      <span><i class="c-present"></i>Present</span><span><i class="c-late"></i>Late / early</span>${Number(e.rules.missing_punch_as_leave) ? '' : '<span><i class="c-missing"></i>Missing punch</span>'}
      <span><i class="c-half"></i>Half day</span><span><i class="c-absent"></i>Absent</span><span><i class="c-leave"></i>Paid leave</span><span><i class="c-off"></i>Weekly off / holiday</span>
      ${locked ? '' : '<span class="muted">· Click a day to correct it</span>'}
    </div>
    <div class="days">${tiles}</div>
    <div class="detail-grid">
      <div class="adjust-box">
        <div class="group-title">Bonus, allowance &amp; other deductions</div>
        ${adjustments ? `<ul class="adj-list">${adjustments}</ul>` : '<p class="hint">None this month.</p>'}
        ${locked ? '' : `<form class="adj-form" data-adj-form>
          <select class="input" name="kind" aria-label="Type"><option value="earning">+ Earning</option><option value="deduction">− Deduction</option></select>
          <input class="input" name="label" placeholder="e.g. Diwali bonus" maxlength="60" aria-label="Description" required>
          <input class="input amount sm" name="amount" type="number" min="1" step="1" placeholder="₹" aria-label="Amount" required>
          <button class="btn sm primary">Add</button></form>`}
      </div>
      <div class="breakdown">${parts.map(p => `<span>${p}</span>`).join('')}</div>
    </div>
    <div class="detail-actions">
      <button class="btn sm" data-profile="${esc(e.id)}">${ICON.people} Profile</button>
      <a class="btn sm" href="${staffDownloadUrl(e.id)}?inline=1" target="_blank" rel="noopener">${ICON.print} Print slip</a>
      <a class="btn sm" href="${staffDownloadUrl(e.id)}">${ICON.download} Download slip (PDF)</a>
    </div>
  </div></td></tr>`;
}

const empById = id => report.employees.find(e => e.id === id);

$('salary-table').tBodies[0].addEventListener('click', e => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr || e.target.closest('a')) return;
  const id = tr.dataset.id;
  if (e.target.closest('[data-pay]')) return editMonth({ label: `paid ${empById(id).name}`, paid: { [id]: { date: today() } } }, `${empById(id).name} marked as paid`);
  if (e.target.closest('[data-unpay]')) return editMonth({ label: `not paid ${empById(id).name}`, paid: { [id]: null } }, `${empById(id).name} marked as not paid`);
  const day = e.target.closest('[data-day]');
  if (day) return openDayFix(id, day.dataset.day);
  const del = e.target.closest('[data-adj-del]');
  if (del) return editMonth({ label: 'remove adjustment', adjustments: { [id]: { [del.dataset.adjDel]: null } } }, 'Adjustment removed');
  const prof = e.target.closest('[data-profile]');
  if (prof) return openProfile(prof.dataset.profile);
  if (!tr.classList.contains('emp') || e.target.closest('button, input, select, form')) return;
  openRows.has(id) ? openRows.delete(id) : openRows.add(id);
  renderSalary();
});

$('salary-table').tBodies[0].addEventListener('submit', e => {
  const f = e.target.closest('[data-adj-form]');
  if (!f) return;
  e.preventDefault();
  const id = f.closest('tr[data-id]').dataset.id;
  const data = Object.fromEntries(new FormData(f));
  const aid = `adj_${Date.now().toString(36)}`;
  editMonth({ label: `add ${data.label}`, adjustments: { [id]: { [aid]: { kind: data.kind, label: data.label, amount: data.amount } } } },
    `${data.kind === 'earning' ? 'Added' : 'Deducted'} ${money(data.amount)} — ${data.label}`);
});

$('salary-table').tHead.addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  // Click: sort (text A→Z, numbers high→low), click again: reverse, third click: back to sheet order.
  const first = ['name', 'shift_name', 'company_name', 'paid_on'].includes(key) ? 1 : -1;
  salarySort = salarySort.key !== key ? { key, dir: first } : salarySort.dir === first ? { key, dir: -first } : { key: '', dir: 1 };
  renderSalary();
});

$('salary-search').addEventListener('input', e => { salarySearch = e.target.value.trim(); renderSalary(); });

$('btn-mark-paid').addEventListener('click', () => {
  const ids = report.employees
    .filter(e => (salaryCompanyFilter === 'all' || e.company_id === salaryCompanyFilter) && matches(salarySearch, e.name, e.id) && !e.paid_on)
    .map(e => e.id);
  if (!ids.length) return;
  if (!confirm(`Mark ${ids.length} staff as paid today (${fmtDate(today())})?`)) return;
  editMonth({ label: `mark ${ids.length} paid`, paid: Object.fromEntries(ids.map(id => [id, { date: today() }])) }, `${ids.length} staff marked as paid`);
});

$('salary-company-filter').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  salaryCompanyFilter = b.dataset.filter;
  renderSalary();
});

// ---------- Months: switch, lock, delete ----------
$('month-select').addEventListener('change', async e => {
  try {
    applyState(await putJson('/api/months/active', { month: e.target.value }));
    openRows.clear();
    renderAll();
  } catch (err) { toast(err.message, true); }
});

$('btn-lock-month').addEventListener('click', async () => {
  const lock = !isLocked();
  if (!lock && !confirm(`Unlock ${fullMonth(report.month)}? Its salaries will be recalculated with today's rules, salaries and advances.`)) return;
  try {
    applyState(await putJson(`/api/months/${report.month}/lock`, { locked: lock }, 'POST'));
    renderAll();
    toast(lock ? `${fullMonth(report.month)} locked — salaries frozen` : `${fullMonth(report.month)} unlocked`, { undo: true });
  } catch (err) { toast(err.message, true); }
});

$('btn-delete-month').addEventListener('click', async () => {
  const m = report.month;
  if (!confirm(`Delete ${fullMonth(m)} from StaffPay? Its attendance, corrections, adjustments and payments are removed (you can undo straight after, or restore a backup).`)) return;
  try {
    applyState(await api(`/api/months/${m}`, { method: 'DELETE' }));
    openRows.clear();
    renderAll();
    toast(`${fullMonth(m)} deleted`, { undo: true });
  } catch (err) { toast(err.message, true); }
});

// ---------- Correct a day ----------
const FIX_LABELS = { present: 'Present (full day, no fines)', half: 'Half day', absent: 'Absent (deducted)', leave: 'Paid leave (not deducted)', off: 'Weekly off / holiday (paid)' };
function openDayFix(empId, date) {
  const e = empById(empId);
  const d = e?.days.find(x => x.date === date);
  if (!d || isLocked()) return;
  const cur = d.corrected?.status || '';
  openModal(`<form id="day-fix">
    <h2>${esc(e.name)} · ${esc(fmtDate(date))}</h2>
    <p class="hint">Device reading: <b>${esc(d.corrected?.was || d.category)}</b>${d.clock_in || d.clock_out ? ` · ${esc(d.clock_in || '—')} → ${esc(d.clock_out || '—')}` : ' · no punches'}${d.status ? ` · “${esc(d.status)}”` : ''}</p>
    <div class="fix-options">${Object.entries(FIX_LABELS).map(([k, label]) =>
      `<label class="fix-opt"><input type="radio" name="status" value="${k}" ${cur === k ? 'checked' : ''}><span class="${dayClass({ present: {}, half: { half: 1 }, absent: { absent: 1 }, leave: { leave: 1 }, off: { off: 1 } }[k])}">${esc(label)}</span></label>`).join('')}</div>
    <label class="field-label">Note (optional)<input class="input" name="note" maxlength="120" placeholder="e.g. Approved leave, machine was down" value="${esc(d.corrected?.note || '')}"></label>
    <div class="modal-actions">
      ${cur ? '<button type="button" class="btn danger-text" data-clear>Use device reading</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-close>Cancel</button>
      <button class="btn primary">Save</button>
    </div></form>`);
  const f = $('day-fix');
  f.addEventListener('submit', ev => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    if (!data.status) return toast('Choose what the day should be', true);
    closeModal();
    editMonth({ label: `correct ${e.name} ${fmtDate(date)}`, days: { [empId]: { [date]: { status: data.status, note: data.note } } } },
      `${fmtDate(date)} set to ${FIX_LABELS[data.status].replace(/ \(.*/, '')} for ${e.name}`);
  });
  f.querySelector('[data-clear]')?.addEventListener('click', () => {
    closeModal();
    editMonth({ label: `undo correction ${fmtDate(date)}`, days: { [empId]: { [date]: null } } }, `${fmtDate(date)} back to the device reading`);
  });
}

// ---------- Salary rules page ----------
const form = $('rules-form');
// Go to the Salary rules page showing one rule set ('' = defaults, else a company id).
function showRules(scope) {
  rulesScope = scope;
  fillRules(true);
  setTab('rules');
  window.scrollTo(0, 0);
}
// From the Salary page, open the rules of the company being viewed.
$('btn-rules').addEventListener('click', () => showRules(settings.companies[salaryCompanyFilter] ? salaryCompanyFilter : ''));

// Rules shown on the page: the default rules, or the selected company's (its own, or the defaults it uses).
const scopeCompany = () => settings.companies[rulesScope];
const scopeRules = () => scopeCompany()?.rules || settings.rules;
const rulesFor = companyId => settings.companies[companyId]?.rules || settings.rules;

function fillRules(force = false) {
  if (rulesScope && !scopeCompany()) rulesScope = '';
  const comps = companyList();
  const tab = (id, label, note) => `<button type="button" role="tab" data-scope="${esc(id)}" aria-selected="${id === rulesScope}"
    class="${id === rulesScope ? 'active' : ''}">${esc(label)}${note ? `<span class="n">${note}</span>` : ''}</button>`;
  $('rules-scope').innerHTML = tab('', 'Default') + comps.map(c => tab(c.id, c.name, c.rules ? 'own' : '')).join('');
  $('rules-scope-panel').classList.toggle('hidden', !comps.length);
  const c = scopeCompany();
  $('rules-own-row').classList.toggle('hidden', !c);
  $('rules-own').checked = Boolean(c?.rules);
  const usesDefaults = Boolean(c && !c.rules);
  const usingDefaults = comps.filter(x => !x.rules).map(x => x.name);
  $('rules-scope-note').textContent = usesDefaults ? `${c.name} uses the default rules shown below. Tick the box to give it its own.`
    : !c && comps.length ? (usingDefaults.length ? `Also used by: ${usingDefaults.join(', ')}.` : 'Every company has its own rules.') : '';
  form.classList.toggle('readonly', usesDefaults);
  for (const el of form.elements) if (el.name) el.disabled = usesDefaults;

  for (const [k, v] of Object.entries(scopeRules())) {
    const el = form.elements[k];
    if (!el || (!force && document.activeElement === el)) continue;
    if (el.type === 'checkbox') el.checked = Boolean(Number(v)); else el.value = String(v);
  }
  updateRuleVisibility();
}

// Show only the inputs for the chosen option (fine amount vs. hourly rounding, etc.).
function updateRuleVisibility() {
  // data-show="a=1&b=x": shown only when every condition holds (checkboxes read as 1/0).
  const valueOf = name => { const el = form.elements[name]; return el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value; };
  form.querySelectorAll('[data-show]').forEach(el => {
    const ok = el.dataset.show.split('&').every(cond => { const [name, value] = cond.split('='); return valueOf(name) === value; });
    el.classList.toggle('hidden', !ok);
  });
  const block = Number(form.elements.late_hour_block.value) || 60;
  const late = 15, cut = (Math.ceil(late / block) * block) / 60;
  const min = Number(form.elements.overtime_min_minutes.value) || 0, otBlock = Number(form.elements.overtime_block_minutes.value) || 30;
  const ot = m => (m >= min ? Math.floor(m / otBlock) * otBlock : 0);
  const at = m => { const t = 20 * 60 + m; return `${Math.floor(t / 60) - 12}:${String(t % 60).padStart(2, '0')}`; };
  $('ot-example').textContent = `Example: logout 8:00 PM — clock out ${[50, 70, 95, 119].map(m => `${at(m)} → ${ot(m) ? fmtHours(ot(m)) : 'none'}`).join(', ')}.`;
  $('late-example').textContent = `Example: shift 9:00–8:00 PM — clock in 9:15 or clock out 7:45 PM → ${fmtHours(cut * 60)} salary cut. Grace minutes of the shift still apply.`;
}

let rulesTimer;
form.addEventListener('input', () => {
  updateRuleVisibility();
  clearTimeout(rulesTimer);
  rulesTimer = setTimeout(() => {
    const rules = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'radio') { if (el.checked) rules[el.name] = el.value; } else if (el.type === 'checkbox') rules[el.name] = el.checked ? 1 : 0;
      else if (el.value !== '') rules[el.name] = el.value;
    }
    saveSettings(rulesScope ? { companies: { [rulesScope]: { rules } } } : { rules });
  }, 500);
});
$('rules-scope').addEventListener('click', e => {
  const b = e.target.closest('button[data-scope]');
  if (b) { rulesScope = b.dataset.scope; fillRules(true); }
});
$('rules-own').addEventListener('change', e => {
  saveSettings({ companies: { [rulesScope]: { rules: e.target.checked ? true : null } } });
});
form.addEventListener('submit', e => e.preventDefault());

// ---------- Staff page ----------
// A read-only list (one row per person, what's missing at a glance) and a side panel to edit one person.
const shiftOptions = current => savedShifts().map(s =>
  `<option value="${esc(s.id)}" ${s.id === current ? 'selected' : ''}>${esc(s.name)} · ${esc(s.login_time)}–${esc(s.logout_time)}</option>`).join('');

function staffList() {
  const inSheet = new Set(report?.employees.map(e => e.id) || []);
  return Object.entries(settings.staff)
    .map(([id, s]) => ({ id, ...s, inSheet: inSheet.has(id) }))
    .sort((a, b) => (b.inSheet - a.inSheet) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

const noSalary = s => s.salary === undefined || s.salary === null || s.salary === '';
// [view, label, hint, icon, tone, test]; the problem views only count current staff.
const STAFF_VIEWS = [
  ['active', 'Current staff', 'working now', ICON.people, 'violet', s => !s.left_on],
  ['no_salary', 'No salary', 'using the default', ICON.rupee, 'amber', s => !s.left_on && noSalary(s)],
  ['no_bank', 'No bank details', 'for bank transfer', ICON.bank, 'orange', s => !s.left_on && !hasBank(s)],
  ['no_company', 'No company', 'not in a firm', ICON.building, 'rose', s => !s.left_on && !s.company_id],
  ['left', 'Left', 'no longer here', ICON.x, 'slate', s => Boolean(s.left_on)],
  ['all', 'Everyone', 'current + left', ICON.people, 'blue', () => true],
];
const PROBLEM_VIEWS = new Set(['no_salary', 'no_bank', 'no_company']);
let staffRows = [];   // ids in the order shown (for the panel's previous / next)

function renderStaffCards(all) {
  const comps = companyList().length;
  $('staff-cards').innerHTML = STAFF_VIEWS.filter(([v]) => v !== 'no_company' || comps).map(([view, label, hint, icon, tone, test]) => {
    const n = all.filter(test).length;
    const done = PROBLEM_VIEWS.has(view) && !n;
    return `<button class="scard ${done ? 'tone-green done' : `tone-${tone}`} ${staffView === view ? 'active' : ''}" data-view="${view}" aria-pressed="${staffView === view}">
      <span class="scard-icon">${done ? ICON.check : icon}</span>
      <span class="scard-text"><b>${n}</b><span>${esc(label)}</span><small>${done ? 'all done' : esc(hint)}</small></span></button>`;
  }).join('');
}

function bankCell(s) {
  const acc = String(s.bank_account_number || '');
  if (hasBank(s)) return `<span class="bank-ok">${ICON.check}<span>•• ${esc(acc.slice(-4))}</span></span><div class="sub">${esc(s.bank_ifsc)}</div>`;
  const what = acc ? 'No IFSC' : s.bank_ifsc ? 'No account no.' : 'Missing';
  return `<span class="pill miss">${ICON.alert}${what}</span>`;
}

function renderStaff() {
  const all = staffList();
  if (staffFilter !== 'all' && !savedShifts().some(s => s.id === staffFilter)) staffFilter = 'all';
  if (!STAFF_VIEWS.some(([v]) => v === staffView)) staffView = 'active';
  const comps = companyList();
  if (staffView === 'no_company' && !comps.length) staffView = 'active';
  renderStaffCards(all);

  const inView = STAFF_VIEWS.find(([v]) => v === staffView)[5];
  const viewed = all.filter(inView);
  const count = id => viewed.filter(s => s.shift_id === id).length;
  $('staff-filter').innerHTML = savedShifts().length < 2 ? '' :
    `<button data-filter="all" class="${staffFilter === 'all' ? 'active' : ''}">All shifts<span class="n">${viewed.length}</span></button>` +
    savedShifts().map(s => `<button data-filter="${esc(s.id)}" class="${staffFilter === s.id ? 'active' : ''}">${esc(s.name)}<span class="n">${count(s.id)}</span></button>`).join('');

  if (staffCompanyFilter !== 'all' && staffCompanyFilter !== '' && !settings.companies[staffCompanyFilter]) staffCompanyFilter = 'all';
  $('staff-company-filter').classList.toggle('hidden', !comps.length);
  $('staff-company-filter').innerHTML = `<option value="all">All companies</option>` +
    comps.map(c => `<option value="${esc(c.id)}" ${staffCompanyFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('') +
    `<option value="" ${staffCompanyFilter === '' ? 'selected' : ''}>No company</option>`;
  const bulkCo = $('bulk-company');
  const keepCo = bulkCo.value;
  bulkCo.innerHTML = companyOptions(comps.some(c => c.id === keepCo) ? keepCo : comps[0]?.id, 'No company');
  bulkCo.classList.toggle('hidden', !comps.length);
  $('btn-bulk-company').classList.toggle('hidden', !comps.length);
  const bulk = $('bulk-shift');
  const keep = bulk.value;
  bulk.innerHTML = shiftOptions(savedShifts().some(s => s.id === keep) ? keep : savedShifts()[0].id);

  for (const id of [...selected]) if (!settings.staff[id]) selected.delete(id);
  if ($('staff-search').value.trim() !== staffSearch) $('staff-search').value = staffSearch;
  const rows = viewed.filter(s => matches(staffSearch, s.name, s.id, s.device_id) && (staffFilter === 'all' || s.shift_id === staffFilter)
    && (staffCompanyFilter === 'all' || (s.company_id || '') === staffCompanyFilter));
  staffRows = rows.map(s => s.id);
  $('staff-toolbar').classList.toggle('hidden', all.length === 0);
  $('staff-cards').classList.toggle('hidden', all.length === 0);
  $('staff-shown').textContent = rows.length === viewed.length ? '' : `Showing ${rows.length} of ${viewed.length}`;

  $('staff-empty').textContent = !all.length ? 'Upload an attendance sheet on the Salary page to list your staff here.'
    : PROBLEM_VIEWS.has(staffView) && !viewed.length ? 'Nothing missing here — all current staff are set up.' : 'No staff match.';
  $('staff-empty').classList.toggle('hidden', rows.length > 0);
  $('staff-table').classList.toggle('hidden', rows.length === 0);
  $('staff-table').tBodies[0].innerHTML = rows.map(s => {
    const e = reportEmployee(s.id);
    const r = rulesFor(s.company_id);
    const monthly = noSalary(s) ? Number(r.monthly_salary) : Number(s.salary);
    const company = settings.companies[s.company_id];
    const shift = shiftById(s.shift_id);
    const tag = s.left_on ? `<span class="left-tag">left ${esc(fmtDate(s.left_on))}</span>` : s.inSheet ? '' : '<span class="dim">not in this month</span>';
    return `<tr data-id="${esc(s.id)}" class="staff-row ${selected.has(s.id) ? 'selected' : ''} ${s.left_on ? 'has-left' : ''} ${drawerId === s.id ? 'current' : ''}" tabindex="0">
      <td class="check"><input type="checkbox" class="pick" ${selected.has(s.id) ? 'checked' : ''} aria-label="Select ${esc(s.name)}"></td>
      <td><div class="person">${avatar(s.name)}
        <div><div class="name">${esc(s.name || 'Unnamed')}</div><div class="id">#${esc(s.id)}${tag ? ` · ${tag}` : ''}</div></div></div></td>
      <td class="col-company">${company ? `<span class="pill company">${esc(company.name)}</span>` : comps.length ? '<span class="pill miss">No company</span>' : '<span class="dim">–</span>'}</td>
      <td class="col-shift"><div class="shift-cell"><b>${esc(shift.name)}</b><div class="sub">${esc(shift.login_time)}–${esc(shift.logout_time)}</div></div></td>
      <td class="num"><b>${money(monthly)}</b><div class="sub">${noSalary(s) ? '<span class="default-note">default</span>' : `${inr.format(monthly / (Number(r.salary_divisor) || 30.5))}/day`}</div></td>
      <td class="col-bank">${bankCell(s)}</td>
      <td class="num col-net">${e ? `<b>${money(e.net_salary)}</b>${e.paid_on ? '<div class="sub pos">paid</div>' : ''}` : '<span class="dim">–</span>'}</td>
      <td class="go">${ICON.chev}</td>
    </tr>`;
  }).join('');
  updateSelection();
  if (drawerId) { renderDrawer(); loadDrawerHistory(); }
}

function updateSelection() {
  $('selected-count').textContent = `${selected.size} selected`;
  $('staff-bulk').classList.toggle('hidden', selected.size === 0);
  document.body.classList.toggle('has-bulk', selected.size > 0);
  const boxes = [...document.querySelectorAll('#staff-table .pick')];
  const checkAll = $('check-all');
  checkAll.checked = boxes.length > 0 && boxes.every(b => b.checked);
  checkAll.indeterminate = !checkAll.checked && boxes.some(b => b.checked);
}

$('staff-cards').addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  staffView = b.dataset.view;
  renderStaff();
});
$('staff-filter').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  staffFilter = b.dataset.filter;
  renderStaff();
});
$('staff-company-filter').addEventListener('change', e => { staffCompanyFilter = e.target.value; renderStaff(); });
$('staff-search').addEventListener('input', e => { staffSearch = e.target.value.trim(); renderStaff(); });

$('staff-table').addEventListener('click', e => {
  if (e.target.closest('.check')) return;
  const tr = e.target.closest('tr[data-id]');
  if (tr) openStaff(tr.dataset.id);
});
$('staff-table').addEventListener('keydown', e => {
  const tr = e.target.closest?.('tr[data-id]');
  if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openStaff(tr.dataset.id); }
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
  if (!e.target.classList.contains('pick')) return;
  const tr = e.target.closest('tr[data-id]');
  e.target.checked ? selected.add(tr.dataset.id) : selected.delete(tr.dataset.id);
  tr.classList.toggle('selected', e.target.checked);
  updateSelection();
});

// Import an edited staff Excel sheet; the reply says what changed and which rows were refused.
$('staff-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const body = new FormData();
  body.append('file', file);
  try {
    const res = await api('/api/staff/import', { method: 'POST', body });
    applyState(res);
    renderAll();
    const r = res.import;
    openModal(`<h2>Staff imported</h2><p class="hint">${esc(file.name)}</p>
      <ul class="summary-list">
        <li class="good"><span class="sum-icon">${ICON.check}</span><div><b>${r.updated} updated · ${r.added} added · ${r.unchanged} unchanged</b></div></li>
        ${r.errors.length ? `<li class="warn"><span class="sum-icon">${ICON.alert}</span><div><b>${r.errors.length} row${r.errors.length > 1 ? 's' : ''} not imported</b>
          <ul>${r.errors.map(x => `<li>Row ${x.row}: ${esc(x.error)}</li>`).join('')}</ul></div></li>` : ''}
      </ul>
      <div class="modal-actions">${r.added || r.updated ? '<button class="btn" data-undo-import>Undo import</button>' : ''}<span class="spacer"></span><button class="btn primary" data-close autofocus>Done</button></div>`, { wide: true });
    $('modal-box').querySelector('[data-undo-import]')?.addEventListener('click', async () => {
      closeModal();
      try { const u = await api('/api/undo', { method: 'POST' }); applyState(u); renderAll(); toast('Import undone'); } catch (err) { toast(err.message, true); }
    });
  } catch (err) { toast(err.message, true); }
});

$('btn-bulk-shift').addEventListener('click', async () => {
  const shift_id = $('bulk-shift').value;
  const staff = Object.fromEntries([...selected].map(id => [id, { shift_id }]));
  const n = selected.size;
  selected.clear();
  if (await saveSettings({ staff })) toast(`Moved ${n} staff to ${shiftById(shift_id).name}`, { undo: true });
});
$('btn-bulk-company').addEventListener('click', async () => {
  const company_id = $('bulk-company').value;
  const staff = Object.fromEntries([...selected].map(id => [id, { company_id }]));
  const n = selected.size;
  selected.clear();
  if (await saveSettings({ staff })) toast(`${n} staff set to ${settings.companies[company_id]?.name || 'no company'}`, { undo: true });
});
$('btn-bulk-clear').addEventListener('click', () => { selected.clear(); renderStaff(); });

// ---------- Employee panel ----------
// Opens from the Staff list, Salary page and Reports. Edits save on change like the rest of the app.
let drawerId = null;
let drawerIdx = -1;   // the person's place in the list, kept when a fix drops them out of a "missing" view
// Opening from a "missing" view puts the cursor straight into the missing field.
const VIEW_FOCUS = { no_salary: 'salary', no_bank: 'bank_account_number', no_company: 'company_id' };

function openStaff(id, focusField = setTab.current === 'staff' ? VIEW_FOCUS[staffView] : '') {
  if (!settings.staff[id]) return;
  const switching = drawerId !== id;
  drawerId = id;
  drawerIdx = staffRows.indexOf(id);
  if (switching) $('drawer-history').innerHTML = '';
  $('staff-drawer').classList.remove('hidden');
  $('drawer-scrim').classList.remove('hidden');
  document.querySelectorAll('#staff-table tr[data-id]').forEach(tr => tr.classList.toggle('current', tr.dataset.id === id));
  renderDrawer();
  loadDrawerHistory();
  const el = focusField && $('drawer-body').querySelector(`[data-field="${focusField}"]`);
  (el || $('drawer-body').querySelector('[data-close-drawer]')).focus();
  $('staff-drawer').scrollTop = 0;
}
const openProfile = id => openStaff(id, '');

function closeStaff() {
  const id = drawerId;
  drawerId = null;
  $('staff-drawer').classList.add('hidden');
  $('drawer-scrim').classList.add('hidden');
  const tr = document.querySelector(`#staff-table tr[data-id="${CSS.escape(id || '')}"]`);
  tr?.classList.remove('current');
  if (setTab.current === 'staff') tr?.focus();
}

function stepStaff(dir) {
  const i = staffRows.indexOf(drawerId);
  // Someone who dropped out of the list (just fixed) sits between drawerIdx - 1 and drawerIdx.
  const next = i >= 0 ? staffRows[i + dir] : drawerIdx >= 0 ? staffRows[dir > 0 ? drawerIdx : drawerIdx - 1] : undefined;
  if (next) {
    const field = document.activeElement?.closest?.('#drawer-body') ? document.activeElement.dataset.field : '';
    openStaff(next, field || undefined);
    document.querySelector(`#staff-table tr[data-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
}

function renderDrawer() {
  const id = drawerId;
  const s = settings.staff[id];
  if (!s) return closeStaff();
  const r = rulesFor(s.company_id);
  const div = Number(r.salary_divisor) || 30.5;
  const monthly = noSalary(s) ? Number(r.monthly_salary) : Number(s.salary);
  const e = reportEmployee(id);
  const i = staffRows.indexOf(id);
  const gone = i < 0 && drawerIdx >= 0;   // fixed and no longer in this view
  const hasPrev = i > 0 || (gone && drawerIdx > 0);
  const hasNext = (i >= 0 && i < staffRows.length - 1) || (gone && drawerIdx < staffRows.length);
  const comps = companyList();
  $('drawer-body').innerHTML = `
    <div class="drawer-head">${avatar(s.name)}
      <div class="drawer-title"><h2>${esc(s.name || 'Unnamed')}</h2>
        <div class="hint">#${esc(id)}${s.device_id && s.device_id !== id ? ` · device ID ${esc(s.device_id)}` : ''}${s.left_on ? ` · <span class="left-tag">left ${esc(fmtDate(s.left_on))}</span>` : ''}</div></div>
      ${i >= 0 || gone ? `<span class="drawer-pos ${gone ? 'pos' : ''}">${gone ? '✓ done' : `${i + 1} / ${staffRows.length}`}</span>
      <button class="icon-btn" data-step="-1" ${hasPrev ? '' : 'disabled'} aria-label="Previous person" title="Previous (↑)"><svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg></button>
      <button class="icon-btn" data-step="1" ${hasNext ? '' : 'disabled'} aria-label="Next person" title="Next (↓)"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>` : ''}
      <button class="icon-btn" data-close-drawer aria-label="Close" title="Close (Esc)">${ICON.x}</button>
    </div>
    ${e ? `<div class="drawer-net">
      <div><span>Net · ${esc(fullMonth(report.month))}</span><b>${money(e.net_salary)}</b>${e.paid_on ? `<span class="pill good">✓ paid ${esc(fmtDate(e.paid_on))}</span>` : ''}</div>
      <div class="drawer-mini"><span><b>${e.present_days}</b> worked</span><span><b>${e.absences}</b> absent</span><span><b>${e.late_arrivals}</b> late</span>${e.early_leaves ? `<span><b>${e.early_leaves}</b> early</span>` : ''}</div>
      <a class="btn sm" href="${staffDownloadUrl(id)}?inline=1" target="_blank" rel="noopener">${ICON.print} Slip</a></div>` : ''}
    <form class="drawer-form" autocomplete="off">
      <section class="dsec">
        <h3><span class="dsec-icon tone-violet">${ICON.building}</span>Work</h3>
        <div class="dgrid">
          <label>Company<select class="input" data-field="company_id" data-key="drawer:company">${companyOptions(s.company_id, comps.length ? '— None —' : 'Add on Companies page')}</select></label>
          <label>Shift<select class="input" data-field="shift_id" data-key="drawer:shift">${shiftOptions(s.shift_id)}</select></label>
          <label class="wide">Monthly salary
            <div class="money-input"><span>₹</span><input class="input" data-field="salary" data-key="drawer:salary" type="number" min="0" step="1" inputmode="numeric"
              value="${esc(s.salary ?? '')}" placeholder="${esc(r.monthly_salary)} (default)"><em id="drawer-rate">${inr2.format(monthly / div)} / day</em></div>
            <span class="hint">Leave blank to use the default ${money(r.monthly_salary)}${s.company_id && settings.companies[s.company_id]?.rules ? ` (${esc(settings.companies[s.company_id].name)} rules)` : ''}. Daily rate = monthly ÷ ${div}.</span></label>
        </div>
      </section>
      <section class="dsec">
        <h3><span class="dsec-icon tone-blue">${ICON.bank}</span>Bank account<span class="hint">used for the bank transfer sheet</span></h3>
        <div class="dgrid">
          <label class="wide">Account holder<input class="input" data-field="bank_account_name" data-key="drawer:bank_name" value="${esc(s.bank_account_name || '')}" placeholder="Same as employee name"></label>
          <label>Account number<input class="input mono" data-field="bank_account_number" data-key="drawer:bank_acc" value="${esc(s.bank_account_number || '')}" inputmode="numeric" placeholder="e.g. 50100123456789"></label>
          <label>IFSC<input class="input mono" data-field="bank_ifsc" data-key="drawer:bank_ifsc" value="${esc(s.bank_ifsc || '')}" maxlength="11" placeholder="e.g. HDFC0001234"></label>
        </div>
      </section>
      <section class="dsec">
        <h3><span class="dsec-icon tone-slate">${ICON.clock}</span>Employment</h3>
        <label>Left on<input class="input" data-field="left_on" data-key="drawer:left" type="date" value="${esc(s.left_on || '')}">
          <span class="hint">Leave blank while they work here. People who left move to the Left list.</span></label>
      </section>
    </form>`;
}

async function loadDrawerHistory() {
  const id = drawerId;
  let p;
  try { p = await api(`/api/staff/${encodeURIComponent(id)}/profile`); } catch { return; }
  if (id !== drawerId) return;
  const hist = p.history;
  const max = Math.max(1, ...hist.map(h => h.net));
  $('drawer-history').innerHTML = `
    <section class="dsec">
      <h3><span class="dsec-icon tone-green">${ICON.wallet}</span>Month by month</h3>
      ${hist.length ? `<ul class="hist-list">${hist.map(h => `<li>
        <div class="hist-top"><b>${esc(fullMonth(h.month))}${h.locked ? ' 🔒' : ''}</b>
          ${h.paid_on ? `<span class="pill good">✓ paid</span>` : ''}<span class="spacer"></span><b>${money(h.net)}</b></div>
        <div class="hist-bar"><i style="width:${Math.round((h.net / max) * 100)}%"></i></div>
        <div class="hist-meta">${h.present} worked${h.leave_days ? ` +${h.leave_days} leave` : ''} · ${h.absences} absent · ${h.late} late${h.early ? ` · ${h.early} early` : ''}${h.overtime_minutes ? ` · ${fmtHours(h.overtime_minutes)} OT` : ''}${h.extra ? ` · <span class="${h.extra > 0 ? 'pos' : 'neg'}">${signed(h.extra)}</span>` : ''}</div>
      </li>`).join('')}</ul>` : '<p class="hint">Not in any saved month yet.</p>'}
    </section>
    <section class="dsec">
      <h3><span class="dsec-icon tone-amber">${ICON.rupee}</span>Advances</h3>
      ${p.advances.length ? `<ul class="adv-mini">${p.advances.map(a => `<li><span><b>${money(a.amount)}</b> given ${esc(fmtDate(a.date))}${a.note ? ` · ${esc(a.note)}` : ''}</span>
        <span class="${a.balance ? '' : 'pos'}">${a.balance ? `${money(a.balance)} left · ${money(a.installment)}/month` : 'repaid'}</span></li>`).join('')}</ul>` : '<p class="hint">No advances.</p>'}
    </section>`;
}

$('drawer-body').addEventListener('click', e => {
  if (e.target.closest('[data-close-drawer]')) return closeStaff();
  const step = e.target.closest('[data-step]');
  if (step) stepStaff(Number(step.dataset.step));
});
$('drawer-scrim').addEventListener('click', closeStaff);
$('drawer-body').addEventListener('submit', e => e.preventDefault());
$('drawer-body').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input.input')) { e.preventDefault(); e.target.blur(); }
});
// Live daily-rate preview while typing a monthly salary.
$('drawer-body').addEventListener('input', e => {
  if (e.target.dataset.field !== 'salary') return;
  const r = rulesFor(settings.staff[drawerId]?.company_id);
  const v = e.target.value.trim();
  const monthly = v === '' ? Number(r.monthly_salary) : Number(v);
  $('drawer-rate').textContent = Number.isFinite(monthly) ? `${inr2.format(monthly / (Number(r.salary_divisor) || 30.5))} / day` : '';
});
$('drawer-body').addEventListener('change', e => {
  const field = e.target.dataset.field;
  const id = drawerId;
  if (!field || !id) return;
  const name = settings.staff[id]?.name || id;
  const v = e.target.value.trim();
  if (field === 'salary') saveSettings({ staff: { [id]: { salary: v === '' ? null : v } } }, v === '' ? `${name}: default salary` : `${name}: salary ${money(v)}`);
  else if (field === 'left_on') {
    saveSettings({ label: v ? `${name} left` : `${name} back`, staff: { [id]: { left_on: v } } },
      v ? `${name} marked as left on ${fmtDate(v)}` : `${name} is current staff again`);
  } else saveSettings({ staff: { [id]: { [field]: e.target.value } } });
});
document.addEventListener('keydown', e => {
  if (!drawerId || !$('modal').classList.contains('hidden') || !$('lock-screen').classList.contains('hidden')) return;
  if (e.key === 'Escape') return closeStaff();
  if (e.target.matches?.('input, select, textarea')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); stepStaff(e.key === 'ArrowDown' ? 1 : -1); }
});

// ---------- Companies page ----------
const companyList = () => Object.entries(settings.companies || {}).map(([id, c]) => ({ id, ...c }));
const companyOptions = (current, noneLabel) => `<option value="">${esc(noneLabel)}</option>` + companyList().map(c =>
  `<option value="${esc(c.id)}" ${c.id === current ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
const hasBank = s => Boolean(s.bank_account_number && s.bank_ifsc);

function renderCompanies() {
  const comps = companyList();
  $('company-count').textContent = comps.length || '';
  $('company-empty').classList.toggle('hidden', comps.length > 0);
  const staff = staffList();
  const unassigned = staff.filter(s => !s.company_id && s.inSheet);
  const note = $('unassigned-note');
  note.classList.toggle('hidden', !comps.length || !unassigned.length);
  note.innerHTML = unassigned.length
    ? `<b>${unassigned.length} staff in the current sheet have no company</b> and won't appear in any firm's bank transfer sheet: ${unassigned.map(s => esc(s.name || s.id)).join(', ')}`
    : '';

  $('company-grid').innerHTML = comps.map(c => {
    const members = staff.filter(s => s.company_id === c.id);
    const emps = (report?.employees || []).filter(e => e.company_id === c.id);
    const net = emps.reduce((sum, e) => sum + e.net_salary, 0);
    const noBank = members.filter(s => s.inSheet && !hasBank(s));
    const others = staff.filter(s => s.company_id !== c.id);
    const field = (key, label, extra = '') => `<label class="field-label">${label}<input class="input" data-field="${key}"
      data-key="company:${esc(c.id)}:${key}" value="${esc(c[key] || '')}" ${extra}></label>`;
    return `<div class="company-card" data-id="${esc(c.id)}">
      <div class="head">
        <span class="icon">${ICON.building}</span>
        <input class="input name" data-field="name" data-key="company:${esc(c.id)}:name" value="${esc(c.name)}" aria-label="Company name">
      </div>
      <div class="co-stats">
        <div><span class="label">Staff</span><b>${members.length}</b></div>
        <div><span class="label">Net payable${report ? ` · ${esc(fmtMonth(report.month))}` : ''}</span><b>${report ? money(net) : '–'}</b></div>
        <div class="${noBank.length ? 'warn' : ''}"><span class="label">Missing bank details</span><b>${noBank.length}</b></div>
      </div>
      <div class="group-title">${ICON.bank} Salary paid from</div>
      <div class="bank-grid">
        ${field('bank_name', 'Bank', 'placeholder="e.g. State Bank of India"')}
        ${field('account_name', 'Account name', `placeholder="${esc(c.name)}"`)}
        ${field('account_number', 'Account number', 'inputmode="numeric"')}
        ${field('ifsc', 'IFSC', 'maxlength="11"')}
      </div>
      <div class="rules-line">
        <span>${c.rules ? `<b>Own salary rules</b> · late${Number(c.rules.early_leave) ? '/early' : ''} ${c.rules.late_mode === 'hourly' ? 'cut hourly' : `fine ${money(c.rules.late_fine)}`} · missing punch ${Number(c.rules.missing_punch_as_leave) ? 'leave' : `fine ${money(c.rules.missing_punch_fine)}`}` : 'Uses the default salary rules'}</span>
        <button class="btn sm" data-action="rules">Salary rules</button>
      </div>
      <div class="group-title">${ICON.people} Staff</div>
      <div class="members">${members.map(s => `<span class="pill ${s.inSheet && !hasBank(s) ? 'warn' : ''}" title="${s.inSheet && !hasBank(s) ? 'No bank account / IFSC' : ''}">${esc(s.name || s.id)}
          <button class="pill-x" data-action="unassign" data-staff="${esc(s.id)}" aria-label="Remove ${esc(s.name)} from ${esc(c.name)}">${ICON.x}</button></span>`).join('')
        || '<span class="muted small">No staff yet</span>'}</div>
      <select class="input add-staff" data-action="assign" aria-label="Add staff to ${esc(c.name)}">
        <option value="">+ Add staff…</option>
        ${others.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.id)}${s.company_id ? ` (from ${esc(settings.companies[s.company_id]?.name || '')})` : ''}</option>`).join('')}
      </select>
      <div class="foot">
        <button class="btn sm danger-text" data-action="delete">Delete</button>
        ${report ? `<a class="btn sm primary" href="/api/companies/${encodeURIComponent(c.id)}/bank-transfer.xlsx" title="Bulk salary transfer sheet for ${esc(fullMonth(report.month))}">${ICON.download} Bank transfer Excel</a>`
          : '<span class="muted small">Upload a sheet to download the bank transfer</span>'}
      </div>
    </div>`;
  }).join('');
}

const companyGrid = $('company-grid');
companyGrid.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
companyGrid.addEventListener('change', e => {
  const id = e.target.closest('.company-card')?.dataset.id;
  if (!id) return;
  if (e.target.dataset.action === 'assign') {
    if (e.target.value) saveSettings({ staff: { [e.target.value]: { company_id: id } } });
    return;
  }
  const field = e.target.dataset.field;
  if (field) saveSettings({ companies: { [id]: { [field]: e.target.value } } });
});
companyGrid.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  const id = btn?.closest('.company-card')?.dataset.id;
  if (!id) return;
  if (btn.dataset.action === 'rules') return showRules(id);
  if (btn.dataset.action === 'unassign') saveSettings({ staff: { [btn.dataset.staff]: { company_id: '' } } });
  if (btn.dataset.action === 'delete') {
    const c = settings.companies[id];
    const n = Object.values(settings.staff).filter(s => s.company_id === id).length;
    if (confirm(n ? `Delete "${c.name}"? Its ${n} staff will have no company.` : `Delete "${c.name}"?`)) saveSettings({ companies: { [id]: null } });
  }
});

$('btn-add-company').addEventListener('click', async () => {
  const id = `co_${Date.now().toString(36)}`;
  if (await saveSettings({ companies: { [id]: { name: `Company ${companyList().length + 1}` } } })) {
    const input = document.querySelector(`.company-card[data-id="${id}"] .name`);
    input?.focus();
    input?.select();
  }
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

// ---------- Advances page ----------
const advForm = $('advance-form');
const isCleared = a => !a.balance && !a.deduction;
const notStarted = a => a.start_month > month;

function renderAdvances() {
  const active = advances.filter(a => !isCleared(a));
  $('advance-count').textContent = active.length || '';
  $('advance-month-note').textContent = month ? `Showing deductions for ${fullMonth(month)}${report ? ' (the uploaded sheet)' : ''}.` : '';
  $('advance-month-head').textContent = `${fmtMonth(month)} (₹)`;

  // New-advance form: staff list and sensible defaults (keep what the user typed).
  const sel = advForm.elements.emp_id;
  const keep = sel.value;
  const people = staffList();
  sel.innerHTML = `<option value="">Choose staff…</option>` + people.map(p =>
    `<option value="${esc(p.id)}" ${p.id === keep ? 'selected' : ''}>${esc(p.name || p.id)} · #${esc(p.id)}${p.inSheet ? '' : ' (not in current sheet)'}</option>`).join('');
  if (!advForm.elements.date.value) advForm.elements.date.value = new Date().toLocaleDateString('en-CA');
  if (!advForm.elements.start_month.value) advForm.elements.start_month.value = defaultStartMonth();
  updatePlan();

  const counts = { active: active.length, cleared: advances.length - active.length, all: advances.length };
  $('advance-filter').innerHTML = [['active', 'Active'], ['cleared', 'Cleared'], ['all', 'All']].map(([k, label]) =>
    `<button data-filter="${k}" class="${advanceFilter === k ? 'active' : ''}">${label}<span class="n">${counts[k]}</span></button>`).join('');

  const rows = advances.filter(a => advanceFilter === 'all' || (advanceFilter === 'cleared') === isCleared(a));
  const empty = $('advance-empty');
  empty.classList.toggle('hidden', rows.length > 0);
  empty.textContent = !advances.length
    ? (people.length ? 'No advances yet. Add one above.' : 'Upload an attendance sheet first so your staff are listed.')
    : `No ${advanceFilter} advances.`;

  for (const id of [...openAdvances]) if (!advances.some(a => a.id === id)) openAdvances.delete(id);
  $('advance-table').tBodies[0].innerHTML = rows.map(a => {
    const s = settings.staff[a.emp_id] || {};
    const overridden = a.overrides && a.overrides[month] !== undefined;
    const locked = notStarted(a) || (isCleared(a) && !overridden);
    const status = notStarted(a) ? `<span class="pill">Starts ${esc(fmtMonth(a.start_month))}</span>`
      : isCleared(a) ? '<span class="pill good">Cleared</span>' : '';
    const open = openAdvances.has(a.id);
    return `<tr data-id="${esc(a.id)}" class="adv ${isCleared(a) ? 'cleared' : ''} ${open ? 'open' : ''}">
      <td><div class="person">${ICON.chev}${avatar(s.name)}
        <div><div class="name">${esc(s.name || a.emp_id)}</div><div class="id">#${esc(a.emp_id)}${report && !reportEmployee(a.emp_id) ? ' · not in current sheet' : ''}${a.note ? ` · ${esc(a.note)}` : ''}</div></div></div></td>
      <td>${esc(fmtDate(a.date))}<div class="id">from ${esc(fmtMonth(a.start_month))}</div></td>
      <td class="num">${money(a.amount)}</td>
      <td class="num"><input class="input amount sm" type="number" min="1" step="1" data-field="installment" data-key="adv:${esc(a.id)}:installment"
        value="${esc(a.installment)}" aria-label="Monthly deduction"></td>
      <td class="num">${locked ? `<span class="dim">–</span>` : `<input class="input amount sm ${overridden ? 'overridden' : ''}" type="number" min="0" step="1" data-field="override"
        data-key="adv:${esc(a.id)}:override" value="${esc(a.deduction)}" title="${overridden ? 'Changed for this month' : 'Planned deduction — change it to deduct a different amount (0 to skip) this month'}" aria-label="Deduction for ${esc(fullMonth(month))}">
        ${overridden ? `<button class="link" data-action="reset" title="Use the monthly deduction again">reset</button>` : ''}`}</td>
      <td class="num">${money(a.recovered)}</td>
      <td class="num"><b>${money(a.balance)}</b> ${status}</td>
      <td class="num"><button class="icon-btn" data-action="delete" title="Delete advance" aria-label="Delete advance">${ICON.trash}</button></td>
    </tr>${open ? scheduleRow(a) : ''}`;
  }).join('');
  renderRecovery();
}

// Month-by-month recovery of one advance: done, this month, planned.
function scheduleRow(a) {
  const stage = m => (m < month ? 'done' : m === month ? 'now' : 'plan');
  const label = { done: 'Recovered', now: 'This month', plan: 'Planned' };
  const chips = a.schedule.map(r => `<div class="rec ${stage(r.month)} ${r.overridden ? 'changed' : ''}">
      <div class="m">${esc(fmtMonth(r.month))}</div>
      <div class="amt">${r.deduction ? money(r.deduction) : 'Skipped'}</div>
      <div class="bal">${money(r.balance)} left</div>
      <div class="st">${label[stage(r.month)]}${r.overridden ? ' · changed' : ''}</div>
    </div>`).join('');
  const done = a.schedule.filter(r => r.month <= month).reduce((s, r) => s + r.deduction, 0);
  const last = a.schedule[a.schedule.length - 1];
  return `<tr class="detail"><td colspan="8">
    <div class="rec-head"><b>${money(a.amount)}</b> given ${esc(fmtDate(a.date))}
      · recovered <b>${money(done)}</b> up to ${esc(fmtMonth(month))}
      · ${last && !last.balance ? `fully repaid in <b>${esc(fmtMonth(last.month))}</b>` : 'not fully scheduled'}</div>
    <div class="rec-grid">${chips || '<span class="muted small">Nothing to recover.</span>'}</div>
  </td></tr>`;
}

// Total recovered per month across all advances.
function renderRecovery() {
  const byMonth = new Map();
  for (const a of advances) {
    const name = settings.staff[a.emp_id]?.name || a.emp_id;
    for (const r of a.schedule) {
      const row = byMonth.get(r.month) || { month: r.month, total: 0, balance: 0, people: [] };
      row.total += r.deduction;
      if (r.deduction) row.people.push(`${name} ${money(r.deduction)}`);
      byMonth.set(r.month, row);
    }
  }
  // Balance outstanding after each month = everything given (started by then) minus everything recovered.
  const months = [...byMonth.values()].sort((x, y) => x.month.localeCompare(y.month));
  for (const row of months) {
    row.balance = advances.reduce((s, a) => {
      if (a.start_month > row.month) return s;
      const upTo = a.schedule.filter(r => r.month <= row.month);
      return s + (upTo.length ? upTo[upTo.length - 1].balance : Number(a.amount));
    }, 0);
  }
  $('recovery-panel').classList.toggle('hidden', !months.length);
  const max = Math.max(1, ...months.map(r => r.total));
  $('recovery-table').tBodies[0].innerHTML = months.map(r => {
    const st = r.month < month ? 'done' : r.month === month ? 'now' : 'plan';
    return `<tr class="rec-row ${st}">
      <td><b>${esc(fullMonth(r.month))}</b>${st === 'now' ? ' <span class="pill shift">This month</span>' : st === 'plan' ? ' <span class="pill">Planned</span>' : ''}</td>
      <td class="num"><b>${money(r.total)}</b></td>
      <td class="bar-col"><div class="rbar"><i style="width:${(r.total / max) * 100}%"></i></div></td>
      <td class="who">${esc(r.people.join(', ')) || '<span class="dim">–</span>'}</td>
      <td class="num">${money(r.balance)}</td>
    </tr>`;
  }).join('');
}

// Deduct from the later of the sheet month and the month the advance was given.
function defaultStartMonth() {
  const given = (advForm.elements.date.value || '').slice(0, 7);
  return [given, month].filter(Boolean).sort().pop() || '';
}

function updatePlan() {
  const amount = Number(advForm.elements.amount.value), per = Number(advForm.elements.installment.value);
  const start = advForm.elements.start_month.value;
  if (!(amount > 0 && per > 0 && start)) return ($('adv-plan').textContent = '');
  const n = Math.ceil(amount / per);
  const last = amount - per * (n - 1);
  $('adv-plan').textContent = n === 1
    ? `Deducted in full from ${fmtMonth(start)} salary`
    : `${n} months: ${money(per)} from ${fmtMonth(start)} to ${fmtMonth(addMonths(start, n - 1))}${last !== per ? ` (last ${money(last)})` : ''}`;
}

let startTouched = false;
advForm.addEventListener('input', e => {
  if (e.target.name === 'start_month') startTouched = true;
  if (e.target.name === 'date' && !startTouched) advForm.elements.start_month.value = defaultStartMonth();
  updatePlan();
});

advForm.addEventListener('submit', async e => {
  e.preventDefault();
  const f = advForm.elements;
  if (Number(f.installment.value) > Number(f.amount.value)) f.installment.value = f.amount.value;
  const id = `adv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const adv = { emp_id: f.emp_id.value, amount: f.amount.value, installment: f.installment.value, date: f.date.value, start_month: f.start_month.value, note: f.note.value };
  const name = settings.staff[adv.emp_id]?.name || adv.emp_id;
  if (await saveSettings({ advances: { [id]: adv } })) {
    advForm.reset();
    startTouched = false;
    advanceFilter = 'active';
    renderAdvances();
    toast(`Added ${money(adv.amount)} advance for ${name}`);
  }
});

$('advance-filter').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  advanceFilter = b.dataset.filter;
  renderAdvances();
});

const advTable = $('advance-table');
advTable.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
advTable.addEventListener('change', e => {
  const id = e.target.closest('tr[data-id]')?.dataset.id;
  const field = e.target.dataset.field;
  if (!id || !field) return;
  const v = e.target.value.trim();
  if (field === 'installment') saveSettings({ advances: { [id]: { installment: v } } });
  if (field === 'override') saveSettings({ advances: { [id]: { overrides: { [month]: v === '' ? null : v } } } });
});
advTable.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) {
    const tr = e.target.closest('tr.adv');
    if (!tr || e.target.closest('input')) return;
    openAdvances.has(tr.dataset.id) ? openAdvances.delete(tr.dataset.id) : openAdvances.add(tr.dataset.id);
    return renderAdvances();
  }
  const id = btn.closest('tr[data-id]')?.dataset.id;
  if (!id) return;
  const a = advances.find(x => x.id === id);
  if (btn.dataset.action === 'reset') saveSettings({ advances: { [id]: { overrides: { [month]: null } } } });
  if (btn.dataset.action === 'delete') {
    const name = settings.staff[a.emp_id]?.name || a.emp_id;
    if (confirm(`Delete the ${money(a.amount)} advance for ${name}? Its deductions will be removed from every month.`)) {
      saveSettings({ advances: { [id]: null } });
    }
  }
});

// ---------- Folders ----------
// The path inputs are only filled on load and after a save, so typing is never overwritten by renderAll.
let folders = null;
const DIR_INPUT = { output: 'output-dir', data: 'data-dir', backup: 'backup-dir' };

function renderFolders(f) {
  folders = f;
  $('output-dir').value = f.output_dir;
  $('data-dir').value = f.data_dir;
  $('backup-dir').value = f.backup_dir;
  $('month-dir').textContent = f.month_dir;
  renderBackups(f.backups);
  renderPin(Boolean(f.pin_set));
  $('data-dir').disabled = f.data_locked;
  document.querySelectorAll('[data-pick="data"], [data-save="data"]').forEach(b => (b.disabled = f.data_locked));
  if (f.data_locked) $('data-hint').textContent = 'Set by the STAFFPAY_DATA_DIR environment variable.';
}

function renderBackups(list) {
  $('backup-list').innerHTML = list.length
    ? list.map(b => `<li><span>${esc(b.name)}<br><span class="muted">${new Date(b.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · ${Math.max(1, Math.round(b.size / 1024))} KB</span></span>
        <button class="btn sm" data-restore="${esc(b.name)}">Restore</button></li>`).join('')
    : '<li><span class="muted">No backups yet</span><span></span></li>';
}

$('backup-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-restore]');
  if (!b) return;
  if (!confirm(`Restore “${b.dataset.restore}”?\n\nYour current staff, settings and months are replaced by the ones in this backup. A backup of the current data is made first, so you can go back.`)) return;
  try {
    const res = await putJson('/api/backup/restore', { name: b.dataset.restore }, 'POST');
    applyState(res);
    renderFolders(res.folders);
    openRows.clear();
    renderAll();
    toast('Backup restored');
  } catch (err) { toast(err.message, true); }
});

async function saveFolder(which) {
  const value = $(DIR_INPUT[which]).value.trim();
  if (value === folders[`${which}_dir`]) return;
  if (which === 'data' && !confirm(`Use this data folder?\n\n${value}\n\nAn empty folder gets a copy of your current data; a folder with StaffPay data in it is used as it is.`)) {
    $('data-dir').value = folders.data_dir;
    return;
  }
  try {
    const res = await api('/api/folders', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [`${which}_dir`]: value }),
    });
    renderFolders(res.folders);
    applyState(res);
    renderAll();
    flashSaved();
    if (res.note) toast(res.note);
  } catch (err) { toast(err.message, true); }
}

$('tab-settings').addEventListener('click', async e => {
  const b = e.target.closest('button[data-pick], button[data-save], button[data-open]');
  if (!b) return;
  try {
    if (b.dataset.pick) {
      b.disabled = true;
      const { dir } = await api('/api/folders/pick', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ which: b.dataset.pick }),
      }).finally(() => (b.disabled = false));
      if (dir) { $(DIR_INPUT[b.dataset.pick]).value = dir; await saveFolder(b.dataset.pick); }
    }
    if (b.dataset.save) await saveFolder(b.dataset.save);
    if (b.dataset.open) await api('/api/folders/open', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ which: b.dataset.open }),
    });
  } catch (err) { toast(err.message, true); }
});
Object.entries(DIR_INPUT).forEach(([which, id]) => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') saveFolder(which); }));

$('btn-save-slips').addEventListener('click', async () => {
  const b = $('btn-save-slips');
  b.disabled = true;
  try {
    const { dir, count } = await api('/api/slips/save', { method: 'POST' });
    toast(`Saved ${count} slip${count === 1 ? '' : 's'} to ${dir}`);
    api('/api/folders/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ which: 'month' }) }).catch(() => {});
  } catch (err) { toast(err.message, true); } finally { b.disabled = false; }
});

// ---------- Reports ----------
let reportsScope = 'month';
let reportsData = null;
async function loadReports() {
  try { reportsData = await api('/api/reports'); renderReports(); } catch (err) {
    $('reports-body').innerHTML = `<p class="empty panel">${esc(err.message)}</p>`;
  }
}
function renderReports() {
  const d = reportsData;
  if (!d) return;
  if (!d.months.length) { $('reports-body').innerHTML = '<p class="empty panel">Upload an attendance sheet to see reports.</p>'; return; }
  const max = Math.max(1, ...d.months.map(m => m.net));
  const companies = [...new Set(d.months.flatMap(m => Object.keys(m.by_company)))].sort();
  const people = reportsScope === 'month' ? d.people_month : d.people_all;
  const top = (key, label, fmt = x => x, tone = '') => {
    const list = people.filter(p => p[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 6);
    const hi = Math.max(1, ...list.map(p => p[key]));
    return `<div class="rule-card report-card"><div class="group-title">${label}</div>
      ${list.length ? `<ol class="top-list">${list.map(p => `<li><button class="link-name" data-profile="${esc(p.id)}">${esc(p.name)}</button>
        <div class="bar-cell ${tone}"><i style="width:${Math.round((p[key] / hi) * 100)}%"></i><b>${fmt(p[key])}</b></div></li>`).join('')}</ol>` : '<p class="hint">Nobody.</p>'}</div>`;
  };
  const last = d.months.at(-1), prev = d.months.at(-2);
  const change = prev ? last.net - prev.net : 0;
  $('reports-body').innerHTML = `
    <div class="stats report-stats">
      <div class="stat pay"><div class="top"><span class="label">Net salary · ${esc(fullMonth(last.month))}</span><span class="chip">${ICON.wallet}</span></div><div class="value">${money(last.net)}</div>
        ${prev ? `<div class="stat-sub ${change > 0 ? 'neg' : 'pos'}">${change ? `${signed(change)} vs ${esc(fmtMonth(prev.month))}` : `same as ${esc(fmtMonth(prev.month))}`}</div>` : ''}</div>
      <div class="stat ded"><div class="top"><span class="label">Absences · ${esc(fmtMonth(last.month))}</span><span class="chip">${ICON.minus}</span></div><div class="value">${last.absences}</div></div>
      <div class="stat fine"><div class="top"><span class="label">Late arrivals · ${esc(fmtMonth(last.month))}</span><span class="chip">${ICON.alert}</span></div><div class="value">${last.late}</div></div>
      <div class="stat ot"><div class="top"><span class="label">Overtime · ${esc(fmtMonth(last.month))}</span><span class="chip">${ICON.clock}</span></div><div class="value">${fmtHours(last.overtime_minutes || 0)}</div></div>
    </div>
    <div class="panel report-panel">
      <div class="panel-head"><h2>Net salary by month</h2><span class="muted small">${d.months.length} month${d.months.length > 1 ? 's' : ''} saved</span></div>
      <div class="month-bars">${d.months.map(m => `<div class="mbar" title="${esc(fullMonth(m.month))}: ${money(m.net)}">
        <span class="mbar-val">${money(m.net)}</span><div class="mbar-track"><i style="height:${Math.max(3, Math.round((m.net / max) * 100))}%"></i></div>
        <span class="mbar-label">${esc(fmtMonth(m.month))}${m.locked ? ' 🔒' : ''}</span></div>`).join('')}</div>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Month</th>${companies.map(c => `<th class="num">${esc(c)}</th>`).join('')}
        <th class="num">Deductions</th><th class="num">Fines</th><th class="num">Overtime</th><th class="num">Adjust.</th><th class="num">Total net</th><th class="num">Paid</th></tr></thead>
        <tbody>${[...d.months].reverse().map(m => `<tr><td>${esc(fullMonth(m.month))}${m.locked ? ' 🔒' : ''}</td>
          ${companies.map(c => `<td class="num">${m.by_company[c] ? money(m.by_company[c]) : '<span class="dim">–</span>'}</td>`).join('')}
          <td class="num neg">${m.attendance_deduction ? '−' + money(m.attendance_deduction) : '–'}</td><td class="num neg">${m.fines ? '−' + money(m.fines) : '–'}</td>
          <td class="num pos">${m.overtime ? '+' + money(m.overtime) : '–'}</td><td class="num">${m.extra_earnings - m.extra_deductions ? signed(m.extra_earnings - m.extra_deductions) : '–'}</td>
          <td class="num"><b>${money(m.net)}</b></td><td class="num">${m.paid_count}/${m.employees}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="report-scope"><div class="segmented" id="reports-scope">
      <button data-scope="month" class="${reportsScope === 'month' ? 'active' : ''}">${esc(fullMonth(activeMonth || last.month))}</button>
      <button data-scope="all" class="${reportsScope === 'all' ? 'active' : ''}">All months</button></div></div>
    <div class="report-grid">
      ${top('absences', 'Most absences', x => `${x} day${x === 1 ? '' : 's'}`, 'rose')}
      ${top('late', 'Most often late', x => `${x}×`, 'amber')}
      ${top('half_days', 'Most half days', x => `${x}`, 'blue')}
      ${top('overtime_minutes', 'Most overtime', x => fmtHours(x), 'green')}
    </div>`;
}
$('reports-body').addEventListener('click', e => {
  const sc = e.target.closest('[data-scope]');
  if (sc) { reportsScope = sc.dataset.scope; return renderReports(); }
  const p = e.target.closest('[data-profile]');
  if (p) openProfile(p.dataset.profile);
});

// ---------- PIN lock ----------
let pinSet = false;
function showLock() {
  $('lock-screen').classList.remove('hidden');
  $('lock-error').textContent = '';
  $('lock-pin').value = '';
  setTimeout(() => $('lock-pin').focus(), 50);
}
$('lock-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await putJson('/api/auth/unlock', { pin: $('lock-pin').value }, 'POST');
    $('lock-screen').classList.add('hidden');
    applyState(await api('/api/state'));
    renderAll();
    renderFolders(await api('/api/folders'));
  } catch (err) {
    $('lock-error').textContent = err.message;
    $('lock-pin').select();
  }
});
$('btn-lock').addEventListener('click', async () => {
  await api('/api/auth/lock', { method: 'POST' }).catch(() => {});
  closeModal();
  showLock();
});

function renderPin(set) {
  pinSet = set;
  $('btn-lock').classList.toggle('hidden', !set);
  $('pin-status').textContent = set ? 'A PIN is set — StaffPay asks for it when opened.' : 'No PIN — anyone at this computer can open StaffPay.';
  $('pin-current-row').classList.toggle('hidden', !set);
  $('btn-pin-remove').classList.toggle('hidden', !set);
  $('btn-pin-save').textContent = set ? 'Change PIN' : 'Set PIN';
  $('pin-current').value = '';
  $('pin-new').value = '';
}
async function savePin(remove) {
  const body = { current: $('pin-current').value, pin: remove ? '' : $('pin-new').value.trim() };
  if (!remove && !/^\d{4,8}$/.test(body.pin)) return toast('PIN must be 4 to 8 digits', true);
  if (remove && !confirm('Remove the PIN? Anyone at this computer will be able to open StaffPay.')) return;
  try {
    const res = await putJson('/api/auth/pin', body);
    renderPin(res.pin_set);
    toast(res.pin_set ? 'PIN saved — keep it safe' : 'PIN removed');
  } catch (err) { toast(err.message, true); }
}
$('btn-pin-save').addEventListener('click', () => savePin(false));
$('btn-pin-remove').addEventListener('click', () => savePin(true));

// ---------- Version / updates / backup ----------
const fmtTime = iso => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
let appVersion = '';

function renderVersion(v) {
  appVersion = v.version;
  $('version').textContent = `StaffPay v${v.version}`;
  $('app-version').textContent = `StaffPay v${v.version}`;
  $('auto-update').checked = v.auto_update;
  $('auto-update-row').classList.toggle('hidden', !v.can_self_update);
  $('no-self-update').classList.toggle('hidden', v.can_self_update);
  const available = v.update_available;
  $('btn-update-now').classList.toggle('hidden', !available || !v.can_self_update);
  $('btn-download-update').classList.toggle('hidden', !available || v.can_self_update);
  $('btn-download-update').href = v.download_url || v.releases_url || '#';
  $('settings-badge').classList.toggle('hidden', !available);
  $('update-status').textContent = available ? `Version ${v.latest} is available.`
    : v.latest ? `You have the latest version${v.checked_at ? ` (checked ${fmtTime(v.checked_at)})` : ''}.`
      : 'Could not check for updates (offline?).';
  const card = $('update-card');
  card.classList.toggle('hidden', !available);
  if (available) {
    card.href = v.can_self_update ? '#settings' : (v.download_url || v.releases_url);
    card.target = v.can_self_update ? '' : '_blank';
    card.title = `StaffPay v${v.latest}`;
    $('update-title').textContent = `v${v.latest} is ready`;
    card.querySelector('.update-link').textContent = v.can_self_update ? 'Update now →' : 'Download installer →';
  }
  renderUpdate(v.update);
}

// Download progress in the card; the overlay only while installing (the app restarts) or when "Update now" was clicked.
let updateRequested = false;
function renderUpdate(u) {
  const busy = u.status === 'downloading' || u.status === 'installing';
  $('update-progress').classList.toggle('hidden', u.status !== 'downloading');
  $('update-progress').firstElementChild.style.width = `${Math.round((u.progress || 0) * 100)}%`;
  if (u.status === 'downloading') $('update-status').textContent = `Downloading version ${u.version}… ${Math.round((u.progress || 0) * 100)}%`;
  if (u.status === 'ready') $('update-status').textContent = `Version ${u.version} is downloaded and installs after 5 minutes without use.`;
  if (u.status === 'error') $('update-status').textContent = `Update failed: ${u.error}`;
  $('btn-update-now').disabled = busy;
  const overlay = u.status === 'installing' || (updateRequested && busy);
  $('update-overlay').classList.toggle('hidden', !overlay);
  if (overlay) {
    $('overlay-title').textContent = `Updating StaffPay to v${u.version}…`;
    $('overlay-text').textContent = u.status === 'installing' ? 'Installing — StaffPay restarts and this page reloads by itself.'
      : `Downloading the new version… ${Math.round((u.progress || 0) * 100)}%`;
  }
  if (u.status === 'error' && updateRequested) { updateRequested = false; toast(`Update failed: ${u.error}`, true); }
  if (u.status === 'installing') waitForRestart();
}

// After installing, the server goes away and comes back as the new version: reload then.
let waiting = false;
async function waitForRestart() {
  if (waiting) return;
  waiting = true;
  const old = appVersion;
  for (;;) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const v = await api('/api/version');
      if (v.version !== old) { location.reload(); return; }
    } catch { /* restarting */ }
  }
}

async function checkVersion(force = false) {
  try { renderVersion(await api(`/api/version${force ? '?force=1' : ''}`)); } catch { /* offline: ignore */ }
}

// Poll the update status: quickly while something is happening, otherwise every 30 s (catches automatic installs).
(function pollUpdate() {
  api('/api/update').then(u => {
    renderUpdate(u);
    if (u.status === 'ready' && $('btn-update-now').classList.contains('hidden')) checkVersion();
    setTimeout(pollUpdate, u.status === 'downloading' || u.status === 'installing' || updateRequested ? 1000 : 30000);
  }).catch(() => setTimeout(pollUpdate, 30000));
})();

$('btn-check-update').addEventListener('click', async () => {
  const b = $('btn-check-update');
  b.disabled = true;
  $('update-status').textContent = 'Checking for updates…';
  await checkVersion(true);
  b.disabled = false;
});

$('btn-update-now').addEventListener('click', async () => {
  if (!confirm('Install the new version now? StaffPay backs up your data, restarts, and this page reloads.')) return;
  try {
    updateRequested = true;
    renderUpdate(await api('/api/update', { method: 'POST' }));
  } catch (err) { updateRequested = false; toast(err.message, true); checkVersion(); }
});

$('auto-update').addEventListener('change', async e => {
  try {
    renderVersion(await api('/api/app', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto_update: e.target.checked }),
    }));
    flashSaved();
  } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
});

$('btn-backup-now').addEventListener('click', async () => {
  const b = $('btn-backup-now');
  b.disabled = true;
  try {
    const res = await api('/api/backup', { method: 'POST' });
    renderBackups(res.folders.backups);
    toast(`Backup saved: ${res.file}`);
  } catch (err) { toast(err.message, true); } finally { b.disabled = false; }
});

// ---------- Start ----------
checkVersion();
(async function init() {
  try {
    const a = await api('/api/auth');
    if (!a.unlocked) return showLock();
    applyState(await api('/api/state'));
    renderAll();
    renderFolders(await api('/api/folders'));
  } catch (e) {
    if (e.status !== 401) toast(e.message, true);
  }
})();
