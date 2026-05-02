import { test, expect, Page } from '@playwright/test';

/**
 * Signup flow coverage.
 *
 * Covers the form-validation and OTP-step UX deterministically. The full
 * end-to-end happy path (real account creation via /api/signup-user) is
 * NOT covered here because it requires a valid invite code provisioned in
 * Supabase, which is owned by a separate seeding flow.
 */

async function gotoSignup(page: Page) {
  await page.goto('/');
  await page.getByTestId('goto-signup-btn').click();
  await expect(page.getByTestId('signup-name')).toBeVisible();
}

async function fillFormFields(page: Page, opts: {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
  invite?: string;
}) {
  if (opts.name !== undefined) await page.getByTestId('signup-name').fill(opts.name);
  if (opts.email !== undefined) await page.getByTestId('signup-email').fill(opts.email);
  if (opts.password !== undefined) await page.getByTestId('signup-password').fill(opts.password);
  if (opts.confirm !== undefined) await page.getByTestId('signup-confirm').fill(opts.confirm);
  if (opts.invite !== undefined) await page.getByTestId('signup-invite-code').fill(opts.invite);
}

test.describe('Signup — page render', () => {
  test('signup form exposes every field plus the back-to-login link', async ({ page }) => {
    await gotoSignup(page);
    await expect(page.getByTestId('signup-name')).toBeVisible();
    await expect(page.getByTestId('signup-email')).toBeVisible();
    await expect(page.getByTestId('signup-password')).toBeVisible();
    await expect(page.getByTestId('signup-confirm')).toBeVisible();
    await expect(page.getByTestId('signup-invite-code')).toBeVisible();
    await expect(page.getByText(/Back to Login/i)).toBeVisible();
  });

  test('the heading reads SIGN UP and the subtitle says "Create your training account"', async ({ page }) => {
    await gotoSignup(page);
    await expect(page.getByRole('heading', { name: /sign up/i })).toBeVisible();
    await expect(page.getByText(/Create your training account/i)).toBeVisible();
  });
});

test.describe('Signup — form validation', () => {
  test('submitting blank fields lists every missing-field error', async ({ page }) => {
    await gotoSignup(page);
    await page.getByTestId('signup-submit-btn').click();
    await expect(page.getByText(/Name is required/i)).toBeVisible();
    await expect(page.getByText(/Email is required/i)).toBeVisible();
    // OTP step must NOT have rendered.
    await expect(page.getByTestId('signup-otp')).toHaveCount(0);
  });

  test('a malformed email is rejected with the standard format message', async ({ page }) => {
    await gotoSignup(page);
    await fillFormFields(page, {
      name: 'Test User',
      email: 'not-an-email',
      password: 'Password1',
      confirm: 'Password1',
      invite: 'WHATEVER1',
    });
    await page.getByTestId('signup-submit-btn').click();
    await expect(page.getByText(/valid email address/i)).toBeVisible();
    await expect(page.getByTestId('signup-otp')).toHaveCount(0);
  });

  test('a weak password lists the strength rules it failed', async ({ page }) => {
    await gotoSignup(page);
    await fillFormFields(page, {
      name: 'Test User',
      email: `test+${Date.now()}@example.com`,
      password: 'short',
      confirm: 'short',
      invite: 'WHATEVER1',
    });
    await page.getByTestId('signup-submit-btn').click();
    // Strength feedback appears inline as you type AND in the errors box.
    await expect(page.getByText(/Password:/i).first()).toBeVisible();
    await expect(page.getByTestId('signup-otp')).toHaveCount(0);
  });

  test('mismatched password + confirmation is blocked before the network', async ({ page }) => {
    await gotoSignup(page);
    await fillFormFields(page, {
      name: 'Test User',
      email: `test+${Date.now()}@example.com`,
      password: 'Password1',
      confirm: 'Different1',
      invite: 'WHATEVER1',
    });
    await page.getByTestId('signup-submit-btn').click();
    await expect(page.getByText(/Passwords do not match/i)).toBeVisible();
    await expect(page.getByTestId('signup-otp')).toHaveCount(0);
  });

  test('an unknown invite code keeps the user on the form with the invalid-code error', async ({ page }) => {
    await gotoSignup(page);
    await fillFormFields(page, {
      name: 'Test User',
      email: `test+${Date.now()}@example.com`,
      password: 'Password1',
      confirm: 'Password1',
      invite: 'NOTREAL1',
    });
    await page.getByTestId('signup-submit-btn').click();
    await expect(page.getByText(/invalid invite code/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('signup-otp')).toHaveCount(0);
  });
});

test.describe('Signup — password strength feedback', () => {
  test('typing a strong password shows the green "meets requirements" line', async ({ page }) => {
    await gotoSignup(page);
    await page.getByTestId('signup-password').fill('Password1');
    await expect(page.getByText(/Password meets requirements/i)).toBeVisible();
  });

  test('typing only digits surfaces the missing-letter strength rule', async ({ page }) => {
    await gotoSignup(page);
    await page.getByTestId('signup-password').fill('12345678');
    // The exact wording of strength errors lives in checkPasswordStrength;
    // assert that at least one amber strength rule is shown.
    await expect(page.locator('p.text-amber-500').first()).toBeVisible();
  });
});

test.describe('Signup — navigation', () => {
  test('Back to Login returns to the landing form', async ({ page }) => {
    await gotoSignup(page);
    await page.getByText(/Back to Login/i).click();
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });
});
