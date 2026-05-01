/**
 * Magic Invite Link UI tests — Phase 3.
 *
 * The Phase 1 storage-layer tests (localStorage persistence, useCount math)
 * are obsolete — invite_codes now lives in Supabase and the helper functions
 * are thin wrappers around supabase-js. This file focuses on the UI: the
 * SignupPage's URL-param detection, banner rendering, and read-only field.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignupPage } from '../components/auth/SignupPage';

// Per-file mock so individual tests can swap return values.
vi.mock('../lib/inviteCodes', () => ({
  normalizeInviteCode: (s: string) => s.replace(/\s+/g, '').toUpperCase(),
  buildInviteLink: (code: string) => `http://localhost/signup?invite=${code}`,
  createInviteCode: vi.fn(),
  consumeInviteCode: vi.fn().mockResolvedValue(undefined),
  deleteInviteCode: vi.fn().mockResolvedValue(undefined),
  getInviteCodesForCoach: vi.fn().mockResolvedValue([]),
  lookupInviteCode: vi.fn(),
}));
import { lookupInviteCode } from '../lib/inviteCodes';

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('SignupPage with ?invite= URL', () => {
  it('auto-fills the invite field and locks it when the URL carries a valid code', async () => {
    (lookupInviteCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'inv1',
      code: 'WELCOME1',
      tenantId: 'tenant-A',
      coachId: 'coachA',
      coachName: 'Coach Alpha',
      createdAt: '',
      useCount: 0,
    });
    window.history.replaceState(null, '', '/signup?invite=WELCOME1');

    render(
      <SignupPage
        onComplete={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
        theme="dark"
        onToggleTheme={vi.fn()}
      />,
    );

    const inviteField = screen.getByTestId('signup-invite-code') as HTMLInputElement;
    await waitFor(() => expect(inviteField.value).toBe('WELCOME1'));
    expect(inviteField.readOnly).toBe(true);
  });

  it('shows the welcome banner with the coach name when the link is valid', async () => {
    (lookupInviteCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'inv1',
      code: 'WELCOME1',
      tenantId: 'tenant-A',
      coachId: 'coachA',
      coachName: 'Coach Alpha',
      createdAt: '',
      useCount: 0,
    });
    window.history.replaceState(null, '', '/signup?invite=WELCOME1');

    render(
      <SignupPage
        onComplete={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
        theme="dark"
        onToggleTheme={vi.fn()}
      />,
    );
    const banner = await screen.findByTestId('invite-welcome-banner');
    expect(banner).toHaveTextContent(/Coach Alpha/);
  });

  it('shows the invalid banner and locks the field when the URL code is unknown', async () => {
    (lookupInviteCode as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    window.history.replaceState(null, '', '/signup?invite=DOESNOTEXIST');

    render(
      <SignupPage
        onComplete={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
        theme="dark"
        onToggleTheme={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('invite-invalid-banner')).toBeInTheDocument();
    const inviteField = screen.getByTestId('signup-invite-code') as HTMLInputElement;
    expect(inviteField.readOnly).toBe(true);
  });

  it('renders the form normally with no banner when there is no ?invite=', () => {
    render(
      <SignupPage
        onComplete={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
        theme="dark"
        onToggleTheme={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('invite-welcome-banner')).toBeNull();
    expect(screen.queryByTestId('invite-invalid-banner')).toBeNull();
    const inviteField = screen.getByTestId('signup-invite-code') as HTMLInputElement;
    expect(inviteField.readOnly).toBe(false);
  });

  it('blocks submit and shows the invalid-code error when manual input is unknown', async () => {
    (lookupInviteCode as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const onComplete = vi.fn();

    render(
      <SignupPage
        onComplete={onComplete}
        onBack={vi.fn()}
        theme="dark"
        onToggleTheme={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('signup-name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByTestId('signup-email'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByTestId('signup-password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByTestId('signup-confirm'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByTestId('signup-invite-code'), { target: { value: 'NOPE' } });
    fireEvent.click(screen.getByTestId('signup-submit-btn'));

    expect(await screen.findByText(/invalid invite code/i)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
