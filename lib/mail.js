// Email sending. Phase 1 has no SharePoint, but still needs to email one-time codes.
//   MAIL_PROVIDER=graph   -> Microsoft 365 via Graph sendMail (needs only Mail.Send, no SharePoint access)
//   MAIL_PROVIDER=console -> prints the email to the server log. TEST ONLY - refused in Production.
import { env } from './config.js';

let tokenCache = { token: null, exp: 0 };

async function appCredential() {
  const secret = process.env.CLIENT_SECRET;
  if (secret) return { client_secret: secret };
  const { getVercelOidcToken } = await import('@vercel/oidc');
  const assertion = await getVercelOidcToken();
  if (!assertion) throw new Error('No Vercel OIDC token - enable OIDC federation for this project');
  return {
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  };
}

async function graphToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: env('CLIENT_ID'),
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
    ...(await appCredential()),
  });
  const r = await fetch(`https://login.microsoftonline.com/${env('TENANT_ID')}/oauth2/v2.0/token`, { method: 'POST', body });
  if (!r.ok) throw new Error(`Token request failed: ${r.status}`);
  const j = await r.json();
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export async function sendMail({ to, subject, html }) {
  const provider = env('MAIL_PROVIDER', 'graph');

  if (provider === 'console') {
    if (process.env.VERCEL_ENV === 'production') throw new Error('MAIL_PROVIDER=console is not allowed in production');
    console.log(JSON.stringify({ devMail: { to, subject, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() } }));
    return;
  }

  const token = await graphToken();
  const sender = env('MAIL_SENDER');
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    }),
  });
  if (!r.ok) throw new Error(`sendMail failed: ${r.status}`);
}

/** Sends without failing the caller (for notifications). */
export async function sendMailSafe(msg, context = {}) {
  try {
    await sendMail(msg);
  } catch (e) {
    console.error(JSON.stringify({ error: 'mail failed', ...context, detail: e.message }));
  }
}

export function layout(inner) {
  return `<div style="font-family:Tahoma,Arial,sans-serif;font-size:15px;color:#16202b;line-height:1.6">${inner}
  <p style="color:#888;font-size:13px">อีเมลนี้ส่งอัตโนมัติ กรุณาอย่าตอบกลับ</p></div>`;
}
