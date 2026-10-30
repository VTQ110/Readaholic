const state = { me: null, books: [], editing: null, coverBlob: null };
const $ = (id) => document.getElementById(id);
const FILTER_KEY = 'readaholic.filters';

const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });
// Lower-cases and strips Vietnamese diacritics so "tieu thuyet" matches "Tiểu thuyết".
const fold = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

function statusOf(book) {
  if (!book.lastReadAt) return 'unread';
  return book.percent >= 99.5 ? 'finished' : 'reading';
}

function progressLabel(book) {
  if (!book.lastReadAt) return 'Chưa đọc';
  if (statusOf(book) === 'finished') return 'Đã đọc xong';
  return `${Math.floor(book.percent)}%`;
}

function coverNode(book) {
  if (book.hasCover) {
    return el('img', { src: `/api/books/${book.id}/cover`, alt: `Bìa sách ${book.title}`, loading: 'lazy' });
  }
  return el(
    'div',
    { class: 'placeholder-cover', style: { background: coverColor(book.title) } },
    el('div', { class: 'pc-title', text: book.title }),
    el('div', { class: 'pc-author', text: book.author })
  );
}

function bookCard(book) {
  const genres = splitGenres(book.genre);
  return el(
    'article',
    { class: 'book' },
    el('a', { class: 'cover-link', href: `/read/${book.id}`, title: `Đọc "${book.title}"` }, coverNode(book)),
    el('span', { class: 'format-badge', text: book.format }),
    el('button', { class: 'menu-btn', type: 'button', title: 'Chi tiết', 'aria-label': `Chi tiết ${book.title}`, onclick: () => openDetail(book) }, '⋯'),
    el('div', { class: 'progress', title: progressLabel(book) }, el('div', { style: { width: `${book.percent}%` } })),
    el(
      'div',
      { class: 'progress-text' },
      el('span', { text: progressLabel(book) }),
      book.lastReadAt && statusOf(book) !== 'finished' && book.positionLabel ? el('span', { text: book.positionLabel }) : null
    ),
    el('a', { class: 'title', href: `/read/${book.id}`, style: { color: 'inherit', textDecoration: 'none' }, text: book.title }),
    book.author ? el('button', { class: 'author chip', style: { background: 'none', padding: 0, textAlign: 'left' }, title: 'Lọc theo tác giả', onclick: () => setFilter('author', book.author), text: book.author }) : null,
    genres.length ? el('div', { class: 'genres' }, genres.map((g) => el('button', { class: 'chip', type: 'button', title: 'Lọc theo thể loại', onclick: () => setFilter('genre', g), text: g }))) : null
  );
}

function filters() {
  return { q: $('q').value, genre: $('genre').value, author: $('author').value, status: $('status').value, sort: $('sort').value };
}

function setFilter(name, value) {
  $(name).value = value;
  render();
}

function applyFilters(books) {
  const f = filters();
  const q = fold(f.q.trim());
  let list = books.filter((b) => {
    if (q && !fold(`${b.title} ${b.author}`).includes(q)) return false;
    if (f.genre && !splitGenres(b.genre).some((g) => g.toLowerCase() === f.genre.toLowerCase())) return false;
    if (f.author && b.author !== f.author) return false;
    if (f.status && statusOf(b) !== f.status) return false;
    return true;
  });
  const sorters = {
    added: (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
    recent: (a, b) => (b.lastReadAt || '').localeCompare(a.lastReadAt || '') || b.id - a.id,
    title: (a, b) => collator.compare(a.title, b.title),
    author: (a, b) => collator.compare(a.author || '￿', b.author || '￿') || collator.compare(a.title, b.title),
    progress: (a, b) => b.percent - a.percent,
  };
  return list.sort(sorters[f.sort] || sorters.added);
}

function fillSelect(select, values, allLabel) {
  const current = select.value;
  select.replaceChildren(el('option', { value: '', text: allLabel }), ...values.map((v) => el('option', { value: v, text: v })));
  select.value = values.includes(current) ? current : '';
}

function refreshOptions() {
  const genreMap = new Map();
  for (const b of state.books) for (const g of splitGenres(b.genre)) if (!genreMap.has(g.toLowerCase())) genreMap.set(g.toLowerCase(), g);
  const genres = [...genreMap.values()].sort(collator.compare);
  const authors = [...new Set(state.books.map((b) => b.author).filter(Boolean))].sort(collator.compare);
  fillSelect($('genre'), genres, 'Tất cả thể loại');
  fillSelect($('author'), authors, 'Tất cả tác giả');
  $('genre-list').replaceChildren(...genres.map((g) => el('option', { value: g })));
  $('author-list').replaceChildren(...authors.map((a) => el('option', { value: a })));
}

function render() {
  const f = filters();
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch {}
  const filtered = f.q || f.genre || f.author || f.status;
  const list = applyFilters(state.books);

  const reading = state.books
    .filter((b) => statusOf(b) === 'reading')
    .sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt))
    .slice(0, 6);
  $('continue-section').hidden = filtered || reading.length === 0;
  $('continue').replaceChildren(...reading.map(bookCard));

  $('shelf').replaceChildren(...list.map(bookCard));
  $('count').textContent = filtered ? `${list.length} / ${state.books.length} cuốn sách` : `${state.books.length} cuốn sách`;
  $('clear-filters').hidden = !filtered;
  $('shelf-title').textContent = filtered ? 'Kết quả lọc' : 'Kệ sách';

  const empty = $('empty');
  empty.hidden = list.length > 0;
  if (state.books.length === 0) {
    empty.replaceChildren(el('h2', { text: 'Kệ sách đang trống' }), el('p', { text: 'Bấm "+ Thêm sách" để tải lên cuốn sách đầu tiên.' }));
  } else {
    empty.replaceChildren(el('h2', { text: 'Không tìm thấy sách phù hợp' }), el('p', { text: 'Thử đổi từ khoá hoặc bộ lọc.' }));
  }
}

