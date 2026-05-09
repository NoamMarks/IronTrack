import { test, expect } from '@playwright/test';
import { installMockSupabase, defaultMockState, type MockState } from './fixtures/mockSupabase';

/**
 * AppShell — Account Settings modal (name + password update).
 *
 * The authenticated nav exposes a button bearing the user's display name
 * (testid `open-settings-btn`). Clicking it opens the AccountSettings
 * modal with two sections:
 *   1. Display Name — PATCHes profiles.name via Supabase, fires onUpdated,
 *      surfaces a green toast `settings-toast`.
 *   2. Change Password — supabase.auth.updateUser({ password }), surfaces
 *      `settings-pw-success` on success or `settings-pw-error` on
 *      validation failure / Supabase error.
 *
 * The mockSupabase fixture's generic chain returns success for both, so we
 * focus on UI plumbing here: the modal opens, inputs accept text, the save
 * button enables/disables on dirty-state, validation errors surface for
 * invalid passwords, and the success affordances render.
 */

async function openSettingsModal(page: import('@playwright/test').Page, state: MockState) {
  await installMockSupabase(page, state);
  await page.goto('/');
  // Coach lands on the Clients list — the user button shows their name.
  await expect(page.getByTestId('open-settings-btn')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('open-settings-btn').click();
  // Modal mounts — name input is the canonical anchor.
  await expect(page.getByTestId('settings-name-input')).toBeVisible({ timeout: 5_000 });
}

test.describe('Account Settings — display name', () => {
  test('Save button is disabled until the name input is dirty (different from current)', async ({ page }) => {
    const state = defaultMockState();
    await openSettingsModal(page, state);

    const input = page.getByTestId('settings-name-input');
    const save = page.getByTestId('settings-name-save');

    // Pre-fill matches user.name → save disabled.
    await expect(input).toHaveValue(state.authedUser.name);
    await expect(save).toBeDisabled();

    // Type a new name → enable.
    await input.fill('Updated Coach Name');
    await expect(save).toBeEnabled();

    // Restore original → disable again.
    await input.fill(state.authedUser.name);
    await expect(save).toBeDisabled();
  });

  test('saving a new name fires a PATCH on profiles and surfaces the success toast', async ({ page }) => {
    const state = defaultMockState();
    await installMockSupabase(page, state);

    let patchedName: string | null = null;
    page.on('request', (req) => {
      if (req.method() !== 'PATCH') return;
      if (!/\/rest\/v1\/profiles/.test(req.url())) return;
      try {
        const body = req.postDataJSON() as { name?: string };
        if (body && 'name' in body) patchedName = body.name ?? null;
      } catch {
        // ignore non-JSON bodies
      }
    });

    await page.goto('/');
    await page.getByTestId('open-settings-btn').click();
    await page.getByTestId('settings-name-input').fill('Coach New Identity');
    await page.getByTestId('settings-name-save').click();

    await page.waitForTimeout(400);
    expect(patchedName).toBe('Coach New Identity');
    // Component fires `onUpdated` on success which closes the modal — but
    // the toast is visible briefly in the parent AppShell's Toast slot, OR
    // (when the modal stays open due to async timing) inside the modal at
    // testid `settings-toast`. We accept either path.
    await expect(
      page
        .getByTestId('settings-toast')
        .or(page.getByText(/Name updated/i))
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Account Settings — change password', () => {
  test('weak password (too short) surfaces a validation error and never calls Supabase', async ({ page }) => {
    const state = defaultMockState();
    await installMockSupabase(page, state);

    let pwUpdateFired = false;
    page.on('request', (req) => {
      // supabase.auth.updateUser hits /auth/v1/user with a PUT.
      if (/\/auth\/v1\/user/.test(req.url()) && req.method() !== 'GET' && req.method() !== 'OPTIONS') {
        pwUpdateFired = true;
      }
    });

    await page.goto('/');
    await page.getByTestId('open-settings-btn').click();
    // The submit button needs all three fields populated to enable.
    await page.getByTestId('settings-pw-current').fill('OldPassword1');
    await page.getByTestId('settings-pw-new').fill('short1'); // 6 chars — too short
    await page.getByTestId('settings-pw-confirm').fill('short1');
    await page.getByTestId('settings-pw-submit').click();

    await expect(page.getByTestId('settings-pw-error')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('settings-pw-error')).toContainText(/at least 8 characters/i);
    expect(pwUpdateFired).toBe(false);
  });

  test('mismatched new + confirm password surfaces the mismatch error', async ({ page }) => {
    await openSettingsModal(page, defaultMockState());

    await page.getByTestId('settings-pw-current').fill('OldPassword1');
    await page.getByTestId('settings-pw-new').fill('GoodPass123');
    await page.getByTestId('settings-pw-confirm').fill('DifferentPass123');
    await page.getByTestId('settings-pw-submit').click();

    await expect(page.getByTestId('settings-pw-error')).toBeVisible();
    await expect(page.getByTestId('settings-pw-error')).toContainText(/do not match/i);
  });

  test('a valid password change shows the success affordance and clears the inputs', async ({ page }) => {
    await openSettingsModal(page, defaultMockState());

    await page.getByTestId('settings-pw-current').fill('OldPassword1');
    await page.getByTestId('settings-pw-new').fill('BrandNewPass123');
    await page.getByTestId('settings-pw-confirm').fill('BrandNewPass123');
    await page.getByTestId('settings-pw-submit').click();

    await expect(page.getByTestId('settings-pw-success')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('settings-pw-success')).toContainText(/password updated/i);
    // All three fields reset to empty after a successful update.
    await expect(page.getByTestId('settings-pw-current')).toHaveValue('');
    await expect(page.getByTestId('settings-pw-new')).toHaveValue('');
    await expect(page.getByTestId('settings-pw-confirm')).toHaveValue('');
  });

  test('Update Password button is disabled until all three password fields are populated', async ({ page }) => {
    await openSettingsModal(page, defaultMockState());

    const submit = page.getByTestId('settings-pw-submit');
    await expect(submit).toBeDisabled();

    await page.getByTestId('settings-pw-current').fill('OldPassword1');
    await expect(submit).toBeDisabled();

    await page.getByTestId('settings-pw-new').fill('GoodPass123');
    await expect(submit).toBeDisabled();

    await page.getByTestId('settings-pw-confirm').fill('GoodPass123');
    await expect(submit).toBeEnabled();
  });
});
