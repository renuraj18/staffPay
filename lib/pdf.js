const PDFParser = require('pdf2json');

// Column order of the rebuilt table; PDF headers map onto these (the PDF says "Actual WT").
const COLUMNS = ['Date', 'Check In', 'Check Out', 'Clock In', 'Clock Out', 'Total WT', 'Status'];
const HEADER_ALIASES = { 'actual wt': 'Total WT' };
const CELL_GAP = 1.2; // gap (page units) between glyphs that starts a new cell; columns are ≥ 2.5 apart
const ROW_GAP = 0.3;  // glyphs within this vertical distance are on the same line

function loadPdf(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, false);
    parser.on('pdfParser_dataError', e => reject(e.parserError || e));
    parser.on('pdfParser_dataReady', resolve);
    // pdf.js reads the underlying ArrayBuffer and ignores the offset, so a small Buffer sliced
    // from Node's shared pool would parse garbage: give it a buffer of its own.
    const own = Buffer.alloc(buffer.length);
    buffer.copy(own);
    parser.parseBuffer(own, 0);
  });
}

// The report draws text glyph by glyph: group glyphs into lines, then into cells by horizontal gaps.
function pageLines(page) {
  const glyphs = page.Texts.map(t => {
    let s = t.R.map(r => r.T).join('');
    try { s = decodeURIComponent(s); } catch { /* keep raw */ }
    // Some glyphs decode padded with spaces (" G "); a real space stays a single space.
    return { x: t.x, y: t.y, s: s.trim() || ' ' };
  }).sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  for (const g of glyphs) {
    const line = lines[lines.length - 1];
    if (line && g.y - line.y <= ROW_GAP) line.glyphs.push(g);
    else lines.push({ y: g.y, glyphs: [g] });
  }
  return lines.map(({ glyphs: gs }) => {
    const cells = [];
    for (const g of gs.sort((a, b) => a.x - b.x)) {
      const cell = cells[cells.length - 1];
      if (cell && g.x - cell.end <= CELL_GAP) { cell.text += g.s; cell.end = g.x; } else cells.push({ start: g.x, end: g.x, text: g.s });
    }
    return cells.map(c => ({ text: c.text.replace(/\s+/g, ' ').trim(), mid: (c.start + c.end) / 2 })).filter(c => c.text);
  });
}

const headerName = text => {
  const t = text.toLowerCase();
  return HEADER_ALIASES[t] || COLUMNS.find(c => c.toLowerCase() === t);
};

/**
 * Turn a "Daily Attendance Report (Detailed Report)" PDF into sheets for parseSheets():
 * one per employee, with the header lines as single-cell rows and the table rebuilt in COLUMNS
 * order. Cells are placed in the column whose header is horizontally nearest. A page without an
 * "Employee Name" line continues the previous employee.
 */
async function pdfToSheets(buffer) {
  const pdf = await loadPdf(buffer);
  const sheets = [];
  pdf.Pages.forEach((page, p) => {
    const lines = pageLines(page);
    const hi = lines.findIndex(cells => cells.filter(c => headerName(c.text)).length >= 3 && cells.some(c => c.text.toLowerCase() === 'date'));
    if (hi < 0) return; // cover / summary pages
    const header = lines[hi].map(c => ({ col: COLUMNS.indexOf(headerName(c.text)), mid: c.mid })).filter(h => h.col >= 0);
    const tableRows = lines.slice(hi + 1).map(cells => {
      const row = COLUMNS.map(() => '');
      for (const c of cells) {
        const near = header.reduce((a, b) => (Math.abs(b.mid - c.mid) < Math.abs(a.mid - c.mid) ? b : a));
        row[near.col] = row[near.col] ? `${row[near.col]} ${c.text}` : c.text;
      }
      return row;
    });

    const titleRows = lines.slice(0, hi).map(cells => [cells.map(c => c.text).join('  ')]);
    if (!titleRows.some(r => /Employee\s*Name/i.test(r[0])) && sheets.length) {
      sheets[sheets.length - 1].rows.push(...tableRows);
      return;
    }
    sheets.push({ name: `Page ${p + 1}`, rows: [...titleRows, COLUMNS, ...tableRows] });
  });
  return sheets;
}

module.exports = { pdfToSheets };
