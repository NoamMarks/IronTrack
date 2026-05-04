import { test, expect, Page } from '@playwright/test';
import {
  installMockSupabase,
  defaultMockState,
  type MockState,
  type MockWeek,
} from './fixtures/mockSupabase';

/**
 * Input validation + progressive-overload reference — end-to-end coverage.
 *
 * The unit tests in src/__tests__/numericInput.test.ts already prove the
 * sanitizer in isolation. This spec proves the wiring: when a real browser
 * dispatches keystrokes into the workout-logger / plate-calculator inputs,
 * the rendered value reflects the clamp. Without this layer, a sanitizer
 * change that accidentally bypasses the onChange path (e.g. forgetting to
 * pipe e.target.value through `sanitizeOnType`) would fail silently.
 *
 * Also covers the new "last week" hint — given a program where week 1 has
 * logged actuals, opening week 2 of the same day must surface "Last week:
 * <load> · RPE <rpe>" beside each set.
 */

/**
 * Seed a trainee-as-authedUser mock state with full week 1 actuals on the
 * Back Squat exercise. Returns the state so individual tests can extend
 * it (e.g. add a week 3 to test the skip-week walk-back behavior).
 */
function buildTraineeStateWithWeek1Actuals(): MockState {
  const state = defaultMockState();
  const trainee = state.profiles.find((p) => p.role === 'trainee')!;
  state.authedUser = trainee;

  const program = state.programs[0];
  const w1d1 = program.weeks[0].days[0];
  w1d1.logged_at = '2026-04-01T12:00:00Z';
  const squat = w1d1.exercises[0];
  squat.actual_load = '100';
  squat.actual_rpe = '7';
  squat.values = {
    set_1_load: '100',
    set_1_rpe: '7',
    set_2_load: '102.5',
    set_2_rpe: '7.5',
    set_3_load: '105',
    set_3_rpe: '8',
  };
  return state;
}

async function installAndLogin(page: Page, state: MockState) {
  await installMockSupabase(page, state);
  await page.goto('/');
  await expect(page.getByText('Hypertrophy Phase 1').first()).toBeVisible({
    timeout: 10_000,
  });
}

async function loginAsTraineeWithSeededWeek1(page: Page) {
  await installAndLogin(page, buildTraineeStateWithWeek1Actuals());
}

async function openWeekDay(page: Page, weekNumber: number, dayNumber: number) {
  await page.getByTestId(`week-tab-${weekNumber}`).click();
  await expect(page.getByTestId(`week-content-${weekNumber}`)).toBeVisible({
    timeout: 5_000,
  });
  await page.getByTestId(`log-session-btn-day-${dayNumber}`).click();
  // The Finish button is always rendered inside the logger.
  await expect(page.getByTestId('finish-session-btn')).toBeVisible({
    timeout: 5_000,
  });
}

// ─── Set load + RPE clamping inside the workout logger ───────────────────────

test.describe('WorkoutGridLogger — input clamping on the gym floor', () => {
  test('typing 9999999 into a load cell clamps to 1000', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    // Open week 2 / day 1 — fresh actuals, no clash with the seeded week 1.
    await openWeekDay(page, 2, 1);

    // Pick the first load input (Back Squat, set 1 of week 2).
    const loadInput = page.locator('[data-testid$="-set-1-load"]').first();
    await loadInput.fill('9999999');
    // The sanitizer caps the value as it lands; readback must be the
    // clamped string, not the raw paste.
    await expect(loadInput).toHaveValue('1000');
  });

  test('typing 99 into an RPE cell clamps to 10', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    const rpeInput = page.locator('[data-testid$="-set-1-rpe"]').first();
    await rpeInput.fill('99');
    await expect(rpeInput).toHaveValue('10');
  });

  test('letters and symbols are stripped from numeric inputs', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    const loadInput = page.locator('[data-testid$="-set-1-load"]').first();
    await loadInput.fill('abc100kg');
    await expect(loadInput).toHaveValue('100');
  });

  test('blur on RPE 0.5 clamps UP to the floor of 1', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    const rpeInput = page.locator('[data-testid$="-set-1-rpe"]').first();
    await rpeInput.fill('0.5');
    // Tab out — triggers the onBlur clamp.
    await rpeInput.press('Tab');
    await expect(rpeInput).toHaveValue('1');
  });

  test('European decimal comma is translated to a dot', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    const loadInput = page.locator('[data-testid$="-set-1-load"]').first();
    await loadInput.fill('100,5');
    await expect(loadInput).toHaveValue('100.5');
  });
});

