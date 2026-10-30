const path = require('path');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

module.exports = {
  port: Number(process.env.PORT) || 3000,
  dataDir,
  booksDir: path.join(dataDir, 'books'),
  coversDir: path.join(dataDir, 'covers'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 200,
  sessionDays: Number(process.env.SESSION_DAYS) || 30,
  // Set to "true" when served over HTTPS so the session cookie is marked Secure.
  secureCookies: process.env.SECURE_COOKIES === 'true',
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
};
