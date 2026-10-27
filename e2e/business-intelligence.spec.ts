import { expect, test } from '@playwright/test';
import { downloadText, guard, loadDemo, openProduct, reloadPersisted, tab } from './helpers';

test('BI: demo → period → cross-filter → anomalies → pivot → exports → persistence → reset', async ({ page }) => {
  const g = guard(page);
  await openProduct(page, 'business-intelligence');
  await loadDemo(page);
  const kpis = page.getByTestId('bi-kpis');
  await expect(kpis).toBeVisible();
  const kpi90 = await kpis.textContent();

  await page.getByTestId('preset-30').click();
  await expect(page.getByTestId('preset-30')).toHaveAttribute('aria-pressed', 'true');
  await expect(kpis).not.toHaveText(kpi90 ?? '');

  // cross-filter by clicking a bar, then clear it
  const kpiBefore = await kpis.textContent();
  await page.locator('.barlist__row').first().click();
  await expect(page.getByLabel('Активные фильтры')).toBeVisible();
  await expect(kpis).not.toHaveText(kpiBefore ?? '');
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(kpis).toHaveText(kpiBefore ?? '');

  await tab(page, 'Аномалии').click();
  await page.getByTestId('preset-all').click();
  await expect(page.getByTestId('anomaly-list')).toContainText('14.03');

  await tab(page, 'Таблица').click();
  await expect(page.locator('table').first()).toBeVisible();

  const csv = await downloadText(page, () => page.getByTestId('bi-export-csv').click());
  expect(csv.name).toMatch(/\.csv$/);
  const html = await downloadText(page, () => page.getByTestId('bi-export-html').click());
  expect(html.name).toMatch(/\.html$/);
  expect(html.text).toContain('<table');
  expect(html.text).not.toMatch(/<script/i);

  await reloadPersisted(page);
  await expect(page.getByTestId('preset-all')).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Сбросить данные' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Удалить|Сбросить/ }).click();
  await expect(page.getByTestId('demo-button')).toBeVisible();
  g.assertClean();
});

test('BI: own CSV with a date and amount works; a file without dates explains why', async ({ page }) => {
  await openProduct(page, 'business-intelligence');
  const rows = ['Дата;Сумма;Канал'];
  for (let d = 1; d <= 28; d++) rows.push(`${String(d).padStart(2, '0')}.02.2026;${1000 + d * 10};${d % 2 ? 'Сайт' : 'Маркетплейс'}`);
  await page.locator('input[type=file]').first().setInputFiles({ name: 'feb.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) await page.getByTestId('mapping-confirm').click();
  await expect(page.getByTestId('bi-kpis')).toBeVisible();
  await expect(page.locator('section.app')).toContainText('feb.csv');

  await page.getByRole('button', { name: 'Сбросить данные' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Удалить|Сбросить/ }).click();
  await expect(page.getByTestId('demo-button')).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'nodates.csv', mimeType: 'text/csv', buffer: Buffer.from('Имя;Город\nА;Москва\nБ;Казань\n') });
  await expect(page.locator('[role="status"], [role="alert"], [role="dialog"]').filter({ hasText: /дат/i }).first()).toBeVisible();
});
