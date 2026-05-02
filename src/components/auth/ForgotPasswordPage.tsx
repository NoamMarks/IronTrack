import { useState } from 'react';
import { Dumbbell, Sun, Moon, ArrowLeft, MailCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { TechnicalCard, TechnicalInput } from '../ui';
import { isValidEmail, INVALID_EMAIL_MESSAGE } from '../../lib/validation';
import { supabase } from '../../lib/supabase';

interface ForgotPasswordPageProps {
  onBack: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

type Step = 'email' | 'sent';

/**
 * Phase-2 password reset:
 *
 *   1. User enters email → supabase.auth.resetPasswordForEmail()
 *   2. Supabase sends a reset link (handled via Supabase's email templates).
 *   3. The user clicks the link → returns to the app with a recovery token in
 *      the URL hash. supabase.auth.detectSessionInUrl picks it up and fires a
 *      PASSWORD_RECOVERY event, which a future "set new password" page will
 *      handle.
 *
 * To prevent email enumeration, the success state is shown regardless of
 * whether the email actually exists in auth.users — Supabase silently
 * succeeds for unknown emails too.
 */
export function ForgotPasswordPage({ onBack, theme, onToggleTheme }: ForgotPasswordPageProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleEmailSubmit = async () => {
    if (!isValidEmail(email)) {
      setEmailError(INVALID_EMAIL_MESSAGE);
      return;
    }
    setEmailError('');
    setSubmitting(true);
    try {
      const redirectTo = (() => {
        if (typeof window === 'undefined') return undefined;
        const base = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.trim()
          || window.location.origin;
        return `${base.replace(/\/+$/, '')}/reset-password`;
      })();

      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        redirectTo ? { redirectTo } : undefined,
      );
      if (error) {
        // We deliberately swallow the error from the user's POV (no leak about
        // whether the email exists). Log it so devs can debug.
        console.error('[IronTrack reset] resetPasswordForEmail error', error);
      }
    } catch (err) {
      console.error('[IronTrack reset] unexpected error', err);
    } finally {
      setSubmitting(false);
      // Always show the "check your inbox" state — never leak existence.
      setStep('sent');
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex justify-between items-center p-6 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-foreground flex items-center justify-center">
            <Dumbbell className="w-5 h-5 text-background" />
          </div>
          <span className="text-lg font-bold uppercase tracking-widest font-mono">IronTrack</span>
        </div>
        <button onClick={onToggleTheme} className="p-2 hover:bg-muted rounded-sm transition-colors">
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </nav>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <button
              onClick={onBack}
              data-testid="forgot-back-btn"
              className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground uppercase tracking-widest mb-6"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Login
            </button>

            <h1 className="text-5xl font-bold tracking-tighter uppercase italic font-serif leading-none">
              Reset Password
            </h1>
            <p className="text-muted-foreground font-mono text-xs mt-3 uppercase tracking-widest">
              {step === 'email' && 'Enter your email to receive a reset link'}
              {step === 'sent'  && 'Check your inbox for the reset link'}
            </p>
          </motion.div>

          {step === 'email' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <TechnicalCard>
                <div className="p-8 space-y-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                      Email Address
                    </label>
                    <div className="field-wrap">
                      <TechnicalInput
                        value={email}
                        onChange={setEmail}
                        placeholder="you@example.com"
                        type="email"
                        data-testid="forgot-email"
                      />
                    </div>
                  </div>
                  {emailError && (
                    <p className="text-[10px] font-mono text-red-500" data-testid="forgot-email-error">
                      {emailError}
                    </p>
                  )}
                  <button
                    onClick={() => void handleEmailSubmit()}
                    disabled={!email.trim() || submitting}
                    data-testid="forgot-email-submit"
                    className="btn-press w-full bg-foreground text-background py-4 text-xs font-bold uppercase tracking-widest rounded-input hover:opacity-90 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </div>
              </TechnicalCard>
            </motion.div>
          )}

          {step === 'sent' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <TechnicalCard>
                <div className="p-8 space-y-6 text-center" data-testid="forgot-sent-state">
                  <div className="flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                      <MailCheck className="w-6 h-6 text-emerald-400" />
                    </div>
                  </div>
                  <p className="text-xs font-mono text-foreground">
                    If an account exists for <span className="font-bold">{email}</span>, a password reset link is on its way.
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                    The link expires in 1 hour. Check your spam folder if you don't see it.
                  </p>
                  <button
                    onClick={onBack}
                    data-testid="forgot-back-to-login"
                    className="btn-press w-full bg-foreground text-background py-4 text-xs font-bold uppercase tracking-widest rounded-input hover:opacity-90 shadow-lg"
                  >
                    Back to Login
                  </button>
                </div>
              </TechnicalCard>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
