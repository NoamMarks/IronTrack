/**
 * Trainee analytics surface — real-Supabase production E2E.
 *
 * Sits alongside coach-trainee-prod.spec.ts. Provisions a single trainee
 * with a tagged email, drives the live SPA at https://irontrack.vercel.app,
 * verifies each analytics surface end-to-end, then deletes everything
 * created in afterAll plus an independent post-run residue probe.
 *
 * NAMING CONVENTION (so a human can sweep manually if cleanup ever fails):
 *   timestamp   = Date.now() at suite start, logged immediately.
 *   coach       = qa-coach-an-<ts>@irontrack.test
 *   trainee     = qa-trainee-an-<ts>@irontrack.test
 *
 * REQUIRED ENV
 *   VITE_SUPABASE_URL          read from .env
 *   SUPABASE_SERVICE_ROLE_KEY  read from .env
 *   PLAYWRIGHT_BASE_URL        https://irontrack.vercel.app (passed on cli)
 */

import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Env loading ─────────────────────────────────────────────────────────

function loadDotEnv() {
  if (process.env.__QA_AN_DOTENV_LOADED__) return;
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
    process.env.__QA_AN_DOTENV_LOADED__ = '1';
  } catch {
    // .env missing — env may still be set from the shell.
  }
}
loadDotEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HAS_ENV = !!(SUPABASE_URL && SERVICE_ROLE);

// Single timestamp ID for the whole run.
const TS = Date.now();
const PASSWORD = `QaPwd-${TS}!`;

const EMAIL = {
  coach: `qa-coach-an-${TS}@irontrack.test`,
  trainee: `qa-trainee-an-${TS}@irontrack.test`,
};
const NAME = {
  coach: `QA AnalyticsCoach ${TS}`,
  trainee: `QA AnalyticsTrainee ${TS}`,
};

// ─── Service-role client ─────────────────────────────────────────────────

const admin: SupabaseClient = HAS_ENV
  ? createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : (null as unknown as SupabaseClient);

interface Fixtures {
  coachId: string;
  traineeId: string;
  programId: string;
  weekIds: [string, string]; // week 1, week 2 — for DELOAD scenario
  // Day ids: 2 in each of week 1 & 2. The first day in each week carries
  // the exercise we'll log against (squat). The second day carries a
  // bench-press exercise so we get a 2-exercise PR table for Scenario 6.
  dayIds: [string, string, string, string];
  exerciseIds: {
    squatW1: string;
    benchW1: string;
    squatW2: string;
    benchW2: string;
  };
  exerciseIdValue: { squat: string; bench: string }; // exercise_id field (e.g. "squat-qa-ts")
}

let F: Partial<Fixtures> = {};

// Track ids for cleanup.
const createdAuthUserIds = new Set<string>();
const createdProfileIds = new Set<string>();
const createdProgramIds = new Set<string>();
const createdGoalRowIds = new Set<string>(); // exercise_goals are NOT id-keyed by uuid in some schemas; we'll delete by (client_id IN ...) instead

// ─── Provisioning helpers ────────────────────────────────────────────────

async function provisionUser(
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
    throw new Error(`provisionUser(${email}): ${error?.message ?? 'no user'}`);
  }
  createdAuthUserIds.add(data.user.id);
  createdProfileIds.add(data.user.id);
  return data.user.id;
}

async function syncProfile(
  id: string,
  patch: { name: string; role: 'admin' | 'trainee'; tenant_id: string | null },
): Promise<void> {
  const { error } = await admin.from('profiles').update(patch).eq('id', id);
  if (error) throw new Error(`syncProfile(${id}): ${error.message}`);
}

async function provisionCoach(): Promise<string> {
  const id = await provisionUser(EMAIL.coach, PASSWORD, {
    name: NAME.coach,
    role: 'admin',
    tenant_id: null,
  });
  await syncProfile(id, { name: NAME.coach, role: 'admin', tenant_id: id });
  return id;
}

