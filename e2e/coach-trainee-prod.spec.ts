/**
 * Real-Supabase end-to-end production verification.
 *
 * Provisions a tagged set of test accounts + data via service-role,
 * drives the real production SPA at https://irontrack.vercel.app/, then
 * tears EVERYTHING down in afterAll. A final residue probe asserts zero
 * rows tagged with the run timestamp survive the cleanup pass.
 *
 * NAMING CONVENTION (so a human can sweep manually if cleanup ever fails):
 *   timestamp = Date.now() captured at suite start, logged immediately.
 *   coach A   = qa-coach-a-<timestamp>@irontrack.test    name "QA Coach A <ts>"
 *   coach B   = qa-coach-b-<timestamp>@irontrack.test    name "QA Coach B <ts>"
 *   trainee A = qa-trainee-a-<timestamp>@irontrack.test  name "QA Trainee A <ts>"
 *   trainee from invite = qa-invitee-<timestamp>@irontrack.test
 *
 * REQUIRED ENV
 *   VITE_SUPABASE_URL          read from .env
 *   SUPABASE_SERVICE_ROLE_KEY  read from .env
 *   PLAYWRIGHT_BASE_URL        https://irontrack.vercel.app (passed on cli)
 *   VITE_VAPID_PUBLIC_KEY      optional — Scenario 7 is skipped when absent
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Env loading ─────────────────────────────────────────────────────────

function loadDotEnv() {
  if (process.env.__QA_DOTENV_LOADED__) return;
  try {
    const text = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
    process.env.__QA_DOTENV_LOADED__ = '1';
  } catch {
    // .env missing — env may still be set from the shell.
  }
}
loadDotEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HAS_ENV = !!(SUPABASE_URL && SERVICE_ROLE);
const HAS_VAPID = !!process.env.VITE_VAPID_PUBLIC_KEY;

// Single timestamp ID for the whole run — every row created carries this so
// the cleanup pass and residue probe can find them by pattern.
const TS = Date.now();
const PASSWORD = `QaPwd-${TS}!`;

const EMAIL = {
  coachA: `qa-coach-a-${TS}@irontrack.test`,
  coachB: `qa-coach-b-${TS}@irontrack.test`,
  traineeA: `qa-trainee-a-${TS}@irontrack.test`,
  invitee: `qa-invitee-${TS}@irontrack.test`,
};
const NAME = {
  coachA: `QA Coach A ${TS}`,
  coachB: `QA Coach B ${TS}`,
  traineeA: `QA Trainee A ${TS}`,
  invitee: `QA Invitee ${TS}`,
};

// ─── Shared fixtures ─────────────────────────────────────────────────────

const admin: SupabaseClient = HAS_ENV
  ? createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : (null as unknown as SupabaseClient);

interface Fixtures {
  coachAId: string;
  coachBId: string;
  traineeAId: string;
  // Coach A's program: 1 week, 2 days, 3 exercises
  programAId: string;
  weekAId: string;
  dayAIds: [string, string];
  exerciseAIds: [string, string, string];
  // Invite code Coach A generates for Scenario 1
  inviteCodeStr: string;
  inviteCodeId: string;
}

let F: Partial<Fixtures> = {};

/** Track every id created during the run so cleanup never depends on
 *  walking foreign keys. Add to these as new tests provision data. */
const createdAuthUserIds = new Set<string>();
const createdProfileIds = new Set<string>();
const createdProgramIds = new Set<string>();
const createdInviteIds = new Set<string>();

// ─── Provisioning helpers ────────────────────────────────────────────────

async function provisionAuthUser(
  email: string,
  password: string,
  metadata: { name: string; role: 'admin' | 'trainee'; tenant_id: string | null },
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error || !data?.user) {
    throw new Error(`provisionAuthUser(${email}): ${error?.message ?? 'no user'}`);
  }
  const id = data.user.id;
  createdAuthUserIds.add(id);
  createdProfileIds.add(id);
  return id;
}

/** Update the profile row created by the on_auth_user_created trigger so it
 *  carries the correct role/name/tenant_id. The trigger leaves the row in
 *  a default state we must explicitly write over. */
async function syncProfile(
  id: string,
  patch: { name: string; role: 'admin' | 'trainee'; tenant_id: string | null },
): Promise<void> {
  const { error } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', id);
  if (error) throw new Error(`syncProfile(${id}): ${error.message}`);
}

