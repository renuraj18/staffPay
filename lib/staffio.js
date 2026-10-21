// Staff list as Excel: export every staff record, edit it in Excel, import it back.
const XLSX = require('xlsx');

const COLUMNS = ['Staff ID', 'Name', 'Company', 'Shift', 'Monthly salary', 'Account holder', 'Account number', 'IFSC', 'Left on'];

function buildStaffWorkbook(settings) {
  const companyName = id => settings.companies[id]?.name || '';
  const shiftName = id => settings.shifts.find(s => s.id === id)?.name || '';
  const rows = Object.entries(settings.staff)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, s]) => [id, s.name || '', companyName(s.company_id), shiftName(s.shift_id), s.salary ?? '',
      s.bank_account_name || '', s.bank_account_number || '', s.bank_ifsc || '', s.left_on || '']);
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows]);
  ws['!cols'] = [10, 26, 18, 14, 14, 24, 20, 14, 12].map(wch => ({ wch }));
  const help = XLSX.utils.aoa_to_sheet([
    ['How to use this sheet'],
    ['Edit the Staff sheet and import it on the Staff page. Rows are matched by Staff ID.'],
    ['A blank Company, Monthly salary, bank field or Left on clears it (blank salary = default salary).'],
    ['Company and Shift must match names in StaffPay. Left on is a date (YYYY-MM-DD) or blank for current staff.'],
    ['A new Staff ID with a Name adds that person.'],
  ]);
  help['!cols'] = [{ wch: 100 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Staff');
  XLSX.utils.book_append_sheet(wb, help, 'How to use');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const text = v => String(v ?? '').trim();
// Excel may give a date cell as a number or Date; Left on is wanted as YYYY-MM-DD.
function dateText(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
  const s = text(v);
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // DD-MM-YYYY
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
}

/**
 * Rows of an edited staff workbook as settings patches: [{row, id, patch}] plus {errors: [{row, error}]}
 * for rows that can't be read (unknown company/shift, no ID). Validation of values is left to applyPatch.
 */
function parseStaffWorkbook(buffer, settings) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets.Staff || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const head = (rows[0] || []).map(h => text(h).toLowerCase());
  const col = name => head.indexOf(name.toLowerCase());
  if (col('Staff ID') < 0) throw Object.assign(new Error('The sheet needs a "Staff ID" column — export the staff list to get the right layout'), { status: 400 });
  const byName = (list, name) => list.find(x => text(x.name).toLowerCase() === name.toLowerCase());
  const companies = Object.entries(settings.companies).map(([id, c]) => ({ id, name: c.name }));
  const out = { rows: [], errors: [] };
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const get = name => (col(name) >= 0 ? r[col(name)] : undefined);
    const id = text(get('Staff ID'));
    if (!id && !r.some(v => text(v))) return; // blank row
    if (!id) { out.errors.push({ row, error: 'Staff ID is empty' }); return; }
    const patch = {};
    const name = text(get('Name'));
    if (name) patch.name = name;
    else if (!settings.staff[id]) { out.errors.push({ row, error: `New staff ${id} needs a Name` }); return; }
    if (get('Company') !== undefined) {
      const c = text(get('Company'));
      const found = c && byName(companies, c);
      if (c && !found) { out.errors.push({ row, error: `Unknown company "${c}"` }); return; }
      patch.company_id = found ? found.id : '';
    }
    const shift = text(get('Shift'));
    if (shift) {
      const found = byName(settings.shifts, shift);
      if (!found) { out.errors.push({ row, error: `Unknown shift "${shift}"` }); return; }
      patch.shift_id = found.id;
    }
    if (get('Monthly salary') !== undefined) patch.salary = text(get('Monthly salary')) === '' ? null : Number(String(get('Monthly salary')).replace(/[,₹\s]/g, ''));
    if (get('Account holder') !== undefined) patch.bank_account_name = text(get('Account holder'));
    if (get('Account number') !== undefined) patch.bank_account_number = text(get('Account number'));
    if (get('IFSC') !== undefined) patch.bank_ifsc = text(get('IFSC'));
    if (get('Left on') !== undefined) patch.left_on = dateText(get('Left on'));
    out.rows.push({ row, id, patch });
  });
  return out;
}

module.exports = { buildStaffWorkbook, parseStaffWorkbook, COLUMNS };
