'use strict';
// Low-bandwidth delivery for the plain frontend: text assets are sent Brotli- or gzip-compressed.
// Compressed bytes are cached in memory per file+mtime, so compression runs once, not per request.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const TEXT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const MIN_BYTES = 1024;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;

function pickEncoding(header) {
  const accepted = String(header || '').toLowerCase().split(',').map((p) => p.trim().split(';'))
    .filter(([, q]) => !q || Number(q.trim().replace(/^q=/, '')) > 0).map(([e]) => e.trim());
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return null;
}

function compress(buf, encoding) {
  return encoding === 'br'
    ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })
    : zlib.gzipSync(buf, { level: 9 });
}

function staticCompression(root) {
  const base = path.resolve(root);
  const cache = new Map();
  let cachedBytes = 0;
  return function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(base, '.' + path.posix.normalize('/' + rel));
    if (!file.startsWith(base + path.sep)) return next();
    const type = TEXT[path.extname(file).toLowerCase()];
    if (!type) return next();
    const encoding = pickEncoding(req.headers['accept-encoding']);
    if (!encoding) return next();
    let stat;
    try { stat = fs.statSync(file); } catch { return next(); }
    if (!stat.isFile() || stat.size < MIN_BYTES || stat.size > MAX_BYTES) return next();
    const key = file + '|' + encoding;
    let hit = cache.get(key);
    if (!hit || hit.mtime !== stat.mtimeMs) {
      const body = compress(fs.readFileSync(file), encoding);
      if (hit) cachedBytes -= hit.body.length;
      hit = { mtime: stat.mtimeMs, body, etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}-${encoding}"` };
      if (cachedBytes + body.length <= MAX_CACHE_BYTES) { cache.set(key, hit); cachedBytes += body.length; }
    }
    res.set({ 'Content-Type': type, 'Content-Encoding': encoding, Vary: 'Accept-Encoding', ETag: hit.etag, 'Last-Modified': stat.mtime.toUTCString(), 'Cache-Control': 'public, max-age=0, must-revalidate' });
    if (req.headers['if-none-match'] === hit.etag) return res.status(304).end();
    res.set('Content-Length', String(hit.body.length));
    if (req.method === 'HEAD') return res.end();
    res.end(hit.body);
  };
}

module.exports = { staticCompression, pickEncoding };
