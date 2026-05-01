import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignupPage } from '../components/auth/SignupPage';

// Mock invite code lookup — return a valid invite for 'VALID123'.
// All exports are async to match the Phase-3 Supabase-backed signatures.
vi.mock('../lib/inviteCodes', () => ({
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
  createInviteCode: vi.fn(),
  getInviteCodesForCoach: vi.fn().mockResolvedValue([]),
  deleteInviteCode: vi.fn().mockResolvedValue(undefined),
  consumeInviteCode: vi.fn().mockResolvedValue(undefined),
  buildInviteLink: (code: string) => `http://localhost/signup?invite=${code}`,
  normalizeInviteCode: (s: string) => s.replace(/\s+/g, '').toUpperCase(),
}));

// Capture the OTP that gets "sent"
let capturedOtp = '';
vi.mock('../lib/verification', () => ({
  generateOTP: () => {
    capturedOtp = '123456';
    return '123456';
  },
  sendVerificationEmail: vi.fn(),
}));

describe('Verified Signup Flow', () => {
  const onComplete = vi.fn().mockResolvedValue(undefined);
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOtp = '';
  });

  function fillForm(inviteCode = 'VALID123') {
    render(
      <SignupPage
        onComplete={onComplete}
        onBack={onBack}
        theme="dark"
        onToggleTheme={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('signup-name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByTestId('signup-email'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByTestId('signup-password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByTestId('signup-confirm'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByTestId('signup-invite-code'), { target: { value: inviteCode } });
  }

  it('blocks signup with an invalid invite code', async () => {
    fillForm('BADCODE');
    fireEvent.click(screen.getByTestId('signup-submit-btn'));

    expect(await screen.findByText(/invalid invite code/i)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('advances to OTP step with a valid invite code', async () => {
    fillForm('VALID123');
    fireEvent.click(screen.getByTestId('signup-submit-btn'));

    expect(await screen.findByTestId('signup-otp')).toBeInTheDocument();
    expect(screen.getByTestId('signup-verify-btn')).toBeInTheDocument();
  });

  it('rejects an incorrect verification code', async () => {
    fillForm('VALID123');
    fireEvent.click(screen.getByTestId('signup-submit-btn'));

    // Wait for the OTP step to render before interacting with it.
    const otpInput = await screen.findByTestId('signup-otp');
    fireEvent.change(otpInput, { target: { value: '999999' } });
    fireEvent.click(screen.getByTestId('signup-verify-btn'));

    expect(await screen.findByTestId('otp-error')).toBeInTheDocument();
    expect(screen.getByText(/incorrect verification code/i)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('creates the account only after the correct OTP is entered', async () => {
    fillForm('VALID123');
    fireEvent.click(screen.getByTestId('signup-submit-btn'));

    const otpInput = await screen.findByTestId('signup-otp');
    fireEvent.change(otpInput, { target: { value: capturedOtp } });
    fireEvent.click(screen.getByTestId('signup-verify-btn'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('Test User', 'test@test.com', 'Password1', 'tenant-A');
    });
  });
});