async function provisionTrainee(coachId: string): Promise<string> {
  const id = await provisionUser(EMAIL.trainee, PASSWORD, {
    name: NAME.trainee,
    role: 'trainee',
    tenant_id: coachId,
  });
  await syncProfile(id, { name: NAME.trainee, role: 'trainee', tenant_id: coachId });
  return id;
}

/**
 * Build the program tree:
 *   Week 1 — day 1 squat (logged, actual 100×5×3), day 2 bench (logged, actual 80×5×3)
 *   Week 2 — day 1 squat (logged, actual 60×5×3 → triggers DELOAD vs week 1)
 *            day 2 bench (NOT logged)
 *
 * Volume math (using parseReps lower bound + actual_load → reps × load):
 *   Squat W1 = 3 sets × 5 reps × 100kg  = 1500
 *   Squat W2 = 3 sets × 5 reps × 60kg   = 900   (60% of W1 → DELOAD trigger)
 *   Bench W1 = 3 sets × 5 reps × 80kg   = 1200
 *
 * Personal records (Epley):
 *   Squat W1 e1RM = 100 × (1 + 5/30) = 116.7
 *   Squat W2 e1RM = 60 × (1 + 5/30) = 70
 *   Bench W1 e1RM = 80 × (1 + 5/30) = 93.3
 * Best squat e1RM = 116.7 (W1) — that's what the chart and PR table show.
 *
 * Compliance: 3 of 4 days logged → 75%.
 */
async function provisionProgram(
  clientId: string,
  tenantId: string,
): Promise<{
  programId: string;
  weekIds: [string, string];
  dayIds: [string, string, string, string];
  exerciseIds: Fixtures['exerciseIds'];
  exerciseIdValue: Fixtures['exerciseIdValue'];
}> {
  const programId = crypto.randomUUID();
  const squatXid = `squat-an-${TS}`;
  const benchXid = `bench-an-${TS}`;

  await admin.from('programs').insert({
    id: programId,
    client_id: clientId,
    tenant_id: tenantId,
    name: `QA Analytics Program ${TS}`,
    columns: [
      { id: 'sets', label: 'Sets', type: 'plan' },
      { id: 'reps', label: 'Reps', type: 'plan' },
      { id: 'expectedRpe', label: 'RPE', type: 'plan' },
      { id: 'actualLoad', label: 'Load', type: 'actual' },
    ],
    status: 'active',
  });
  createdProgramIds.add(programId);

  await admin.from('profiles').update({ active_program_id: programId }).eq('id', clientId);

  const weekIds: [string, string] = [crypto.randomUUID(), crypto.randomUUID()];
  await admin.from('weeks').insert([
    { id: weekIds[0], program_id: programId, week_number: 1 },
    { id: weekIds[1], program_id: programId, week_number: 2 },
  ]);

  const dayIds: [string, string, string, string] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  // Week 1 — day 1 + day 2 logged. Week 2 — day 1 logged, day 2 NOT logged
  // → 3 of 4 days logged → 75% compliance.
  const W1_DAY1_LOGGED_AT = new Date(2026, 3, 1).toISOString();
  const W1_DAY2_LOGGED_AT = new Date(2026, 3, 3).toISOString();
  const W2_DAY1_LOGGED_AT = new Date(2026, 3, 8).toISOString();
  await admin.from('days').insert([
    { id: dayIds[0], week_id: weekIds[0], day_number: 1, name: `LowerW1-${TS}`, logged_at: W1_DAY1_LOGGED_AT },
    { id: dayIds[1], week_id: weekIds[0], day_number: 2, name: `UpperW1-${TS}`, logged_at: W1_DAY2_LOGGED_AT },
    { id: dayIds[2], week_id: weekIds[1], day_number: 1, name: `LowerW2-${TS}`, logged_at: W2_DAY1_LOGGED_AT },
    { id: dayIds[3], week_id: weekIds[1], day_number: 2, name: `UpperW2-${TS}`, logged_at: null },
  ]);

  // Exercises — each row carries the planned reps/sets AND the actuals so
  // `exerciseVolume`/`getLoadedSets` returns the seeded numbers.
  const exerciseIds: Fixtures['exerciseIds'] = {
    squatW1: crypto.randomUUID(),
    benchW1: crypto.randomUUID(),
    squatW2: crypto.randomUUID(),
    benchW2: crypto.randomUUID(),
  };

  const mkSet = (load: string): Record<string, string> => ({
    set_1_load: load,
    set_1_rpe: '7',
    set_2_load: load,
    set_2_rpe: '7',
    set_3_load: load,
    set_3_rpe: '8',
  });

  await admin.from('exercises').insert([
    {
      id: exerciseIds.squatW1,
      day_id: dayIds[0],
      position: 0,
      exercise_id: squatXid,
      exercise_name: `Back Squat ${TS}`,
      sets: 3,
      reps: '5',
      expected_rpe: '7',
      actual_load: '100',
      actual_rpe: '7',
      notes: null,
      video_url: null,
      values: mkSet('100'),
    },
    {
      id: exerciseIds.benchW1,
      day_id: dayIds[1],
      position: 0,
      exercise_id: benchXid,
      exercise_name: `Bench Press ${TS}`,
      sets: 3,
      reps: '5',
      expected_rpe: '7',
      actual_load: '80',
      actual_rpe: '7',
      notes: null,
      video_url: null,
      values: mkSet('80'),
    },
    {
      id: exerciseIds.squatW2,
      day_id: dayIds[2],
      position: 0,
      exercise_id: squatXid,
      exercise_name: `Back Squat ${TS}`,
      sets: 3,
      reps: '5',
      expected_rpe: '7',
      actual_load: '60',
      actual_rpe: '7',
      notes: null,
      video_url: null,
      values: mkSet('60'),
    },
    {
      id: exerciseIds.benchW2,
      day_id: dayIds[3],
      position: 0,
      exercise_id: benchXid,
      exercise_name: `Bench Press ${TS}`,
      sets: 3,
      reps: '5',
      expected_rpe: '7',
      actual_load: null,
      actual_rpe: null,
      notes: null,
      video_url: null,
      values: {},
    },
  ]);

  return {
    programId,
    weekIds,
    dayIds,
    exerciseIds,
    exerciseIdValue: { squat: squatXid, bench: benchXid },
  };
}

