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
 * for the requested exercise. Skips days that were never logged or that lack
 * an actual load.
 */
export function aggregateE1RM(client: Client, exerciseId: string): E1RMPoint[] {
  const points: E1RMPoint[] = [];

  for (const program of client.programs) {
    for (const week of program.weeks) {
      for (const day of week.days) {
        if (!day.loggedAt) continue;
        for (const ex of day.exercises) {
          if (ex.exerciseId !== exerciseId) continue;
          const point = e1rmPointFromExercise(ex, day.loggedAt, program);
          if (point) points.push(point);
        }
      }
    }
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function e1rmPointFromExercise(
  ex: ExercisePlan,
  loggedAt: string,
  program: Program,
): E1RMPoint | null {
  const load = parseLoad(ex.actualLoad);
  const reps = parseReps(ex.reps);
  if (load === null || reps === null) return null;
  const e1rm = estimate1RM(load, reps);
  if (e1rm === null) return null;
  return {
    date: loggedAt.slice(0, 10),
    e1rm,
    exerciseName: ex.exerciseName,
    programName: program.name,
  };
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
          if (parseLoad(ex.actualLoad) === null) continue;
          if (!seen.has(ex.exerciseId)) seen.set(ex.exerciseId, ex.exerciseName);
        }
      }
    }
  }
  return Array.from(seen, ([id, name]) => ({ id, name }));
}