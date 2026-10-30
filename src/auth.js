const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const COOKIE_NAME = 'readaholic_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function validateCredentials(username, password) {
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username || '')) {
    return 'Tên đăng nhập phải dài 3–32 ký tự, chỉ gồm chữ không dấu, số, dấu . _ -';
  }
  if (typeof password !== 'string' || password.length < 6) {
    return 'Mật khẩu phải có ít nhất 6 ký tự';
  }
  return null;
}

function createUser({ username, password, displayName, role = 'member' }) {
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(username, displayName || username, hashPassword(password), role);
  return info.lastInsertRowid;
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = config.sessionDays * 24 * 3600 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    Date.now() + maxAge
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge,
    path: '/',
  });
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Attaches req.user when a valid session cookie is present.
function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) {
    const row = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.role, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
      )
      .get(token);
    if (row && row.expires_at > Date.now()) {
      req.user = { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
    } else if (row) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Bạn cần đăng nhập' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Bạn cần đăng nhập' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ quản trị viên mới được phép' });
  next();
}

// Simple in-memory throttle against password guessing: 10 failures per 15 minutes per IP+username.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

function loginBlocked(key) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else entry.count += 1;
}

function clearFailures(key) {
  failures.delete(key);
}

module.exports = {
  hashPassword,
  verifyPassword,
  validateCredentials,
  createUser,
  createSession,
  destroySession,
  loadUser,
  requireAuth,
  requireAdmin,
  loginBlocked,
  recordFailure,
  clearFailures,
};
