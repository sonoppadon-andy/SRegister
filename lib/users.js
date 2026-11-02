// Phase 1 user store (Upstash Redis). Phase 2 can replace this module with SharePoint.
import { redis } from './store.js';
import { env } from './config.js';

export const STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected', SUSPENDED: 'suspended' };
const K = (email) => `user:${email}`;

export const adminEmails = () =>
  env('ADMIN_EMAILS', '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdminEmail = (email) => adminEmails().includes(email);

export async function getUser(email) {
  const raw = await redis.get(K(email));
  return raw ? JSON.parse(raw) : null;
}

export async function saveUser(user) {
  user.updatedAt = new Date().toISOString();
  await redis.set(K(user.email), JSON.stringify(user));
  await redis.sadd('users:all', user.email);
  return user;
}

export async function listUsers() {
  const emails = await redis.smembers('users:all');
  if (!emails.length) return [];
  const raws = await redis.mget(...emails.map(K));
  return raws.filter(Boolean).map((r) => JSON.parse(r));
}

export function isExpired(user) {
  if (!user.expiry) return false;
  return new Date(`${user.expiry}T23:59:59+07:00`).getTime() < Date.now();
}

/** Account as seen by the app. Admins (ADMIN_EMAILS) get a record on first login. */
export async function resolveAccount(email) {
  let user = await getUser(email);
  const isAdmin = isAdminEmail(email);
  if (!user && isAdmin) {
    user = await saveUser({
      email, name: '', company: '', phone: '', status: STATUS.APPROVED, projects: [],
      createdAt: new Date().toISOString(), source: 'admin-bootstrap',
    });
  }
  if (!user) return null;
  let status = user.status;
  if (status === STATUS.APPROVED && isExpired(user)) status = 'expired';
  return { ...user, status, isAdmin };
}

/** Pending users may log in (to see "waiting for approval"); rejected/suspended/expired may not. */
export const canLogin = (acc) => !!acc && (acc.isAdmin || acc.status === STATUS.PENDING || acc.status === STATUS.APPROVED);
export const canClaim = (acc) => !!acc && acc.status === STATUS.APPROVED && Array.isArray(acc.projects) && acc.projects.length > 0;
