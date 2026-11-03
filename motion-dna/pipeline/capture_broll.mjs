// Captures real screen B-roll of the NORO site (served locally) as tall
// 1080px-wide screenshots. The renderer scrolls them like screen recordings.
// Usage: node pipeline/capture_broll.mjs http://localhost:4300 public/broll
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4300';
const outDir = process.argv[3] ?? 'public/broll';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 693 }, deviceScaleFactor: 1080 / 390, colorScheme: 'dark', bypassCSP: true });
const page = await ctx.newPage();

async function shot(name, url, prepare) {
  await page.goto(base + url, { waitUntil: 'load' });
  let top = 0;
  if (prepare) top = await prepare();
  await page.waitForTimeout(1200);
  // Fixed header and toasts repeat inside a full-page capture; hide them.
  await page.addStyleTag({ content: 'header, [class*="toast"], [role="status"] { display: none !important; }' });
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true, clip: { x: 0, y: top, width: 390, height: 693 * 4 } });
  console.log('saved', name, 'from y', top);
}

// Loads the product's demo data and returns the y offset of the app frame,
// so the footage shows a working app rather than the landing text.
const clickDemo = async () => {
  const btn = page.getByTestId('demo-button').first();
  await btn.scrollIntoViewIfNeeded();
  const y = await btn.evaluate((el) => {
    const frame = el.closest('section, .app, [class*="frame"]') ?? el;
    return Math.max(0, frame.getBoundingClientRect().top + window.scrollY - 24);
  });
  await btn.click();
  await page.waitForTimeout(2500);
  return y;
};

await shot('home', '/');
await shot('lead-engine', '/products/lead-engine', clickDemo);
await shot('bi', '/products/business-intelligence', clickDemo);
await shot('catalog', '/products/catalog-studio', clickDemo);
await browser.close();
