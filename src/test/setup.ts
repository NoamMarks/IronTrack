/* eslint-disable @typescript-eslint/no-explicit-any */
import '@testing-library/jest-dom';
import { vi } from 'vitest';

/**
 * Global Supabase client stub.
 *
 * Phase-2 auth migration moved useAuth and the auth pages onto supabase-js.
 * Almost every test file transitively imports the supabase client (via
 * useAuth, App, SignupPage, ForgotPasswordPage). This vi.mock keeps those
 * imports inert so tests don't try to make network calls or throw on
 * missing env vars.
 *
 * Tests that need specific Supabase behaviour can override per-file with
 * their own vi.mock('../lib/supabase', ...) — that file-level mock takes
 * precedence over this default.
 */
vi.mock('../lib/supabase', () => createSupabaseStub());

function createSupabaseStub() {
  const subscription = { unsubscribe: vi.fn() };
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription } })),
    signInWithPassword: vi.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    }),
    signUp: vi.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
  };

  // Generic chainable PostgrestQueryBuilder. Each modifier returns the same
  // object so chains like .from('x').select().eq('id', '1').single() work.
  // Awaiting the chain resolves to { data: null, error: null } by default —
  // tests can override individual methods (e.g. .single = vi.fn().mockResolvedValue(...))
  // when they care about a specific result.
  const buildQuery = (): any => {
    const builder: any = {
      select: vi.fn(() => builder),
      insert: vi.fn(() => builder),
      update: vi.fn(() => builder),
      upsert: vi.fn(() => builder),
      delete: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      neq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: (onFulfilled: any, onRejected?: any) =>
        Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected),
    };
    return builder;
  };

  return {
    supabase: {
      auth,
      from: vi.fn(buildQuery),
    },
  };
}
