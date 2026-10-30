const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');

const router = express.Router();
router.use(auth.requireAuth);

const BOOK_FORMATS = { '.epub': 'epub', '.pdf': 'pdf', '.txt': 'txt', '.md': 'txt', '.cbz': 'cbz' };
const COVER_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_COVER_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => cb(null, file.fieldname === 'cover' ? config.coversDir : config.booksDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'file' && BOOK_FORMATS[ext]) return cb(null, true);
    if (file.fieldname === 'cover' && COVER_TYPES[ext]) return cb(null, true);
    const err = new Error(
      file.fieldname === 'cover'
        ? 'Ảnh bìa phải là JPG, PNG, WEBP hoặc GIF'
        : 'Định dạng chưa hỗ trợ. Hỗ trợ: EPUB, PDF, TXT, MD, CBZ'
    );
    err.status = 400;
    cb(err);
  },
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]);

function handleUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    removeUploaded(req);
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? `File quá lớn (tối đa ${config.maxUploadMb} MB)` : err.message || 'Lỗi tải lên';
    res.status(err.status || 400).json({ error: message });
  });
}

function removeUploaded(req) {
  for (const list of Object.values(req.files || {})) {
    for (const f of list) fs.rm(f.path, { force: true }, () => {});
  }
}

function removeFile(dir, name) {
  if (name) fs.rm(path.join(dir, name), { force: true }, () => {});
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

// Normalises "Fantasy,  sci-fi ,Fantasy" into "Fantasy, sci-fi".
function cleanGenres(value) {
  const seen = new Set();
  const out = [];
  for (const g of String(value ?? '').split(',')) {
    const name = g.trim().slice(0, 50);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out.join(', ');
}

const BOOK_SELECT = `
  SELECT b.id, b.title, b.author, b.genre, b.description, b.format, b.original_name AS originalName,
         b.size, b.cover_name IS NOT NULL AS hasCover, b.uploaded_by AS uploadedBy,
         u.display_name AS uploaderName, b.created_at AS createdAt,
         p.location, p.percent, p.position_label AS positionLabel, p.updated_at AS lastReadAt
  FROM books b
  LEFT JOIN users u ON u.id = b.uploaded_by
  LEFT JOIN progress p ON p.book_id = b.id AND p.user_id = ?`;

function toBook(row, user) {
  return {
    ...row,
    hasCover: Boolean(row.hasCover),
    percent: row.percent ?? 0,
    canEdit: user.role === 'admin' || row.uploadedBy === user.id,
  };
}

function getBookRow(id) {
  return db.prepare('SELECT * FROM books WHERE id = ?').get(id);
}

function canEdit(user, book) {
  return user.role === 'admin' || book.uploaded_by === user.id;
}

router.get('/', (req, res) => {
  const rows = db.prepare(`${BOOK_SELECT} ORDER BY b.created_at DESC`).all(req.user.id);
  res.json(rows.map((r) => toBook(r, req.user)));
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy sách' });
  res.json(toBook(row, req.user));
});

router.post('/', handleUpload, (req, res) => {
  const file = req.files?.file?.[0];
  const cover = req.files?.cover?.[0];
  if (!file) {
    removeUploaded(req);
    return res.status(400).json({ error: 'Vui lòng chọn file sách' });
  }
  if (cover && cover.size > MAX_COVER_BYTES) {
    removeUploaded(req);
    return res.status(400).json({ error: 'Ảnh bìa quá lớn (tối đa 10 MB)' });
  }
  const ext = path.extname(file.originalname).toLowerCase();
  const title = clean(req.body.title, 300) || path.basename(file.originalname, ext);
  const info = db
    .prepare(
      `INSERT INTO books (title, author, genre, description, format, file_name, original_name, size, cover_name, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      clean(req.body.author, 300),
      cleanGenres(req.body.genre),
      clean(req.body.description, 5000),
      BOOK_FORMATS[ext],
      file.filename,
      file.originalname,
      file.size,
      cover ? cover.filename : null,
      req.user.id
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', handleUpload, (req, res) => {
  const book = getBookRow(req.params.id);
  const cover = req.files?.cover?.[0];
  if (req.files?.file) {
    removeUploaded(req);
    return res.status(400).json({ error: 'Không thể thay file sách, hãy xoá và tải lên lại' });
  }
  if (!book) {
    removeUploaded(req);
    return res.status(404).json({ error: 'Không tìm thấy sách' });
  }
  if (!canEdit(req.user, book)) {
    removeUploaded(req);
    return res.status(403).json({ error: 'Chỉ người tải lên hoặc quản trị viên mới được sửa sách này' });
  }
  if (cover && cover.size > MAX_COVER_BYTES) {
    removeUploaded(req);
    return res.status(400).json({ error: 'Ảnh bìa quá lớn (tối đa 10 MB)' });
  }
  const b = req.body;
  db.prepare('UPDATE books SET title = ?, author = ?, genre = ?, description = ?, cover_name = ? WHERE id = ?').run(
    b.title !== undefined ? clean(b.title, 300) || book.title : book.title,
    b.author !== undefined ? clean(b.author, 300) : book.author,
    b.genre !== undefined ? cleanGenres(b.genre) : book.genre,
    b.description !== undefined ? clean(b.description, 5000) : book.description,
    cover ? cover.filename : book.cover_name,
    book.id
  );
  if (cover) removeFile(config.coversDir, book.cover_name);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const book = getBookRow(req.params.id);
  if (!book) return res.status(404).json({ error: 'Không tìm thấy sách' });
  if (!canEdit(req.user, book)) {
    return res.status(403).json({ error: 'Chỉ người tải lên hoặc quản trị viên mới được xoá sách này' });
  }
  db.prepare('DELETE FROM books WHERE id = ?').run(book.id);
  removeFile(config.booksDir, book.file_name);
  removeFile(config.coversDir, book.cover_name);
  res.json({ ok: true });
});

router.get('/:id/file', (req, res) => {
  const book = getBookRow(req.params.id);
  if (!book) return res.status(404).json({ error: 'Không tìm thấy sách' });
  const filePath = path.join(config.booksDir, book.file_name);
  res.set('Cache-Control', 'private, max-age=3600');
  if (req.query.download) return res.download(filePath, book.original_name);
  res.sendFile(filePath, { headers: { 'Content-Type': 'application/octet-stream' } });
});

router.get('/:id/cover', (req, res) => {
  const book = getBookRow(req.params.id);
  if (!book || !book.cover_name) return res.status(404).end();
  const type = COVER_TYPES[path.extname(book.cover_name).toLowerCase()] || 'application/octet-stream';
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(config.coversDir, book.cover_name), { headers: { 'Content-Type': type } });
});

router.get('/:id/progress', (req, res) => {
  const row = db
    .prepare(
      `SELECT location, percent, position_label AS positionLabel, updated_at AS updatedAt
       FROM progress WHERE user_id = ? AND book_id = ?`
    )
    .get(req.user.id, req.params.id);
  res.json(row || { location: '', percent: 0, positionLabel: '' });
});

router.put('/:id/progress', (req, res) => {
  if (!getBookRow(req.params.id)) return res.status(404).json({ error: 'Không tìm thấy sách' });
  const percent = Math.min(100, Math.max(0, Number(req.body.percent) || 0));
  db.prepare(
    `INSERT INTO progress (user_id, book_id, location, percent, position_label, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (user_id, book_id) DO UPDATE SET
       location = excluded.location, percent = excluded.percent,
       position_label = excluded.position_label, updated_at = excluded.updated_at`
  ).run(req.user.id, req.params.id, clean(req.body.location, 2000), percent, clean(req.body.positionLabel, 200));
  res.json({ ok: true });
});

router.delete('/:id/progress', (req, res) => {
  db.prepare('DELETE FROM progress WHERE user_id = ? AND book_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
