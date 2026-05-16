/**
 * UX comfort features — real-Supabase production E2E.
 *
 * Verifies three sprint additions against the live data plane:
 *   - @dnd-kit drag handles + chevron fallback for exercise/day reordering
 *   - Cmd+K command palette (Meta+K / Control+K) with recent + search
 *   - 1RM goal ReferenceLine with ifOverflow="extendDomain" regression test
 *   - BodyWeightLog new data-testids (drop-in for placeholder fallback)
 *
 * NAMING (so a human can sweep manually if cleanup ever fails):
 *   timestamp = Date.now() at suite start, logged immediately.
 *   coach     = qa-coach-ux-<ts>@irontrack.test       name "QA UxCoach <ts>"
 *   trainees  = qa-trainee-ux-{alice|bob|carol}-<ts>@irontrack.test
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
  if (process.env.__QA_UX_DOTENV_LOADED__) return;
  try {
    const text = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
    process.env.__QA_UX_DOTENV_LOADED__ = '1';
  } catch {
    // .env missing — env may still be set from the shell.
  }
}
loadDotEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HAS_ENV = !!(SUPABASE_URL && SERVICE_ROLE);

const TS = Date.now();
const PASSWORD = `QaPwd-${TS}!`;

const EMAIL = {
  coach: `qa-coach-ux-${TS}@irontrack.test`,
  alice: `qa-trainee-ux-alice-${TS}@irontrack.test`,
  bob: `qa-trainee-ux-bob-${TS}@irontrack.test`,
  carol: `qa-trainee-ux-carol-${TS}@irontrack.test`,
};
const NAME = {
  coach: `QA UxCoach ${TS}`,
  alice: `Alice Apple ${TS}`,
  bob: `Bob Banana ${TS}`,
  carol: `Carol Cherry ${TS}`,
};

const admin: SupabaseClient = HAS_ENV
  ? createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : (null as unknown as SupabaseClient);

interface Fixtures {
  coachId: string;
  aliceId: string;
  bobId: string;
  carolId: string;
  // Alice's program — single week / day / 3 exercises for the exercise-drag scenario.
  aliceProgramId: string;
  aliceWeekId: string;
  aliceDayId: string;
  aliceExerciseIds: { bench: string; squat: string; deadlift: string };
  // Bob's program — 2 weeks × 3 days for the day-reorder scenario.
  bobProgramId: string;
  bobWeekIds: [string, string];
  // dayNumbers 1, 2, 3 — across both weeks. Map dayNumber → [w1DayId, w2DayId].
  bobDayIds: { 1: [string, string]; 2: [string, string]; 3: [string, string] };
  // Carol's program — single logged squat session + goal for the goal-line regression.
  carolProgramId: string;
  carolSquatExerciseId: string; // exercise_id field, not the row id
}

let F: Partial<Fixtures> = {};

// Cleanup tracking.
const createdAuthUserIds = new Set<string>();
const createdProfileIds = new Set<string>();
const createdProgramIds = new Set<string>();

// ─── Provision helpers ───────────────────────────────────────────────────

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

async function provisionTrainee(email: string, name: string, tenantId: string): Promise<string> {
  const id = await provisionUser(email, PASSWORD, { name, role: 'trainee', tenant_id: tenantId });
  await syncProfile(id, { name, role: 'trainee', tenant_id: tenantId });
  return id;
}

const DEFAULT_COLUMNS = [
  { id: 'sets', label: 'Sets', type: 'plan' as const },
  { id: 'reps', label: 'Reps', type: 'plan' as const },
  { id: 'expectedRpe', label: 'RPE', type: 'plan' as const },
  { id: 'actualLoad', label: 'Load', type: 'actual' as const },
];

/** Alice: 1 week / 1 day / 3 exercises (Bench → Squat → Deadlift). */
async function provisionAliceProgram(clientId: string, tenantId: string): Promise<{
  programId: string;
  weekId: string;
  dayId: string;
  exerciseIds: Fixtures['aliceExerciseIds'];
}> {
  const programId = crypto.randomUUID();
  await admin.from('programs').insert({
    id: programId,
    client_id: clientId,
    tenant_id: tenantId,
    name: `QA Drag Program ${TS}`,
    columns: DEFAULT_COLUMNS,
    status: 'active',
  });
  createdProgramIds.add(programId);
  await admin.from('profiles').update({ active_program_id: programId }).eq('id', clientId);

  const weekId = crypto.randomUUID();
  await admin.from('weeks').insert({ id: weekId, program_id: programId, week_number: 1 });

  const dayId = crypto.randomUUID();
  await admin.from('days').insert({ id: dayId, week_id: weekId, day_number: 1, name: `Day-${TS}` });

  const exIds: Fixtures['aliceExerciseIds'] = {
    bench: crypto.randomUUID(),
    squat: crypto.randomUUID(),
    deadlift: crypto.randomUUID(),
  };
  await admin.from('exercises').insert([
    {
      id: exIds.bench,
      day_id: dayId,
      position: 0,
      exercise_id: `bench-ux-${TS}`,
      exercise_name: `Bench-${TS}`,
      sets: 3,
      reps: '5',
      expected_rpe: '7',
      values: {},
    },
    {
      id: exIds.squat,
      day_id: dayId,
      position: 1,
      exercise_id: `squat-ux-${TS}`,
      exercise_name: `Squat-${TS}`,
      sets: 3,
      reps: '5',
      expected_rpe: '7',
      values: {},
    },
    {
      id: exIds.deadlift,
      day_id: dayId,
      position: 2,
      exercise_id: `deadlift-ux-${TS}`,
      exercise_name: `Deadlift-${TS}`,
      sets: 3,
      reps: '5',
      expected_rpe: '7',
      values: {},
    },
  ]);

  return { programId, weekId, dayId, exerciseIds: exIds };
}

