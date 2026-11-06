import { handle, json, requirePostJson, normEmail, clientIp, log } from '../../lib/http.js';
import { hit } from '../../lib/memlimit.js';
import { verifyCaptcha, CAPTCHA_FAILED } from '../../lib/captcha.js';
import { newCode, createChallenge, ttlMinutes } from '../../lib/otp-token.js';
import { sendMail, layout } from '../../lib/mail.js';
import { appName, env } from '../../lib/config.js';

/** Optional allow-list for the test period, e.g. "singhaestate.co.th" */
function domainAllowed(email) {
  const list = env('ALLOWED_EMAIL_DOMAINS', '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !list.length || list.includes(email.split('@')[1]);
}

export default handle(async (req, res) => {
  if (!requirePostJson(req, res)) return;
  const email = normEmail(req.body?.email);
  const ip = clientIp(req);
  if (!email) return json(res, 400, { error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
  if (!domainAllowed(email)) {
    log('otp_domain_blocked', { email, ip });
    return json(res, 400, { error: 'ช่วงทดสอบนี้ส่งรหัสได้เฉพาะอีเมลที่ได้รับอนุญาตเท่านั้น' });
  }

  if (!hit(`ip:${ip}`, 10, 900) || !hit(`em:${email}`, 3, 900)) {
    log('otp_rate_limited', { email, ip });
    return json(res, 429, { error: 'ขอรหัสบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' });
  }

  const captcha = await verifyCaptcha(req.body?.captchaToken, ip, 'otp');
  if (!captcha.ok) {
    log('captcha_failed', { email, ip, reason: captcha.reason });
    return json(res, 400, { error: CAPTCHA_FAILED });
  }

  const code = newCode();
  const { challenge, expiresAt } = createChallenge(email, code);
  await sendMail({
    to: [email],
    subject: `รหัสยืนยันอีเมล ${appName()}`,
    html: layout(`<p>รหัสยืนยันอีเมลของคุณคือ</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
      <p>รหัสนี้หมดอายุใน ${ttlMinutes()} นาที</p>
      <p style="color:#5b6672">ห้ามบอกรหัสนี้กับผู้อื่น เจ้าหน้าที่จะไม่ขอรหัสนี้จากคุณ<br>
      ถ้าคุณไม่ได้ทำรายการนี้ ให้เพิกเฉยต่ออีเมลนี้</p>`),
  });
  log('otp_sent', { email, ip });
  return json(res, 200, { ok: true, challenge, expiresAt, message: `ส่งรหัส 6 หลักไปที่ ${email} แล้ว` });
});
