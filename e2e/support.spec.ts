import { expect, test } from '@playwright/test';
import { downloadText, guard, loadDemo, openProduct, reloadPersisted, tab } from './helpers';

async function ask(page: import('@playwright/test').Page, q: string) {
  const before = await page.getByTestId('bot-answer').count();
  await page.getByTestId('chat-input').fill(q);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('bot-answer')).toHaveCount(before + 1);
  return page.getByTestId('bot-answer').last();
}

test('Support: grounded answers with sources, honest "no answer", escalation, own article, export, persistence', async ({ page }) => {
  const g = guard(page);
  await openProduct(page, 'support');
  await loadDemo(page);
  await tab(page, 'Чат').click();

  const a1 = await ask(page, 'Как вернуть товар, если прошло 10 дней?');
  await expect(a1).toHaveAttribute('data-kind', 'answer');
  await expect(a1).toContainText('Источники');

  const a2 = await ask(page, 'Есть ли у вас доставка дронами?');
  await expect(a2).toHaveAttribute('data-kind', 'insufficient');

  const a3 = await ask(page, 'Деньги списали дважды!! Срочно верните');
  await expect(a3).toHaveAttribute('data-kind', /escalate|answer/);

  // tickets were created for the unanswered/escalated questions
  await tab(page, 'Обращения').click();
  await page.getByRole('row').filter({ hasText: 'дронами' }).first().click();
  await expect(page.getByTestId('ticket-card')).toBeVisible();
  await page.getByTestId('ticket-status').selectOption({ index: 1 });
  const csv = await downloadText(page, () => page.getByTestId('export-tickets').click());
  expect(csv.name).toMatch(/\.csv$/);
  expect(csv.text).toContain('дронами');

  // add own article, then the bot can answer from it
  await tab(page, 'База знаний').click();
  await page.getByTestId('kb-new').click();
  await page.getByTestId('kb-title').fill('Доставка дронами');
  await page.getByTestId('kb-body').fill('Доставка дронами пока не работает. Мы тестируем доставку дронами в Казани, запуск планируется в следующем году. Сейчас доступны курьер и пункты выдачи.');
  await page.getByTestId('kb-save').click();
  await tab(page, 'Чат').click();
  const a4 = await ask(page, 'Есть ли у вас доставка дронами?');
  await expect(a4).toHaveAttribute('data-kind', 'answer');
  await expect(a4).toContainText('Доставка дронами');

  // the remote model is not configured here — the UI must say so instead of pretending
  await tab(page, 'Настройки').click();
  await expect(page.locator('section.app')).toContainText(/не настроен|недоступн|не подключ/i);

  await reloadPersisted(page);
  await tab(page, 'База знаний').click();
  await expect(page.locator('section.app')).toContainText('Доставка дронами');
  const kb = await downloadText(page, () => page.getByTestId('kb-export').click());
  expect(JSON.parse(kb.text)).toBeTruthy();

  await page.getByRole('button', { name: /Сбросить/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Удалить|Сбросить/ }).click();
  await expect(page.getByTestId('demo-button')).toBeVisible();
  g.assertClean();
});

test('Support: own knowledge base from a Markdown file', async ({ page }) => {
  await openProduct(page, 'support');
  const md = '# Гарантия\nГарантия на всю технику 12 месяцев с даты покупки. Для ремонта нужен чек.\n\n# Самовывоз\nСамовывоз со склада на Складской, 5 ежедневно с 9 до 21.';
  await page.locator('input[type=file]').first().setInputFiles({ name: 'kb.md', mimeType: 'text/markdown', buffer: Buffer.from(md) });
  await expect(tab(page, 'База знаний')).toContainText('2');
  await tab(page, 'Чат').click();
  await page.getByTestId('chat-input').fill('Сколько длится гарантия?');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('bot-answer').last()).toContainText('12 месяцев');
});
