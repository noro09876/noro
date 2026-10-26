import { expect, test } from '@playwright/test';
import { downloadText, guard, loadDemo, openProduct, reloadPersisted, tab } from './helpers';

test('Lead Engine: demo → normalize → undo → scoring → export → persistence → reset', async ({ page }) => {
  const g = guard(page);
  await openProduct(page, 'lead-engine');
  await loadDemo(page);
  await expect(tab(page, 'Лиды')).toContainText('64');

  // quality: normalize, then undo via the header button, then redo by normalizing again
  await tab(page, 'Качество').click();
  const normalize = page.getByTestId('normalize-all');
  await expect(normalize).toBeEnabled();
  await normalize.click();
  await expect(normalize).toBeDisabled();
  await page.getByRole('button', { name: 'Отменить', exact: false }).first().click();
  await expect(normalize).toBeEnabled();
  await normalize.click();
  await expect(normalize).toBeDisabled();

  // duplicates
  const merge = page.getByTestId('merge-all');
  if (await merge.isEnabled()) {
    await merge.click();
    await expect(merge).toBeDisabled();
  }

  // scoring: changing points changes the average
  await tab(page, 'Скоринг').click();
  const avg = page.getByTestId('avg-score');
  const before = await avg.textContent();
  const firstPoints = page.locator('[data-testid^="points-"]').first();
  await firstPoints.fill('60');
  await expect(avg).not.toHaveText(before ?? '');

  // leads: filter and export
  await tab(page, 'Лиды').click();
  await page.getByLabel('Поиск лидов').fill('zzzz-no-match');
  await expect(page.getByTestId('export-leads')).toBeDisabled();
  await page.getByLabel('Поиск лидов').fill('');
  const { name, text } = await downloadText(page, () => page.getByTestId('export-leads').click());
  expect(name).toMatch(/\.csv$/);
  expect(text.split('\n')[0]).toMatch(/Имя|name/i);
  expect(text.trim().split('\n').length).toBeGreaterThan(10);

  // messages export
  await tab(page, 'Сообщения').click();
  const msgs = await downloadText(page, () => page.getByTestId('export-messages').click());
  expect(msgs.text.length).toBeGreaterThan(100);

  // persistence
  const leadsTabText = await tab(page, 'Лиды').textContent();
  await reloadPersisted(page);
  await expect(tab(page, 'Лиды')).toHaveText(leadsTabText ?? '');
  await tab(page, 'Качество').click();
  await expect(page.getByTestId('normalize-all')).toBeDisabled();

  // reset with confirmation
  await page.getByRole('button', { name: /Сбросить/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByTestId('demo-button')).toBeVisible();
  await reloadPersisted(page);
  await expect(page.getByTestId('demo-button')).toBeVisible();
  g.assertClean();
});

test('Lead Engine: own CSV upload goes through column mapping; a broken file shows an error', async ({ page }) => {
  await openProduct(page, 'lead-engine');
  const csv = 'ФИО;Почта;Тел;Фирма;Город\nИванова Мария;MARIA@Example.com;8 (916) 123-45-67;ООО Ромашка;москва\nПетров Пётр;petrov@test.ru;+7 903 000 11 22;АО Вектор;Казань\n';
  await page.locator('input[type=file]').first().setInputFiles({ name: 'my-leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('mapping-confirm').click();
  await expect(tab(page, 'Лиды')).toContainText('2');
  await expect(page.locator('section.app')).toContainText('my-leads.csv');

  await page.getByRole('button', { name: /Сбросить/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByTestId('demo-button')).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'broken.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('not a zip') });
  await expect(page.locator('[role="status"], [role="alert"]').filter({ hasText: /файл|прочитать|формат/i }).first()).toBeVisible();
  await expect(page.getByTestId('demo-button')).toBeVisible();
});

test('Lead Engine: an edit survives an immediate reload and in-app navigation', async ({ page }) => {
  await openProduct(page, 'lead-engine');
  await loadDemo(page);
  await page.waitForTimeout(800);
  await tab(page, 'Скоринг').click();
  const points = page.locator('[data-testid^="points-"]').first();
  await points.fill('77');
  await page.reload();
  await tab(page, 'Скоринг').click();
  await expect(page.locator('[data-testid^="points-"]').first()).toHaveValue('77');

  await page.locator('[data-testid^="points-"]').first().fill('33');
  await page.locator('header a[href="/"]').first().click();
  await expect(page).toHaveURL('/');
  await page.goBack();
  await tab(page, 'Скоринг').click();
  await expect(page.locator('[data-testid^="points-"]').first()).toHaveValue('33');
});
