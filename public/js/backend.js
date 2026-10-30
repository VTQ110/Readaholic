// Data layer: all reads/writes go to Supabase (auth, Postgres tables and the private "books" storage bucket).
const CONFIG = window.READAHOLIC_CONFIG || {};
const BUCKET = 'books';
const EMAIL_DOMAIN = 'readaholic.local';

if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.replaceChildren(
      el('div', { class: 'empty' },
        el('h2', { text: 'Chưa cấu hình Supabase' }),
        el('p', { text: 'Thiếu SUPABASE_URL / SUPABASE_ANON_KEY trong js/config.js. Xem hướng dẫn trong README.' }))
    );
  });
  throw new Error('Missing Supabase config');
}

const sb = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

// Kept in sync so progress can be saved synchronously while the page is closing.
let accessToken = null;
sb.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token ?? null;
});

function fail(error, fallback = 'Có lỗi xảy ra') {
  if (!error) return;
  console.error(error);
  throw new Error(error.message || fallback);
}

function usernameToEmail(username) {
  const u = username.trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${EMAIL_DOMAIN}`;
}

const backend = {
  // ---------- Auth ----------
  async login(username, password) {
    const { error } = await sb.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) {
      if (/invalid login credentials/i.test(error.message)) throw new Error('Sai tên đăng nhập hoặc mật khẩu');
      if (error.status === 429) throw new Error('Đăng nhập sai quá nhiều lần, vui lòng thử lại sau');
      fail(error);
    }
  },

  async hasSession() {
    const { data } = await sb.auth.getSession();
    accessToken = data.session?.access_token ?? null;
    return Boolean(data.session);
  },

  // Redirects to the login page when not signed in; returns the current profile otherwise.
  async requireLogin() {
    if (!(await backend.hasSession())) {
      location.replace('login.html');
      return new Promise(() => {}); // stop the page's init while the redirect happens
    }
    return backend.me();
  },

  async me() {
    if (backend._me) return backend._me;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      location.replace('login.html');
      throw new Error('Phiên đăng nhập đã hết hạn');
    }
    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
    fail(error);
    backend._me = { id: data.id, username: data.username, displayName: data.display_name, role: data.role };
    return backend._me;
  },

  async logout() {
    await sb.auth.signOut();
    location.replace('login.html');
  },

  async changePassword(currentPassword, newPassword) {
    if (!newPassword || newPassword.length < 6) throw new Error('Mật khẩu phải có ít nhất 6 ký tự');
    const { data: { user } } = await sb.auth.getUser();
    const { error: authError } = await sb.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (authError) throw new Error('Mật khẩu hiện tại không đúng');
    const { error } = await sb.auth.updateUser({ password: newPassword });
    fail(error);
  },

  // ---------- Books ----------
  async listBooks() {
    const me = await backend.me();
    const [books, progress] = await Promise.all([
      sb.from('books').select('*, uploader:profiles(display_name)').order('created_at', { ascending: false }),
      sb.from('progress').select('*'),
    ]);
    fail(books.error);
    fail(progress.error);
    const byBook = new Map(progress.data.map((p) => [p.book_id, p]));
    const list = books.data.map((row) => toBook(row, byBook.get(row.id), me));
    const coverPaths = list.filter((b) => b.coverPath).map((b) => b.coverPath);
    if (coverPaths.length) {
      const { data } = await sb.storage.from(BUCKET).createSignedUrls(coverPaths, 6 * 3600);
      const urls = new Map((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
      for (const b of list) b.coverUrl = urls.get(b.coverPath) || null;
    }
    return list;
  },

  async getBook(id) {
    const me = await backend.me();
    const [book, progress] = await Promise.all([
      sb.from('books').select('*, uploader:profiles(display_name)').eq('id', id).maybeSingle(),
      sb.from('progress').select('*').eq('book_id', id).maybeSingle(),
    ]);
    fail(book.error);
    if (!book.data) throw new Error('Không tìm thấy sách');
    return toBook(book.data, progress.data, me);
  },

  async fileUrl(book, { download = false } = {}) {
    const { data, error } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(book.filePath, 6 * 3600, download ? { download: book.originalName } : undefined);
    fail(error, 'Không lấy được file sách');
    return data.signedUrl;
  },

  // Uploads the book file (with progress callback), optional cover, then creates the row.
  async addBook({ file, cover, title, author, genre, description }, onProgress) {
    const me = await backend.me();
    const ext = file.name.split('.').pop().toLowerCase();
    const filePath = `${me.id}/${uniqueName()}.${ext}`;
    await uploadWithProgress(filePath, file, onProgress);
    let coverPath = null;
    try {
      if (cover) coverPath = await uploadCover(me.id, cover);
      const { error } = await sb.from('books').insert({
        title: clean(title, 300) || file.name.replace(/\.[^.]+$/, ''),
        author: clean(author, 300),
        genre: cleanGenres(genre),
        description: clean(description, 5000),
        format: formatOf(file.name),
        file_path: filePath,
        original_name: file.name,
        size: file.size,
        cover_path: coverPath,
        uploaded_by: me.id,
      });
      fail(error);
    } catch (err) {
      await sb.storage.from(BUCKET).remove([filePath, coverPath].filter(Boolean));
      throw err;
    }
  },

  async updateBook(book, { cover, title, author, genre, description }) {
    const me = await backend.me();
    const fields = {
      title: clean(title, 300) || book.title,
      author: clean(author, 300),
      genre: cleanGenres(genre),
      description: clean(description, 5000),
    };
    if (cover) fields.cover_path = await uploadCover(me.id, cover);
    const { data, error } = await sb.from('books').update(fields).eq('id', book.id).select('id');
    fail(error);
    if (!data.length) throw new Error('Chỉ người tải lên hoặc quản trị viên mới được sửa sách này');
    if (cover && book.coverPath) await sb.storage.from(BUCKET).remove([book.coverPath]);
  },

  async deleteBook(book) {
    const { data, error } = await sb.from('books').delete().eq('id', book.id).select('id');
    fail(error);
    if (!data.length) throw new Error('Chỉ người tải lên hoặc quản trị viên mới được xoá sách này');
    await sb.storage.from(BUCKET).remove([book.filePath, book.coverPath].filter(Boolean));
  },

  // ---------- Progress ----------
  // Uses fetch directly (not async before the request) so it still goes out with keepalive
  // while the tab is closing.
  saveProgress(bookId, { location, percent, positionLabel }, keepalive = false) {
    if (!backend._me || !accessToken) {
      return backend.hasSession().then(() => backend.me()).then(() => backend.saveProgress(bookId, { location, percent, positionLabel }, keepalive));
    }
    return fetch(`${CONFIG.supabaseUrl}/rest/v1/progress?on_conflict=user_id,book_id`, {
      method: 'POST',
      keepalive,
      headers: {
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: backend._me.id,
        book_id: bookId,
        location: String(location).slice(0, 2000),
        percent: Math.min(100, Math.max(0, percent)),
        position_label: String(positionLabel || '').slice(0, 200),
      }),
    }).then((res) => {
      if (!res.ok) throw new Error(`Lỗi lưu tiến độ (${res.status})`);
    });
  },

  async resetProgress(bookId) {
    const { error } = await sb.from('progress').delete().eq('book_id', bookId);
    fail(error);
  },

  // ---------- Admin ----------
  async listUsers() {
    const [users, books] = await Promise.all([
      sb.from('profiles').select('*').order('created_at'),
      sb.from('books').select('uploaded_by'),
    ]);
    fail(users.error);
    fail(books.error);
    const counts = new Map();
    for (const b of books.data) counts.set(b.uploaded_by, (counts.get(b.uploaded_by) || 0) + 1);
    return users.data.map((u) => ({
      id: u.id, username: u.username, displayName: u.display_name, role: u.role, createdAt: u.created_at,
      bookCount: counts.get(u.id) || 0,
    }));
  },

  async createUser({ username, password, displayName, role }) {
    const { error } = await sb.rpc('admin_create_user', {
      p_username: username, p_password: password, p_display_name: displayName, p_role: role,
    });
    fail(error);
  },

  async updateUser(id, { displayName = null, role = null, password = null }) {
    const { error } = await sb.rpc('admin_update_user', {
      p_id: id, p_display_name: displayName, p_role: role, p_password: password,
    });
    fail(error);
  },

  async deleteUser(id) {
    const { error } = await sb.rpc('admin_delete_user', { p_id: id });
    fail(error);
  },
};

function toBook(row, progress, me) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    genre: row.genre,
    description: row.description,
    format: row.format,
    filePath: row.file_path,
    originalName: row.original_name,
    size: row.size,
    coverPath: row.cover_path,
    coverUrl: null,
    hasCover: Boolean(row.cover_path),
    uploadedBy: row.uploaded_by,
    uploaderName: row.uploader?.display_name || null,
    createdAt: row.created_at,
    location: progress?.location ?? '',
    percent: progress?.percent ?? 0,
    positionLabel: progress?.position_label ?? '',
    lastReadAt: progress?.updated_at ?? null,
    canEdit: me.role === 'admin' || row.uploaded_by === me.id,
  };
}

function uniqueName() {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  return `${Date.now()}-${Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function clean(value, max) {
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
  return out.join(', ').slice(0, 500);
}

async function uploadCover(userId, blob) {
  const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[blob.type] || 'jpg';
  const path = `${userId}/covers/${uniqueName()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' });
  fail(error, 'Không tải được ảnh bìa');
  return path;
}

const CONTENT_TYPES = { epub: 'application/epub+zip', pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', cbz: 'application/vnd.comicbook+zip' };

// supabase-js has no upload progress events, so talk to the Storage REST API with XHR.
async function uploadWithProgress(path, file, onProgress) {
  if (!accessToken) await backend.hasSession();
  const ext = file.name.split('.').pop().toLowerCase();
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${CONFIG.supabaseUrl}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', CONFIG.supabaseAnonKey);
    xhr.setRequestHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (ev) => ev.lengthComputable && onProgress?.(ev.loaded / ev.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Lỗi tải lên (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        if (String(body.statusCode) === '413' || /maximum allowed size|too large/i.test(body.message || body.error || '')) {
          message = 'File quá lớn so với giới hạn của Supabase Storage';
        } else if (body.message) message = body.message;
      } catch {}
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Mất kết nối khi tải lên'));
    xhr.send(file);
  });
}
