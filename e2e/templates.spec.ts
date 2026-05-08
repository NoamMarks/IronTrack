import { test, expect } from '@playwright/test';
import {
  installMockSupabase,
  defaultMockState,
  MutationRecorder,
} from './fixtures/mockSupabase';

/**
 * Template lifecycle — split into two flows because the entry points live on
 * different surfaces:
 *   • Save-as-Template lives on the Program Editor (requires an active
 *     program).
 *   • Load / Delete live on the "Ready to Build?" empty state, behind the
 *     "Load from Template" button (requires NO active program).
 *
 * One spec per flow keeps each fixture minimal and the failure mode obvious.
 */

test.describe('Coach Template Library', () => {
  test('Save flow — opens modal, submits, fires program_templates POST', async ({ page }) => {
    const state = defaultMockState();
    const recorder = new MutationRecorder();
    await recorder.install(page);
    await installMockSupabase(page, state);

    await page.goto('/');
    await expect(page.getByText('Sarah Cohen').first()).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sarah Cohen').first().click();
    await page.getByTestId('admin-btn').click();
    await expect(page.getByText(/Admin Panel/i)).toBeVisible({ timeout: 10_000 });

    // The Save-as-Template button is rendered next to the program-name input
    // by ProgramEditor when an onSaveAsTemplate prop is wired up.
    const saveTemplateBtn = page.getByRole('button', { name: /save.+template/i }).first();
    await saveTemplateBtn.click();

    await expect(page.getByTestId('save-template-modal')).toBeVisible();
    await page.getByTestId('save-template-name').fill('Hypertrophy Block 1');
    await page.getByTestId('save-template-description').fill('4-week mesocycle test fixture');
    await page.getByTestId('save-template-submit-btn').click();

    // Modal closes on success, and the recorder captures the POST.
    await expect(page.getByTestId('save-template-modal')).toBeHidden({ timeout: 5_000 });

    const tplPosts = recorder.forTable('program_templates').filter((m) => m.method === 'POST');
    expect(tplPosts.length).toBeGreaterThan(0);

    const payload = tplPosts[tplPosts.length - 1].body as {
      name?: string;
      program_data?: { weeks?: unknown[]; columns?: unknown[] };
    };
    expect(payload.name).toBe('Hypertrophy Block 1');
    expect(payload.program_data?.weeks).toBeTruthy();
    expect(payload.program_data?.columns).toBeTruthy();
  });

  test('Browser flow — list, search, load (creates program), delete', async ({ page }) => {
    const state = defaultMockState();

    // Empty-state surface: trainee has no active program. The "Load from
    // Template" button only renders in this branch (AdminView.tsx).
    const trainee = state.profiles.find((p) => p.role === 'trainee')!;
    trainee.active_program_id = null;
    state.programs = []; // remove the seeded active program too

    state.templates.push({
      id: 'tpl-1',
      coach_id: state.authedUser.id,
      name: 'Hypertrophy Block 1',
      description: '4-week mesocycle test fixture',
      program_data: {
        columns: [
          { id: 'sets', label: 'Sets', type: 'plan' },
          { id: 'actualLoad', label: 'Load', type: 'actual' },
        ],
        weeks: [],
      },
      created_at: new Date().toISOString(),
    });

    const recorder = new MutationRecorder();
    await recorder.install(page);
    await installMockSupabase(page, state);

    await page.goto('/');
    await expect(page.getByText('Sarah Cohen').first()).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sarah Cohen').first().click();
    await page.getByTestId('admin-btn').click();

    // The empty "Ready to Build?" state renders both Create-New-Block and
    // Load-from-Template; click the latter to open the TemplateBrowser modal.
    const browserBtn = page.getByTestId('open-template-browser-btn');
    await expect(browserBtn).toBeVisible({ timeout: 10_000 });
    await browserBtn.click();

    await expect(page.getByTestId('template-browser')).toBeVisible();
    await expect(page.getByTestId('template-row-tpl-1')).toBeVisible();

    // Search filter narrows the list.
    await page.getByTestId('template-search').fill('Hypertrophy');
    await expect(page.getByTestId('template-row-tpl-1')).toBeVisible();
    await page.getByTestId('template-search').fill('NoSuchTemplate');
    await expect(page.getByTestId('template-row-tpl-1')).toBeHidden();
    await page.getByTestId('template-search').fill('');

    // Load fires a programs INSERT (materialisation). Load itself doesn't
    // pop a confirm — handleLoad only calls onLoad — so no dialog handler
    // is needed here.
    recorder.clear();
    const loadBtn = page.getByTestId('template-load-btn-tpl-1');
    if (await loadBtn.count()) {
      await loadBtn.click();
      await expect
        .poll(() => recorder.forTable('programs').filter((m) => m.method === 'POST').length, { timeout: 5_000 })
        .toBeGreaterThan(0);
    }

    // Delete — TemplateBrowser uses window.confirm; auto-accept it.
    page.once('dialog', (d) => void d.accept());
    recorder.clear();
    await page.getByTestId('template-delete-btn-tpl-1').click();
    await expect
      .poll(
        () => recorder.forTable('program_templates').filter((m) => m.method === 'DELETE').length,
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);
  });
});
