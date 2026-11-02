// Phase 1 claim store (Upstash Redis). Phase 2 can replace this module with a SharePoint List.
import crypto from 'node:crypto';
import { redis } from './store.js';

const K = (ref) => `claim:${ref}`;

export const bangkokDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);
export const newRef = () => `CLM-${bangkokDate().replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

export async function getClaim(ref) {
  const raw = await redis.get(K(ref));
  return raw ? JSON.parse(raw) : null;
}

export async function saveClaim(claim) {
  claim.updatedAt = new Date().toISOString();
  await redis.set(K(claim.ref), JSON.stringify(claim));
  await redis.sadd('claims:all', claim.ref);
  await redis.sadd(`claims:user:${claim.submittedBy}`, claim.ref);
  return claim;
}

async function many(refs) {
  if (!refs.length) return [];
  const raws = await redis.mget(...refs.map(K));
  return raws.filter(Boolean).map((r) => JSON.parse(r)).sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
}

export const listByUser = async (email) => many(await redis.smembers(`claims:user:${email}`));
export const listAll = async () => many(await redis.smembers('claims:all'));
