import type { Page } from '@playwright/test';

/**
 * Mock layer for Supabase + the local /api/* routes.
 *
 * The QA hardening suites need a deterministic, hermetic environment: a
 * known logged-in user, a known roster, a known program tree. Real Supabase
 * data isn't available in CI and would change under us anyway. This helper
 * intercepts every Supabase REST/auth call and every /api/* call at the
 * Playwright network layer, returning canned data so the React app behaves
 * exactly as it would in production but without touching the network.
 *
 * Coverage:
 *   - localStorage session (so useAuth.bootstrap finds a valid session)
 *   - /auth/v1/* (user, token refresh, logout) → success / canned user
 *   - /rest/v1/<table>?... (GET) → returns the in-memory rows for the table
 *   - /rest/v1/<table>?... (PATCH/POST/DELETE) → echo back the request body
 *     as a 200, so optimistic flows resolve. State is NOT persisted between
 *     calls — each test installs a fresh fixture.
 *   - /api/admin-create-user, /api/signup-user, /api/send-email → 200
 */

const PROJECT_REF = 'iwuhmafvnrtbbvxvhyrv'; // matches VITE_SUPABASE_URL
const FAR_FUTURE_EPOCH = 4070908800; // Jan 1 2099

export type MockRole = 'superadmin' | 'admin' | 'trainee';

export interface MockProfile {
  id: string;
  name: string;
  email: string;
  role: MockRole;
  tenant_id: string | null;
  active_program_id: string | null;
}

export interface MockExercise {
  id: string;
  day_id: string;
  position: number;
  exercise_id: string;
  exercise_name: string;
  sets: number | null;
  reps: string | null;
  expected_rpe: string | null;
  weight_range: string | null;
  actual_load: string | null;
  actual_rpe: string | null;
  notes: string | null;
  video_url: string | null;
  values: Record<string, string> | null;
}

export interface MockDay {
  id: string;
  week_id: string;
  day_number: number;
  name: string;
  logged_at: string | null;
  exercises: MockExercise[];
}

export interface MockWeek {
  id: string;
  program_id: string;
  week_number: number;
  days: MockDay[];
}

export interface MockProgramRow {
  id: string;
  client_id: string;
  tenant_id: string | null;
  name: string;
  columns: Array<{ id: string; label: string; type: 'plan' | 'actual' }> | null;
  status: 'active' | 'archived';
  archived_at: string | null;
  created_at: string;
  weeks: MockWeek[];
}

export interface MockInviteCode {
  id: string;
  code: string;
  tenant_id: string;
  coach_id: string;
  coach_name: string | null;
  created_at: string;
  max_uses: number | null;
  use_count: number;
}

export interface MockTemplateRow {
  id: string;
  coach_id: string;
  name: string;
  description: string | null;
  program_data: {
    columns: Array<{ id: string; label: string; type: 'plan' | 'actual' }>;
    weeks: Array<{ id: string; weekNumber: number; days: Array<{ id: string; dayNumber: number; name: string; exercises: unknown[] }> }>;
  };
  created_at: string;
}

export interface MockLibraryExerciseRow {
  id: string;
  coach_id: string | null;
  tenant_id: string | null;
  name: string;
  category: 'squat' | 'bench' | 'deadlift' | 'accessory';
  video_url: string | null;
  created_at: string;
}

export interface MockState {
  authedUser: MockProfile;
  profiles: MockProfile[];
  programs: MockProgramRow[];
  inviteCodes: MockInviteCode[];
  templates: MockTemplateRow[];
  libraryExercises: MockLibraryExerciseRow[];
}

