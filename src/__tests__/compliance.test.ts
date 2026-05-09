import { describe, it, expect } from 'vitest';
import { complianceRate } from '../lib/analytics';
import type { Client, Program, WorkoutDay, WorkoutWeek } from '../types';

// ─── Builders ────────────────────────────────────────────────────────────────

function makeClient(programs: Program[]): Client {
  return {
    id: 'c1',
    name: 'Test Trainee',
    email: 'test@example.com',
    role: 'trainee',
    programs,
  };
}

function makeDay(over: Partial<WorkoutDay> & { id: string }): WorkoutDay {
  return {
    dayNumber: over.dayNumber ?? 1,
    name: over.name ?? 'Day',
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

function makeWeek(weekNumber: number, days: WorkoutDay[]): WorkoutWeek {
  return { id: `w${weekNumber}`, weekNumber, days };
}

// ─── complianceRate ──────────────────────────────────────────────────────────

describe('complianceRate', () => {
  it('returns { logged: 0, total: 0, rate: 0 } for a client with no programs', () => {
    expect(complianceRate(makeClient([]))).toEqual({ logged: 0, total: 0, rate: 0 });
  });

  it('returns 0% when programs exist but no days are logged', () => {
    const program = makeProgram([
      makeWeek(1, [
        makeDay({ id: 'd1' }),
        makeDay({ id: 'd2', dayNumber: 2 }),
        makeDay({ id: 'd3', dayNumber: 3 }),
      ]),
    ]);
    expect(complianceRate(makeClient([program]))).toEqual({ logged: 0, total: 3, rate: 0 });
  });

  it('returns 60% (3 of 5) for the 3-of-5 case the spec calls out', () => {
    const program = makeProgram([
      makeWeek(1, [
        makeDay({ id: 'd1', loggedAt: '2026-01-15T10:00:00Z' }),
        makeDay({ id: 'd2', dayNumber: 2, loggedAt: '2026-01-16T10:00:00Z' }),
        makeDay({ id: 'd3', dayNumber: 3 }),
      ]),
      makeWeek(2, [
        makeDay({ id: 'd4', loggedAt: '2026-01-22T10:00:00Z' }),
        makeDay({ id: 'd5', dayNumber: 2 }),
      ]),
    ]);
    expect(complianceRate(makeClient([program]))).toEqual({ logged: 3, total: 5, rate: 60 });
  });

  it('returns 100% for a fully logged program', () => {
    const program = makeProgram([
      makeWeek(1, [
        makeDay({ id: 'd1', loggedAt: '2026-01-15T10:00:00Z' }),
        makeDay({ id: 'd2', dayNumber: 2, loggedAt: '2026-01-16T10:00:00Z' }),
      ]),
      makeWeek(2, [
        makeDay({ id: 'd3', loggedAt: '2026-01-22T10:00:00Z' }),
      ]),
    ]);
    expect(complianceRate(makeClient([program]))).toEqual({ logged: 3, total: 3, rate: 100 });
  });

  it('counts archived programs alongside active ones — historical sessions still count', () => {
    const archived = makeProgram(
      [
        makeWeek(1, [
          makeDay({ id: 'arc-1', loggedAt: '2025-12-01T10:00:00Z' }),
          makeDay({ id: 'arc-2', dayNumber: 2, loggedAt: '2025-12-03T10:00:00Z' }),
        ]),
      ],
      { id: 'p-old', name: 'Old Block', status: 'archived' },
    );
    const active = makeProgram(
      [
        makeWeek(1, [
          makeDay({ id: 'cur-1', loggedAt: '2026-01-15T10:00:00Z' }),
          makeDay({ id: 'cur-2', dayNumber: 2 }),
        ]),
      ],
      { id: 'p-new', name: 'Current Block', status: 'active' },
    );
    // Total = 4 days across both programs, 3 logged → 75%.
    expect(complianceRate(makeClient([archived, active]))).toEqual({
      logged: 3,
      total: 4,
      rate: 75,
    });
  });

  it('rounds to the nearest whole percent (Math.round, not floor)', () => {
    // 1 logged / 3 total = 33.333… → rounds to 33.
    const program = makeProgram([
      makeWeek(1, [
        makeDay({ id: 'd1', loggedAt: '2026-01-15T10:00:00Z' }),
        makeDay({ id: 'd2', dayNumber: 2 }),
        makeDay({ id: 'd3', dayNumber: 3 }),
      ]),
    ]);
    expect(complianceRate(makeClient([program]))).toEqual({ logged: 1, total: 3, rate: 33 });
  });

  it('walks every week in every program — multi-program multi-week scenario', () => {
    const programs: Program[] = [
      makeProgram(
        [
          makeWeek(1, [makeDay({ id: 'a1', loggedAt: '2026-01-01T10:00:00Z' })]),
          makeWeek(2, [makeDay({ id: 'a2' })]),
        ],
        { id: 'pa' },
      ),
      makeProgram(
        [
          makeWeek(1, [
            makeDay({ id: 'b1', loggedAt: '2026-01-08T10:00:00Z' }),
            makeDay({ id: 'b2', dayNumber: 2, loggedAt: '2026-01-10T10:00:00Z' }),
          ]),
        ],
        { id: 'pb' },
      ),
    ];
    // 3 logged out of 4 total → 75%.
    expect(complianceRate(makeClient(programs))).toEqual({ logged: 3, total: 4, rate: 75 });
  });
});
