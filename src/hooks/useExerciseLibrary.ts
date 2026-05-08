import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

// =============================================================================
// useExerciseLibrary — shared catalogue of named lifts
// =============================================================================
//
// Reads the public.exercise_library table, which carries both global rows
// (coach_id IS NULL, visible to everyone) and per-coach custom additions
// (coach_id = the owning coach, visible only to them). RLS enforces the
// scoping server-side — see the 2026-05-09_exercise_library migration —
// so this hook does not filter by coach_id in the query.
//
// API surface:
//   exercises                  — globals first (alphabetical), then coach
//                                rows alphabetical. The picker UI renders
//                                them in this order with a divider between.
//   isLoading / error          — fetch lifecycle
//   addExerciseToLibrary(...)  — INSERT a coach-owned row, idempotent on
//                                (coach_id, lower(name)) thanks to the
//                                partial unique index in the migration.
//   searchExercises(query)     — synchronous case-insensitive substring
//                                match against `name`. Empty / whitespace
//                                query returns the full list.
//   refresh()                  — re-pull (post-mutation safety net)
//
// Search is intentionally client-side: the catalogue is at most a few
// hundred rows (10 seeded globals + the coach's curated additions), so an
// in-memory filter is faster than a round-trip and gives instant typeahead
// UX. If the library ever grows past a few thousand rows this should move
// to a trigram-indexed `ilike` query against the database.
// =============================================================================

export type ExerciseCategory = 'squat' | 'bench' | 'deadlift' | 'accessory';

export interface LibraryExercise {
  id: string;
  name: string;
  category: ExerciseCategory;
  videoUrl?: string;
  /** True for built-in global rows (coach_id NULL); false for coach-authored. */
  isGlobal: boolean;
  createdAt: string;
}

interface ExerciseLibraryRow {
  id: string;
  coach_id: string | null;
  tenant_id: string | null;
  name: string;
  category: ExerciseCategory;
  video_url: string | null;
  created_at: string;
}

function rowToExercise(r: ExerciseLibraryRow): LibraryExercise {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    videoUrl: r.video_url ?? undefined,
    isGlobal: r.coach_id === null,
    createdAt: r.created_at,
  };
}

// Globals first, then coach-authored — alphabetical within each group. Used
// both for the initial fetch and the optimistic update after addExerciseToLibrary.
function sortLibrary(arr: LibraryExercise[]): LibraryExercise[] {
  return [...arr].sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) return a.isGlobal ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export interface UseExerciseLibraryReturn {
  exercises: LibraryExercise[];
  isLoading: boolean;
  error: Error | null;
  /** Add a coach-owned row. Defaults to the 'accessory' bucket — the three
   *  competition lifts are seeded as globals, so anything a coach adds by
   *  hand is most likely supplementary. Pass a category explicitly when
   *  that's not the case. Idempotent on (coach_id, lower(name)): re-saving
   *  an existing entry returns the existing row (and patches a missing
   *  video_url if one was just supplied) rather than throwing. */
  addExerciseToLibrary: (
    name: string,
    videoUrl: string,
    category?: ExerciseCategory,
  ) => Promise<LibraryExercise>;
  /** Case-insensitive substring match against `name`. */
  searchExercises: (query: string) => LibraryExercise[];
  refresh: () => Promise<void>;
}

