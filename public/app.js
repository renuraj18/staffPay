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
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
  rupee: '<svg viewBox="0 0 24 24"><path d="M7 5h10M7 9.5h10M10 5c5 0 5 9 0 9H7l7 6"/></svg>',
  building: '<svg viewBox="0 0 24 24"><path d="M4 20V6.5L11 4v16"/><path d="M11 9h9v11"/><path d="M3 20h18"/><path d="M7 9h.01M7 12.5h.01M7 16h.01M14.5 12.5h2M14.5 16h2"/></svg>',
  bank: '<svg viewBox="0 0 24 24"><path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20h18"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>',
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
    applyState(res);
    renderAll();
    flashSaved();
    return true;
  } catch (err) {
    toast(err.message, true);
    renderAll(); // show the saved values again
    return false;
  }
}

function applyState(res) {
  ({ settings, report, advances, month } = res);
}

const divisor = () => Number(settings.rules.salary_divisor) || 30.5;
const savedShifts = () => settings.shifts;
const shiftById = id => savedShifts().find(s => s.id === id) || savedShifts()[0];
const reportEmployee = id => report?.employees.find(e => e.id === id);

// ---------- Rendering ----------
function setTab(tab) {
  if (!['salary', 'rules', 'staff', 'companies', 'shifts', 'advances'].includes(tab)) tab = 'salary';
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

async function uploadFile(file) {
  if (!file) return;
  $('upload-error').classList.add('hidden');
  $('progress').classList.remove('hidden');
  const body = new FormData();
  body.append('file', file);
  try {
    applyState(await api('/api/upload', { method: 'POST', body }));
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

  const comps = companyList();
  if (salaryCompanyFilter !== 'all' && salaryCompanyFilter !== '' && !settings.companies[salaryCompanyFilter]) salaryCompanyFilter = 'all';
  const cf = $('salary-company-filter');
  cf.classList.toggle('hidden', !comps.length);
  const inCompany = id => r.employees.filter(e => e.company_id === id).length;
  cf.innerHTML = comps.length ? [['all', 'All', r.employees.length], ...comps.map(c => [c.id, c.name, inCompany(c.id)]),
    ...(inCompany('') ? [['', 'No company', inCompany('')]] : [])]
    .map(([id, label, n]) => `<button data-filter="${esc(id)}" class="${salaryCompanyFilter === id ? 'active' : ''}">${esc(label)}<span class="n">${n}</span></button>`).join('') : '';
  const emps = r.employees.filter(e => salaryCompanyFilter === 'all' || e.company_id === salaryCompanyFilter);
  const t = salaryCompanyFilter === 'all' ? r.totals : Object.fromEntries(Object.keys(r.totals).map(k => [k, emps.reduce((s, e) => s + (e[k] || 0), 0)]));
  const stat = (label, value, icon, cls = '') =>
    `<div class="stat ${cls}"><div class="top"><span class="label">${label}</span><span class="chip">${icon}</span></div><div class="value">${value}</div></div>`;
  const statCount = 5 + (t.advance_deduction ? 1 : 0) + (t.overtime_incentive ? 1 : 0);
  $('stats').style.setProperty('--n', statCount - 1);
  $('stats').innerHTML =
    stat('Employees', emps.length, ICON.people) +
    stat('Monthly salaries', money(t.base_salary), ICON.wallet) +
    stat('Attendance deductions', money(t.attendance_deduction), ICON.minus, 'ded') +
    stat('Fines', money(t.total_fines), ICON.alert, 'fine') +
    (t.advance_deduction ? stat('Advance recovery', money(t.advance_deduction), ICON.rupee, 'adv') : '') +
    (t.overtime_incentive ? stat(`Overtime incentive · ${fmtHours(t.overtime_minutes)}`, money(t.overtime_incentive), ICON.clock, 'ot') : '') +
    stat('Net payable', money(t.net_salary), ICON.check, 'net');

  $('salary-table').tBodies[0].innerHTML = emps.map(e => {
    const open = openRows.has(e.id);
    const row = `
      <tr class="emp ${open ? 'open' : ''}" data-id="${esc(e.id)}">
        <td><div class="person">${ICON.chev}<span class="avatar">${esc(initials(e.name))}</span>
          <div><div class="name">${esc(e.name)}</div><div class="id">#${esc(e.device_id || e.id)}</div></div></div></td>
        <td><span class="pill shift" title="${esc(e.shift_time)}">${esc(e.shift_name)}</span></td>
        <td>${e.company_name ? `<span class="pill company">${esc(e.company_name)}</span>` : '<span class="dim">–</span>'}</td>
        <td class="num">${money(e.monthly_salary)}${e.salary_mapped ? '' : '<div class="default-note" title="No salary entered — using the default monthly salary">default</div>'}</td>
        <td class="num">${e.present_days}</td>
        <td class="num">${e.half_days || '<span class="dim">–</span>'}</td>
        <td class="num">${e.absences}${e.excess_absences && e.excess_absences !== e.absences ? ` <span class="excess">(${e.excess_absences})</span>` : ''}</td>
        <td class="num">${e.off_days}</td>
        <td class="num">${e.late_arrivals}</td>
        <td class="num">${e.missing_punches ? `<span class="count-miss">${e.missing_punches}</span>` : '0'}</td>
        <td class="num ${e.attendance_deduction ? 'neg' : 'dim'}">${e.attendance_deduction ? '−' + money(e.attendance_deduction) : '–'}</td>
        <td class="num ${e.total_fines ? 'neg' : 'dim'}">${e.total_fines ? '−' + money(e.total_fines) : '–'}</td>
        <td class="num ${e.advance_deduction ? 'neg' : 'dim'}">${e.advance_deduction ? '−' + money(e.advance_deduction) : '–'}</td>
        <td class="num ${e.overtime_incentive ? 'pos' : 'dim'}" title="${e.overtime_minutes ? fmtHours(e.overtime_minutes) + ' extra' : ''}">${e.overtime_incentive ? '+' + money(e.overtime_incentive) : '–'}</td>
        <td class="num net">${money(e.net_salary)}</td>
        <td class="num"><a class="icon-btn dl" href="${staffDownloadUrl(e.id)}" title="Download ${esc(e.name)}'s salary slip for ${esc(fullMonth(r.month))} (PDF)" aria-label="Download salary slip for ${esc(e.name)}">${ICON.download}</a></td>
      </tr>`;
    return row + (open ? detailRow(e) : '');
  }).join('');

  $('salary-table').tFoot.innerHTML = `
    <tr>
      <td>Total · ${emps.length} staff</td><td></td><td></td>
      <td class="num">${money(t.base_salary)}</td>
      <td class="num">${t.present_days}</td><td class="num">${t.half_days}</td><td class="num">${t.absences}</td>
      <td class="num">${t.off_days}</td><td class="num">${t.late_arrivals}</td>
      <td class="num">${t.missing_punches}</td>
      <td class="num">${money(t.attendance_deduction)}</td><td class="num">${money(t.total_fines)}</td>
      <td class="num">${money(t.advance_deduction)}</td><td class="num">${money(t.overtime_incentive)}</td>
      <td class="num">${money(t.net_salary)}</td><td></td>
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
    const flags = [d.late && (d.late_hours ? `LATE −${fmtHours(d.late_hours * 60)}` : 'LATE'), d.missing_in && 'NO IN', d.missing_out && 'NO OUT', d.ot_minutes && `+${fmtHours(d.ot_minutes)}`]
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
    `Daily rate ${inr2.format(e.daily_salary)} <span class="dim">(÷ ${e.rules.salary_divisor})</span> · hourly ${inr2.format(e.hourly_rate)}`,
    e.rules_name !== 'Default' ? `<span class="pill company">${esc(e.rules_name)} rules</span>` : '',
    !e.absences ? 'No absences'
      : e.allowed_absences ? `Absences ${e.absences} <span class="dim">(${e.allowed_absences} paid, ${e.excess_absences} deducted)</span>` : `Absences ${e.absences} <span class="dim">deducted</span>`,
    e.half_days ? `Half days ${e.half_days}` : '',
    e.attendance_deduction ? `Deduction <b class="neg">−${money(e.attendance_deduction)}</b>` : '',
    e.late_fine ? (e.rules.late_mode === 'hourly' ? `Late ${fmtHours(e.late_hours * 60)} cut −${money(e.late_fine)}` : `Late fines −${money(e.late_fine)}`) : '',
    e.missing_punch_fine ? `Missing punch fines −${money(e.missing_punch_fine)}` : '',
    e.overtime_incentive ? `Overtime ${fmtHours(e.overtime_minutes)} × ${inr2.format(e.overtime_rate)}/h${e.rules.overtime_mode === 'fixed' ? ' <span class="dim">(fixed)</span>' : ''} <b class="pos">+${money(e.overtime_incentive)}</b>` : '',
    ...e.advances.map(a => a.start_month > report.month
      ? `Advance ${money(a.amount)} <span class="dim">deducting from ${fmtMonth(a.start_month)}</span>`
      : a.deduction
        ? `Advance −${money(a.deduction)} <span class="dim">(${money(a.balance)} left of ${money(a.amount)})</span>`
        : `Advance <span class="dim">skipped this month (${money(a.balance)} left)</span>`),
    `Net <b>${money(e.net_salary)}</b>`,
  ].filter(Boolean);

  return `<tr class="detail"><td colspan="16">
    <div class="legend">
      <span><i class="c-present"></i>Present</span><span><i class="c-late"></i>Late</span>${Number(e.rules.missing_punch_as_leave) ? '' : '<span><i class="c-missing"></i>Missing punch</span>'}
      <span><i class="c-half"></i>Half day</span><span><i class="c-absent"></i>Absent</span><span><i class="c-off"></i>Weekly off / holiday</span>
    </div>
    <div class="days">${tiles}</div>
    <div class="breakdown">${parts.map(p => `<span>${p}</span>`).join('')}
      <a class="btn sm" href="${staffDownloadUrl(e.id)}">${ICON.download} Salary slip (PDF)</a></div>
  </td></tr>`;
}

$('salary-table').tBodies[0].addEventListener('click', e => {
  const tr = e.target.closest('tr.emp');
  if (!tr || e.target.closest('a')) return;
  const id = tr.dataset.id;
  openRows.has(id) ? openRows.delete(id) : openRows.add(id);
  renderSalary();
});

$('salary-company-filter').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  salaryCompanyFilter = b.dataset.filter;
  renderSalary();
});

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
  $('late-example').textContent = `Example: shift starts 9:00, clock in 9:15 → ${fmtHours(cut * 60)} salary cut. Grace minutes of the shift still apply.`;
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

  const comps = companyList();
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
  const rows = all.filter(s => (staffFilter === 'all' || s.shift_id === staffFilter)
    && (staffCompanyFilter === 'all' || (s.company_id || '') === staffCompanyFilter));
  $('staff-empty').classList.toggle('hidden', all.length > 0);
  $('staff-toolbar').classList.toggle('hidden', all.length === 0);

  $('staff-table').tBodies[0].innerHTML = rows.map(s => {
    const e = reportEmployee(s.id);
    const monthly = s.salary ?? '';
    const r = rulesFor(s.company_id);
    const rate = (monthly === '' ? Number(r.monthly_salary) : Number(monthly)) / (Number(r.salary_divisor) || 30.5);
    return `<tr data-id="${esc(s.id)}" class="${selected.has(s.id) ? 'selected' : ''}">
      <td class="check"><input type="checkbox" class="pick" ${selected.has(s.id) ? 'checked' : ''} aria-label="Select ${esc(s.name)}"></td>
      <td><div class="person"><span class="avatar">${esc(initials(s.name))}</span>
        <div><div class="name">${esc(s.name || 'Unnamed')}</div><div class="id">#${esc(s.device_id || s.id)}${s.inSheet ? '' : ' · not in current sheet'}</div></div></div></td>
      <td><select class="input" data-field="company_id" data-key="staff:${esc(s.id)}:company" aria-label="Company">${companyOptions(s.company_id, comps.length ? '— None —' : 'Add on Companies page')}</select></td>
      <td><select class="input" data-field="shift_id" data-key="staff:${esc(s.id)}:shift" aria-label="Shift">${shiftOptions(s.shift_id)}</select></td>
      <td class="num"><input class="input amount" data-field="salary" data-key="staff:${esc(s.id)}:salary" type="number" min="0" step="1"
        value="${esc(monthly)}" placeholder="${esc(r.monthly_salary)}" title="Leave blank to use the default monthly salary" aria-label="Monthly salary for ${esc(s.name)}"></td>
      <td class="num rate-cell">${inr2.format(rate)}</td>
      <td><input class="input bank-name" data-field="bank_account_name" data-key="staff:${esc(s.id)}:bank_name" value="${esc(s.bank_account_name || '')}"
        placeholder="${esc(s.name || '')}" aria-label="Account holder name for ${esc(s.name)}"></td>
      <td><input class="input bank-acc" data-field="bank_account_number" data-key="staff:${esc(s.id)}:bank_acc" value="${esc(s.bank_account_number || '')}"
        inputmode="numeric" placeholder="Account number" aria-label="Account number for ${esc(s.name)}"></td>
      <td><input class="input bank-ifsc" data-field="bank_ifsc" data-key="staff:${esc(s.id)}:bank_ifsc" value="${esc(s.bank_ifsc || '')}"
        maxlength="11" placeholder="IFSC" aria-label="IFSC for ${esc(s.name)}"></td>
      <td class="num">${e ? `<b>${money(e.net_salary)}</b>` : '<span class="dim">–</span>'}</td>
    </tr>`;
  }).join('');
  updateSelection();
}

function updateSelection() {
  $('selected-count').textContent = `${selected.size} selected`;
  $('btn-bulk-shift').disabled = selected.size === 0;
  $('btn-bulk-company').disabled = selected.size === 0;
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
  const r = rulesFor(settings.staff[e.target.closest('tr').dataset.id]?.company_id);
  const monthly = v === '' ? Number(r.monthly_salary) : Number(v);
  e.target.closest('tr').querySelector('.rate-cell').textContent = Number.isFinite(monthly) ? inr2.format(monthly / (Number(r.salary_divisor) || 30.5)) : '–';
});

$('staff-table').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input.input')) e.target.blur();
});
$('staff-company-filter').addEventListener('change', e => { staffCompanyFilter = e.target.value; renderStaff(); });

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
  } else if (field === 'shift_id' || field === 'company_id') {
    saveSettings({ staff: { [id]: { [field]: e.target.value } } });
  } else if (field?.startsWith('bank_')) {
    saveSettings({ staff: { [id]: { [field]: e.target.value } } });
  }
});

$('btn-bulk-shift').addEventListener('click', async () => {
  const shift_id = $('bulk-shift').value;
  const staff = Object.fromEntries([...selected].map(id => [id, { shift_id }]));
  const n = selected.size;
  selected.clear();
  if (await saveSettings({ staff })) toast(`Moved ${n} staff to ${shiftById(shift_id).name}`);
});

$('btn-bulk-company').addEventListener('click', async () => {
  const company_id = $('bulk-company').value;
  const staff = Object.fromEntries([...selected].map(id => [id, { company_id }]));
  const n = selected.size;
  selected.clear();
  if (await saveSettings({ staff })) toast(`${n} staff set to ${settings.companies[company_id]?.name || 'no company'}`);
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
        <span>${c.rules ? `<b>Own salary rules</b> · late ${c.rules.late_mode === 'hourly' ? 'cut hourly' : `fine ${money(c.rules.late_fine)}`} · missing punch ${Number(c.rules.missing_punch_as_leave) ? 'leave' : `fine ${money(c.rules.missing_punch_fine)}`}` : 'Uses the default salary rules'}</span>
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
    `<option value="${esc(p.id)}" ${p.id === keep ? 'selected' : ''}>${esc(p.name || p.id)} · #${esc(p.device_id || p.id)}${p.inSheet ? '' : ' (not in current sheet)'}</option>`).join('');
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
      <td><div class="person">${ICON.chev}<span class="avatar">${esc(initials(s.name))}</span>
        <div><div class="name">${esc(s.name || a.emp_id)}</div><div class="id">#${esc(s.device_id || a.emp_id)}${report && !reportEmployee(a.emp_id) ? ' · not in current sheet' : ''}${a.note ? ` · ${esc(a.note)}` : ''}</div></div></div></td>
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
    applyState(await api('/api/state'));
    renderAll();
  } catch (e) {
    toast(e.message, true);
  }
})();
