/**
 * Vercel Serverless Function: POST /api/send-email
 *
 * Server-side mailroom for IronTrack. The frontend POSTs `{ to, subject, html }`
 * here and this function relays it through Resend using a strictly server-side
 * `RESEND_API_KEY` (NOT prefixed with VITE_, so the secret never reaches the
 * client bundle).
 *
 * Configure on Vercel → Settings → Environment Variables:
 *   RESEND_API_KEY = re_xxxxxxxxxxxxxxxxxxx
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

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