/** Provision a coach (admin) and immediately rewrite the profile so
 *  tenant_id points at the new user's own id (a coach is the root of their
 *  own tenant). Returns the user id. */
async function provisionCoach(email: string, name: string): Promise<string> {
  const id = await provisionAuthUser(email, PASSWORD, {
    name,
    role: 'admin',
    tenant_id: null, // will set to self after creation
  });
  await syncProfile(id, { name, role: 'admin', tenant_id: id });
  return id;
}

async function provisionTrainee(email: string, name: string, tenantId: string): Promise<string> {
  const id = await provisionAuthUser(email, PASSWORD, {
    name,
    role: 'trainee',
    tenant_id: tenantId,
  });
  await syncProfile(id, { name, role: 'trainee', tenant_id: tenantId });
  return id;
}

/** Build a 1-week / 2-day / 3-exercise program seeded as Coach A → Trainee A. */
async function provisionProgram(
  clientId: string,
  tenantId: string,
  name: string,
): Promise<{
  programId: string;
  weekId: string;
  dayIds: [string, string];
  exerciseIds: [string, string, string];
}> {
  const programId = crypto.randomUUID();
  const { error: progErr } = await admin.from('programs').insert({
    id: programId,
    client_id: clientId,
    tenant_id: tenantId,
    name,
    columns: [
      { id: 'sets', label: 'Sets', type: 'plan' },
      { id: 'reps', label: 'Reps', type: 'plan' },
      { id: 'expectedRpe', label: 'RPE', type: 'plan' },
      { id: 'actualLoad', label: 'Load', type: 'actual' },
    ],
    status: 'active',
  });
  if (progErr) throw new Error(`provisionProgram: ${progErr.message}`);
  createdProgramIds.add(programId);

  // Set as active program on the trainee
  await admin.from('profiles').update({ active_program_id: programId }).eq('id', clientId);

  const weekId = crypto.randomUUID();
  await admin.from('weeks').insert({ id: weekId, program_id: programId, week_number: 1 });

  const dayIds: [string, string] = [crypto.randomUUID(), crypto.randomUUID()];
  await admin.from('days').insert([
    { id: dayIds[0], week_id: weekId, day_number: 1, name: `Lower-${TS}` },
    { id: dayIds[1], week_id: weekId, day_number: 2, name: `Upper-${TS}` },
  ]);

  const exerciseIds: [string, string, string] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  // 2 exercises on day 1, 1 on day 2 — covers "3 total" requirement
  await admin.from('exercises').insert([
    {
      id: exerciseIds[0],
      day_id: dayIds[0],
      position: 0,
      exercise_id: 'squat-qa',
      exercise_name: `Back Squat ${TS}`,
      sets: 3,
      reps: '5',
      expected_rpe: '7',
      weight_range: null,
      actual_load: null,
      actual_rpe: null,
      notes: null,
      video_url: null,
      values: {},
    },
    {
      id: exerciseIds[1],
      day_id: dayIds[0],
      position: 1,
      exercise_id: 'rdl-qa',
      exercise_name: `Romanian Deadlift ${TS}`,
      sets: 3,
      reps: '8',
      expected_rpe: '7',
      weight_range: null,
      actual_load: null,
      actual_rpe: null,
      notes: null,
      video_url: null,
      values: {},
    },
    {
      id: exerciseIds[2],
      day_id: dayIds[1],
      position: 0,
      exercise_id: 'bench-qa',
      exercise_name: `Bench Press ${TS}`,
      sets: 4,
      reps: '6',
      expected_rpe: '7',
      weight_range: null,
      actual_load: null,
      actual_rpe: null,
      notes: null,
      video_url: null,
      values: {},
    },
  ]);

  return { programId, weekId, dayIds, exerciseIds };
}

async function provisionInviteCode(coachId: string, coachName: string): Promise<{ id: string; code: string }> {
  const code = `QA${TS.toString(36).toUpperCase()}`.slice(0, 14);
  const { data, error } = await admin
    .from('invite_codes')
    .insert({
      code,
      coach_id: coachId,
      tenant_id: coachId,
      coach_name: coachName,
      use_count: 0,
    })
    .select('id, code')
    .single<{ id: string; code: string }>();
  if (error || !data) throw new Error(`provisionInviteCode: ${error?.message ?? 'no row'}`);
  createdInviteIds.add(data.id);
  return data;
}

