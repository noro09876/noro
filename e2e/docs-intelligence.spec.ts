import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { downloadText, guard, loadDemo, openProduct, reloadPersisted, tab } from './helpers';

test('Docs Intelligence: demo → checks → edit field with undo → own rule → export → persistence → reset', async ({ page }) => {
  const g = guard(page);
  await openProduct(page, 'docs-intelligence');
  await loadDemo(page);
  await expect(page.getByTestId('doc-item')).toHaveCount(4);

  await page.getByTestId('doc-item').filter({ hasText: 'invoice' }).first().click();
  await expect(page.getByTestId('doc-checks')).toBeVisible();
  const inn = page.getByTestId('field-sellerInn');
  await expect(inn).toHaveValue('7708123450');
  const errorsBefore = await page.getByTestId('doc-errors').textContent();

  // breaking the INN checksum is caught; undo restores it
  await inn.fill('7708123451');
  await inn.press('Enter');
  await expect(page.getByTestId('doc-errors')).not.toHaveText(errorsBefore ?? '');
  await expect(page.getByTestId('field-sellerInn')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Отменить' }).first().click();
  await expect(page.getByTestId('field-sellerInn')).toHaveValue('7708123450');
  await expect(page.getByTestId('doc-errors')).toHaveText(errorsBefore ?? '');

  await page.getByTestId('doc-status').selectOption({ index: 1 });

  // custom field rule
  await tab(page, 'Свои поля').click();
  await page.getByTestId('rule-label').fill('Ответственный');
  await page.getByTestId('rule-keyword').fill('Руководитель');
  await page.getByTestId('rule-add').click();
  await expect(tab(page, 'Свои поля')).toContainText('1');

  await tab(page, 'Документы').click();
  const csv = await downloadText(page, () => page.getByTestId('export-fields').click());
  expect(csv.name).toMatch(/\.csv$/);
  expect(csv.text).toContain('7708123450');

  await reloadPersisted(page);
  await expect(page.getByTestId('doc-item')).toHaveCount(4);
  await expect(tab(page, 'Свои поля')).toContainText('1');

  await page.getByRole('button', { name: /Сбросить/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Удалить|Сбросить/ }).click();
  await expect(page.getByTestId('demo-button')).toBeVisible();
  g.assertClean();
});

test('Docs Intelligence: a real PDF is parsed in the browser; pasted text works; a fake PDF is rejected', async ({ page }) => {
  const g = guard(page);
  await openProduct(page, 'docs-intelligence');
  const pdf = readFileSync('public/demo/invoice-418.pdf');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'my-invoice.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByTestId('doc-item')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId('field-sellerInn')).toHaveValue('7708123450');

  await page.getByRole('button', { name: /Вставить текст/ }).click();
  await page.getByRole('dialog').getByLabel('Текст документа').fill(readFileSync('public/demo/act-112.txt', 'utf-8'));
  await page.getByRole('button', { name: 'Разобрать' }).click();
  await expect(page.getByTestId('doc-item')).toHaveCount(2);

  await page.locator('input[type=file]').first().setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello, I am not a pdf') });
  await expect(page.locator('[role="status"], [role="alert"]').filter({ hasText: /PDF|прочитать|файл/i }).first()).toBeVisible();
  await expect(page.getByTestId('doc-item')).toHaveCount(2);
  g.assertClean();
});
