const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();
router.use(auth.requireAdmin);

function adminCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}

router.get('/', (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.username, u.display_name AS displayName, u.role, u.created_at AS createdAt,
              (SELECT COUNT(*) FROM books b WHERE b.uploaded_by = u.id) AS bookCount
       FROM users u ORDER BY u.created_at`
    )
    .all();
  res.json(users);
});

router.post('/', (req, res) => {
  const username = String(req.body.username || '').trim();
  const { password } = req.body;
  const displayName = String(req.body.displayName || '').trim() || username;
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  const err = auth.validateCredentials(username, password);
  if (err) return res.status(400).json({ error: err });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
  }
  const id = auth.createUser({ username, password, displayName, role });
  res.status(201).json({ id });
});

router.put('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });

  if (req.body.displayName !== undefined) {
    const displayName = String(req.body.displayName).trim() || user.username;
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, user.id);
  }
  if (req.body.role !== undefined) {
    const role = req.body.role === 'admin' ? 'admin' : 'member';
    if (user.role === 'admin' && role !== 'admin' && adminCount() <= 1) {
      return res.status(400).json({ error: 'Phải còn ít nhất một quản trị viên' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  }
  if (req.body.password) {
    const err = auth.validateCredentials(user.username, req.body.password);
    if (err) return res.status(400).json({ error: err });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(req.body.password), user.id);
    // Force re-login everywhere after a password reset.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Không thể tự xoá tài khoản của mình' });
  if (user.role === 'admin' && adminCount() <= 1) {
    return res.status(400).json({ error: 'Phải còn ít nhất một quản trị viên' });
  }
  // Books the user contributed stay in the library (uploaded_by becomes NULL).
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

module.exports = router;
