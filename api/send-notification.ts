/**
 * Vercel Serverless Function: POST /api/send-notification
 *
 * Coach-side push delivery. The browser cannot call web-push directly
 * (the VAPID private key must never reach the client bundle). The coach
 * UI POSTs `{ recipientId, message, title?, url? }` here and this function
 *   1. Validates the caller's Supabase JWT (Authorization: Bearer <token>).
 *   2. Confirms the caller is admin / superadmin.
 *   3. Loads the recipient's `profiles.push_subscription` row using the
 *      service-role client so RLS doesn't block the read.
 *   4. Enforces tenant scoping — admins can only push to trainees in their
 *      own tenant; superadmin can push to anyone.
 *   5. Delivers the payload via web-push.
 *
 * The recipient's PWA service worker (public/push-handler.js) is what
 * actually surfaces the notification — this function just hands the
 * encrypted payload to the push service.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.VITE_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: caller } = await supabase
    .from('profiles')
    .select('role, tenant_id, id')
    .eq('id', user.id)
    .single();
  if (!caller || !['admin', 'superadmin'].includes(caller.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { recipientId, message, title = 'IronTrack', url = '/' } = req.body as {
    recipientId: string;
    message: string;
    title?: string;
    url?: string;
  };
  if (!recipientId || !message) return res.status(400).json({ error: 'Missing recipientId or message' });

  const { data: recipient } = await supabase
    .from('profiles')
    .select('push_subscription, tenant_id')
    .eq('id', recipientId)
    .single();
  if (!recipient?.push_subscription) {
    return res.status(404).json({ error: 'No push subscription for this user' });
  }
  if (caller.role !== 'superadmin' && recipient.tenant_id !== caller.tenant_id) {
    return res.status(403).json({ error: 'Tenant mismatch' });
  }

  await webpush.sendNotification(
    recipient.push_subscription as webpush.PushSubscription,
    JSON.stringify({ title, body: message, url, tag: `irontrack-${recipientId}` }),
  );

  return res.status(200).json({ sent: true });
}
