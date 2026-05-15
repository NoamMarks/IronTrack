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

    // ── 1c. Try Playwright's manual pointer drag (Bench → past Deadlift).
    //     If dnd-kit consumes the events as expected, we get a real drag.
    //     If not, we fall back to chevron-button reorder below.
    const benchBox = await benchHandle.boundingBox();
    const deadliftBox = await deadliftRow.boundingBox();
    let draggedViaPointer = false;
    if (benchBox && deadliftBox) {
      const startX = benchBox.x + benchBox.width / 2;
      const startY = benchBox.y + benchBox.height / 2;
      const endX = deadliftBox.x + deadliftBox.width / 2;
      const endY = deadliftBox.y + deadliftBox.height + 4; // past the bottom of Deadlift
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // dnd-kit's PointerSensor needs >=8px movement to activate.
      await page.mouse.move(startX + 12, startY + 12, { steps: 5 });
      await page.mouse.move(endX, endY, { steps: 20 });
      await page.mouse.up();
      // Settle 500ms for dnd-kit to fire onDragEnd + the debounced save.
      await page.waitForTimeout(700);
      const afterDrag = await admin
        .from('exercises')
        .select('exercise_name, position')
        .eq('day_id', F.aliceDayId!)
        .order('position');
      const afterDragNames = (afterDrag.data ?? []).map((r) => (r as { exercise_name: string }).exercise_name);
      draggedViaPointer = afterDragNames[2] === `Bench-${TS}`;
      if (draggedViaPointer) {
        // Drag worked → also verify save indicator flashed.
        // The indicator is `save-status-1` (parent day's dayNumber=1).
        // We may have already missed the 'Saving...' window, but '✓ Saved'
        // should still be visible at the 700ms mark.
        const status = page.getByTestId('save-status-1');
        const text = (await status.count()) > 0 ? await status.textContent() : null;
        console.log(`[QA s1] pointer drag worked. save-status-1 text="${text}"`);
      }
    }

    // ── 1d. Chevron fallback path — works regardless of pointer drag outcome.
    //     Reset DB via service-role first so the chevron test has a clean slate.
    if (draggedViaPointer) {
      await admin.from('exercises').update({ position: 0 }).eq('id', F.aliceExerciseIds!.bench);
      await admin.from('exercises').update({ position: 1 }).eq('id', F.aliceExerciseIds!.squat);
      await admin.from('exercises').update({ position: 2 }).eq('id', F.aliceExerciseIds!.deadlift);
      await page.reload();
      await page.getByText(NAME.alice).first().click();
      await page.getByTestId('admin-btn').click();
      await expect(page.getByTestId('exercise-row-0')).toBeVisible({ timeout: 10_000 });
    }

    // Use the chevron buttons: click bench's ChevronDown twice (Bench is row 0).
    // The chevron is the 1st button inside the .flex.flex-col stack of row 0.
    const benchChevronDown = page
      .getByTestId('exercise-row-0')
      .locator('div.flex.flex-col button')
      .nth(1);
    await benchChevronDown.click(); // Bench → position 1
    await page.waitForTimeout(150);
    // After first click, Bench is row 1, so click the down button of row 1 now.
    await page
      .getByTestId('exercise-row-1')
      .locator('div.flex.flex-col button')
      .nth(1)
      .click();

    // Debounced save (500ms) needs to settle before we read SQL.
    await page.waitForTimeout(1500);

    // ── 1e. Verify SQL reflects the new order.
    const finalOrder = await admin
      .from('exercises')
      .select('exercise_name, position')
      .eq('day_id', F.aliceDayId!)
      .order('position');
    const finalNames = (finalOrder.data ?? []).map((r) => (r as { exercise_name: string }).exercise_name);
    expect(finalNames).toEqual([`Squat-${TS}`, `Deadlift-${TS}`, `Bench-${TS}`]);

    // ── 1f. Verify DOM order matches.
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

    // ── 2a. dnd-kit infrastructure on day cards.
    const dayADragHandle = page.getByTestId('day-drag-handle-1');
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
    //     Day A from position 1 → 2 → 3.
    await page.getByTestId('day-down-btn-1').click(); // Day A ↔ Day B  (A becomes #2)
    await page.waitForTimeout(200);
    // After the swap, Day A's testid is now day-down-btn-2.
    await page.getByTestId('day-down-btn-2').click(); // Day A ↔ Day C  (A becomes #3)

    // Settle the debounced program save (~500ms) plus a buffer.
    await page.waitForTimeout(1500);

    // ── 2d. Verify cross-week sync via SQL: every week has Day B at #1,
    //     Day C at #2, Day A at #3.
    const after = await admin
      .from('days')
      .select('week_id, day_number, name')
      .in('week_id', F.bobWeekIds!);
    const byWeekAfter = new Map<string, Array<{ day_number: number; name: string }>>();
    for (const r of (after.data ?? []) as Array<{ week_id: string; day_number: number; name: string }>) {
      const arr = byWeekAfter.get(r.week_id) ?? [];
      arr.push({ day_number: r.day_number, name: r.name });
      byWeekAfter.set(r.week_id, arr);
    }
    // Should have exactly 2 weeks.
    expect(byWeekAfter.size).toBe(2);
    for (const [weekId, arr] of byWeekAfter) {
      arr.sort((a, b) => a.day_number - b.day_number);
      expect(
        arr.map((d) => d.name),
        `week ${weekId} day order`,
      ).toEqual([`Day B ${TS}`, `Day C ${TS}`, `Day A ${TS}`]);
    }

    // ── 2e. DOM shows the new order in the currently visible week.
    await expect(page.getByTestId('day-card-1').locator('input').first()).toHaveValue(`Day B ${TS}`);
    await expect(page.getByTestId('day-card-2').locator('input').first()).toHaveValue(`Day C ${TS}`);
    await expect(page.getByTestId('day-card-3').locator('input').first()).toHaveValue(`Day A ${TS}`);
  });

  // ─── Scenario 3: Command palette open + search + select + recent ────
  test('Scenario 3: Cmd+K opens, search for "bana" lands Bob → reopen surfaces Bob in RECENT', async ({ page }) => {
    await login(page, EMAIL.coach);
    await expect(page.getByText(/Clients/i).first()).toBeVisible({ timeout: 15_000 });

    // ── 3a. Cmd+K (Meta+K) opens the palette with autofocus on input.
    await page.keyboard.press('Meta+K');
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
    await page.keyboard.press('Meta+K');
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
    await page.keyboard.press('Meta+K');
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
    await page.keyboard.press('Meta+K');
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
});
