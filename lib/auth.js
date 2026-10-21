// Optional PIN lock: the PIN is stored as a scrypt hash in config.json; an unlocked browser gets a session
// cookie that expires after IDLE_MS without use (or when StaffPay restarts).
const crypto = require('crypto');

const IDLE_MS = 30 * 60 * 1000;
const PIN = /^\d{4,8}$/;
const COOKIE = 'staffpay_session';

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pin), salt, 32).toString('hex') };
}
function verifyPin(pin, rec) {
  if (!rec?.salt || !rec?.hash) return false;
  const got = crypto.scryptSync(String(pin ?? ''), rec.salt, 32);
  const want = Buffer.from(rec.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function createSessions({ now = () => Date.now() } = {}) {
  const sessions = new Map(); // token -> last used
  let failures = 0;
  let blockedUntil = 0;
  return {
    create() {
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, now());
      return token;
    },
    // True (and refreshed) while the session has been used within IDLE_MS.
    touch(token) {
      if (!token || !sessions.has(token)) return false;
      const last = sessions.get(token);
      if (now() - last > IDLE_MS) { sessions.delete(token); return false; }
      sessions.set(token, now());
      return true;
    },
    remove: token => sessions.delete(token),
    clear: () => sessions.clear(),
    // Five wrong PINs in a row block unlocking for 30 seconds.
    waitSeconds: () => Math.max(0, Math.ceil((blockedUntil - now()) / 1000)),
    failed() { if (++failures >= 5) { failures = 0; blockedUntil = now() + 30 * 1000; } },
    succeeded() { failures = 0; },
  };
}

const readCookie = (req, name = COOKIE) => {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : '';
};
const sessionCookie = token => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

module.exports = { hashPin, verifyPin, createSessions, readCookie, sessionCookie, clearCookie, PIN, IDLE_MS };
