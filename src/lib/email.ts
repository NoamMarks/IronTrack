/**
 * Email Service — frontend client for the /api/send-email Vercel function.
 *
 * The Resend API key lives strictly on the server (process.env.RESEND_API_KEY,
 * NOT prefixed with VITE_). The browser only knows how to POST to /api/send-email
 * with the rendered HTML; it never holds a secret.
 *
 * Failsafe: in dev (or any environment where the API call fails — e.g. local
 * `vite` without `vercel dev`), the OTP is also logged to the console so the
 * signup/reset flow is never blocked during development.
 */

// ─── HTML Template ──────────────────────────────────────────────────────────

function buildEmailHtml(code: string, purpose: 'signup' | 'reset'): string {
  const title = purpose === 'signup' ? 'Verify Your Email' : 'Password Reset';
  const subtitle = purpose === 'signup'
    ? 'Enter this code to complete your IronTrack registration.'
    : 'Enter this code to reset your IronTrack password.';
  const footer = purpose === 'signup'
    ? 'If you didn\'t create an account, you can safely ignore this email.'
    : 'If you didn\'t request a password reset, you can safely ignore this email. This code expires in 10 minutes.';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" style="max-width:480px;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="display:inline-block;background:#fff;width:40px;height:40px;line-height:40px;text-align:center;font-weight:900;font-size:18px;color:#0a0a0a;">
                IT
              </div>
              <span style="display:block;color:#fff;font-size:14px;font-weight:700;letter-spacing:4px;text-transform:uppercase;font-family:'Courier New',monospace;margin-top:8px;">
                IRONTRACK
              </span>
            </td>
          </tr>
          <!-- Title -->
          <tr>
            <td align="center" style="padding-bottom:8px;">
              <h1 style="color:#ffffff;font-size:28px;font-weight:700;margin:0;font-style:italic;letter-spacing:-0.5px;">
                ${title}
              </h1>
            </td>
          </tr>
          <!-- Subtitle -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <p style="color:#a1a1aa;font-size:12px;font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:2px;margin:0;">
                ${subtitle}
              </p>
            </td>
          </tr>
          <!-- Code box -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="background:#141414;border:1px solid #27272a;padding:24px 40px;display:inline-block;">
                <span style="font-family:'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:12px;color:#22c55e;">
                  ${code}
                </span>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="border-top:1px solid #27272a;padding-top:24px;">
              <p style="color:#52525b;font-size:11px;font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:1px;margin:0;line-height:1.6;">
                ${footer}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── POST to /api/send-email ────────────────────────────────────────────────

/**
 * Live-delivery kill-switch. Flip back to `true` to skip the network call
 * entirely and rely on the logOtpFallback console output — useful when
 * Resend domain verification lapses, the API key is rotated/missing, or a
 * developer is running locally without `vercel dev`. Independent of this
 * flag, the API-failure path in sendVerificationEmailViaResend /
 * sendPasswordResetEmailViaResend already falls back to a console log when
 * /api/send-email returns non-OK, so a missing `RESEND_API_KEY` (which
 * yields a 500) keeps the signup / reset flows usable.
 */
const EMAIL_CONSOLE_ONLY = false;

async function sendViaApi(to: string, subject: string, html: string): Promise<boolean> {
  if (EMAIL_CONSOLE_ONLY) {
    // Skip the network call entirely — the OTP has already been printed to
    // the console by logOtpFallback. Return false so the caller's fallback
    // path (when DEV is false) still triggers, though in practice this flag
    // is only used while DEV-style console delivery is the desired UX.
    return false;
  }
  if (typeof fetch === 'undefined') return false;
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[IronTrack Email] API responded', res.status, text);
      return false;
    }
    console.log(`%c[IronTrack Email] Sent to ${to}`, 'color: #22c55e; font-weight: bold;');
    return true;
  } catch (err) {
    console.warn('[IronTrack Email] Network/API error:', err);
    return false;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * In dev / test (`import.meta.env.DEV === true`), always log the OTP to the
 * console synchronously BEFORE attempting the API call. This guarantees the
 * code is visible in local browser devtools and stays available to test
 * console.log spies that don't await microtasks. In production we only fall
 * back to console logging if the API call actually failed.
 */
function logOtpFallback(prefix: string, email: string, code: string): void {
  const style = 'color: #22c55e; font-weight: bold; font-size: 14px;';
  console.log(`%c${prefix} Code for ${email}: ${code}`, style);
}

export async function sendVerificationEmailViaResend(email: string, code: string): Promise<void> {
  if (import.meta.env.DEV) {
    logOtpFallback('[IronTrack Verification]', email, code);
  }
  const html = buildEmailHtml(code, 'signup');
  const sent = await sendViaApi(email, 'IronTrack — Verify Your Email', html);
  if (!sent && !import.meta.env.DEV) {
    logOtpFallback('[IronTrack Verification]', email, code);
  }
}

export async function sendPasswordResetEmailViaResend(email: string, code: string): Promise<void> {
  if (import.meta.env.DEV) {
    logOtpFallback('[PASSWORD RESET CODE]', email, code);
  }
  const html = buildEmailHtml(code, 'reset');
  const sent = await sendViaApi(email, 'IronTrack — Password Reset Code', html);
  if (!sent && !import.meta.env.DEV) {
    logOtpFallback('[PASSWORD RESET CODE]', email, code);
  }
}
