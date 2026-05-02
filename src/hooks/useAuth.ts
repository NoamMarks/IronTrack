import { useState, useCallback, useEffect, useRef } from 'react';
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

/** Magic-link URL detection: an invite query param OR a /signup deep-link
 *  pathname both mean "the user clicked an invite — land on the signup
 *  form regardless of any pre-existing session". Centralised so the initial
 *  state seed AND the bootstrap success path can both consult it without
 *  coupling to each other. SSR-safe via the typeof window guard. */
function urlHasInvite(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.search.includes('invite=') ||
    window.location.pathname.startsWith('/signup')
  );
}

function initialViewFromUrl(fallback: AppView): AppView {
  return urlHasInvite() ? 'signup' : fallback;
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

  // Tracks the auth.user.id we've already hydrated a profile for. supabase-js
  // fires INITIAL_SESSION synchronously after subscribe(), then TOKEN_REFRESHED
  // every hour, USER_UPDATED on metadata changes, etc. — all carrying the same
  // user id. Without this guard, every event would re-fetch the profile and
  // re-setState, which is the trigger for the observed render loop.
  const currentUserIdRef = useRef<string | null>(null);

  // ─── Session bootstrap + onAuthStateChange ─────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // try/catch/finally so a thrown getSession (network failure, corrupt
      // localStorage session blob, RLS rejection on the profile fetch, etc.)
      // can never leave the UI stuck on "INITIALIZING...". The finally branch
      // is the load-bearing line: it ALWAYS clears isLoading.
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (error) throw error;

        if (session?.user) {
          const profile = await loadProfile(session.user.id, session.user.email ?? '');
          if (cancelled) return;
          if (profile) {
            // Record the bootstrap-loaded user id so the INITIAL_SESSION
            // event (which carries the same session) sees a cache hit and
            // skips a duplicate loadProfile + setState.
            currentUserIdRef.current = profile.id;
            // Invite links must ALWAYS route to /signup, even when a stale
            // session is hydrated from localStorage — the click is an explicit
            // signal that the user intends to create a NEW account, and we
            // must not silently log them in as someone else's residual
            // session. Re-read the URL here rather than trusting prev.view,
            // which can be perturbed by other initialisation paths.
            const inviteOverride = urlHasInvite();
            setState((prev) => ({
              ...prev,
              authenticatedUser: profile,
              view: inviteOverride ? 'signup' : viewForRole(profile.role),
            }));
          }
        }
      } catch (err) {
        console.error('[IronTrack auth] bootstrap failed', err);
      } finally {
        if (!cancelled) {
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    }
    bootstrap();

    // The actual handler runs OUTSIDE the supabase-js auth lock. The listener
    // body itself is sync (returns immediately) and defers the async work
    // through setTimeout. Why: supabase-js v2 calls _notifyAllSubscribers
    // while still holding its internal auth lock, and awaits each callback.
    // If our callback awaits a Supabase REST call (loadProfile), that REST
    // call's getSession() re-enters the same lock and deadlocks. The
    // setTimeout(0) trampoline lets _notifyAllSubscribers return, releasing
    // the lock, before our async work fires.
    const handleAuthStateChange = async (
      event: string,
      session: { user: { id: string; email?: string } } | null,
    ) => {
      if (cancelled) return;
      try {
        const incomingUserId = session?.user?.id ?? null;
        const previousUserId = currentUserIdRef.current;

        // ── Strict identity guard ───────────────────────────────────────
        if (incomingUserId !== null && incomingUserId === previousUserId) {
          return;
        }

        if (event === 'SIGNED_OUT' || !session?.user) {
          currentUserIdRef.current = null;
          const nextView: AppView = urlHasInvite() ? 'signup' : 'landing';
          setState((prev) => {
            if (
              prev.authenticatedUser === null &&
              prev.impersonating === null &&
              prev.loginError === '' &&
              prev.view === nextView &&
              !prev.isLoading
            ) {
              return prev;
            }
            return {
              authenticatedUser: null,
              view: nextView,
              loginError: '',
              impersonating: null,
              isLoading: false,
            };
          });
          return;
        }

        const profile = await loadProfile(session.user.id, session.user.email ?? '');
        if (cancelled) return;
        if (!profile) {
          currentUserIdRef.current = null;
          setState((prev) => ({
            ...prev,
            authenticatedUser: null,
            loginError: 'Your account is missing a profile. Please contact your coach.',
          }));
          return;
        }
        currentUserIdRef.current = profile.id;
        setState((prev) => ({
          ...prev,
          authenticatedUser: profile,
          view: prev.authenticatedUser ? prev.view : viewForRole(profile.role),
          loginError: '',
        }));
      } catch (err) {
        console.error('[IronTrack auth] onAuthStateChange failure', err);
      } finally {
        if (!cancelled) {
          setState((prev) => (prev.isLoading ? { ...prev, isLoading: false } : prev));
        }
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Sync return — defer all real work outside the auth lock.
        setTimeout(() => {
          void handleAuthStateChange(event, session);
        }, 0);
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
