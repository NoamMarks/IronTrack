import { test, expect, Page } from '@playwright/test';
import { installMockSupabase, defaultMockState, type MockState } from './fixtures/mockSupabase';

/**
 * Trainee — workout history drill-down.
 *
 * After a session is finished, the day card on the trainee dashboard sprouts
 * an Eye icon button (`view-history-btn-day-<n>`) that opens a read-only
 * `WorkoutHistoryModal`. The modal surfaces:
 *   - exercise name
 *   - actual load + actual RPE
 *   - prescribed summary
 *   - reflection (if captured) and coach feedback (if recorded)
 *
 * The Eye button stops event propagation so clicking the rest of the card
 * still starts the workout — we verify both code paths.
 */

/** Default fixture seeds a 2-week program with no logged_at; we patch one
 *  day so the trainee dashboard renders that day as "logged" and the Eye
 *  affordance is visible. */
function buildHistoryState(): MockState {
  const state = defaultMockState();
  // Sign in as the trainee so the trainee dashboard renders.
  state.authedUser = state.profiles.find((p) => p.role === 'trainee')!;

  const day = state.programs[0].weeks[0].days[0];
  day.logged_at = '2026-04-01T12:00:00Z';
  day.exercises[0] = {
    ...day.exercises[0],
    actual_load: '120',
    actual_rpe: '8',
    notes: 'felt heavy',
    values: { set_1_load: '120', set_1_rpe: '8' },
  };
  return state;
}

async function landOnTraineeDashboard(page: Page) {
  await page.goto('/');
  // The trainee dashboard renders the program inside a "Current Block" card.
  await expect(page.getByText(/Current Block|Hypertrophy Phase 1/i).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Trainee — workout history drill-down', () => {
  test('logged day cards expose the Eye icon button', async ({ page }) => {
    await installMockSupabase(page, buildHistoryState());
    await landOnTraineeDashboard(page);

    // Day 1 was patched with logged_at → the Eye button must be present.
    await expect(page.getByTestId('view-history-btn-day-1')).toBeVisible();
    // Day 2 was not patched → no Eye button on it.
    await expect(page.getByTestId('view-history-btn-day-2')).toHaveCount(0);
  });

  test('clicking the Eye button opens the WorkoutHistoryModal with the recorded session data', async ({ page }) => {
    await installMockSupabase(page, buildHistoryState());
    await landOnTraineeDashboard(page);

    await page.getByTestId('view-history-btn-day-1').click();

    // Modal title is the day name from the fixture ("Lower").
    const modalHeading = page.getByRole('heading', { name: /Lower/i });
    await expect(modalHeading).toBeVisible();
    // Surfaces the exercise name from the patched day.
    await expect(page.getByText('Back Squat').first()).toBeVisible();
    // Actual load + actual RPE rows are populated.
    await expect(page.getByText(/^120$/).first()).toBeVisible();
    await expect(page.getByText(/^8$/).first()).toBeVisible();
  });

  test('clicking the day card body (not the Eye) starts the workout — Eye does not steal the gesture', async ({ page }) => {
    await installMockSupabase(page, buildHistoryState());
    await landOnTraineeDashboard(page);

    // Click the card area outside the Eye button — the day name is a safe target.
    // The trainee logger renders a "Save Session" / "Finish Workout" affordance
    // that's specific to the WorkoutGridLogger, so its appearance proves the
    // start-workout flow ran.
    const card = page.locator('button, a, div').filter({ hasText: 'Lower' }).first();
    await card.scrollIntoViewIfNeeded();
    // The day card itself is a clickable container; we click on the day name
    // which sits well outside the small 32px Eye button hitbox.
    await page.getByRole('heading', { name: /^Lower$/ }).click();

    // After a successful start, the WorkoutGridLogger renders a "Finish
    // Workout" or "Save Session" CTA. We assert a generic visible signal
    // rather than a specific testid because the start-workout surface
    // exposes both depending on logged-state.
    await expect(
      page.getByRole('button', { name: /Finish Workout|Save Session/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('the close button dismisses the modal', async ({ page }) => {
    await installMockSupabase(page, buildHistoryState());
    await landOnTraineeDashboard(page);

    await page.getByTestId('view-history-btn-day-1').click();
    const heading = page.getByRole('heading', { name: /Lower/i });
    await expect(heading).toBeVisible();

    // Modal close button is the X icon next to the title.
    // Modal renders <button> directly after the heading inside the modal panel.
    const closeBtn = heading.locator('xpath=following-sibling::button').first();
    await closeBtn.click();

    await expect(heading).toBeHidden();
  });
});
