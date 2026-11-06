// Builds the commercial proposal PDF from kp-photoagent.html.
// Usage: node docs/proposals/photo-mobile/build.mjs
// Needs Playwright (Chromium) and poppler's pdftotext (for TOC page numbers).
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

// Resolve Playwright from the project, or from a globally preinstalled copy.
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright'));
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, 'kp-photoagent.html');
const out = path.join(dir, 'KP-PhotoAgent-Photo-mobile.pdf');
const DOC = 'КП-PM-2026-01';

const pdfOptions = {
  path: out,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="width:100%;margin:0 18mm;padding-bottom:3px;border-bottom:0.5px solid #d5dde8;font-family:serif;font-size:7px;font-weight:700;color:#4b5568;letter-spacing:.03em">NORO&nbsp; / &nbsp;КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ · PHOTOAGENT</div>`,
  footerTemplate: `<div style="width:100%;margin:0 18mm;text-align:right;font-family:serif;font-size:7px;color:#5a6578">КОНФИДЕНЦИАЛЬНО &nbsp;|&nbsp; ${DOC} &nbsp;|&nbsp; Стр. <span class="pageNumber" style="font-size:9px;color:#1b2a4a"></span></div>`,
};

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(src).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

// Pass 1: render, then find the page on which every section heading lands.
await page.pdf(pdfOptions);
const headings = await page.$$eval('section h1', (els) => els.map((e) => e.textContent));
const pagesText = execFileSync('pdftotext', ['-layout', out, '-'], { encoding: 'utf8' })
  .split('\f')
  .map(norm);
const pageOf = headings.map((h) => {
  const key = norm(h).slice(0, 28);
  // Skip the cover and the TOC page itself, which also contain the titles.
  const i = pagesText.findIndex((t, n) => n >= 2 && t.includes(key));
  return i < 0 ? '' : String(i + 1);
});

// TOC rows map to sections after the cover (index 0) and the TOC itself (index 1).
await page.$$eval(
  '.toc td.pg',
  (cells, nums) => cells.forEach((c, i) => (c.textContent = nums[i + 2] || '')),
  pageOf,
);
const missing = pageOf.slice(2).filter((n) => !n).length;
await page.pdf(pdfOptions);

// The To-Be diagram as a PNG, for the DOCX version (build_docx.py).
const shot = await browser.newPage({ deviceScaleFactor: 3, viewport: { width: 760, height: 600 } });
await shot.goto(pathToFileURL(src).href, { waitUntil: 'networkidle' });
await shot.evaluate(() => document.fonts.ready);
await shot.locator('svg').first().screenshot({ path: path.join(dir, 'diagram-to-be.png') });
await browser.close();
console.log(`PDF: ${out}  (${pagesText.length - 1} pages, ${missing} TOC entries without page)`);
