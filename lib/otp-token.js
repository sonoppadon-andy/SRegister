// Stateless one-time code: no database.
// The server signs a "challenge" (email, expiry, nonce, keyed hash of the code) and gives it to the browser.
// The code itself is only in the email. The browser sends challenge + code back; the server checks the signature.
// Without the server secret (OTP_PEPPER) a challenge cannot be forged and the code cannot be guessed offline.
import crypto from 'node:crypto';
import { env } from './config.js';

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const fromB64 = (s) => Buffer.from(s, 'base64url');

function secret() {
  const s = env('OTP_PEPPER');
  if (s.length < 32) throw new Error('OTP_PEPPER must be at least 32 characters');
  return s;
}

const mac = (data) => crypto.createHmac('sha256', secret()).update(data).digest();
const codeHash = (nonce, email, code, purpose) => b64(mac(`code:${purpose}:${nonce}:${email}:${code}`));
export const PURPOSES = ['login', 'register'];

export const ttlMinutes = () => Number(env('OTP_TTL_MINUTES', '10'));

export function newCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function createChallenge(email, code, purpose = 'login') {
  if (!PURPOSES.includes(purpose)) throw new Error('invalid purpose');
  const nonce = b64(crypto.randomBytes(16));
  const exp = Date.now() + ttlMinutes() * 60_000;
  const payload = b64(JSON.stringify({ v: 1, p: purpose, e: email, n: nonce, x: exp, h: codeHash(nonce, email, code, purpose) }));
  return { challenge: `${payload}.${b64(mac(`challenge:${payload}`))}`, expiresAt: new Date(exp).toISOString() };
}

/** Returns { ok, email, nonce, reason } */
export function checkChallenge(challenge, code, expectedPurpose = 'login') {
  const [payload, sig] = String(challenge || '').split('.');
  if (!payload || !sig || challenge.length > 1000) return { ok: false, reason: 'malformed' };

  const expected = mac(`challenge:${payload}`);
  const given = fromB64(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' };

  let p;
  try { p = JSON.parse(fromB64(payload).toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (p.v !== 1 || !p.e || !p.n || !p.h) return { ok: false, reason: 'malformed' };
  if (p.p !== expectedPurpose) return { ok: false, reason: 'wrong-purpose' };
  if (Date.now() > p.x) return { ok: false, reason: 'expired', email: p.e, nonce: p.n };
  if (!/^\d{6}$/.test(String(code || ''))) return { ok: false, reason: 'invalid', email: p.e, nonce: p.n };

  const a = fromB64(p.h);
  const b = fromB64(codeHash(p.n, p.e, code, p.p));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid', email: p.e, nonce: p.n };
  return { ok: true, email: p.e, nonce: p.n };
}