// ─── Plate calculator clamping ───────────────────────────────────────────────

test.describe('PlateCalculator — clamping inside the modal', () => {
  async function openPlateCalc(page: Page) {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);
    // The plate-calc button lives inside set 1 of the first exercise.
    await page.locator('[data-testid^="plate-calc-btn-"]').first().click();
    await expect(page.getByTestId('barbell-visual')).toBeVisible({ timeout: 5_000 });
  }

  test('target above 1000 is capped at 1000 kg', async ({ page }) => {
    await openPlateCalc(page);
    const target = page.getByTestId('plate-target');
    await target.fill('99999');
    await expect(target).toHaveValue('1000');
  });

  test('bar weight above 30 is capped at 30 kg', async ({ page }) => {
    await openPlateCalc(page);
    const bar = page.getByTestId('plate-bar');
    await bar.fill('999');
    await expect(bar).toHaveValue('30');
  });

  test('collar weight above 10 is capped at 10 kg', async ({ page }) => {
    await openPlateCalc(page);
    const collar = page.getByTestId('plate-collar');
    await collar.fill('999');
    await expect(collar).toHaveValue('10');
  });

  test('Apply button emits the clamped value to the source set', async ({ page }) => {
    await openPlateCalc(page);
    const target = page.getByTestId('plate-target');
    await target.fill('9999');
    // Apply — clamped 1000 should land in the originating set's load input.
    await page.getByTestId('plate-apply-btn').click();
    const setInput = page.locator('[data-testid$="-set-1-load"]').first();
    await expect(setInput).toHaveValue('1000');
  });
});

// ─── Progressive overload — last-week reference ──────────────────────────────

