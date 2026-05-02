import { test, expect, Page, Locator } from '@playwright/test';
import {
  installMockSupabase,
  defaultMockState,
  MutationRecorder,
} from './fixtures/mockSupabase';

/**
 * Program Editor — Hardening Sprint stress tests.
 *
 * The grid is the highest-traffic surface in the app and was the source of
 * the recent rubber-banding bug. These tests deliberately push it harder
 * than a real coach would: rapid add/delete cycles, simultaneous typing
 * across cells, garbage input, and unmount races. The mock layer pretends
 * the saves succeed so we can isolate the UI-state machine from network
 * latency.
 */

async function gotoAdminProgramEditor(page: Page) {
  const state = defaultMockState();
  const recorder = new MutationRecorder();
  await recorder.install(page);
  await installMockSupabase(page, state);
  await page.goto('/');
  await expect(page.getByText('Sarah Cohen').first()).toBeVisible({ timeout: 10_000 });
  await page.getByText('Sarah Cohen').first().click();
  await page.getByTestId('admin-btn').click();
  await expect(page.getByText(/Admin Panel/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('input').filter({ hasText: '' }).first()).toBeVisible();
  return { state, recorder };
}

/**
 * Stable locators for the program editor — keyed off DOM structure, not the
 * input's current value. Once a user fills an input, value-based selectors
 * resolve to the WRONG element on retry (any other input that happens to
 * still hold the original seed text).
 *
 *   row(n)           → the n-th exercise row (0-indexed) across the whole grid
 *   cellInput(row,c) → the c-th input inside that row (0 = name, 1.. = column)
 *   programNameInput → the program-title input in the toolbar
 */
function programNameInput(page: Page): Locator {
  // The toolbar wraps an Edit3 icon and a single input; the input is always
  // the first <input> on the page (rendered before the day name fields).
  return page.locator('input').first();
}

function exerciseRow(page: Page, n: number): Locator {
  // Each exercise row is a `div.grid` that lives inside the `.space-y-2`
  // container. There's one `.space-y-2` per day; we walk all rows in
  // document order so n=0 is week-1/day-1/exercise-1.
  return page.locator('.space-y-2 > div.grid').nth(n);
}

function cellInput(row: Locator, c: number): Locator {
  return row.locator('input').nth(c);
}

test.describe('Program Editor — rapid week/day churn', () => {
  test('add then immediately delete a week leaves the grid in a consistent state', async ({ page }) => {
    await gotoAdminProgramEditor(page);
    const initialWeekCount = await page.getByText(/^WEEK \d+$/).count();
    expect(initialWeekCount).toBe(2);

    // Add 3 weeks back-to-back without waiting between clicks.
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: '+ Add Week' }).click();
    }
    await expect(page.getByText(/^WEEK \d+$/)).toHaveCount(initialWeekCount + 3);

    // Delete the last 3 weeks back-to-back. Each delete cascades through
    // the visible grid; we want zero leftover headers.
    for (let i = 0; i < 3; i += 1) {
      const trash = page
        .locator('h3:has-text("WEEK") + button')
        .last();
      await trash.click();
    }
    await expect(page.getByText(/^WEEK \d+$/)).toHaveCount(initialWeekCount);
  });

  test('add then immediately delete a day leaves the grid in a consistent state', async ({ page }) => {
    await gotoAdminProgramEditor(page);
    const initialDayCount = await page.getByText(/^Day \d+$/).count();

    await page.getByRole('button', { name: '+ Add Day' }).first().click();
    // adding a day mirrors across all weeks — +1 per week.
    await expect(page.getByText(/^Day \d+$/)).toHaveCount(initialDayCount + 2);
  });
});

