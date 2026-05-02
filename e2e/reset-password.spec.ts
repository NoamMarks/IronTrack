import { test, expect, Page } from '@playwright/test';

/**
 * Reset Password (Forgot Password) flow coverage.
 *
 * supabase.auth.resetPasswordForEmail intentionally returns success for
 * unknown emails to prevent enumeration — so the "sent" state is what we
 * assert regardless of whether the address exists.
 */

async function gotoReset(page: Page) {
  await page.goto('/');
  await page.getByTestId('goto-forgot-btn').click();
  await expect(page.getByTestId('forgot-email')).toBeVisible();
}

test.describe('Reset Password — page render', () => {
  test('reset page exposes the email field, submit button, and back link', async ({ page }) => {
    await gotoReset(page);
    await expect(page.getByTestId('forgot-email')).toBeVisible();
    await expect(page.getByTestId('forgot-email-submit')).toBeVisible();
    await expect(page.getByTestId('forgot-back-btn')).toBeVisible();
  });

  test('heading reads "Reset Password" and subtitle prompts for an email', async ({ page }) => {
    await gotoReset(page);
    await expect(page.getByRole('heading', { name: /reset password/i })).toBeVisible();
    await expect(page.getByText(/Enter your email to receive a reset link/i)).toBeVisible();
  });
});

test.describe('Reset Password — validation', () => {
  test('submit is disabled while the email field is empty', async ({ page }) => {
    await gotoReset(page);
    await expect(page.getByTestId('forgot-email-submit')).toBeDisabled();
  });

  test('a malformed email surfaces the format error and never advances', async ({ page }) => {
    await gotoReset(page);

    let resetCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/auth/v1/recover')) resetCalled = true;
    });

    await page.getByTestId('forgot-email').fill('not-an-email');
    await page.getByTestId('forgot-email-submit').click();
    await expect(page.getByTestId('forgot-email-error')).toBeVisible();
    await expect(page.getByText(/valid email address/i)).toBeVisible();
    expect(resetCalled).toBe(false);
    // Still on the email step.
    await expect(page.getByTestId('forgot-sent-state')).toHaveCount(0);
  });
});

test.describe('Reset Password — happy path UX', () => {
  test('a valid email transitions to the "sent" confirmation state', async ({ page }) => {
    await gotoReset(page);

    const email = `reset+${Date.now()}@example.com`;
    await page.getByTestId('forgot-email').fill(email);
    await page.getByTestId('forgot-email-submit').click();

    await expect(page.getByTestId('forgot-sent-state')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(new RegExp(email.replace(/[.+]/g, '\\$&'), 'i'))).toBeVisible();
    await expect(page.getByText(/link expires in 1 hour/i)).toBeVisible();
  });

  test('the "sent" state offers a back-to-login button that returns to the login form', async ({ page }) => {
    await gotoReset(page);
    await page.getByTestId('forgot-email').fill(`back+${Date.now()}@example.com`);
    await page.getByTestId('forgot-email-submit').click();
    await expect(page.getByTestId('forgot-sent-state')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('forgot-back-to-login').click();
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });
});

test.describe('Reset Password — navigation', () => {
  test('the top "Back to Login" link returns to the landing form', async ({ page }) => {
    await gotoReset(page);
    await page.getByTestId('forgot-back-btn').click();
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });
});
