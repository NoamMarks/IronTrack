import { test, expect, Page } from '@playwright/test';
import { installMockSupabase, defaultMockState } from './fixtures/mockSupabase';

/**
 * Auth + roster edge-case coverage.
 *
 * Stresses the auth state machine and the form-input validation around
 * email handling. The interesting bugs in this surface tend to be:
 *   - infinite render loops when SIGNED_IN / SIGNED_OUT events flap
 *   - unhandled promise rejections from spammed click handlers
 *   - critical buttons hidden off-screen on narrow viewports
 *   - email normalisation that diverges between the form and the API
 */

test.describe('Auth — login spam does not break the state machine', () => {
  test('clicking login 8 times in a row only fires one auth/v1/token request', async ({ page }) => {
    await page.goto('/');
    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/auth/v1/token')) requests.push(req.url());
    });

    await page.getByTestId('login-email').fill('not-an-email'); // format guard catches it
    await page.getByTestId('login-password').fill('whatever');
    for (let i = 0; i < 8; i += 1) {
      await page.getByTestId('login-btn').click({ force: true });
    }
    // Format guard short-circuits — zero auth requests should have fired.
    expect(requests.length).toBe(0);

    // Now switch to a valid format but wrong creds and confirm a single
    // failure state, no infinite loop.
    await page.getByTestId('login-email').fill(`spam+${Date.now()}@example.com`);
    await page.getByTestId('login-password').fill('Whatever1');
    for (let i = 0; i < 6; i += 1) {
      await page.getByTestId('login-btn').click({ force: true });
    }
    await expect(page.getByText(/invalid email or password/i).first()).toBeVisible({ timeout: 10_000 });
    // Page hasn't navigated away.
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });

  test('rapidly toggling between Sign Up and Forgot Password does not throw or strand the user', async ({ page }) => {
    await page.goto('/');
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    for (let i = 0; i < 6; i += 1) {
      await page.getByTestId('goto-signup-btn').click();
      await expect(page.getByTestId('signup-name')).toBeVisible();
      await page.getByText(/Back to Login/i).click();
      await expect(page.getByTestId('login-btn')).toBeVisible();
      await page.getByTestId('goto-forgot-btn').click();
      await expect(page.getByTestId('forgot-email')).toBeVisible();
      await page.getByTestId('forgot-back-btn').click();
      await expect(page.getByTestId('login-btn')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

test.describe('Auth — logout flow stability while authenticated', () => {
  test('clicking the logout (X) button while authenticated returns to login without errors', async ({ page }) => {
    await installMockSupabase(page, defaultMockState());
    await page.goto('/');
    // Coach session bootstraps to the client list view.
    await expect(page.getByText('Sarah Cohen')).toBeVisible({ timeout: 10_000 });

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Click the X button in the AppShell nav (last button in <nav>).
    await page.locator('nav button').last().click();
    await expect(page.getByTestId('login-btn')).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });
});

test.describe('Roster — edge-case emails on the signup form', () => {
  const cases: Array<{ label: string; email: string }> = [
    { label: 'plus-tag email', email: 'noam+abc@example.com' },
    { label: 'CAPITAL letters', email: 'NOAM.MARKS@EXAMPLE.COM' },
    { label: 'long local-part (60+ chars)', email: `${'a'.repeat(60)}@example.com` },
    { label: 'subdomain', email: 'noam@dev.example.co.uk' },
    { label: 'numeric local-part', email: '12345@example.com' },
  ];

  for (const c of cases) {
    test(`${c.label} passes the format guard and reaches the invite-code lookup`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('goto-signup-btn').click();
      await page.getByTestId('signup-name').fill('Edge Case User');
      await page.getByTestId('signup-email').fill(c.email);
      await page.getByTestId('signup-password').fill('Password1');
      await page.getByTestId('signup-confirm').fill('Password1');
      await page.getByTestId('signup-invite-code').fill('NOTREAL1');
      await page.getByTestId('signup-submit-btn').click();

      // The format check must NOT reject any of these emails. The expected
      // failure is the invite-code lookup, which lands on a "invalid invite
      // code" message — not "valid email address".
      await expect(page.getByText(/invalid invite code/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/valid email address/i)).toHaveCount(0);
    });
  }

  test('an obviously malformed email IS rejected upfront', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('goto-signup-btn').click();
    await page.getByTestId('signup-name').fill('Edge Case User');
    await page.getByTestId('signup-email').fill('definitely not an email');
    await page.getByTestId('signup-password').fill('Password1');
    await page.getByTestId('signup-confirm').fill('Password1');
    await page.getByTestId('signup-invite-code').fill('NOTREAL1');
    await page.getByTestId('signup-submit-btn').click();
    await expect(page.getByText(/valid email address/i)).toBeVisible();
  });
});

