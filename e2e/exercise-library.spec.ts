import { test, expect } from '@playwright/test';
import { installMockSupabase, defaultMockState } from './fixtures/mockSupabase';

/**
 * Exercise Combobox — typeahead filter + selection populates the input.
 *
 * Component contract (per src/components/admin/ExerciseCombobox.tsx):
 *   - <input data-testid="exercise-combobox-input">
 *   - Each option exposes data-testid={`exercise-combobox-option-${id}`}
 *   - Selecting an option fires onSelect(name, videoUrl) — the parent
 *     (ProgramEditor) uses this to populate both the row name and the
 *     row's video URL in a single update. The video URL is consumed
 *     internally by the parent; the visible-side observable is the input
 *     value updating to the picked exercise's name, which we assert here.
 */

test.describe('Exercise Combobox — library-backed picker', () => {
  test('typeahead filters suggestions to matching library rows', async ({ page }) => {
    await installMockSupabase(page, defaultMockState());

    await page.goto('/');
    await expect(page.getByText('Sarah Cohen').first()).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sarah Cohen').first().click();
    await page.getByTestId('admin-btn').click();
    await expect(page.getByText(/Admin Panel/i)).toBeVisible({ timeout: 10_000 });

    // The first exercise row's name input is the combobox trigger.
    const combo = page.getByTestId('exercise-combobox-input').first();
    await combo.click();
    await combo.fill('Squat');

    // The seed library has "Low Bar Back Squat" as a global → matches.
    // "Conventional Deadlift" is also a global but should NOT match the
    // 'Squat' filter.
    await expect(page.getByTestId('exercise-combobox-option-lib-global-1')).toBeVisible();
    await expect(page.getByTestId('exercise-combobox-option-lib-global-3')).toBeHidden();
  });

  test('selecting a suggestion populates the row input', async ({ page }) => {
    await installMockSupabase(page, defaultMockState());

    await page.goto('/');
    await expect(page.getByText('Sarah Cohen').first()).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sarah Cohen').first().click();
    await page.getByTestId('admin-btn').click();
    await expect(page.getByText(/Admin Panel/i)).toBeVisible({ timeout: 10_000 });

    const combo = page.getByTestId('exercise-combobox-input').first();
    await combo.click();
    await combo.fill('Conventional');
    await page.getByTestId('exercise-combobox-option-lib-global-3').click();

    // After selection the dropdown closes and the parent's onChange fires
    // with the picked name, so the controlled input now reads the full
    // library exercise name. The video URL is wired separately via
    // onSelect's second arg and consumed internally by ProgramEditor — not
    // surfaced as a testable DOM attribute on the row.
    await expect(combo).toHaveValue('Conventional Deadlift');
  });
});
