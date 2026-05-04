import type { Program, ExercisePlan } from '../types';

/**
 * "What did I do last time I lifted this" lookup.
 *
 * Progressive-overload reference: when the trainee opens week 2 / day 3 /
 * Squat, they want to glance at what they hit on the most recent prior
 * session of the SAME exercise on the SAME dayNumber before committing
 * today's number.
 *
 * Smarter than literal `weekNumber - 1`:
 *   - If they skipped week 1 entirely and we're now on week 3, the lookup
 *     walks back through weeks 2, 1 and returns the first that actually
 *     has logged data for this exercise. Returning "last week" with no
 *     data when there's perfectly good data 2 weeks back would be a
 *     hostile UX.
 *   - The returned `fromWeekNumber` lets the UI label the chip honestly
 *     ("Last week" vs "Week 1, 2 weeks ago").
 *
 * Matching is by NAME (case-insensitive, trim-tolerant) inside the same
 * `dayNumber`, not by exercise ID — each week has its own ExercisePlan
 * IDs even when they're conceptually the same lift, and coaches sometimes
 * reorder exercises within a day.
 *
 * Returns `null` when:
 *   - Current week is week 1 (no prior week exists at all)
 *   - No prior week has logged data for the matching `(dayNumber, name)` pair
 *   - The matching exercise was never carried into prior weeks
 */
export interface PreviousSession {
  exercise: ExercisePlan;
  fromWeekNumber: number;
}

export function findPreviousWeekExercise(
  program: Program,
  currentWeekNumber: number,
  currentDayNumber: number,
  exerciseName: string,
): PreviousSession | null {
  if (currentWeekNumber <= 1) return null;
  const targetName = exerciseName.trim().toLowerCase();

  // Walk backwards from `currentWeekNumber - 1` down to week 1, returning
  // the first match with at least one logged value. Sorting once is more
  // robust than indexing — the weeks array isn't guaranteed to be in
  // weekNumber order from Supabase.
  const priorWeeks = [...program.weeks]
    .filter((w) => w.weekNumber < currentWeekNumber)
    .sort((a, b) => b.weekNumber - a.weekNumber);

  for (const week of priorWeeks) {
    const day = week.days.find((d) => d.dayNumber === currentDayNumber);
    if (!day) continue;
    const match = day.exercises.find(
      (ex) => ex.exerciseName.trim().toLowerCase() === targetName,
    );
    if (!match) continue;
    if (!hasAnyLoggedData(match)) continue;
    return { exercise: match, fromWeekNumber: week.weekNumber };
  }
  return null;
}

/**
 * True when an exercise has at least one logged value — either a per-set
 * load/rpe key in `values` or the legacy `actualLoad` / `actualRpe` fields.
 *
 * We deliberately don't gate on `day.loggedAt`: a trainee who autosaved
 * their actuals but didn't tap "Finish Workout" still produced data worth
 * referencing.
 */
export function hasAnyLoggedData(ex: ExercisePlan): boolean {
  if (ex.actualLoad && ex.actualLoad !== '') return true;
  if (ex.actualRpe && ex.actualRpe !== '') return true;
  if (ex.values) {
    for (const [k, v] of Object.entries(ex.values)) {
      if (v == null || v === '') continue;
      if (k.startsWith('set_') && (k.endsWith('_load') || k.endsWith('_rpe'))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Read the saved load for a specific set on a previous-session exercise.
 *
 * Storage layered to evolve with the app:
 *   - Newer per-set: `ex.values["set_<n>_load"]`
 *   - Legacy fallback: `ex.actualLoad` mirrors set 1 only
 */
export function getPreviousSetLoad(
  prev: PreviousSession | ExercisePlan | null,
  setN: number,
): string | null {
  const ex = unwrap(prev);
  if (!ex) return null;
  const fromValues = ex.values?.[`set_${setN}_load`];
  if (fromValues != null && fromValues !== '') return fromValues;
  if (setN === 1 && ex.actualLoad && ex.actualLoad !== '') return ex.actualLoad;
  return null;
}

/**
 * Read the saved RPE for a specific set. Same layered lookup as load.
 */
export function getPreviousSetRpe(
  prev: PreviousSession | ExercisePlan | null,
  setN: number,
): string | null {
  const ex = unwrap(prev);
  if (!ex) return null;
  const fromValues = ex.values?.[`set_${setN}_rpe`];
  if (fromValues != null && fromValues !== '') return fromValues;
  if (setN === 1 && ex.actualRpe && ex.actualRpe !== '') return ex.actualRpe;
  return null;
}

function unwrap(x: PreviousSession | ExercisePlan | null): ExercisePlan | null {
  if (!x) return null;
  if ('exercise' in x && 'fromWeekNumber' in x) return x.exercise;
  return x as ExercisePlan;
}