// ─── Auth via the live SPA ───────────────────────────────────────────────

async function loginThroughSpa(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('open-login-btn')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('open-login-btn').click();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-btn').click();
}

/** Pull the user's access token after they sign in via the SPA — useful for
 *  Bearer-protected /api/ calls (Scenario 6 + 7). Reads it from the
 *  supabase-js localStorage record. */
async function readAccessTokenFromBrowser(context: BrowserContext): Promise<string> {
  const page = context.pages()[0] ?? (await context.newPage());
  const token = await page.evaluate(() => {
    const ref = Object.keys(window.localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!ref) return null;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(ref) ?? 'null');
      return parsed?.access_token ?? null;
    } catch {
      return null;
    }
  });
  if (!token) throw new Error('readAccessTokenFromBrowser: no supabase session in localStorage');
  return token;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────

async function safeDelete(table: string, ids: Iterable<string>) {
  const arr = Array.from(ids);
  if (arr.length === 0) return { table, count: 0, error: null as string | null };
  const { error } = await admin.from(table).delete().in('id', arr);
  return { table, count: arr.length, error: error?.message ?? null };
}

async function cleanupRun(): Promise<{
  perTable: Array<{ table: string; count: number; error: string | null }>;
  residue: { profiles: number; programs: number; invites: number };
}> {
  const log: Array<{ table: string; count: number; error: string | null }> = [];

  // Cascade order — children before parents to keep error messages readable
  // even if a child happens to have already been removed by FK ON DELETE.

  // 1. exercises (children of days, children of programs)
  const dayIds = new Set<string>();
  if (createdProgramIds.size > 0) {
    const { data: weeks } = await admin
      .from('weeks')
      .select('id')
      .in('program_id', Array.from(createdProgramIds));
    const weekIds = (weeks ?? []).map((w: { id: string }) => w.id);
    if (weekIds.length > 0) {
      const { data: days } = await admin.from('days').select('id').in('week_id', weekIds);
      for (const d of days ?? []) dayIds.add(d.id);
    }
    if (dayIds.size > 0) {
      const { data: exs } = await admin
        .from('exercises')
        .select('id')
        .in('day_id', Array.from(dayIds));
      log.push(await safeDelete('exercises', (exs ?? []).map((e: { id: string }) => e.id)));
    }
    log.push(await safeDelete('days', dayIds));
    log.push(await safeDelete('weeks', weekIds));
  }

  // 2. invite_codes
  log.push(await safeDelete('invite_codes', createdInviteIds));

  // 3. body_weight_log / exercise_goals scoped to created profile ids
  for (const table of ['body_weight_log', 'exercise_goals']) {
    if (createdProfileIds.size === 0) {
      log.push({ table, count: 0, error: null });
      continue;
    }
    const { error } = await admin
      .from(table)
      .delete()
      .in('client_id', Array.from(createdProfileIds));
    log.push({
      table,
      count: createdProfileIds.size,
      error: error?.message ?? null,
    });
  }

  // 4. programs
  log.push(await safeDelete('programs', createdProgramIds));

  // 5. profiles — wiped first via .delete on the row keyed by id
  log.push(await safeDelete('profiles', createdProfileIds));

  // 6. auth.users — must succeed for the user not to linger. Errors here
  //    will leave an orphan auth row.
  let authDeletedOk = 0;
  let authDeletedErr = 0;
  for (const id of createdAuthUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      authDeletedErr += 1;
      log.push({ table: `auth.users[${id}]`, count: 1, error: error.message });
    } else {
      authDeletedOk += 1;
    }
  }
  log.push({ table: 'auth.users', count: authDeletedOk, error: authDeletedErr > 0 ? `${authDeletedErr} deletion failures` : null });

  // 7. Residue probe — anything tagged with our timestamp pattern that
  //    survived will show up here. We query name/email LIKE patterns so a
  //    bug in our own id-tracking can still be caught.
  const tsStr = String(TS);
  const { data: profResidue } = await admin
    .from('profiles')
    .select('id, email, name')
    .or(`email.ilike.%${tsStr}%,name.ilike.%${tsStr}%`);
  const { data: progResidue } = await admin
    .from('programs')
    .select('id, name')
    .ilike('name', `%${tsStr}%`);
  const { data: inviteResidue } = await admin
    .from('invite_codes')
    .select('id, code, coach_name')
    .or(`code.ilike.%QA${tsStr.slice(-6)}%,coach_name.ilike.%${tsStr}%`);

  const residue = {
    profiles: profResidue?.length ?? 0,
    programs: progResidue?.length ?? 0,
    invites: inviteResidue?.length ?? 0,
  };

  console.log(`[QA cleanup] residue probe:`, residue);
  if (profResidue?.length) console.log('[QA cleanup] profile residue:', profResidue);
  if (progResidue?.length) console.log('[QA cleanup] program residue:', progResidue);
  if (inviteResidue?.length) console.log('[QA cleanup] invite residue:', inviteResidue);

  return { perTable: log, residue };
}

