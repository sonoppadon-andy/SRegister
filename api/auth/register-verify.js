// Step 2 of registration: verify the code, create the account as "pending" and notify admins.
import { handle, json, requirePostJson, normEmail, clientIp, escapeHtml } from '../../lib/http.js';
import { rateLimit, redis } from '../../lib/store.js';
import { checkOtp, OTP_MESSAGES } from '../../lib/otp.js';
import { getUser, saveUser, adminEmails, STATUS } from '../../lib/users.js';
import { createSession } from '../../lib/session.js';
import { sendMailSafe, layout } from '../../lib/mail.js';
import { audit } from '../../lib/audit.js';
import { appName, env } from '../../lib/config.js';

export default handle(async (req, res) => {
  if (!requirePostJson(req, res)) return;
  const email = normEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  const ip = clientIp(req);
  if (!email) return json(res, 400, { error: OTP_MESSAGES.expired });
  if (!(await rateLimit(`rl:verify:ip:${ip}`, 30, 900))) return json(res, 429, { error: 'ลองหลายครั้งเกินไป กรุณารอ 15 นาที' });

  const result = await checkOtp('register', email, code);
  if (result !== 'ok') {
    await audit('register_verify_failed', { email, ip, reason: result });
    return json(res, 401, { error: OTP_MESSAGES[result] });
  }

  const raw = await redis.get(`reg:${email}`);
  if (!raw || (await getUser(email))) return json(res, 401, { error: OTP_MESSAGES.expired });
  const reg = JSON.parse(raw);
  await redis.del(`reg:${email}`);

  const now = new Date().toISOString();
  const user = await saveUser({
    email,
    name: reg.name,
    company: reg.company,
    phone: reg.phone,
    requestedProjects: reg.requestedProjects,
    reason: reg.reason,
    status: STATUS.PENDING,
    projects: [],
    consentAt: reg.consentAt,
    emailVerifiedAt: now,
    createdAt: now,
  });
  await createSession(res, email);
  await audit('register_completed', { email, ip });

  const admins = adminEmails();
  if (admins.length) {
    const url = env('APP_URL', '');
    await sendMailSafe({
      to: admins,
      subject: `[รออนุมัติ] ผู้ลงทะเบียนใหม่ ${appName()}`,
      html: layout(`<p>มีผู้ลงทะเบียนใหม่ (ยืนยันอีเมลแล้ว) รอการอนุมัติ</p>
        <table cellpadding="4">
          <tr><td><b>อีเมล</b></td><td>${escapeHtml(user.email)}</td></tr>
          <tr><td><b>ชื่อ</b></td><td>${escapeHtml(user.name)}</td></tr>
          <tr><td><b>บริษัท</b></td><td>${escapeHtml(user.company)}</td></tr>
          <tr><td><b>โครงการที่ขอ</b></td><td>${escapeHtml(user.requestedProjects)}</td></tr>
          <tr><td><b>เหตุผล</b></td><td>${escapeHtml(user.reason)}</td></tr>
        </table>
        <p>ตรวจสอบตัวตนก่อนอนุมัติ แล้วอนุมัติที่เมนู Admin${url ? ` ของระบบ (${escapeHtml(url)})` : ''}</p>`),
    }, { event: 'notify_admin_register', email });
  }

  return json(res, 201, { ok: true, status: user.status });
});
