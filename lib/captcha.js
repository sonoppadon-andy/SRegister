// Cloudflare Turnstile (CAPTCHA) verification for public endpoints that send email.
// Enabled when TURNSTILE_SECRET_KEY is set. In Production it is REQUIRED (fails closed if missing),
// unless CAPTCHA_REQUIRED=false is set deliberately.
import crypto from 'node:crypto';
import { env } from './config.js';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function captchaEnabled() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY);
}

/** Returns { ok: true } or { ok: false, reason } . Never throws for a bad token; throws only for misconfiguration. */
export async function verifyCaptcha(token, ip, expectedAction) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!captchaEnabled()) {
    const required = env('CAPTCHA_REQUIRED', process.env.VERCEL_ENV === 'production' ? 'true' : 'false') === 'true';
    if (required) throw new Error('CAPTCHA is required but TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY are not set');
    return { ok: true, skipped: true };
  }
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, reason: 'missing-token' };

  const body = new URLSearchParams({ secret, response: token, idempotency_key: crypto.randomUUID() });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);

  let data;
  try {
    const r = await fetch(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { ok: false, reason: `siteverify-http-${r.status}` }; // fail closed
    data = await r.json();
  } catch (e) {
    return { ok: false, reason: `siteverify-unreachable` }; // fail closed
  }

  if (!data.success) return { ok: false, reason: (data['error-codes'] || []).join(',') || 'failed' };
  if (expectedAction && data.action && data.action !== expectedAction) return { ok: false, reason: `action-mismatch (got: ${data.action})` };
  const hosts = env('TURNSTILE_ALLOWED_HOSTNAMES', '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')) // tolerate "https://host/"
    .filter(Boolean);
  if (hosts.length && !hosts.includes(String(data.hostname || '').toLowerCase())) return { ok: false, reason: `hostname-mismatch (got: ${data.hostname}, allowed: ${hosts.join(',')})` };
  return { ok: true };
}

export const CAPTCHA_FAILED = 'การตรวจสอบความปลอดภัยไม่ผ่าน กรุณาลองใหม่อีกครั้ง';
