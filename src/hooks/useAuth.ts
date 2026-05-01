import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Client, AppView } from '../types';

interface AuthState {
  authenticatedUser: Client | null;
  view: AppView;
  loginError: string;
  /** When superadmin is impersonating a coach, stores the original superadmin user.
   *  Note: impersonation is purely a client-side UI override — the underlying
   *  Supabase session is still the superadmin's, so RLS-protected reads happen
   *  with superadmin privileges. */
  impersonating: Client | null;
  /** True until the initial getSession() resolves on mount. UI can use this
   *  to avoid a flash of the login screen on reload while a session is
   *  hydrating. */
  isLoading: boolean;
}

interface UseAuthReturn extends AuthState {
  /** Sign in with email/password via Supabase. Sets `loginError` on failure;
   *  state is populated by the onAuthStateChange listener on success. */
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setView: (view: AppView) => void;
  impersonate: (coach: Client) => void;
  stopImpersonating: () => void;
}

function viewForRole(role: Client['role']): AppView {
  switch (role) {
    case 'superadmin': return 'superadmin';
    case 'admin':      return 'coach';
    case 'trainee':    return 'trainee';
  }
}

/** Magic-link URL detection: signup deep links override whatever view we'd
 *  otherwise default to so an invite click always lands on the form. */
function initialViewFromUrl(fallback: AppView): AppView {
  if (typeof window === 'undefined') return fallback;
  const params = new URLSearchParams(window.location.search);
  if (window.location.pathname.startsWith('/signup') || params.has('invite')) {
    return 'signup';
  }
  return fallback;
}

/** Map raw Supabase auth error messages onto the friendlier strings the UI
 *  has historically shown. Anything we don't recognise falls through. */
function mapAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Invalid email or password.';
  if (m.includes('email not confirmed')) return 'Email not confirmed. Check your inbox for the confirmation link.';
  if (m.includes('rate limit')) return 'Too many attempts. Try again in a moment.';
  return message;
}

interface ProfileRow {
  id: string;
  name: string;
  email: string;
  role: Client['role'];
  tenant_id: string | null;
  active_program_id: string | null;
}

/** Fetch the public.profiles row for the given auth user and convert it to
 *  the Client shape the rest of the app expects. Returns null on error. */
async function loadProfile(userId: string, fallbackEmail: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, role, tenant_id, active_program_id')
    .eq('id', userId)
    .single<ProfileRow>();
  if (error) {
    console.error('[IronTrack auth] failed to load profile', error);
    return null;
  }
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    email: data.email ?? fallbackEmail,
    role: data.role,
    tenantId: data.tenant_id ?? undefined,
    activeProgramId: data.active_program_id ?? undefined,
    // programs[] is owned by useProgramData (still localStorage in Phase 2).
    // The cloud-database migration of programs lands in Phase 3.
    programs: [],
  };
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>(() => ({
    authenticatedUser: null,
    view: initialViewFromUrl('landing'),
    loginError: '',
    impersonating: null,
    isLoading: true,
  }));

  // ─── Session bootstrap + onAuthStateChange ─────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;

      if (session?.user) {
        const profile = await loadProfile(session.user.id, session.user.email ?? '');
        if (cancelled) return;
        if (profile) {
          setState((prev) => ({
            ...prev,
            authenticatedUser: profile,
            // If the URL forced 'signup', honour it (user clicked an invite while
            // already authenticated). Otherwise use the role-default.
            view: prev.view === 'signup' ? prev.view : viewForRole(profile.role),
            isLoading: false,
          }));
          return;
        }
      }
      setState((prev) => ({ ...prev, isLoading: false }));
    }
    bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (cancelled) return;
        if (event === 'SIGNED_OUT' || !session?.user) {
          setState({
            authenticatedUser: null,
            view: 'landing',
            loginError: '',
            impersonating: null,
            isLoading: false,
          });
          return;
        }
        // SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY
        const profile = await loadProfile(session.user.id, session.user.email ?? '');
        if (cancelled) return;
        if (!profile) {
          // Auth session exists but profile is missing — treat as logged out
          // so the UI doesn't render against a half-initialised user.
          setState((prev) => ({
            ...prev,
            authenticatedUser: null,
            isLoading: false,
            loginError: 'Your account is missing a profile. Please contact your coach.',
          }));
          return;
        }
        setState((prev) => ({
          ...prev,
          authenticatedUser: profile,
          // Pick a view if we don't have one yet; otherwise leave alone so the
          // user stays on the page they were on (e.g. mid-navigation).
          view: prev.authenticatedUser ? prev.view : viewForRole(profile.role),
          loginError: '',
          isLoading: false,
        }));
      },
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // ─── Auth actions ──────────────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string) => {
    // Clear any stale error from a previous attempt
    setState((prev) => ({ ...prev, loginError: '' }));
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: password.trim(),
    });
    if (error) {
      console.error('[IronTrack auth] sign-in failed', error);
      setState((prev) => ({ ...prev, loginError: mapAuthError(error.message) }));
      return;
    }
    // onAuthStateChange will hydrate authenticatedUser + view.
  }, []);

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[IronTrack auth] sign-out failed', error);
    }
    // onAuthStateChange will reset state.
  }, []);

  const setView = useCallback((view: AppView) => {
    setState((prev) => ({ ...prev, view }));
  }, []);

  const impersonate = useCallback((coach: Client) => {
    setState((prev) => ({
      ...prev,
      impersonating: prev.authenticatedUser,
      authenticatedUser: coach,
      view: 'coach',
    }));
  }, []);

  const stopImpersonating = useCallback(() => {
    setState((prev) => ({
      ...prev,
      authenticatedUser: prev.impersonating,
      impersonating: null,
      view: 'superadmin',
    }));
  }, []);

  return { ...state, login, logout, setView, impersonate, stopImpersonating };
}