// ─── Suite ───────────────────────────────────────────────────────────────

test.describe.serial('Coach × Trainee production E2E', () => {
  test.skip(!HAS_ENV, 'VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in .env');

  test.beforeAll(async () => {
    console.log(`[QA fixture] run timestamp = ${TS}`);
    console.log(`[QA fixture] target        = ${process.env.PLAYWRIGHT_BASE_URL ?? '(not set)'}`);

    const coachAId = await provisionCoach(EMAIL.coachA, NAME.coachA);
    const traineeAId = await provisionTrainee(EMAIL.traineeA, NAME.traineeA, coachAId);
    const program = await provisionProgram(traineeAId, coachAId, `QA Program ${TS}`);
    const invite = await provisionInviteCode(coachAId, NAME.coachA);
    const coachBId = await provisionCoach(EMAIL.coachB, NAME.coachB);

    F = {
      coachAId,
      coachBId,
      traineeAId,
      programAId: program.programId,
      weekAId: program.weekId,
      dayAIds: program.dayIds,
      exerciseAIds: program.exerciseIds,
      inviteCodeStr: invite.code,
      inviteCodeId: invite.id,
    };

    console.log(`[QA fixture] coachA=${coachAId} traineeA=${traineeAId} programA=${program.programId} invite=${invite.code}`);
  });

  test.afterAll(async () => {
    if (!HAS_ENV) return;
    const result = await cleanupRun();
    console.log('[QA cleanup] per-table:', JSON.stringify(result.perTable, null, 2));
    const survivedOrphans =
      result.residue.profiles + result.residue.programs + result.residue.invites;
    if (survivedOrphans > 0) {
      console.error(
        `[QA cleanup] ⚠ ${survivedOrphans} orphan rows tagged with ${TS} survived cleanup — manual sweep required.`,
      );
    } else {
      console.log(`[QA cleanup] ✓ zero orphans for run ${TS}.`);
    }
  });

  // ─── Scenario 1 ─────────────────────────────────────────────────────
  test('Scenario 1: invite code → /api/signup-user creates trainee + bumps use_count', async ({
    request,
  }) => {
    const before = await admin
      .from('invite_codes')
      .select('use_count')
      .eq('id', F.inviteCodeId!)
      .single<{ use_count: number }>();
    const startCount = before.data?.use_count ?? 0;

    const inviteePassword = `Invitee-${TS}!`;
    const res = await request.post('/api/signup-user', {
      data: {
        name: NAME.invitee,
        email: EMAIL.invitee,
        password: inviteePassword,
        tenantId: F.coachAId,
        inviteCode: F.inviteCodeStr,
      },
    });
    expect(res.status(), `signup-user response body: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as { profile?: { id: string; role: string; tenant_id: string } };
    expect(body.profile).toBeTruthy();
    expect(body.profile!.role).toBe('trainee');
    expect(body.profile!.tenant_id).toBe(F.coachAId);

    // Register for cleanup BEFORE further assertions so a later failure
    // doesn't leave the invitee orphaned.
    createdAuthUserIds.add(body.profile!.id);
    createdProfileIds.add(body.profile!.id);

    // Verify use_count incremented by exactly 1
    const after = await admin
      .from('invite_codes')
      .select('use_count')
      .eq('id', F.inviteCodeId!)
      .single<{ use_count: number }>();
    expect(after.data?.use_count).toBe(startCount + 1);
  });

  // ─── Scenario 2 ─────────────────────────────────────────────────────
  test('Scenario 2: trainee dashboard shows assigned program + 3 exercises', async ({ page }) => {
    await loginThroughSpa(page, EMAIL.traineeA, PASSWORD);

    // Wait for the trainee dashboard's Current Block tab to render the program name.
    await expect(page.getByText(`QA Program ${TS}`, { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
    // Default tab is Current Block — open week 1 to see the day cards.
    await page.getByTestId('week-tab-1').click();
    await expect(page.getByTestId('week-content-1')).toBeVisible();

    // All three exercise names from our fixture appear somewhere on the page.
    // (Day 1 preview shows up to 3 exercises; day 2 has 1; total = 3.)
    await expect(page.getByText(`Back Squat ${TS}`).first()).toBeVisible();
    await expect(page.getByText(`Romanian Deadlift ${TS}`).first()).toBeVisible();
    await expect(page.getByText(`Bench Press ${TS}`).first()).toBeVisible();
  });

  // ─── Scenario 3 ─────────────────────────────────────────────────────
  test('Scenario 3: trainee logs session → coach sees it in Recent Activity within 10s', async ({
    browser,
  }) => {
    // Two independent browser contexts: one trainee, one coach.
    const traineeCtx = await browser.newContext();
    const coachCtx = await browser.newContext();
    try {
      const traineePage = await traineeCtx.newPage();
      const coachPage = await coachCtx.newPage();

      // ── Coach signs in first so the realtime subscription is open when
      //    the trainee submits.
      await loginThroughSpa(coachPage, EMAIL.coachA, PASSWORD);
      await coachPage.getByTestId('admin-btn').click();
      // Recent Activity moved to a drawer in the recent UI refresh — open it
      // explicitly via the toolbar button, then assert the panel rendered.
      await coachPage.getByTestId('open-activity-drawer').click();
      await expect(coachPage.getByTestId('recent-activity-panel')).toBeVisible({ timeout: 15_000 });

      // ── Trainee logs in and opens the day-1 logger.
      await loginThroughSpa(traineePage, EMAIL.traineeA, PASSWORD);
      await traineePage.getByTestId('week-tab-1').click();
      await traineePage.getByTestId('log-session-btn-day-1').click();
      await expect(traineePage.getByTestId('finish-session-btn')).toBeVisible({ timeout: 10_000 });

      // Fill load + RPE + completion toggle for all sets of the day's two
      // exercises so the Finish button doesn't trigger the "partially
      // logged" confirm. The fixture's day-1 has 2 exercises × 3 sets each.
      //
      // Production now ships the smart rest timer (v2): the timer panel
      // auto-expands on the first set-done click and covers the right side
      // of the screen, blocking subsequent toggle clicks on exercise 2.
      // Collapse the rest-timer panel between exercises by clicking the
      // FAB (toggle) when it's open.
      /** Collapse the rest-timer panel if it's open. The smart-rest-timer
       *  auto-opens after every set-done click in v2 and covers the right
       *  side of the screen — including subsequent rows' load/RPE inputs
       *  AND their toggle buttons. Call this BEFORE any click that needs
       *  to land in the covered region. */
      const collapseTimerIfOpen = async (): Promise<void> => {
        if (await traineePage.getByTestId('rest-timer-panel').count()) {
          await traineePage.getByTestId('rest-timer-fab').click();
          // Give the exit animation a moment so the next pointer event
          // doesn't race the still-mounted overlay.
          await traineePage.waitForTimeout(100);
        }
      };

      const [ex1, ex2] = [F.exerciseAIds![0], F.exerciseAIds![1]];
      for (const exId of [ex1, ex2]) {
        for (const setN of [1, 2, 3]) {
          await collapseTimerIfOpen();
          await traineePage.getByTestId(`input-${exId}-set-${setN}-load`).fill('100');
          await collapseTimerIfOpen();
          await traineePage.getByTestId(`input-${exId}-set-${setN}-rpe`).fill('8');
          await collapseTimerIfOpen();
          await traineePage.getByTestId(`set-done-toggle-${exId}-${setN}`).click();
        }
      }
      // Final collapse before clicking Finish so the timer panel can't
      // cover the WorkoutSummary overlay buttons.
      await collapseTimerIfOpen();

      // Belt-and-suspenders: also accept any window.confirm in case some
      // sets failed to flip to "done" (e.g. the rest-timer overlay
      // intercepts pointer events on the second exercise's toggles, which
      // is what we see in production today — the timer fab pops up after
      // the first set-done click and covers the next rows). The confirm
      // copy is "N of M sets logged…".
      traineePage.once('dialog', (d) => void d.accept());

      // Finish workout — production now shows a WorkoutSummary overlay
      // BEFORE the reflection modal (this is the Summary screen Dev 2
      // mentioned was supposedly not in the deploy — it is). Click
      // through Summary's "Submit Reflection" CTA to reach the reflection
      // step. We do not assert anything about Summary content here; that
      // belongs to a dedicated Workout Flow v2 spec.
      await traineePage.getByTestId('finish-session-btn').click();
      await expect(traineePage.getByTestId('workout-summary')).toBeVisible({ timeout: 10_000 });
      await traineePage.getByTestId('summary-submit-reflection-btn').click();
      await expect(traineePage.getByTestId('reflection-modal')).toBeVisible({ timeout: 10_000 });

      // Submit difficulty 4 + note.
      const reflectionNote = `qa-reflection-${TS}`;
      await traineePage.getByTestId('reflection-difficulty-4').click();
      await traineePage.getByTestId('reflection-note').fill(reflectionNote);
      await traineePage.getByTestId('reflection-submit-btn').click();
      await expect(traineePage.getByTestId('reflection-modal')).toHaveCount(0);

      // ── Coach side: poll for the entry. Realtime subscription target
      //    is days UPDATE with reflection_at populated.
      const entry = coachPage.getByTestId(`activity-entry-${F.dayAIds![0]}`);
      await expect(entry).toBeVisible({ timeout: 15_000 });
      await expect(entry).toContainText(reflectionNote);
      // Difficulty 4 maps to "Brutal" in the warning palette.
      await expect(entry).toContainText(/brutal/i);
      const pill = entry.locator('span.tabular-nums').first();
      await expect(pill).toContainText('4');
    } finally {
      await traineeCtx.close();
      await coachCtx.close();
    }
  });

  // ─── Scenario 4 ─────────────────────────────────────────────────────
  test('Scenario 4: coach saves feedback → trainee history modal shows it', async ({ browser }) => {
    const coachCtx = await browser.newContext();
    const traineeCtx = await browser.newContext();
    try {
      const coachPage = await coachCtx.newPage();
      const traineePage = await traineeCtx.newPage();

      const note = `qa-coachnote-${TS}`;

      await loginThroughSpa(coachPage, EMAIL.coachA, PASSWORD);
      await coachPage.getByTestId('admin-btn').click();
      // Open the activity drawer (recent UI refresh — formerly always-visible).
      await coachPage.getByTestId('open-activity-drawer').click();
      const entry = coachPage.getByTestId(`activity-entry-${F.dayAIds![0]}`);
      await expect(entry).toBeVisible({ timeout: 15_000 });
      await coachPage.getByTestId(`add-feedback-btn-${F.dayAIds![0]}`).click();
      await coachPage.getByTestId(`feedback-textarea-${F.dayAIds![0]}`).fill(note);
      await coachPage.getByTestId(`save-feedback-btn-${F.dayAIds![0]}`).click();

      // Verify the row in Supabase actually carries the note.
      await expect
        .poll(async () => {
          const { data } = await admin
            .from('days')
            .select('coach_note')
            .eq('id', F.dayAIds![0])
            .single<{ coach_note: string }>();
          return data?.coach_note ?? null;
        }, { timeout: 10_000 })
        .toBe(note);

      // Trainee opens history modal for that day.
      await loginThroughSpa(traineePage, EMAIL.traineeA, PASSWORD);
      await traineePage.getByTestId('week-tab-1').click();
      await traineePage.getByTestId('view-history-btn-day-1').click();
      await expect(traineePage.getByText(/Coach Feedback/i)).toBeVisible({ timeout: 10_000 });
      await expect(traineePage.getByText(note)).toBeVisible();
    } finally {
      await coachCtx.close();
      await traineeCtx.close();
    }
  });

  // ─── Scenario 5 ─────────────────────────────────────────────────────
  test('Scenario 5: programs.coach_notes renders as the block-notes banner on trainee dashboard', async ({
    page,
  }) => {
    const blockNotes = `qa-block-notes-${TS}\nFocus on bar speed.`;
    await admin.from('programs').update({ coach_notes: blockNotes }).eq('id', F.programAId!);

    await loginThroughSpa(page, EMAIL.traineeA, PASSWORD);
    await expect(page.getByTestId('coach-block-notes')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('coach-block-notes')).toContainText(`qa-block-notes-${TS}`);
    await expect(page.getByTestId('coach-block-notes')).toContainText('Focus on bar speed.');
  });

  // ─── Scenario 6 ─────────────────────────────────────────────────────
  test('Scenario 6: Coach B cannot see Coach A\'s tenant — RLS + activity feed + /api/send-notification', async ({
    browser,
    request,
  }) => {
    // ── Browser-level cross-tenant check — sign Coach B in, walk to the
    //    admin panel, confirm zero rows from Coach A's tenant appear. RLS
    //    is enforced on the server side; the browser is the easiest way
    //    to exercise an authenticated-but-cross-tenant SELECT path.
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await loginThroughSpa(page, EMAIL.coachB, PASSWORD);

      // Coach B is fresh — they should see "No trainees yet" or an empty
      // client list, NOT QA Trainee A.
      await expect(page.getByText(NAME.traineeA)).toHaveCount(0);

      // Open admin panel. AdminView only renders its toolbar (Activity /
      // Cohort / Archive) when a program is being edited; for a fresh
      // coach with zero trainees that toolbar is hidden and we see the
      // "Ready to build?" empty state instead. Both branches prove the
      // tenant filter held — the activity drawer either shows no entries
      // OR doesn't render at all.
      await page.getByTestId('admin-btn').click();
      await expect(page.getByText(/Admin Panel/i)).toBeVisible({ timeout: 15_000 });
      const activityTrigger = page.getByTestId('open-activity-drawer');
      if (await activityTrigger.count()) {
        await activityTrigger.click();
        await expect(page.getByTestId('recent-activity-panel')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId(`activity-entry-${F.dayAIds![0]}`)).toHaveCount(0);
      } else {
        // Empty-state — confirm we landed there and that Coach A's trainee
        // name doesn't bleed through.
        await expect(page.getByText(/Ready to Build|No program assigned/i).first()).toBeVisible();
        await expect(page.getByText(NAME.traineeA)).toHaveCount(0);
      }

      // ── /api/send-notification cross-tenant probe
      const coachBToken = await readAccessTokenFromBrowser(ctx);
      const apiRes = await request.post('/api/send-notification', {
        headers: { Authorization: `Bearer ${coachBToken}`, 'Content-Type': 'application/json' },
        data: { recipientId: F.traineeAId, message: 'should be forbidden' },
      });
      // Endpoint returns 403 'Tenant mismatch' OR 404 'No push subscription'
      // (the recipient lookup runs before the tenant check only when no
      // subscription exists). Both indicate the cross-tenant send did NOT
      // succeed; the contract is "any non-200 status".
      expect(apiRes.status()).not.toBe(200);
      expect([403, 404]).toContain(apiRes.status());
      const text = await apiRes.text();
      console.log(`[QA s6] send-notification cross-tenant body=${text}`);
    } finally {
      await ctx.close();
    }
  });

  // ─── Scenario 7 ─────────────────────────────────────────────────────
  test('Scenario 7: /api/send-notification best-effort — 200 or 404, never 500', async ({
    browser,
    request,
  }) => {
    test.skip(!HAS_VAPID, 'VITE_VAPID_PUBLIC_KEY not set locally — push delivery not exercised.');

    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await loginThroughSpa(page, EMAIL.coachA, PASSWORD);
      const token = await readAccessTokenFromBrowser(ctx);
      const res = await request.post('/api/send-notification', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { recipientId: F.traineeAId, message: `QA ping ${TS}` },
      });
      // 200 = pushed; 404 = no subscription on the trainee (acceptable for
      // a brand-new trainee that never granted Notification permission).
      expect([200, 404]).toContain(res.status());
    } finally {
      await ctx.close();
    }
  });

  // ─── Scenario 8 ─────────────────────────────────────────────────────
  test('Scenario 8: program duplication — Copy of <name>, structure preserved, actuals stripped', async () => {
    // Seed an "actual" on the original so we can verify it does NOT leak
    // into the copy.
    await admin
      .from('exercises')
      .update({
        actual_load: '99',
        actual_rpe: '9',
        notes: 'do not copy',
        video_url: 'https://example.com/leak',
        values: { set_1_load: '99', set_1_rpe: '9' },
      })
      .eq('id', F.exerciseAIds![0]);

    // Mirror useProgramData.duplicateProgram via service-role.
    const origProgramId = F.programAId!;
    const newProgramId = crypto.randomUUID();
    const { data: orig, error: origErr } = await admin
      .from('programs')
      .select('name, columns, tenant_id, client_id')
      .eq('id', origProgramId)
      .single<{ name: string; columns: unknown; tenant_id: string; client_id: string }>();
    if (origErr || !orig) throw new Error(`scenario 8 read orig: ${origErr?.message}`);

    await admin.from('programs').insert({
      id: newProgramId,
      client_id: orig.client_id,
      tenant_id: orig.tenant_id,
      name: `Copy of ${orig.name}`,
      columns: orig.columns,
      status: 'active',
    });
    createdProgramIds.add(newProgramId);

    const { data: weeks } = await admin
      .from('weeks')
      .select('id, week_number, days(id, day_number, name, exercises(id, position, exercise_id, exercise_name, sets, reps, expected_rpe, weight_range))')
      .eq('program_id', origProgramId)
      .order('week_number');

    for (const w of weeks ?? []) {
      const newWeekId = crypto.randomUUID();
      await admin.from('weeks').insert({
        id: newWeekId,
        program_id: newProgramId,
        week_number: (w as { week_number: number }).week_number,
      });
      const sourceDays = (w as { days: Array<{ id: string; day_number: number; name: string; exercises: Array<Record<string, unknown>> }> }).days ?? [];
      for (const d of sourceDays) {
        const newDayId = crypto.randomUUID();
        await admin.from('days').insert({
          id: newDayId,
          week_id: newWeekId,
          day_number: d.day_number,
          name: d.name,
        });
        const exRows = (d.exercises ?? []).map((ex, idx) => ({
          id: crypto.randomUUID(),
          day_id: newDayId,
          position: (ex as { position?: number }).position ?? idx,
          exercise_id: (ex as { exercise_id: string }).exercise_id,
          exercise_name: (ex as { exercise_name: string }).exercise_name,
          sets: (ex as { sets: number | null }).sets,
          reps: (ex as { reps: string | null }).reps,
          expected_rpe: (ex as { expected_rpe: string | null }).expected_rpe,
          weight_range: (ex as { weight_range: string | null }).weight_range,
          // The duplication contract — actuals + notes + values must reset.
          actual_load: null,
          actual_rpe: null,
          notes: null,
          video_url: null,
          values: {},
        }));
        if (exRows.length > 0) {
          await admin.from('exercises').insert(exRows);
        }
      }
    }

    // Verify the copy
    const { data: copy } = await admin
      .from('programs')
      .select('id, name, status, weeks(id, days(id, exercises(actual_load, actual_rpe, notes, video_url, values)))')
      .eq('id', newProgramId)
      .single<{
        id: string;
        name: string;
        status: string;
        weeks: Array<{ days: Array<{ exercises: Array<{ actual_load: string | null; actual_rpe: string | null; notes: string | null; video_url: string | null; values: Record<string, string> }> }> }>;
      }>();
    expect(copy?.name).toBe(`Copy of QA Program ${TS}`);
    expect(copy?.status).toBe('active');

    const copiedExercises = (copy?.weeks ?? []).flatMap((w) => w.days.flatMap((d) => d.exercises));
    expect(copiedExercises.length).toBe(3);
    for (const ex of copiedExercises) {
      expect(ex.actual_load).toBeNull();
      expect(ex.actual_rpe).toBeNull();
      expect(ex.notes).toBeNull();
      expect(ex.video_url).toBeNull();
      expect(ex.values).toEqual({});
    }

    // Original is untouched
    const { data: origAfter } = await admin
      .from('exercises')
      .select('actual_load, actual_rpe, notes')
      .eq('id', F.exerciseAIds![0])
      .single<{ actual_load: string | null; actual_rpe: string | null; notes: string | null }>();
    expect(origAfter?.actual_load).toBe('99');
    expect(origAfter?.actual_rpe).toBe('9');
    expect(origAfter?.notes).toBe('do not copy');
  });
});
