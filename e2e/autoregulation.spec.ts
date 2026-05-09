import { test, expect } from '@playwright/test';
import { installMockSupabase, defaultMockState, type MockState } from './fixtures/mockSupabase';

/**
 * RPE-autoregulation banner inside WorkoutGridLogger.
 *
 * `rpeAutoregulationSuggestion` walks the trainee's last 3 logged sessions
 * for an exercise and surfaces a coloured banner when |avgDelta| > 1.5.
 * The banner has data-testid `autoreg-banner-<exerciseIdx>` and one of two
 * tone classes:
 *   - bg-accent → "increase" (undershooting target)
 *   - bg-warning → "decrease" (overshooting target)
 *
 * Banner is HIDDEN when:
 *   - fewer than 2 qualifying sessions exist
 *   - suggestion is "maintain" (delta inside the dead-band)
 *
 * The default mock has only one program week with no actuals, so we patch
 * sessions per test to drive the suggestion in each direction.
 */

/** Build mock state where the trainee has `pairs.length` logged days for
 *  exercise-id 'ex-w1d1-ex-1' (the first exercise of week-1/day-1 in the
 *  default fixture), each with the supplied (expected, actual) RPE.
 *
 *  We seed an EXTRA week so there's an unlogged "current" day the trainee
 *  can open in the WorkoutGridLogger — that's where the banner renders.
 */
function buildAutoregState(pairs: Array<{ expected: number; actual: number }>): MockState {
  const state = defaultMockState();
  state.authedUser = state.profiles.find((p) => p.role === 'trainee')!;

  const program = state.programs[0];
  // Patch the exercises in week 1's days so they share the same exercise_id —
  // the autoreg lookup matches by exercise_id, not exercise_name.
  const sharedExerciseId = 'ex-shared-squat';

  // Reset week-1 days to single-exercise sessions with consistent IDs across
  // the two days (one logged session per day). We have 2 days in week 1 and
  // 2 days in week 2 in the default fixture — re-purpose them.
  const week1 = program.weeks[0];
  const week2 = program.weeks[1];

  const allDays = [...week1.days, ...week2.days];

  // Seed `pairs.length` historical sessions (all but one), then leave the
  // final day unlogged so it shows up as "open this workout" on the
  // dashboard. Walk newest-first so the most recent session lands on the
  // most recent day in the program.
  for (let i = 0; i < allDays.length; i += 1) {
    const day = allDays[i];
    if (i < pairs.length) {
      // Logged session: subtract i days so newer index = newer date.
      day.logged_at = new Date(2026, 4, 9 - i).toISOString();
      day.exercises = [
        {
          ...day.exercises[0],
          exercise_id: sharedExerciseId,
          exercise_name: 'Back Squat',
          expected_rpe: String(pairs[i].expected),
          actual_rpe: String(pairs[i].actual),
        },
      ];
    } else {
      // Unlogged "current" day. Same exercise_id so the autoreg lookup
      // sees the historical sessions when the trainee opens this day.
      day.logged_at = null;
      day.exercises = [
        {
          ...day.exercises[0],
          exercise_id: sharedExerciseId,
          exercise_name: 'Back Squat',
          expected_rpe: '7',
          actual_rpe: null,
          actual_load: null,
        },
      ];
    }
  }

  return state;
}

/** Open the trainee dashboard, then start the next un-logged workout (the
 *  one for which the autoreg banner should appear). */
async function openCurrentWorkout(page: import('@playwright/test').Page) {
  await page.goto('/');
  // Wait for the trainee dashboard.
  await expect(page.getByText(/Hypertrophy Phase 1|Current Block/i).first()).toBeVisible({
    timeout: 15_000,
  });
  // Click the first day card whose status is "Play" (not yet logged). Day
  // names "Lower" / "Upper" appear repeatedly; the un-logged one is whichever
  // we left without a logged_at. The dashboard renders the day name as a
  // heading — click the LAST one because we leave the latest day unlogged.
  const dayHeading = page.getByRole('heading', { level: 3 }).filter({ hasText: /Lower|Upper/ }).last();
  await dayHeading.click();
  // Confirm the WorkoutGridLogger mounted.
  await expect(
    page.getByRole('button', { name: /Finish Workout|Save Session/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('Trainee — RPE autoregulation banner', () => {
  test('banner is hidden when only 1 prior session has been logged', async ({ page }) => {
    await installMockSupabase(page, buildAutoregState([{ expected: 7, actual: 9 }]));
    await openCurrentWorkout(page);

    // No banner should render — sessionCount < 2.
    await expect(page.locator('[data-testid^="autoreg-banner-"]')).toHaveCount(0);
  });

  test('banner is hidden when avgDelta sits inside the dead-band (|delta| ≤ 1.5)', async ({ page }) => {
    // Two sessions, both 1 RPE point above target → avgDelta = +1.0 → maintain.
    await installMockSupabase(
      page,
      buildAutoregState([
        { expected: 7, actual: 8 },
        { expected: 7, actual: 8 },
      ]),
    );
    await openCurrentWorkout(page);

    await expect(page.locator('[data-testid^="autoreg-banner-"]')).toHaveCount(0);
  });

  test('banner shows the "decrease" tone when the trainee is overshooting target RPE', async ({ page }) => {
    // Two sessions, both 2 RPE points above target → avgDelta = +2.0 → decrease.
    await installMockSupabase(
      page,
      buildAutoregState([
        { expected: 7, actual: 9 },
        { expected: 7, actual: 9 },
      ]),
    );
    await openCurrentWorkout(page);

    const banner = page.locator('[data-testid^="autoreg-banner-"]').first();
    await expect(banner).toBeVisible({ timeout: 10_000 });
    // Decrease branch carries the warning palette.
    await expect(banner).toHaveClass(/bg-warning/);
    await expect(banner).toContainText(/consider reducing load/i);
    await expect(banner).toContainText(/2 sessions/i);
  });

  test('banner shows the "increase" tone when the trainee is undershooting target RPE', async ({ page }) => {
    // Two sessions, both 2 RPE points below target → avgDelta = -2.0 → increase.
    await installMockSupabase(
      page,
      buildAutoregState([
        { expected: 8, actual: 6 },
        { expected: 8, actual: 6 },
      ]),
    );
    await openCurrentWorkout(page);

    const banner = page.locator('[data-testid^="autoreg-banner-"]').first();
    await expect(banner).toBeVisible({ timeout: 10_000 });
    // Increase branch carries the accent (success) palette.
    await expect(banner).toHaveClass(/bg-accent/);
    await expect(banner).toContainText(/consider adding load/i);
    await expect(banner).toContainText(/2 sessions/i);
  });
});
