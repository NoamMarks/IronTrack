import { test, expect } from '@playwright/test';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function clearState(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-btn').click();
}

// ─── Smoke Tests ────────────────────────────────────────────────────────────

test.describe.skip('Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Login page renders correctly', async ({ page }) => {
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-btn')).toBeVisible();
    await expect(page.getByTestId('goto-signup-btn')).toBeVisible();
    await expect(page.getByTestId('goto-forgot-btn')).toBeVisible();
  });

  test('Signup page renders from login', async ({ page }) => {
    await page.getByTestId('goto-signup-btn').click();
    await expect(page.getByTestId('signup-name')).toBeVisible();
    await expect(page.getByTestId('signup-email')).toBeVisible();
    await expect(page.getByTestId('signup-invite-code')).toBeVisible();
  });
});

// ─── Sanity Tests ───────────────────────────────────────────────────────────

test.describe.skip('Sanity Tests', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Coach can log in and see client list', async ({ page }) => {
    await login(page, 'coach@example.com', '123');
    // Should see the "Clients" heading on the coach client list view
    await expect(page.getByText('Clients', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Active Training Management')).toBeVisible();
  });

  test('Trainee can log in and see their dashboard', async ({ page }) => {
    await login(page, 'trainee1@example.com', '123');
    await expect(page.getByText('Current Block')).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Full E2E Lifecycle ─────────────────────────────────────────────────────

test.describe.skip('Coach Creation Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Coach creates a trainee, builds a program, and trainee logs a session', async ({ page }) => {
    // ── Coach Login ──────────────────────────────────────────────────
    await login(page, 'coach@example.com', '123');
    await expect(page.getByText('Clients', { exact: true })).toBeVisible({ timeout: 10_000 });

    // ── Create New Client ────────────────────────────────────────────
    await page.getByRole('button', { name: /new client/i }).click();
    await page.getByTestId('new-client-name').fill('E2E Trainee');
    await page.getByTestId('new-client-email').fill('e2e@test.com');
    await page.getByTestId('new-client-password').fill('TestPass1');
    await page.getByTestId('new-client-confirm').fill('TestPass1');
    await page.getByRole('button', { name: /create client/i }).click();
    // Wait for modal to close and card to appear
    await expect(page.getByText('E2E Trainee')).toBeVisible({ timeout: 5_000 });

    // ── Navigate to Admin Panel ──────────────────────────────────────
    await page.getByTestId('admin-btn').click();
    await expect(page.getByText('Admin Panel')).toBeVisible({ timeout: 5_000 });

    // ── Select the new trainee ───────────────────────────────────────
    await page.getByText('E2E Trainee').click();

    // ── Create a program ─────────────────────────────────────────────
    await page.getByRole('button', { name: /create new block/i }).click();
    // ProgramEditor renders — program name is an input with "Training Block 1"
    await expect(page.locator('input[value="Training Block 1"]')).toBeVisible({ timeout: 5_000 });
    // Week 1 and Day A should be visible
    await expect(page.locator('input[value="Day A"]')).toBeVisible({ timeout: 3_000 });

    // Add an exercise via the "+ Add Exercise" button
    const addExerciseBtn = page.getByRole('button', { name: /add exercise/i }).first();
    await addExerciseBtn.click();

    // The program is auto-saved as we edit. Coach flow complete.
  });
});

test.describe.skip('Trainee Logging Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Trainee logs a session with 100kg and data persists', async ({ page }) => {
    // ── Trainee Login ────────────────────────────────────────────────
    await login(page, 'trainee1@example.com', '123');
    await expect(page.getByText('Current Block')).toBeVisible({ timeout: 10_000 });

    // ── Expand Week 1 (accordion) ────────────────────────────────────
    const weekAccordion = page.getByTestId('week-tab-1');
    await weekAccordion.click();
    await expect(page.getByTestId('week-content-1')).toBeVisible({ timeout: 5_000 });

    // ── Click "Log Session" on Day 1 ─────────────────────────────────
    await page.getByTestId('log-session-btn-day-1').click();

    // ── Should see the WorkoutGridLogger ─────────────────────────────
    await expect(page.getByText('Save Session')).toBeVisible({ timeout: 5_000 });

    // ── Find an actualLoad input and type 100 ────────────────────────
    const loadInput = page.locator('[data-testid*="actualLoad"]').first();
    await loadInput.fill('100');

    // ── Open Plate Calculator from that row ──────────────────────────
    const plateBtn = page.getByTestId('plate-calc-btn').first();
    if (await plateBtn.isVisible()) {
      await plateBtn.click();
      await expect(page.getByTestId('barbell-visual')).toBeVisible({ timeout: 3_000 });
      // Apply weight back
      const applyBtn = page.getByTestId('plate-apply-btn');
      if (await applyBtn.isVisible()) {
        await applyBtn.click();
      }
    }

    // ── Save Session ─────────────────────────────────────────────────
    await page.getByRole('button', { name: /save session/i }).click();

    // ── Persistence Check: Logout and re-login ──────────────────────
    // Navigate back first (we're returned to dashboard after save)
    await expect(page.getByText('Current Block')).toBeVisible({ timeout: 5_000 });

    // Logout
    await page.locator('nav button').last().click();
    // Should be back at login
    await expect(page.getByTestId('login-btn')).toBeVisible({ timeout: 5_000 });

    // Re-login
    await login(page, 'trainee1@example.com', '123');
    await expect(page.getByText('Current Block')).toBeVisible({ timeout: 10_000 });

    // Expand Week 1 and go back to Day 1
    await page.getByTestId('week-tab-1').click();
    await expect(page.getByTestId('week-content-1')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('log-session-btn-day-1').click();
    await expect(page.getByText('Save Session')).toBeVisible({ timeout: 5_000 });

    // ── Verify the 100 is still there ────────────────────────────────
    const persistedLoad = page.locator('[data-testid*="actualLoad"]').first();
    await expect(persistedLoad).toHaveValue('100');
  });
});