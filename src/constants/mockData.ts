import type { ProgramColumn, Program, Client } from '../types';

export const SUPERADMIN_EMAIL = 'noammrks@gmail.com';

export const DEFAULT_COLUMNS: ProgramColumn[] = [
  { id: 'sets',        label: 'Sets',       type: 'plan' },
  { id: 'reps',        label: 'Reps',       type: 'plan' },
  { id: 'expectedRpe', label: 'RPE',        type: 'plan' },
  { id: 'weightRange', label: 'Range',      type: 'plan' },
  { id: 'actualLoad',  label: 'Actual Load', type: 'actual' },
  { id: 'actualRpe',   label: 'Actual RPE', type: 'actual' },
  { id: 'notes',       label: 'Notes',      type: 'actual' },
];

export function createEmptyProgram(name: string, tenantId?: string): Program {
  return {
    id: crypto.randomUUID(),
    name,
    weeks: [],
    columns: [...DEFAULT_COLUMNS],
    status: 'active',
    createdAt: new Date().toISOString(),
    tenantId,
  };
}

export function createDefaultProgram(tenantId?: string): Program {
  const dayNames = ['Day A', 'Day B', 'Day C', 'Day D'];
  return {
    id: crypto.randomUUID(),
    name: 'Training Block 1',
    columns: [...DEFAULT_COLUMNS],
    status: 'active',
    createdAt: new Date().toISOString(),
    tenantId,
    weeks: [
      {
        id: crypto.randomUUID(),
        weekNumber: 1,
        days: dayNames.map((name, i) => ({
          id: crypto.randomUUID(),
          dayNumber: i + 1,
          name,
          exercises: [],
        })),
      },
    ],
  };
}

export const MOCK_PROGRAM: Program = {
  id: 'p1',
  name: 'Hypertrophy Phase 1',
  status: 'active',
  createdAt: new Date().toISOString(),
  columns: [...DEFAULT_COLUMNS],
  tenantId: 'coach1',
  weeks: Array.from({ length: 4 }).map((_, wIdx) => ({
    id: `w${wIdx + 1}`,
    weekNumber: wIdx + 1,
    days: [
      {
        id: `d1-w${wIdx + 1}`,
        dayNumber: 1,
        name: 'Lower Body A',
        exercises: [
          { id: `e1-w${wIdx}`, exerciseId: 'squat',   exerciseName: 'Back Squat',          sets: 3, reps: '5-8',   expectedRpe: '7-8', weightRange: '100-120kg', values: {} },
          { id: `e2-w${wIdx}`, exerciseId: 'rdl',     exerciseName: 'Romanian Deadlift',   sets: 3, reps: '8-10',  expectedRpe: '7',   weightRange: '80-100kg',  values: {} },
          { id: `e3-w${wIdx}`, exerciseId: 'legpress', exerciseName: 'Leg Press',          sets: 3, reps: '10-12', expectedRpe: '8',   weightRange: '160-200kg', values: {} },
        ],
      },
      {
        id: `d2-w${wIdx + 1}`,
        dayNumber: 2,
        name: 'Upper Body A',
        exercises: [
          { id: `e4-w${wIdx}`, exerciseId: 'bench', exerciseName: 'Bench Press',    sets: 3, reps: '5-8',  expectedRpe: '8',   weightRange: '80-95kg',  values: {} },
          { id: `e5-w${wIdx}`, exerciseId: 'row',   exerciseName: 'Barbell Row',    sets: 3, reps: '8-10', expectedRpe: '7-8', weightRange: '60-75kg',  values: {} },
          { id: `e6-w${wIdx}`, exerciseId: 'ohp',   exerciseName: 'Overhead Press', sets: 3, reps: '8-10', expectedRpe: '8',   weightRange: '40-55kg',  values: {} },
        ],
      },
    ],
  })),
};

export const INITIAL_CLIENTS: Client[] = [
  {
    id: 'superadmin1',
    name: 'Noam Marks',
    email: SUPERADMIN_EMAIL,
    password: '123',
    role: 'superadmin',
    tenantId: 'global',
    programs: [],
  },
  {
    id: 'coach1',
    name: 'Coach Noam',
    email: 'coach@example.com',
    password: '123',
    role: 'admin',
    tenantId: 'coach1',
    programs: [],
  },
  {
    id: 'c1',
    name: 'Trainee Alpha',
    email: 'trainee1@example.com',
    password: '123',
    role: 'trainee',
    tenantId: 'coach1',
    activeProgramId: 'p1',
    programs: [MOCK_PROGRAM],
  },
  {
    id: 'c2',
    name: 'Sarah Cohen',
    email: 'sarah.c@example.com',
    password: '123',
    role: 'trainee',
    tenantId: 'coach1',
    activeProgramId: 'p1',
    programs: [MOCK_PROGRAM],
  },
];