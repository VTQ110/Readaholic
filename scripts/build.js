#!/usr/bin/env node
// Builds the static site into dist/: copies public/, the browser libraries from node_modules,
// and writes js/config.js from SUPABASE_URL / SUPABASE_ANON_KEY when they are set.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const modules = path.join(root, 'node_modules');

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });

const vendor = {
  'epubjs/epub.min.js': 'epubjs/dist/epub.min.js',
  'jszip/jszip.min.js': 'jszip/dist/jszip.min.js',
  'pdfjs/pdf.min.mjs': 'pdfjs-dist/build/pdf.min.mjs',
  'pdfjs/pdf.worker.min.mjs': 'pdfjs-dist/build/pdf.worker.min.mjs',
  'supabase/supabase.js': '@supabase/supabase-js/dist/umd/supabase.js',
};
for (const [target, source] of Object.entries(vendor)) {
  const dest = path.join(dist, 'vendor', target);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(modules, source), dest);
}

const configFile = path.join(dist, 'js', 'config.js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  const config = { supabaseUrl: SUPABASE_URL.trim().replace(/\/+$/, ''), supabaseAnonKey: SUPABASE_ANON_KEY.trim() };
  fs.writeFileSync(configFile, `window.READAHOLIC_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
} else if (!fs.existsSync(configFile)) {
  console.warn('⚠ Chưa có SUPABASE_URL / SUPABASE_ANON_KEY và public/js/config.js — trang sẽ báo chưa cấu hình.');
  fs.writeFileSync(configFile, 'window.READAHOLIC_CONFIG = {};\n');
}

// Tell GitHub Pages not to run Jekyll over the files.
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log('Đã build vào dist/');
