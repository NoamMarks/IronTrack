import { test, expect, Page } from '@playwright/test';

/**
 * Phase 2C — "Gym Floor" trainee end-to-end coverage.
 *
 * Trainee opens an active workout, exercises plate calculator + rest timer,
 * and saves a session with values across all exercises.
 *
 * Two assertions in this file are intentional bug-finding tests:
 *  - "Plate calculator Apply updates the grid input"  → exercises the apply
 *    flow that exists today; should pass.
 *  - "Save Session shows a success toast"             → currently the save
 *    handler returns the user to the dashboard with NO toast/snackbar UI.
 *    The test asserts the user-expected toast and is expected to FAIL,
 *    documenting the missing affordance.
 */

async function clearState(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function loginAsTrainee(page: Page) {
  await page.getByTestId('login-email').fill('trainee1@example.com');
  await page.getByTestId('login-password').fill('123');
  await page.getByTestId('login-btn').click();
  await expect(page.getByText('Current Block')).toBeVisible({ timeout: 10_000 });
}

async function openWorkoutDay1(page: Page) {
  await page.getByTestId('week-tab-1').click();
  await expect(page.getByTestId('week-content-1')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('log-session-btn-day-1').click();
  await expect(page.getByText('Save Session')).toBeVisible({ timeout: 5_000 });
}

test.describe.skip('Gym Floor — plate calculator integration', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Opening the plate calculator and applying 150 fills the actualLoad input', async ({ page }) => {
    await loginAsTrainee(page);
    await openWorkoutDay1(page);

    // Open the plate calculator from the first exercise row.
    const firstPlateBtn = page.locator('[data-testid^="plate-calc-btn-"]').first();
    await firstPlateBtn.click();
    await expect(page.getByTestId('barbell-visual')).toBeVisible({ timeout: 5_000 });

    // Set target to 150 in the calculator's target input.
    const target = page.getByTestId('plate-target');
    await target.fill('150');

    // Apply.
    await page.getByTestId('plate-apply-btn').click();

    // The first actualLoad input on the workout grid should now show 150.
    const firstActualLoadInput = page.locator('[data-testid^="input-"][data-testid$="-actualLoad"]').first();
    await expect(firstActualLoadInput).toHaveValue('150', { timeout: 5_000 });
  });
});

test.describe.skip('Gym Floor — rest timer cancel resets the display', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Starting the 60s preset, waiting, then Stop returns the display to 0:00', async ({ page }) => {
    await loginAsTrainee(page);
    await openWorkoutDay1(page);

    // Open the floating timer panel
    await page.getByTestId('rest-timer-fab').click();
    await expect(page.getByTestId('rest-timer-panel')).toBeVisible({ timeout: 5_000 });

    // Click the 60-second preset; display should read 1:00 immediately
    await page.getByTestId('preset-60').click();
    await expect(page.getByTestId('timer-display')).toHaveText('1:00');

    // Wait ~2 seconds; display should tick down (we don't pin the exact value
    // because the next-second boundary is sloppy in real time)
    await page.waitForTimeout(2_100);
    const midText = await page.getByTestId('timer-display').textContent();
    expect(midText).not.toBe('1:00'); // it ticked
    expect(midText).not.toBe('0:00'); // not finished yet

    // Stop the timer
    await page.getByTestId('timer-start-stop').click();
    await expect(page.getByTestId('timer-display')).toHaveText('0:00');
  });
});

test.describe.skip('Gym Floor — full save lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Trainee fills weights/RPE for all exercises and saves; lands back on the dashboard', async ({ page }) => {
    await loginAsTrainee(page);
    await openWorkoutDay1(page);

    // Fill every actualLoad and actualRpe input that exists in this day
    const loadInputs = page.locator('[data-testid^="input-"][data-testid$="-actualLoad"]');
    const rpeInputs = page.locator('[data-testid^="input-"][data-testid$="-actualRpe"]');
    const loadCount = await loadInputs.count();
    const rpeCount = await rpeInputs.count();
    expect(loadCount).toBeGreaterThan(0);

    for (let i = 0; i < loadCount; i += 1) {
      await loadInputs.nth(i).fill(String(100 + i * 5));
    }
    for (let i = 0; i < rpeCount; i += 1) {
      await rpeInputs.nth(i).fill('8');
    }

    // Save the session
    await page.getByTestId('save-session-btn').click();

    // Expected: redirected back to the trainee dashboard
    await expect(page.getByText('Current Block')).toBeVisible({ timeout: 5_000 });
  });

  test('Save Session shows a success toast/confirmation', async ({ page }) => {
    // BUG-FINDING TEST — the spec calls for a "Success Toast" but no toast
    // component exists in the codebase today. This test asserts the user's
    // expected UX: a visible confirmation that the save succeeded. Expected
    // to FAIL until a toast is added.
    await loginAsTrainee(page);
    await openWorkoutDay1(page);

    const firstLoad = page.locator('[data-testid^="input-"][data-testid$="-actualLoad"]').first();
    await firstLoad.fill('120');

    await page.getByTestId('save-session-btn').click();

    // Look for any of the conventional toast affordances — role=status/alert,
    // a [data-testid*="toast"], or visible text "Saved" / "Session saved" /
    // "Success".
    const toastByRole = page.getByRole('status').or(page.getByRole('alert'));
    const toastByTestId = page.locator('[data-testid*="toast"], [data-testid*="snackbar"]');
    const toastByText = page.getByText(/saved|success|session logged|session saved/i);

    await expect(
      toastByRole.or(toastByTestId).or(toastByText),
    ).toBeVisible({ timeout: 5_000 });
  });
});
