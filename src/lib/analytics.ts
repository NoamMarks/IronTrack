import { format, parseISO } from 'date-fns';
import type { Client, Program, ExercisePlan } from '../types';

// ─── e1RM (Epley formula) ────────────────────────────────────────────────────

/**
 * Estimated 1RM via the Epley formula:  e1RM = weight × (1 + reps/30)
 * Returns null if weight or reps is missing/invalid.
 */
export function estimate1RM(weight: number, reps: number): number | null {
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;
  if (weight <= 0 || reps <= 0) return null;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

/**
 * Parse a string like "5", "5-8", "5x", "AMRAP" into a usable rep count.
 * For ranges, picks the lower bound (more conservative e1RM).
 * Returns null if no valid number can be extracted.
 */
export function parseReps(reps: string | number | undefined): number | null {
  if (reps === undefined || reps === null) return null;
  if (typeof reps === 'number') return reps > 0 ? reps : null;
  const match = reps.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return n > 0 ? n : null;
}

/**
 * Parse a load string like "100", "100kg", "100.5" into kilograms.
 */
export function parseLoad(load: string | undefined): number | null {
  if (!load) return null;
  const match = load.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return n > 0 ? n : null;
}

// ─── Per-set load discovery ──────────────────────────────────────────────────

/**
 * Collect every loaded set on an exercise as `(load, reps)` pairs.
 *
 * Storage layered to evolve with the app:
 *   - Newer per-set data lives in `ex.values["set_<n>_load"]` keyed by the
 *     1-indexed set number.
 *   - Older data has a single load on `ex.actualLoad`. Set 1 of new data
 *     ALSO mirrors there, so to avoid double-counting we only fall back to
 *     `ex.actualLoad` when no `set_<n>_load` keys are present.
 *
 * `reps` for every set is the planned `ex.reps` value — the trainee logs
 * load + RPE per set but NOT actual reps, on the convention that "the
 * prescribed reps were performed". A failed/short rep set therefore reads
 * as the planned count; that's an over-estimate of e1RM, accepted as a
 * trade-off for not adding another input on the gym floor.
 */
export function getLoadedSets(ex: ExercisePlan): Array<{ load: number; reps: number; setN: number }> {
  const reps = parseReps(ex.reps);
  if (reps === null) return [];

  const out: Array<{ load: number; reps: number; setN: number }> = [];
  let foundPerSet = false;

  if (ex.values) {
    for (const [key, raw] of Object.entries(ex.values)) {
      const m = key.match(/^set_(\d+)_load$/);
      if (!m) continue;
      foundPerSet = true;
      const load = parseLoad(raw);
      if (load === null) continue;
      out.push({ load, reps, setN: parseInt(m[1], 10) });
    }
  }

  if (!foundPerSet) {
    const legacy = parseLoad(ex.actualLoad);
    if (legacy !== null) out.push({ load: legacy, reps, setN: 1 });
  }

  return out.sort((a, b) => a.setN - b.setN);
}

// ─── Time series data points ─────────────────────────────────────────────────

export interface E1RMPoint {
  date: string;        // ISO date (yyyy-mm-dd) for x-axis
  e1rm: number;
  exerciseName: string;
  programName: string;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Walk every program (active + archived) for a client and produce e1RM points
 * for the requested exercise. Each logged session contributes ONE point — the
 * e1RM of the heaviest set that day. Skips days without logged_at and
 * exercises without any loaded set.
 */
export function aggregateE1RM(client: Client, exerciseId: string): E1RMPoint[] {
  const points: E1RMPoint[] = [];

  for (const program of client.programs) {
    for (const week of program.weeks) {
      for (const day of week.days) {
        if (!day.loggedAt) continue;
        for (const ex of day.exercises) {
          if (ex.exerciseId !== exerciseId) continue;
          const sets = getLoadedSets(ex);
          if (sets.length === 0) continue;

          // Heaviest e1RM across the session's sets — the right number to
          // track for strength progression.
          let best: number | null = null;
          for (const s of sets) {
            const e = estimate1RM(s.load, s.reps);
            if (e === null) continue;
            if (best === null || e > best) best = e;
          }
          if (best === null) continue;

          points.push({
            date: format(parseISO(day.loggedAt), 'yyyy-MM-dd'),
            e1rm: best,
            exerciseName: ex.exerciseName,
            programName: program.name,
          });
        }
      }
    }
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Total volume (weight × reps, summed across sets) for one exercise on
 * one logged day. Returns 0 if the exercise has no loaded sets — caller
 * decides whether to plot a zero or skip the day.
 */
export function exerciseVolume(ex: ExercisePlan): number {
  const sets = getLoadedSets(ex);
  return sets.reduce((acc, s) => acc + s.load * s.reps, 0);
}

export interface VolumePoint {
  date: string;
  volume: number;
  exerciseName: string;
  programName: string;
}

/**
 * Walk every program and produce daily volume points for one exercise.
 * Useful for hypertrophy-block analytics where total tonnage matters more
 * than peak strength.
 */
export function aggregateVolume(client: Client, exerciseId: string): VolumePoint[] {
  const points: VolumePoint[] = [];
  for (const program of client.programs) {
    for (const week of program.weeks) {
      for (const day of week.days) {
        if (!day.loggedAt) continue;
        for (const ex of day.exercises) {
          if (ex.exerciseId !== exerciseId) continue;
          const v = exerciseVolume(ex);
          if (v <= 0) continue;
          points.push({
            date: format(parseISO(day.loggedAt), 'yyyy-MM-dd'),
            volume: Math.round(v * 10) / 10,
            exerciseName: ex.exerciseName,
            programName: program.name,
          });
        }
      }
    }
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Discover every distinct exerciseId across the client's history. Useful for
 * populating the analytics chart selector.
 */
export function listLoggedExercises(client: Client): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const program of client.programs) {
    for (const week of program.weeks) {
      for (const day of week.days) {
        if (!day.loggedAt) continue;
        for (const ex of day.exercises) {
          if (getLoadedSets(ex).length === 0) continue;
          if (!seen.has(ex.exerciseId)) seen.set(ex.exerciseId, ex.exerciseName);
        }
      }
    }
  }
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

/**
 * Personal record for an exercise: the highest e1RM ever logged.
 * Returns null when the trainee has no loaded sets for that exercise.
 */
export function personalRecord(client: Client, exerciseId: string): {
  e1rm: number;
  date: string;
  load: number;
  reps: number;
} | null {
  let best: { e1rm: number; date: string; load: number; reps: number } | null = null;
  for (const program of client.programs) {
    for (const week of program.weeks) {
      for (const day of week.days) {
        if (!day.loggedAt) continue;
        for (const ex of day.exercises) {
          if (ex.exerciseId !== exerciseId) continue;
          const sets = getLoadedSets(ex);
          for (const s of sets) {
            const e = estimate1RM(s.load, s.reps);
            if (e === null) continue;
            if (best === null || e > best.e1rm) {
              best = {
                e1rm: e,
                date: format(parseISO(day.loggedAt), 'yyyy-MM-dd'),
                load: s.load,
                reps: s.reps,
              };
            }
          }
        }
      }
    }
  }
  return best;
}

/**
 * Number of times an exercise was logged across the client's history.
 * Counts logged days where the exercise has at least one loaded set, not
 * raw set count — answers "how many times did Sarah squat in the last
 * block" rather than "how many squat sets total".
 */
export function exerciseFrequency(client: Client, exerciseId: string): number {
  let count = 0;
  for (const program of client.programs) {
    for (const week of program.weeks) {
      for (const day of week.days) {
        if (!day.loggedAt) continue;
        const hit = day.exercises.some(
          (ex) => ex.exerciseId === exerciseId && getLoadedSets(ex).length > 0,
        );
        if (hit) count += 1;
      }
    }
  }
  return count;
}

/** Cross-reference for `Program` import — keeps the import live for tooling. */
void ({} as Program);
