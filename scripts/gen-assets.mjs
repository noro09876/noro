#!/usr/bin/env node
/* global document */
/**
 * Generates raster brand assets (OG images, PNG/ICO favicons) with the
 * preinstalled Chromium. Dev-time only; outputs are committed to public/.
 * Run: node scripts/gen-assets.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
mkdirSync(join(pub, 'og'), { recursive: true });

const font = (p) => pathToFileURL(join(root, 'node_modules', p)).href;
const fonts = `
@font-face{font-family:Unb;src:url(${font('@fontsource-variable/unbounded/files/unbounded-cyrillic-wght-normal.woff2')}) format('woff2');unicode-range:U+0400-045F}
@font-face{font-family:Unb;src:url(${font('@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2')}) format('woff2');unicode-range:U+0000-00FF}
@font-face{font-family:On;src:url(${font('@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2')}) format('woff2');unicode-range:U+0400-045F}
@font-face{font-family:On;src:url(${font('@fontsource-variable/onest/files/onest-latin-wght-normal.woff2')}) format('woff2');unicode-range:U+0000-00FF}`;

const products = [
  ['noro', '#c9f45f', 'NORO', 'Системы автоматизации для заявок, поддержки, документов, каталогов, контента и аналитики', 'Шесть работающих демо — без регистрации'],
  ['lead-engine', '#f08a4b', 'Lead Engine', 'Квалификация и скоринг лидов из CSV', 'Дубли · нормализация · рейтинг A/B/C · сообщения'],
  ['support', '#35c9a8', 'Support', 'Поддержка клиентов по базе знаний', 'Ответы с источниками · эскалация оператору'],
  ['content-os', '#ee7fb0', 'Content OS', 'Один исходник — публикации для всех площадок', 'Telegram · VK · YouTube · Shorts · календарь'],
  ['docs-intelligence', '#6cb4ff', 'Docs Intelligence', 'Извлечение и проверка реквизитов документов', 'ИНН · БИК + счёт · НДС · суммы'],
  ['catalog-studio', '#f2c14e', 'Catalog Studio', 'Очистка и подготовка товарного каталога', 'Импорт → анализ → исправление → экспорт'],
  ['business-intelligence', '#a597ff', 'Business Intelligence', 'Аналитика продаж из вашей таблицы', 'Динамика · сравнение периодов · аномалии'],
];
const mark = readFileSync(join(pub, 'favicon.svg'), 'utf-8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [slug, color, name, title, sub] of products) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
  body{margin:0;width:1200px;height:630px;background:#0a0b0c;color:#eef0ee;font-family:On,sans-serif;position:relative;overflow:hidden}
  .grid{position:absolute;inset:0;background-image:linear-gradient(to right,rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.045) 1px,transparent 1px);background-size:60px 60px;mask-image:radial-gradient(ellipse 70% 80% at 80% 20%,#000 20%,transparent 80%)}
  .glow{position:absolute;right:-200px;top:-220px;width:800px;height:640px;background:radial-gradient(closest-side,${color}33,transparent)}
  .wrap{position:absolute;inset:70px 80px;display:flex;flex-direction:column}
  .brand{display:flex;align-items:center;gap:16px;font-family:Unb;font-size:30px;letter-spacing:.08em;font-weight:600}
  .brand svg{width:52px;height:52px}
  h1{font-family:Unb;font-weight:500;font-size:${slug === 'noro' ? 54 : 70}px;line-height:1.05;letter-spacing:-.03em;margin:auto 0 18px;color:${slug === 'noro' ? '#eef0ee' : color}}
  p{font-size:32px;margin:0;color:#eef0ee;max-width:960px;line-height:1.3}
  small{display:block;margin-top:22px;font-size:24px;color:#b4bab6;font-family:On}
  .bar{position:absolute;left:0;right:0;bottom:0;height:8px;background:${color}}
  </style></head><body><div class="grid"></div><div class="glow"></div><div class="wrap"><div class="brand">${mark}NORO</div>
  <h1>${slug === 'noro' ? title : name}</h1>${slug === 'noro' ? '' : `<p>${title}</p>`}<small>${sub}</small></div><div class="bar"></div></body></html>`;
  const tmp = join(tmpdir(), `noro-og-${slug}.html`);
  writeFileSync(tmp, html);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(pub, 'og', `${slug}.png`) });
  console.log('og', slug);
}

// PNG icons
const icon = await browser.newPage({ viewport: { width: 512, height: 512 } });
for (const [size, file] of [[512, 'icon-512.png'], [180, 'apple-touch-icon.png'], [32, 'favicon-32.png']]) {
  await icon.setViewportSize({ width: size, height: size });
  await icon.setContent(`<html><body style="margin:0;background:transparent">${mark.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await icon.screenshot({ path: join(pub, file), omitBackground: true });
}
await browser.close();

// favicon.ico wrapping the 32px PNG (ICO with embedded PNG is widely supported)
const png = readFileSync(join(pub, 'favicon-32.png'));
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(32, 6);
header.writeUInt8(32, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync(join(pub, 'favicon.ico'), Buffer.concat([header, png]));
console.log('icons ok');