export function useExerciseLibrary(): UseExerciseLibraryReturn {
  const [exercises, setExercises] = useState<LibraryExercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Order in SQL: globals first (NULLs first on coach_id), then by
      // name. Avoids a client-side resort on first paint.
      const { data, error: fetchErr } = await supabase
        .from('exercise_library')
        .select('id, coach_id, tenant_id, name, category, video_url, created_at')
        .order('coach_id', { ascending: true, nullsFirst: true })
        .order('name', { ascending: true });
      if (fetchErr) throw fetchErr;
      setExercises(((data ?? []) as ExerciseLibraryRow[]).map(rowToExercise));
    } catch (err) {
      console.error('[useExerciseLibrary] fetch failed', err);
      setError(err instanceof Error ? err : new Error('Failed to load exercise library.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const addExerciseToLibrary = useCallback(
    async (
      name: string,
      videoUrl: string,
      category: ExerciseCategory = 'accessory',
    ): Promise<LibraryExercise> => {
      const trimmedName = name.trim();
      const trimmedUrl = videoUrl.trim();
      if (!trimmedName) throw new Error('Exercise name is required.');

      // Resolve the caller. RLS will reject a row whose coach_id != auth.uid()
      // anyway, but pulling the user up front lets us provide a clearer
      // error than the Postgres permission denied message.
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) {
        throw new Error('You must be signed in to add exercises.');
      }

      // Denormalised tenant_id mirrors the pattern used by `programs` /
      // `invite_codes`: a coach's tenant_id == coach's own profile id, which
      // is exactly user.id here.
      const { data, error: insertErr } = await supabase
        .from('exercise_library')
        .insert({
          coach_id: user.id,
          tenant_id: user.id,
          name: trimmedName,
          category,
          video_url: trimmedUrl || null,
        })
        .select('id, coach_id, tenant_id, name, category, video_url, created_at')
        .single<ExerciseLibraryRow>();

      // Postgres unique-violation. The dedupe index uses lower(name), so
      // re-saving "back squat" when "Back Squat" already exists also lands
      // here. Return the existing row rather than surfacing a confusing
      // error to the coach.
      if (insertErr && insertErr.code === '23505') {
        const lowered = trimmedName.toLowerCase();
        const existing = exercises.find(
          (e) => !e.isGlobal && e.name.toLowerCase() === lowered,
        );
        if (existing) {
          // Existing entry might be missing a video_url that the coach
          // just supplied — patch it in place so the shortcut feels like
          // an upsert rather than surprising them with a separate UPDATE.
          if (trimmedUrl && !existing.videoUrl) {
            const { data: patched, error: patchErr } = await supabase
              .from('exercise_library')
              .update({ video_url: trimmedUrl })
              .eq('id', existing.id)
              .select('id, coach_id, tenant_id, name, category, video_url, created_at')
              .single<ExerciseLibraryRow>();
            if (!patchErr && patched) {
              const updated = rowToExercise(patched);
              setExercises((prev) =>
                sortLibrary(prev.map((e) => (e.id === updated.id ? updated : e))),
              );
              return updated;
            }
          }
          return existing;
        }
        // Edge case: dupe exists in the database but isn't in our local
        // cache (race with another tab). Refresh and re-throw so the
        // caller can surface a "try again" message.
        await fetchAll();
        throw new Error('An exercise with that name already exists in your library.');
      }

      if (insertErr || !data) {
        console.error('[useExerciseLibrary] addExerciseToLibrary failed', insertErr);
        throw new Error(insertErr?.message ?? 'Failed to add exercise.');
      }

      const created = rowToExercise(data);
      setExercises((prev) => sortLibrary([...prev, created]));
      return created;
    },
    [exercises, fetchAll],
  );

  // Memoise a lower-cased view of the names so repeated keystrokes in a
  // typeahead don't re-lowercase the whole array on every keystroke.
  const searchIndex = useMemo(
    () => exercises.map((ex) => ({ ex, lowerName: ex.name.toLowerCase() })),
    [exercises],
  );

  const searchExercises = useCallback(
    (query: string): LibraryExercise[] => {
      const q = query.trim().toLowerCase();
      if (!q) return exercises;
      return searchIndex.filter(({ lowerName }) => lowerName.includes(q)).map(({ ex }) => ex);
    },
    [exercises, searchIndex],
  );

  return {
    exercises,
    isLoading,
    error,
    addExerciseToLibrary,
    searchExercises,
    refresh: fetchAll,
  };
}
