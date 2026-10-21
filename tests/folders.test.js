const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { monthDir, cleanDir } = require('../lib/folders');

test('month folder is <output>/<YYYY>/<MM - Month>', () => {
  assert.strictEqual(monthDir(path.join('out'), '2026-09'), path.join('out', '2026', '09 - September'));
  assert.strictEqual(monthDir('out', '2027-01'), path.join('out', '2027', '01 - January'));
  assert.throws(() => monthDir('out', ''), /Invalid month/);
});

test('folder paths must be absolute', () => {
  assert.throws(() => cleanDir('slips', 'output folder'), /full path/);
  assert.throws(() => cleanDir('  ', 'output folder'), /Choose/);
  const abs = path.resolve('somewhere');
  assert.strictEqual(cleanDir(`"${abs}"`, 'output folder'), abs);
});
