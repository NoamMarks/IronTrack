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

// Common no-op props for the autosave + finish callbacks.
const noopAsync = () => Promise.resolve();

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
        onAutoSave={noopAsync}
        onFinish={noopAsync}
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
        onAutoSave={noopAsync}
        onFinish={noopAsync}
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
        onAutoSave={noopAsync}
        onFinish={noopAsync}
      />
    );

    const input = screen.getByTestId('input-e1-set-1-load');
    await user.clear(input);
    await user.type(input, '140');
    expect(input).toHaveValue('140');
  });

  it('Finish Workout propagates the typed value, including dual-writing set 1 to ex.actualLoad for legacy readers', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn().mockResolvedValue(undefined);

    render(
      <WorkoutGridLogger
        client={CLIENT}
        program={PROGRAM}
        week={WEEK}
        day={DAY}
        onBack={vi.fn()}
        onAutoSave={noopAsync}
        onFinish={onFinish}
      />
    );

    const input = screen.getByTestId('input-e1-set-1-load');
    await user.clear(input);
    await user.type(input, '120');

    // Confirm the "finish anyway?" prompt that pops because the session
    // isn't fully logged.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    // The bottom Finish CTA is the same handler as the header one but is
    // the more visible / typical entry point on mobile.
    const finishBtn = screen.getByTestId('finish-session-btn-bottom');
    fireEvent.click(finishBtn);

    // Finish now opens a WorkoutSummary overlay before onFinish fires —
    // the trainee picks Submit Reflection (queues reflection modal) or
    // Close Without Reflection (skips it). Both ultimately call onFinish
    // / onFinishSilent. Click Submit Reflection to invoke onFinish.
    const submitBtn = await screen.findByTestId('summary-submit-reflection-btn');
    fireEvent.click(submitBtn);

    // onFinish is called asynchronously; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(onFinish).toHaveBeenCalledOnce();
    const savedDay: WorkoutDay = onFinish.mock.calls[0][0];
    expect(savedDay.id).toBe('d1');
    const savedEx = savedDay.exercises[0];
    // Set 1's load is the source of truth on ex.values.set_1_load …
    expect(savedEx.values?.set_1_load).toBe('120');
    // … AND mirrored to ex.actualLoad so analytics views that still read
    // the legacy single-actual field stay coherent with the latest entry.
    expect(savedEx.actualLoad).toBe('120');
    confirmSpy.mockRestore();
  });

  it('per-set rows independently store load values for sets 2..N', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn().mockResolvedValue(undefined);

    render(
      <WorkoutGridLogger
        client={CLIENT}
        program={PROGRAM}
        week={WEEK}
        day={DAY}
        onBack={vi.fn()}
        onAutoSave={noopAsync}
        onFinish={onFinish}
      />
    );

    await user.type(screen.getByTestId('input-e1-set-1-load'), '100');
    await user.type(screen.getByTestId('input-e1-set-2-load'), '105');
    await user.type(screen.getByTestId('input-e1-set-3-load'), '110');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByTestId('finish-session-btn-bottom'));

    // Click through the new WorkoutSummary screen to actually invoke onFinish.
    const submitBtn = await screen.findByTestId('summary-submit-reflection-btn');
    fireEvent.click(submitBtn);
    await new Promise((r) => setTimeout(r, 0));

    const savedEx = (onFinish.mock.calls[0][0] as WorkoutDay).exercises[0];
    expect(savedEx.values?.set_1_load).toBe('100');
    expect(savedEx.values?.set_2_load).toBe('105');
    expect(savedEx.values?.set_3_load).toBe('110');
    // Legacy mirror only happens for set 1.
    expect(savedEx.actualLoad).toBe('100');
    confirmSpy.mockRestore();
  });

  it('autosave fires after a typing burst (debounced) without exiting the workout', async () => {
    vi.useFakeTimers();
    const onAutoSave = vi.fn().mockResolvedValue(undefined);
    const onFinish = vi.fn();

    render(
      <WorkoutGridLogger
        client={CLIENT}
        program={PROGRAM}
        week={WEEK}
        day={DAY}
        onBack={vi.fn()}
        onAutoSave={onAutoSave}
        onFinish={onFinish}
      />
    );

    const input = screen.getByTestId('input-e1-set-1-load') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '100' } });

    // Pre-debounce — autosave hasn't fired yet.
    expect(onAutoSave).not.toHaveBeenCalled();

    // Past the debounce — autosave fires once with the latest snapshot.
    await vi.advanceTimersByTimeAsync(900);
    expect(onAutoSave).toHaveBeenCalled();
    const autosavedDay = onAutoSave.mock.calls[0][0] as WorkoutDay;
    expect(autosavedDay.exercises[0].values?.set_1_load).toBe('100');

    // onFinish must NOT be called by autosave — the only path that exits
    // the workout view is the explicit Finish button.
    expect(onFinish).not.toHaveBeenCalled();

    vi.useRealTimers();
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
        onAutoSave={noopAsync}
        onFinish={noopAsync}
      />
    );

    // The back button is the first button rendered (ArrowLeft in the header)
    const [backBtn] = screen.getAllByRole('button');
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledOnce();
  });
});
