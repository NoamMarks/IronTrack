import { test, expect, Page, Locator } from '@playwright/test';
import { installMockSupabase, defaultMockState } from './fixtures/mockSupabase';

/**
 * Program Editor — exercise reordering.
 *
 * Each exercise row in the editor renders a vertical stack of two icon
 * buttons (ChevronUp / ChevronDown) in the leading 36px column. The first
 * exercise has its Up button disabled; the last has its Down disabled.
 * Clicking Down on the first exercise should swap it past the second.
 *
 * The buttons have no data-testids today — this spec keys off the row's
 * grid layout (the same approach used by program-editor.spec.ts).
 */

async function gotoAdminProgramEditor(page: Page) {
  const state = defaultMockState();
  await installMockSupabase(page, state);
  await page.goto('/');
  await expect(page.getByText('Sarah Cohen').first()).toBeVisible({ timeout: 15_000 });
  await page.getByText('Sarah Cohen').first().click();
  await page.getByTestId('admin-btn').click();
  await expect(page.getByText(/Admin Panel/i)).toBeVisible({ timeout: 15_000 });
}

/** Each exercise row is `div.grid` inside `.space-y-2` (one .space-y-2 per
 *  day). The first two rows = week-1 / day-1 / [exercise 1, exercise 2]. */
function exerciseRow(page: Page, n: number): Locator {
  return page.locator('.space-y-2 > div.grid').nth(n);
}

/** Buttons inside the row's reorder column — the first <button> is Up,
 *  the second is Down. The reorder column is the leading flex-col stack. */
function reorderButtons(row: Locator) {
  const stack = row.locator('div.flex.flex-col').first();
  return {
    up: stack.locator('button').nth(0),
    down: stack.locator('button').nth(1),
  };
}

/** Read the value of the row's exercise-name input (the first <input> in
 *  the row) — used to assert order swaps. */
async function rowName(row: Locator): Promise<string | null> {
  return row.locator('input').first().inputValue();
}

test.describe('Program Editor — exercise reordering', () => {
  test('first exercise has its Up button disabled', async ({ page }) => {
    await gotoAdminProgramEditor(page);

    const first = exerciseRow(page, 0);
    await expect(first.locator('input').first()).toHaveValue('Back Squat');

    const { up } = reorderButtons(first);
    await expect(up).toBeDisabled();
  });

  test('last exercise of the day has its Down button disabled', async ({ page }) => {
    await gotoAdminProgramEditor(page);

    // The default mock seeds 2 exercises per day. Row 1 (0-indexed) is
    // therefore the LAST exercise of week-1 / day-1 — its Down button must
    // be disabled because there is nothing to swap with below it.
    const second = exerciseRow(page, 1);
    await expect(second.locator('input').first()).toHaveValue('Romanian Deadlift');

    const { down } = reorderButtons(second);
    await expect(down).toBeDisabled();
  });

  test('clicking Down on the first exercise moves it below the second', async ({ page }) => {
    await gotoAdminProgramEditor(page);

    const first = exerciseRow(page, 0);
    const second = exerciseRow(page, 1);
    expect(await rowName(first)).toBe('Back Squat');
    expect(await rowName(second)).toBe('Romanian Deadlift');

    const { down } = reorderButtons(first);
    await down.click();

    // After the swap, the rows have switched names.
    await expect(exerciseRow(page, 0).locator('input').first()).toHaveValue('Romanian Deadlift');
    await expect(exerciseRow(page, 1).locator('input').first()).toHaveValue('Back Squat');
  });
});