test.describe('Last-week reference inside the workout logger', () => {
  test('week 2 / day 1 surfaces week-1 set numbers for the same exercise', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    // Resolve the Back Squat exercise's per-set hints. The chip's testid
    // pattern is `prev-week-<exerciseId>-<setN>`. We don't know the
    // exerciseId from outside, so we walk by index.
    const hint1 = page.locator('[data-testid^="prev-week-"][data-testid$="-1"]').first();
    const hint2 = page.locator('[data-testid^="prev-week-"][data-testid$="-2"]').first();
    const hint3 = page.locator('[data-testid^="prev-week-"][data-testid$="-3"]').first();

    await expect(hint1).toBeVisible({ timeout: 5_000 });
    await expect(hint1).toContainText('100');
    await expect(hint1).toContainText('7');

    await expect(hint2).toContainText('102.5');
    await expect(hint2).toContainText('7.5');

    await expect(hint3).toContainText('105');
    await expect(hint3).toContainText('8');
  });

  test('week 1 shows NO last-week hint (there is no prior week)', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 1, 1);

    // No `prev-week-*` chip should render anywhere in week 1.
    const anyHint = page.locator('[data-testid^="prev-week-"]');
    await expect(anyHint).toHaveCount(0);
  });

  test('exercise without a week-1 match (different name) shows no hint', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    // Romanian Deadlift is the SECOND exercise in our fixture; week 1 has
    // it too with no per-set values seeded. Confirm: the RDL row should
    // not render hints (since week-1 RDL had empty values).
    // Identify it by the exercise card whose header contains "Romanian".
    const rdlSection = page.locator('section').filter({
      has: page.getByText('Romanian Deadlift'),
    });
    await expect(rdlSection).toBeVisible();
    const hintsInside = rdlSection.locator('[data-testid^="prev-week-"]');
    await expect(hintsInside).toHaveCount(0);
  });

  test('chip labels the prior week as "Last week" when it IS the immediately-prior week', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    const hint = page.locator('[data-testid^="prev-week-"][data-testid$="-1"]').first();
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Last week');
    // The data attribute carries the actual week number for downstream
    // tests / debugging.
    await expect(hint).toHaveAttribute('data-prev-week-number', '1');
  });

  test('walks back past a skipped week — chip says "Week 1" when on week 3 and week 2 was skipped', async ({ page }) => {
    // Build a 3-week program where week 2 has NO logged actuals on Squat.
    // Opening week 3 day 1 should surface week 1's data and label honestly.
    const state = buildTraineeStateWithWeek1Actuals();
    const program = state.programs[0];
    // Append a week 3 mirroring the structure of weeks 1+2 but with empty actuals.
    const w1Source = program.weeks[0];
    const w3: MockWeek = {
      id: 'week-3',
      program_id: program.id,
      week_number: 3,
      days: w1Source.days.map((d) => ({
        id: `week-3-${d.id}`,
        week_id: 'week-3',
        day_number: d.day_number,
        name: d.name,
        logged_at: null,
        exercises: d.exercises.map((ex, i) => ({
          ...ex,
          id: `week-3-${ex.id}-${i}`,
          day_id: `week-3-${d.id}`,
          actual_load: null,
          actual_rpe: null,
          values: {},
        })),
      })),
    };
    program.weeks.push(w3);
    await installAndLogin(page, state);

    await openWeekDay(page, 3, 1);
    const hint = page.locator('[data-testid^="prev-week-"][data-testid$="-1"]').first();
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Week 1');
    await expect(hint).not.toContainText('Last week');
    await expect(hint).toHaveAttribute('data-prev-week-number', '1');
    // The data itself is week 1's: 100 kg, RPE 7.
    await expect(hint).toContainText('100');
    await expect(hint).toContainText('7');
  });
});

// ─── Progressive-overload delta arrow ────────────────────────────────────────

test.describe('Last-week delta arrow — current vs prior load', () => {
  test('typing 110 above last week\'s 100 shows ↑ +10 kg badge', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    const loadInput = page.locator('[data-testid$="-set-1-load"]').first();
    await loadInput.fill('110');

    const delta = page
      .locator('[data-testid^="prev-week-delta-"][data-testid$="-1"]')
      .first();
    await expect(delta).toBeVisible();
    await expect(delta).toHaveAttribute('data-delta-direction', 'up');
    await expect(delta).toContainText('+10');
  });

  test('typing 90 below last week\'s 100 shows ↓ -10 kg badge', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    const loadInput = page.locator('[data-testid$="-set-1-load"]').first();
    await loadInput.fill('90');

    const delta = page
      .locator('[data-testid^="prev-week-delta-"][data-testid$="-1"]')
      .first();
    await expect(delta).toBeVisible();
    await expect(delta).toHaveAttribute('data-delta-direction', 'down');
    await expect(delta).toContainText('-10');
  });

  test('typing the same 100 as last week shows = same badge', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    const loadInput = page.locator('[data-testid$="-set-1-load"]').first();
    await loadInput.fill('100');

    const delta = page
      .locator('[data-testid^="prev-week-delta-"][data-testid$="-1"]')
      .first();
    await expect(delta).toBeVisible();
    await expect(delta).toHaveAttribute('data-delta-direction', 'same');
    await expect(delta).toContainText('same');
  });

  test('delta badge is hidden until the trainee enters today\'s load', async ({ page }) => {
    await loginAsTraineeWithSeededWeek1(page);
    await openWeekDay(page, 2, 1);

    // Before any input — chip exists, but no delta badge.
    const hint = page.locator('[data-testid^="prev-week-"][data-testid$="-1"]').first();
    await expect(hint).toBeVisible();
    const delta = page
      .locator('[data-testid^="prev-week-delta-"][data-testid$="-1"]');
    await expect(delta).toHaveCount(0);
  });
});
