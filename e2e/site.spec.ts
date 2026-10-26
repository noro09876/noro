import { expect, test } from '@playwright/test';
import { guard } from './helpers';

const PRODUCTS = ['lead-engine', 'support', 'content-os', 'docs-intelligence', 'catalog-studio', 'business-intelligence'];

test('home page renders all sections and links to every product', async ({ page }) => {
  const g = guard(page);
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  for (const slug of PRODUCTS) await expect(page.locator(`a[href="/products/${slug}"]`).first()).toBeVisible();
  g.assertClean();
});

for (const slug of PRODUCTS) {
  test(`direct URL /products/${slug} returns 200 with its own meta`, async ({ page, request }) => {
    const res = await request.get(`/products/${slug}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain(`og:url`);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    const g = guard(page);
    await page.goto(`/products/${slug}`);
    await expect(page.locator('section.app')).toBeVisible();
    await expect(page.locator('h1')).toBeVisible();
    g.assertClean();
  });
}

test('unknown URL gets a real 404 page', async ({ page, request }) => {
  const res = await request.get('/products/does-not-exist');
  expect(res.status()).toBe(404);
  await page.goto('/totally/unknown');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/не найдена|нет|404/i);
  await page.getByRole('link', { name: /на главную/i }).first().click();
  await expect(page).toHaveURL('/');
});

test('security headers and static SEO files are served', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
  expect(res.headers()['x-frame-options']).toBe('DENY');
  expect((await request.get('/robots.txt')).status()).toBe(200);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const slug of PRODUCTS) expect(sitemap).toContain(`/products/${slug}`);
  expect((await request.get('/og/noro.png')).status()).toBe(200);
});

test('order form preselects the product and shows an honest fallback when delivery is not configured', async ({ page }) => {
  await page.goto('/products/catalog-studio');
  const form = page.getByTestId('lead-form');
  await form.scrollIntoViewIfNeeded();
  await expect(form.locator('select').filter({ has: page.locator('option[value="catalog-studio"]') }).first()).toHaveValue('catalog-studio');
  await page.getByTestId('lead-submit').click();
  // validation errors first
  await expect(form.locator('[aria-invalid="true"]').first()).toBeVisible();
  await form.getByLabel('Как к вам обращаться').fill('Тест');
  await form.getByLabel('Контакт для ответа').fill('@test_user');
  await form.getByLabel('Что нужно автоматизировать').fill('Нужно чистить прайс поставщиков каждую неделю');
  await form.locator('input[type=checkbox][id$="-consent"]').check();
  await page.getByTestId('lead-submit').click();
  await expect(page.getByTestId('lead-fallback')).toBeVisible();
  await expect(page.getByTestId('lead-sent')).toHaveCount(0);
});
