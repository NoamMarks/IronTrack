import { test, expect } from '@playwright/test';
import { installMockSupabase, defaultMockState, type MockState } from './fixtures/mockSupabase';

/**
 * AdminView — cohort analytics toggle.
 *
 * The "Cohort View" button (testid `cohort-analytics-btn`) toggles a
 * `<CohortAnalytics />` panel above the program editor. The panel's
 * presence is signalled by either:
 *   - testid `cohort-analytics` when ≥ 1 trainee exists, or
 *   - testid `cohort-empty`     when the coach has no trainees.
 *
 * The button label flips between "Cohort View" and "Hide Cohort" and the
 * variant flips between ghost and primary, so we cover both states.
 */

async function openAdminPanel(page: import('@playwright/test').Page, state: MockState) {
  await installMockSupabase(page, state);
  await page.goto('/');
  await expect(page.getByText('Sarah Cohen').first()).toBeVisible({ timeout: 15_000 });
  await page.getByText('Sarah Cohen').first().click();
  await page.getByTestId('admin-btn').click();
  await expect(page.getByTestId('cohort-analytics-btn')).toBeVisible({ timeout: 10_000 });
}

test.describe('AdminView — cohort analytics toggle', () => {
  test('panel is hidden by default — only the toggle button is visible', async ({ page }) => {
    await openAdminPanel(page, defaultMockState());

    // Button reads "Cohort View" before any click.
    await expect(page.getByTestId('cohort-analytics-btn')).toContainText(/Cohort View/i);
    // Neither variant of the panel is rendered yet.
    await expect(page.getByTestId('cohort-analytics')).toHaveCount(0);
    await expect(page.getByTestId('cohort-empty')).toHaveCount(0);
  });

  test('clicking the toggle reveals the cohort-analytics panel and flips the label to "Hide Cohort"', async ({ page }) => {
    // Seed a logged session on the default trainee so the panel renders the
    // populated "cohort-analytics" surface (not the empty-state).
    const state = defaultMockState();
    const day = state.programs[0].weeks[0].days[0];
    day.logged_at = new Date().toISOString();
    day.exercises[0] = {
      ...day.exercises[0],
      actual_load: '120',
      actual_rpe: '8',
      values: { set_1_load: '120' },
    };

    await openAdminPanel(page, state);
    await page.getByTestId('cohort-analytics-btn').click();

    // Populated state — table renders.
    const panel = page.getByTestId('cohort-analytics');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('cohort-table')).toBeVisible();
    // Active trainee (Sarah Cohen) is in the table.
    await expect(panel).toContainText('Sarah Cohen');
    // Label flips.
    await expect(page.getByTestId('cohort-analytics-btn')).toContainText(/Hide Cohort/i);
  });

  test('clicking the toggle a second time hides the panel and restores the original label', async ({ page }) => {
    await openAdminPanel(page, defaultMockState());
    const btn = page.getByTestId('cohort-analytics-btn');

    await btn.click();
    // Either the populated panel or the empty-state must appear after the
    // first click — we don't care which branch surfaces, only that something
    // is rendered before we check the second click hides it.
    await expect(
      page
        .getByTestId('cohort-analytics')
        .or(page.getByTestId('cohort-empty'))
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    await btn.click();
    await expect(page.getByTestId('cohort-analytics')).toHaveCount(0);
    await expect(page.getByTestId('cohort-empty')).toHaveCount(0);
    await expect(btn).toContainText(/Cohort View/i);
  });

  test('summary tiles render the four headline metrics (Active / Compliance / Sessions / PRs)', async ({ page }) => {
    const state = defaultMockState();
    // Logged day + at least one loaded set so PRs Set is non-zero.
    const day = state.programs[0].weeks[0].days[0];
    day.logged_at = new Date().toISOString();
    day.exercises[0] = {
      ...day.exercises[0],
      actual_load: '120',
      actual_rpe: '8',
      values: { set_1_load: '120' },
    };
    await openAdminPanel(page, state);
    await page.getByTestId('cohort-analytics-btn').click();

    const panel = page.getByTestId('cohort-analytics');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toContainText(/Active Trainees/i);
    await expect(panel).toContainText(/Avg Compliance/i);
    await expect(panel).toContainText(/Total Sessions/i);
    await expect(panel).toContainText(/PRs Set/i);
  });
});
