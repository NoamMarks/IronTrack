import { describe, it, expect } from 'vitest';
import {
  findPreviousWeekExercise,
  getPreviousSetLoad,
  getPreviousSetRpe,
  hasAnyLoggedData,
} from '../lib/progressiveOverload';
import type { Program, ExercisePlan } from '../types';

const buildExercise = (overrides: Partial<ExercisePlan> = {}): ExercisePlan => ({
  id: overrides.id ?? 'ex-default',
  exerciseId: overrides.exerciseId ?? 'ex-id-default',
  exerciseName: overrides.exerciseName ?? 'Back Squat',
  sets: 3,
  reps: '5',
  values: {},
  ...overrides,
});

const buildProgram = (): Program => ({
  id: 'p1',
  name: 'Test Block',
  status: 'active',
  columns: [],
  weeks: [
    {
      id: 'w1',
      weekNumber: 1,
      days: [
        {
          id: 'w1-d1',
          dayNumber: 1,
          name: 'Lower',
          exercises: [
            buildExercise({
              id: 'w1-d1-squat',
              exerciseName: 'Back Squat',
              actualLoad: '100',
              actualRpe: '7',
              values: {
                set_1_load: '100',
                set_1_rpe: '7',
                set_2_load: '102.5',
                set_2_rpe: '7.5',
                set_3_load: '105',
                set_3_rpe: '8',
              },
            }),
            buildExercise({
              id: 'w1-d1-rdl',
              exerciseName: 'Romanian Deadlift',
              values: {
                set_1_load: '90',
                set_1_rpe: '6.5',
              },
            }),
          ],
          loggedAt: '2026-04-01T12:00:00Z',
        },
        {
          id: 'w1-d2',
          dayNumber: 2,
          name: 'Upper',
          exercises: [
            buildExercise({
              id: 'w1-d2-bench',
              exerciseName: 'Bench Press',
              values: { set_1_load: '80', set_1_rpe: '7' },
            }),
          ],
          loggedAt: '2026-04-03T12:00:00Z',
        },
      ],
    },
    {
      id: 'w2',
      weekNumber: 2,
      days: [
        {
          id: 'w2-d1',
          dayNumber: 1,
          name: 'Lower',
          exercises: [
            buildExercise({ id: 'w2-d1-squat', exerciseName: 'Back Squat' }),
            buildExercise({ id: 'w2-d1-rdl', exerciseName: 'Romanian Deadlift' }),
          ],
        },
      ],
    },
  ],
});

describe('findPreviousWeekExercise', () => {
  it('returns null on week 1 — there is no prior week', () => {
    const program = buildProgram();
    expect(findPreviousWeekExercise(program, 1, 1, 'Back Squat')).toBeNull();
  });

  it('finds the immediately-prior week and reports fromWeekNumber', () => {
    const program = buildProgram();
    const prev = findPreviousWeekExercise(program, 2, 1, 'Back Squat');
    expect(prev).not.toBeNull();
    expect(prev!.exercise.id).toBe('w1-d1-squat');
    expect(prev!.fromWeekNumber).toBe(1);
  });

  it('matches case-insensitively and trims whitespace', () => {
    const program = buildProgram();
    expect(findPreviousWeekExercise(program, 2, 1, '  back squat  ')!.exercise.id).toBe('w1-d1-squat');
    expect(findPreviousWeekExercise(program, 2, 1, 'BACK SQUAT')!.exercise.id).toBe('w1-d1-squat');
  });

  it('returns null when the prior day exists but the exercise name does not', () => {
    const program = buildProgram();
    expect(findPreviousWeekExercise(program, 2, 1, 'Front Squat')).toBeNull();
  });

  it('returns null when the prior week is missing the matching dayNumber', () => {
    const program = buildProgram();
    expect(findPreviousWeekExercise(program, 2, 5, 'Bench Press')).toBeNull();
  });

  it('survives reorder: same name in a different position still matches', () => {
    const program = buildProgram();
    program.weeks[0].days[0].exercises.reverse();
    const prev = findPreviousWeekExercise(program, 2, 1, 'Back Squat');
    expect(prev!.exercise.id).toBe('w1-d1-squat');
  });

  it('walks back past a skipped week to find data 2 weeks ago', () => {
    // Trainee did week 1, skipped week 2 entirely (no actuals in any
    // week-2 exercise), now opening week 3 / day 1 / Squat.
    const program = buildProgram();
    program.weeks.push({
      id: 'w3',
      weekNumber: 3,
      days: [
        {
          id: 'w3-d1',
          dayNumber: 1,
          name: 'Lower',
          exercises: [
            buildExercise({ id: 'w3-d1-squat', exerciseName: 'Back Squat' }),
          ],
        },
      ],
    });
    const prev = findPreviousWeekExercise(program, 3, 1, 'Back Squat');
    expect(prev).not.toBeNull();
    expect(prev!.fromWeekNumber).toBe(1);
    expect(prev!.exercise.id).toBe('w1-d1-squat');
  });

  it('prefers the most recent logged week, not the first one', () => {
    // Both week 1 and week 2 have data — the lookup from week 3 should
    // return week 2 (the more recent), not week 1.
    const program = buildProgram();
    program.weeks[1].days[0].exercises[0] = buildExercise({
      id: 'w2-d1-squat-logged',
      exerciseName: 'Back Squat',
      values: {
        set_1_load: '110',
        set_1_rpe: '8',
      },
    });
    program.weeks.push({
      id: 'w3',
      weekNumber: 3,
      days: [
        {
          id: 'w3-d1',
          dayNumber: 1,
          name: 'Lower',
          exercises: [
            buildExercise({ id: 'w3-d1-squat', exerciseName: 'Back Squat' }),
          ],
        },
      ],
    });
    const prev = findPreviousWeekExercise(program, 3, 1, 'Back Squat');
    expect(prev!.fromWeekNumber).toBe(2);
    expect(prev!.exercise.id).toBe('w2-d1-squat-logged');
  });

  it('returns null when no prior week has any logged data', () => {
    // All prior weeks exist but contain only empty exercises — useful
    // signal: don't show a "Last week" hint just because the slot exists.
    const program: Program = {
      id: 'p2',
      name: 'Empty',
      status: 'active',
      columns: [],
      weeks: [
        {
          id: 'w1',
          weekNumber: 1,
          days: [
            {
              id: 'w1-d1',
              dayNumber: 1,
              name: 'Lower',
              exercises: [buildExercise({ id: 'e1', exerciseName: 'Back Squat' })],
            },
          ],
        },
        {
          id: 'w2',
          weekNumber: 2,
          days: [
            {
              id: 'w2-d1',
              dayNumber: 1,
              name: 'Lower',
              exercises: [buildExercise({ id: 'e2', exerciseName: 'Back Squat' })],
            },
          ],
        },
      ],
    };
    expect(findPreviousWeekExercise(program, 2, 1, 'Back Squat')).toBeNull();
  });
});