/** Default fixture: superadmin with one coach + one trainee + a 2-week program. */
export function defaultMockState(): MockState {
  const superId = 'super-1';
  const coachId = 'coach-1';
  const traineeId = 'trainee-1';
  const programId = 'program-1';

  const buildExercise = (id: string, position: number): MockExercise => ({
    id,
    day_id: `day-${id}`,
    position,
    exercise_id: `ex-${id}`,
    exercise_name: position === 0 ? 'Back Squat' : 'Romanian Deadlift',
    sets: 3,
    reps: '8-10',
    expected_rpe: '7',
    weight_range: '70-80%',
    actual_load: null,
    actual_rpe: null,
    notes: null,
    video_url: null,
    values: {},
  });

  const buildDay = (weekId: string, dayId: string, dayNumber: number): MockDay => ({
    id: dayId,
    week_id: weekId,
    day_number: dayNumber,
    name: dayNumber === 1 ? 'Lower' : 'Upper',
    logged_at: null,
    exercises: [
      { ...buildExercise(`${dayId}-ex-1`, 0), day_id: dayId },
      { ...buildExercise(`${dayId}-ex-2`, 1), day_id: dayId },
    ],
  });

  const buildWeek = (weekId: string, weekNumber: number): MockWeek => ({
    id: weekId,
    program_id: programId,
    week_number: weekNumber,
    days: [
      buildDay(weekId, `${weekId}-day-1`, 1),
      buildDay(weekId, `${weekId}-day-2`, 2),
    ],
  });

  const program: MockProgramRow = {
    id: programId,
    client_id: traineeId,
    tenant_id: coachId,
    name: 'Hypertrophy Phase 1',
    columns: [
      { id: 'sets', label: 'Sets', type: 'plan' },
      { id: 'reps', label: 'Reps', type: 'plan' },
      { id: 'expectedRpe', label: 'RPE', type: 'plan' },
      { id: 'actualLoad', label: 'Load', type: 'actual' },
    ],
    status: 'active',
    archived_at: null,
    created_at: new Date().toISOString(),
    weeks: [buildWeek('week-1', 1), buildWeek('week-2', 2)],
  };

  const superProfile: MockProfile = {
    id: superId,
    name: 'Super Admin',
    email: 'super@irontrack.test',
    role: 'superadmin',
    tenant_id: null,
    active_program_id: null,
  };
  const coachProfile: MockProfile = {
    id: coachId,
    name: 'Coach Alpha',
    email: 'coach@irontrack.test',
    role: 'admin',
    tenant_id: coachId,
    active_program_id: null,
  };
  const traineeProfile: MockProfile = {
    id: traineeId,
    name: 'Sarah Cohen',
    email: 'sarah@irontrack.test',
    role: 'trainee',
    tenant_id: coachId,
    active_program_id: programId,
  };

  // Globals + a coach-private library row, mirroring the seed in the
  // 2026-05-09_exercise_library migration. Trimmed to a couple of rows per
  // category so visual tests can assert filtered counts deterministically.
  const libraryExercises: MockLibraryExerciseRow[] = [
    { id: 'lib-global-1', coach_id: null, tenant_id: null, name: 'Low Bar Back Squat',      category: 'squat',     video_url: 'https://www.youtube.com/@squatuniversity',          created_at: new Date().toISOString() },
    { id: 'lib-global-2', coach_id: null, tenant_id: null, name: 'Competition Bench Press', category: 'bench',     video_url: 'https://www.youtube.com/@JuggernautTrainingSystems', created_at: new Date().toISOString() },
    { id: 'lib-global-3', coach_id: null, tenant_id: null, name: 'Conventional Deadlift',   category: 'deadlift',  video_url: 'https://www.youtube.com/@JuggernautTrainingSystems', created_at: new Date().toISOString() },
    { id: 'lib-global-4', coach_id: null, tenant_id: null, name: 'Romanian Deadlift',       category: 'accessory', video_url: 'https://www.youtube.com/@JuggernautTrainingSystems', created_at: new Date().toISOString() },
    { id: 'lib-coach-1',  coach_id: coachId, tenant_id: coachId, name: 'Coach Variation A', category: 'accessory', video_url: 'https://example.com/coach-a',                       created_at: new Date().toISOString() },
  ];

  return {
    authedUser: coachProfile,
    profiles: [superProfile, coachProfile, traineeProfile],
    programs: [program],
    inviteCodes: [],
    templates: [],
    libraryExercises,
  };
}

/**
 * Apply a small subset of PostgREST query operators (eq, neq, in, is) to an
 * in-memory row set. Enough fidelity to make the app's auth bootstrap and
 * coach/superadmin fetches return the right data without standing up a
 * real Postgrest service.
 */
function applyPostgrestFilters(
  rows: Record<string, unknown>[],
  params: URLSearchParams,
): Record<string, unknown>[] {
  const SKIP = new Set(['select', 'order', 'limit', 'offset', 'count']);
  return rows.filter((row) => {
    for (const [key, raw] of params) {
      if (SKIP.has(key)) continue;
      const dotIndex = raw.indexOf('.');
      if (dotIndex < 0) continue;
      const op = raw.slice(0, dotIndex);
      const val = raw.slice(dotIndex + 1);
      const cell = row[key];
      switch (op) {
        case 'eq': {
          if (String(cell) !== val) return false;
          break;
        }
        case 'neq': {
          if (String(cell) === val) return false;
          break;
        }
        case 'is': {
          if (val === 'null' && cell != null) return false;
          if (val === 'not.null' && cell == null) return false;
          break;
        }
        case 'in': {
          // val looks like (a,b,c) or ("a","b","c")
          const stripped = val.replace(/^\(|\)$/g, '');
          const items = stripped
            .split(',')
            .map((s) => s.trim().replace(/^"|"$/g, ''));
          if (!items.includes(String(cell))) return false;
          break;
        }
        default:
          // Unknown operator → don't filter (safer than rejecting all rows).
          break;
      }
    }
    return true;
  });
}

