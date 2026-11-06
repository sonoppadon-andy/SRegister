import { handle, json, requirePostJson, clientIp, log } from '../../lib/http.js';
import { hit } from '../../lib/memlimit.js';
import { checkChallenge } from '../../lib/otp-token.js';

// Best-effort (per instance): attempts per challenge and challenges already used.
const used = new Map();

const MESSAGES = {
  expired: 'รหัสหมดอายุ กรุณาขอรหัสใหม่',
  invalid: 'รหัสไม่ถูกต้อง ตรวจสอบรหัสในอีเมลแล้วลองอีกครั้ง',
  locked: 'กรอกรหัสผิดหลายครั้ง กรุณาขอรหัสใหม่',
  used: 'รหัสนี้ถูกใช้แล้ว กรุณาขอรหัสใหม่',
  default: 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่',
};

export default handle(async (req, res) => {
  if (!requirePostJson(req, res)) return;
  const ip = clientIp(req);
  if (!hit(`verify-ip:${ip}`, 30, 900)) return json(res, 429, { error: 'ลองหลายครั้งเกินไป กรุณารอ 15 นาที' });

  const challenge = String(req.body?.challenge || '');
  const code = String(req.body?.code || '').trim();
  const nonce = challenge.split('.')[0].slice(-40);

  if (used.has(nonce)) return json(res, 401, { error: MESSAGES.used });
  if (!hit(`verify-ch:${nonce}`, 5, 900)) {
    log('otp_failed', { ip, reason: 'locked' });
    return json(res, 401, { error: MESSAGES.locked });
  }

  const r = checkChallenge(challenge, code);
  if (!r.ok) {
    log('otp_failed', { ip, email: r.email, reason: r.reason });
    return json(res, 401, { error: MESSAGES[r.reason] || MESSAGES.default });
  }

  if (used.size > 5000) for (const [k, t] of used) if (t < Date.now()) used.delete(k);
  used.set(nonce, Date.now() + 3600_000);
  log('otp_verified', { ip, email: r.email });
  return json(res, 200, { ok: true, email: r.email });
});
