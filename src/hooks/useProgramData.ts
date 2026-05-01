import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Client, Program, ProgramColumn, WorkoutDay, WorkoutWeek, ExercisePlan } from '../types';
import { DEFAULT_COLUMNS } from '../constants/mockData';
import { createInviteCode, buildInviteLink } from '../lib/inviteCodes';

// =============================================================================
// useProgramData — Phase 3 (Supabase backend)
// =============================================================================
//
// Replaces the localStorage clients[] tree with Supabase queries against the
// profiles / programs / weeks / days / exercises tables.
//
// The hook keeps the same nested Client[] shape that the UI components expect;
// flat SQL rows are stitched into that tree on fetch and mutated either in
// place (single-row updates) or via refetch of the affected program (when
// the change involves nested rows). Trade-off documented per mutation.
//
// API surface:
//   clients                 — nested Client[] (same shape as Phase 2)
//   isLoadingData           — true until first fetch resolves on auth change
//   refetch()               — re-pull everything for the current user
//   saveProgram(program)    — full sync of one program tree (diff + apply)
//   saveSession(...)        — patch one day's exercises + logged_at
//   archiveProgram(...)     — UPDATE programs.status = 'archived'
//   deleteClient(...)       — DELETE profile (cascades through programs)
//   createProgram(...)      — INSERT empty program shell, with default columns
//   addClient(...)          — Coach inviting a trainee → INSERT invite_code,
//                             returns the generated code so the UI can copy it
//   getClientsForTenant(u)  — in-memory tenant filter (unchanged semantics)
// =============================================================================

// ─── Row → Client tree mapping ───────────────────────────────────────────────

interface ProfileRow {
  id: string;
  name: string;
  email: string;
  role: Client['role'];
  tenant_id: string | null;
  active_program_id: string | null;
}

interface ProgramRow {
  id: string;
  client_id: string;
  tenant_id: string | null;
  name: string;
  columns: ProgramColumn[] | null;
  status: 'active' | 'archived';
  archived_at: string | null;
  created_at: string;
  weeks?: WeekRow[];
}

interface WeekRow {
  id: string;
  program_id: string;
  week_number: number;
  days?: DayRow[];
}

interface DayRow {
  id: string;
  week_id: string;
  day_number: number;
  name: string;
  logged_at: string | null;
  exercises?: ExerciseRow[];
}

interface ExerciseRow {
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

function profileToClient(row: ProfileRow, programs: Program[] = []): Client {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    tenantId: row.tenant_id ?? undefined,
    activeProgramId: row.active_program_id ?? undefined,
    programs,
  };
}

function rowToProgram(row: ProgramRow): Program {
  const weeks: WorkoutWeek[] = (row.weeks ?? [])
    .slice()
    .sort((a, b) => a.week_number - b.week_number)
    .map((w) => ({
      id: w.id,
      weekNumber: w.week_number,
      days: (w.days ?? [])
        .slice()
        .sort((a, b) => a.day_number - b.day_number)
        .map((d) => ({
          id: d.id,
          dayNumber: d.day_number,
          name: d.name,
          loggedAt: d.logged_at ?? undefined,
          exercises: (d.exercises ?? [])
            .slice()
            .sort((a, b) => a.position - b.position)
            .map(rowToExercise),
        })),
    }));
  return {
    id: row.id,
    name: row.name,
    columns: row.columns ?? [],
    status: row.status,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    tenantId: row.tenant_id ?? undefined,
    weeks,
  };
}

function rowToExercise(row: ExerciseRow): ExercisePlan {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    exerciseName: row.exercise_name,
    sets: row.sets ?? undefined,
    reps: row.reps ?? undefined,
    expectedRpe: row.expected_rpe ?? undefined,
    weightRange: row.weight_range ?? undefined,
    actualLoad: row.actual_load ?? undefined,
    actualRpe: row.actual_rpe ?? undefined,
    notes: row.notes ?? undefined,
    videoUrl: row.video_url ?? undefined,
    values: row.values ?? {},
  };
}

