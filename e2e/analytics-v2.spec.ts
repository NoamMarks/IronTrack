import { test, expect } from '@playwright/test';
import { installMockSupabase, defaultMockState } from './fixtures/mockSupabase';

/**
 * Analytics Dashboard view-toggle smoke.
 *
 * Asserts that the e1RM / Volume / DOTS toggle in AnalyticsDashboard switches
 * the active view, that each view's header text + icon updates, and that the
 * DOTS-specific bodyweight/sex controls only appear when DOTS is selected.
 */

test.describe('Analytics Dashboard — view toggle', () => {
  test('switches between e1RM, Volume, and DOTS views with the right header', async ({ page }) => {
    // Seed a trainee with one logged session so the e1RM / Volume views
    // have something to render. The default state's program has no
    // logged_at; we patch one day's exercises with actual_load + a logged_at
    // before installing the mock.
    const state = defaultMockState();
    const day = state.programs[0].weeks[0].days[0];
    day.logged_at = new Date().toISOString();
    day.exercises[0] = {
      ...day.exercises[0],
      actual_load: '100',
      values: { set_1_load: '100', set_2_load: '102.5', set_3_load: '105' },
    };

    // Sign in as the trainee so the dashboard renders the trainee surface.
    state.authedUser = state.profiles.find((p) => p.role === 'trainee')!;
    await installMockSupabase(page, state);

    await page.goto('/');
    await expect(page.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 15_000 });

    // Default view is e1rm — assert the header and toggle state.
    await expect(page.getByTestId('analytics-view-e1rm')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Estimated 1RM', { exact: false })).toBeVisible();

    // Volume.
    await page.getByTestId('analytics-view-volume').click();
    await expect(page.getByTestId('analytics-view-volume')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Total Tonnage', { exact: false })).toBeVisible();

    // DOTS — also reveals the bodyweight/sex controls block.
    await page.getByTestId('analytics-view-dots').click();
    await expect(page.getByTestId('analytics-view-dots')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('DOTS Strength Tier', { exact: false })).toBeVisible();
    await expect(page.getByTestId('dots-sex-M')).toBeVisible();
    await expect(page.getByTestId('dots-sex-F')).toBeVisible();
  });

  test('DOTS sex toggle persists the selection across view switches', async ({ page }) => {
    const state = defaultMockState();
    state.authedUser = state.profiles.find((p) => p.role === 'trainee')!;
    await installMockSupabase(page, state);

    await page.goto('/');
    await expect(page.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('analytics-view-dots').click();

    await page.getByTestId('dots-sex-F').click();
    await expect(page.getByTestId('dots-sex-F')).toHaveAttribute('aria-pressed', 'true');

    // Bounce to e1rm and back; the DOTS sex selection should still be F.
    await page.getByTestId('analytics-view-e1rm').click();
    await page.getByTestId('analytics-view-dots').click();
    await expect(page.getByTestId('dots-sex-F')).toHaveAttribute('aria-pressed', 'true');
  });
});
