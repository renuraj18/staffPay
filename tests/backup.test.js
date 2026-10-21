const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { unzipSync, strFromU8 } = require('fflate');
const { createBackup, listBackups } = require('../lib/backup');
const { newer } = require('../lib/update');

test('backup zips config and data files, newest listed first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-backup-'));
  try {
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(root, 'config.json'), '{"output_dir":"x"}');
    fs.writeFileSync(path.join(dataDir, 'settings.json'), '{"version":4}');
    const backupDir = path.join(root, 'backups');
    const opts = { configFile: path.join(root, 'config.json'), dataDir, backupDir };
    const first = createBackup({ ...opts, now: new Date(2026, 9, 21, 9, 5, 0) });
    assert.strictEqual(path.basename(first), 'StaffPay backup 2026-10-21 090500.zip');
    const zip = unzipSync(fs.readFileSync(first));
    assert.deepStrictEqual(Object.keys(zip).sort(), ['backup.json', 'config.json', 'data/settings.json']);
    assert.strictEqual(strFromU8(zip['data/settings.json']), '{"version":4}');
    const second = createBackup({ ...opts, reason: 'before v2.0.0', now: new Date(2026, 9, 22, 10, 0, 0) });
    fs.utimesSync(first, new Date(2026, 9, 21), new Date(2026, 9, 21));
    assert.deepStrictEqual(listBackups(backupDir).map(b => b.name), [path.basename(second), path.basename(first)]);
    assert.deepStrictEqual(listBackups(path.join(root, 'missing')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('backup with nothing to save fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-backup-'));
  try {
    assert.throws(() => createBackup({ configFile: path.join(root, 'c.json'), dataDir: root, backupDir: root }), /Nothing to back up/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('version comparison', () => {
  assert.ok(newer('1.2.0', '1.1.9'));
  assert.ok(newer('v1.10.0', '1.9.0'));
  assert.ok(!newer('1.1.1', '1.1.1'));
  assert.ok(!newer('1.0.3', '1.1.0'));
});
