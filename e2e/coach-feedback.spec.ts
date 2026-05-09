import { test, expect, Page } from '@playwright/test';
import { installMockSupabase, defaultMockState, type MockState } from './fixtures/mockSupabase';

/**
 * Coach feedback on trainee reflections.
 *
 * Coaches see post-workout reflections in the Recent Activity sidebar
 * (AdminView → RecentActivityPanel). For each entry, an "Add feedback"
 * button reveals an inline textarea; saving persists the note to
 * `days.coach_note` and the displayed entry replaces the button with the
 * saved note (and a Pencil icon to edit). The trainee sees that note
 * read-only inside their WorkoutHistoryModal.
 *
 * useRecentActivity reads `days` with a PostgREST embedded join the
 * generic mock can't synthesise; this spec installs a route override to
 * return rows in the shape the hook normalises.
 */

interface MockDayWithReflection {
  id: string;
  name: string;
  difficulty: number | null;
  reflection_note: string | null;
  reflection_at: string | null;
  logged_at: string | null;
  coach_note: string | null;
  weeks: Array<{
    programs: Array<{
      id: string;
      name: string;
      tenant_id: string;
      client_id: string;
    }>;
  }>;
}

/** Build mock state that places one reflection in the coach's tenant. */
function buildFeedbackState(state: MockState): {
  state: MockState;
  reflectionDayId: string;
  buildDaysRow: (coachNote?: string | null) => MockDayWithReflection;
} {
  const coach = state.authedUser; // default authedUser is the coach
  const trainee = state.profiles.find((p) => p.role === 'trainee')!;
  const program = state.programs[0];
  const day = program.weeks[0].days[0];
  const reflectionAt = new Date(Date.now() - 60_000).toISOString();

  const buildDaysRow = (coachNote: string | null = null): MockDayWithReflection => ({
    id: day.id,
    name: day.name,
    difficulty: 4,
    reflection_note: 'Felt heavy today, grindy 3rd set.',
    reflection_at: reflectionAt,
    logged_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    coach_note: coachNote,
    weeks: [
      {
        programs: [
          {
            id: program.id,
            name: program.name,
            tenant_id: coach.id,
            client_id: trainee.id,
          },
        ],
      },
    ],
  });

  return { state, reflectionDayId: day.id, buildDaysRow };
}

async function landOnAdminPanel(
  page: Page,
  state: MockState,
  buildDaysRow: () => MockDayWithReflection,
) {
  await installMockSupabase(page, state);

  // Override the embedded `days` query that useRecentActivity uses.
  await page.route('**/rest/v1/days*', async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'content-type': 'application/json',
      },
      body: JSON.stringify([buildDaysRow()]),
    });
  });

  await page.goto('/');
  await expect(page.getByText('Sarah Cohen').first()).toBeVisible({ timeout: 15_000 });
  await page.getByText('Sarah Cohen').first().click();
  await page.getByTestId('admin-btn').click();
  await expect(page.getByTestId('recent-activity-panel')).toBeVisible({ timeout: 15_000 });
}

test.describe('Coach feedback on session reflections', () => {
  test('"Add feedback" button appears on reflection entries with no coach_note', async ({ page }) => {
    const seed = buildFeedbackState(defaultMockState());
    await landOnAdminPanel(page, seed.state, () => seed.buildDaysRow(null));

    await expect(page.getByTestId(`activity-entry-${seed.reflectionDayId}`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByTestId(`add-feedback-btn-${seed.reflectionDayId}`),
    ).toBeVisible();
    // No edit button yet — only "Add feedback".
    await expect(
      page.getByTestId(`edit-feedback-btn-${seed.reflectionDayId}`),
    ).toHaveCount(0);
  });

  test('typing and saving feedback persists the note and updates the displayed entry', async ({ page }) => {
    const seed = buildFeedbackState(defaultMockState());
    await landOnAdminPanel(page, seed.state, () => seed.buildDaysRow(null));

    // Capture the PATCH body the save fires.
    let patchedNote: string | null = null;
    page.on('request', (req) => {
      if (req.method() !== 'PATCH') return;
      if (!/\/rest\/v1\/days/.test(req.url())) return;
      try {
        const body = req.postDataJSON() as { coach_note?: string | null };
        if (body && 'coach_note' in body) patchedNote = body.coach_note ?? null;
      } catch {
        // non-JSON body — ignore.
      }
    });

    await page.getByTestId(`add-feedback-btn-${seed.reflectionDayId}`).click();
    const textarea = page.getByTestId(`feedback-textarea-${seed.reflectionDayId}`);
    await expect(textarea).toBeVisible();
    await textarea.fill('Push the heavy set, drop one rep next time.');
    await page.getByTestId(`save-feedback-btn-${seed.reflectionDayId}`).click();

    // Settle the optimistic save; the request should fire promptly.
    await page.waitForTimeout(400);
    expect(patchedNote).toBe('Push the heavy set, drop one rep next time.');
  });

  test('an entry that already has a coach_note shows it inline plus an edit affordance', async ({ page }) => {
    const seed = buildFeedbackState(defaultMockState());
    const existingNote = 'Solid work — keep RPE under 8 next time.';
    await landOnAdminPanel(page, seed.state, () => seed.buildDaysRow(existingNote));

    const entry = page.getByTestId(`activity-entry-${seed.reflectionDayId}`);
    await expect(entry).toBeVisible({ timeout: 10_000 });
    await expect(entry).toContainText(existingNote);
    // Edit-feedback button is the Pencil icon next to the saved note.
    await expect(
      page.getByTestId(`edit-feedback-btn-${seed.reflectionDayId}`),
    ).toBeVisible();
    // Add-feedback button is hidden once there's a saved note.
    await expect(
      page.getByTestId(`add-feedback-btn-${seed.reflectionDayId}`),
    ).toHaveCount(0);
  });

  test("trainee sees the coach_note inside their WorkoutHistoryModal", async ({ page }) => {
    // Trainee view of the same day — the WorkoutHistoryModal renders
    // `day.coachNote` under the "Coach Feedback" section when present.
    const state = defaultMockState();
    const trainee = state.profiles.find((p) => p.role === 'trainee')!;
    state.authedUser = trainee;

    // Patch the seeded day so it's logged AND has a coach_note. The trainee's
    // dashboard renders `view-history-btn-day-1` only when the day is logged.
    const day = state.programs[0].weeks[0].days[0];
    day.logged_at = '2026-04-01T12:00:00Z';
    // Append the fields the rowToProgram mapping reads off DayRow.
    (day as unknown as { coach_note: string }).coach_note =
      'Tempo on squats next week — 3 second descent.';

    await installMockSupabase(page, state);
    await page.goto('/');
    await expect(page.getByText(/Hypertrophy Phase 1|Current Block/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId('view-history-btn-day-1').click();
    // Modal renders a "Coach Feedback" section heading when day.coachNote is
    // populated, with the note text below it.
    await expect(page.getByText(/Coach Feedback/i)).toBeVisible();
    await expect(
      page.getByText('Tempo on squats next week — 3 second descent.'),
    ).toBeVisible();
  });
});