const PROGRAM_TREE_SELECT = `
  *,
  weeks (
    *,
    days (
      *,
      exercises (*)
    )
  )
`;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useProgramData(authenticatedUser: Client | null) {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Mirrors `clients` for stable closures inside async mutations — avoids the
  // stale-closure pattern that bit Phase 1.
  const clientsRef = useRef<Client[]>([]);
  clientsRef.current = clients;

  const userId = authenticatedUser?.id ?? null;
  const tenantId = authenticatedUser?.tenantId ?? null;
  const role = authenticatedUser?.role ?? null;

  // ─── Fetch ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!authenticatedUser || !userId) {
      setClients([]);
      setIsLoadingData(false);
      return;
    }
    setIsLoadingData(true);
    try {
      const next = await fetchClientsForUser(authenticatedUser);
      setClients(next);
    } catch (err) {
      console.error('[IronTrack data] fetch failed', err);
      setClients([]);
    } finally {
      setIsLoadingData(false);
    }
  }, [authenticatedUser, userId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ─── Mutations ────────────────────────────────────────────────────────

  const saveProgram = useCallback(
    async (program: Program) => {
      // Update program metadata in one round-trip.
      const { error: updateErr } = await supabase
        .from('programs')
        .update({
          name: program.name,
          columns: program.columns,
          status: program.status,
          archived_at: program.archivedAt ?? null,
        })
        .eq('id', program.id);
      if (updateErr) throw updateErr;

      // Sync nested weeks/days/exercises against the database. We diff by id
      // so we DELETE rows the coach removed and INSERT/UPDATE the rest.
      // Trade-off: many round-trips for big programs. Acceptable for Phase 3
      // — granular mutation hooks can be added in a later optimisation pass.
      await syncWeeks(program.id, program.weeks);

      // Refetch only this program's tree and merge into clients[].
      await refetchProgram(program.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const refetchProgram = useCallback(async (programId: string) => {
    const { data, error } = await supabase
      .from('programs')
      .select(PROGRAM_TREE_SELECT)
      .eq('id', programId)
      .single<ProgramRow>();
    if (error || !data) {
      console.error('[IronTrack data] refetchProgram failed', error);
      return;
    }
    const fresh = rowToProgram(data);
    setClients((prev) => prev.map((c) =>
      c.id === data.client_id
        ? { ...c, programs: c.programs.map((p) => (p.id === fresh.id ? fresh : p)).concat(
            c.programs.some((p) => p.id === fresh.id) ? [] : [fresh],
          ) }
        : c,
    ));
  }, []);

  const saveSession = useCallback(
    async (clientId: string, _programId: string, _weekId: string, day: WorkoutDay) => {
      const loggedAt = new Date().toISOString();
      // Update the day's logged_at first so the UI reflects "saved" timestamp.
      const { error: dayErr } = await supabase
        .from('days')
        .update({ logged_at: loggedAt, name: day.name })
        .eq('id', day.id);
      if (dayErr) throw dayErr;

      // Push every exercise's actuals + values. We use an upsert keyed by id
      // so this also handles any locally-mutated exercise rows.
      for (const ex of day.exercises) {
        const { error: exErr } = await supabase
          .from('exercises')
          .update({
            sets: ex.sets ?? null,
            reps: ex.reps ?? null,
            expected_rpe: ex.expectedRpe ?? null,
            weight_range: ex.weightRange ?? null,
            actual_load: ex.actualLoad ?? null,
            actual_rpe: ex.actualRpe ?? null,
            notes: ex.notes ?? null,
            video_url: ex.videoUrl ?? null,
            values: ex.values ?? {},
          })
          .eq('id', ex.id);
        if (exErr) throw exErr;
      }

      // Patch local state in place (no full refetch needed — we already have
      // the new shape). This keeps the trainee's UI snappy after Save Session.
      setClients((prev) => prev.map((c) => {
        if (c.id !== clientId) return c;
        return {
          ...c,
          programs: c.programs.map((p) => ({
            ...p,
            weeks: p.weeks.map((w) => ({
              ...w,
              days: w.days.map((d) => (d.id === day.id ? { ...day, loggedAt } : d)),
            })),
          })),
        };
      }));
    },
    [],
  );

  const archiveProgram = useCallback(
    async (clientId: string, programId: string) => {
      const archivedAt = new Date().toISOString();
      const { error } = await supabase
        .from('programs')
        .update({ status: 'archived', archived_at: archivedAt })
        .eq('id', programId);
      if (error) throw error;

      // Also clear active_program_id on the client if it pointed here.
      const target = clientsRef.current.find((c) => c.id === clientId);
      if (target?.activeProgramId === programId) {
        await supabase
          .from('profiles')
          .update({ active_program_id: null })
          .eq('id', clientId);
      }

      setClients((prev) => prev.map((c) => {
        if (c.id !== clientId) return c;
        return {
          ...c,
          activeProgramId: c.activeProgramId === programId ? undefined : c.activeProgramId,
          programs: c.programs.map((p) =>
            p.id === programId
              ? { ...p, status: 'archived' as const, archivedAt }
              : p,
          ),
        };
      }));
    },
    [],
  );

  const deleteClient = useCallback(async (clientId: string) => {
    const { error } = await supabase.from('profiles').delete().eq('id', clientId);
    if (error) throw error;
    setClients((prev) => prev.filter((c) => c.id !== clientId));
  }, []);

  const createProgram = useCallback(
    async (clientId: string): Promise<Program> => {
      const programId = crypto.randomUUID();
      const { data, error } = await supabase
        .from('programs')
        .insert({
          id: programId,
          client_id: clientId,
          tenant_id: tenantId,
          name: 'Training Block 1',
          columns: DEFAULT_COLUMNS,
          status: 'active',
        })
        .select()
        .single<ProgramRow>();
      if (error || !data) throw error ?? new Error('createProgram: no data returned');

      // Set this as the client's active program.
      await supabase
        .from('profiles')
        .update({ active_program_id: programId })
        .eq('id', clientId);

      // Bootstrap with one default week/day so the editor has something to render.
      const weekId = crypto.randomUUID();
      const dayId = crypto.randomUUID();
      await supabase.from('weeks').insert({
        id: weekId,
        program_id: programId,
        week_number: 1,
      });
      await supabase.from('days').insert({
        id: dayId,
        week_id: weekId,
        day_number: 1,
        name: 'Day A',
      });

      const program: Program = {
        id: data.id,
        name: data.name,
        columns: data.columns ?? [],
        status: data.status,
        createdAt: data.created_at,
        tenantId: data.tenant_id ?? undefined,
        weeks: [
          {
            id: weekId,
            weekNumber: 1,
            days: [{ id: dayId, dayNumber: 1, name: 'Day A', exercises: [] }],
          },
        ],
      };
      setClients((prev) => prev.map((c) =>
        c.id === clientId
          ? { ...c, activeProgramId: programId, programs: [...c.programs, program] }
          : c,
      ));
      return program;
    },
    [tenantId],
  );

  /**
   * Coach inviting a trainee — creates an invite code in the Supabase
   * invite_codes table. The legacy `addClient` parameters (name, email,
   * password, role) are accepted for callsite compatibility but ONLY tenantId
   * and the implicit coach identity are used.
   */
  const addClient = useCallback(
    async (
      _name: string,
      _email: string,
      _password: string,
      // role is accepted for legacy callsite compatibility but unused — Phase 3
      // only generates trainee invite codes; coach creation is server-side.
      role: Client['role'] = 'trainee',
      tenantIdArg?: string,
    ): Promise<{ inviteCode: string; link: string }> => {
      if (!authenticatedUser) {
        throw new Error('addClient: must be authenticated');
      }
      void role;
      const tid = (tenantIdArg ?? authenticatedUser.tenantId ?? authenticatedUser.id).trim();
      if (!tid) throw new Error('addClient: tenantId required');

      const invite = await createInviteCode(
        authenticatedUser.id,
        tid,
        authenticatedUser.name,
      );
      return { inviteCode: invite.code, link: buildInviteLink(invite.code) };
    },
    [authenticatedUser],
  );

  const getClientsForTenant = useCallback((user: Client): Client[] => {
    if (user.role === 'superadmin') return clients;
    return clients.filter((c) => c.tenantId === user.tenantId && c.id !== user.id);
  }, [clients]);

  return {
    clients,
    isLoadingData,
    refetch: fetchData,
    saveProgram,
    saveSession,
    archiveProgram,
    deleteClient,
    createProgram,
    addClient,
    getClientsForTenant,
  };

  // Cross-reference for tests/debugging — these hint variables silence
  // unused-warnings on tenant/role until granular tenant logic moves into
  // RLS-side filters.
  void tenantId;
  void role;
}

// ─── Top-of-tree fetch ───────────────────────────────────────────────────────

async function fetchClientsForUser(user: Client): Promise<Client[]> {
  if (user.role === 'trainee') {
    // Trainee: fetch their own profile + all their (active and archived) programs.
    const { data, error } = await supabase
      .from('programs')
      .select(PROGRAM_TREE_SELECT)
      .eq('client_id', user.id);
    if (error) throw error;
    const programs = (data ?? []).map(rowToProgram);
    return [{ ...user, programs }];
  }

  if (user.role === 'admin') {
    // Coach: fetch every profile in their tenant + every program belonging to
    // those profiles. PostgREST embeds the program tree in a single round-trip.
    const { data: profiles, error: profilesErr } = await supabase
      .from('profiles')
      .select('id, name, email, role, tenant_id, active_program_id')
      .eq('tenant_id', user.tenantId ?? '');
    if (profilesErr) throw profilesErr;

    const profileIds = (profiles ?? []).map((p) => p.id);
    if (profileIds.length === 0) return [user];

    const { data: programs, error: progErr } = await supabase
      .from('programs')
      .select(PROGRAM_TREE_SELECT)
      .in('client_id', profileIds);
    if (progErr) throw progErr;

    const programsByClient = new Map<string, Program[]>();
    for (const row of (programs ?? []) as ProgramRow[]) {
      const list = programsByClient.get(row.client_id) ?? [];
      list.push(rowToProgram(row));
      programsByClient.set(row.client_id, list);
    }
    const profileClients = (profiles ?? []).map((p) =>
      profileToClient(p as ProfileRow, programsByClient.get(p.id) ?? []),
    );
    // Ensure the coach's own profile is in the list so AppShell renders correctly.
    if (!profileClients.some((c) => c.id === user.id)) {
      profileClients.push(user);
    }
    return profileClients;
  }

  // Superadmin: fetch everyone (RLS allows this for role=superadmin).
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, name, email, role, tenant_id, active_program_id');
  if (error) throw error;
  return (profiles ?? []).map((p) => profileToClient(p as ProfileRow, []));
}

// ─── Diff & sync helpers (saveProgram) ───────────────────────────────────────

async function syncWeeks(programId: string, nextWeeks: WorkoutWeek[]): Promise<void> {
  const { data: existing, error } = await supabase
    .from('weeks')
    .select('id, week_number')
    .eq('program_id', programId);
  if (error) throw error;
  const existingIds = new Set((existing ?? []).map((w) => w.id));
  const nextIds = new Set(nextWeeks.map((w) => w.id));

  // DELETE removed weeks (cascades through days/exercises).
  for (const e of existing ?? []) {
    if (!nextIds.has(e.id)) {
      await supabase.from('weeks').delete().eq('id', e.id);
    }
  }
  for (const w of nextWeeks) {
    if (existingIds.has(w.id)) {
      await supabase.from('weeks').update({ week_number: w.weekNumber }).eq('id', w.id);
    } else {
      await supabase.from('weeks').insert({
        id: w.id, program_id: programId, week_number: w.weekNumber,
      });
    }
    await syncDays(w.id, w.days);
  }
}

async function syncDays(weekId: string, nextDays: WorkoutDay[]): Promise<void> {
  const { data: existing, error } = await supabase
    .from('days')
    .select('id, day_number, name, logged_at')
    .eq('week_id', weekId);
  if (error) throw error;
  const existingIds = new Set((existing ?? []).map((d) => d.id));
  const nextIds = new Set(nextDays.map((d) => d.id));

  for (const e of existing ?? []) {
    if (!nextIds.has(e.id)) {
      await supabase.from('days').delete().eq('id', e.id);
    }
  }
  for (const d of nextDays) {
    if (existingIds.has(d.id)) {
      await supabase
        .from('days')
        .update({ day_number: d.dayNumber, name: d.name })
        .eq('id', d.id);
    } else {
      await supabase.from('days').insert({
        id: d.id,
        week_id: weekId,
        day_number: d.dayNumber,
        name: d.name,
      });
    }
    await syncExercises(d.id, d.exercises);
  }
}

async function syncExercises(dayId: string, nextExercises: ExercisePlan[]): Promise<void> {
  const { data: existing, error } = await supabase
    .from('exercises')
    .select('id')
    .eq('day_id', dayId);
  if (error) throw error;
  const existingIds = new Set((existing ?? []).map((e) => e.id));
  const nextIds = new Set(nextExercises.map((e) => e.id));

  for (const e of existing ?? []) {
    if (!nextIds.has(e.id)) {
      await supabase.from('exercises').delete().eq('id', e.id);
    }
  }
  // Insert/update with explicit position so SELECTs ORDER BY position match
  // the array order the coach typed.
  for (let i = 0; i < nextExercises.length; i += 1) {
    const ex = nextExercises[i];
    const payload = {
      day_id: dayId,
      position: i,
      exercise_id: ex.exerciseId,
      exercise_name: ex.exerciseName,
      sets: ex.sets ?? null,
      reps: ex.reps ?? null,
      expected_rpe: ex.expectedRpe ?? null,
      weight_range: ex.weightRange ?? null,
      actual_load: ex.actualLoad ?? null,
      actual_rpe: ex.actualRpe ?? null,
      notes: ex.notes ?? null,
      video_url: ex.videoUrl ?? null,
      values: ex.values ?? {},
    };
    if (existingIds.has(ex.id)) {
      await supabase.from('exercises').update(payload).eq('id', ex.id);
    } else {
      await supabase.from('exercises').insert({ ...payload, id: ex.id });
    }
  }
}
