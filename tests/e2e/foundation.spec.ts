import { expect, test } from '@playwright/test';

test('student landing omits diagnostics while the API proxy is checked independently', async ({ page, request }, testInfo) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Connect concepts. Build understanding.' })).toBeVisible();
  await expect(page.getByText(/project foundation|local connection|API connected|check connection|later stages/i)).toHaveCount(0);
  await expect(page.getByText(/Supabase|local server/i)).toHaveCount(0);
  await expect(page.locator('[data-slot="card"]').first()).toHaveCSS('background-color', 'rgb(27, 35, 55)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('foundation.png'), fullPage: true });
});

test('unknown SPA paths can return to the student landing screen', async ({ page }) => {
  await page.goto('/missing-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to LearningCompanion' }).click();
  await expect(page.getByRole('heading', { name: 'Connect concepts. Build understanding.' })).toBeVisible();
});