async function loadBooks() {
  state.books = await api('/api/books');
  refreshOptions();
  render();
}

// ---------- Detail dialog ----------
function openDetail(book) {
  const d = $('detail-dialog');
  $('d-cover').replaceChildren(coverNode(book));
  $('d-title').textContent = book.title;
  $('d-author').textContent = book.author || 'Không rõ tác giả';
  $('d-genres').replaceChildren(...splitGenres(book.genre).map((g) => el('span', { class: 'chip', text: g })));
  $('d-meta').textContent = `${book.format.toUpperCase()} · ${formatSize(book.size)} · Thêm bởi ${book.uploaderName || 'người dùng đã xoá'} ngày ${formatDate(book.createdAt)}`;
  $('d-progress').replaceChildren(
    el('div', { class: 'progress' }, el('div', { style: { width: `${book.percent}%` } })),
    el('div', { class: 'progress-text' },
      el('span', { text: progressLabel(book) + (book.positionLabel && statusOf(book) === 'reading' ? ` · ${book.positionLabel}` : '') }),
      book.lastReadAt ? el('span', { text: `Lần cuối: ${formatDate(book.lastReadAt)}` }) : null)
  );
  $('d-desc').textContent = book.description;
  $('d-read').href = `/read/${book.id}`;
  $('d-read').textContent = book.lastReadAt ? 'Đọc tiếp' : 'Đọc';
  $('d-download').href = `/api/books/${book.id}/file?download=1`;
  $('d-edit').hidden = !book.canEdit;
  $('d-delete').hidden = !book.canEdit;
  $('d-reset').hidden = !book.lastReadAt;
  $('d-edit').onclick = () => { d.close(); openBookForm(book); };
  $('d-reset').onclick = async () => {
    if (!confirm('Xoá tiến độ đọc của bạn với cuốn sách này?')) return;
    await api(`/api/books/${book.id}/progress`, { method: 'DELETE' });
    d.close();
    toast('Đã đặt lại tiến độ');
    loadBooks();
  };
  $('d-delete').onclick = async () => {
    if (!confirm(`Xoá vĩnh viễn "${book.title}" khỏi thư viện? Mọi người sẽ không đọc được nữa.`)) return;
    try {
      await api(`/api/books/${book.id}`, { method: 'DELETE' });
      d.close();
      toast('Đã xoá sách');
      loadBooks();
    } catch (err) {
      alert(err.message);
    }
  };
  d.showModal();
}

// ---------- Upload / edit dialog ----------
function setCoverPreview(src) {
  const preview = $('cover-preview');
  preview.replaceChildren(src ? el('img', { src, alt: 'Ảnh bìa' }) : 'Chưa có ảnh bìa');
}

function setCoverBlob(blob) {
  state.coverBlob = blob;
  setCoverPreview(blob ? URL.createObjectURL(blob) : null);
}

