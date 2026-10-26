#!/usr/bin/env node
/**
 * Minimal Netlify-like static server for e2e tests and local checks:
 * serves dist/ with directory index.html, returns dist/404.html with status 404,
 * applies the headers declared in netlify.toml (including the CSP), and answers
 * /api/* like a deployment where no secrets are configured
 * (lead → 503, AI status → unavailable). Text responses are compressed
 * (brotli/gzip) like on Netlify, so performance measurements are realistic.
 * Usage: node scripts/serve-dist.mjs [port]
 */
import { createServer } from 'node:http';
import { readFileSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createBrotliCompress, createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const port = Number(process.argv[2] || process.env.PORT || 4300);

// Pull global header values out of netlify.toml (the first [[headers]] block for "/*").
const toml = readFileSync(join(root, 'netlify.toml'), 'utf-8');
const globalBlock = toml.split('[[headers]]')[1] ?? '';
const headers = Object.fromEntries([...globalBlock.matchAll(/^\s+([A-Za-z-]+) = "(.*)"$/gm)].map((m) => [m[1], m[2]]));
delete headers.for;
delete headers['Strict-Transport-Security'];
if (headers['Content-Security-Policy']) headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(/; upgrade-insecure-requests/, '');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.csv': 'text/csv; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.md': 'text/markdown',
};

function fileFor(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidates = [join(dist, clean), join(dist, clean, 'index.html'), join(dist, `${clean}.html`)];
  for (const c of candidates) {
    if (!c.startsWith(dist)) continue;
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* next */
    }
  }
  return null;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (url.pathname === '/api/ai/status') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ available: false, reason: 'Ключ провайдера не настроен на сервере.' }));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'not configured' }));
    return;
  }
  const file = fileFor(url.pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    createReadStream(join(dist, '404.html')).pipe(res);
    return;
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const compressible = /text|javascript|json|svg|xml|manifest/.test(type);
  const accept = String(req.headers['accept-encoding'] ?? '');
  const cache = url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (compressible && /\bbr\b/.test(accept)) {
    res.writeHead(200, { 'content-type': type, 'content-encoding': 'br', 'cache-control': cache, vary: 'accept-encoding' });
    createReadStream(file).pipe(createBrotliCompress()).pipe(res);
  } else if (compressible && /gzip/.test(accept)) {
    res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip', 'cache-control': cache, vary: 'accept-encoding' });
    createReadStream(file).pipe(createGzip()).pipe(res);
  } else {
    res.writeHead(200, { 'content-type': type, 'cache-control': cache });
    createReadStream(file).pipe(res);
  }
}).listen(port, () => console.log(`serving dist on http://localhost:${port}`));
