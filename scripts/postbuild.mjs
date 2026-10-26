#!/usr/bin/env node
/**
 * Post-build step: writes a static HTML entry for every route with unique
 * <title>, description, canonical, Open Graph tags and a <noscript> summary,
 * plus 404.html and sitemap.xml. Netlify serves /products/x from
 * dist/products/x/index.html, so direct links and refreshes work without a
 * catch-all rewrite, and unknown URLs get a real 404 status.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const seo = JSON.parse(readFileSync(join(root, 'src', 'config', 'seo.json'), 'utf-8'));
const template = readFileSync(join(dist, 'index.html'), 'utf-8');

// Netlify exposes the primary site URL as URL during builds.
const siteUrl = (process.env.VITE_SITE_URL || process.env.URL || '').replace(/\/$/, '');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(path, meta) {
  const isNotFound = path === '/404';
  const abs = (p) => (siteUrl ? siteUrl + p : p);
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(seo.siteName)}" />`,
    `<meta property="og:locale" content="ru_RU" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:image" content="${esc(abs(meta.og))}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];
  if (!isNotFound) {
    tags.push(`<meta property="og:url" content="${esc(abs(path))}" />`);
    if (siteUrl) tags.push(`<link rel="canonical" href="${esc(siteUrl + path)}" />`);
  } else {
    tags.push(`<meta name="robots" content="noindex" />`);
  }
  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(meta.description)}" />`)
    .replace('<!--noro:head-->', tags.join('\n    '))
    .replace(/<!--noro:noscript-->[^<]*/, esc(meta.noscript));
  if (path === '/') {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'NORO',
      description: meta.description,
      ...(siteUrl ? { url: siteUrl } : {}),
    };
    html = html.replace('</head>', `  <script type="application/ld+json">${JSON.stringify(ld)}</script>\n  </head>`);
  }
  return html;
}

const written = [];
for (const [path, meta] of Object.entries(seo.routes)) {
  const html = render(path, meta);
  if (path === '/404') {
    writeFileSync(join(dist, '404.html'), html);
    written.push('404.html');
    continue;
  }
  const file = path === '/' ? join(dist, 'index.html') : join(dist, path.slice(1), 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  written.push(file.replace(dist + '/', ''));
}

// sitemap.xml (only when the absolute site URL is known)
const today = new Date().toISOString().slice(0, 10);
const urls = Object.keys(seo.routes).filter((p) => p !== '/404');
if (siteUrl) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((p) => `  <url><loc>${siteUrl}${p}</loc><lastmod>${today}</lastmod><priority>${p === '/' ? '1.0' : p.startsWith('/products') ? '0.8' : '0.5'}</priority></url>`)
    .join('\n')}\n</urlset>\n`;
  writeFileSync(join(dist, 'sitemap.xml'), xml);
  written.push('sitemap.xml');
}
const robots = `User-agent: *\nAllow: /\nDisallow: /api/\n${siteUrl ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''}`;
writeFileSync(join(dist, 'robots.txt'), robots);
written.push('robots.txt');

if (!existsSync(join(dist, 'favicon.svg'))) console.warn('warning: favicon.svg missing in dist');
console.log(`postbuild: ${written.length} files${siteUrl ? ` for ${siteUrl}` : ' (no site URL: canonical/sitemap skipped — set VITE_SITE_URL or build on Netlify)'}`);
console.log('  ' + written.join('\n  '));
