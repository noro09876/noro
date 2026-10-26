import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = ['/', '/contact', '/privacy', '/products/lead-engine', '/products/support', '/products/content-os', '/products/docs-intelligence', '/products/catalog-studio', '/products/business-intelligence', '/404-check'];
const VIEWPORTS = [320, 390, 768, 1024, 1440];

async function axe(page: import('@playwright/test').Page, label: string) {
  // entrance animations fade text in; measure contrast on the settled page
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = serious.map((v) => `${label}: ${v.id} (${v.impact}) — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(report, report.join('\n')).toEqual([]);
}

for (const path of PAGES) {
  test(`a11y: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await axe(page, path);
    const demo = page.getByTestId('demo-button');
    if (await demo.count()) {
      await demo.click();
      await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(400);
      await axe(page, `${path} (demo loaded)`);
    }
  });
}

for (const width of VIEWPORTS) {
  test(`layout: no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const bad: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      const demo = page.getByTestId('demo-button');
      if (path.startsWith('/products') && (await demo.count())) {
        await demo.click();
        await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 20_000 });
      }
      const tabs = path.startsWith('/products') ? await page.locator('.app__nav [role="tab"]').all() : [];
      for (const t of tabs.length ? tabs : [null]) {
        if (t) await t.click();
        const overflow = await page.evaluate(() => {
          // page-level overflow, plus elements spilling out of a non-scrolling parent inside the app frame
          const spill = Array.from(document.querySelectorAll('main *')).filter((el) => {
            const p = el.parentElement;
            if (!p || getComputedStyle(el).position === 'absolute' || String(el.className).includes('glow')) return false;
            if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) return false;
            return el.getBoundingClientRect().right > p.getBoundingClientRect().right + 2;
          }).length;
          return { page: document.documentElement.scrollWidth - window.innerWidth, spill };
        });
        const where = `${path}${t ? ` [${(await t.textContent())?.trim()}]` : ''}`;
        if (overflow.page > 1) bad.push(`${where}: page +${overflow.page}px`);
        if (overflow.spill) bad.push(`${where}: ${overflow.spill} element(s) spill out of their container`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
}

test('performance: home page loads fast and ships a small initial bundle', async ({ page }) => {
  const bytes: Record<string, number> = {};
  page.on('response', async (r) => {
    if (r.url().includes('/assets/') && r.url().endsWith('.js')) bytes[r.url()] = (await r.body()).length;
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { dcl: n.domContentLoadedEventEnd, fcp: fcp?.startTime ?? 0 };
  });
  const totalJs = Object.values(bytes).reduce((s, b) => s + b, 0);
  // eslint-disable-next-line no-console -- surfaced in the test report
  console.log(`home: FCP ${nav.fcp.toFixed(0)}ms, DCL ${nav.dcl.toFixed(0)}ms, JS ${(totalJs / 1024).toFixed(0)} KB (uncompressed)`);
  expect(totalJs).toBeLessThan(450 * 1024);
  expect(nav.fcp).toBeLessThan(2500);
  // heavy parsers are lazy: not loaded on the home page
  expect(Object.keys(bytes).some((u) => /pdf|excel|papaparse/i.test(u))).toBe(false);
});

test('stability: low layout shift on key pages and reduced motion is honoured', async ({ page }) => {
  for (const path of ['/', '/products/support', '/products/business-intelligence']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) total += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
          setTimeout(() => resolve(total), 300);
        }),
    );
    expect(cls, `CLS on ${path}`).toBeLessThan(0.1);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const dur = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dur-3').trim());
  expect(dur).toBe('0ms');
});

test('keyboard: tabs switch with arrow keys and focus is visible', async ({ page }) => {
  await page.goto('/products/support');
  await page.getByTestId('demo-button').click();
  const first = page.getByRole('tab').first();
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab').nth(1)).toBeFocused();
  await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  const outline = await page.getByRole('tab').nth(1).evaluate((el) => getComputedStyle(el).boxShadow + getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('nonenone');
});

test('large data: 50 000 leads import and stay responsive (windowed table)', async ({ page }) => {
  test.setTimeout(120_000);
  const rows = ['Имя;Email;Телефон;Компания;Город;Источник'];
  for (let i = 0; i < 50_000; i++) rows.push(`Клиент ${i};client${i}@example.ru;+7 900 ${String(i).padStart(7, '0').replace(/(\d{3})(\d{2})(\d{2})/, '$1-$2-$3')};Компания ${i % 900};Город ${i % 40};сайт`);
  await page.goto('/products/lead-engine');
  const t0 = Date.now();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
  await page.getByTestId('mapping-confirm').click();
  await expect(page.getByRole('tab', { name: /^Лиды/ })).toContainText('50', { timeout: 60_000 });
  const elapsed = Date.now() - t0;
  // eslint-disable-next-line no-console -- surfaced in the test report
  console.log(`50k leads imported and scored in ${elapsed} ms`);
  const renderedRows = await page.locator('tbody tr').count();
  expect(renderedRows).toBeLessThan(500);
  await page.getByLabel('Поиск лидов').fill('Клиент 49999');
  await expect(page.locator('tbody tr')).toHaveCount(1, { timeout: 10_000 });
});
