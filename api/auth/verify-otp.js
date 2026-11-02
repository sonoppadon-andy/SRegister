import { handle, json, requirePostJson, normEmail, clientIp } from '../../lib/http.js';
import { rateLimit } from '../../lib/store.js';
import { checkOtp, OTP_MESSAGES } from '../../lib/otp.js';
import { resolveAccount, canLogin } from '../../lib/users.js';
import { createSession } from '../../lib/session.js';
import { audit } from '../../lib/audit.js';

export default handle(async (req, res) => {
  if (!requirePostJson(req, res)) return;
  const email = normEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  const ip = clientIp(req);
  if (!email) return json(res, 400, { error: OTP_MESSAGES.expired });
  if (!(await rateLimit(`rl:verify:ip:${ip}`, 30, 900))) return json(res, 429, { error: 'ลองหลายครั้งเกินไป กรุณารอ 15 นาที' });

  const result = await checkOtp('login', email, code);
  if (result !== 'ok') {
    await audit('login_failed', { email, ip, reason: result });
    return json(res, 401, { error: OTP_MESSAGES[result] });
  }
  const acc = await resolveAccount(email);
  if (!canLogin(acc)) {
    await audit('login_failed', { email, ip, reason: 'not_allowed' });
    return json(res, 401, { error: OTP_MESSAGES.expired });
  }
  await createSession(res, email);
  await audit('login_success', { email, ip, status: acc.status });
  return json(res, 200, { ok: true, status: acc.status });
});