function openBookForm(book = null) {
  state.editing = book;
  state.coverBlob = null;
  const form = $('book-form');
  form.reset();
  $('book-error').textContent = '';
  $('file-hint').textContent = '';
  $('book-dialog-title').textContent = book ? 'Sửa thông tin sách' : 'Thêm sách';
  $('file-field').hidden = Boolean(book);
  $('f-file').required = !book;
  $('book-submit').disabled = false;
  $('book-submit').textContent = book ? 'Lưu' : 'Tải lên';
  if (book) {
    $('f-title').value = book.title;
    $('f-author').value = book.author;
    $('f-genre').value = book.genre;
    $('f-desc').value = book.description;
    setCoverPreview(book.hasCover ? `/api/books/${book.id}/cover` : null);
  } else {
    setCoverPreview(null);
  }
  $('book-dialog').showModal();
}

$('f-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!formatOf(file.name)) {
    $('book-error').textContent = 'Định dạng chưa hỗ trợ. Hỗ trợ: EPUB, PDF, TXT, MD, CBZ';
    return;
  }
  $('book-error').textContent = '';
  $('file-hint').textContent = `${formatSize(file.size)} · đang đọc thông tin sách…`;
  const meta = await extractMetadata(file);
  if (e.target.files[0] !== file) return; // a different file was picked meanwhile
  $('file-hint').textContent = formatSize(file.size);
  $('f-title').value = meta.title;
  if (meta.author) $('f-author').value = meta.author;
  if (meta.description) $('f-desc').value = meta.description.slice(0, 5000);
  if (meta.cover) setCoverBlob(meta.cover);
});

$('f-cover').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) setCoverBlob(await shrinkImage(file));
});

$('book-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append('title', $('f-title').value);
  fd.append('author', $('f-author').value);
  fd.append('genre', $('f-genre').value);
  fd.append('description', $('f-desc').value);
  if (state.coverBlob) {
    const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[state.coverBlob.type] || 'jpg';
    fd.append('cover', state.coverBlob, `cover.${ext}`);
  }
  const editing = state.editing;
  if (!editing) {
    const file = $('f-file').files[0];
    if (!file) return;
    fd.append('file', file);
  }

  const submit = $('book-submit');
  submit.disabled = true;
  // XHR instead of fetch so large uploads can show progress.
  const xhr = new XMLHttpRequest();
  xhr.open(editing ? 'PUT' : 'POST', editing ? `/api/books/${editing.id}` : '/api/books');
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) submit.textContent = `Đang tải ${Math.round((ev.loaded / ev.total) * 100)}%`;
  };
  xhr.onload = () => {
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status >= 200 && xhr.status < 300) {
      $('book-dialog').close();
      toast(editing ? 'Đã lưu thay đổi' : 'Đã thêm sách vào thư viện');
      loadBooks();
    } else {
      if (xhr.status === 401) location.href = '/login';
      $('book-error').textContent = data.error || `Lỗi ${xhr.status}`;
      submit.disabled = false;
      submit.textContent = editing ? 'Lưu' : 'Tải lên';
    }
  };
  xhr.onerror = () => {
    $('book-error').textContent = 'Mất kết nối tới máy chủ';
    submit.disabled = false;
    submit.textContent = editing ? 'Lưu' : 'Tải lên';
  };
  xhr.send(fd);
});

// ---------- Password ----------
$('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/me/password', { method: 'POST', body: { currentPassword: $('p-current').value, newPassword: $('p-new').value } });
    $('password-dialog').close();
    toast('Đã đổi mật khẩu');
  } catch (err) {
    $('password-error').textContent = err.message;
  }
});

// ---------- Wiring ----------
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$('upload-btn').addEventListener('click', () => openBookForm());
$('logout-btn').addEventListener('click', logout);
$('password-btn').addEventListener('click', () => {
  $('password-form').reset();
  $('password-error').textContent = '';
  $('password-dialog').showModal();
});
for (const id of ['genre', 'author', 'status', 'sort']) $(id).addEventListener('change', render);
$('q').addEventListener('input', render);
$('clear-filters').addEventListener('click', () => {
  for (const id of ['q', 'genre', 'author', 'status']) $(id).value = '';
  render();
});

(async function init() {
  state.me = await api('/api/me');
  $('who').textContent = `Xin chào, ${state.me.displayName}`;
  $('admin-link').hidden = state.me.role !== 'admin';
  await loadBooks();
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}');
    for (const [k, v] of Object.entries(saved)) if ($(k) && v !== undefined) $(k).value = v;
    // Drop saved selections that no longer exist in the library.
    for (const id of ['genre', 'author']) if ($(id).selectedIndex < 0) $(id).value = '';
    if ($('sort').selectedIndex < 0) $('sort').value = 'added';
  } catch {}
  render();
})();
