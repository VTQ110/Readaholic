const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const key = `${req.ip}|${username.toLowerCase()}`;
  if (auth.loginBlocked(key)) {
    return res.status(429).json({ error: 'Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    auth.recordFailure(key);
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  auth.clearFailures(key);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  auth.createSession(res, user.id);
  res.json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json(req.user);
});

router.post('/me/password', auth.requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!auth.verifyPassword(String(currentPassword || ''), user.password_hash)) {
    return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
  }
  const err = auth.validateCredentials(req.user.username, newPassword);
  if (err) return res.status(400).json({ error: err });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
