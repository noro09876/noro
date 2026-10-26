import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { downloadText, guard, loadDemo, openProduct, reloadPersisted, tab } from './helpers';

test('Catalog Studio: issues → rules preview/apply → undo/redo → edit product → export → persistence → reset', async ({ page }) => {
  const g = guard(page);
  await openProduct(page, 'catalog-studio');
  await loadDemo(page);
  const errors = page.getByTestId('cs-errors');
  const initialErrors = Number(await errors.textContent());
  expect(initialErrors).toBeGreaterThan(0);

  // rules: preview shows a diff before anything changes
  await tab(page, 'Правила').click();
  await page.getByTestId('rules-preview').click();
  await expect(page.getByTestId('rules-diff')).toBeVisible();
  await page.getByTestId('rules-apply').click();

  await tab(page, 'Проблемы').click();
  const afterRules = Number(await errors.textContent());
  expect(afterRules).toBeLessThanOrEqual(initialErrors);

  // undo / redo of a bulk operation
  const problemsTab = await tab(page, 'Проблемы').textContent();
  await page.getByTestId('cs-undo').click();
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(tab(page, 'Проблемы')).toHaveText(problemsTab ?? '');

  // drill into an issue kind and edit a product
  await page.locator('[data-testid^="issue-"]').first().click();
  await expect(tab(page, 'Товары')).toHaveAttribute('aria-selected', 'true');
  await page.locator('tbody tr').first().click();
  const name = page.getByTestId('product-name');
  await name.fill('Тестовый товар NORO');
  await page.getByTestId('product-save').click();

  const csv = await downloadText(page, () => page.getByTestId('cs-export').click());
  expect(csv.name).toMatch(/\.csv$/);
  expect(csv.text).toContain('Тестовый товар NORO');

  await reloadPersisted(page);
  await tab(page, 'Товары').click();
  await page.getByLabel('Поиск товаров').fill('Тестовый товар NORO');
  await expect(page.locator('tbody tr')).toHaveCount(1);

  await page.getByRole('button', { name: 'Сбросить данные' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Удалить|Сбросить/ }).click();
  await expect(page.getByTestId('demo-button')).toBeVisible();
  g.assertClean();
});

test('Catalog Studio: own XLSX goes through mapping', async ({ page }) => {
  const g = guard(page);
  await openProduct(page, 'catalog-studio');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'price.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync('src/test/fixtures/catalog-small.xlsx') });
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('mapping-confirm').click();
  await expect(tab(page, 'Товары')).toBeVisible();
  await expect(page.locator('section.app')).toContainText('price.xlsx');
  g.assertClean();
});
