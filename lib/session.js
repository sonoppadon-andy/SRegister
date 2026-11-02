import crypto from 'node:crypto';
import { env } from './config.js';
import { redis } from './store.js';

const COOKIE = '__Host-sid';
const sidKey = (sid) => `sess:${crypto.createHash('sha256').update(sid).digest('hex')}`;

function readSid(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

export async function createSession(res, email) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const maxAge = Number(env('SESSION_HOURS', '8')) * 3600;
  await redis.set(sidKey(sid), email, { ex: maxAge });
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
  );
}

export async function getSessionEmail(req) {
  const sid = readSid(req);
  if (!sid) return null;
  return (await redis.get(sidKey(sid))) || null;
}

export async function destroySession(req, res) {
  const sid = readSid(req);
  if (sid) await redis.del(sidKey(sid));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
