// Checks GitHub Releases for a newer version. Failures are silent: the app works offline.
const CACHE_MS = 6 * 60 * 60 * 1000;
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

async function latestRelease(slug) {
  if (!slug || typeof fetch !== 'function') return null;
  if (Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StaffPay' },
      signal: AbortSignal.timeout(5000),
    });
    const value = res.ok ? await res.json() : null;
    cache = { at: Date.now(), value };
    return value;
  } catch {
    cache = { at: Date.now(), value: null };
    return null;
  }
}

async function versionInfo(pkg) {
  const slug = repoSlug(pkg.repository);
  const info = {
    version: pkg.version,
    repo: slug,
    releases_url: slug ? `https://github.com/${slug}/releases/latest` : null,
    download_url: slug ? `https://github.com/${slug}/releases/latest/download/StaffPay-Setup.exe` : null,
    latest: null,
    update_available: false,
  };
  const rel = await latestRelease(slug);
  if (rel?.tag_name) {
    info.latest = rel.tag_name.replace(/^v/, '');
    info.update_available = newer(info.latest, pkg.version);
  }
  return info;
}

module.exports = { versionInfo, repoSlug, newer };
