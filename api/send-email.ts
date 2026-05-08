/**
 * @deprecated DELETE-AFTER-VERIFICATION
 *
 * Vercel Serverless Function: POST /api/send-email
 *
 * Signup OTP delivery has migrated to Supabase Auth (Google SMTP configured
 * via the Supabase dashboard) — see `sendSupabaseOTP` in src/lib/verification.ts.
 * This endpoint and the `resend` npm dependency are no longer called by the
 * client and should be deleted once production signup is confirmed working
 * end-to-end. To remove:
 *   1. Delete this file (api/send-email.ts).
 *   2. Run `npm uninstall resend`.
 *   3. Drop `sendVerificationEmailViaResend` / `sendPasswordResetEmailViaResend`
 *      from src/lib/email.ts (and the `EMAIL_CONSOLE_ONLY` flag with them, since
 *      its only consumer was sendViaApi).
 *   4. Migrate the (currently dead) `sendPasswordResetEmail` path in
 *      src/lib/verification.ts to Supabase's native reset flow if it's ever
 *      revived — ForgotPasswordPage already uses supabase.auth.resetPasswordForEmail.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

// Resend's shared test sender. Accepted without domain verification but
// only DELIVERS to the verified owner email of the Resend account
// (resend.com/settings/emails); sends to any other recipient are rejected
// with 422, /api/send-email returns 502, and the client-side fallback
// prints the OTP to the browser console. Replace with
// `noreply@<your verified domain>` once a real domain is verified at
// resend.com/domains to enable arbitrary recipients.
const FROM_ADDRESS = 'IronTrack <onboarding@resend.dev>';

interface EmailPayload {
  to?: unknown;
  subject?: unknown;
  html?: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[send-email] RESEND_API_KEY is not configured');
    return res.status(500).json({ error: 'Email service is not configured.' });
  }

  const body = (req.body ?? {}) as EmailPayload;
  if (!isString(body.to) || !isString(body.subject) || !isString(body.html)) {
    return res.status(400).json({ error: 'Missing or invalid fields: to, subject, html' });
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [body.to],
      subject: body.subject,
      html: body.html,
    });

    if (error) {
      console.error('[send-email] Resend rejected the request', error);
      return res.status(502).json({ error: error.message ?? 'Resend error' });
    }

    return res.status(200).json({ id: data?.id ?? null });
  } catch (err) {
    console.error('[send-email] unexpected failure', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
}
