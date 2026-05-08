/**
 * OTP Verification Service
 *
 * Signup OTP delivery is now handled by Supabase Auth (Google SMTP configured
 * in the project's Auth → SMTP settings). The custom Resend-backed
 * `generateOTP` / `sendVerificationEmail` pair was retired here in favor of
 * `sendSupabaseOTP`, which lets Supabase generate the code, store its hash
 * server-side, and dispatch the email via the user's SMTP provider.
 *
 * The legacy reset-token store below (`createResetToken`, `validateResetToken`,
 * `consumeResetToken`) is unused in production — `ForgotPasswordPage` calls
 * `supabase.auth.resetPasswordForEmail` directly — but is still exercised by
 * `__tests__/resetToken.test.ts`, so it stays put. The numeric-code helper
 * those functions need is kept as an unexported helper.
 */

import { sendPasswordResetEmailViaResend } from './email';
import { supabase } from './supabase';

// ─── Supabase native OTP ────────────────────────────────────────────────────

/**
 * Send a 6-digit signup OTP via Supabase Auth. With `shouldCreateUser: true`,
 * Supabase will create the auth user up front (passwordless) and only confirm
 * their email after `verifyOtp` is called. The OTP itself is delivered through
 * whatever SMTP service is configured in the Supabase dashboard.
 *
 * Throws when Supabase rejects the request (rate-limited, malformed email,
 * SMTP outage, etc.) so the caller can surface the error in the UI.
 */
export async function sendSupabaseOTP(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
  if (error) {
    console.error('[IronTrack signup] sendSupabaseOTP error', error);
    throw new Error(error.message);
  }
}

// ─── Reset Token Service (legacy, kept for tests) ───────────────────────────

const RESET_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface ResetToken {
  code: string;
  email: string;
  createdAt: number;
  used: boolean;
}

/** In-memory store — tokens don't survive page refresh (intentionally safe). */
const tokenStore: ResetToken[] = [];

/** Visible for testing — returns the internal store reference. */
export function _getTokenStore(): ResetToken[] {
  return tokenStore;
}

/** Clear all tokens (useful in tests). */
export function _clearTokenStore(): void {
  tokenStore.length = 0;
}

/** Generate a random 6-digit numeric code. Used internally by the reset-token
 *  store; not exposed because production OTP delivery now goes through
 *  Supabase Auth (see sendSupabaseOTP). */
function generateNumericCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Create a reset token for the given email.
 * Invalidates any previous unused tokens for the same email.
 */
export function createResetToken(email: string): ResetToken {
  for (const t of tokenStore) {
    if (t.email === email && !t.used) t.used = true;
  }
  const token: ResetToken = {
    code: generateNumericCode(),
    email: email.toLowerCase().trim(),
    createdAt: Date.now(),
    used: false,
  };
  tokenStore.push(token);
  return token;
}

/**
 * Validate a reset code for a given email.
 * Returns true only if the code matches, is not expired, and has not been used.
 */
export function validateResetToken(email: string, code: string): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  const token = tokenStore.find(
    (t) => t.email === normalizedEmail && t.code === code && !t.used
  );
  if (!token) return false;
  if (Date.now() - token.createdAt > RESET_TOKEN_TTL_MS) return false;
  return true;
}

/**
 * Consume (invalidate) a reset token after a successful password change.
 */
export function consumeResetToken(email: string, code: string): void {
  const normalizedEmail = email.toLowerCase().trim();
  const token = tokenStore.find(
    (t) => t.email === normalizedEmail && t.code === code && !t.used
  );
  if (token) token.used = true;
}

/**
 * Send a password reset email.
 * Currently still routed through the Resend-backed pipeline; will be migrated
 * to Supabase's native reset flow in a follow-up.
 */
export function sendPasswordResetEmail(email: string, code: string): void {
  void sendPasswordResetEmailViaResend(email, code);
}
