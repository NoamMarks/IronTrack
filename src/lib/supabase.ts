/**
 * Supabase client singleton.
 *
 * Both env vars MUST be present in the build environment — Vite inlines them
 * at build time when prefixed with `VITE_`. Set them locally in `.env` and on
 * Vercel under Settings → Environment Variables.
 *
 *   VITE_SUPABASE_URL        Project URL, e.g. https://xxxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY   The "anon / public" key (NOT the service-role key)
 *
 * The anon key is safe in the client bundle — it has no privileges of its own;
 * Row-Level Security policies in the database control what each authenticated
 * user can read or write. The service-role key MUST NEVER reach the browser.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Detect the auth callback URL hash on page load (e.g. for magic-link
    // confirmations) without requiring extra wiring.
    detectSessionInUrl: true,
  },
});
