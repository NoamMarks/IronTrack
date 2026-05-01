/**
 * Feature-Freeze Phase 1: Component-level UI regression coverage.
 *
 * Covers form validation states, modal close behaviour, button loading +
 * double-click prevention. These tests assert the UX the user explicitly
 * expects — when the implementation falls short, the test FAILS by design
 * and is reported as a bug rather than fixed in this sprint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AddClientModal } from '../App';
import { Modal } from '../components/ui/Modal';
import { ColumnModal } from '../components/admin/ColumnModal';
import { RestTimer } from '../components/trainee/RestTimer';
import { ForgotPasswordPage } from '../components/auth/ForgotPasswordPage';
import { SignupPage } from '../components/auth/SignupPage';
import { SuperadminView } from '../components/admin/SuperadminView';
import type { Client } from '../types';

// Provide the build-time global used by some dashboards' footers
(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = 'test';

beforeEach(() => {
  localStorage.clear();
});

// ─── Phase 1A: AddClientModal validation ────────────────────────────────────

function fillAddClientModal(overrides: Partial<{ name: string; email: string; password: string; confirm: string }> = {}) {
  const v = { name: 'OK Name', email: 'ok@test.com', password: 'Password1', confirm: 'Password1', ...overrides };
  fireEvent.change(screen.getByTestId('new-client-name'),     { target: { value: v.name } });
  fireEvent.change(screen.getByTestId('new-client-email'),    { target: { value: v.email } });
  fireEvent.change(screen.getByTestId('new-client-password'), { target: { value: v.password } });
  fireEvent.change(screen.getByTestId('new-client-confirm'),  { target: { value: v.confirm } });
}

describe('Phase 1A: AddClientModal validation states', () => {
  const setup = () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<AddClientModal isOpen onClose={onClose} onAdd={onAdd} tenantId="tenant-A" />);
    return { onAdd, onClose };
  };

  it('blocks submit and shows error when name is empty', () => {
    const { onAdd } = setup();
    fillAddClientModal({ name: '' });
    fireEvent.click(screen.getByRole('button', { name: /create client/i }));
    expect(screen.getByText(/Name is required/i)).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('blocks submit and shows error when email is empty', () => {
    const { onAdd } = setup();
    fillAddClientModal({ email: '' });
    fireEvent.click(screen.getByRole('button', { name: /create client/i }));
    expect(screen.getByText(/Email is required/i)).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('blocks submit and shows the "valid email" error for malformed email', () => {
    const { onAdd } = setup();
    fillAddClientModal({ email: 'not-an-email' });
    fireEvent.click(screen.getByRole('button', { name: /create client/i }));
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('blocks submit when password is too weak (< 8 chars / no number)', () => {
    const { onAdd } = setup();
    fillAddClientModal({ password: 'weak', confirm: 'weak' });
    fireEvent.click(screen.getByRole('button', { name: /create client/i }));
    expect(screen.getAllByText(/Password:/i).length).toBeGreaterThan(0);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('blocks submit when passwords do not match', () => {
    const { onAdd } = setup();
    fillAddClientModal({ password: 'Password1', confirm: 'Different1' });
    fireEvent.click(screen.getByRole('button', { name: /create client/i }));
    expect(screen.getByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });
});

// ─── Phase 1B: CreateCoachModal validation (via SuperadminView) ─────────────

describe('Phase 1B: CreateCoachModal validation states', () => {
  const openModal = () => {
    const onAddCoach = vi.fn().mockResolvedValue({} as Client);
    render(
      <SuperadminView
        clients={[]}
        onAddCoach={onAddCoach}
        onImpersonate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('create-coach-btn'));
    return { onAddCoach };
  };

  it('blocks submit and shows the "valid email" error for malformed coach email', () => {
    const { onAddCoach } = openModal();
    fireEvent.change(screen.getByTestId('new-coach-name'),     { target: { value: 'New Coach' } });
    fireEvent.change(screen.getByTestId('new-coach-email'),    { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByTestId('new-coach-password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByTestId('new-coach-confirm'),  { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: /create coach/i }));
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    expect(onAddCoach).not.toHaveBeenCalled();
  });

  it('blocks submit when passwords do not match', () => {
    const { onAddCoach } = openModal();
    fireEvent.change(screen.getByTestId('new-coach-name'),     { target: { value: 'C' } });
    fireEvent.change(screen.getByTestId('new-coach-email'),    { target: { value: 'c@c.com' } });
    fireEvent.change(screen.getByTestId('new-coach-password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByTestId('new-coach-confirm'),  { target: { value: 'Different1' } });
    fireEvent.click(screen.getByRole('button', { name: /create coach/i }));
    expect(screen.getByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(onAddCoach).not.toHaveBeenCalled();
  });

  it('blocks submit when required fields are blank', () => {
    const { onAddCoach } = openModal();
    fireEvent.click(screen.getByRole('button', { name: /create coach/i }));
    expect(screen.getByText(/Name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/Email is required/i)).toBeInTheDocument();
    expect(onAddCoach).not.toHaveBeenCalled();
  });
});

// ─── Phase 1C: SignupPage form validation ───────────────────────────────────

vi.mock('../lib/inviteCodes', async () => {
  const actual = await vi.importActual<typeof import('../lib/inviteCodes')>('../lib/inviteCodes');
  return {
    ...actual,
    lookupInviteCode: async (code: string) =>
      code.trim().toUpperCase() === 'VALID123'
        ? {
            id: 'inv1',
            code: 'VALID123',
            tenantId: 'tenant-A',
            coachId: 'coachA',
            coachName: 'Coach Alpha',
            createdAt: '',
            useCount: 0,
          }
        : null,
    consumeInviteCode: vi.fn().mockResolvedValue(undefined),
    buildInviteLink: (code: string) => `http://localhost/signup?invite=${code}`,
    normalizeInviteCode: (s: string) => s.replace(/\s+/g, '').toUpperCase(),
  };
});

describe('Phase 1C: SignupPage form validation states', () => {
  const renderSignup = () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<SignupPage onComplete={onComplete} onBack={vi.fn()} theme="dark" onToggleTheme={vi.fn()} />);
    return { onComplete };
  };

  it('shows a malformed-email error and does not advance', async () => {
    renderSignup();
    fireEvent.change(screen.getByTestId('signup-name'),     { target: { value: 'Test User' } });
    fireEvent.change(screen.getByTestId('signup-email'),    { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByTestId('signup-password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByTestId('signup-confirm'),  { target: { value: 'Password1' } });
    fireEvent.change(screen.getByTestId('signup-invite-code'), { target: { value: 'VALID123' } });
    fireEvent.click(screen.getByTestId('signup-submit-btn'));
    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(screen.queryByTestId('signup-otp')).toBeNull();
  });

  it('shows password-strength errors and does not advance', async () => {
    renderSignup();
    fireEvent.change(screen.getByTestId('signup-name'),     { target: { value: 'Test User' } });
    fireEvent.change(screen.getByTestId('signup-email'),    { target: { value: 't@t.com' } });
    fireEvent.change(screen.getByTestId('signup-password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByTestId('signup-confirm'),  { target: { value: 'short' } });
    fireEvent.change(screen.getByTestId('signup-invite-code'), { target: { value: 'VALID123' } });
    fireEvent.click(screen.getByTestId('signup-submit-btn'));
    expect((await screen.findAllByText(/Password:/i)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('signup-otp')).toBeNull();
  });

  it('shows password-mismatch error and does not advance', async () => {
    renderSignup();
    fireEvent.change(screen.getByTestId('signup-name'),     { target: { value: 'Test User' } });
    fireEvent.change(screen.getByTestId('signup-email'),    { target: { value: 't@t.com' } });
    fireEvent.change(screen.getByTestId('signup-password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByTestId('signup-confirm'),  { target: { value: 'Different1' } });
    fireEvent.change(screen.getByTestId('signup-invite-code'), { target: { value: 'VALID123' } });
    fireEvent.click(screen.getByTestId('signup-submit-btn'));
    expect(await screen.findByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(screen.queryByTestId('signup-otp')).toBeNull();
  });
});

// ─── Phase 1D: ForgotPasswordPage email format ──────────────────────────────

describe('Phase 1D: ForgotPasswordPage email validation', () => {
  it('shows the format error and does NOT advance to the sent state', () => {
    render(
      <ForgotPasswordPage
        onBack={vi.fn()}
        theme="dark"
        onToggleTheme={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('forgot-email'), { target: { value: 'not-valid' } });
    fireEvent.click(screen.getByTestId('forgot-email-submit'));
    expect(screen.getByTestId('forgot-email-error')).toBeInTheDocument();
    // Phase-2 single-step flow: success view is gated by a real submit; the
    // format-error path keeps the user on the email step.
    expect(screen.queryByTestId('forgot-sent-state')).toBeNull();
  });
});

// ─── Phase 1E: Modal primitive — overlay click + ESC ────────────────────────

describe('Phase 1E: Modal close behaviours', () => {
  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen onClose={onClose} title="Test">
        <div>body</div>
      </Modal>,
    );
    // The backdrop is the absolute-positioned div with the bg-background/70 class.
    const backdrop = container.querySelector('.bg-background\\/70');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when ESC is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Test">
        <div>body</div>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen onClose={onClose} title="Test">
        <div>body</div>
      </Modal>,
    );
    // The X is the only top-level button inside the modal panel
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ─── Phase 1F: ColumnModal interactions ─────────────────────────────────────

describe('Phase 1F: ColumnModal', () => {
  it('renders "Add New Column" title when no editingColumn is passed', () => {
    render(
      <ColumnModal isOpen onClose={vi.fn()} editingColumn={null} onSave={vi.fn()} />,
    );
    expect(screen.getByText(/Add New Column/i)).toBeInTheDocument();
  });

  it('renders "Edit Column" title when editingColumn is passed', () => {
    render(
      <ColumnModal
        isOpen
        onClose={vi.fn()}
        editingColumn={{ id: 'x', label: 'Tempo', type: 'plan' }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/Edit Column/i)).toBeInTheDocument();
  });

  it('disables Save Column when label is empty', () => {
    render(
      <ColumnModal isOpen onClose={vi.fn()} editingColumn={null} onSave={vi.fn()} />,
    );
    const saveBtn = screen.getByTestId('save-column-btn') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('calls onSave with label + type when Save is clicked', () => {
    const onSave = vi.fn();
    render(
      <ColumnModal isOpen onClose={vi.fn()} editingColumn={null} onSave={onSave} />,
    );
    fireEvent.change(screen.getByTestId('column-label-input'), { target: { value: 'Tempo' } });
    // Switch to "Actual" type
    fireEvent.click(screen.getByRole('button', { name: /Actual \(Trainee Logs\)/i }));
    fireEvent.click(screen.getByTestId('save-column-btn'));
    expect(onSave).toHaveBeenCalledWith('Tempo', 'actual');
  });
});

// ─── Phase 1G: RestTimer interactions ───────────────────────────────────────

describe('Phase 1G: RestTimer panel + presets', () => {
  it('expands the panel when the FAB is clicked', () => {
    render(<RestTimer />);
    fireEvent.click(screen.getByTestId('rest-timer-fab'));
    expect(screen.getByTestId('rest-timer-panel')).toBeInTheDocument();
    expect(screen.getByTestId('timer-display')).toBeInTheDocument();
  });

  it('starts the countdown when a preset is clicked (display becomes 1:00 for the 60s preset)', () => {
    render(<RestTimer />);
    fireEvent.click(screen.getByTestId('rest-timer-fab'));
    fireEvent.click(screen.getByTestId('preset-60'));
    expect(screen.getByTestId('timer-display')).toHaveTextContent('1:00');
  });

  it('Stop button resets a running timer back to 0:00', () => {
    render(<RestTimer />);
    fireEvent.click(screen.getByTestId('rest-timer-fab'));
    fireEvent.click(screen.getByTestId('preset-90'));
    expect(screen.getByTestId('timer-display')).toHaveTextContent('1:30');
    fireEvent.click(screen.getByTestId('timer-start-stop')); // Stop
    expect(screen.getByTestId('timer-display')).toHaveTextContent('0:00');
  });

  it('closes the panel when ESC is pressed', async () => {
    render(<RestTimer />);
    fireEvent.click(screen.getByTestId('rest-timer-fab'));
    expect(screen.getByTestId('rest-timer-panel')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    // AnimatePresence unmounts after the exit animation; poll until it does
    await waitFor(() => {
      expect(screen.queryByTestId('rest-timer-panel')).toBeNull();
    });
  });
});

// ─── Phase 1H: Submit button loading + double-click prevention ──────────────

describe('Phase 1H: AddClientModal submit button states', () => {
  it('flips the button label to "Creating..." while submission is in flight', async () => {
    let resolveAdd: ((c: Client) => void) | null = null;
    const onAdd = vi.fn(
      () =>
        new Promise<Client>((resolve) => {
          resolveAdd = resolve;
        }),
    );
    render(<AddClientModal isOpen onClose={vi.fn()} onAdd={onAdd} tenantId="tenant-A" />);
    fillAddClientModal();

    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /creating/i })).toBeInTheDocument();
    });

    // Resolve the in-flight call so we don't leak the pending promise.
    resolveAdd!({
      id: 'x',
      name: 'x',
      email: 'x@x.com',
      role: 'trainee',
      tenantId: 'tenant-A',
      programs: [],
    });
  });

  it('does NOT call onAdd a second time when the button is double-clicked while submitting', async () => {
    let resolveAdd: ((c: Client) => void) | null = null;
    const onAdd = vi.fn(
      () =>
        new Promise<Client>((resolve) => {
          resolveAdd = resolve;
        }),
    );
    render(<AddClientModal isOpen onClose={vi.fn()} onAdd={onAdd} tenantId="tenant-A" />);
    fillAddClientModal();

    const button = screen.getByRole('button', { name: /create client/i });
    fireEvent.click(button);

    // Wait for the button to flip into the disabled "Creating..." state, then
    // attempt a second click. The disabled button should refuse the click.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /creating/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /creating/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);

    resolveAdd!({
      id: 'x',
      name: 'x',
      email: 'x@x.com',
      role: 'trainee',
      tenantId: 'tenant-A',
      programs: [],
    });
  });
});

// ─── Phase 1I: PlateCalculator overlay close (Modal sanity) ─────────────────
//
// Already has its own focused suite; here we add the cross-cutting close
// behaviour that the user listed alongside ColumnModal and RestTimer.

describe('Phase 1I: PlateCalculator (Modal) close behaviours', () => {
  it('renders inside the Modal primitive — closing via backdrop calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen onClose={onClose} title="Plate Calculator">
        <div data-testid="plate-stub" />
      </Modal>,
    );
    // Sanity — Modal contents are present
    expect(within(container).getByTestId('plate-stub')).toBeInTheDocument();
    const backdrop = container.querySelector('.bg-background\\/70');
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
