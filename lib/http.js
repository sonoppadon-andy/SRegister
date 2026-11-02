import { getSessionEmail, destroySession } from './session.js';
import { resolveAccount, canLogin, canClaim } from './users.js';

export function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

export function normEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  return s.length <= 254 && /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

export const clip = (v, n) => String(v ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, n);

export function requirePostJson(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return false;
  }
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    json(res, 415, { error: 'Unsupported content type' });
    return false;
  }
  return true;
}

/**
 * Loads the logged-in account and enforces access on EVERY request.
 *   approved: true -> must be approved by admin (and not expired) with at least one project
 *   admin: true    -> must be listed in ADMIN_EMAILS
 */
export async function requireAccount(req, res, { approved = false, admin = false } = {}) {
  const email = await getSessionEmail(req);
  if (!email) {
    json(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
    return null;
  }
  const acc = await resolveAccount(email);
  if (!canLogin(acc)) {
    await destroySession(req, res);
    json(res, 401, { error: 'บัญชีของคุณถูกระงับหรือหมดอายุ กรุณาติดต่อ Admin' });
    return null;
  }
  if (admin && !acc.isAdmin) {
    json(res, 403, { error: 'เฉพาะ Admin เท่านั้น' });
    return null;
  }
  if (approved && !canClaim(acc)) {
    json(res, 403, { error: 'บัญชีของคุณยังไม่ได้รับการอนุมัติ จึงยังใช้งานส่วนนี้ไม่ได้', status: acc.status });
    return null;
  }
  return acc;
}

export function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(JSON.stringify({ error: e.message, path: req.url }));
      if (!res.headersSent) json(res, 500, { error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ หากยังไม่ได้ให้แจ้ง IT' });
    }
  };
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));
