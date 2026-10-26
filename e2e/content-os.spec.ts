import { expect, test } from '@playwright/test';
import { downloadText, guard, openProduct, reloadPersisted, tab } from './helpers';

test('Content OS: demo package → edit with versions → length check → calendar → export → persistence', async ({ page }) => {
  const g = guard(page);
  await openProduct(page, 'content-os');
  await page.getByTestId('demo-button').click();
  await expect(tab(page, 'Материалы')).toBeVisible();
  await expect(page.getByTestId('co-theses').locator('li').first()).toBeVisible();

  // edit the Telegram draft and save a version
  await page.getByTestId('co-item-telegram').click();
  const body = page.getByTestId('co-body');
  await body.fill('Короткий тестовый пост для проверки версий.');
  await page.getByTestId('co-save').click();
  await expect(page.getByTestId('co-history')).toBeEnabled();
  await expect(page.getByTestId('co-length')).toBeVisible();

  // over-limit text is flagged
  await body.fill('Очень длинный текст. '.repeat(400));
  await expect(page.getByTestId('co-length')).toHaveClass(/co-len--(over|error|bad|critical)/);
  await body.fill('Короткий тестовый пост для проверки версий.');

  await page.getByTestId('co-status').selectOption({ index: 1 });

  // calendar: pick the item and move it
  await tab(page, 'Календарь').click();
  await page.locator('.cal__item').first().click();
  const date = page.getByTestId('cal-date');
  await date.fill('2026-12-01');
  await expect(date).toHaveValue('2026-12-01');

  // export markdown
  const md = await downloadText(page, () => page.getByTestId('co-export-md').click());
  expect(md.name).toMatch(/\.md$/);
  expect(md.text).toContain('Короткий тестовый пост');

  await reloadPersisted(page);
  await tab(page, 'Материалы').click();
  await page.getByTestId('co-item-telegram').click();
  await expect(page.getByTestId('co-body')).toHaveValue('Короткий тестовый пост для проверки версий.');
  g.assertClean();
});

test('Content OS: own text is validated and turned into drafts', async ({ page }) => {
  await openProduct(page, 'content-os');
  await page.getByRole('button', { name: 'Вставить текст вручную' }).click();
  const src = page.getByTestId('co-source');
  await src.fill('Слишком коротко.');
  await page.getByTestId('co-build').click();
  await expect(src).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.field__error').first()).toBeVisible();
  const text = Array.from({ length: 6 }, (_, i) => `Абзац ${i + 1}. Складской учёт в небольшой пекарне держится на ежедневной инвентаризации муки, масла и упаковки. Когда остатки сверяются раз в неделю, закупки опаздывают и часть продукции не выходит в продажу.`).join('\n\n');
  await src.fill(text);
  await page.getByTestId('co-build').click();
  await expect(tab(page, 'Материалы')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid^="co-item-"]').first()).toBeVisible();
});
