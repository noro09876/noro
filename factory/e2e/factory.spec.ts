import { expect, test, type Page } from '@playwright/test';

/** No horizontal page scroll at the current viewport. */
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'horizontal overflow').toBeLessThanOrEqual(1);
}

async function go(page: Page, label: RegExp) {
  const burger = page.getByRole('button', { name: 'Меню' });
  if (await burger.isVisible()) await burger.click();
  await page.getByRole('link', { name: label }).first().click();
}

test('brief → strategy → content → approval → platform versions', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const email = `e2e-${info.project.name}-${Date.now()}@example.com`;

  // Sign up
  await page.goto('/signup');
  await page.getByLabel('Имя').fill('Проверка');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('e2e-password-123');
  await page.getByRole('button', { name: /Создать|Зарегистр/ }).click();
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();
  await expect(page.getByText('Запуск фабрики')).toBeVisible();
  await noOverflow(page);

  // Brand
  await go(page, /Brand Studio/);
  await page.getByLabel('Название', { exact: true }).fill('E2E Бренд');
  await page.getByLabel('Тон коммуникации').fill('Коротко и по делу');
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  await expect(page.getByText(/сохран/i).first()).toBeVisible();
  await noOverflow(page);

  // Labelled test provider (no paid keys in CI)
  await go(page, /Настройки/);
  const card = page.locator('.card.card-pad').filter({ hasText: 'Тестовый провайдер (не ИИ)' });
  await expect(card.getByText('ТЕСТ · не ИИ')).toBeVisible();
  await card.getByRole('button', { name: 'Включить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(card.getByText('по умолчанию')).toBeVisible();
  await noOverflow(page);

  // Campaign
  await go(page, /Кампании/);
  await page.getByRole('link', { name: /Новая кампания/ }).first().click();
  await expect(page.getByText(/тестовый провайдер/i).first()).toBeVisible();
  await page.getByLabel('Название кампании').fill('E2E кампания');
  await page.getByLabel('Задача').fill('Рассказать о новом отчёте и пригласить на демо-доступ');
  await page.getByLabel('Аудитория').fill('Селлеры маркетплейсов');
  await page.getByLabel(/^Цель/).fill('Заявки на демо');
  await page.getByLabel('Публикаций в неделю').fill('2');
  await page.getByLabel('Недель').fill('1');
  await page.getByRole('button', { name: 'Создать и построить стратегию' }).click();

  // Pipeline runs in the worker; the rail reflects real statuses.
  await expect(page.getByText(/Стратегия готова/)).toBeVisible({ timeout: 60_000 });
  const firstItem = page.locator('a[href*="/items/"]').first();
  await expect(firstItem).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Готов').first()).toBeVisible({ timeout: 60_000 });
  await noOverflow(page);

  // Item: test content is labelled, then review and approve.
  await firstItem.click();
  await expect(page.getByText('Эта версия создана тестовым провайдером')).toBeVisible();
  await page.getByRole('button', { name: 'На согласование' }).click();
  await page.getByRole('button', { name: 'Согласовать' }).click();
  await expect(page.getByText('Согласован').first()).toBeVisible();

  // Platform versions: without a connected account nothing can be published.
  await page.getByRole('tab', { name: /Площадки/ }).or(page.getByRole('button', { name: /Площадки/ })).first().click();
  await page.getByRole('button', { name: 'Подготовить', exact: true }).click();
  await expect(page.getByText(/Telegram/).first()).toBeVisible();
  await noOverflow(page);

  // Calendar and journal reflect the work.
  await go(page, /Календарь/);
  await noOverflow(page);
  await go(page, /Журнал/);
  await expect(page.getByText(/согласован/i).first()).toBeVisible();
  await noOverflow(page);

  expect(errors).toEqual([]);
});

test('rejects state-changing API calls without the CSRF header', async ({ request }) => {
  const r = await request.post('/api/auth/login', { data: { email: 'a@b.c', password: 'x' } });
  expect(r.status()).toBe(403);
});
