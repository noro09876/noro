import { expect, type Page, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/** Fails the test on page errors, console errors and any request leaving the origin. */
export function guard(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://localhost:') && !u.startsWith('data:') && !u.startsWith('blob:')) problems.push(`external request: ${u}`);
  });
  return {
    problems,
    assertClean: () => expect(problems, problems.join('\n')).toEqual([]),
  };
}

export async function openProduct(page: Page, slug: string) {
  await page.goto(`/products/${slug}`);
  await expect(page.locator('section.app')).toBeVisible();
}

export async function loadDemo(page: Page) {
  await page.getByTestId('demo-button').click();
  await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 20_000 });
}

export const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });

export async function downloadText(page: Page, trigger: () => Promise<unknown>): Promise<{ name: string; text: string }> {
  const [dl] = (await Promise.all([page.waitForEvent('download'), trigger()])) as [Download, unknown];
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: await readFile(path, 'utf-8') };
}

/** Waits until debounced IndexedDB writes have flushed, then reloads. */
export async function reloadPersisted(page: Page) {
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.locator('section.app')).toBeVisible();
}
