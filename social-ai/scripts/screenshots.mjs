// Captures every page of a running NORO instance (used for visual checks). Usage: node scripts/screenshots.mjs <baseUrl> <outDir> [width]
import fs from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const out = process.argv[3] ?? 'test-results/screens';
const width = Number(process.argv[4] ?? 1440);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForTimeout(500);
if (await page.getByText('Первый запуск').count()) {
  const pw = page.locator('input[autocomplete=new-password]');
  await pw.nth(0).fill(process.env.NORO_PW ?? 'supersecret1');
  await pw.nth(1).fill(process.env.NORO_PW ?? 'supersecret1');
  await page.getByRole('button', { name: 'Создать и войти' }).click();
} else if (await page.getByRole('button', { name: 'Войти' }).count()) {
  await page.getByLabel('Логин').fill('admin');
  await page.locator('input[autocomplete=current-password]').fill(process.env.NORO_PW ?? 'supersecret1');
  await page.getByRole('button', { name: 'Войти' }).click();
}
await page.waitForTimeout(800);
const pages = (process.argv[5] ?? '/,/accounts,/content,/calendar,/agent,/analytics,/settings,/journal').split(',');
for (const p of pages) {
  await page.goto(base + p);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${(p.replace(/\//g, '_') || '_home')}-${width}.png`, fullPage: process.env.FULL === '1' });
}
console.log(JSON.stringify({ errors }));
await browser.close();