/** Bob: 2 weeks × 3 days (A, B, C). No exercises required for the day-reorder scenario. */
async function provisionBobProgram(clientId: string, tenantId: string): Promise<{
  programId: string;
  weekIds: [string, string];
  dayIds: { 1: [string, string]; 2: [string, string]; 3: [string, string] };
}> {
  const programId = crypto.randomUUID();
  await admin.from('programs').insert({
    id: programId,
    client_id: clientId,
    tenant_id: tenantId,
    name: `QA Day-Reorder Program ${TS}`,
    columns: DEFAULT_COLUMNS,
    status: 'active',
  });
  createdProgramIds.add(programId);
  await admin.from('profiles').update({ active_program_id: programId }).eq('id', clientId);

  const weekIds: [string, string] = [crypto.randomUUID(), crypto.randomUUID()];
  await admin.from('weeks').insert([
    { id: weekIds[0], program_id: programId, week_number: 1 },
    { id: weekIds[1], program_id: programId, week_number: 2 },
  ]);

  const mkDay = (weekId: string, dayNumber: number, letter: 'A' | 'B' | 'C') => ({
    id: crypto.randomUUID(),
    week_id: weekId,
    day_number: dayNumber,
    name: `Day ${letter} ${TS}`,
  });
  const dayRows: Array<ReturnType<typeof mkDay>> = [];
  const dayMap: { 1: [string, string]; 2: [string, string]; 3: [string, string] } = {
    1: ['', ''],
    2: ['', ''],
    3: ['', ''],
  };
  for (let wi = 0; wi < 2; wi += 1) {
    for (const [n, letter] of [
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
    ] as Array<[1 | 2 | 3, 'A' | 'B' | 'C']>) {
      const row = mkDay(weekIds[wi], n, letter);
      dayRows.push(row);
      dayMap[n][wi] = row.id;
    }
  }
  await admin.from('days').insert(dayRows);

  return { programId, weekIds, dayIds: dayMap };
}

/**
 * Carol: 1 week / 1 day / 1 logged squat exercise. The seeded actual_load
 * of 100kg × 5 reps yields an Epley e1RM of 116.7 — so when the test sets
 * `target_e1rm = 200`, the goal exceeds the data's max by ~70% and the
 * production fix (ifOverflow="extendDomain") is what makes the goal line
 * appear at all.
 */
async function provisionCarolProgram(clientId: string, tenantId: string): Promise<{
  programId: string;
  squatExerciseId: string;
}> {
  const programId = crypto.randomUUID();
  await admin.from('programs').insert({
    id: programId,
    client_id: clientId,
    tenant_id: tenantId,
    name: `QA Goal Program ${TS}`,
    columns: DEFAULT_COLUMNS,
    status: 'active',
  });
  createdProgramIds.add(programId);
  await admin.from('profiles').update({ active_program_id: programId }).eq('id', clientId);

  const weekId = crypto.randomUUID();
  const dayId = crypto.randomUUID();
  await admin.from('weeks').insert({ id: weekId, program_id: programId, week_number: 1 });
  await admin
    .from('days')
    .insert({ id: dayId, week_id: weekId, day_number: 1, name: 'Lower', logged_at: new Date(2026, 4, 1).toISOString() });

  const xid = `squat-ux-goal-${TS}`;
  await admin.from('exercises').insert({
    id: crypto.randomUUID(),
    day_id: dayId,
    position: 0,
    exercise_id: xid,
    exercise_name: `Back Squat ${TS}`,
    sets: 3,
    reps: '5',
    expected_rpe: '7',
    actual_load: '100',
    actual_rpe: '7',
    values: { set_1_load: '100', set_2_load: '100', set_3_load: '100' },
  });

  return { programId, squatExerciseId: xid };
}

// ─── Browser helpers ─────────────────────────────────────────────────────

/** Open the command palette via the same handler real Ctrl/Cmd+K invokes.
 *
 *  Playwright's `page.keyboard.press('Control+K')` doesn't deliver the
 *  event to the page's `window.addEventListener('keydown', ...)` listener
 *  in headless Chromium (the browser chrome layer intercepts Ctrl+K for
 *  the URL bar before the page sees it). Dispatching the KeyboardEvent
 *  directly bypasses that intercept while invoking the EXACT same
 *  production hook code path — useCommandPalette listens on `window`
 *  and toggles state when (metaKey || ctrlKey) && key === 'k'.
 *
 *  Real users hit Ctrl+K and it works; this is a Playwright-simulation
 *  workaround, not a production bug.
 */
async function pressCmdK(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  });
}

async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('open-login-btn')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('open-login-btn').click();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-btn').click();
}

// ─── Cleanup ─────────────────────────────────────────────────────────────

