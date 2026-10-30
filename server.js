const path = require('path');
const express = require('express');
const config = require('./src/config');
const db = require('./src/db');
const auth = require('./src/auth');

// Bootstrap the first admin account from environment variables when the database is empty.
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  if (config.adminUsername && config.adminPassword) {
    const err = auth.validateCredentials(config.adminUsername, config.adminPassword);
    if (err) {
      console.error(`ADMIN_USERNAME/ADMIN_PASSWORD không hợp lệ: ${err}`);
      process.exit(1);
    }
    auth.createUser({ username: config.adminUsername, password: config.adminPassword, role: 'admin' });
    console.log(`Đã tạo tài khoản quản trị "${config.adminUsername}".`);
  } else {
    console.warn(
      'Chưa có tài khoản nào. Tạo quản trị viên bằng: npm run create-user -- <tên> <mật khẩu> --admin\n' +
        'hoặc khởi động với biến môi trường ADMIN_USERNAME và ADMIN_PASSWORD.'
    );
  }
}

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(auth.loadUser);

app.use('/api', require('./src/routes/auth'));
app.use('/api/books', require('./src/routes/books'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

const publicDir = path.join(__dirname, 'public');
const page = (name) => path.join(publicDir, `${name}.html`);

// HTML pages: everything except the login page requires a session.
app.get('/login', (req, res) => (req.user ? res.redirect('/') : res.sendFile(page('login'))));
const protectedPage = (name, adminOnly = false) => (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (adminOnly && req.user.role !== 'admin') return res.redirect('/');
  res.sendFile(page(name));
};
app.get('/', protectedPage('index'));
app.get('/read/:id', protectedPage('reader'));
app.get('/admin', protectedPage('admin', true));

// Front-end libraries served from node_modules so the app works without a CDN.
const vendor = (pkgPath) => express.static(path.join(__dirname, 'node_modules', pkgPath), { maxAge: '7d' });
app.use('/vendor/epubjs', vendor('epubjs/dist'));
app.use('/vendor/jszip', vendor('jszip/dist'));
app.use('/vendor/pdfjs', vendor('pdfjs-dist/build'));

app.use(express.static(publicDir, { index: false, extensions: [] }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Lỗi máy chủ' });
});

app.listen(config.port, () => {
  console.log(`Readaholic đang chạy tại http://localhost:${config.port}`);
});