/**
 * Browser-side cross-origin requests to *.supabase.co trigger a CORS
 * preflight. Without a proper preflight response, the actual GET/POST is
 * never sent — the bootstrap then hangs forever in "INITIALISING...". Real
 * Supabase replies with the headers below; we mirror them exactly.
 */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers':
    'authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, x-client-info, range',
  'access-control-expose-headers': 'content-range, content-profile, prefer',
  'access-control-max-age': '600',
};

function jsonResponseHeaders() {
  return { ...CORS_HEADERS, 'content-type': 'application/json' };
}

/**
 * Build a syntactically-valid (but unsigned) JWT. supabase-js inspects the
 * payload to read `exp` and `sub`; if the token isn't a 3-part base64-url
 * string it will fall back to refresh-token flows that hang under our mock.
 */
function buildFakeJwt(user: MockProfile): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    aud: 'authenticated',
    exp: FAR_FUTURE_EPOCH,
    iat: Math.floor(Date.now() / 1000),
    iss: 'mock',
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    app_metadata: { provider: 'email' },
    user_metadata: { name: user.name, role: user.role, tenant_id: user.tenant_id },
  };
  const b64u = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const sig = 'sig'; // unsigned — supabase-js doesn't verify locally
  return `${b64u(header)}.${b64u(payload)}.${sig}`;
}

