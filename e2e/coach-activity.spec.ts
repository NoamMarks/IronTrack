import { test, expect } from '@playwright/test';
import { installMockSupabase, defaultMockState } from './fixtures/mockSupabase';

/**
 * Coach Recent Activity panel — verifies that a day with a non-null
 * `reflection_at` renders as an entry in the AdminView sidebar.
 *
 * Real-time (Supabase channels) is not exercised here — the mock layer
 * fulfils REST GETs only; channel subscription falls through to no-op.
 * The fetch path is what actually populates the panel on initial render
 * and after a refetch, so verifying the post-fetch render covers the
 * meaningful coach-side surface.
 *
 * Note on the mock: useRecentActivity uses a PostgREST embedded select
 * (`days` joined to `weeks!inner.programs!inner`) which the generic mock
 * fixture doesn't synthesise — the GET handler returns bare day rows.
 * The "with reflections" test installs a route override for `**​/rest/v1/days*`
 * specifically to return rows shaped the way the hook normalises them.
 */

const MOCK_PROFILES_PATH = /\/rest\/v1\/profiles/;

test.describe('Coach Recent Activity panel', () => {
  test('renders trainee reflections from the active tenant', async ({ page }) => {
    const state = defaultMockState();
    const coach = state.authedUser; // defaultMockState authedUser is the coach
    const trainee = state.profiles.find((p) => p.role === 'trainee')!;
    const program = state.programs[0];
    const day = program.weeks[0].days[0];
    const reflectionAt = new Date(Date.now() - 60_000).toISOString();

    await installMockSupabase(page, state);

    // Override the days GET specifically to return the embedded shape that
    // useRecentActivity expects. installMockSupabase already registered a
    // generic `**​/rest/v1/**` route; later page.route() registrations take
    // precedence so this override wins for `days` GETs only.
    await page.route('**/rest/v1/days*', async (route) => {
      const req = route.request();
      if (req.method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        headers: {
          'access-control-allow-origin': '*',
          'content-type': 'application/json',
        },
        body: JSON.stringify([
          {
            id: day.id,
            name: day.name,
            difficulty: 4,
            reflection_note: 'Felt heavy today, grindy 3rd set on squat.',
            reflection_at: reflectionAt,
            logged_at: new Date(Date.now() - 5 * 60_000).toISOString(),
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
          },
        ]),
      });
    });

    // The hook does a follow-up `from('profiles').select('id, name').in('id', [...])`
    // to resolve trainee names — the generic profiles handler already returns
    // state.profiles, so the trainee lookup works without a second override.
    void MOCK_PROFILES_PATH;

    await page.goto('/');
    await expect(page.getByText('Sarah Cohen').first()).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sarah Cohen').first().click();
    await page.getByTestId('admin-btn').click();

    const panel = page.getByTestId('recent-activity-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const entry = page.getByTestId(`activity-entry-${day.id}`);
    await expect(entry).toBeVisible({ timeout: 10_000 });
    await expect(entry).toContainText('Felt heavy today');
    // difficulty 4 → "Brutal" pill via DifficultyPill in RecentActivityPanel.
    await expect(entry).toContainText(/brutal/i);
  });

  test('empty tenant shows the explanatory empty state', async ({ page }) => {
    const state = defaultMockState();
    // No reflection_at on any day — the hook returns zero entries.
    await installMockSupabase(page, state);

    await page.goto('/');
    await page.getByText('Sarah Cohen').first().click();
    await page.getByTestId('admin-btn').click();

    const panel = page.getByTestId('recent-activity-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/no reflections yet/i);
  });
});
