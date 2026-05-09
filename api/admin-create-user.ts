/**
 * Vercel Serverless Function: POST /api/admin-create-user
 *
 * Server-side coach (admin) creation. The browser cannot call
 * `supabase.auth.admin.createUser` because it requires the service-role key.
 * The superadmin UI POSTs `{ name, email, password }` here; this function
 * provisions the auth user, lets the on_auth_user_created trigger build the
 * profiles row, then patches that profile so its tenant_id points at itself
 * (a coach is the root of their own tenant).
 *
 * Auth gate:
 *   - Caller must present a valid Supabase JWT in the Authorization header
 *     (Bearer token). Missing / malformed / expired token → 401.
 *   - The token's user must have role IN ('admin','superadmin'). Trainee or
 *     unknown role → 403.
 *
 * Required Vercel env vars (NOT prefixed with VITE_ — must stay server-only):
 *   VITE_SUPABASE_URL         Project URL (re-used by the server runtime).
 *   SUPABASE_SERVICE_ROLE_KEY Service-role key. NEVER expose to the browser.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface CreateCoachPayload {
  name?: unknown;
  email?: unknown;
  password?: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function extractBearer(req: VercelRequest): string | null {
  const h = req.headers.authorization ?? req.headers.Authorization;
  const header = Array.isArray(h) ? h[0] : h;
  if (!header || typeof header !== 'string') return null;
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Validate the bearer token and confirm the caller is an admin or superadmin.
 * Returns the caller's profile row on success, a status+message on failure.
 */
async function authorizeCaller(supabase: SupabaseClient, token: string): Promise<
  | { ok: true; userId: string; role: string }
  | { ok: false; status: 401 | 403; message: string }
> {
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, message: 'Invalid or expired access token.' };
  }
  const userId = userData.user.id;
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single<{ role: string }>();
  if (profileErr || !profile) {
    return {
      ok: false,
      status: 403,
      message: 'Profile not found for the calling user.',
    };
  }
  if (profile.role !== 'admin' && profile.role !== 'superadmin') {
    return {
      ok: false,
      status: 403,
      message: 'Forbidden: only admins or superadmins may create coaches.',
    };
  }
  return { ok: true, userId, role: profile.role };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[admin-create-user] missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Admin create-user is not configured.' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Auth gate ──────────────────────────────────────────────────────────
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({
      error: 'Missing or malformed Authorization header. Expected: Bearer <jwt>.',
    });
  }
  const auth = await authorizeCaller(supabase, token);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.message });
  }

  // ── Payload validation ─────────────────────────────────────────────────
  const body = (req.body ?? {}) as CreateCoachPayload;
  if (!isString(body.name) || !isString(body.email) || !isString(body.password)) {
    return res.status(400).json({ error: 'Missing or invalid fields: name, email, password' });
  }

  const name = body.name.trim();
  const email = body.email.trim().toLowerCase();
  const password = body.password.trim();

  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: 'admin' },
    });

    if (error || !data?.user) {
      console.error('[admin-create-user] createUser failed', error);
      const message = error?.message ?? 'Failed to create user.';
      return res.status(400).json({ error: message });
    }

    const userId = data.user.id;

    const { data: profile, error: updateErr } = await supabase
      .from('profiles')
      .update({ tenant_id: userId, name, role: 'admin' })
      .eq('id', userId)
      .select('id, name, email, role, tenant_id, active_program_id')
      .single();

    if (updateErr || !profile) {
      console.error('[admin-create-user] profile update failed', updateErr);
      return res.status(500).json({
        error: updateErr?.message ?? 'Auth user created but profile update failed.',
      });
    }

    return res.status(200).json({ profile });
  } catch (err) {
    console.error('[admin-create-user] unexpected failure', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
}
