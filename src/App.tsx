import React, { useState, useEffect, useRef } from 'react';
import { Dumbbell, ShieldCheck, Sun, Moon, UserPlus, X, ChevronRight, Users, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { useAuth } from './hooks/useAuth';
import { useProgramData } from './hooks/useProgramData';
import { useDeepLinks } from './hooks/useDeepLinks';
import { isNative } from './lib/platform';
import { supabase } from './lib/supabase';
import { TechnicalCard, TechnicalInput, Modal, Toast } from './components/ui';
import { AdminView } from './components/admin/AdminView';
import { SuperadminView } from './components/admin/SuperadminView';
import { ClientDashboard } from './components/trainee/ClientDashboard';
import { WorkoutGridLogger } from './components/trainee/WorkoutGridLogger';
import { RestTimer } from './components/trainee/RestTimer';
import { SignupPage } from './components/auth/SignupPage';
import { ForgotPasswordPage } from './components/auth/ForgotPasswordPage';
import { checkPasswordStrength } from './lib/crypto';
import { isValidEmail, INVALID_EMAIL_MESSAGE } from './lib/validation';
import type { Client, WorkoutWeek, WorkoutDay, UserRole } from './types';

// ─── Coach: Client list view ─────────────────────────────────────────────────

function ClientListView({
  clients,
  onSelectClient,
  onAddClient,
}: {
  clients: Client[];
  onSelectClient: (c: Client) => void;
  onAddClient: () => void;
}) {
  const trainees = clients.filter((c) => c.role === 'trainee');
  return (
    <div className="space-y-8">
      <header className="flex justify-between items-end">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h1 className="text-5xl font-bold tracking-tighter uppercase italic font-serif text-foreground">
            Clients
          </h1>
          <p className="text-muted-foreground font-mono text-xs mt-1 uppercase tracking-widest">
            Active Training Management
          </p>
        </motion.div>
        <motion.button
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onAddClient}
          className="bg-foreground text-background px-6 py-3 text-xs font-bold uppercase tracking-widest flex items-center hover:opacity-90 transition-all shadow-lg"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          New Client
        </motion.button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence initial={false}>
          {trainees.map((client, idx) => (
          <motion.div
            key={client.id}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ delay: idx * 0.04, duration: 0.25 }}
          >
            <TechnicalCard className="group cursor-pointer hover:border-muted-foreground transition-all hover:shadow-xl hover:-translate-y-1">
              <div onClick={() => onSelectClient(client)} className="p-8">
                <div className="flex justify-between items-start mb-6">
                  <div className="w-12 h-12 bg-muted flex items-center justify-center rounded-sm group-hover:bg-foreground group-hover:text-background transition-colors">
                    <Users className="w-6 h-6" />
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Status</p>
                    <p className="text-[10px] text-green-500 font-mono uppercase font-bold">Active</p>
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-foreground mb-1 tracking-tight">{client.name}</h3>
                <p className="text-xs text-muted-foreground font-mono mb-6">{client.email}</p>
                <div className="border-t border-border pt-6 flex justify-between items-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Program</p>
                    <p className="text-sm text-foreground font-mono font-medium">
                      {client.programs[0]?.name ?? 'No Program'}
                    </p>
                  </div>
                  <div className="w-8 h-8 rounded-full border border-border flex items-center justify-center group-hover:bg-foreground group-hover:text-background transition-all">
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </TechnicalCard>
          </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Landing / Login ─────────────────────────────────────────────────────────

function LandingPage({
  onLogin,
  onSignup,
  onForgot,
  loginError,
  isBootstrapping,
  theme,
  onToggleTheme,
}: {
  onLogin: (email: string, password: string) => void;
  onSignup: () => void;
  onForgot: () => void;
  loginError: string;
  isBootstrapping: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formatError, setFormatError] = useState('');

  const handleSubmit = () => {
    if (!isValidEmail(email)) {
      setFormatError(INVALID_EMAIL_MESSAGE);
      return;
    }
    setFormatError('');
    onLogin(email, password);
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
        <div className="w-full max-w-md space-y-10">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-7xl font-bold tracking-tighter uppercase italic font-serif leading-none">
              Iron<br />Track
            </h1>
            <p className="text-muted-foreground font-mono text-xs mt-4 uppercase tracking-widest">
              Unified Training Management System
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <TechnicalCard>
              <div className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                    Email
                  </label>
                  <div className="field-wrap">
                    <TechnicalInput
                      value={email}
                      onChange={setEmail}
                      placeholder="you@example.com"
                      type="email"
                      data-testid="login-email"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                    Password
                  </label>
                  <div className="field-wrap">
                    <TechnicalInput
                      value={password}
                      onChange={setPassword}
                      placeholder="••••••••"
                      type="password"
                      data-testid="login-password"
                    />
                  </div>
                </div>

                {formatError && (
                  <p className="text-red-500 font-mono text-xs" data-testid="login-format-error">{formatError}</p>
                )}
                {loginError && !formatError && (
                  <p className="text-red-500 font-mono text-xs">{loginError}</p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={isBootstrapping}
                  data-testid="login-btn"
                  className="btn-press w-full bg-foreground text-background py-4 text-xs font-bold uppercase tracking-widest rounded-input hover:opacity-90 shadow-lg disabled:opacity-40 disabled:cursor-wait"
                >
                  {isBootstrapping ? 'Initialising...' : 'Enter System'}
                </button>

                <div className="flex justify-between">
                  <button
                    onClick={onForgot}
                    data-testid="goto-forgot-btn"
                    className="text-xs font-mono text-muted-foreground hover:text-foreground uppercase tracking-widest"
                  >
                    Forgot Password?
                  </button>
                  <button
                    onClick={onSignup}
                    data-testid="goto-signup-btn"
                    className="text-xs font-mono text-muted-foreground hover:text-foreground uppercase tracking-widest"
                  >
                    Sign Up
                  </button>
                </div>
              </div>
            </TechnicalCard>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// ─── Add Client Modal ────────────────────────────────────────────────────────

export function AddClientModal({
  isOpen,
  onClose,
  onAdd,
  tenantId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, email: string, password: string, role: UserRole, tenantId?: string) => Promise<unknown>;
  tenantId?: string;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const reset = () => {
    setName(''); setEmail(''); setPassword(''); setConfirm('');
    setErrors([]); setSubmitting(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleAdd = async () => {
    const errs: string[] = [];
    if (!name.trim())  errs.push('Name is required.');
    if (!email.trim()) errs.push('Email is required.');
    else if (!isValidEmail(email)) errs.push(INVALID_EMAIL_MESSAGE);

    const strength = checkPasswordStrength(password);
    if (!strength.ok) errs.push(...strength.errors.map((e) => `Password: ${e}`));
    if (password !== confirm) errs.push('Passwords do not match.');

    if (errs.length > 0) { setErrors(errs); return; }

    // Defensive: a coach without an explicit tenantId should never happen, but a
    // stale persisted session pre-Sprint-1 might lack one. Refuse to submit
    // rather than letting addClient throw deep in the call.
    if (!tenantId) {
      setErrors(['Cannot create a client: your account is missing a tenant. Sign out and back in.']);
      return;
    }

    setSubmitting(true);
    try {
      await onAdd(name.trim(), email.trim(), password, 'trainee', tenantId);
      reset();
      onClose();
    } catch (err) {
      // Surface the failure inline instead of leaving the modal frozen on
      // "Creating...". Console keeps the stack for debugging.
      console.error('AddClientModal: failed to create client', err);
      const message = err instanceof Error ? err.message : 'Could not create client. Please try again.';
      setErrors([message]);
    } finally {
      setSubmitting(false);
    }
  };

  const strength = checkPasswordStrength(password);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Client">
      <div className="space-y-5">
        {[
          { label: 'Full Name', value: name,     set: setName,     placeholder: 'John Doe',          testId: 'new-client-name',     type: 'text' },
          { label: 'Email',     value: email,    set: setEmail,    placeholder: 'john@example.com',  testId: 'new-client-email',    type: 'email' },
          { label: 'Password',  value: password, set: setPassword, placeholder: 'Min 8 chars, 1 letter, 1 number', testId: 'new-client-password', type: 'password' },
          { label: 'Confirm Password', value: confirm, set: setConfirm, placeholder: '••••••••', testId: 'new-client-confirm', type: 'password' },
        ].map(({ label, value, set, placeholder, testId, type }) => (
          <div key={label} className="space-y-1.5">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              {label}
            </label>
            <div className="field-wrap">
              <TechnicalInput
                value={value}
                onChange={set}
                placeholder={placeholder}
                type={type}
                data-testid={testId}
              />
            </div>
          </div>
        ))}

        {/* Password strength indicator */}
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

        {/* Validation errors */}
        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((e) => (
              <p key={e} className="text-[10px] font-mono text-red-500">{e}</p>
            ))}
          </div>
        )}

        <button
          onClick={handleAdd}
          disabled={submitting}
          className="btn-press w-full bg-foreground text-background py-4 text-xs font-bold uppercase tracking-widest rounded-input hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create Client'}
        </button>
      </div>
    </Modal>
  );
}

// ─── App Shell (authenticated layout) ───────────────────────────────────────

function AppShell({
  children,
  authenticatedUser,
  theme,
  onToggleTheme,
  onLogout,
  onGoAdmin,
  impersonating,
  onStopImpersonating,
  toast,
  onDismissToast,
}: {
  children: React.ReactNode;
  authenticatedUser: Client;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onLogout: () => void;
  onGoAdmin: () => void;
  impersonating?: Client | null;
  onStopImpersonating?: () => void;
  toast?: string | null;
  onDismissToast?: () => void;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Impersonation banner */}
      {impersonating && (
        <div className="bg-amber-600 text-white px-4 py-2 text-xs font-mono uppercase tracking-widest flex justify-between items-center">
          <span>Viewing as: {authenticatedUser.name} (Tenant: {authenticatedUser.tenantId})</span>
          <button
            onClick={onStopImpersonating}
            data-testid="stop-impersonate-btn"
            className="flex items-center gap-2 px-3 py-1 border border-white/30 hover:bg-white/20 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Superadmin
          </button>
        </div>
      )}
      <nav className="flex justify-between items-center px-8 py-4 border-b border-border sticky top-0 bg-background/95 backdrop-blur-md z-50">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-foreground flex items-center justify-center">
            <Dumbbell className="w-5 h-5 text-background" />
          </div>
          <span className="text-lg font-bold uppercase tracking-widest font-mono">IronTrack</span>
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-xs font-mono text-muted-foreground hidden sm:block">
            {authenticatedUser.name}
          </span>
          {authenticatedUser.role === 'admin' && (
            <button
              onClick={onGoAdmin}
              data-testid="admin-btn"
              className="flex items-center space-x-2 px-4 py-2 border border-border hover:border-muted-foreground text-xs font-mono uppercase transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Admin</span>
            </button>
          )}
          <button onClick={onToggleTheme} className="p-2 hover:bg-muted rounded-sm transition-colors">
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            onClick={onLogout}
            className="p-2 hover:bg-muted rounded-sm transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </nav>
      <motion.main
        key={authenticatedUser.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="flex-1 p-8 max-w-[1600px] mx-auto w-full"
      >
        {children}
      </motion.main>
      <Toast message={toast ?? null} onDismiss={onDismissToast} />
    </div>
  );
}

// ─── Root App ────────────────────────────────────────────────────────────────

export default function App() {
  // Native deep-link listener — no-op on web.
  useDeepLinks();
  const { authenticatedUser, view, loginError, isLoading: isAuthLoading, login, logout, setView, impersonating, impersonate, stopImpersonating } = useAuth();
  const {
    clients,
    isLoadingData,
    addClient,
    saveProgram,
    saveSession,
    archiveProgram,
    deleteClient,
    createProgram,
    appendClient,
    getClientsForTenant,
  } = useProgramData(authenticatedUser);

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [activeWorkout, setActiveWorkout] = useState<{ week: WorkoutWeek; day: WorkoutDay } | null>(null);
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  // Lazy initializer reads the saved preference SYNCHRONOUSLY before the
  // theme-persist effect runs. The previous "set default 'dark', then a
  // useEffect reads localStorage on mount" pattern was racy: the persist
  // effect (declared earlier) overwrote the saved value with the default
  // before the restore effect could read it back.
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = window.localStorage.getItem('irontrack_theme');
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });
  const [toast, setToast] = useState<string | null>(null);

  // Auto-dismiss the toast 3s after it's shown. The effect re-runs when
  // `toast` changes, so triggering a new toast resets the timer cleanly.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const dismissToast = () => setToast(null);

  // Apply theme class to <html> and persist on change. The initial value
  // already came from localStorage via the useState lazy initializer above,
  // so this effect is purely "react to user-driven changes."
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('irontrack_theme', theme);

    // Native: tint the system status bar to match the active theme so the
    // Android pull-down area doesn't sit as a light strip on a dark UI (or
    // vice versa). Lazy-import keeps the web build from pulling in the
    // plugin unnecessarily.
    if (isNative()) {
      void import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
        void StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {});
        void StatusBar.setBackgroundColor({
          color: theme === 'dark' ? '#09090b' : '#ffffff',
        }).catch(() => {});
      }).catch(() => {});
    }
  }, [theme]);

  // Magic-link routing now happens synchronously inside useAuth's state
  // initializer — no effect needed here.

  // ─── Browser back-button sync ────────────────────────────────────────────
  //
  // We snapshot the three pieces of navigation-relevant state (view +
  // selectedClient + activeWorkout keys) into history.state on every change
  // and restore them on popstate. A ref breaks the popstate → setState → push
  // feedback loop. The key insight: history.state is keyed by entry, so
  // back/forward navigation transparently reads the right snapshot.

  type RouteSnapshot = {
    view: typeof view;
    selectedClientId: string | null;
    activeWorkout: { weekId: string; dayId: string } | null;
  };
  const skipNextPushRef = useRef(false);
  const initialMountRef = useRef(true);

  // Capture snapshot whenever navigation state changes.
  useEffect(() => {
    const snapshot: RouteSnapshot = {
      view,
      selectedClientId: selectedClient?.id ?? null,
      activeWorkout: activeWorkout
        ? { weekId: activeWorkout.week.id, dayId: activeWorkout.day.id }
        : null,
    };
    if (initialMountRef.current) {
      initialMountRef.current = false;
      window.history.replaceState({ irontrack: snapshot }, '');
      return;
    }
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false;
      return;
    }
    window.history.pushState({ irontrack: snapshot }, '');
  }, [view, selectedClient?.id, activeWorkout]);

  // Restore snapshot on browser back/forward.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = (e.state && (e.state as { irontrack?: RouteSnapshot }).irontrack) || null;
      if (!s) return;
      // Tell the push effect to skip the next render — we're being driven by
      // the browser, not by the user.
      skipNextPushRef.current = true;
      setView(s.view);
      if (s.selectedClientId == null) {
        setSelectedClient(null);
      } else {
        const target = clients.find((c) => c.id === s.selectedClientId);
        setSelectedClient(target ?? null);
      }
      if (s.activeWorkout == null) {
        setActiveWorkout(null);
      } else {
        const target = clients.find((c) => c.id === s.selectedClientId);
        const program =
          target?.programs.find((p) => p.id === target.activeProgramId && p.status !== 'archived') ??
          target?.programs.find((p) => p.status !== 'archived');
        const week = program?.weeks.find((w) => w.id === s.activeWorkout!.weekId);
        const day = week?.days.find((d) => d.id === s.activeWorkout!.dayId);
        setActiveWorkout(week && day ? { week, day } : null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [clients, setView]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const handleLogin = async (email: string, password: string) => {
    await login(email, password);
  };

  const handleSignupComplete = async (
    name: string,
    email: string,
    password: string,
    tenantId: string,
    inviteCode: string,
  ) => {
    // Defensive: empty tenantId would mean a corrupt invite slipped through.
    if (!tenantId || !tenantId.trim()) {
      const err = new Error(`handleSignupComplete: tenantId is required (got "${tenantId}"). The invite code may be corrupt.`);
      console.error('[IronTrack signup]', err);
      throw err;
    }
    if (!inviteCode || !inviteCode.trim()) {
      const err = new Error('handleSignupComplete: inviteCode is required.');
      console.error('[IronTrack signup]', err);
      throw err;
    }
    try {
      // Trainee signup flows through /api/signup-user instead of
      // supabase.auth.signUp. The serverless function uses the service-role
      // key to call admin.createUser({ email_confirm: true }), which skips
      // the inbox-confirmation hurdle so the OTP step IS the verification
      // gate. The service-role key never leaves the server.
      //
      // The endpoint VERIFIES the inviteCode server-side (it must exist,
      // resolve to the requested tenantId, and not be exhausted). Without
      // this gate, any unauthenticated caller could create trainees in
      // arbitrary tenants by guessing tenantIds.
      const normalizedEmail = email.trim().toLowerCase();
      const response = await fetch('/api/signup-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: normalizedEmail,
          password,
          tenantId: tenantId.trim(),
          inviteCode: inviteCode.trim(),
        }),
      });

      let payload: { profile?: unknown; error?: string } = {};
      try {
        payload = await response.json();
      } catch {
        // Non-JSON body — fall through with an empty payload so the !ok
        // branch below surfaces a generic error instead of a parse trace.
      }

      if (!response.ok) {
        throw new Error(payload.error || `Signup failed (HTTP ${response.status}).`);
      }

      // Auto-login. The user's email is already confirmed server-side, so
      // signInWithPassword succeeds and onAuthStateChange in useAuth picks
      // up the session, hydrates authenticatedUser, and routes to /trainee.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (signInErr) {
        console.error('[IronTrack signup] auto sign-in failed', signInErr);
        throw new Error(signInErr.message);
      }
    } catch (err) {
      console.error('[IronTrack signup] failure', err);
      const message = err instanceof Error ? err.message : 'Signup failed. Please try again.';
      setToast(message);
      throw err instanceof Error ? err : new Error(message);
    }
  };

  /** Silent autosave — persists actuals without setting day.logged_at and
   *  without exiting the workout view. Called by the WorkoutGridLogger
   *  after every keystroke (debounced internally). */
  const handleAutoSaveSession = async (updatedDay: WorkoutDay): Promise<void> => {
    if (!selectedClient || !activeWorkout) return;
    const program =
      selectedClient.programs.find((p) => p.id === selectedClient.activeProgramId && p.status !== 'archived') ??
      selectedClient.programs.find((p) => p.status !== 'archived');
    if (!program) return;
    await saveSession(
      selectedClient.id,
      program.id,
      activeWorkout.week.id,
      updatedDay,
      { markComplete: false },
    );
  };

  /** Explicit "Finish Workout" — stamps day.logged_at, exits back to the
   *  client dashboard, and surfaces the success toast. The trainee can
   *  put the phone down mid-workout without triggering this. */
  const handleFinishSession = async (updatedDay: WorkoutDay): Promise<void> => {
    if (!selectedClient || !activeWorkout) return;
    const program =
      selectedClient.programs.find((p) => p.id === selectedClient.activeProgramId && p.status !== 'archived') ??
      selectedClient.programs.find((p) => p.status !== 'archived');
    if (!program) return;
    await saveSession(
      selectedClient.id,
      program.id,
      activeWorkout.week.id,
      updatedDay,
      { markComplete: true },
    );
    setActiveWorkout(null);
    setToast('Workout finished — well done!');
  };

  const handleAddCoach = async (name: string, email: string, password: string): Promise<Client> => {
    // Coach creation runs through /api/admin-create-user because
    // supabase.auth.admin.createUser requires the service-role key, which
    // must NEVER reach the browser bundle. The endpoint creates the auth
    // user, lets the on_auth_user_created trigger insert the profiles row,
    // then repoints tenant_id at the new user (a coach is the root of their
    // own tenant) and returns the resulting profile.
    //
    // The endpoint requires a Bearer token so it can verify the caller's
    // role server-side — without this header, anyone with the URL could
    // mint coach accounts. Forward the current session's access token.
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      throw new Error('You must be logged in to create a coach.');
    }
    const response = await fetch('/api/admin-create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name, email, password }),
    });

    let payload: { profile?: { id: string; name: string; email: string; role: Client['role']; tenant_id: string | null; active_program_id: string | null }; error?: string } = {};
    try {
      payload = await response.json();
    } catch {
      // Non-JSON body — fall through with empty payload so the !ok branch
      // surfaces a generic error instead of a JSON parse trace.
    }

    if (!response.ok || !payload.profile) {
      throw new Error(payload.error || `Failed to create coach (HTTP ${response.status}).`);
    }

    const profile = payload.profile;
    const newCoach: Client = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      tenantId: profile.tenant_id ?? undefined,
      activeProgramId: profile.active_program_id ?? undefined,
      programs: [],
    };
    appendClient(newCoach);
    setToast('Coach created successfully');
    return newCoach;
  };

  // Keep selectedClient in sync with the clients store (e.g. after coach edits)
  useEffect(() => {
    if (selectedClient) {
      const refreshed = clients.find((c) => c.id === selectedClient.id);
      if (refreshed) setSelectedClient(refreshed);
    }
  }, [clients]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-set selectedClient for trainees on login
  useEffect(() => {
    if (authenticatedUser?.role === 'trainee') {
      const fresh = clients.find((c) => c.id === authenticatedUser.id);
      if (fresh) setSelectedClient(fresh);
    }
  }, [authenticatedUser, clients]);

  // Tenant-scoped clients for the current user
  const tenantClients = authenticatedUser ? getClientsForTenant(authenticatedUser) : [];

  // ── Signup ──────────────────────────────────────────────────────────────

  if (view === 'signup') {
    return (
      <>
        <SignupPage
          onComplete={handleSignupComplete}
          onBack={() => setView('landing')}
          theme={theme}
          onToggleTheme={toggleTheme}
          existingEmails={clients.map((c) => c.email)}
        />
        <Toast message={toast ?? null} onDismiss={dismissToast} />
      </>
    );
  }

  // ── Forgot Password ──────────────────────────────────────────────────

  if (view === 'forgot') {
    return (
      <>
        <ForgotPasswordPage
          onBack={() => setView('landing')}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <Toast message={toast ?? null} onDismiss={dismissToast} />
      </>
    );
  }

  // ── Landing / Login ────────────────────────────────────────────────────

  if (!authenticatedUser || view === 'landing') {
    return (
      <>
        <LandingPage
          onLogin={handleLogin}
          onSignup={() => setView('signup')}
          onForgot={() => setView('forgot')}
          loginError={loginError}
          isBootstrapping={isAuthLoading}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <Toast message={toast ?? null} onDismiss={dismissToast} />
      </>
    );
  }

  // ── Superadmin view ────────────────────────────────────────────────────

  if (view === 'superadmin' && authenticatedUser.role === 'superadmin') {
    return (
      <AppShell
        authenticatedUser={authenticatedUser}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
        toast={toast}
        onDismissToast={dismissToast}
        onGoAdmin={() => {}}
      >
        <SuperadminView
          clients={clients}
          onAddCoach={handleAddCoach}
          onImpersonate={impersonate}
        />
      </AppShell>
    );
  }

  // ── Active workout logger ──────────────────────────────────────────────

  if (activeWorkout && selectedClient) {
    const program =
      selectedClient.programs.find((p) => p.id === selectedClient.activeProgramId && p.status !== 'archived') ??
      selectedClient.programs.find((p) => p.status !== 'archived') ??
      selectedClient.programs[0];

    return (
      <AppShell
        authenticatedUser={authenticatedUser}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
        toast={toast}
        onDismissToast={dismissToast}
        onGoAdmin={() => setView('admin')}
        impersonating={impersonating}
        onStopImpersonating={stopImpersonating}
      >
        <WorkoutGridLogger
          client={selectedClient}
          program={program}
          week={activeWorkout.week}
          day={activeWorkout.day}
          onBack={() => setActiveWorkout(null)}
          onAutoSave={handleAutoSaveSession}
          onFinish={handleFinishSession}
        />
        <RestTimer />
      </AppShell>
    );
  }

  // ── Admin view ─────────────────────────────────────────────────────────

  if (view === 'admin') {
    if (authenticatedUser.role !== 'admin' && authenticatedUser.role !== 'superadmin') {
      setView('trainee');
      return null;
    }
    return (
      <AppShell
        authenticatedUser={authenticatedUser}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
        toast={toast}
        onDismissToast={dismissToast}
        onGoAdmin={() => setView('admin')}
        impersonating={impersonating}
        onStopImpersonating={stopImpersonating}
      >
        <AdminView
          clients={clients}
          authenticatedUser={authenticatedUser}
          isLoadingData={isLoadingData}
          onSaveProgram={saveProgram}
          onCreateProgram={createProgram}
          onDeleteClient={deleteClient}
          onArchiveProgram={archiveProgram}
          onBack={() => {
            if (impersonating) {
              stopImpersonating();
            } else {
              setView('coach');
            }
          }}
        />
      </AppShell>
    );
  }

  // ── Client dashboard (trainee or coach drilling into a client) ─────────

  if (selectedClient && (view === 'trainee' || view === 'coach')) {
    return (
      <AppShell
        authenticatedUser={authenticatedUser}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
        toast={toast}
        onDismissToast={dismissToast}
        onGoAdmin={() => setView('admin')}
        impersonating={impersonating}
        onStopImpersonating={stopImpersonating}
      >
        <ClientDashboard
          client={selectedClient}
          // Coaches drilling into a client (or superadmins impersonating a
          // coach drilled into a client) get a back arrow that returns to
          // the client list. Trainees viewing their OWN dashboard get
          // `undefined` — there's no parent view to go back to, and the
          // arrow used to call logout() which trainees confused for a
          // navigation gesture. Logout lives in the X icon up top.
          onBack={
            authenticatedUser.role === 'admin' || impersonating
              ? () => {
                  setSelectedClient(null);
                  setView('coach');
                }
              : undefined
          }
          onStartWorkout={(week, day) => setActiveWorkout({ week, day })}
        />
      </AppShell>
    );
  }

  // ── Coach: client list ─────────────────────────────────────────────────

  if (authenticatedUser.role !== 'admin' && !impersonating) {
    // Trainee with no selectedClient yet (edge case during bootstrap)
    return null;
  }

  return (
    <AppShell
      authenticatedUser={authenticatedUser}
      theme={theme}
      onToggleTheme={toggleTheme}
      onLogout={logout}
      toast={toast}
      onDismissToast={dismissToast}
      onGoAdmin={() => setView('admin')}
      impersonating={impersonating}
      onStopImpersonating={stopImpersonating}
    >
      <AnimatePresence mode="wait">
        <ClientListView
          clients={tenantClients}
          onSelectClient={(c) => { setSelectedClient(c); setView('coach'); }}
          onAddClient={() => setIsAddClientOpen(true)}
        />
      </AnimatePresence>
      <AddClientModal
        isOpen={isAddClientOpen}
        onClose={() => setIsAddClientOpen(false)}
        onAdd={addClient}
        tenantId={authenticatedUser.tenantId ?? authenticatedUser.id}
      />
    </AppShell>
  );
}