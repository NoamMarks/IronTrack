/**
 * Vercel Serverless Function: POST /api/signup-user
 *
 * Self-service trainee signup, idempotent post-OTP.
 *
 * Flow background:
 *   The browser kicks off signup via supabase.auth.signInWithOtp({ email,
 *   options: { shouldCreateUser: true } }), which creates the auth user
 *   right away (passwordless) and emails a 6-digit OTP. After the trainee
 *   types the code, supabase.auth.verifyOtp confirms the email and signs
 *   them in, then the browser sets the password via
 *   supabase.auth.updateUser({ password }).
 *
 *   By the time this endpoint is hit the user already exists in auth.users.
 *   Our job is to (a) re-verify the invite server-side so a malicious
 *   client can't bypass the gate, (b) write the trainee's role + tenant
 *   onto user_metadata, and (c) ensure the matching profiles row carries
 *   the same name / role / tenant_id. We keep a "create new user" fallback
 *   for callers that hit this endpoint outside the OTP flow (legacy
 *   tooling, future server-side scripts).
 *
 * Server-side invite verification:
 *   The caller passes BOTH `tenantId` and `inviteCode`. Before touching
 *   auth.users we look up invite_codes by code and assert (a) it exists,
 *   (b) tenant_id matches the requested tenantId, (c) it is not exhausted.
 *   Without this gate any unauthenticated client could mint trainees in
 *   arbitrary tenants by guessing tenant uuids — an authentication-free
 *   privilege escalation.
 *
 * Required Vercel env vars (server-only — no VITE_ prefix on the secret):
 *   VITE_SUPABASE_URL          Project URL (also used by the browser bundle).
 *   SUPABASE_SERVICE_ROLE_KEY  Service-role key. NEVER expose to the browser.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

interface SignupPayload {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  tenantId?: unknown;
  inviteCode?: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function normalizeInviteCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/**
 * Find an auth user by their email. Supabase v2 has no `getUserByEmail`,
 * so we paginate through `admin.listUsers`. Capped at 10 pages × 1000 to
 * avoid runaway loops on a project with surprising user counts. Once the
 * project outgrows ~10k users this should be replaced with a direct SQL
 * query against `auth.users` (still via the service-role client).
 */
async function findUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<User | null> {
  const PER_PAGE = 1000;
  const MAX_PAGES = 10;
  const target = email.toLowerCase();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found;
    if (data.users.length < PER_PAGE) return null;
  }
  return null;
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
    console.error('[signup-user] missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Signup is not configured.' });
  }

  const body = (req.body ?? {}) as SignupPayload;
  if (
    !isString(body.name) ||
    !isString(body.email) ||
    !isString(body.password) ||
    !isString(body.tenantId) ||
    !isString(body.inviteCode)
  ) {
    return res.status(400).json({
      error: 'Missing or invalid fields: name, email, password, tenantId, inviteCode',
    });
  }

  const name = body.name.trim();
  const email = body.email.trim().toLowerCase();
  const password = body.password;
  const tenantId = body.tenantId.trim();
  const inviteCode = normalizeInviteCode(body.inviteCode);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Server-side invite verification ────────────────────────────────────
  const { data: invite, error: inviteErr } = await supabase
    .from('invite_codes')
    .select('id, tenant_id, max_uses, use_count')
    .eq('code', inviteCode)
    .maybeSingle<{ id: string; tenant_id: string; max_uses: number | null; use_count: number | null }>();

  if (inviteErr) {
    console.error('[signup-user] invite lookup failed', inviteErr);
    return res.status(500).json({ error: 'Could not verify invite.' });
  }
  if (!invite) {
    return res.status(400).json({ error: 'Invalid invite code.' });
  }
  if (invite.tenant_id !== tenantId) {
    console.warn('[signup-user] invite tenant mismatch', {
      inviteId: invite.id,
      requestedTenantId: tenantId,
    });
    return res.status(400).json({ error: 'Invalid invite code.' });
  }
  if (
    invite.max_uses != null &&
    invite.max_uses > 0 &&
    (invite.use_count ?? 0) >= invite.max_uses
  ) {
    return res.status(400).json({ error: 'This invite code has been used up.' });
  }

  try {
    // ── Find or create the auth user ────────────────────────────────────
    let userId: string;
    const existing = await findUserByEmail(supabase, email);

    if (existing) {
      // Common path: Supabase OTP already created the user. Push the
      // trainee's role + tenant + name onto user_metadata so any consumer
      // reading from the JWT (or admin tooling) sees consistent info. The
      // password was set client-side via supabase.auth.updateUser, so we
      // deliberately don't touch it here.
      const { error: updateErr } = await supabase.auth.admin.updateUserById(existing.id, {
        user_metadata: { name, role: 'trainee', tenant_id: tenantId },
      });
      if (updateErr) {
        console.error('[signup-user] updateUserById failed', updateErr);
        return res.status(500).json({ error: updateErr.message });
      }
      userId = existing.id;
    } else {
      // Fallback path: caller hit this endpoint without going through the
      // browser OTP flow. Recreate the legacy create-with-email_confirm
      // shortcut so the path remains usable for server-side tooling.
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role: 'trainee', tenant_id: tenantId },
      });
      if (error || !data?.user) {
        console.error('[signup-user] createUser failed', error);
        return res.status(400).json({ error: error?.message ?? 'Failed to create user.' });
      }
      userId = data.user.id;
    }

    // ── Ensure the profiles row matches ─────────────────────────────────
    // The on_auth_user_created trigger inserts a row whenever auth.users
    // gains an entry — both signInWithOtp and admin.createUser fire it —
    // but we still write tenant_id / role / name explicitly because some
    // triggers don't reliably copy through user_metadata. Upsert (rather
    // than update) so a missing row from a stalled trigger heals here.
    const { data: profile, error: upsertErr } = await supabase
      .from('profiles')
      .upsert(
        { id: userId, name, email, role: 'trainee', tenant_id: tenantId },
        { onConflict: 'id' },
      )
      .select('id, name, email, role, tenant_id, active_program_id')
      .single();

    if (upsertErr || !profile) {
      console.error('[signup-user] profile upsert failed', upsertErr);
      return res.status(500).json({
        error: upsertErr?.message ?? 'Auth user ready but profile write failed.',
      });
    }

    return res.status(200).json({ profile });
  } catch (err) {
    console.error('[signup-user] unexpected failure', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
}
