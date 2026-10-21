// Checks GitHub Releases for a newer version and, in the installed Windows app, downloads and runs the
// new installer. Check failures are silent: the app works offline.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CACHE_MS = 30 * 60 * 1000;
const SETUP_ASSET = 'StaffPay-Setup.exe';
let cache = { at: 0, value: null };

// "github:owner/repo", "https://github.com/owner/repo(.git)" or {url} -> "owner/repo"
function repoSlug(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url || '';
  const m = url.match(/github(?:\.com[/:]|:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
  return m ? m[1] : null;
}

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function latestRelease(slug, force = false) {
  if (!slug || typeof fetch !== 'function') return null;
  if (!force && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StaffPay' },
      signal: AbortSignal.timeout(8000),
    });
    const value = res.ok ? await res.json() : null;
    cache = { at: Date.now(), value };
    return value;
  } catch {
    cache = { at: Date.now(), value: null };
    return null;
  }
}

async function versionInfo(pkg, { force = false } = {}) {
  const slug = repoSlug(pkg.repository);
  const info = {
    version: pkg.version,
    repo: slug,
    releases_url: slug ? `https://github.com/${slug}/releases/latest` : null,
    download_url: slug ? `https://github.com/${slug}/releases/latest/download/${SETUP_ASSET}` : null,
    latest: null,
    update_available: false,
    checked_at: null,
  };
  const rel = await latestRelease(slug, force);
  if (cache.at) info.checked_at = new Date(cache.at).toISOString();
  if (rel?.tag_name) {
    info.latest = rel.tag_name.replace(/^v/, '');
    info.update_available = newer(info.latest, pkg.version);
    const asset = (rel.assets || []).find(a => a.name === SETUP_ASSET);
    if (asset) info.setup = { url: asset.browser_download_url, size: asset.size };
  }
  return info;
}

// Installed by StaffPay-Setup.exe (Inno Setup puts unins000.exe next to the exe) — only then can we update
// ourselves; the portable zip and source runs just link to the download.
function canSelfUpdate() {
  return Boolean(process.pkg) && process.platform === 'win32'
    && fs.existsSync(path.join(path.dirname(process.execPath), 'unins000.exe'));
}

// Downloads the installer to %TEMP%; onProgress(fraction). Returns the file path.
async function downloadSetup(setup, version, onProgress = () => {}) {
  const file = path.join(os.tmpdir(), `StaffPay-Setup-${version}.exe`);
  if (fs.existsSync(file) && fs.statSync(file).size === setup.size) return file;
  const res = await fetch(setup.url, { headers: { 'User-Agent': 'StaffPay' }, signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const tmp = `${file}.part`;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      if (setup.size) onProgress(Math.min(1, got / setup.size));
    }
  } finally {
    await new Promise(r => out.end(r));
  }
  if (setup.size && got !== setup.size) { fs.rmSync(tmp, { force: true }); throw new Error('Download was incomplete — try again'); }
  fs.renameSync(tmp, file);
  return file;
}

// Runs the installer silently once this process has exited, then starts the new version without opening
// another browser tab (the open page reloads itself). The caller exits right after.
function runInstaller(setupFile) {
  const log = path.join(os.tmpdir(), 'StaffPay-update.log');
  const script = path.join(os.tmpdir(), 'StaffPay-update.cmd');
  fs.writeFileSync(script, [
    '@echo off',
    'ping 127.0.0.1 -n 4 >nul',
    `"${setupFile}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /LOG="${log}"`,
    `start "" "${process.execPath}" --no-open`,
    '',
  ].join('\r\n'));
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

module.exports = { versionInfo, repoSlug, newer, canSelfUpdate, downloadSetup, runInstaller };