describe('hasAnyLoggedData', () => {
  it('detects per-set values', () => {
    expect(hasAnyLoggedData(buildExercise({ values: { set_1_load: '100' } }))).toBe(true);
    expect(hasAnyLoggedData(buildExercise({ values: { set_3_rpe: '8' } }))).toBe(true);
  });

  it('detects legacy actualLoad / actualRpe', () => {
    expect(hasAnyLoggedData(buildExercise({ actualLoad: '100' }))).toBe(true);
    expect(hasAnyLoggedData(buildExercise({ actualRpe: '7' }))).toBe(true);
  });

  it('ignores non-load/rpe value keys (e.g. completion flag)', () => {
    expect(hasAnyLoggedData(buildExercise({ values: { __completed: '1' } }))).toBe(false);
    expect(hasAnyLoggedData(buildExercise({ values: { set_1_completed: '1' } }))).toBe(false);
  });

  it('returns false for empty / unset', () => {
    expect(hasAnyLoggedData(buildExercise())).toBe(false);
    expect(hasAnyLoggedData(buildExercise({ values: {} }))).toBe(false);
    expect(hasAnyLoggedData(buildExercise({ actualLoad: '', actualRpe: '' }))).toBe(false);
  });
});

describe('getPreviousSetLoad', () => {
  it('reads from values["set_<n>_load"] off the PreviousSession wrapper', () => {
    const program = buildProgram();
    const prev = findPreviousWeekExercise(program, 2, 1, 'Back Squat');
    expect(getPreviousSetLoad(prev, 1)).toBe('100');
    expect(getPreviousSetLoad(prev, 2)).toBe('102.5');
    expect(getPreviousSetLoad(prev, 3)).toBe('105');
  });

  it('also accepts a raw ExercisePlan for backward compatibility', () => {
    const ex = buildExercise({ values: { set_1_load: '100' } });
    expect(getPreviousSetLoad(ex, 1)).toBe('100');
  });

  it('falls back to actualLoad for set 1 when per-set data is absent', () => {
    const ex = buildExercise({ actualLoad: '100' });
    expect(getPreviousSetLoad(ex, 1)).toBe('100');
    expect(getPreviousSetLoad(ex, 2)).toBeNull();
  });

  it('returns null when the session itself is null', () => {
    expect(getPreviousSetLoad(null, 1)).toBeNull();
  });

  it('returns null for a set number that was never logged', () => {
    const program = buildProgram();
    const prev = findPreviousWeekExercise(program, 2, 1, 'Romanian Deadlift');
    expect(getPreviousSetLoad(prev, 2)).toBeNull();
  });
});

describe('getPreviousSetRpe', () => {
  it('reads from values["set_<n>_rpe"]', () => {
    const program = buildProgram();
    const prev = findPreviousWeekExercise(program, 2, 1, 'Back Squat');
    expect(getPreviousSetRpe(prev, 1)).toBe('7');
    expect(getPreviousSetRpe(prev, 2)).toBe('7.5');
  });

  it('falls back to actualRpe for set 1 only', () => {
    const ex = buildExercise({ actualRpe: '8' });
    expect(getPreviousSetRpe(ex, 1)).toBe('8');
    expect(getPreviousSetRpe(ex, 2)).toBeNull();
  });
});
