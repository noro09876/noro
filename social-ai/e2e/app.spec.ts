import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'e2e-password-123';
const TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghijk';

test.describe.configure({ mode: 'serial' });

let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});

test.afterAll(() => {
  expect(errors, 'no JS errors in the console').toEqual([]);
});

test('first run: create admin', async () => {
  await page.goto('/');
  await expect(page.getByText('Первый запуск')).toBeVisible();
  const pw = page.locator('input[autocomplete=new-password]');
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Создать и войти' }).click();
  await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();
  await expect(page.getByText('Языковая модель не подключена')).toBeVisible();
});

test('settings: discover Ollama models and pick one', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Проверить сервер и список моделей' }).click();
  await expect(page.getByText('Сервер доступен, моделей: 1')).toBeVisible();
  await page.getByRole('combobox').first().selectOption('qwen2.5:7b');
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  await expect(page.getByText('Настройки сохранены')).toBeVisible();
  await page.getByRole('button', { name: 'Тестовый запрос' }).click();
  await expect(page.getByText(/Модель ответила за/)).toBeVisible();
});

test('accounts: connect Telegram with a bot token', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Аккаунты' }).click();
  await page.locator('section', { hasText: 'Бесплатно (Telegram Bot API)' }).getByRole('button', { name: 'Подключить' }).click();
  await page.getByLabel('Токен бота').fill(TOKEN);
  await page.getByLabel('Канал или чат').fill('@noro_test');
  await page.getByRole('button', { name: 'Подключить и проверить' }).click();
  await expect(page.getByText('Аккаунт подключён и проверен')).toBeVisible();
  await expect(page.locator('tbody').getByText('Подключён')).toBeVisible();
  expect(await page.content()).not.toContain('AAFakeToken');
});

test('content: generate a carousel, browse slides, edit, approve and publish', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Контент' }).click();
  await page.getByRole('button', { name: 'Создать' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Сгенерировать', exact: true }).click();
  await expect(page).toHaveURL(/\/content\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Слайды' })).toBeVisible();
  await expect(page.locator('.thumbs button')).toHaveCount(6);
  await page.getByRole('button', { name: 'Следующий слайд' }).click();
  await expect(page.locator('.slide-view img')).toHaveAttribute('alt', 'Слайд 2');
  await page.locator('.thumbs button').nth(4).click();
  await expect(page.locator('.slide-view img')).toHaveAttribute('alt', 'Слайд 5');

  await page.getByPlaceholder('Заголовок слайда').nth(1).fill('Ответ на заявку дольше часа — тревожный знак');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText(/Сохранено/)).toBeVisible();

  await page.getByRole('button', { name: 'Проверить и подтвердить' }).click();
  await expect(page.getByText('Проверка пройдена, материал готов')).toBeVisible();
  await page.getByRole('button', { name: 'Опубликовать сейчас' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click();
  await expect(page.getByText('Опубликовано: 1')).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'Опубликован' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть' })).toHaveAttribute('href', /t\.me\/noro_test/);
});

test('content: schedule a manual post and move it in the calendar', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Контент' }).click();
  await page.getByRole('button', { name: 'Создать' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Написать вручную' }).click();
  await dlg.getByRole('button', { name: 'Пост' }).click();
  await dlg.getByLabel('Заголовок').fill('Как проверить идею автоматизации за неделю');
  await dlg.getByRole('button', { name: 'Создать черновик' }).click();
  await expect(page).toHaveURL(/\/content\/\d+$/);
  await page.getByLabel(/Основной текст/).fill('Выберите один процесс, опишите шаги, автоматизируйте самый рутинный из них и сравните время до и после. Неделя наблюдения покажет, стоит ли продолжать.');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText(/Сохранено/)).toBeVisible();
  await page.getByRole('button', { name: 'Проверить и подтвердить' }).click();
  await expect(page.getByText('Проверка пройдена, материал готов')).toBeVisible();
  await page.getByRole('button', { name: 'Запланировать' }).click();
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  await page.getByRole('dialog').getByLabel('Дата').fill(tomorrow);
  await page.getByRole('dialog').getByLabel('Время').fill('15:30');
  await page.getByRole('dialog').getByRole('button', { name: 'Запланировать' }).click();
  await expect(page.getByText('Публикация запланирована')).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Календарь' }).click();
  await page.getByRole('button', { name: 'Неделя' }).click();
  const ev = page.locator('.cal-ev', { hasText: 'Как проверить идею' });
  await expect(ev).toBeVisible();
  await expect(ev).toContainText('15:30');
  await ev.click();
  await page.getByRole('dialog').getByLabel('Время').fill('17:45');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить время' }).click();
  await expect(page.getByText('Время изменено')).toBeVisible();
  await expect(page.locator('.cal-ev', { hasText: 'Как проверить идею' })).toContainText('17:45');
  await page.getByRole('button', { name: 'Месяц' }).click();
  await expect(page.locator('.cal-ev', { hasText: 'Как проверить идею' })).toBeVisible();
  await page.getByRole('button', { name: 'День' }).click();
});

test('agent: plan, run a cycle and switch on', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'ИИ-агент' }).click();
  await page.getByRole('button', { name: 'Дополнить план' }).click();
  await expect(page.getByText('План обновлён')).toBeVisible();
  await expect(page.locator('tbody tr').first()).toContainText('Идея');
  await page.locator('label.switch', { hasText: 'Агент выключен' }).click();
  await expect(page.getByText('Агент включён')).toBeVisible();
  await expect(page.locator('.sidebar').getByText('Агент работает')).toBeVisible();
  await page.getByRole('button', { name: 'Запустить цикл сейчас' }).click();
  await expect(page.getByText(/Цикл:/)).toBeVisible();
  await page.getByRole('tab', { name: 'История действий' }).click();
  await expect(page.getByText(/Создан материал/).first()).toBeVisible();
});

test('analytics, journal and dashboard show real data only', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Аналитика' }).click();
  await expect(page.getByText('Здесь только реальные данные')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('navigation').getByRole('link', { name: 'Журнал' }).click();
  await expect(page.getByText(/Опубликовано в Telegram/).first()).toBeVisible();
  expect(await page.content()).not.toContain('AAFakeToken');
  await page.getByRole('navigation').getByRole('link', { name: 'Главная' }).click();
  await expect(page.getByText('Опубликовано за 7 дней')).toBeVisible();
  await expect(page.locator('.stat-value').nth(1)).toHaveText('1');
});

test('mobile layout has no horizontal overflow', async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['/', '/accounts', '/content', '/calendar', '/agent', '/analytics', '/journal', '/settings']) {
    await page.goto(path);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
  await page.getByRole('button', { name: 'Меню' }).click();
  await expect(page.locator('.sidebar.open')).toBeVisible();
});
