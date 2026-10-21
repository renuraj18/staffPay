// Where StaffPay keeps its data and saves its output (payslips), and the OS helpers to pick/open folders.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// <base>/2026/09 - September (the number keeps months in calendar order in Explorer).
function monthDir(base, ym) {
  const [y, m] = String(ym || '').split('-');
  if (!/^\d{4}$/.test(y) || !(Number(m) >= 1 && Number(m) <= 12)) throw new Error(`Invalid month: ${ym}`);
  return path.join(base, y, `${m.padStart(2, '0')} - ${FULL_MONTHS[Number(m) - 1]}`);
}

const defaultOutputDir = () => path.join(os.homedir(), 'Documents', 'StaffPay');

// Folder paths typed or picked in the UI: must be absolute; returned resolved.
function cleanDir(v, label) {
  const s = String(v ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!s) throw Object.assign(new Error(`Choose a ${label}`), { status: 400 });
  if (!path.isAbsolute(s)) throw Object.assign(new Error(`${label[0].toUpperCase()}${label.slice(1)} must be a full path, like C:\\StaffPay`), { status: 400 });
  return path.resolve(s);
}

// Native "choose folder" dialog on this machine (the server runs on the user's PC). Resolves null when cancelled.
function pickFolder(title, start) {
  return new Promise((resolve, reject) => {
    const done = (err, stdout) => {
      const out = String(stdout || '').trim();
      if (out) return resolve(out.replace(/[\\/]$/, '') || out);
      // Cancel: PowerShell prints nothing; osascript exits with "User canceled" (-128).
      if (!err || /-128|cancel/i.test(String(err.message))) return resolve(null);
      reject(err);
    };
    if (process.platform === 'win32') {
      // A topmost owner window keeps the dialog in front of the browser.
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true; ShowInTaskbar = $false}',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$d.Description = $env:SP_TITLE',
        '$d.ShowNewFolderButton = $true',
        'if ($env:SP_START -and (Test-Path -LiteralPath $env:SP_START)) { $d.SelectedPath = $env:SP_START }',
        'if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }',
      ].join('; ');
      execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { env: { ...process.env, SP_TITLE: title, SP_START: start || '' }, windowsHide: true }, done);
    } else if (process.platform === 'darwin') {
      const args = ['-e', 'on run argv', '-e', 'tell application "System Events" to activate',
        '-e', 'if item 2 of argv is "" then', '-e', 'return POSIX path of (choose folder with prompt (item 1 of argv))',
        '-e', 'else', '-e', 'return POSIX path of (choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv)))',
        '-e', 'end if', '-e', 'end run', title, start && fs.existsSync(start) ? start : ''];
      execFile('osascript', args, done);
    } else {
      reject(Object.assign(new Error('Folder picker is not available here — type the folder path'), { status: 501 }));
    }
  });
}

function openFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [dir], () => {}); // explorer.exe exits 1 even on success
}

module.exports = { monthDir, defaultOutputDir, cleanDir, pickFolder, openFolder };