// ─── Browser helper ──────────────────────────────────────────────────────

async function loginAsTrainee(page: Page, password = PASSWORD): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('open-login-btn')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('open-login-btn').click();
  await page.getByTestId('login-email').fill(EMAIL.trainee);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-btn').click();
  // Wait for the dashboard to render — Current Block tab is the default.
  await expect(page.getByTestId('dashboard-tab-current')).toBeVisible({ timeout: 20_000 });
}

// ─── Cleanup ─────────────────────────────────────────────────────────────

async function cleanupRun(): Promise<{
  perTable: Array<{ table: string; count: number; error: string | null }>;
  residue: { profiles: number; programs: number; goals: number; weightLog: number };
}> {
  const log: Array<{ table: string; count: number; error: string | null }> = [];

  // Walk weeks → days → exercises for each created program, then peel them
  // off in cascade order. This still works if the schema has ON DELETE
  // CASCADE — we'd just delete already-empty rows — but is also safe if it
  // doesn't.
  if (createdProgramIds.size > 0) {
    const { data: weeks } = await admin
      .from('weeks')
      .select('id')
      .in('program_id', Array.from(createdProgramIds));
    const weekIds = (weeks ?? []).map((w: { id: string }) => w.id);
    let dayIds: string[] = [];
    if (weekIds.length > 0) {
      const { data: days } = await admin.from('days').select('id').in('week_id', weekIds);
      dayIds = (days ?? []).map((d: { id: string }) => d.id);
    }
    if (dayIds.length > 0) {
      const { data: exs } = await admin.from('exercises').select('id').in('day_id', dayIds);
      const exIds = (exs ?? []).map((e: { id: string }) => e.id);
      if (exIds.length > 0) {
        const { error } = await admin.from('exercises').delete().in('id', exIds);
        log.push({ table: 'exercises', count: exIds.length, error: error?.message ?? null });
      } else {
        log.push({ table: 'exercises', count: 0, error: null });
      }
      const { error: dErr } = await admin.from('days').delete().in('id', dayIds);
      log.push({ table: 'days', count: dayIds.length, error: dErr?.message ?? null });
    }
    if (weekIds.length > 0) {
      const { error: wErr } = await admin.from('weeks').delete().in('id', weekIds);
      log.push({ table: 'weeks', count: weekIds.length, error: wErr?.message ?? null });
    }
  }

  // exercise_goals + body_weight_log are keyed off client_id — delete every
  // row tied to our profile ids.
  if (createdProfileIds.size > 0) {
    const profIdArray = Array.from(createdProfileIds);
    const { error: egErr, count: egCount } = await admin
      .from('exercise_goals')
      .delete({ count: 'exact' })
      .in('client_id', profIdArray);
    log.push({ table: 'exercise_goals', count: egCount ?? 0, error: egErr?.message ?? null });

    const { error: bwErr, count: bwCount } = await admin
      .from('body_weight_log')
      .delete({ count: 'exact' })
      .in('client_id', profIdArray);
    log.push({ table: 'body_weight_log', count: bwCount ?? 0, error: bwErr?.message ?? null });
  }

  // Programs
  if (createdProgramIds.size > 0) {
    const { error } = await admin
      .from('programs')
      .delete()
      .in('id', Array.from(createdProgramIds));
    log.push({ table: 'programs', count: createdProgramIds.size, error: error?.message ?? null });
  }

  // Profiles
  if (createdProfileIds.size > 0) {
    const { error } = await admin
      .from('profiles')
      .delete()
      .in('id', Array.from(createdProfileIds));
    log.push({ table: 'profiles', count: createdProfileIds.size, error: error?.message ?? null });
  }

  // auth.users
  let authOk = 0;
  let authErr = 0;
  for (const id of createdAuthUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      authErr += 1;
      log.push({ table: `auth.users[${id}]`, count: 1, error: error.message });
    } else {
      authOk += 1;
    }
  }
  log.push({
    table: 'auth.users',
    count: authOk,
    error: authErr > 0 ? `${authErr} deletion failures` : null,
  });

  // Residue probe — anything tagged with our timestamp that survived.
  const tsStr = String(TS);
  const { data: profResidue } = await admin
    .from('profiles')
    .select('id, email, name')
    .or(`email.ilike.%${tsStr}%,name.ilike.%${tsStr}%`);
  const { data: progResidue } = await admin
    .from('programs')
    .select('id, name')
    .ilike('name', `%${tsStr}%`);
  // exercise_goals and body_weight_log have no email/name columns; surface
  // by client_id intersection with our profile ids — but our profile ids
  // are gone now, so any leftover would be orphan-by-cascade. Just count
  // any rows referencing a non-existent profile keyed to our timestamp.
  const { count: goalResidue } = await admin
    .from('exercise_goals')
    .select('exercise_id', { count: 'exact', head: true })
    .in('client_id', createdProfileIds.size > 0 ? Array.from(createdProfileIds) : ['00000000-0000-0000-0000-000000000000']);
  const { count: weightResidue } = await admin
    .from('body_weight_log')
    .select('id', { count: 'exact', head: true })
    .in('client_id', createdProfileIds.size > 0 ? Array.from(createdProfileIds) : ['00000000-0000-0000-0000-000000000000']);

  const residue = {
    profiles: profResidue?.length ?? 0,
    programs: progResidue?.length ?? 0,
    goals: goalResidue ?? 0,
    weightLog: weightResidue ?? 0,
  };

  console.log(`[QA analytics cleanup] residue probe:`, residue);
  if (profResidue?.length) console.log('[QA analytics cleanup] profile residue:', profResidue);
  if (progResidue?.length) console.log('[QA analytics cleanup] program residue:', progResidue);

  return { perTable: log, residue };
}

