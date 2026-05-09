import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Client, Program, ExercisePlan } from '../types';

/**
 * Unit coverage for `useProgramData.duplicateProgram`.
 *
 * The hook talks to Supabase to mint fresh rows for the cloned program.
 * We mock supabase-js so each `.from('table').insert(...)` round-trip
 * resolves with an enriched copy of the request body — closely enough to
 * the real PostgREST behaviour for the in-memory diff to settle.
 *
 * Contract under test:
 *   - new program name is "Copy of <original>"
 *   - actual fields (actualLoad, actualRpe, notes, videoUrl) are stripped
 *   - exercise.values is reset to {}
 *   - status is 'active'
 *   - the original program object handed in is not mutated
 */

interface InsertCall {
  table: string;
  payload: unknown;
}

const insertCalls: InsertCall[] = [];

vi.mock('../lib/supabase', () => {
  const buildBuilder = (table: string) => {
    const builder: {
      insert: (payload: unknown) => typeof builder;
      update: (payload: unknown) => typeof builder;
      select: () => typeof builder;
      eq: (col: string, val: string) => typeof builder;
      single: <T>() => Promise<{ data: T | null; error: null }>;
      then: (
        onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise<unknown>;
      __lastPayload: unknown;
    } = {
      __lastPayload: null,
      insert(payload: unknown) {
        builder.__lastPayload = payload;
        insertCalls.push({ table, payload });
        return builder;
      },
      update(payload: unknown) {
        builder.__lastPayload = payload;
        return builder;
      },
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      single<T>(): Promise<{ data: T | null; error: null }> {
        // For the program insert — return a shaped row mirroring the payload
        // so duplicateProgram's mapping of `programData.id` / `created_at`
        // works without explicit branching.
        const payload = builder.__lastPayload as Record<string, unknown> | null;
        if (!payload) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({
          data: {
            ...payload,
            created_at: '2026-05-01T00:00:00.000Z',
          } as T,
          error: null,
        });
      },
      then(onFulfilled, onRejected) {
        // Bulk insert path — return the payload as the rows. duplicateProgram
        // re-reads inserted exercises with .select() chained to insert, which
        // hits this `then` after .insert().select() returns the builder.
        const payload = builder.__lastPayload;
        const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
      from: vi.fn((table: string) => buildBuilder(table)),
    },
  };
});

import { useProgramData } from '../hooks/useProgramData';

beforeEach(() => {
  insertCalls.length = 0;
});

const COACH: Client = {
  id: 'coach-1',
  name: 'Coach Alpha',
  email: 'coach@example.com',
  role: 'admin',
  tenantId: 'coach-1',
  programs: [],
};

function makeExercise(over: Partial<ExercisePlan> = {}): ExercisePlan {
  return {
    id: over.id ?? 'ex-1',
    exerciseId: over.exerciseId ?? 'squat',
    exerciseName: over.exerciseName ?? 'Back Squat',
    sets: over.sets ?? 4,
    reps: over.reps ?? '5',
    expectedRpe: over.expectedRpe ?? '7',
    weightRange: over.weightRange,
    actualLoad: over.actualLoad,
    actualRpe: over.actualRpe,
    notes: over.notes,
    videoUrl: over.videoUrl,
    values: over.values ?? {},
  };
}

function makeOriginalProgram(): Program {
  return {
    id: 'p-original',
    name: 'Hypertrophy Phase 1',
    status: 'active',
    columns: [
      { id: 'sets', label: 'Sets', type: 'plan' },
      { id: 'actualLoad', label: 'Load', type: 'actual' },
    ],
    weeks: [
      {
        id: 'w1',
        weekNumber: 1,
        days: [
          {
            id: 'd1',
            dayNumber: 1,
            name: 'Lower',
            loggedAt: '2026-04-01T12:00:00Z',
            exercises: [
              makeExercise({
                id: 'ex-1',
                exerciseName: 'Back Squat',
                actualLoad: '120',
                actualRpe: '8',
                notes: 'felt heavy',
                videoUrl: 'https://example.com/squat',
                values: {
                  set_1_load: '120',
                  set_1_rpe: '8',
                  set_2_load: '125',
                },
              }),
              makeExercise({
                id: 'ex-2',
                exerciseId: 'rdl',
                exerciseName: 'Romanian Deadlift',
                actualLoad: '100',
                values: { set_1_load: '100' },
              }),
            ],
          },
        ],
      },
    ],
  };
}

describe('useProgramData.duplicateProgram', () => {
  it('mints a new program named "Copy of <original>" and returns it', async () => {
    const original = makeOriginalProgram();
    const { result } = renderHook(() => useProgramData(COACH));

    let dup: Program | undefined;
    await act(async () => {
      dup = await result.current.duplicateProgram('trainee-1', original);
    });

    expect(dup).toBeDefined();
    expect(dup!.name).toBe(`Copy of ${original.name}`);
    // Payload sent to Supabase agrees.
    const programInsert = insertCalls.find((c) => c.table === 'programs');
    expect(programInsert).toBeDefined();
    expect((programInsert!.payload as Record<string, unknown>).name).toBe('Copy of Hypertrophy Phase 1');
  });

  it('the duplicate is created with status="active"', async () => {
    const original = makeOriginalProgram();
    const { result } = renderHook(() => useProgramData(COACH));

    let dup: Program | undefined;
    await act(async () => {
      dup = await result.current.duplicateProgram('trainee-1', original);
    });

    expect(dup!.status).toBe('active');
    const programInsert = insertCalls.find((c) => c.table === 'programs');
    expect((programInsert!.payload as Record<string, unknown>).status).toBe('active');
  });

  it('strips actualLoad / actualRpe / notes / video_url on every duplicated exercise', async () => {
    const original = makeOriginalProgram();
    const { result } = renderHook(() => useProgramData(COACH));

    await act(async () => {
      await result.current.duplicateProgram('trainee-1', original);
    });

    const exerciseInserts = insertCalls.filter((c) => c.table === 'exercises');
    // The hook bulk-inserts all exercises for one day in a single call.
    expect(exerciseInserts.length).toBeGreaterThan(0);
    const allRows = exerciseInserts.flatMap((c) =>
      Array.isArray(c.payload) ? (c.payload as Record<string, unknown>[]) : [c.payload as Record<string, unknown>],
    );
    expect(allRows.length).toBe(2); // two exercises in the original day
    for (const row of allRows) {
      expect(row.actual_load).toBeNull();
      expect(row.actual_rpe).toBeNull();
      expect(row.notes).toBeNull();
      expect(row.video_url).toBeNull();
    }
  });

  it('resets values to {} on every duplicated exercise — no per-set carry-over', async () => {
    const original = makeOriginalProgram();
    const { result } = renderHook(() => useProgramData(COACH));

    await act(async () => {
      await result.current.duplicateProgram('trainee-1', original);
    });

    const exerciseInserts = insertCalls.filter((c) => c.table === 'exercises');
    const allRows = exerciseInserts.flatMap((c) =>
      Array.isArray(c.payload) ? (c.payload as Record<string, unknown>[]) : [c.payload as Record<string, unknown>],
    );
    for (const row of allRows) {
      expect(row.values).toEqual({});
    }
  });

  it('does NOT mutate the original program object', async () => {
    const original = makeOriginalProgram();
    // Capture a deep snapshot via JSON round-trip — sufficient for the
    // plain-data shape we're dealing with.
    const snapshot = JSON.parse(JSON.stringify(original));

    const { result } = renderHook(() => useProgramData(COACH));
    await act(async () => {
      await result.current.duplicateProgram('trainee-1', original);
    });

    expect(original).toEqual(snapshot);
    // Original still has its actuals intact — the duplicate stripped on the
    // way in, not on the way out.
    expect(original.weeks[0].days[0].exercises[0].actualLoad).toBe('120');
    expect(original.weeks[0].days[0].exercises[0].values).toEqual({
      set_1_load: '120',
      set_1_rpe: '8',
      set_2_load: '125',
    });
  });

  it('preserves the plan-side fields (exerciseName, sets, reps, expectedRpe) on the duplicate', async () => {
    const original = makeOriginalProgram();
    const { result } = renderHook(() => useProgramData(COACH));

    await act(async () => {
      await result.current.duplicateProgram('trainee-1', original);
    });

    const exerciseInserts = insertCalls.filter((c) => c.table === 'exercises');
    const allRows = exerciseInserts.flatMap((c) =>
      Array.isArray(c.payload) ? (c.payload as Record<string, unknown>[]) : [c.payload as Record<string, unknown>],
    );
    const squatRow = allRows.find((r) => r.exercise_name === 'Back Squat');
    expect(squatRow).toBeDefined();
    expect(squatRow!.sets).toBe(4);
    expect(squatRow!.reps).toBe('5');
    expect(squatRow!.expected_rpe).toBe('7');
    expect(squatRow!.exercise_id).toBe('squat');
  });
});
