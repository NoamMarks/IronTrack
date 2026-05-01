import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientDashboard } from '../components/trainee/ClientDashboard';
import { AdminView } from '../components/admin/AdminView';
import type { Client, Program } from '../types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Stub the analytics dashboard so we don't pull in recharts during these tests
vi.mock('../components/trainee/AnalyticsDashboard', () => ({
  AnalyticsDashboard: () => <div data-testid="analytics-stub" />,
}));

// Stub the program editor; AdminView interaction tests focus on the archive flow
vi.mock('../components/admin/ProgramEditor', () => ({
  ProgramEditor: ({ program }: { program: Program }) => (
    <div data-testid="program-editor">{program.name}</div>
  ),
}));

// Provide the build-time global used by the dashboards' footer
(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = 'test';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ACTIVE_PROGRAM: Program = {
  id: 'p-active',
  name: 'Hypertrophy Block 1',
  status: 'active',
  columns: [],
  weeks: [
    {
      id: 'w1',
      weekNumber: 1,
      days: [
        { id: 'd1', dayNumber: 1, name: 'Lower', exercises: [] },
      ],
    },
  ],
};

const ARCHIVED_PROGRAM: Program = {
  id: 'p-old',
  name: 'Strength Block 0',
  status: 'archived',
  archivedAt: '2026-01-10T00:00:00Z',
  columns: [],
  weeks: [
    {
      id: 'w-old-1',
      weekNumber: 1,
      days: [
        { id: 'd-old-1', dayNumber: 1, name: 'Lower', exercises: [], loggedAt: '2026-01-09T10:00:00Z' },
      ],
    },
  ],
};

const TRAINEE: Client = {
  id: 'c1',
  name: 'Noam',
  email: 'noam@example.com',
  role: 'trainee',
  tenantId: 'coach1',
  activeProgramId: 'p-active',
  programs: [ACTIVE_PROGRAM, ARCHIVED_PROGRAM],
};

const COACH: Client = {
  id: 'coach1',
  name: 'Coach',
  email: 'coach@test.com',
  role: 'admin',
  tenantId: 'coach1',
  programs: [],
};

// ─── ClientDashboard tabs ────────────────────────────────────────────────────

describe('ClientDashboard tabs', () => {
  it('shows the current block by default', () => {
    render(<ClientDashboard client={TRAINEE} onBack={vi.fn()} onStartWorkout={vi.fn()} />);
    expect(screen.getByText('Hypertrophy Block 1')).toBeInTheDocument();
    expect(screen.getByTestId('week-tab-1')).toBeInTheDocument();
  });

  it('renders archived blocks in the History tab', () => {
    render(<ClientDashboard client={TRAINEE} onBack={vi.fn()} onStartWorkout={vi.fn()} />);
    fireEvent.click(screen.getByTestId('dashboard-tab-history'));

    expect(screen.getByTestId('history-grid')).toBeInTheDocument();
    expect(screen.getByTestId('history-card-p-old')).toBeInTheDocument();
    expect(screen.getByText('Strength Block 0')).toBeInTheDocument();
  });

  it('renders the empty state when there are no archived blocks', () => {
    const client: Client = { ...TRAINEE, programs: [ACTIVE_PROGRAM] };
    render(<ClientDashboard client={client} onBack={vi.fn()} onStartWorkout={vi.fn()} />);
    fireEvent.click(screen.getByTestId('dashboard-tab-history'));
    expect(screen.getByTestId('history-empty')).toBeInTheDocument();
  });

  it('switches to the Analytics tab', () => {
    render(<ClientDashboard client={TRAINEE} onBack={vi.fn()} onStartWorkout={vi.fn()} />);
    fireEvent.click(screen.getByTestId('dashboard-tab-analytics'));
    expect(screen.getByTestId('analytics-stub')).toBeInTheDocument();
  });
});

// ─── AdminView archive action ────────────────────────────────────────────────

describe('AdminView archive action', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onArchiveProgram with the active program id when the archive button is clicked', () => {
    const onArchive = vi.fn();
    render(
      <AdminView
        clients={[TRAINEE]}
        authenticatedUser={COACH}
        onSaveProgram={vi.fn().mockResolvedValue(undefined)}
        onCreateProgram={vi.fn().mockResolvedValue({} as never)}
        onDeleteClient={vi.fn().mockResolvedValue(undefined)}
        onArchiveProgram={onArchive}
        onBack={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('archive-block-btn'));
    expect(onArchive).toHaveBeenCalledWith('c1', 'p-active');
  });

  it('shows the empty "Ready to Build?" state once the active program is archived', () => {
    const onArchive = vi.fn();

    // Render with a client that has only an archived program → no active block
    const archivedOnly: Client = { ...TRAINEE, activeProgramId: undefined, programs: [ARCHIVED_PROGRAM] };
    render(
      <AdminView
        clients={[archivedOnly]}
        authenticatedUser={COACH}
        onSaveProgram={vi.fn().mockResolvedValue(undefined)}
        onCreateProgram={vi.fn().mockResolvedValue({} as never)}
        onDeleteClient={vi.fn().mockResolvedValue(undefined)}
        onArchiveProgram={onArchive}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText(/Ready to Build/i)).toBeInTheDocument();
    expect(screen.queryByTestId('archive-block-btn')).toBeNull();
  });
});