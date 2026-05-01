import { useState, useEffect } from 'react';
import { Dumbbell, Sun, Moon, ArrowLeft, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { TechnicalCard, TechnicalInput } from '../ui';
import { cn } from '../../lib/utils';
import { checkPasswordStrength } from '../../lib/crypto';
import { isValidEmail, INVALID_EMAIL_MESSAGE } from '../../lib/validation';
import { lookupInviteCode, consumeInviteCode, normalizeInviteCode } from '../../lib/inviteCodes';
import { generateOTP, sendVerificationEmail } from '../../lib/verification';
import type { InviteCode } from '../../types';

interface SignupPageProps {
  onComplete: (name: string, email: string, password: string, tenantId: string) => Promise<void>;
  onBack: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  /** Emails currently in the clients store — used for the duplicate-email guard.
   *  Optional; treated as empty when omitted (e.g. from focused unit tests). */
  existingEmails?: string[];
}

type Step = 'form' | 'verify';

export function SignupPage({ onComplete, onBack, theme, onToggleTheme, existingEmails }: SignupPageProps) {
  const [step, setStep] = useState<Step>('form');

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  // Magic-link state — populated when ?invite=CODE is in the URL
  const [prefilledInvite, setPrefilledInvite] = useState<InviteCode | null>(null);
  const [linkInviteRaw, setLinkInviteRaw] = useState<string>('');
  const [linkInviteInvalid, setLinkInviteInvalid] = useState(false);

  // OTP state
  const [otp, setOtp] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resolvedTenantId, setResolvedTenantId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const strength = checkPasswordStrength(password);

  // Read ?invite= from the URL on mount; auto-fill the field and surface
  // the coach's name in a welcome banner. Normalize through the same path
  // the lookup uses so URL artefacts can never desynchronise the two.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('invite');
    if (!raw) return;
    const normalized = normalizeInviteCode(raw);
    setLinkInviteRaw(raw);
    setInviteCode(normalized);
    let cancelled = false;
    void lookupInviteCode(normalized).then((looked) => {
      if (cancelled) return;
      if (looked) setPrefilledInvite(looked);
      else setLinkInviteInvalid(true);
    });
    return () => { cancelled = true; };
  }, []);

  // True when this signup arrived via a magic link (locks the field even if invalid).
  const isMagicLink = linkInviteRaw !== '';

  const handleSubmitForm = async () => {
    const errs: string[] = [];
    if (!name.trim()) errs.push('Name is required.');
    if (!email.trim()) errs.push('Email is required.');
    else if (!isValidEmail(email)) errs.push(INVALID_EMAIL_MESSAGE);
    if (!strength.ok) errs.push(...strength.errors.map((e) => `Password: ${e}`));
    if (password !== confirm) errs.push('Passwords do not match.');

    // Duplicate-email guard — refuse to send the OTP for an email that's
    // already in the system. Case-insensitive, trims surrounding whitespace.
    const normalizedEmail = email.trim().toLowerCase();
    if (
      normalizedEmail &&
      (existingEmails ?? []).some((e) => e.toLowerCase() === normalizedEmail)
    ) {
      errs.push('An account with this email already exists.');
    }

    // Validate invite code (now async — Supabase lookup)
    const invite = await lookupInviteCode(inviteCode);
    if (!invite) {
      errs.push('Invalid invite code. Please check with your coach.');
    } else if (!invite.tenantId || !invite.tenantId.trim()) {
      // Defensive: a corrupt invite without a tenantId would let the form
      // proceed to OTP, then silently fail at addClient time. Reject up front.
      console.error('[IronTrack signup] lookupInviteCode returned an invite with no tenantId', invite);
      errs.push('Invite code is corrupt — ask your coach to generate a new one.');
    }

    if (errs.length > 0) { setErrors(errs); return; }

    // Generate OTP and "send" email
    const code = generateOTP();
    setGeneratedOtp(code);
    setResolvedTenantId(invite!.tenantId);
    sendVerificationEmail(email.trim(), code);
    setStep('verify');
    setErrors([]);
  };

  const handleVerify = async () => {
    if (otp.trim() !== generatedOtp) {
      setOtpError('Incorrect verification code. Please try again.');
      return;
    }
    setOtpError('');
    setSubmitting(true);
    try {
      await onComplete(name.trim(), email.trim(), password, resolvedTenantId);
      // Only consume the invite once the account creation succeeded — if onComplete
      // throws we leave the use count alone.
      await consumeInviteCode(inviteCode.trim());
    } catch (err) {
      // Surface the failure inline. The previous code had try/finally with no
      // catch, which let exceptions propagate as unhandled rejections — the
      // user saw the button revert from "Creating Account..." with no message
      // and no account.
      console.error('[IronTrack signup] verify step failed', err);
      const message = err instanceof Error ? err.message : 'Could not create your account. Please try again.';
      setOtpError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
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
              className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground uppercase tracking-widest mb-6"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Login
            </button>

            <h1 className="text-5xl font-bold tracking-tighter uppercase italic font-serif leading-none">
              Sign Up
            </h1>
            <p className="text-muted-foreground font-mono text-xs mt-3 uppercase tracking-widest">
              {step === 'form' ? 'Create your training account' : 'Verify your email'}
            </p>
          </motion.div>

          {step === 'form' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              {/* Magic-link welcome banner */}
              {prefilledInvite && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  data-testid="invite-welcome-banner"
                  className="mb-5 flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
                >
                  <Sparkles className="w-5 h-5 text-emerald-400 shrink-0" />
                  <p className="text-xs font-mono text-foreground">
                    {prefilledInvite.coachName ? (
                      <>You've been invited to join <span className="font-bold">{prefilledInvite.coachName}</span>'s training environment.</>
                    ) : (
                      <>You've been invited to a coach's training environment.</>
                    )}
                  </p>
                </motion.div>
              )}
              {linkInviteInvalid && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  data-testid="invite-invalid-banner"
                  className="mb-5 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3"
                >
                  <p className="text-xs font-mono text-amber-500">
                    This invite link is invalid or has been used up. Ask your coach for a new one.
                  </p>
                </motion.div>
              )}
              <TechnicalCard>
                <div className="p-8 space-y-5">
                  {[
                    { label: 'Full Name', value: name, set: setName, placeholder: 'John Doe', testId: 'signup-name', type: 'text', readOnly: false },
                    { label: 'Email', value: email, set: setEmail, placeholder: 'john@example.com', testId: 'signup-email', type: 'email', readOnly: false },
                    { label: 'Password', value: password, set: setPassword, placeholder: 'Min 8 chars, 1 letter, 1 number', testId: 'signup-password', type: 'password', readOnly: false },
                    { label: 'Confirm Password', value: confirm, set: setConfirm, placeholder: '••••••••', testId: 'signup-confirm', type: 'password', readOnly: false },
                    { label: 'Coach Invite Code', value: inviteCode, set: setInviteCode, placeholder: 'e.g. A1B2C3D4', testId: 'signup-invite-code', type: 'text', readOnly: isMagicLink },
                  ].map(({ label, value, set, placeholder, testId, type, readOnly }) => (
                    <div key={label} className="space-y-1.5">
                      <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                        {label}
                      </label>
                      <div className={cn(
                        'field-wrap',
                        readOnly && 'bg-muted/60',
                      )}>
                        <TechnicalInput
                          value={value}
                          onChange={set}
                          placeholder={placeholder}
                          type={type}
                          readOnly={readOnly}
                          data-testid={testId}
                        />
                      </div>
                    </div>
                  ))}

                  {password.length > 0 && (
                    <div className="space-y-1">
                      {strength.errors.map((e) => (
                        <p key={e} className="text-[10px] font-mono text-amber-500">{e}</p>
                      ))}
                      {strength.ok && (
                        <p className="text-[10px] font-mono text-green-500">Password meets requirements</p>
                      )}
                    </div>
                  )}

                  {errors.length > 0 && (
                    <div className="space-y-1">
                      {errors.map((e) => (
                        <p key={e} className="text-[10px] font-mono text-red-500">{e}</p>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => void handleSubmitForm()}
                    data-testid="signup-submit-btn"
                    className="btn-press w-full bg-foreground text-background py-4 text-xs font-bold uppercase tracking-widest rounded-input hover:opacity-90 shadow-lg"
                  >
                    Continue
                  </button>
                </div>
              </TechnicalCard>
            </motion.div>
          )}

          {step === 'verify' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <TechnicalCard>
                <div className="p-8 space-y-6">
                  <p className="text-xs font-mono text-muted-foreground">
                    A 6-digit verification code has been sent to <span className="text-foreground font-bold">{email}</span>.
                    Check the browser console for the code.
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                      Verification Code
                    </label>
                    <div className="bg-muted/30 p-4 border border-border">
                      <TechnicalInput
                        value={otp}
                        onChange={setOtp}
                        placeholder="000000"
                        data-testid="signup-otp"
                        className="text-center text-2xl tracking-[0.5em]"
                      />
                    </div>
                  </div>

                  {otpError && (
                    <p className="text-[10px] font-mono text-red-500" data-testid="otp-error">{otpError}</p>
                  )}

                  <button
                    onClick={handleVerify}
                    disabled={submitting || otp.length !== 6}
                    data-testid="signup-verify-btn"
                    className="btn-press w-full bg-accent text-accent-foreground py-4 text-xs font-bold uppercase tracking-widest rounded-input hover:opacity-90 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Creating Account...' : 'Verify & Create Account'}
                  </button>

                  <button
                    onClick={() => {
                      const code = generateOTP();
                      setGeneratedOtp(code);
                      sendVerificationEmail(email.trim(), code);
                      setOtpError('');
                    }}
                    className="w-full text-xs font-mono text-muted-foreground hover:text-foreground uppercase tracking-widest"
                  >
                    Resend Code
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