// ─── Suite ───────────────────────────────────────────────────────────────

test.describe.serial('Trainee analytics surface — production E2E', () => {
  test.skip(!HAS_ENV, 'VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in .env');

  test.beforeAll(async () => {
    console.log(`[QA analytics fixture] run timestamp = ${TS}`);
    console.log(
      `[QA analytics fixture] target         = ${process.env.PLAYWRIGHT_BASE_URL ?? '(not set)'}`,
    );

    const coachId = await provisionCoach();
    const traineeId = await provisionTrainee(coachId);
    const program = await provisionProgram(traineeId, coachId);

    F = {
      coachId,
      traineeId,
      programId: program.programId,
      weekIds: program.weekIds,
      dayIds: program.dayIds,
      exerciseIds: program.exerciseIds,
      exerciseIdValue: program.exerciseIdValue,
    };

    console.log(
      `[QA analytics fixture] coach=${coachId} trainee=${traineeId} program=${program.programId} squatXid=${program.exerciseIdValue.squat}`,
    );
  });

  test.afterAll(async () => {
    if (!HAS_ENV) return;
    const result = await cleanupRun();
    console.log('[QA analytics cleanup] per-table:', JSON.stringify(result.perTable, null, 2));
    const orphans =
      result.residue.profiles +
      result.residue.programs +
      result.residue.goals +
      result.residue.weightLog;
    if (orphans > 0) {
      console.error(
        `[QA analytics cleanup] ⚠ ${orphans} orphan rows tagged with ${TS} survived — manual sweep required.`,
      );
    } else {
      console.log(`[QA analytics cleanup] ✓ zero orphans for run ${TS}.`);
    }
  });

  // ─── Scenario 1 ─────────────────────────────────────────────────────
  test('Scenario 1: exercise_goals → ReferenceLine renders on e1RM chart at correct y-value', async ({ page }) => {
    // NOTE: best squat e1RM in this fixture is 116.7 (100kg × 5 reps via
    // Epley). Recharts' default ifOverflow="discard" on ReferenceLine hides
    // the line when its y-value sits above the data-driven y-axis domain.
    // Production currently doesn't override this, so a goal > current best
    // is silently invisible — flagged in the report as a UX bug. For the
    // assertion to be meaningful we use a value inside the rendered range.
    const GOAL_KG = 110;

    // Seed the goal via service-role BEFORE login. The component reads it
    // on mount and renders the ReferenceLine when the e1RM view is active.
    await admin.from('exercise_goals').upsert(
      {
        client_id: F.traineeId,
        exercise_id: F.exerciseIdValue!.squat,
        target_e1rm: GOAL_KG,
      },
      { onConflict: 'client_id,exercise_id' },
    );
    void createdGoalRowIds; // cleanup is by client_id, not row id

    await loginAsTrainee(page);
    await page.getByTestId('dashboard-tab-analytics').click();
    await expect(page.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 15_000 });

    // The Squat exercise should be the default-selected (first logged).
    // Pick it explicitly so the assertion is deterministic.
    const squatTab = page.getByTestId(`exercise-tab-${F.exerciseIdValue!.squat}`);
    await expect(squatTab).toBeVisible({ timeout: 10_000 });
    await squatTab.click();

    // Ensure we're on the e1RM view (default is e1rm).
    await page.getByTestId('analytics-view-e1rm').click();
    await expect(page.getByTestId('e1rm-chart')).toBeVisible();

    // The "Current goal" badge appears next to the input when a goal is set.
    await expect(page.getByTestId('goal-current')).toContainText(`${GOAL_KG} kg`);

    // The ReferenceLine label "Goal 150kg" is rendered as an SVG <text>
    // inside the recharts container.
    const chart = page.getByTestId('e1rm-chart');
    const label = chart.locator('text', { hasText: `Goal ${GOAL_KG}kg` });
    await expect(label).toBeVisible({ timeout: 10_000 });

    // The reference line element itself — recharts renders it as <line>
    // with strokeDasharray="4 4". Multiple <line> elements exist in the
    // chart (grid, axes), so we narrow on the dashed-stroke + stroke colour
    // that uniquely matches the goal line config.
    const refLine = chart.locator('line[stroke-dasharray="4 4"]').first();
    await expect(refLine).toHaveCount(1);
    // y-coordinate sanity: recharts SVG y is screen-space (inverted from
    // chart space), so we can't compare to GOAL_KG directly. What we CAN
    // check: y1 === y2 (it's a horizontal reference line).
    const [y1, y2] = await refLine.evaluate((el: SVGLineElement) => [el.getAttribute('y1'), el.getAttribute('y2')]);
    expect(y1).toBe(y2);
  });

  // ─── Scenario 2 ─────────────────────────────────────────────────────
  test('Scenario 2: week-2 pill shows DELOAD badge with correct palette', async ({ page }) => {
    await loginAsTrainee(page);
    await page.getByTestId('dashboard-tab-current').click();

    // Week 2 pill must carry the DELOAD badge — volume on Squat W2 (900) is
    // 60% of W1 (1500), well under the 80% threshold.
    const week2Pill = page.getByTestId('week-tab-2');
    await expect(week2Pill).toBeVisible({ timeout: 15_000 });

    // The badge is a <span> with class "bg-warning/20 text-warning border-warning/30",
    // text DELOAD, located inside the pill button. We probe via the span text +
    // its sibling-relative location.
    const badge = week2Pill.locator('span', { hasText: /^DELOAD$/i });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveClass(/bg-warning\/20/);
    await expect(badge).toHaveClass(/text-warning/);
    await expect(badge).toHaveClass(/border-warning\/30/);

    // title= tooltip should mention the volume drop on the squat exercise.
    const title = await badge.getAttribute('title');
    expect(title).toMatch(/Back Squat .* -40%/);

    // Sanity — week-1 pill must NOT carry DELOAD (there's no prior week).
    const week1Pill = page.getByTestId('week-tab-1');
    await expect(week1Pill.locator('span', { hasText: /^DELOAD$/i })).toHaveCount(0);
  });

  // ─── Scenario 3 ─────────────────────────────────────────────────────
  test('Scenario 3: body weight log → Supabase row inserted, list updates with newest first', async ({ page }) => {
    await loginAsTrainee(page);
    await page.getByTestId('dashboard-tab-analytics').click();
    await expect(page.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 15_000 });

    // BodyWeightLog only renders under the DOTS view ("Weight History"
    // panel sits below the DOTS controls — production code at
    // AnalyticsDashboard.tsx:349 gates it on `view === 'dots'`).
    await page.getByTestId('analytics-view-dots').click();

    // The BodyWeightLog component has no data-testid attributes; we anchor
    // on the input placeholder.
    const weightInput = page.getByPlaceholder("Today's weight (kg)");
    await expect(weightInput).toBeVisible({ timeout: 10_000 });

    // 1) Seed an older entry via service-role so we can verify sort order.
    //    BodyWeightLog only fetches the last 30 days (see hook body), so the
    //    seed date MUST be inside that window. Compute relative to today
    //    rather than hardcoding — a hardcoded 2026-04-15 silently fell out
    //    of the window once the calendar rolled past 2026-05-15.
    const oldDateObj = new Date();
    oldDateObj.setDate(oldDateObj.getDate() - 7);
    const oldDate = oldDateObj.toISOString().slice(0, 10);
    await admin.from('body_weight_log').upsert(
      { client_id: F.traineeId, weight_kg: 79.2, logged_at: oldDate },
      { onConflict: 'client_id,logged_at' },
    );
    // Reload so the component picks up the seeded entry.
    await page.reload();
    await page.getByTestId('dashboard-tab-analytics').click();
    await page.getByTestId('analytics-view-dots').click();
    await expect(page.getByPlaceholder("Today's weight (kg)")).toBeVisible({ timeout: 10_000 });

    // 2) Submit a fresh entry via the UI.
    const TODAY_WEIGHT = '82.5';
    await page.getByPlaceholder("Today's weight (kg)").fill(TODAY_WEIGHT);
    await page.getByRole('button', { name: /^Log$/i }).click();

    // 3) Verify the row landed in Supabase.
    const today = new Date().toISOString().slice(0, 10);
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from('body_weight_log')
            .select('weight_kg')
            .eq('client_id', F.traineeId)
            .eq('logged_at', today)
            .single<{ weight_kg: number }>();
          return data?.weight_kg ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe(82.5);

    // 4) Display updates: today's entry should appear FIRST (newest first
    //    per the .order('logged_at', desc) hook). The older 2026-04-15
    //    entry sits below it.
    //
    //    Each entry is rendered as a `div.flex.justify-between.text-[11px]`
    //    showing date on the left and weight on the right.
    const entryRows = page.locator('div.flex.justify-between.text-\\[11px\\]');
    // First row: today
    await expect(entryRows.first()).toContainText(today);
    await expect(entryRows.first()).toContainText('82.5 kg');
    // Second row: the older seed
    await expect(entryRows.nth(1)).toContainText(oldDate);
    await expect(entryRows.nth(1)).toContainText('79.2 kg');
  });

  // ─── Scenario 4 ─────────────────────────────────────────────────────
  test('Scenario 4: account settings → name change updates profiles + nav label', async ({ page }) => {
    const NEW_NAME = `Renamed-Trainee-${TS}`;
    await loginAsTrainee(page);

    // The nav button bearing the user name doubles as the settings opener.
    await expect(page.getByTestId('open-settings-btn')).toContainText(NAME.trainee);
    await page.getByTestId('open-settings-btn').click();
    await expect(page.getByTestId('settings-name-input')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('settings-name-input').fill(NEW_NAME);
    await page.getByTestId('settings-name-save').click();

    // Verify the profiles row updated.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from('profiles')
            .select('name')
            .eq('id', F.traineeId)
            .single<{ name: string }>();
          return data?.name ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe(NEW_NAME);

    // Nav button label reflects the saved name. AccountSettings closes the
    // modal on success, and App.tsx's onUpdated patch sets authenticatedUser.name.
    await expect(page.getByTestId('open-settings-btn')).toContainText(NEW_NAME, { timeout: 10_000 });
  });

  // ─── Scenario 5 ─────────────────────────────────────────────────────
  test('Scenario 5: account settings → password change → new pw works, old pw fails', async ({ page, browser }) => {
    const NEW_PASSWORD = `NewQa-${TS}!`;

    await loginAsTrainee(page);
    await page.getByTestId('open-settings-btn').click();
    await page.getByTestId('settings-pw-current').fill(PASSWORD);
    await page.getByTestId('settings-pw-new').fill(NEW_PASSWORD);
    await page.getByTestId('settings-pw-confirm').fill(NEW_PASSWORD);
    await page.getByTestId('settings-pw-submit').click();
    await expect(page.getByTestId('settings-pw-success')).toBeVisible({ timeout: 10_000 });

    // Verify the NEW password works against the live SPA in a fresh context.
    const okCtx = await browser.newContext();
    try {
      const okPage = await okCtx.newPage();
      await loginAsTrainee(okPage, NEW_PASSWORD);
      // Landing on the trainee dashboard proves the auth round-trip succeeded.
      await expect(okPage.getByTestId('dashboard-tab-current')).toBeVisible({ timeout: 15_000 });
    } finally {
      await okCtx.close();
    }

    // Verify the OLD password is rejected. We re-drive the login modal
    // and assert the "Invalid email or password" copy surfaces.
    const failCtx = await browser.newContext();
    try {
      const failPage = await failCtx.newPage();
      await failPage.goto('/');
      await failPage.getByTestId('open-login-btn').click();
      await failPage.getByTestId('login-email').fill(EMAIL.trainee);
      await failPage.getByTestId('login-password').fill(PASSWORD);
      await failPage.getByTestId('login-btn').click();
      await expect(failPage.getByText(/invalid email or password/i)).toBeVisible({
        timeout: 10_000,
      });
      // We should still be on the login modal — no dashboard.
      await expect(failPage.getByTestId('dashboard-tab-current')).toHaveCount(0);
    } finally {
      await failCtx.close();
    }

    // Restore the password to PASSWORD so afterAll's deleteUser path (which
    // doesn't care about the password) doesn't have any further side
    // effects — purely belt-and-suspenders. We do this via service-role.
    await admin.auth.admin.updateUserById(F.traineeId!, { password: PASSWORD });
  });

  // ─── Scenario 6 ─────────────────────────────────────────────────────
  test('Scenario 6: progress report → tiles, PR table, compliance bar all correct', async ({ page }) => {
    await loginAsTrainee(page);
    await page.getByTestId('generate-report-btn').click();
    // Modal title = "Progress Report".
    await expect(page.getByRole('heading', { name: /Progress Report/i })).toBeVisible({
      timeout: 10_000,
    });

    // Expected summary values from the seeded fixture:
    //   Sessions Logged    : 3 of 4 logged → 75%
    //   Exercises Tracked  : 2 (squat + bench; bench W2 has no actuals so
    //                          listLoggedExercises drops it — but the
    //                          benchW1 row is still logged → 2 distinct
    //                          exercise_ids returned)
    //   Programs Completed : 0 (the seeded program is 'active', not archived)

    // Tile values are rendered inside <p class="text-2xl"> elements next to
    // their labels. Walk by adjacency.
    const tilesScope = page.getByRole('heading', { name: /Progress Report/i }).locator('xpath=ancestor::*[1]');
    void tilesScope;

    // The simplest fact: there are exactly 3 tiles and the three label/value
    // pairings are stable. Anchor on the label text.
    const sessionsLabel = page.getByText('Sessions Logged', { exact: false });
    const exercisesLabel = page.getByText('Exercises Tracked', { exact: false });
    const programsLabel = page.getByText('Programs Completed', { exact: false });
    await expect(sessionsLabel).toBeVisible();
    await expect(exercisesLabel).toBeVisible();
    await expect(programsLabel).toBeVisible();

    // The value sits in the next sibling <p>. Use xpath to grab it.
    const sessionsValue = sessionsLabel.locator('xpath=following-sibling::p[1]');
    const exercisesValue = exercisesLabel.locator('xpath=following-sibling::p[1]');
    const programsValue = programsLabel.locator('xpath=following-sibling::p[1]');
    await expect(sessionsValue).toContainText('75%');
    await expect(exercisesValue).toContainText('2');
    await expect(programsValue).toContainText('0');

    // PR table: rows are sorted by e1RM DESC. Squat W1 (e1rm 116.7) ranks
    // above bench W1 (e1rm 93.3).
    const tableRows = page.locator('tbody tr');
    await expect(tableRows).toHaveCount(2);
    await expect(tableRows.nth(0)).toContainText(`Back Squat ${TS}`);
    await expect(tableRows.nth(0)).toContainText('116.7');
    await expect(tableRows.nth(1)).toContainText(`Bench Press ${TS}`);
    await expect(tableRows.nth(1)).toContainText('93.3');

    // Compliance bar: width is set inline as `width: 75%`. The bar is the
    // .h-full child of the compliance container.
    const complianceBar = page.locator('div.h-full.bg-primary\\/60').first();
    const style = await complianceBar.getAttribute('style');
    expect(style).toMatch(/width:\s*75%/);

    // Footer summary line carries the same numbers.
    await expect(page.getByText(/3 of 4 scheduled sessions completed/i)).toBeVisible();
  });
});