test.describe('Program Editor — rapid typing and debounce coalescing', () => {
  test('500ms debounce coalesces a typing burst into a single save tree', async ({ page }) => {
    const { recorder } = await gotoAdminProgramEditor(page);

    const exName = cellInput(exerciseRow(page, 0), 0);
    await expect(exName).toBeVisible();
    await expect(exName).toHaveValue('Back Squat');

    recorder.clear();

    // Type a burst of 8 characters with no waits in between.
    await exName.click();
    await exName.fill(''); // clear
    for (const ch of 'Squat 1A') {
      await exName.pressSequentially(ch, { delay: 20 });
    }

    // Input must reflect the typed value immediately — no rubber-band.
    await expect(exName).toHaveValue('Squat 1A');

    // Wait long enough for the debounce to flush and the request to land.
    await page.waitForTimeout(900);

    // Without debouncing, EACH keystroke would have fired its own
    // saveProgram → 8 keystrokes × ~8 PATCHes per save tree = ~64 PATCHes
    // on /exercises. With debouncing it's a single save tree (~8 PATCHes
    // for the 8 mock exercises across 2 weeks × 2 days). 20 is a
    // comfortable upper bound for "one tree" without false positives.
    const exerciseMutations = recorder
      .mutations
      .filter((m) => m.table === 'exercises' && m.method !== 'GET');
    expect(
      exerciseMutations.length,
      `Expected debounce to coalesce keystrokes; saw ${exerciseMutations.length} exercise mutations`,
    ).toBeLessThanOrEqual(20);

    // The input still shows the final value after the save settles —
    // no rubber-band back to a stale value.
    await expect(exName).toHaveValue('Squat 1A');
  });

  test('typing across multiple cells in parallel does not cross-contaminate', async ({ page }) => {
    await gotoAdminProgramEditor(page);

    // First exercise of week-1 day-1 (row 0) and second exercise of the
    // same day (row 1).
    const firstName = cellInput(exerciseRow(page, 0), 0);
    const secondName = cellInput(exerciseRow(page, 1), 0);
    await expect(firstName).toHaveValue('Back Squat');
    await expect(secondName).toHaveValue('Romanian Deadlift');

    await firstName.click();
    await firstName.fill('');
    await firstName.pressSequentially('Front Squat', { delay: 15 });

    await secondName.click();
    await secondName.fill('');
    await secondName.pressSequentially('Stiff-leg DL', { delay: 15 });

    await expect(firstName).toHaveValue('Front Squat');
    await expect(secondName).toHaveValue('Stiff-leg DL');

    // Settle past the debounce; values must persist.
    await page.waitForTimeout(900);
    await expect(firstName).toHaveValue('Front Squat');
    await expect(secondName).toHaveValue('Stiff-leg DL');
  });
});

test.describe('Program Editor — bad data input', () => {
  test('extremely large strings in exerciseName render without breaking the grid', async ({ page }) => {
    await gotoAdminProgramEditor(page);

    const huge = 'X'.repeat(1000);
    const exName = cellInput(exerciseRow(page, 0), 0);
    await exName.click();
    await exName.fill(huge);
    await expect(exName).toHaveValue(huge);
    // Row is still intact; column header still visible.
    await expect(page.getByText(/EXERCISE NAME/i).first()).toBeVisible();
  });

  test('negative numbers and special characters in numeric-looking columns are allowed but do not crash', async ({ page }) => {
    await gotoAdminProgramEditor(page);

    const setsCell = cellInput(exerciseRow(page, 0), 1); // 0=name, 1=sets

    const garbage = ['-9', '1e308', '!!@#$%^&*()', '"><script>alert(1)</script>'];
    for (const v of garbage) {
      await setsCell.click();
      await setsCell.fill(v);
      await expect(setsCell).toHaveValue(v);
      await expect(page.getByText(/EXERCISE NAME/i).first()).toBeVisible();
    }
  });

  test('a 10000-character paste into the program-name input is handled without dropping characters', async ({ page }) => {
    await gotoAdminProgramEditor(page);

    const pName = programNameInput(page);
    const giant = 'A'.repeat(10_000);
    await pName.click();
    await pName.fill(giant);
    await expect(pName).toHaveValue(giant);
  });
});

test.describe('Program Editor — unmount safety (debounce flush)', () => {
  test('typing then immediately archiving the program flushes the pending save', async ({ page }) => {
    const { recorder } = await gotoAdminProgramEditor(page);

    page.on('dialog', (d) => void d.accept());

    const exName = cellInput(exerciseRow(page, 0), 0);
    await exName.click();
    await exName.fill('Edited Right Before Archive');

    recorder.clear();

    await page.getByTestId('archive-block-btn').click();

    await page.waitForTimeout(700);
    const flushed = recorder.mutations.some(
      (m) => (m.table === 'exercises' || m.table === 'programs') && m.method !== 'GET',
    );
    expect(flushed, 'pending debounced save was not flushed before archive').toBe(true);
  });

  test('typing then immediately navigating away (Back) flushes the pending save', async ({ page }) => {
    const { recorder } = await gotoAdminProgramEditor(page);

    const exName = cellInput(exerciseRow(page, 0), 0);
    await exName.click();
    await exName.fill('Quick edit before nav away');

    recorder.clear();

    // The "Back" button is the first button inside the AdminView header.
    await page.locator('header button').first().click();

    await page.waitForTimeout(700);
    const flushed = recorder.mutations.some(
      (m) => (m.table === 'exercises' || m.table === 'programs') && m.method !== 'GET',
    );
    expect(flushed, 'pending debounced save was not flushed before unmount').toBe(true);
  });
});
