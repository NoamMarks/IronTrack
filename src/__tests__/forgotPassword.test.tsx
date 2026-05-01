/**
 * Phase-2 Forgot Password coverage.
 *
 * The reset flow is now a single-step "send a reset link" UX backed by
 * supabase.auth.resetPasswordForEmail. We assert the UI calls the mocked
 * Supabase method, never leaks whether the email exists, and shows the
 * "check your inbox" state on success.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ForgotPasswordPage } from '../components/auth/ForgotPasswordPage';
import { supabase } from '../lib/supabase';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForgotPasswordPage (Phase 2 — Supabase)', () => {
  function renderPage() {
    return render(
      <ForgotPasswordPage onBack={vi.fn()} theme="dark" onToggleTheme={vi.fn()} />,
    );
  }

  it('blocks submission and shows a format error for malformed emails', async () => {
    renderPage();
    fireEvent.change(screen.getByTestId('forgot-email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByTestId('forgot-email-submit'));

    expect(await screen.findByTestId('forgot-email-error')).toBeInTheDocument();
    // Did NOT advance to the sent state
    expect(screen.queryByTestId('forgot-sent-state')).toBeNull();
    // And the supabase call was never made
    expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('calls supabase.auth.resetPasswordForEmail with the normalized email and advances to sent state', async () => {
    renderPage();
    fireEvent.change(screen.getByTestId('forgot-email'), { target: { value: '  USER@TEST.com ' } });
    fireEvent.click(screen.getByTestId('forgot-email-submit'));

    await waitFor(() => {
      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalled();
    });
    const [emailArg] = (supabase.auth.resetPasswordForEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(emailArg).toBe('user@test.com');

    expect(await screen.findByTestId('forgot-sent-state')).toBeInTheDocument();
  });

  it('shows the "check your inbox" UI even when Supabase reports an error (anti-enumeration)', async () => {
    (supabase.auth.resetPasswordForEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {},
      error: { message: 'User not found' },
    });
    renderPage();
    fireEvent.change(screen.getByTestId('forgot-email'), { target: { value: 'nobody@test.com' } });
    fireEvent.click(screen.getByTestId('forgot-email-submit'));

    expect(await screen.findByTestId('forgot-sent-state')).toBeInTheDocument();
  });

  it('the Send button shows a loading state while in flight', async () => {
    type ResolveFn = (v: { data: object; error: null }) => void;
    const deferred: { resolve?: ResolveFn } = {};
    const inflight = new Promise<{ data: object; error: null }>((resolve) => {
      deferred.resolve = resolve;
    });
    (supabase.auth.resetPasswordForEmail as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => inflight,
    );

    renderPage();
    fireEvent.change(screen.getByTestId('forgot-email'), { target: { value: 'user@test.com' } });
    fireEvent.click(screen.getByTestId('forgot-email-submit'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sending/i })).toBeInTheDocument();
    });

    deferred.resolve?.({ data: {}, error: null });
  });
});
