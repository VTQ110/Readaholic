// Helpers shared by the uploader (metadata/cover extraction) and the reader.
let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= import('/vendor/pdfjs/pdf.min.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    return lib;
  });
  return pdfjsPromise;
}

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

// Returns the image entries of a CBZ archive in reading order.
function cbzPages(zip) {
  return Object.values(zip.files)
    .filter((f) => !f.dir && IMAGE_RE.test(f.name) && !f.name.startsWith('__MACOSX'))
    .sort((a, b) => naturalCompare(a.name, b.name));
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  return (doc.body.textContent || '').trim();
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

// Scales an image blob down so stored covers stay small.
async function shrinkImage(blob, maxWidth = 500) {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } catch {
    return blob;
  }
}

function formatOf(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  return { epub: 'epub', pdf: 'pdf', txt: 'txt', md: 'txt', cbz: 'cbz' }[ext] || null;
}

// Best-effort extraction of { title, author, description, cover(Blob) } from a local file.
async function extractMetadata(file) {
  const format = formatOf(file.name);
  const meta = { title: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim(), author: '', description: '', cover: null };
  try {
    if (format === 'epub') {
      const book = ePub(await file.arrayBuffer());
      await book.ready;
      const md = await book.loaded.metadata;
      meta.title = md.title || meta.title;
      meta.author = md.creator || '';
      meta.description = stripHtml(md.description);
      const coverUrl = await book.coverUrl();
      if (coverUrl) meta.cover = await shrinkImage(await (await fetch(coverUrl)).blob());
      book.destroy();
    } else if (format === 'pdf') {
      const pdfjs = await loadPdfjs();
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const { info } = await pdf.getMetadata().catch(() => ({ info: {} }));
      if (info?.Title?.trim()) meta.title = info.Title.trim();
      if (info?.Author?.trim()) meta.author = info.Author.trim();
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 500 / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      meta.cover = await canvasToBlob(canvas);
      pdf.destroy();
    } else if (format === 'cbz') {
      const zip = await JSZip.loadAsync(file);
      const first = cbzPages(zip)[0];
      if (first) meta.cover = await shrinkImage(await first.async('blob'));
    }
  } catch (err) {
    console.warn('Không đọc được metadata', err);
  }
  return meta;
}
