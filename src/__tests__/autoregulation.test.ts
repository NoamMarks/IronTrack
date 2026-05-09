import { describe, it, expect } from 'vitest';
import { rpeAutoregulationSuggestion } from '../lib/analytics';
import type { Client, ExercisePlan, WorkoutDay, WorkoutWeek, Program } from '../types';

// ─── Builders ────────────────────────────────────────────────────────────────

function makeExercise(over: Partial<ExercisePlan> & { id: string }): ExercisePlan {
  return {
    exerciseId: over.exerciseId ?? 'squat',
    exerciseName: over.exerciseName ?? 'Back Squat',
    reps: over.reps ?? '5',
    values: over.values ?? {},
    ...over,
  };
}

function makeDay(over: Partial<WorkoutDay> & { id: string }): WorkoutDay {
  return {
    dayNumber: over.dayNumber ?? 1,
    name: over.name ?? 'Lower',
    exercises: over.exercises ?? [],
    ...over,
  };
}

function makeProgram(weeks: WorkoutWeek[], over: Partial<Program> = {}): Program {
  return {
    id: over.id ?? 'p1',
    name: over.name ?? 'Block 1',
    status: over.status ?? 'active',
    columns: [],
    weeks,
    ...over,
  };
}

function makeClient(programs: Program[]): Client {
  return {
    id: 'c1',
    name: 'Test Trainee',
    email: 'test@example.com',
    role: 'trainee',
    programs,
  };
}

/** Convenience: build a client with N logged sessions of the given exercise,
 *  each with the supplied (expected, actual) RPE pair. Sessions are ordered
 *  newest-first by loggedAt to match how the production code sorts. */
function clientWithSessions(
  exerciseId: string,
  pairs: Array<{ expected: number; actual: number }>,
): Client {
  const days: WorkoutDay[] = pairs.map((p, i) =>
    makeDay({
      id: `d${i}`,
      // ISO timestamp descending so the most recent is index 0.
      loggedAt: new Date(2026, 4, 9 - i).toISOString(),
      exercises: [
        makeExercise({
          id: `ex-${i}`,
          exerciseId,
          expectedRpe: String(p.expected),
          actualRpe: String(p.actual),
        }),
      ],
    }),
  );
  return makeClient([makeProgram([{ id: 'w1', weekNumber: 1, days }])]);
}

// ─── Insufficient-data early return ──────────────────────────────────────────

