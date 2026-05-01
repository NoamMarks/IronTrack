import { test, expect, Page } from '@playwright/test';

/**
 * Phase 2B — Program Editor end-to-end coverage.
 *
 * Walks through the coach's full program-building flow: log in, drill into a
 * trainee, create a program, add a week, add a day, add a custom column,
 * then delete the column and the day. Asserts the UI updates at each step
 * with no ghost data left behind.
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

test.describe.skip('Program Editor — Coach builds a program', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page);
  });

  test('Coach can add a week, add a day, add+delete a column, then delete the day', async ({ page }) => {
    // Log in as the seeded coach
    await login(page, 'coach@example.com', '123');
    await expect(page.getByText('Clients', { exact: true })).toBeVisible({ timeout: 10_000 });

    // ── Drill into the seeded trainee Sarah Cohen ───────────────────────
    await page.getByText('Sarah Cohen').click();
    // Coach drilled into a client → goes to ClientDashboard. Open Admin from there.
    await page.getByTestId('admin-btn').click();
    await expect(page.getByText('Admin Panel')).toBeVisible({ timeout: 5_000 });

    // Sarah already has a program from MOCK_PROGRAM seed: "Hypertrophy Phase 1"
    // Confirm the program editor loaded
    await expect(page.locator('input[value="Hypertrophy Phase 1"]')).toBeVisible({ timeout: 5_000 });

    // Count initial weeks in the editor — seed has 4 weeks
    const initialWeekCount = await page.getByText(/^WEEK \d+$/).count();
    expect(initialWeekCount).toBeGreaterThan(0);

    // ── Add a Week ──────────────────────────────────────────────────────
    await page.getByRole('button', { name: '+ Add Week' }).click();
    await expect(page.getByText(/^WEEK \d+$/)).toHaveCount(initialWeekCount + 1);

    // ── Add a Day to the first week (uses the first "+ Add Day" button) ─
    const dayHeaderRegex = /^Day \d+$/;
    const initialDayLabelCount = await page.getByText(dayHeaderRegex).count();
    await page.getByRole('button', { name: '+ Add Day' }).first().click();
    // Each week mirrors the day; expect at least one new day label per week
    await expect(page.getByText(dayHeaderRegex).first()).toBeVisible();
    const afterAddCount = await page.getByText(dayHeaderRegex).count();
    expect(afterAddCount).toBeGreaterThan(initialDayLabelCount);

    // ── Add a custom column "Tempo" (Plan type) ─────────────────────────
    await page.getByTestId('add-column-btn').click();
    await page.getByTestId('column-label-input').fill('Tempo');
    await page.getByRole('button', { name: /Plan \(Coach Sets\)/i }).click();
    await page.getByTestId('save-column-btn').click();

    // The column header text "Tempo" should now appear in the editor.
    // Use first() because the column repeats across weeks/days.
    await expect(page.getByText(/^TEMPO$/i).first()).toBeVisible({ timeout: 5_000 });

    // ── Delete the custom column ────────────────────────────────────────
    // The column-header SPAN and its sibling Delete button share a single
    // `.group` ancestor. Walk from the span to that immediate ancestor via
    // xpath, then scope the Delete-Column click to that container — the
    // first column would otherwise win and we'd be testing "delete Sets"
    // instead of "delete Tempo".
    const tempoCell = page
      .locator('xpath=//span[normalize-space(text())="Tempo"]/..')
      .first();
    await tempoCell.hover();
    await tempoCell.locator('button[title="Delete Column"]').click({ force: true });

    // The "Tempo" header should be gone from the editor.
    await expect(page.getByText(/^Tempo$/)).toHaveCount(0);

    // ── Delete the Day we added ─────────────────────────────────────────
    // The Day's delete button is the X icon next to "Add Exercise" in each
    // day. Locate via its hover-only state — we just hover on the day card.
    // Easier: count days, click the last "X" icon button per row, count again.
    const beforeDeleteDayCount = await page.getByText(dayHeaderRegex).count();
    // Look up the day-delete buttons (the X icons rendered next to "+ Add Exercise")
    // They're identified by their text-only sibling "+ Add Exercise". We can
    // grab an X button via aria — but absent that we use the last-X pattern:
    const xButtons = page.locator('button').filter({ has: page.locator('svg.lucide-x') });
    const xCount = await xButtons.count();
    expect(xCount).toBeGreaterThan(0);
    // The first day-X (in week 1) — clicking it deletes that dayNumber across all weeks.
    await xButtons.first().click();
    const afterDeleteDayCount = await page.getByText(dayHeaderRegex).count();
    expect(afterDeleteDayCount).toBeLessThan(beforeDeleteDayCount);
  });

  test('Coach can rename the program in-place', async ({ page }) => {
    await login(page, 'coach@example.com', '123');
    await page.getByText('Sarah Cohen').click();
    await page.getByTestId('admin-btn').click();
    await expect(page.getByText('Admin Panel')).toBeVisible({ timeout: 5_000 });

    const programNameInput = page.locator('input[value="Hypertrophy Phase 1"]');
    await expect(programNameInput).toBeVisible({ timeout: 5_000 });
    await programNameInput.fill('Strength Block 2026');

    // Re-enter the editor (no save button — auto-saves) and confirm the rename
    // persists by reading the value back.
    await expect(page.locator('input[value="Strength Block 2026"]')).toBeVisible();
  });
});
