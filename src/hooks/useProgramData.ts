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
  coach_notes: string | null;
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
  difficulty: number | null;
  reflection_note: string | null;
  reflection_at: string | null;
  coach_note: string | null;
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
          difficulty: d.difficulty ?? undefined,
          reflectionNote: d.reflection_note ?? undefined,
          reflectionAt: d.reflection_at ?? undefined,
          coachNote: d.coach_note ?? undefined,
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
    coachNotes: row.coach_notes ?? undefined,
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

  // ─── Roster auto-refresh on tab refocus ──────────────────────────────
  // When a coach texts/emails an invite link to an athlete and tabs back to
  // IronTrack, we silently re-fetch so the new trainee shows up in the
  // roster without a manual reload. The listener is bound to the same
  // identity-keyed `fetchData` callback as the initial fetch, so it
  // recreates only when the auth user changes — no infinite re-attach loop.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onFocus = () => { void fetchData(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
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

      // Merge the saved program into clients[] in place. We deliberately do
      // NOT refetch the canonical tree here: the program object we just wrote
      // IS the source of truth, and a refetch introduces a race where slow
      // saves arrive in a different order than the user's keystrokes — the
      // input would rubber-band back to a stale value mid-edit. Trusting the
      // local copy keeps the editor responsive AND keeps clients[] coherent
      // for the other views that read from it.
      setClients((prev) => prev.map((c) => ({
        ...c,
        programs: c.programs.map((p) => (p.id === program.id ? program : p)),
      })));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );


  const saveSession = useCallback(
    async (
      clientId: string,
      _programId: string,
      _weekId: string,
      day: WorkoutDay,
      opts: { markComplete?: boolean; reflection?: { difficulty: number; note: string } } = {},
    ) => {
      // markComplete:
      //   true  → "Finish Workout" path. Stamps days.logged_at with now()
      //           so the day shows up as completed in the dashboard.
      //   false → "Autosave" path. Persists exercise actuals without
      //           touching logged_at, so the trainee can put the phone
      //           down mid-workout and come back later without the day
      //           appearing as already finished.
      // Default true preserves the prior contract for any caller not yet
      // updated.
      //
      // reflection:
      //   When the trainee submits the post-workout modal we persist
      //   difficulty + note + reflection_at on the same row. The realtime
      //   subscription on the coach side fires on this single UPDATE.
      const markComplete = opts.markComplete ?? true;
      const reflection = opts.reflection;

      const dayUpdate: {
        name: string;
        logged_at?: string;
        difficulty?: number;
        reflection_note?: string;
        reflection_at?: string;
      } = { name: day.name };
      let nextLoggedAt = day.loggedAt ?? null;
      let nextDifficulty = day.difficulty;
      let nextReflectionNote = day.reflectionNote;
      let nextReflectionAt = day.reflectionAt;
      if (markComplete) {
        nextLoggedAt = new Date().toISOString();
        dayUpdate.logged_at = nextLoggedAt;
      }
      if (reflection) {
        nextDifficulty = reflection.difficulty;
        nextReflectionNote = reflection.note;
        nextReflectionAt = new Date().toISOString();
        dayUpdate.difficulty = reflection.difficulty;
        dayUpdate.reflection_note = reflection.note;
        dayUpdate.reflection_at = nextReflectionAt;
      }
      const { error: dayErr } = await supabase
        .from('days')
        .update(dayUpdate)
        .eq('id', day.id);
      if (dayErr) throw dayErr;

      // Push every exercise's actuals + values. Used by both autosave and
      // finish — the actuals are the trainee's primary work product and
      // should be persisted on every change, not held until "Finish".
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

      // Patch local state in place — the new exercises array IS the truth
      // post-save, and a refetch would just re-fetch what we already have.
      setClients((prev) => prev.map((c) => {
        if (c.id !== clientId) return c;
        return {
          ...c,
          programs: c.programs.map((p) => ({
            ...p,
            weeks: p.weeks.map((w) => ({
              ...w,
              days: w.days.map((d) =>
                d.id === day.id
                  ? {
                      ...day,
                      loggedAt: nextLoggedAt ?? undefined,
                      difficulty: nextDifficulty,
                      reflectionNote: nextReflectionNote,
                      reflectionAt: nextReflectionAt,
                    }
                  : d,
              ),
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
   * Materialise a saved template into a fresh, live `programs` row for
   * `clientId`. Mints brand-new uuids for the program / weeks / days /
   * exercises so the cloned tree never shares row keys with the source
   * template (or with any other instantiation).
   *
   * Runtime fields on each template exercise (`actualLoad`, `actualRpe`,
   * `notes`, `videoUrl`) are stripped here even though `snapshotProgram`
   * doesn't strip them server-side — this is a defence-in-depth so a
   * template that was saved from an in-flight session doesn't seed the
   * new program with its actuals.
   */
  const createProgramFromTemplate = useCallback(
    async (
      clientId: string,
      template: { name: string; columns: ProgramColumn[]; weeks: WorkoutWeek[] },
    ): Promise<Program> => {
      const programId = crypto.randomUUID();
      const { data: programData, error: programErr } = await supabase
        .from('programs')
        .insert({
          id: programId,
          client_id: clientId,
          tenant_id: tenantId,
          name: template.name,
          columns: template.columns,
          status: 'active',
        })
        .select()
        .single<ProgramRow>();
      if (programErr || !programData) {
        throw programErr ?? new Error('createProgramFromTemplate: no data returned');
      }

      // Promote the new program to the client's active slot — matches the
      // empty-program path so trainees see it immediately on next refresh.
      await supabase
        .from('profiles')
        .update({ active_program_id: programId })
        .eq('id', clientId);

      // Insert the week → day → exercise tree with fresh uuids. Each layer
      // depends on the previous one's id, so we cannot bulk-insert across
      // tables in a single round-trip — but each table can take all rows
      // for that level in one INSERT.
      const newWeeks: WorkoutWeek[] = [];
      const sortedTemplateWeeks = [...template.weeks].sort((a, b) => a.weekNumber - b.weekNumber);

      for (const tw of sortedTemplateWeeks) {
        const weekId = crypto.randomUUID();
        const { error: weekErr } = await supabase
          .from('weeks')
          .insert({ id: weekId, program_id: programId, week_number: tw.weekNumber });
        if (weekErr) throw weekErr;

        const newDays: WorkoutDay[] = [];
        const sortedTemplateDays = [...tw.days].sort((a, b) => a.dayNumber - b.dayNumber);

        for (const td of sortedTemplateDays) {
          const dayId = crypto.randomUUID();
          const { error: dayErr } = await supabase
            .from('days')
            .insert({ id: dayId, week_id: weekId, day_number: td.dayNumber, name: td.name });
          if (dayErr) throw dayErr;

          // Bulk insert the day's exercises in one round-trip.
          const exerciseRows = td.exercises.map((ex, position) => ({
            id: crypto.randomUUID(),
            day_id: dayId,
            position,
            exercise_id: ex.exerciseId,
            exercise_name: ex.exerciseName,
            sets: ex.sets ?? null,
            reps: ex.reps ?? null,
            expected_rpe: ex.expectedRpe ?? null,
            weight_range: ex.weightRange ?? null,
            // Strip runtime actuals/notes — see method-level comment.
            actual_load: null,
            actual_rpe: null,
            notes: null,
            video_url: null,
            values: ex.values ?? {},
          }));

          if (exerciseRows.length > 0) {
            const { data: insertedExercises, error: exErr } = await supabase
              .from('exercises')
              .insert(exerciseRows)
              .select();
            if (exErr) throw exErr;

            const newExercises: ExercisePlan[] = (insertedExercises ?? [])
              .slice()
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .map(rowToExercise);

            newDays.push({
              id: dayId,
              dayNumber: td.dayNumber,
              name: td.name,
              exercises: newExercises,
            });
          } else {
            newDays.push({
              id: dayId,
              dayNumber: td.dayNumber,
              name: td.name,
              exercises: [],
            });
          }
        }

        newWeeks.push({ id: weekId, weekNumber: tw.weekNumber, days: newDays });
      }

      const program: Program = {
        id: programData.id,
        name: programData.name,
        columns: programData.columns ?? template.columns,
        status: programData.status,
        createdAt: programData.created_at,
        tenantId: programData.tenant_id ?? undefined,
        weeks: newWeeks,
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
   * Duplicate a live program for the same client, stripping all actuals so
   * the copy starts as a blank slate ready for the next block. The new
   * program is named "Copy of …" and does NOT become the active program —
   * the coach activates it manually once they're satisfied with it.
   */
  const duplicateProgram = useCallback(
    async (clientId: string, program: Program): Promise<Program> => {
      const programId = crypto.randomUUID();
      const { data: programData, error: programErr } = await supabase
        .from('programs')
        .insert({
          id: programId,
          client_id: clientId,
          tenant_id: tenantId,
          name: `Copy of ${program.name}`,
          columns: program.columns,
          status: 'active',
        })
        .select()
        .single<ProgramRow>();
      if (programErr || !programData) {
        throw programErr ?? new Error('duplicateProgram: no data returned');
      }

      const newWeeks: WorkoutWeek[] = [];
      const sortedWeeks = [...program.weeks].sort((a, b) => a.weekNumber - b.weekNumber);

      for (const tw of sortedWeeks) {
        const weekId = crypto.randomUUID();
        const { error: weekErr } = await supabase
          .from('weeks')
          .insert({ id: weekId, program_id: programId, week_number: tw.weekNumber });
        if (weekErr) throw weekErr;

        const newDays: WorkoutDay[] = [];
        const sortedDays = [...tw.days].sort((a, b) => a.dayNumber - b.dayNumber);

        for (const td of sortedDays) {
          const dayId = crypto.randomUUID();
          const { error: dayErr } = await supabase
            .from('days')
            .insert({ id: dayId, week_id: weekId, day_number: td.dayNumber, name: td.name });
          if (dayErr) throw dayErr;

          const exerciseRows = td.exercises.map((ex, position) => ({
            id: crypto.randomUUID(),
            day_id: dayId,
            position,
            exercise_id: ex.exerciseId,
            exercise_name: ex.exerciseName,
            sets: ex.sets ?? null,
            reps: ex.reps ?? null,
            expected_rpe: ex.expectedRpe ?? null,
            weight_range: ex.weightRange ?? null,
            // Strip runtime actuals — clean slate for the duplicated block.
            actual_load: null,
            actual_rpe: null,
            notes: null,
            video_url: null,
            values: {},
          }));

          if (exerciseRows.length > 0) {
            const { data: insertedExercises, error: exErr } = await supabase
              .from('exercises')
              .insert(exerciseRows)
              .select();
            if (exErr) throw exErr;

            const newExercises: ExercisePlan[] = (insertedExercises ?? [])
              .slice()
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .map(rowToExercise);

            newDays.push({ id: dayId, dayNumber: td.dayNumber, name: td.name, exercises: newExercises });
          } else {
            newDays.push({ id: dayId, dayNumber: td.dayNumber, name: td.name, exercises: [] });
          }
        }

        newWeeks.push({ id: weekId, weekNumber: tw.weekNumber, days: newDays });
      }

      const newProgram: Program = {
        id: programData.id,
        name: programData.name,
        columns: programData.columns ?? program.columns,
        status: programData.status,
        createdAt: programData.created_at,
        tenantId: programData.tenant_id ?? undefined,
        weeks: newWeeks,
      };

      // Merge into state without changing activeProgramId — the coach
      // manually activates the duplicate when ready to assign it.
      setClients((prev) => prev.map((c) =>
        c.id === clientId ? { ...c, programs: [...c.programs, newProgram] } : c,
      ));
      return newProgram;
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

  /**
   * Append a freshly-created profile to the in-memory clients[] tree without a
   * full refetch. Used by the superadmin UI after POST /api/admin-create-user
   * so the new coach card shows up instantly. Idempotent — replaces an existing
   * row with the same id rather than duplicating it.
   */
  const appendClient = useCallback((client: Client) => {
    setClients((prev) => {
      const exists = prev.some((c) => c.id === client.id);
      if (exists) return prev.map((c) => (c.id === client.id ? client : c));
      return [...prev, client];
    });
  }, []);

  const saveCoachNote = useCallback(async (dayId: string, note: string): Promise<void> => {
    const trimmed = note.trim();
    const { error } = await supabase
      .from('days')
      .update({ coach_note: trimmed || null })
      .eq('id', dayId);
    if (error) throw error;

    setClients((prev) =>
      prev.map((c) => ({
        ...c,
        programs: c.programs.map((p) => ({
          ...p,
          weeks: p.weeks.map((w) => ({
            ...w,
            days: w.days.map((d) =>
              d.id === dayId ? { ...d, coachNote: trimmed || undefined } : d,
            ),
          })),
        })),
      })),
    );
  }, []);

  const saveBlockNotes = useCallback(async (programId: string, notes: string): Promise<void> => {
    const trimmed = notes.trim();
    const { error } = await supabase
      .from('programs')
      .update({ coach_notes: trimmed || null })
      .eq('id', programId);
    if (error) throw error;

    setClients((prev) =>
      prev.map((c) => ({
        ...c,
        programs: c.programs.map((p) =>
          p.id === programId ? { ...p, coachNotes: trimmed || undefined } : p,
        ),
      })),
    );
  }, []);

  return {
    clients,
    isLoadingData,
    refetch: fetchData,
    saveProgram,
    saveSession,
    archiveProgram,
    deleteClient,
    createProgram,
    createProgramFromTemplate,
    duplicateProgram,
    addClient,
    appendClient,
    getClientsForTenant,
    saveCoachNote,
    saveBlockNotes,
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
    // A coach without a tenantId is a data-integrity problem — the signup
    // trigger should always set tenant_id = the new user's own id for admin
    // accounts. Falling back to '' would issue .eq('tenant_id', '') which
    // matches literal empty-string rows (not NULL rows) and could return
    // completely unintended data, so we fail loudly instead.
    if (!user.tenantId) {
      console.error('[IronTrack fetchClientsForUser] admin user is missing tenantId', user.id);
      return [user]; // Return at least the coach's own profile so the app stays usable.
    }

    // Coach: fetch every profile in their tenant + every program belonging to
    // those profiles. PostgREST embeds the program tree in a single round-trip.
    const { data: profiles, error: profilesErr } = await supabase
      .from('profiles')
      .select('id, name, email, role, tenant_id, active_program_id')
      .eq('tenant_id', user.tenantId);
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
