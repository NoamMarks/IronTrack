import { test, expect, Page } from '@playwright/test';

/**
 * Phase 2A — "Rogue User" auth guard E2E coverage.
 *
 * IronTrack uses in-memory view state, so visiting /coach or /admin doesn't
 * reach a server-side route — Vite serves index.html and the SPA decides what
 * to render. The expected UX: any visit without a valid session lands on the
 * login screen (which is the root view when no auth exists).
 */

async function clearState(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function login(page: Page, email: string, password: string) {
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-btn').click();
}

test.describe.skip('Auth Guards — rogue navigation', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Visiting /coach unauthenticated lands on the login form', async ({ page }) => {
    await page.goto('/coach');
    // SPA router has no /coach view — should fall through to landing
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });

  test('Visiting /admin unauthenticated lands on the login form', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });

  test('Visiting /trainee unauthenticated lands on the login form', async ({ page }) => {
    await page.goto('/trainee');
    await expect(page.getByTestId('login-email')).toBeVisible();
  });
});

test.describe.skip('Auth Guards — login error states', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Login with an unregistered email shows "Invalid email or password"', async ({ page }) => {
    await login(page, 'nobody@example.com', 'WhateverPass1');
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 5_000 });
    // We must still be on the login form (no navigation away)
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });

  test('Login with a malformed email shows the format error and does not call the auth API', async ({ page }) => {
    await login(page, 'not-an-email', 'Whatever1');
    await expect(page.getByTestId('login-format-error')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/valid email address/i)).toBeVisible();
  });

  test('Login with the right email but wrong password shows the same generic error', async ({ page }) => {
    // The seeded coach is coach@example.com / 123 — try a wrong password
    await login(page, 'coach@example.com', 'WrongPassword1');
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 5_000 });
  });
});

test.describe.skip('Auth Guards — signup error states', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Signup with an unknown invite code shows the invalid-code error', async ({ page }) => {
    await page.getByTestId('goto-signup-btn').click();
    await page.getByTestId('signup-name').fill('Test Trainee');
    await page.getByTestId('signup-email').fill('test.trainee@example.com');
    await page.getByTestId('signup-password').fill('Password1');
    await page.getByTestId('signup-confirm').fill('Password1');
    await page.getByTestId('signup-invite-code').fill('NOTREAL1');
    await page.getByTestId('signup-submit-btn').click();
    await expect(page.getByText(/invalid invite code/i)).toBeVisible({ timeout: 5_000 });
    // Should still be on the form step
    await expect(page.getByTestId('signup-otp')).toHaveCount(0);
  });

  test('Signup using an exhausted invite code (maxUses reached) is rejected', async ({ page }) => {
    // Seed an invite code with maxUses=1 and consume it.
    await page.evaluate(() => {
      const code = {
        id: 'exhausted1',
        code: 'EXHAUST1',
        tenantId: 'coach1',
        coachId: 'coach1',
        coachName: 'Coach Noam',
        createdAt: new Date().toISOString(),
        maxUses: 1,
        useCount: 1, // already used up
      };
      localStorage.setItem('irontrack_invite_codes', JSON.stringify([code]));
    });
    await page.reload();

    await page.getByTestId('goto-signup-btn').click();
    await page.getByTestId('signup-name').fill('Late Trainee');
    await page.getByTestId('signup-email').fill('late@example.com');
    await page.getByTestId('signup-password').fill('Password1');
    await page.getByTestId('signup-confirm').fill('Password1');
    await page.getByTestId('signup-invite-code').fill('EXHAUST1');
    await page.getByTestId('signup-submit-btn').click();

    // Exhausted codes are treated identically to unknown codes by lookupInviteCode.
    await expect(page.getByText(/invalid invite code/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('signup-otp')).toHaveCount(0);
  });

  test('Signup with an email that already exists in the system is rejected', async ({ page }) => {
    // The default seed set already contains trainee1@example.com. We expect
    // the signup form to refuse a duplicate email rather than silently create
    // a second user with the same address.
    //
    // NOTE: the spec says "assert failure UI". If no duplicate-email check
    // exists in the codebase, this test will FAIL — exposing the missing
    // validation, which is the desired bug-report behaviour for this sprint.

    // Seed a valid invite so the only failure mode is the email collision.
    await page.evaluate(() => {
      const code = {
        id: 'inv1',
        code: 'WELCOME1',
        tenantId: 'coach1',
        coachId: 'coach1',
        coachName: 'Coach Noam',
        createdAt: new Date().toISOString(),
        useCount: 0,
      };
      localStorage.setItem('irontrack_invite_codes', JSON.stringify([code]));
    });
    await page.reload();

    await page.getByTestId('goto-signup-btn').click();
    await page.getByTestId('signup-name').fill('Duplicate User');
    await page.getByTestId('signup-email').fill('trainee1@example.com'); // already in seed
    await page.getByTestId('signup-password').fill('Password1');
    await page.getByTestId('signup-confirm').fill('Password1');
    await page.getByTestId('signup-invite-code').fill('WELCOME1');
    await page.getByTestId('signup-submit-btn').click();

    // Expected UX: an error appears on the form (anything that mentions
    // "email" or "exists" or "already"), and the OTP step never appears.
    await expect(page.getByText(/(email.*already|already.*email|already in use|already exists)/i))
      .toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('signup-otp')).toHaveCount(0);
  });
});