function buildSession(user: MockProfile) {
  const accessToken = buildFakeJwt(user);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: FAR_FUTURE_EPOCH,
    refresh_token: 'mock-refresh-token',
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      phone: '',
      confirmed_at: new Date().toISOString(),
      email_confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { name: user.name, role: user.role, tenant_id: user.tenant_id },
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

export async function installMockSupabase(page: Page, state: MockState) {
  // 1. Seed localStorage with a valid-looking session BEFORE the app loads.
  //    supabase-js reads this synchronously during createClient, so the
  //    bootstrap getSession() resolves without a network round-trip.
  await page.addInitScript(({ projectRef, session }) => {
    try {
      window.localStorage.setItem(
        `sb-${projectRef}-auth-token`,
        JSON.stringify(session),
      );
    } catch {
      // localStorage may be blocked under specific test contexts; tests
      // running with a fresh context shouldn't hit this.
    }
  }, { projectRef: PROJECT_REF, session: buildSession(state.authedUser) });

  // 2. Auth endpoints — minimal surface that supabase-js calls.
  await page.route('**/auth/v1/**', async (route) => {
    const req = route.request();

    // Handle the cross-origin CORS preflight first; without it, the browser
    // never sends the real request and the bootstrap hangs.
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
    }

    const url = new URL(req.url());

    if (url.pathname.endsWith('/user')) {
      return route.fulfill({
        status: 200,
        headers: jsonResponseHeaders(),
        body: JSON.stringify(buildSession(state.authedUser).user),
      });
    }
    if (url.pathname.includes('/token')) {
      return route.fulfill({
        status: 200,
        headers: jsonResponseHeaders(),
        body: JSON.stringify(buildSession(state.authedUser)),
      });
    }
    if (url.pathname.includes('/logout')) {
      return route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
    }
    if (url.pathname.includes('/recover')) {
      return route.fulfill({ status: 200, headers: jsonResponseHeaders(), body: '{}' });
    }
    if (url.pathname.includes('/signup')) {
      return route.fulfill({
        status: 200,
        headers: jsonResponseHeaders(),
        body: JSON.stringify({ user: buildSession(state.authedUser).user, session: null }),
      });
    }
    return route.fulfill({ status: 200, headers: jsonResponseHeaders(), body: '{}' });
  });

  // 3. REST queries — read from the in-memory state, write echoes the body
  //    back so optimistic mutations resolve.
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
    }
    const url = new URL(req.url());
    const table = url.pathname.split('/').filter(Boolean).pop() ?? '';

    if (method === 'GET') {
      const baseRows =
        table === 'profiles' ? state.profiles as Record<string, unknown>[] :
        table === 'programs' ? state.programs as unknown as Record<string, unknown>[] :
        table === 'invite_codes' ? state.inviteCodes as unknown as Record<string, unknown>[] :
        table === 'program_templates' ? state.templates as unknown as Record<string, unknown>[] :
        table === 'exercise_library' ? state.libraryExercises as unknown as Record<string, unknown>[] :
        table === 'weeks' ? state.programs.flatMap((p) => p.weeks) as unknown as Record<string, unknown>[] :
        table === 'days' ? state.programs.flatMap((p) =>
          p.weeks.flatMap((w) => w.days)) as unknown as Record<string, unknown>[] :
        table === 'exercises' ? state.programs.flatMap((p) =>
          p.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises))) as unknown as Record<string, unknown>[] :
        [];

      // Apply PostgREST-style query filters (eq, in, neq, etc.) so callers
      // that filter `?id=eq.<x>` get the right row, not just rows[0].
      const rows = applyPostgrestFilters(baseRows, url.searchParams);

      const accept = req.headers()['accept'] ?? '';
      if (accept.includes('vnd.pgrst.object')) {
        return route.fulfill({
          status: 200,
          headers: jsonResponseHeaders(),
          body: JSON.stringify(rows[0] ?? null),
        });
      }
      return route.fulfill({
        status: 200,
        headers: jsonResponseHeaders(),
        body: JSON.stringify(rows),
      });
    }

    if (method === 'POST' || method === 'PATCH') {
      const body = req.postDataJSON() ?? {};
      const echo = Array.isArray(body) ? body : [body];
      // Server-generated columns: real Postgres fills `id` (uuid default) and
      // `created_at` (timestamptz default now()) when the client omits them.
      // Mirror that here so callers like createInviteCode that do
      // .insert(payload).select().single() see a row with a real id and
      // don't render `<motion.div key={undefined}>` (which throws
      // AnimatePresence into a "Cannot read properties of null (reading
      // 'kind')" pageerror).
      const enriched = echo.map((row) => {
        const r = { ...(row as Record<string, unknown>) };
        if (r.id == null) {
          r.id = `mock-${table}-${Math.random().toString(36).slice(2, 10)}`;
        }
        if (r.created_at == null) r.created_at = new Date().toISOString();
        return r;
      });
      const accept = req.headers()['accept'] ?? '';
      if (accept.includes('vnd.pgrst.object')) {
        return route.fulfill({
          status: 200,
          headers: jsonResponseHeaders(),
          body: JSON.stringify(enriched[0] ?? {}),
        });
      }
      return route.fulfill({
        status: 200,
        headers: jsonResponseHeaders(),
        body: JSON.stringify(enriched),
      });
    }

    if (method === 'DELETE') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
    }

    return route.fulfill({ status: 200, headers: jsonResponseHeaders(), body: '[]' });
  });

  // 4. Local API routes — succeed silently.
  await page.route('**/api/admin-create-user', async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { name?: string; email?: string };
    const id = `coach-new-${Date.now()}`;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          id,
          name: body.name ?? 'New Coach',
          email: body.email ?? 'new@example.com',
          role: 'admin',
          tenant_id: id,
          active_program_id: null,
        },
      }),
    });
  });

  await page.route('**/api/signup-user', async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { name?: string; email?: string; tenantId?: string };
    const id = `trainee-new-${Date.now()}`;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          id,
          name: body.name ?? 'New Trainee',
          email: body.email ?? 'new@example.com',
          role: 'trainee',
          tenant_id: body.tenantId ?? 'tenant-1',
          active_program_id: null,
        },
      }),
    });
  });

  await page.route('**/api/send-email', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
}

/**
 * Track the most recent PATCH/POST/DELETE bodies sent to a given table.
 * Useful for asserting that a save actually fired with the expected payload
 * (e.g., the program editor's debounced save).
 */
export class MutationRecorder {
  public readonly mutations: Array<{ method: string; table: string; body: unknown }> = [];

  async install(page: Page) {
    page.on('request', (req) => {
      const url = req.url();
      if (!url.includes('/rest/v1/')) return;
      const method = req.method();
      if (method === 'GET') return;
      const table = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
      let body: unknown = null;
      try { body = req.postDataJSON(); } catch { body = req.postData(); }
      this.mutations.push({ method, table, body });
    });
  }

  forTable(table: string) {
    return this.mutations.filter((m) => m.table === table);
  }

  clear() {
    this.mutations.length = 0;
  }
}
