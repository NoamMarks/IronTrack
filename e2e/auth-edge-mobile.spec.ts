import { test, expect, devices, Page } from '@playwright/test';
import { installMockSupabase, defaultMockState } from './fixtures/mockSupabase';

/**
 * Mobile viewport sub-suite. Lives in its own file because Playwright
 * forces a new worker whenever `defaultBrowserType` (which devices.iPhone12
 * carries) is set, and that's only legal at file scope.
 */

test.use({ ...devices['iPhone 12'] });

async function buttonOnScreen(page: Page, locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  if (!box) return false;
  const viewport = page.viewportSize();
  if (!viewport) return false;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return centerX > 0 && centerX < viewport.width && centerY > 0 && centerY < viewport.height;
}

test.describe('Mobile — critical buttons stay reachable on iPhone 12', () => {
  test('login form is usable on mobile (email, password, submit all on-screen)', async ({ page }) => {
    await page.goto('/');
    expect(await buttonOnScreen(page, page.getByTestId('login-email'))).toBe(true);
    expect(await buttonOnScreen(page, page.getByTestId('login-password'))).toBe(true);
    expect(await buttonOnScreen(page, page.getByTestId('login-btn'))).toBe(true);
  });

  test('logout (X) button is reachable in the AppShell nav on mobile', async ({ page }) => {
    await installMockSupabase(page, defaultMockState());
    await page.goto('/');
    const logoutBtn = page.locator('nav button').last();
    await expect(logoutBtn).toBeVisible({ timeout: 10_000 });
    expect(await buttonOnScreen(page, logoutBtn)).toBe(true);
  });

  test('signup submit stays on-screen even when validation errors push content down', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('goto-signup-btn').click();
    await page.getByTestId('signup-submit-btn').click();
    const submit = page.getByTestId('signup-submit-btn');
    await submit.scrollIntoViewIfNeeded();
    expect(await buttonOnScreen(page, submit)).toBe(true);
  });
});
