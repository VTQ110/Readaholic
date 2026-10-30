const $ = (id) => document.getElementById(id);
const bookId = Number(location.pathname.split('/').pop());
const viewer = $('viewer');
const SETTINGS_KEY = 'readaholic.reader';

const THEMES = {
  light: { color: '#1f1b17', link: '#9a4f2b' },
  sepia: { color: '#4b3a28', link: '#8a4a22' },
  dark: { color: '#ddd3c7', link: '#d98a5f' },
};

const settings = { theme: 'light', fontSize: 100 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}
if (!THEMES[settings.theme]) settings.theme = 'light';

let engine = null;

// ---------- Progress saving ----------
const progress = { current: null, lastSaved: null, timer: null };

function report({ location: loc, percent, label }) {
  percent = Math.max(0, Math.min(100, percent));
  progress.current = { location: String(loc), percent, positionLabel: label || '' };
  $('position').textContent = label || '';
  $('percent').textContent = `${Math.floor(percent)}%`;
  $('progress-bar').style.width = `${percent}%`;
  clearTimeout(progress.timer);
  progress.timer = setTimeout(saveProgress, 1500);
}

async function saveProgress(keepalive = false) {
  clearTimeout(progress.timer);
  const data = progress.current;
  if (!data || JSON.stringify(data) === progress.lastSaved) return;
  const body = JSON.stringify(data);
  try {
    const res = await fetch(`/api/books/${bookId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive,
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error();
    progress.lastSaved = body;
    $('saved').textContent = 'Đã lưu ✓';
  } catch {
    $('saved').textContent = 'Chưa lưu được';
  }
}

addEventListener('pagehide', () => saveProgress(true));
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveProgress(true));

// ---------- Engines ----------
// Each engine exposes: next(), prev(), goTo(pageNumber)?, total(), setFontSize(pct)?, setTheme(name)?, zoom?(dir)

async function epubEngine(saved) {
  const buffer = await (await fetch(`/api/books/${bookId}/file`)).arrayBuffer();
  const book = ePub(buffer);
  const rendition = book.renderTo(viewer, {
    width: '100%', height: '100%', flow: 'paginated', spread: 'auto', allowScriptedContent: false,
  });
  for (const [name, t] of Object.entries(THEMES)) {
    rendition.themes.register(name, {
      body: { color: `${t.color} !important`, background: 'transparent !important' },
      'p, div, span, li, h1, h2, h3, h4, h5, h6, blockquote, td': { color: 'inherit !important' },
      a: { color: `${t.link} !important` },
    });
  }
  rendition.themes.select(settings.theme);
  rendition.themes.fontSize(`${settings.fontSize}%`);

  let locationsReady = false;
  let lastLoc = null;

  function onRelocated(loc) {
    lastLoc = loc;
    const cfi = loc.start.cfi;
    if (!locationsReady) {
      report({ location: cfi, percent: progress.current?.percent ?? saved.percent, label: 'Đang tính số trang…' });
      return;
    }
    const total = book.locations.length();
    const page = book.locations.locationFromCfi(cfi) + 1;
    const percent = loc.atEnd ? 100 : book.locations.percentageFromCfi(cfi) * 100;
    report({ location: cfi, percent, label: `Trang ${Math.min(page, total)}/${total}` });
  }
  rendition.on('relocated', onRelocated);

  // Keyboard and swipe events happen inside the book iframe.
  rendition.on('keydown', handleKey);
  let touchX = null;
  rendition.on('touchstart', (e) => (touchX = e.changedTouches[0].screenX));
  rendition.on('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].screenX - touchX;
    if (Math.abs(dx) > 50) (dx < 0 ? rendition.next() : rendition.prev());
    touchX = null;
  });

  try {
    await rendition.display(saved.location || undefined);
  } catch {
    await rendition.display();
  }

  book.loaded.navigation.then((nav) => {
    const toc = $('toc');
    const add = (items, depth) => {
      for (const item of items) {
        toc.append(el('a', {
          href: '#', class: depth ? 'sub' : '', text: item.label.trim(),
          onclick: (e) => { e.preventDefault(); rendition.display(item.href); toc.hidden = true; },
        }));
        if (item.subitems?.length && depth < 2) add(item.subitems, depth + 1);
      }
    };
    add(nav.toc, 0);
    $('toc-btn').hidden = nav.toc.length === 0;
  });

  // Page numbers need a full pass over the book; do it in the background and cache it per book.
  (async () => {
    const cacheKey = `readaholic.locations.${bookId}`;
    let cached = null;
    try { cached = localStorage.getItem(cacheKey); } catch {}
    if (cached) book.locations.load(cached);
    else {
      await book.locations.generate(1024);
      try { localStorage.setItem(cacheKey, book.locations.save()); } catch {}
    }
    locationsReady = true;
    if (lastLoc) onRelocated(lastLoc);
  })();

  return {
    next: () => rendition.next(),
    prev: () => rendition.prev(),
    total: () => (locationsReady ? book.locations.length() : 0),
    goTo: (n) => rendition.display(book.locations.cfiFromLocation(n - 1)),
    setFontSize: (pct) => rendition.themes.fontSize(`${pct}%`),
    setTheme: (name) => rendition.themes.select(name),
  };
}

async function pdfEngine(saved) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ url: `/api/books/${bookId}/file` }).promise;
  const scroll = el('div', { class: 'r-scroll' });
  const pageWrap = el('div', { class: 'r-page' });
  const canvas = el('canvas');
  pageWrap.append(canvas);
  scroll.append(pageWrap);
  viewer.append(scroll);

  let page = Math.min(Math.max(1, parseInt(saved.location, 10) || 1), pdf.numPages);
  let zoom = 1; // multiplier on top of fit-to-width
  let task = null;

  async function render() {
    const p = await pdf.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const fitWidth = (scroll.clientWidth - 24) / base.width;
    const fitHeight = (scroll.clientHeight - 24) / base.height;
    // "Fit" shows the whole page on landscape screens and the full width on narrow ones.
    const fit = scroll.clientWidth > scroll.clientHeight ? Math.min(fitWidth, fitHeight * 1.0) : fitWidth;
    const scale = Math.max(0.2, fit * zoom);
    const viewport = p.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    task?.cancel();
    task = p.render({ canvasContext: canvas.getContext('2d'), viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
    try { await task.promise; } catch (err) { if (err?.name !== 'RenderingCancelledException') throw err; }
    $('zoom-level').textContent = zoom === 1 ? 'Vừa khung' : `${Math.round(zoom * 100)}%`;
  }

  async function show(n) {
    page = Math.min(Math.max(1, n), pdf.numPages);
    scroll.scrollTop = 0;
    report({ location: page, percent: (page / pdf.numPages) * 100, label: `Trang ${page}/${pdf.numPages}` });
    await render();
  }

  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); }).observe(scroll);
  await show(page);

  return {
    next: () => page < pdf.numPages && show(page + 1),
    prev: () => page > 1 && show(page - 1),
    total: () => pdf.numPages,
    goTo: show,
    zoom: (dir) => {
      zoom = dir === 0 ? 1 : Math.min(4, Math.max(0.25, +(zoom + dir * 0.25).toFixed(2)));
      render();
    },
  };
}

async function cbzEngine(saved) {
  const zip = await JSZip.loadAsync(await (await fetch(`/api/books/${bookId}/file`)).arrayBuffer());
  const pages = cbzPages(zip);
  if (!pages.length) throw new Error('File CBZ không có ảnh nào');
  const scroll = el('div', { class: 'r-scroll' });
  const pageWrap = el('div', { class: 'r-page fit' });
  const img = el('img', { alt: '' });
  pageWrap.append(img);
  scroll.append(pageWrap);
  viewer.append(scroll);

  let page = Math.min(Math.max(1, parseInt(saved.location, 10) || 1), pages.length);
  let zoom = 1;
  let url = null;

  function applyZoom() {
    pageWrap.classList.toggle('fit', zoom === 1);
    img.style.width = zoom === 1 ? '' : `${Math.round(zoom * 100)}%`;
    pageWrap.style.height = zoom === 1 ? '100%' : '';
    $('zoom-level').textContent = zoom === 1 ? 'Vừa khung' : `${Math.round(zoom * 100)}%`;
  }

  async function show(n) {
    page = Math.min(Math.max(1, n), pages.length);
    const blob = await pages[page - 1].async('blob');
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    img.src = url;
    scroll.scrollTop = 0;
    report({ location: page, percent: (page / pages.length) * 100, label: `Trang ${page}/${pages.length}` });
  }

  applyZoom();
  await show(page);
  return {
    next: () => page < pages.length && show(page + 1),
    prev: () => page > 1 && show(page - 1),
    total: () => pages.length,
    goTo: show,
    zoom: (dir) => {
      zoom = dir === 0 ? 1 : Math.min(4, Math.max(0.5, +(zoom + dir * 0.25).toFixed(2)));
      applyZoom();
    },
  };
}

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Older Vietnamese text files are often Windows-1258 encoded.
    return new TextDecoder('windows-1258').decode(buffer);
  }
}

async function txtEngine(saved) {
  const text = decodeText(await (await fetch(`/api/books/${bookId}/file`)).arrayBuffer());
  const scroll = el('div', { class: 'r-scroll', tabindex: '-1' });
  const body = el('div', { class: 'r-text' });
  body.textContent = text.replace(/^﻿/, '');
  scroll.append(body);
  viewer.append(scroll);

  const pageHeight = () => Math.max(1, scroll.clientHeight * 0.92);
  function update() {
    const max = scroll.scrollHeight - scroll.clientHeight;
    const ratio = max > 0 ? scroll.scrollTop / max : 1;
    const total = Math.max(1, Math.ceil(scroll.scrollHeight / pageHeight()));
    const page = max > 0 && scroll.scrollTop >= max - 2 ? total : Math.min(total, Math.floor(scroll.scrollTop / pageHeight()) + 1);
    report({ location: ratio.toFixed(6), percent: ratio * 100, label: `Trang ${page}/${total}` });
  }
  function setFontSize(pct) {
    const max = scroll.scrollHeight - scroll.clientHeight;
    const ratio = max > 0 ? scroll.scrollTop / max : 0;
    body.style.fontSize = `${1.15 * pct / 100}rem`;
    scroll.scrollTop = ratio * (scroll.scrollHeight - scroll.clientHeight);
  }

  setFontSize(settings.fontSize);
  scroll.scrollTop = (parseFloat(saved.location) || 0) * (scroll.scrollHeight - scroll.clientHeight);
  update();
  scroll.addEventListener('scroll', update, { passive: true });
  scroll.focus();

  return {
    next: () => scroll.scrollBy({ top: pageHeight(), behavior: 'smooth' }),
    prev: () => scroll.scrollBy({ top: -pageHeight(), behavior: 'smooth' }),
    total: () => Math.max(1, Math.ceil(scroll.scrollHeight / pageHeight())),
    goTo: (n) => (scroll.scrollTop = (n - 1) * pageHeight()),
    setFontSize,
  };
}

// ---------- UI ----------
function handleKey(e) {
  if (!engine || e.target.closest?.('input, textarea')) return;
  if (['ArrowRight', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); engine.next(); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); engine.prev(); }
  else if (e.key === 'Escape') { $('settings').hidden = true; $('toc').hidden = true; }
}

function applyTheme() {
  document.body.dataset.theme = settings.theme;
  document.querySelectorAll('.theme-swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeValue === settings.theme)));
  engine?.setTheme?.(settings.theme);
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

function changeFont(delta) {
  settings.fontSize = Math.min(200, Math.max(70, settings.fontSize + delta));
  $('font-size').textContent = `${settings.fontSize}%`;
  engine?.setFontSize?.(settings.fontSize);
  saveSettings();
}

document.addEventListener('keydown', handleKey);
$('next').addEventListener('click', () => engine?.next());
$('prev').addEventListener('click', () => engine?.prev());
$('settings-btn').addEventListener('click', () => {
  const s = $('settings');
  s.hidden = !s.hidden;
  $('settings-btn').setAttribute('aria-expanded', String(!s.hidden));
  $('toc').hidden = true;
});
$('toc-btn').addEventListener('click', () => { $('toc').hidden = !$('toc').hidden; $('settings').hidden = true; });
$('font-dec').addEventListener('click', () => changeFont(-10));
$('font-inc').addEventListener('click', () => changeFont(10));
$('zoom-dec').addEventListener('click', () => engine?.zoom?.(-1));
$('zoom-inc').addEventListener('click', () => engine?.zoom?.(1));
$('zoom-fit').addEventListener('click', () => engine?.zoom?.(0));
document.querySelectorAll('.theme-swatch').forEach((b) =>
  b.addEventListener('click', () => { settings.theme = b.dataset.themeValue; applyTheme(); saveSettings(); })
);
viewer.addEventListener('click', () => { $('settings').hidden = true; $('toc').hidden = true; });

$('position').addEventListener('click', () => {
  if (!engine?.goTo || !engine.total()) return;
  const input = $('goto-input');
  input.max = engine.total();
  input.placeholder = `1–${engine.total()}`;
  input.value = '';
  $('goto-form').hidden = false;
  $('position').hidden = true;
  input.focus();
});
$('goto-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = parseInt($('goto-input').value, 10);
  if (n >= 1) engine.goTo(Math.min(n, engine.total()));
  $('goto-input').blur();
});
$('goto-input').addEventListener('blur', () => { $('goto-form').hidden = true; $('position').hidden = false; });

(async function init() {
  applyTheme();
  $('font-size').textContent = `${settings.fontSize}%`;
  try {
    const [book, saved] = await Promise.all([api(`/api/books/${bookId}`), api(`/api/books/${bookId}/progress`)]);
    document.title = `${book.title} · Readaholic`;
    $('title').textContent = book.author ? `${book.title} — ${book.author}` : book.title;
    const isImage = book.format === 'pdf' || book.format === 'cbz';
    $('font-setting').hidden = isImage;
    $('zoom-setting').hidden = !isImage;
    const engines = { epub: epubEngine, pdf: pdfEngine, cbz: cbzEngine, txt: txtEngine };
    engine = await engines[book.format](saved);
    $('loading').hidden = true;
  } catch (err) {
    console.error(err);
    $('loading').textContent = `Không mở được sách: ${err.message || err}`;
  }
})();
