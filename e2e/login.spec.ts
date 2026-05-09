import { test, expect, Page } from '@playwright/test';

/**
 * Login / Landing page coverage.
 *
 * Focused on UI behaviour that doesn't require a real Supabase account:
 *   - form rendering, field-level validation, navigation links, theme toggle
 *   - the wrong-credentials error path (Supabase WILL respond, but the
 *     response is deterministic for invented emails)
 *
 * The "successful login" happy path is intentionally NOT covered here —
 * that requires a real test user in Supabase, which is owned by a separate
 * seed-data setup, not the per-test fixture.
 */

/** Land on the marketing page without opening the login modal. The FUI
 *  upgrade tucked the login form behind a `Login` CTA so the marketing
 *  hero stays the dominant element until the user opts in. */
async function gotoLanding(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('open-login-btn')).toBeVisible();
}

/** Pop the login modal — required before interacting with any login-* testid. */
async function openLoginModal(page: Page) {
  await gotoLanding(page);
  await page.getByTestId('open-login-btn').click();
  await expect(page.getByTestId('login-btn')).toBeVisible();
}

test.describe('Login — page render', () => {
  test('landing page shows the open-login CTA', async ({ page }) => {
    await gotoLanding(page);
    await expect(page.getByTestId('open-login-btn')).toBeVisible();
  });

  test('login modal exposes email + password fields and the login button', async ({ page }) => {
    await openLoginModal(page);
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });

  test('IronTrack branding and tagline are visible', async ({ page }) => {
    await gotoLanding(page);
    await expect(page.getByText(/Iron/, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/Unified Training Management System/i)).toBeVisible();
  });

  test('Sign Up and Forgot Password links are present inside the login modal', async ({ page }) => {
    await openLoginModal(page);
    await expect(page.getByTestId('goto-signup-btn')).toBeVisible();
    await expect(page.getByTestId('goto-forgot-btn')).toBeVisible();
  });
});

test.describe('Login — validation', () => {
  test('malformed email shows the format error and never fires the auth request', async ({ page }) => {
    await openLoginModal(page);

    // Fail the test if any /auth/v1/token network call leaves the page —
    // the format guard must short-circuit before that.
    let authCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/auth/v1/token')) authCalled = true;
    });

    await page.getByTestId('login-email').fill('not-an-email');
    await page.getByTestId('login-password').fill('Whatever1');
    await page.getByTestId('login-btn').click();

    await expect(page.getByTestId('login-format-error')).toBeVisible();
    await expect(page.getByText(/valid email address/i)).toBeVisible();
    expect(authCalled).toBe(false);
  });

  test('wrong credentials surface the friendly "Invalid email or password" message', async ({ page }) => {
    await openLoginModal(page);
    await page.getByTestId('login-email').fill(`nobody+${Date.now()}@example.com`);
    await page.getByTestId('login-password').fill('SomePass1');
    await page.getByTestId('login-btn').click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 10_000 });
    // Stay on the login form — no navigation away.
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });
});

test.describe('Login — navigation', () => {
  test('clicking "Sign Up" routes to the signup form', async ({ page }) => {
    await openLoginModal(page);
    await page.getByTestId('goto-signup-btn').click();
    await expect(page.getByTestId('signup-name')).toBeVisible();
    await expect(page.getByTestId('signup-submit-btn')).toBeVisible();
  });

  test('clicking "Forgot Password" routes to the reset flow', async ({ page }) => {
    await openLoginModal(page);
    await page.getByTestId('goto-forgot-btn').click();
    await expect(page.getByTestId('forgot-email')).toBeVisible();
    await expect(page.getByTestId('forgot-email-submit')).toBeVisible();
  });
});

test.describe('Login — theme toggle', () => {
  test('theme toggle flips the <html> class between dark and light', async ({ page }) => {
    await gotoLanding(page);
    const initialClass = await page.evaluate(() => document.documentElement.className);
    const initialIsDark = initialClass.includes('dark');

    // Theme toggle is the last button in the nav (sun/moon icon, no testid).
    // The first nav button is now the open-login CTA after the FUI upgrade.
    await page.locator('nav button[aria-label="Toggle theme"]').click();

    const flipped = await page.evaluate(() => document.documentElement.className);
    if (initialIsDark) {
      expect(flipped).toContain('light');
      expect(flipped).not.toContain('dark');
    } else {
      expect(flipped).toContain('dark');
    }
  });
});
