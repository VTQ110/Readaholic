#!/usr/bin/env node
// Minimal static server for trying the built site locally: npm run dev
const http = require('http');
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json',
};

http
  .createServer((req, res) => {
    let file = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (file.endsWith('/')) file += 'index.html';
    const full = path.join(dist, file);
    if (!full.startsWith(dist)) return res.writeHead(403).end();
    fs.readFile(full, (err, data) => {
      if (err) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(port, () => console.log(`Mở http://localhost:${port}`));
