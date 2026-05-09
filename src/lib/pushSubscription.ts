import { supabase } from './supabase';

/**
 * Opt the calling user into Web Push notifications.
 *
 * Order of operations:
 *   1. Bail early if the VAPID public key is missing or the runtime lacks
 *      ServiceWorker / PushManager (Capacitor WebView, older browsers).
 *   2. Prompt for Notification permission. A "denied" result is sticky
 *      across sessions — the only recovery is the user re-enabling it in
 *      browser settings, so we surface the false return value to callers
 *      and let them render an explanatory hint.
 *   3. Reuse an existing PushSubscription if one is already pinned to this
 *      browser, otherwise call PushManager.subscribe with the VAPID key.
 *   4. Persist the JSON-serialised subscription on the user's profile row
 *      so the server-side push handler can target this device.
 *
 * Returns `true` when the subscription is registered AND persisted, `false`
 * for any failure mode (unsupported, denied, network error). Callers
 * should not throw — degrade gracefully.
 */
export async function subscribeToPush(userId: string): Promise<boolean> {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    // The modern Uint8Array type carries an ArrayBufferLike type parameter
    // (which includes SharedArrayBuffer); applicationServerKey wants
    // ArrayBufferView<ArrayBuffer>. The runtime value is a real ArrayBuffer,
    // so cast to BufferSource to satisfy the structural check.
    applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
  });

  const { error } = await supabase
    .from('profiles')
    .update({ push_subscription: sub.toJSON() })
    .eq('id', userId);

  return !error;
}

/**
 * Tear down the active subscription. Calls both PushManager.unsubscribe
 * (so the browser stops accepting deliveries) AND clears the column on
 * the profile row (so the server stops trying to send). Either side
 * failing leaves the system in a recoverable state — re-running this
 * function is safe.
 */
export async function unsubscribeFromPush(userId: string): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  await sub?.unsubscribe();
  await supabase.from('profiles').update({ push_subscription: null }).eq('id', userId);
}

/**
 * Convert a VAPID public key from base64url (the format the spec uses)
 * into the Uint8Array that PushManager.subscribe expects. The key is a
 * 65-byte uncompressed P-256 point; we just need its byte representation,
 * not any crypto interpretation.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
