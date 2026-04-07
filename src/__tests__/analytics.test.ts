import { describe, it, expect } from 'vitest';
import {
  estimate1RM,
  parseReps,
  parseLoad,
  aggregateE1RM,
  listLoggedExercises,
} from '../lib/analytics';
import type { Client, Program } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeClient(programs: Program[]): Client {
  return {
    id: 'c1',
    name: 'Test Trainee',
    email: 'test@example.com',
    role: 'trainee',
    programs,
  };
}

// ─── Epley + parsers ─────────────────────────────────────────────────────────

describe('estimate1RM (Epley)', () => {
  it('returns the same value when reps = 1', () => {
    expect(estimate1RM(100, 1)).toBeCloseTo(103.3, 1);
  });

  it('matches the Epley formula for 100kg × 5', () => {
    // 100 × (1 + 5/30) = 116.666… → rounded to 116.7
    expect(estimate1RM(100, 5)).toBe(116.7);
  });

  it('returns null for invalid inputs', () => {
    expect(estimate1RM(0, 5)).toBeNull();
    expect(estimate1RM(100, 0)).toBeNull();
    expect(estimate1RM(NaN, 5)).toBeNull();
    expect(estimate1RM(100, -2)).toBeNull();
  });
});

describe('parseReps', () => {
  it('parses plain numbers', () => {
    expect(parseReps(5)).toBe(5);
    expect(parseReps('5')).toBe(5);
  });

  it('parses ranges using the lower bound', () => {
    expect(parseReps('5-8')).toBe(5);
  });

  it('returns null for non-numeric strings', () => {
    expect(parseReps('AMRAP')).toBeNull();
    expect(parseReps('')).toBeNull();
    expect(parseReps(undefined)).toBeNull();
  });
});

describe('parseLoad', () => {
  it('parses plain kg numbers', () => {
    expect(parseLoad('100')).toBe(100);
    expect(parseLoad('100kg')).toBe(100);
    expect(parseLoad('100.5')).toBe(100.5);
  });

  it('returns null for empty / invalid', () => {
    expect(parseLoad('')).toBeNull();
    expect(parseLoad(undefined)).toBeNull();
    expect(parseLoad('abc')).toBeNull();
  });
});

// ─── Aggregation ─────────────────────────────────────────────────────────────

describe('aggregateE1RM', () => {
  const program: Program = {
    id: 'p1',
    name: 'Block 1',
    status: 'archived',
    columns: [],
    weeks: [
      {
        id: 'w1',
        weekNumber: 1,
        days: [
          {
            id: 'd1',
            dayNumber: 1,
            name: 'Lower',
            loggedAt: '2026-01-15T10:00:00Z',
            exercises: [
              { id: 'e1', exerciseId: 'squat', exerciseName: 'Back Squat', reps: '5', actualLoad: '100', values: {} },
            ],
          },
          {
            id: 'd2',
            dayNumber: 2,
            name: 'Lower',
            loggedAt: '2026-01-22T10:00:00Z',
            exercises: [
              { id: 'e2', exerciseId: 'squat', exerciseName: 'Back Squat', reps: '5', actualLoad: '110', values: {} },
            ],
          },
          // Un-logged day — should be skipped
          {
            id: 'd3',
            dayNumber: 3,
            name: 'Lower',
            exercises: [
              { id: 'e3', exerciseId: 'squat', exerciseName: 'Back Squat', reps: '5', actualLoad: '120', values: {} },
            ],
          },
          // Logged but no actualLoad — should be skipped
          {
            id: 'd4',
            dayNumber: 4,
            name: 'Lower',
            loggedAt: '2026-01-29T10:00:00Z',
            exercises: [
              { id: 'e4', exerciseId: 'squat', exerciseName: 'Back Squat', reps: '5', values: {} },
            ],
          },
        ],
      },
    ],
  };

  it('walks all programs (active + archived) and produces sorted points', () => {
    const client = makeClient([program]);
    const result = aggregateE1RM(client, 'squat');
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2026-01-15');
    expect(result[1].date).toBe('2026-01-22');
    expect(result[0].e1rm).toBe(116.7); // 100 × 1.1666
    expect(result[1].e1rm).toBe(128.3); // 110 × 1.1666
  });

  it('skips days that were never logged', () => {
    const client = makeClient([program]);
    const result = aggregateE1RM(client, 'squat');
    // 4 days total, but only 2 should produce valid points
    expect(result).toHaveLength(2);
  });

  it('returns empty array for an unknown exercise', () => {
    const client = makeClient([program]);
    expect(aggregateE1RM(client, 'bench')).toEqual([]);
  });

  it('returns empty array for a client with no programs', () => {
    expect(aggregateE1RM(makeClient([]), 'squat')).toEqual([]);
  });
});

describe('listLoggedExercises', () => {
  it('returns distinct logged exercises with valid actuals', () => {
    const program: Program = {
      id: 'p1',
      name: 'Block 1',
      status: 'active',
      columns: [],
      weeks: [
        {
          id: 'w1',
          weekNumber: 1,
          days: [
            {
              id: 'd1',
              dayNumber: 1,
              name: 'Lower',
              loggedAt: '2026-01-15T10:00:00Z',
              exercises: [
                { id: 'e1', exerciseId: 'squat', exerciseName: 'Back Squat', reps: '5', actualLoad: '100', values: {} },
                { id: 'e2', exerciseId: 'bench', exerciseName: 'Bench Press', reps: '5', actualLoad: '80', values: {} },
                { id: 'e3', exerciseId: 'lat', exerciseName: 'Lat Pulldown', reps: '10', values: {} }, // no load
              ],
            },
          ],
        },
      ],
    };
    const exercises = listLoggedExercises(makeClient([program]));
    expect(exercises).toHaveLength(2);
    expect(exercises.map((e) => e.id).sort()).toEqual(['bench', 'squat']);
  });
});