async function cleanupRun(): Promise<{
  perTable: Array<{ table: string; count: number; error: string | null }>;
  residue: { profiles: number; programs: number; goals: number; weightLog: number };
}> {
  const log: Array<{ table: string; count: number; error: string | null }> = [];

  // Walk weeks → days → exercises off the programs we created.
  if (createdProgramIds.size > 0) {
    const programArr = Array.from(createdProgramIds);
    const { data: weeks } = await admin.from('weeks').select('id').in('program_id', programArr);
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

  if (createdProfileIds.size > 0) {
    const profIds = Array.from(createdProfileIds);
    const { error: egErr, count: egCount } = await admin
      .from('exercise_goals')
      .delete({ count: 'exact' })
      .in('client_id', profIds);
    log.push({ table: 'exercise_goals', count: egCount ?? 0, error: egErr?.message ?? null });

    const { error: bwErr, count: bwCount } = await admin
      .from('body_weight_log')
      .delete({ count: 'exact' })
      .in('client_id', profIds);
    log.push({ table: 'body_weight_log', count: bwCount ?? 0, error: bwErr?.message ?? null });
  }

  if (createdProgramIds.size > 0) {
    const { error } = await admin
      .from('programs')
      .delete()
      .in('id', Array.from(createdProgramIds));
    log.push({ table: 'programs', count: createdProgramIds.size, error: error?.message ?? null });
  }

  if (createdProfileIds.size > 0) {
    const { error } = await admin
      .from('profiles')
      .delete()
      .in('id', Array.from(createdProfileIds));
    log.push({ table: 'profiles', count: createdProfileIds.size, error: error?.message ?? null });
  }

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

  // Residue probe — tagged with our timestamp pattern.
  const tsStr = String(TS);
  const { data: profResidue } = await admin
    .from('profiles')
    .select('id, email, name')
    .or(`email.ilike.%-ux-%${tsStr}%,name.ilike.%${tsStr}%`);
  const { data: progResidue } = await admin
    .from('programs')
    .select('id, name')
    .ilike('name', `%${tsStr}%`);
  // Goals + weight log only attach to client_id (no email/name column) —
  // any residue is by definition orphaned beyond our created profiles set.
  const idFilter =
    createdProfileIds.size > 0
      ? Array.from(createdProfileIds)
      : ['00000000-0000-0000-0000-000000000000'];
  const { count: goalResidue } = await admin
    .from('exercise_goals')
    .select('exercise_id', { count: 'exact', head: true })
    .in('client_id', idFilter);
  const { count: weightResidue } = await admin
    .from('body_weight_log')
    .select('id', { count: 'exact', head: true })
    .in('client_id', idFilter);

  const residue = {
    profiles: profResidue?.length ?? 0,
    programs: progResidue?.length ?? 0,
    goals: goalResidue ?? 0,
    weightLog: weightResidue ?? 0,
  };

  console.log(`[QA ux cleanup] residue probe:`, residue);
  if (profResidue?.length) console.log('[QA ux cleanup] profile residue:', profResidue);
  if (progResidue?.length) console.log('[QA ux cleanup] program residue:', progResidue);

  return { perTable: log, residue };
}

// ─── Suite ───────────────────────────────────────────────────────────────

test.describe.serial('UX comfort features — production E2E', () => {
  test.skip(!HAS_ENV, 'VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in .env');

  test.beforeAll(async () => {
    console.log(`[QA ux fixture] run timestamp = ${TS}`);
    console.log(`[QA ux fixture] target        = ${process.env.PLAYWRIGHT_BASE_URL ?? '(not set)'}`);

    const coachId = await provisionCoach();
    const aliceId = await provisionTrainee(EMAIL.alice, NAME.alice, coachId);
    const bobId = await provisionTrainee(EMAIL.bob, NAME.bob, coachId);
    const carolId = await provisionTrainee(EMAIL.carol, NAME.carol, coachId);

    const alice = await provisionAliceProgram(aliceId, coachId);
    const bob = await provisionBobProgram(bobId, coachId);
    const carol = await provisionCarolProgram(carolId, coachId);

    F = {
      coachId,
      aliceId,
      bobId,
      carolId,
      aliceProgramId: alice.programId,
      aliceWeekId: alice.weekId,
      aliceDayId: alice.dayId,
      aliceExerciseIds: alice.exerciseIds,
      bobProgramId: bob.programId,
      bobWeekIds: bob.weekIds,
      bobDayIds: bob.dayIds,
      carolProgramId: carol.programId,
      carolSquatExerciseId: carol.squatExerciseId,
    };
    console.log(
      `[QA ux fixture] coach=${coachId} alice=${aliceId} bob=${bobId} carol=${carolId}`,
    );
  });

  test.afterAll(async () => {
    if (!HAS_ENV) return;
    const result = await cleanupRun();
    console.log('[QA ux cleanup] per-table:', JSON.stringify(result.perTable, null, 2));
    const orphans =
      result.residue.profiles +
      result.residue.programs +
      result.residue.goals +
      result.residue.weightLog;
    if (orphans > 0) {
      console.error(
        `[QA ux cleanup] ⚠ ${orphans} orphan rows tagged with ${TS} survived — manual sweep required.`,
      );
    } else {
      console.log(`[QA ux cleanup] ✓ zero orphans for run ${TS}.`);
    }
  });

  // ─── Scenario 1: Exercise drag-and-drop ─────────────────────────────
  test('Scenario 1: exercise reordering — dnd-kit infrastructure + chevron fallback + save indicator', async ({ page }) => {
    await login(page, EMAIL.coach);
    // Navigate: coach lands on client list → pick Alice → open admin.
    await expect(page.getByText(NAME.alice).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText(NAME.alice).first().click();
    await page.getByTestId('admin-btn').click();
    await expect(page.getByText(/Admin Panel/i)).toBeVisible({ timeout: 15_000 });
    // AdminView's local selectedClient defaults to trainees[0] which depends
    // on fetch ordering — click Alice's sidebar card explicitly so the test
    // is deterministic across reorderings of the trainee list.
    await page.getByText(NAME.alice).first().click();

    // ── 1a. dnd-kit infrastructure: GripVertical handles present on every row.
    const benchRow = page.getByTestId('exercise-row-0');
    const squatRow = page.getByTestId('exercise-row-1');
    const deadliftRow = page.getByTestId('exercise-row-2');
    await expect(benchRow).toBeVisible({ timeout: 10_000 });
    await expect(squatRow).toBeVisible();
    await expect(deadliftRow).toBeVisible();

    const benchHandle = page.getByTestId('exercise-drag-handle-0');
    const squatHandle = page.getByTestId('exercise-drag-handle-1');
    const deadliftHandle = page.getByTestId('exercise-drag-handle-2');
    await expect(benchHandle).toBeVisible();
    await expect(squatHandle).toBeVisible();
    await expect(deadliftHandle).toBeVisible();

    // dnd-kit's useSortable spreads `attributes` onto the handle, including
    // aria-roledescription="sortable". Its presence proves the SortableContext
    // wired up correctly around this row.
    await expect(benchHandle).toHaveAttribute('aria-roledescription', 'sortable');
    await expect(squatHandle).toHaveAttribute('aria-roledescription', 'sortable');
    await expect(deadliftHandle).toHaveAttribute('aria-roledescription', 'sortable');

    // ── 1b. Confirm initial order via the live SQL rows.
    const initialOrder = await admin
      .from('exercises')
      .select('exercise_name, position')
      .eq('day_id', F.aliceDayId!)
      .order('position');
    const initialNames = (initialOrder.data ?? []).map((r) => (r as { exercise_name: string }).exercise_name);
    expect(initialNames).toEqual([`Bench-${TS}`, `Squat-${TS}`, `Deadlift-${TS}`]);

    // ── 1c. Chevron-button reorder (deterministic; bypasses dnd-kit pointer
    //     sensor flakiness with Playwright). The infra check above already
    //     confirmed the drag handles + SortableContext are wired up.
    //     The chevron is the second button inside the .flex.flex-col stack
    //     of row 0 (after the up chevron).
    await page
      .getByTestId('exercise-row-0')
      .locator('div.flex.flex-col button')
      .nth(1)
      .click(); // Bench → position 1
    await page.waitForTimeout(150);
    // After first click, Bench is row 1 — click the down button of row 1.
    await page
      .getByTestId('exercise-row-1')
      .locator('div.flex.flex-col button')
      .nth(1)
      .click();

    // ── 1d. Verify SQL reflects the new order. The save fires after the
    //     500ms debounce + ~9 sequential round-trips (program PATCH +
    //     weeks/days/exercises sync) which can take 1.5–3s over the prod
    //     network. Poll instead of a fixed sleep.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from('exercises')
            .select('exercise_name, position')
            .eq('day_id', F.aliceDayId!)
            .order('position');
          return (data ?? []).map((r) => (r as { exercise_name: string }).exercise_name);
        },
        { timeout: 10_000 },
      )
      .toEqual([`Squat-${TS}`, `Deadlift-${TS}`, `Bench-${TS}`]);

    // ── 1e. Verify DOM order matches the optimistic local state.
    await expect(page.getByTestId('exercise-row-0').locator('input').first()).toHaveValue(`Squat-${TS}`);
    await expect(page.getByTestId('exercise-row-1').locator('input').first()).toHaveValue(`Deadlift-${TS}`);
    await expect(page.getByTestId('exercise-row-2').locator('input').first()).toHaveValue(`Bench-${TS}`);
  });

  // ─── Scenario 2: Day reordering with cross-week sync ─────────────────
  test('Scenario 2: day reordering — dayNumber swaps atomically across every week', async ({ page }) => {
    await login(page, EMAIL.coach);
    await expect(page.getByText(NAME.bob).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText(NAME.bob).first().click();
    await page.getByTestId('admin-btn').click();
    await expect(page.getByText(/Admin Panel/i)).toBeVisible({ timeout: 15_000 });
    // AdminView's default selectedClient is trainees[0] (Alice). Switch
    // to Bob explicitly via the sidebar card; without this the editor
    // shows Alice's single-day program and the day-down button is disabled.
    await page.getByText(NAME.bob).first().click();
    // Wait for Bob's program editor to materialise. ProgramEditor renders
    // every week stacked vertically, so day-card-1/2/3 each match TWICE
    // (once per week). Assert the multiplicity directly.
    await expect(page.getByTestId('day-card-1').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('day-card-1')).toHaveCount(2);
    await expect(page.getByTestId('day-card-2')).toHaveCount(2);
    await expect(page.getByTestId('day-card-3')).toHaveCount(2);

    // ── 2a. dnd-kit infrastructure on day cards. Same multiplicity as
    //     the cards: 2 drag handles per dayNumber (one per week).
    await expect(page.getByTestId('day-drag-handle-1')).toHaveCount(2);
    const dayADragHandle = page.getByTestId('day-drag-handle-1').first();
    await expect(dayADragHandle).toBeVisible({ timeout: 10_000 });
    await expect(dayADragHandle).toHaveAttribute('aria-roledescription', 'sortable');

    // ── 2b. Confirm initial state in SQL.
    const before = await admin
      .from('days')
      .select('week_id, day_number, name')
      .in('week_id', F.bobWeekIds!);
    // Map week_id → ordered day rows by day_number.
    const byWeek = new Map<string, Array<{ day_number: number; name: string }>>();
    for (const r of (before.data ?? []) as Array<{ week_id: string; day_number: number; name: string }>) {
      const arr = byWeek.get(r.week_id) ?? [];
      arr.push({ day_number: r.day_number, name: r.name });
      byWeek.set(r.week_id, arr);
    }
    for (const [, arr] of byWeek) {
      arr.sort((a, b) => a.day_number - b.day_number);
      // Each week starts as: dayNumber 1 = Day A, 2 = Day B, 3 = Day C
      expect(arr.map((d) => d.name)).toEqual([
        `Day A ${TS}`,
        `Day B ${TS}`,
        `Day C ${TS}`,
      ]);
    }

    // ── 2c. Chevron-driven reorder (most reliable cross-browser): move
    //     Day A from position 1 → 2 → 3. `day-down-btn-{n}` has 2 matches
    //     (one per week) — either fires the same dayNumber swap across
    //     every week, so .first() is sufficient.
    await page.getByTestId('day-down-btn-1').first().click(); // Day A ↔ Day B
    await page.waitForTimeout(200);
    // After the swap, Day A's testid is now day-down-btn-2.
    await page.getByTestId('day-down-btn-2').first().click(); // Day A ↔ Day C

    // ── 2d. Verify cross-week sync via SQL — same poll approach as
    //     Scenario 1 (saves over prod network can take 1.5–3s end-to-end).
    //     Expected: every week has Day B at #1, Day C at #2, Day A at #3.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from('days')
            .select('week_id, day_number, name')
            .in('week_id', F.bobWeekIds!);
          const byWeek = new Map<string, Array<{ day_number: number; name: string }>>();
          for (const r of (data ?? []) as Array<{
            week_id: string;
            day_number: number;
            name: string;
          }>) {
            const arr = byWeek.get(r.week_id) ?? [];
            arr.push({ day_number: r.day_number, name: r.name });
            byWeek.set(r.week_id, arr);
          }
          // Project into a comparable shape: array of per-week ordered names.
          return Array.from(byWeek.values())
            .map((arr) =>
              arr
                .sort((a, b) => a.day_number - b.day_number)
                .map((d) => d.name)
                .join('|'),
            )
            .sort();
        },
        { timeout: 10_000 },
      )
      .toEqual([
        `Day B ${TS}|Day C ${TS}|Day A ${TS}`,
        `Day B ${TS}|Day C ${TS}|Day A ${TS}`,
      ]);

    // ── 2e. DOM shows the new order. Day cards appear once per week, so
    //     pick the first match (week 1) for the assertion.
    await expect(
      page.getByTestId('day-card-1').first().locator('input').first(),
    ).toHaveValue(`Day B ${TS}`);
    await expect(
      page.getByTestId('day-card-2').first().locator('input').first(),
    ).toHaveValue(`Day C ${TS}`);
    await expect(
      page.getByTestId('day-card-3').first().locator('input').first(),
    ).toHaveValue(`Day A ${TS}`);
  });

  // ─── Scenario 3: Command palette open + search + select + recent ────
  test('Scenario 3: Cmd+K opens, search for "bana" lands Bob → reopen surfaces Bob in RECENT', async ({ page }) => {
    await login(page, EMAIL.coach);
    await expect(page.getByText(/Clients/i).first()).toBeVisible({ timeout: 15_000 });

    // ── 3a. Cmd+K (Meta+K) opens the palette with autofocus on input.
    await pressCmdK(page);
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 });
    const input = page.getByTestId('command-palette-input');
    await expect(input).toBeFocused();

    // ── 3b. Type "bana" — Bob Banana surfaces as the (only) CLIENT result.
    await input.fill('bana');
    const bobItem = page.getByTestId(`command-palette-item-CLIENT:${F.bobId}`);
    await expect(bobItem).toBeVisible({ timeout: 5_000 });
    // First (highlighted) item in the filtered list — bg-primary/10 + border-primary.
    await expect(bobItem).toHaveClass(/border-primary/);

    // ── 3c. Press Enter → palette closes, coach view switches to Bob.
    await input.press('Enter');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    // ClientDashboard header carries the trainee's name. Walk to the dashboard's
    // primary heading and assert Bob's name.
    await expect(page.locator('h1, h2, h3').filter({ hasText: NAME.bob }).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── 3d. Re-open the palette — Bob now appears in RECENT with input empty.
    await pressCmdK(page);
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('command-palette-input')).toHaveValue('');
    // The RECENT heading should be present and Bob should be the first visible item.
    await expect(page.getByText('RECENT', { exact: true })).toBeVisible();
    const recentBob = page.getByTestId(`command-palette-item-CLIENT:${F.bobId}`);
    await expect(recentBob).toBeVisible();

    // Close the palette to leave a clean state for Scenario 4.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
  });

  // ─── Scenario 4: keyboard navigation + Escape ────────────────────────
  test('Scenario 4: command palette ArrowDown×2 + Enter selects 3rd item; Escape dismisses', async ({ page }) => {
    await login(page, EMAIL.coach);
    await expect(page.getByText(/Clients/i).first()).toBeVisible({ timeout: 15_000 });

    // Open the palette with an empty query so the RECENT bucket (from
    // Scenario 3) is visible — plus we type 'qa' to widen results to all
    // three QA-tagged trainees + actions, giving us enough items to navigate
    // through in a deterministic order.
    await pressCmdK(page);
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 });
    // Use a query that matches all three trainees plus is stable across runs.
    // 'ux-' is in each of the QA trainees' email subtitles.
    const input = page.getByTestId('command-palette-input');
    await input.fill(`ux-`);
    // Wait for at least 3 items to be rendered.
    await expect(
      page.locator('[data-testid^="command-palette-item-CLIENT:"]').first(),
    ).toBeVisible();
    const items = page.locator('[data-testid^="command-palette-item-"]');
    const itemCount = await items.count();
    expect(itemCount).toBeGreaterThanOrEqual(3);

    // Capture the testid of the 3rd visible item before pressing keys.
    const thirdItemTestId = await items.nth(2).getAttribute('data-testid');
    expect(thirdItemTestId).toBeTruthy();
    const thirdItemId = thirdItemTestId!.replace('command-palette-item-', '');

    // ArrowDown × 2 highlights the third item (highlight starts at index 0).
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await expect(items.nth(2)).toHaveClass(/border-primary/);

    // Enter → the highlighted item's action fires. For a CLIENT item the
    // coach view switches to that client; for an ACTION it triggers the
    // handler. Either way the palette closes.
    await input.press('Enter');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);

    // If the 3rd item happened to be a CLIENT, confirm we're now viewing it.
    if (thirdItemId.startsWith('CLIENT:')) {
      const targetId = thirdItemId.slice('CLIENT:'.length);
      // Resolve the name from our fixture.
      const targetName =
        targetId === F.aliceId
          ? NAME.alice
          : targetId === F.bobId
            ? NAME.bob
            : targetId === F.carolId
              ? NAME.carol
              : null;
      if (targetName) {
        await expect(
          page.locator('h1, h2, h3').filter({ hasText: targetName }).first(),
        ).toBeVisible({ timeout: 10_000 });
      }
    }

    // ── 4b. Re-open and verify Escape dismisses without committing.
    await pressCmdK(page);
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 });
    // Stash what URL/hash we're on; Escape should not navigate.
    const beforeEscape = page.url();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    expect(page.url()).toBe(beforeEscape);
  });

  // ─── Scenario 5: 1RM goal regression (ifOverflow="extendDomain") ─────
  test('Scenario 5: target_e1rm=200 well above current best — ReferenceLine renders + Y-axis extends', async ({
    page,
  }) => {
    const GOAL = 200;
    // Seed the goal BEFORE login. AnalyticsDashboard reads on mount.
    await admin.from('exercise_goals').upsert(
      {
        client_id: F.carolId,
        exercise_id: F.carolSquatExerciseId,
        target_e1rm: GOAL,
      },
      { onConflict: 'client_id,exercise_id' },
    );

    await login(page, EMAIL.carol);
    await page.getByTestId('dashboard-tab-analytics').click();
    await expect(page.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`exercise-tab-${F.carolSquatExerciseId}`).click();
    await page.getByTestId('analytics-view-e1rm').click();
    await expect(page.getByTestId('e1rm-chart')).toBeVisible();

    // ── 5a. Label text is rendered as <text>Goal 200kg</text> inside the chart.
    const chart = page.getByTestId('e1rm-chart');
    await expect(chart.locator('text', { hasText: `Goal ${GOAL}kg` })).toBeVisible({ timeout: 10_000 });

    // ── 5b. The dashed reference line is present (stroke-dasharray="4 4")
    //     and is a horizontal segment (y1 === y2).
    const refLine = chart.locator('line[stroke-dasharray="4 4"]').first();
    await expect(refLine).toHaveCount(1);
    const [y1, y2] = await refLine.evaluate((el: SVGLineElement) => [
      el.getAttribute('y1'),
      el.getAttribute('y2'),
    ]);
    expect(y1).toBe(y2);

    // ── 5c. Y-axis was extended so the goal isn't clipped. Recharts renders
    //     Y-axis tick labels as <text> nodes with class "recharts-cartesian-axis-tick-value"
    //     or just plain text on the YAxis group. We pull every <text> with a
    //     "kg" suffix and confirm the max value is ≥ GOAL.
    const yLabels = await chart.evaluate((node) => {
      const out: string[] = [];
      node.querySelectorAll('text').forEach((t) => {
        const txt = (t.textContent ?? '').trim();
        if (/^\d+(\.\d+)?\s*kg$/.test(txt)) out.push(txt);
      });
      return out;
    });
    const numericValues = yLabels
      .map((t) => parseFloat(t.replace(/[^\d.]/g, '')))
      .filter((n) => Number.isFinite(n));
    const maxAxis = Math.max(...numericValues);
    console.log(`[QA s5] yLabels=${JSON.stringify(yLabels)} maxAxis=${maxAxis}`);
    expect(maxAxis).toBeGreaterThanOrEqual(GOAL);
  });

  // ─── Scenario 6: BodyWeightLog new testids ───────────────────────────
  test('Scenario 6: BodyWeightLog data-testids drive the input + log + entry list cleanly', async ({
    page,
  }) => {
    await login(page, EMAIL.carol);
    await page.getByTestId('dashboard-tab-analytics').click();
    await expect(page.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('analytics-view-dots').click();

    // ── 6a. bodyweight-input testid resolves and accepts input.
    const input = page.getByTestId('bodyweight-input');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('82.5');

    // ── 6b. bodyweight-log-btn testid resolves and is now enabled.
    const logBtn = page.getByTestId('bodyweight-log-btn');
    await expect(logBtn).toBeEnabled();
    await logBtn.click();

    // ── 6c. Row landed in Supabase.
    const today = new Date().toISOString().slice(0, 10);
    const probe = await expect
      .poll(
        async () => {
          const { data } = await admin
            .from('body_weight_log')
            .select('id, weight_kg')
            .eq('client_id', F.carolId)
            .eq('logged_at', today)
            .single<{ id: string; weight_kg: number }>();
          return data;
        },
        { timeout: 10_000 },
      )
      .toMatchObject({ weight_kg: 82.5 });
    void probe;

    // Read back the row id so we can match the entry's testid exactly.
    const { data: row } = await admin
      .from('body_weight_log')
      .select('id')
      .eq('client_id', F.carolId)
      .eq('logged_at', today)
      .single<{ id: string }>();
    expect(row?.id).toBeTruthy();

    // ── 6d. The new entry renders with data-testid=`bodyweight-entry-${id}`.
    const entry = page.getByTestId(`bodyweight-entry-${row!.id}`);
    await expect(entry).toBeVisible({ timeout: 5_000 });
    await expect(entry).toContainText('82.5 kg');
    await expect(entry).toContainText(today);
  });

  // ─── Scenario 7 — reps + RPE free-text regression ──────────────────────
  //
  // Production fix removed `reps`, `expectedRpe`, `actualRpe` from the
  // numeric-kind mapping (lib/numericInput.ts `kindForColumnId`). Those
  // columns now accept ranges ("6-8"), notation ("AMRAP"), and modifiers
  // ("5+", "@8") without the sanitizer stripping non-digits. If anyone
  // re-adds them to the kind map by mistake, this test fails — it's the
  // load-bearing regression guard for the coach prescription workflow.
  test('Scenario 7: reps + RPE columns accept free-text input (ranges, notation, modifiers)', async ({
    page,
  }) => {
    // Scenario 1 reordered Alice's exercises (Bench moved to position 2).
    // Reset positions via service-role so row 0 deterministically maps to
    // F.aliceExerciseIds!.bench again — keeps this test independent of
    // sibling-test mutations.
    await admin.from('exercises').update({ position: 0 }).eq('id', F.aliceExerciseIds!.bench);
    await admin.from('exercises').update({ position: 1 }).eq('id', F.aliceExerciseIds!.squat);
    await admin.from('exercises').update({ position: 2 }).eq('id', F.aliceExerciseIds!.deadlift);

    await login(page, EMAIL.coach);
    await expect(page.getByText(NAME.alice).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText(NAME.alice).first().click();
    await page.getByTestId('admin-btn').click();
    await expect(page.getByText(/Admin Panel/i)).toBeVisible({ timeout: 15_000 });
    // Alice may not be the default selectedClient in AdminView — pick her
    // explicitly so we know which exercise rows we're addressing.
    await page.getByText(NAME.alice).first().click();
    const row0 = page.getByTestId('exercise-row-0');
    await expect(row0).toBeVisible({ timeout: 10_000 });
    // Confirm the position reset took: row 0 should show Bench.
    await expect(row0.locator('input').first()).toHaveValue(`Bench-${TS}`);

    // Cell inputs inside an exercise row, in DOM order:
    //   nth(0) → exercise name (combobox)
    //   nth(1) → sets
    //   nth(2) → reps
    //   nth(3) → expectedRpe
    //   nth(4..) → custom / actual columns (typed "Trainee Input" → text node)
    const repsInput = row0.locator('input').nth(2);
    const rpeInput = row0.locator('input').nth(3);

    const exId = F.aliceExerciseIds!.bench;

    // ── Reps: range survives, AMRAP survives, modifier survives ─────────
    const repsCases: Array<{ typed: string; rejected: string }> = [
      { typed: '6-8', rejected: '68' },
      { typed: 'AMRAP', rejected: '' },
      { typed: '5+', rejected: '5' },
    ];
    for (const { typed, rejected } of repsCases) {
      await repsInput.click();
      await repsInput.fill(typed);
      // Verify DOM value as typed, then blur and re-verify (catches the
      // commit-time sanitizer if anyone wires it back up).
      await expect(repsInput, `reps DOM value after type "${typed}"`).toHaveValue(typed);
      await repsInput.blur();
      await expect(repsInput, `reps DOM value after blur "${typed}"`).toHaveValue(typed);
      expect(typed, 'reps regression guard: rejected variant should differ').not.toBe(rejected);
      // Wait for the debounced save (~500 ms + write round-trip) and read
      // back via service-role.
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from('exercises')
              .select('reps')
              .eq('id', exId)
              .single<{ reps: string | null }>();
            return data?.reps ?? null;
          },
          { timeout: 10_000 },
        )
        .toBe(typed);
    }

    // ── Expected RPE: range + @-notation survive ────────────────────────
    const rpeCases: string[] = ['7-8', '@8'];
    for (const typed of rpeCases) {
      await rpeInput.click();
      await rpeInput.fill(typed);
      await expect(rpeInput, `expectedRpe DOM value after type "${typed}"`).toHaveValue(typed);
      await rpeInput.blur();
      await expect(rpeInput, `expectedRpe DOM value after blur "${typed}"`).toHaveValue(typed);
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from('exercises')
              .select('expected_rpe')
              .eq('id', exId)
              .single<{ expected_rpe: string | null }>();
            return data?.expected_rpe ?? null;
          },
          { timeout: 10_000 },
        )
        .toBe(typed);
    }
  });
});

