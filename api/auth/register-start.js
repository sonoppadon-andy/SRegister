// Step 1 of registration: collect details, email a one-time code to prove the address belongs to the user.
import { handle, json, requirePostJson, normEmail, clientIp, clip } from '../../lib/http.js';
import { rateLimit, redis } from '../../lib/store.js';
import { getUser, isAdminEmail, STATUS } from '../../lib/users.js';
import { newCode, saveOtp, otpEmailHtml } from '../../lib/otp.js';
import { sendMail, layout } from '../../lib/mail.js';
import { audit } from '../../lib/audit.js';
import { verifyCaptcha, CAPTCHA_FAILED } from '../../lib/captcha.js';
import { appName, env } from '../../lib/config.js';

const GENERIC = { ok: true, message: 'ระบบส่งรหัสยืนยันไปที่อีเมลแล้ว (ถ้าอีเมลนี้ยังไม่เคยลงทะเบียน) กรุณาตรวจสอบกล่องจดหมาย' };

export default handle(async (req, res) => {
  if (!requirePostJson(req, res)) return;
  const b = req.body || {};
  const email = normEmail(b.email);
  const data = {
    name: clip(b.name, 100),
    company: clip(b.company, 150),
    phone: clip(b.phone, 30),
    requestedProjects: clip(b.requestedProjects, 300),
    reason: clip(b.reason, 500),
  };
  if (!email) return json(res, 400, { error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
  if (!data.name || !data.company || !data.phone || !data.requestedProjects) {
    return json(res, 400, { error: 'กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ' });
  }
  if (!/^[0-9+\-\s()]{6,30}$/.test(data.phone)) return json(res, 400, { error: 'เบอร์โทรไม่ถูกต้อง' });
  if (b.consent !== true) return json(res, 400, { error: 'กรุณายอมรับการเก็บและใช้ข้อมูลส่วนบุคคล' });

  const ip = clientIp(req);
  if (!(await rateLimit(`rl:reg:ip:${ip}`, 5, 3600)) || !(await rateLimit(`rl:reg:em:${email}`, 3, 900))) {
    await audit('register_rate_limited', { email, ip });
    return json(res, 429, { error: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' });
  }

  const captcha = await verifyCaptcha(b.captchaToken, ip, 'register');
  if (!captcha.ok) {
    await audit('captcha_failed', { email, ip, action: 'register', reason: captcha.reason });
    return json(res, 400, { error: CAPTCHA_FAILED, captcha: true });
  }

  // Never reveal whether an email is already registered.
  const existing = await getUser(email);
  if (existing || isAdminEmail(email)) {
    if (!existing || existing.status === STATUS.PENDING || existing.status === STATUS.APPROVED) {
      await sendMail({
        to: [email],
        subject: `${appName()}: อีเมลนี้ลงทะเบียนไว้แล้ว`,
        html: layout('<p>มีการขอลงทะเบียนด้วยอีเมลนี้ แต่อีเมลนี้ลงทะเบียนไว้แล้ว ให้ใช้เมนู <b>เข้าสู่ระบบ</b> แทน</p><p>ถ้าคุณไม่ได้ทำรายการนี้ ให้เพิกเฉยต่ออีเมลนี้</p>'),
      });
    }
    await audit('register_duplicate', { email, ip, status: existing?.status || 'admin' });
    return json(res, 200, GENERIC);
  }

  const code = newCode();
  await saveOtp('register', email, code);
  const ttl = Number(env('OTP_TTL_MINUTES', '10')) * 60;
  await redis.set(`reg:${email}`, JSON.stringify({ ...data, consentAt: new Date().toISOString(), ip }), { ex: ttl });
  await sendMail({ to: [email], subject: `รหัสยืนยันการลงทะเบียน ${appName()}`, html: layout(otpEmailHtml(code, 'ยืนยันการลงทะเบียน')) });
  await audit('register_otp_sent', { email, ip });
  return json(res, 200, GENERIC);
});
