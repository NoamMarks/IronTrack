import { test, expect, Page } from '@playwright/test';
import {
  installMockSupabase,
  defaultMockState,
  type MockState,
  type MockProfile,
  type MockProgramRow,
} from './fixtures/mockSupabase';

/**
 * Coach client list — compliance indicator dots.
 *
 * `getComplianceInfo` in App.tsx maps "days since last logged session" onto
 *   green  (bg-accent, plus animate-ping ring)  → ≤ 3 days
 *   amber  (bg-warning)                          → 4–7 days
 *   red    (bg-danger)                           → > 7 days OR no sessions
 *
 * The dots have no data-testids — they're decorative span elements inside
 * the trainee card. Tests pin them by walking up from the unique trainee
 * name to the card root, then querying for the colour class on the inner
 * span. Class-based selectors are intentional here because there's no
 * affordance for a testid that the user could click.
 */

/** Build a fresh mock state with three trainees, one per compliance bucket. */
function buildComplianceState(): MockState {
  const base = defaultMockState();
  const coachId = base.authedUser.id; // coach is the authed user in default state
  const today = new Date();

  const buildProgramFor = (
    clientId: string,
    daysAgo: number | null,
    programIdSuffix: string,
  ): MockProgramRow => {
    const lastLoggedAt = daysAgo === null
      ? null
      : new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    return {
      id: `program-${programIdSuffix}`,
      client_id: clientId,
      tenant_id: coachId,
      name: `Block — ${programIdSuffix}`,
      columns: [{ id: 'sets', label: 'Sets', type: 'plan' }],
      status: 'active',
      archived_at: null,
      created_at: today.toISOString(),
      weeks: [
        {
          id: `week-${programIdSuffix}-1`,
          program_id: `program-${programIdSuffix}`,
          week_number: 1,
          days: [
            {
              id: `day-${programIdSuffix}-1`,
              week_id: `week-${programIdSuffix}-1`,
              day_number: 1,
              name: 'Lower',
              logged_at: lastLoggedAt,
              exercises: [],
            },
          ],
        },
      ],
    };
  };

  const traineeGreen: MockProfile = {
    id: 'trainee-green',
    name: 'Green Trainee',
    email: 'green@irontrack.test',
    role: 'trainee',
    tenant_id: coachId,
    active_program_id: 'program-green',
  };
  const traineeRed: MockProfile = {
    id: 'trainee-red',
    name: 'Red Trainee',
    email: 'red@irontrack.test',
    role: 'trainee',
    tenant_id: coachId,
    active_program_id: 'program-red',
  };

  // Replace the default Sarah Cohen with our three-tier setup so the
  // assertions stay deterministic regardless of fixture defaults.
  const coach = base.profiles.find((p) => p.role === 'admin')!;
  const superadmin = base.profiles.find((p) => p.role === 'superadmin')!;

  return {
    ...base,
    authedUser: coach,
    profiles: [superadmin, coach, traineeGreen, traineeRed],
    programs: [
      // Green: logged today (0 days ago)
      buildProgramFor(traineeGreen.id, 0, 'green'),
      // Red: never logged (programs exist but no logged_at anywhere)
      buildProgramFor(traineeRed.id, null, 'red'),
    ],
  };
}

/** Locate the trainee card by walking up from the unique trainee name. */
function traineeCard(page: Page, name: string) {
  return page.locator('.cursor-pointer').filter({ hasText: name }).first();
}

test.describe('Coach client list — compliance indicator dots', () => {
  test('a trainee with a session logged today shows the green/accent indicator', async ({ page }) => {
    await installMockSupabase(page, buildComplianceState());

    await page.goto('/');
    // Wait for the coach client list to render with our seeded trainees.
    await expect(page.getByText('Green Trainee').first()).toBeVisible({ timeout: 15_000 });

    const card = traineeCard(page, 'Green Trainee');
    // Compliance dot is the inner span with the relevant bg-* class. The
    // green bucket maps to bg-accent.
    const dot = card.locator('span.bg-accent.rounded-full').first();
    await expect(dot).toBeVisible();
    // The "Last Trained" label for a same-day session reads "Today".
    await expect(card).toContainText(/today/i);
  });

  test('a trainee with no sessions shows the red/danger indicator', async ({ page }) => {
    await installMockSupabase(page, buildComplianceState());

    await page.goto('/');
    await expect(page.getByText('Red Trainee').first()).toBeVisible({ timeout: 15_000 });

    const card = traineeCard(page, 'Red Trainee');
    const dot = card.locator('span.bg-danger.rounded-full').first();
    await expect(dot).toBeVisible();
    await expect(card).toContainText(/no sessions/i);
  });

  test('the animate-ping ring is present on the green dot only', async ({ page }) => {
    await installMockSupabase(page, buildComplianceState());

    await page.goto('/');
    await expect(page.getByText('Green Trainee').first()).toBeVisible({ timeout: 15_000 });

    // Green card has the ping ring overlay (bg-accent/40 animate-ping).
    const greenCard = traineeCard(page, 'Green Trainee');
    const greenPing = greenCard.locator('span.animate-ping');
    await expect(greenPing).toHaveCount(1);

    // Red card MUST NOT render the ping ring (only green status does).
    const redCard = traineeCard(page, 'Red Trainee');
    const redPing = redCard.locator('span.animate-ping');
    await expect(redPing).toHaveCount(0);
  });
});
