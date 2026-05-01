import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminView } from '../components/admin/AdminView';
import type { Client, Program } from '../types';

// Stub ProgramEditor and AnalyticsDashboard
vi.mock('../components/admin/ProgramEditor', () => ({
  ProgramEditor: ({ program }: { program: Program }) => (
    <div data-testid="program-editor">{program.name}</div>
  ),
}));

(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = 'test';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const COACH_A: Client = {
  id: 'coachA',
  name: 'Coach Alpha',
  email: 'alpha@gym.com',
  role: 'admin',
  tenantId: 'tenant-A',
  programs: [],
};

const COACH_B: Client = {
  id: 'coachB',
  name: 'Coach Beta',
  email: 'beta@gym.com',
  role: 'admin',
  tenantId: 'tenant-B',
  programs: [],
};

const TRAINEE_A1: Client = {
  id: 'traineeA1',
  name: 'Alice (A)',
  email: 'alice@gym.com',
  role: 'trainee',
  tenantId: 'tenant-A',
  programs: [],
};

const TRAINEE_A2: Client = {
  id: 'traineeA2',
  name: 'Alex (A)',
  email: 'alex@gym.com',
  role: 'trainee',
  tenantId: 'tenant-A',
  programs: [],
};

const TRAINEE_B1: Client = {
  id: 'traineeB1',
  name: 'Bob (B)',
  email: 'bob@gym.com',
  role: 'trainee',
  tenantId: 'tenant-B',
  programs: [],
};

const ALL_CLIENTS = [COACH_A, COACH_B, TRAINEE_A1, TRAINEE_A2, TRAINEE_B1];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Multi-Tenancy Isolation', () => {
  it('Coach A sees only their own trainees, not Coach B\'s', () => {
    render(
      <AdminView
        clients={ALL_CLIENTS}
        authenticatedUser={COACH_A}
        onSaveProgram={vi.fn().mockResolvedValue(undefined)}
        onCreateProgram={vi.fn().mockResolvedValue({} as never)}
        onDeleteClient={vi.fn().mockResolvedValue(undefined)}
        onArchiveProgram={vi.fn()}
        onBack={vi.fn()}
      />
    );

    // Coach A should see their two trainees
    expect(screen.getByText('Alice (A)')).toBeInTheDocument();
    expect(screen.getByText('Alex (A)')).toBeInTheDocument();
    // Coach A must NOT see Coach B's trainee
    expect(screen.queryByText('Bob (B)')).toBeNull();
  });

  it('Coach B sees only their own trainees, not Coach A\'s', () => {
    render(
      <AdminView
        clients={ALL_CLIENTS}
        authenticatedUser={COACH_B}
        onSaveProgram={vi.fn().mockResolvedValue(undefined)}
        onCreateProgram={vi.fn().mockResolvedValue({} as never)}
        onDeleteClient={vi.fn().mockResolvedValue(undefined)}
        onArchiveProgram={vi.fn()}
        onBack={vi.fn()}
      />
    );

    // Coach B should see their one trainee
    expect(screen.getByText('Bob (B)')).toBeInTheDocument();
    // Coach B must NOT see Coach A's trainees
    expect(screen.queryByText('Alice (A)')).toBeNull();
    expect(screen.queryByText('Alex (A)')).toBeNull();
  });

  it('Neither coach can see the other coach in the client list', () => {
    render(
      <AdminView
        clients={ALL_CLIENTS}
        authenticatedUser={COACH_A}
        onSaveProgram={vi.fn().mockResolvedValue(undefined)}
        onCreateProgram={vi.fn().mockResolvedValue({} as never)}
        onDeleteClient={vi.fn().mockResolvedValue(undefined)}
        onArchiveProgram={vi.fn()}
        onBack={vi.fn()}
      />
    );

    // Other coach should not appear in the client sidebar
    expect(screen.queryByText('Coach Beta')).toBeNull();
    // The authenticated coach should also not appear as their own client
    expect(screen.queryByText('Coach Alpha')).toBeNull();
  });
});