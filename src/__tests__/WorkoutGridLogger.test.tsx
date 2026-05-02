import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { WorkoutGridLogger } from '../components/trainee/WorkoutGridLogger';
import type { Client, Program, WorkoutWeek, WorkoutDay, ExercisePlan, ProgramColumn } from '../types';

// ─── Minimal mock data ───────────────────────────────────────────────────────

const PLAN_COLS: ProgramColumn[] = [
  { id: 'sets',        label: 'Sets',        type: 'plan' },
  { id: 'reps',        label: 'Reps',        type: 'plan' },
];

const ACTUAL_COLS: ProgramColumn[] = [
  { id: 'actualLoad',  label: 'Actual Load', type: 'actual' },
  { id: 'actualRpe',   label: 'Actual RPE',  type: 'actual' },
  { id: 'notes',       label: 'Notes',       type: 'actual' },
];

const ALL_COLS: ProgramColumn[] = [...PLAN_COLS, ...ACTUAL_COLS];

const EXERCISE: ExercisePlan = {
  id: 'e1',
  exerciseId: 'squat',
  exerciseName: 'Back Squat',
  sets: 4,
  reps: '5',
  values: {},
};

const DAY: WorkoutDay  = { id: 'd1', dayNumber: 1, name: 'Lower Body A', exercises: [EXERCISE] };
const WEEK: WorkoutWeek = { id: 'w1', weekNumber: 1, days: [DAY] };

const PROGRAM: Program = {
  id: 'p1',
  name: 'Hypertrophy Phase 1',
  weeks: [WEEK],
  columns: ALL_COLS,
  status: 'active',
};

const CLIENT: Client = {
  id: 'c1',
  name: 'Noam Marks',
  email: 'noam@example.com',
  role: 'trainee',
  programs: [PROGRAM],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WorkoutGridLogger', () => {
  it('renders the session header with client name and day', () => {
    render(
      <WorkoutGridLogger
        client={CLIENT}
        program={PROGRAM}
        week={WEEK}
        day={DAY}
        onBack={vi.fn()}
        onSave={vi.fn()}
      />
    );

    // The day name is now the prominent H1, with client + week shown as
    // a small monospace subtitle.
    expect(screen.getByRole('heading', { name: /Lower Body A/i })).toBeInTheDocument();
    expect(screen.getByText(/Noam Marks/)).toBeInTheDocument();
    expect(screen.getByText(/Week 1/)).toBeInTheDocument();
  });

  it('condenses plan columns into a per-exercise summary string and renders one input row per planned set', () => {
    render(
      <WorkoutGridLogger
        client={CLIENT}
        program={PROGRAM}
        week={WEEK}
        day={DAY}
        onBack={vi.fn()}
        onSave={vi.fn()}
      />
    );

    // The plan is now collapsed into the exercise header summary, e.g.
    // "Plan: 4 × 5". The exact phrasing lives in buildPlanSummary.
    expect(screen.getByTestId('plan-summary-0')).toHaveTextContent('4 × 5');

    // 4 planned sets → 4 set rows, each with its own load + rpe input.
    for (let n = 1; n <= 4; n += 1) {
      expect(screen.getByTestId(`input-e1-set-${n}-load`)).toBeInTheDocument();
      expect(screen.getByTestId(`input-e1-set-${n}-rpe`)).toBeInTheDocument();
    }
  });

  it('allows a trainee to type a per-set load value', async () => {
    const user = userEvent.setup();
    render(
      <WorkoutGridLogger
        client={CLIENT}
        program={PROGRAM}
        week={WEEK}
        day={DAY}
        onBack={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const input = screen.getByTestId('input-e1-set-1-load');
    await user.clear(input);
    await user.type(input, '140');
    expect(input).toHaveValue('140');
  });

  it('Save Session propagates the typed value, including dual-writing set 1 to ex.actualLoad for legacy readers', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <WorkoutGridLogger
        client={CLIENT}
        program={PROGRAM}
        week={WEEK}
        day={DAY}
        onBack={vi.fn()}
        onSave={onSave}
      />
    );

    const input = screen.getByTestId('input-e1-set-1-load');
    await user.clear(input);
    await user.type(input, '120');

    const saveBtn = screen.getByTestId('save-session-btn');
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledOnce();
    const savedDay: WorkoutDay = onSave.mock.calls[0][0];
    expect(savedDay.id).toBe('d1');
    const savedEx = savedDay.exercises[0];
    // Set 1's load is the source of truth on ex.values.set_1_load …
    expect(savedEx.values?.set_1_load).toBe('120');
    // … AND mirrored to ex.actualLoad so analytics views that still read
    // the legacy single-actual field stay coherent with the latest entry.
    expect(savedEx.actualLoad).toBe('120');
  });

  it('per-set rows independently store load values for sets 2..N', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <WorkoutGridLogger
        client={CLIENT}
        program={PROGRAM}
        week={WEEK}
        day={DAY}
        onBack={vi.fn()}
        onSave={onSave}
      />
    );

    await user.type(screen.getByTestId('input-e1-set-1-load'), '100');
    await user.type(screen.getByTestId('input-e1-set-2-load'), '105');
    await user.type(screen.getByTestId('input-e1-set-3-load'), '110');

    fireEvent.click(screen.getByTestId('save-session-btn'));
    const savedEx = (onSave.mock.calls[0][0] as WorkoutDay).exercises[0];
    expect(savedEx.values?.set_1_load).toBe('100');
    expect(savedEx.values?.set_2_load).toBe('105');
    expect(savedEx.values?.set_3_load).toBe('110');
    // Legacy mirror only happens for set 1.
    expect(savedEx.actualLoad).toBe('100');
  });

  it('calls onBack when the back arrow is clicked', () => {
    const onBack = vi.fn();
    render(
      <WorkoutGridLogger
        client={CLIENT}
        program={PROGRAM}
        week={WEEK}
        day={DAY}
        onBack={onBack}
        onSave={vi.fn()}
      />
    );

    // The back button is the first button rendered (ArrowLeft in the header)
    const [backBtn] = screen.getAllByRole('button');
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledOnce();
  });
});