// ─── Task 3 — Signup OTP delivery (programmatic) ─────────────────────────
//
// Verifies the signInWithOtp pipeline against the live Supabase config now
// that the email templates serve only the {{ .Token }} for both "Confirm
// signup" and "Magic Link" templates. We cannot read the email content
// from Playwright; the contract here is "the request to /auth/v1/otp
// succeeded and the form transitions to the OTP step without errors."
//
// Uses its own qa-*-rpe-* naming so cleanup is independent of the UX
// describe block above. An unverified auth user is the byproduct (the OTP
// flow creates the user up-front via shouldCreateUser: true); cleanup
// deletes that user via service-role in afterAll.

test.describe.serial('Signup OTP delivery — production E2E', () => {
  test.skip(!HAS_ENV, 'VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in .env');

  const otpCoachEmail = `qa-coach-rpe-${TS}@irontrack.test`;
  const otpInviteeEmail = `qa-trainee-rpe-${TS}@irontrack.test`;
  const otpCoachName = `QA RpeCoach ${TS}`;
  let otpCoachId = '';
  let otpInviteCode = '';
  let otpInviteId = '';
  // Tracking separate from the UX describe block so cleanup is isolated.
  const otpCreatedAuthIds = new Set<string>();
  const otpCreatedProfileIds = new Set<string>();
  const otpCreatedInviteIds = new Set<string>();

  test.beforeAll(async () => {
    // Coach.
    const c = await admin.auth.admin.createUser({
      email: otpCoachEmail,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: otpCoachName, role: 'admin', tenant_id: null },
    });
    if (c.error || !c.data?.user) throw new Error(`coach provision: ${c.error?.message}`);
    otpCoachId = c.data.user.id;
    otpCreatedAuthIds.add(otpCoachId);
    otpCreatedProfileIds.add(otpCoachId);
    await admin
      .from('profiles')
      .update({ name: otpCoachName, role: 'admin', tenant_id: otpCoachId })
      .eq('id', otpCoachId);

    // Invite code on the coach's tenant.
    const code = `RPE${TS.toString(36).toUpperCase()}`.slice(0, 14);
    const { data: inv, error: invErr } = await admin
      .from('invite_codes')
      .insert({
        code,
        coach_id: otpCoachId,
        tenant_id: otpCoachId,
        coach_name: otpCoachName,
        use_count: 0,
      })
      .select('id, code')
      .single<{ id: string; code: string }>();
    if (invErr || !inv) throw new Error(`invite provision: ${invErr?.message}`);
    otpInviteCode = inv.code;
    otpInviteId = inv.id;
    otpCreatedInviteIds.add(inv.id);
    console.log(
      `[QA otp fixture] coach=${otpCoachId} invite=${otpInviteCode} email=${otpInviteeEmail}`,
    );
  });

  test.afterAll(async () => {
    if (!HAS_ENV) return;
    // Find the invitee's auth user if signInWithOtp landed (shouldCreateUser
    // creates an unverified row). Look it up by email.
    try {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const invitee = list?.users.find((u) => u.email?.toLowerCase() === otpInviteeEmail.toLowerCase());
      if (invitee) otpCreatedAuthIds.add(invitee.id);
    } catch (err) {
      console.warn('[QA otp cleanup] invitee lookup failed', err);
    }

    if (otpCreatedInviteIds.size > 0) {
      await admin.from('invite_codes').delete().in('id', Array.from(otpCreatedInviteIds));
    }
    if (otpCreatedProfileIds.size > 0) {
      await admin.from('profiles').delete().in('id', Array.from(otpCreatedProfileIds));
    }
    let ok = 0;
    let bad = 0;
    for (const id of otpCreatedAuthIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) bad += 1;
      else ok += 1;
    }
    console.log(`[QA otp cleanup] auth.users deleted=${ok} failed=${bad}`);
    if (bad > 0) console.error('[QA otp cleanup] ⚠ partial cleanup — manual sweep required');
    void otpInviteId;
  });

  test('signInWithOtp succeeds + form transitions to OTP step without errors', async ({ page }) => {
    // Capture relevant network traffic + page errors throughout the test.
    const otpResponses: Array<{ status: number; url: string }> = [];
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('response', (res) => {
      const u = res.url();
      if (/\/auth\/v1\/otp/.test(u) || /\/auth\/v1\/signup/.test(u)) {
        otpResponses.push({ status: res.status(), url: u });
      }
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Open the magic-link invite URL. The signup page reads ?invite= from
    // the location and pre-fills the invite-code field.
    await page.goto(`/?invite=${otpInviteCode}`);
    await expect(page.getByTestId('signup-name')).toBeVisible({ timeout: 15_000 });
    // The welcome banner confirms the invite was recognised server-side
    // before we even submit — a quick sanity check that the magic-link
    // path is intact.
    await expect(page.getByTestId('invite-welcome-banner')).toBeVisible({ timeout: 10_000 });

    // Fill the form.
    await page.getByTestId('signup-name').fill(`QA Invitee ${TS}`);
    await page.getByTestId('signup-email').fill(otpInviteeEmail);
    await page.getByTestId('signup-password').fill(`Invitee-${TS}!`);
    await page.getByTestId('signup-confirm').fill(`Invitee-${TS}!`);
    // Invite-code field is pre-filled & read-only when arriving via magic link.

    // Submit. signInWithOtp fires on success and the form transitions to
    // the "Enter code" step.
    await page.getByTestId('signup-submit-btn').click();

    // The OTP step renders the `signup-otp` input when the request succeeded.
    // We assert visibility within 15s to allow for the Supabase round-trip.
    await expect(page.getByTestId('signup-otp')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('signup-verify-btn')).toBeVisible();

    // Assert: at least one /auth/v1/otp call returned a 2xx status. The
    // template fix shouldn't have changed the network contract.
    const otpAttempts = otpResponses.filter((r) => /\/auth\/v1\/otp/.test(r.url));
    expect(otpAttempts.length, `otp requests: ${JSON.stringify(otpResponses)}`).toBeGreaterThan(0);
    const success = otpAttempts.some((r) => r.status >= 200 && r.status < 300);
    expect(
      success,
      `expected at least one 2xx /auth/v1/otp response; got ${JSON.stringify(otpAttempts)}`,
    ).toBe(true);

    // No page-level errors or console errors should fire during the
    // happy-path send.
    expect(pageErrors, `pageerrors during signup: ${pageErrors.join(' | ')}`).toEqual([]);
    // The signup page intentionally logs "Could not send the verification
    // email" only on a 4xx/5xx OTP response; we asserted the OTP succeeded
    // above, so any console.error here is unexpected.
    const unexpected = consoleErrors.filter(
      (e) =>
        !/React DevTools/i.test(e) &&
        !/\[vite\]/i.test(e) &&
        // motion v11 LazyMotion advisory — harmless in dev, gone in prod
        // bundle, but allow-listed defensively.
        !/LazyMotion/i.test(e),
    );
    expect(unexpected, `unexpected console errors: ${unexpected.join(' | ')}`).toEqual([]);

    // We deliberately do NOT verify the OTP itself — the email can't be
    // read from Playwright. The invitee auth user is left unverified and
    // cleaned up in afterAll.
  });
});