describe('rpeAutoregulationSuggestion — early return on < 2 sessions', () => {
  it('returns { suggestion: null, avgDelta: null, sessionCount: 0 } when no sessions exist', () => {
    expect(rpeAutoregulationSuggestion(makeClient([]), 'squat')).toEqual({
      suggestion: null,
      avgDelta: null,
      sessionCount: 0,
    });
  });

  it('returns null suggestion when only 1 session has both actual + expected RPE', () => {
    const client = clientWithSessions('squat', [{ expected: 7, actual: 8 }]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.suggestion).toBeNull();
    expect(result.avgDelta).toBeNull();
    expect(result.sessionCount).toBe(1);
  });

  it('counts sessions only when BOTH actualRpe and expectedRpe are populated', () => {
    // Three logged days, but two are missing one of the two RPE columns.
    const client = makeClient([
      makeProgram([
        {
          id: 'w1',
          weekNumber: 1,
          days: [
            makeDay({
              id: 'd1',
              loggedAt: '2026-05-01T10:00:00Z',
              exercises: [makeExercise({ id: 'a', expectedRpe: '7' /* no actual */ })],
            }),
            makeDay({
              id: 'd2',
              dayNumber: 2,
              loggedAt: '2026-05-02T10:00:00Z',
              exercises: [makeExercise({ id: 'b', actualRpe: '8' /* no expected */ })],
            }),
            makeDay({
              id: 'd3',
              dayNumber: 3,
              loggedAt: '2026-05-03T10:00:00Z',
              exercises: [makeExercise({ id: 'c', expectedRpe: '7', actualRpe: '8' })],
            }),
          ],
        },
      ]),
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    // Only one session qualifies → still below the 2-session threshold.
    expect(result.sessionCount).toBe(1);
    expect(result.suggestion).toBeNull();
    expect(result.avgDelta).toBeNull();
  });
});

// ─── Threshold semantics ─────────────────────────────────────────────────────

describe('rpeAutoregulationSuggestion — threshold mapping', () => {
  it('returns "decrease" when avgDelta > 1.5 (consistently overshooting target)', () => {
    // Two sessions, both 2 RPE points above target → avgDelta = +2.0.
    const client = clientWithSessions('squat', [
      { expected: 7, actual: 9 },
      { expected: 7, actual: 9 },
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.suggestion).toBe('decrease');
    expect(result.avgDelta).toBe(2);
    expect(result.sessionCount).toBe(2);
  });

  it('returns "increase" when avgDelta < -1.5 (consistently undershooting target)', () => {
    // Two sessions, both 2 RPE points below target → avgDelta = -2.0.
    const client = clientWithSessions('squat', [
      { expected: 8, actual: 6 },
      { expected: 8, actual: 6 },
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.suggestion).toBe('increase');
    expect(result.avgDelta).toBe(-2);
    expect(result.sessionCount).toBe(2);
  });

  it('returns "maintain" when |avgDelta| ≤ 1.5 (close enough to target)', () => {
    // avgDelta = +1.0 → inside the 1.5 dead-band.
    const client = clientWithSessions('squat', [
      { expected: 7, actual: 8 },
      { expected: 7, actual: 8 },
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.suggestion).toBe('maintain');
    expect(result.avgDelta).toBe(1);
  });

  it('exactly +1.5 stays in "maintain" (boundary is strict >)', () => {
    // Two sessions averaging exactly +1.5 → still maintain, NOT decrease.
    const client = clientWithSessions('squat', [
      { expected: 7, actual: 8 },
      { expected: 7, actual: 9 },
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.avgDelta).toBe(1.5);
    expect(result.suggestion).toBe('maintain');
  });

  it('exactly -1.5 stays in "maintain" (boundary is strict <)', () => {
    const client = clientWithSessions('squat', [
      { expected: 8, actual: 6.5 },
      { expected: 8, actual: 6.5 },
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.avgDelta).toBe(-1.5);
    expect(result.suggestion).toBe('maintain');
  });

  it('flips to "decrease" the moment avgDelta crosses past +1.5', () => {
    const client = clientWithSessions('squat', [
      { expected: 7, actual: 8.5 },
      { expected: 7, actual: 9 },
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.avgDelta).toBe(1.8);
    expect(result.suggestion).toBe('decrease');
  });
});

// ─── avgDelta rounding ───────────────────────────────────────────────────────

describe('rpeAutoregulationSuggestion — avgDelta rounding', () => {
  it('rounds avgDelta to one decimal place', () => {
    // Three sessions with deltas +1, +1, +2 → mean = 1.333… → rounded 1.3.
    const client = clientWithSessions('squat', [
      { expected: 7, actual: 8 },
      { expected: 7, actual: 8 },
      { expected: 7, actual: 9 },
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.avgDelta).toBe(1.3);
    // 1.3 is inside the dead-band → maintain.
    expect(result.suggestion).toBe('maintain');
  });

  it('always returns avgDelta as a value with at most one decimal place', () => {
    // Two sessions with deltas +1.5 and +2 → mean = 1.75 → rounded to 1.8
    // (Math.round always rounds .5 up). The exact value is implementation-
    // defined past one decimal; the contract is simply "1-decimal rounding."
    const client = clientWithSessions('squat', [
      { expected: 7, actual: 8.5 },
      { expected: 7, actual: 9 },
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.avgDelta).not.toBeNull();
    // The rounded value × 10 should land on an integer (modulo floating-point
    // representation noise). Use a tolerance to absorb the 1.7999999… kind
    // of artifact that can leak through `Math.round(x * 10) / 10`.
    const scaled = result.avgDelta! * 10;
    expect(Math.abs(scaled - Math.round(scaled))).toBeLessThan(1e-9);
    // Sanity — we expect the rounded value to be in [1.7, 1.8].
    expect(result.avgDelta).toBeGreaterThanOrEqual(1.7);
    expect(result.avgDelta).toBeLessThanOrEqual(1.8);
  });

  it('reports avgDelta = 0 (not null) when actual perfectly matches expected', () => {
    const client = clientWithSessions('squat', [
      { expected: 7, actual: 7 },
      { expected: 8, actual: 8 },
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.avgDelta).toBe(0);
    expect(result.suggestion).toBe('maintain');
  });
});

// ─── Session window ──────────────────────────────────────────────────────────

describe('rpeAutoregulationSuggestion — only the last 3 sessions count', () => {
  it('caps sessionCount at 3 even when more logged sessions exist', () => {
    // Five logged sessions, all overshoot. The window is 3 most recent.
    const client = clientWithSessions('squat', [
      { expected: 7, actual: 9 },
      { expected: 7, actual: 9 },
      { expected: 7, actual: 9 },
      { expected: 7, actual: 9 },
      { expected: 7, actual: 9 },
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.sessionCount).toBe(3);
    expect(result.suggestion).toBe('decrease');
  });

  it('walks newest → oldest, so an old undershoot does not dilute a fresh overshoot', () => {
    // Newest 3 sessions are all +2 (decrease). The 4th-most-recent is -3.
    // The function should ignore the 4th and report +2.0 / decrease.
    const client = clientWithSessions('squat', [
      { expected: 7, actual: 9 }, // newest
      { expected: 7, actual: 9 },
      { expected: 7, actual: 9 },
      { expected: 7, actual: 4 }, // ignored — older than the window
    ]);
    const result = rpeAutoregulationSuggestion(client, 'squat');
    expect(result.sessionCount).toBe(3);
    expect(result.avgDelta).toBe(2);
    expect(result.suggestion).toBe('decrease');
  });
});
