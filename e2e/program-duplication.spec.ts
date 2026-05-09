import { test, expect } from '@playwright/test';
import {
  installMockSupabase,
  defaultMockState,
  MutationRecorder,
} from './fixtures/mockSupabase';

/**
 * Coach — program duplication.
 *
 * The "Duplicate Block" affordance lives in AdminView (testid
 * `duplicate-block-btn`). It clones the current editing program by:
 *   1. POSTing a new programs row with name `Copy of <original>`
 *   2. Inserting fresh weeks/days/exercises with the actuals stripped
 * The duplicate does NOT become the active program — the coach activates
 * it manually if/when ready.
 */

async function gotoAdminProgramEditor(page: import('@playwright/test').Page) {
  const state = defaultMockState();
  const recorder = new MutationRecorder();
  await recorder.install(page);
  await installMockSupabase(page, state);
  await page.goto('/');
  // Coach client list → click trainee → open admin.
  await expect(page.getByText('Sarah Cohen').first()).toBeVisible({ timeout: 15_000 });
  await page.getByText('Sarah Cohen').first().click();
  await page.getByTestId('admin-btn').click();
  await expect(page.getByText(/Admin Panel/i)).toBeVisible({ timeout: 15_000 });
  return { state, recorder };
}

test.describe('Coach — program duplication', () => {
  test('"Duplicate Block" button is visible in the AdminView header', async ({ page }) => {
    await gotoAdminProgramEditor(page);
    await expect(page.getByTestId('duplicate-block-btn')).toBeVisible();
  });

  test('clicking Duplicate Block POSTs a new program named "Copy of <original>"', async ({ page }) => {
    const { recorder, state } = await gotoAdminProgramEditor(page);
    const originalName = state.programs[0].name;

    recorder.clear();
    await page.getByTestId('duplicate-block-btn').click();

    // Wait for the duplicate flow to settle — the hook fires multiple
    // round-trips (programs → weeks → days → exercises). Settle time
    // also covers the small toast animation.
    await page.waitForTimeout(800);

    const programInserts = recorder.mutations.filter(
      (m) => m.table === 'programs' && (m.method === 'POST' || m.method === 'PATCH'),
    );
    expect(programInserts.length).toBeGreaterThan(0);

    const insertedNames = programInserts
      .flatMap((m) => (Array.isArray(m.body) ? m.body : [m.body]))
      .map((row) => (row as { name?: string } | null)?.name)
      .filter(Boolean);
    expect(insertedNames).toContain(`Copy of ${originalName}`);
  });

  test('the duplicated program appears in the client tree (post-success toast confirms)', async ({ page }) => {
    await gotoAdminProgramEditor(page);
    await page.getByTestId('duplicate-block-btn').click();

    // AdminView surfaces a toast on success — match the message it sets:
    // "Program duplicated successfully".
    await expect(page.getByText(/Program duplicated successfully/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('the duplicated exercises ship with the actuals stripped', async ({ page }) => {
    const { recorder } = await gotoAdminProgramEditor(page);

    recorder.clear();
    await page.getByTestId('duplicate-block-btn').click();
    await page.waitForTimeout(900);

    const exerciseRows = recorder.mutations
      .filter((m) => m.table === 'exercises' && m.method === 'POST')
      .flatMap((m) => (Array.isArray(m.body) ? m.body : [m.body])) as Array<Record<string, unknown>>;
    expect(exerciseRows.length).toBeGreaterThan(0);

    // Every duplicated exercise must come through with actuals nulled out
    // and values reset — the duplicate is a clean slate, not a clone of
    // any in-flight session.
    for (const row of exerciseRows) {
      expect(row.actual_load).toBeNull();
      expect(row.actual_rpe).toBeNull();
      expect(row.notes).toBeNull();
      expect(row.video_url).toBeNull();
      expect(row.values).toEqual({});
    }
  });
});
