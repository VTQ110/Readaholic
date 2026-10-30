#!/usr/bin/env node
// Usage: npm run create-user -- <username> <password> [--admin] [--name "Tên hiển thị"]
const args = process.argv.slice(2);
const flags = { admin: false, name: undefined };
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--admin') flags.admin = true;
  else if (args[i] === '--name') flags.name = args[++i];
  else positional.push(args[i]);
}
const [username, password] = positional;
if (!username || !password) {
  console.error('Cách dùng: npm run create-user -- <tên đăng nhập> <mật khẩu> [--admin] [--name "Tên hiển thị"]');
  process.exit(1);
}

const db = require('../src/db');
const auth = require('../src/auth');

const err = auth.validateCredentials(username, password);
if (err) {
  console.error(err);
  process.exit(1);
}
const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?').run(
    auth.hashPassword(password),
    flags.admin ? 'admin' : existing.role,
    existing.id
  );
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  console.log(`Đã cập nhật mật khẩu cho "${username}".`);
} else {
  auth.createUser({ username, password, displayName: flags.name, role: flags.admin ? 'admin' : 'member' });
  console.log(`Đã tạo ${flags.admin ? 'quản trị viên' : 'thành viên'} "${username}".`);
}
