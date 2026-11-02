import { handle, json, requirePostJson, normEmail, clientIp } from '../../lib/http.js';
import { rateLimit } from '../../lib/store.js';
import { resolveAccount, canLogin } from '../../lib/users.js';
import { newCode, saveOtp, otpEmailHtml } from '../../lib/otp.js';
import { sendMail, layout } from '../../lib/mail.js';
import { audit } from '../../lib/audit.js';
import { appName } from '../../lib/config.js';

const GENERIC = { ok: true, message: 'ถ้าอีเมลนี้ลงทะเบียนไว้แล้ว ระบบจะส่งรหัส 6 หลักไปภายใน 1–2 นาที' };

export default handle(async (req, res) => {
  if (!requirePostJson(req, res)) return;
  const email = normEmail(req.body?.email);
  if (!email) return json(res, 400, { error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
  const ip = clientIp(req);

  if (!(await rateLimit(`rl:otp:ip:${ip}`, 10, 900)) || !(await rateLimit(`rl:otp:em:${email}`, 3, 900))) {
    await audit('otp_rate_limited', { email, ip });
    return json(res, 429, { error: 'ขอรหัสบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' });
  }

  const acc = await resolveAccount(email);
  if (!canLogin(acc)) {
    await audit('otp_denied', { email, ip, status: acc?.status || 'unknown' });
    return json(res, 200, GENERIC);
  }

  const code = newCode();
  await saveOtp('login', email, code);
  await sendMail({ to: [email], subject: `รหัสเข้าสู่ระบบ ${appName()}`, html: layout(otpEmailHtml(code, 'เข้าสู่ระบบ')) });
  await audit('otp_sent', { email, ip });
  return json(res, 200, GENERIC);
});
