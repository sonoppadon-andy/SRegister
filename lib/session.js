// Stateless login session (no database): a signed, HttpOnly cookie that holds the verified email and an expiry.
// Limitation: logout clears the cookie in this browser, but a copied cookie stays valid until it expires.
import crypto from 'node:crypto';
import { env } from './config.js';

const COOKIE = '__Host-sess';
const b64 = (buf) => Buffer.from(buf).toString('base64url');

function key() {
  const s = env('OTP_PEPPER');
  if (s.length < 32) throw new Error('OTP_PEPPER must be at least 32 characters');
  return crypto.createHmac('sha256', s).update('session-signing-key-v1').digest(); // separate key from OTP signing
}
const sign = (payload) => b64(crypto.createHmac('sha256', key()).update(`session:${payload}`).digest());
const hours = () => Number(env('SESSION_HOURS', '8'));

export function createSession(res, email) {
  const payload = b64(JSON.stringify({ v: 1, e: email, x: Date.now() + hours() * 3600_000 }));
  res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${hours() * 3600}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

/** Returns the verified email, or null. */
export function getSessionEmail(req) {
  const raw = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(sign(payload), 'base64url');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return p.v === 1 && p.e && Date.now() < p.x ? p.e : null;
  } catch {
    return null;
  }
}

const list = (name) => env(name, '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const adminEmails = () => list('ADMIN_EMAILS');
export const isAdmin = (email) => adminEmails().includes(email);
/** Preview (no database): Admin approves by adding the email to APPROVED_EMAILS in Vercel and redeploying. */
export const isApproved = (email) => isAdmin(email) || list('APPROVED_EMAILS').includes(email);
