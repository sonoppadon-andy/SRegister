// Registration (preview, no database):
// 1) user fills the form and proves the email with a one-time code (purpose "register")
// 2) the request is EMAILED to ADMIN_EMAILS; nothing is stored
// 3) Admin approves by adding the email to APPROVED_EMAILS in Vercel (then Redeploy)
import { handle, json, requirePostJson, clientIp, log } from '../lib/http.js';
import { hit } from '../lib/memlimit.js';
import { checkChallenge } from '../lib/otp-token.js';
import { createSession, adminEmails, isApproved } from '../lib/session.js';
import { sendMail, layout } from '../lib/mail.js';
import { appName, env } from '../lib/config.js';

const used = new Map();
const clip = (v, n) => String(v ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MESSAGES = {
  expired: 'รหัสหมดอายุ กรุณาขอรหัสใหม่',
  invalid: 'รหัสไม่ถูกต้อง ตรวจสอบรหัสในอีเมลแล้วลองอีกครั้ง',
  'wrong-purpose': 'รหัสนี้ใช้สำหรับการเข้าสู่ระบบ ไม่ใช่การลงทะเบียน',
  default: 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่',
};

export default handle(async (req, res) => {
  if (!requirePostJson(req, res)) return;
  const b = req.body || {};
  const ip = clientIp(req);
  if (!hit(`reg-ip:${ip}`, 20, 3600)) return json(res, 429, { error: 'ทำรายการบ่อยเกินไป กรุณาลองใหม่ภายหลัง' });

  const data = {
    name: clip(b.name, 100),
    company: clip(b.company, 150),
    phone: clip(b.phone, 30),
    requestedProjects: clip(b.requestedProjects, 300),
    reason: clip(b.reason, 500),
  };
  if (!data.name || !data.company || !data.phone || !data.requestedProjects) return json(res, 400, { error: 'กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ' });
  if (!/^[0-9+\-\s()]{6,30}$/.test(data.phone)) return json(res, 400, { error: 'เบอร์โทรไม่ถูกต้อง' });
  if (b.consent !== true) return json(res, 400, { error: 'กรุณายอมรับการเก็บและใช้ข้อมูลส่วนบุคคล' });

  const challenge = String(b.challenge || '');
  const nonce = challenge.split('.')[0].slice(-40);
  if (used.has(nonce)) return json(res, 401, { error: 'รหัสนี้ถูกใช้แล้ว กรุณาขอรหัสใหม่' });
  if (!hit(`reg-ch:${nonce}`, 5, 900)) return json(res, 401, { error: 'กรอกรหัสผิดหลายครั้ง กรุณาขอรหัสใหม่' });

  const r = checkChallenge(challenge, String(b.code || '').trim(), 'register');
  if (!r.ok) {
    log('register_failed', { ip, email: r.email, reason: r.reason });
    return json(res, 401, { error: MESSAGES[r.reason] || MESSAGES.default });
  }
  used.set(nonce, Date.now() + 3600_000);
  if (used.size > 5000) for (const [k, t] of used) if (t < Date.now()) used.delete(k);

  createSession(res, r.email);
  if (isApproved(r.email)) {
    log('register_already_approved', { email: r.email });
    return json(res, 200, { ok: true, approved: true });
  }

  const admins = adminEmails();
  if (!admins.length) throw new Error('ADMIN_EMAILS is not set - nobody would receive the registration');
  const url = env('APP_URL', '');
  await sendMail({
    to: admins,
    subject: `[รออนุมัติ] ผู้ลงทะเบียนใหม่ ${appName()}`,
    html: layout(`<p>มีผู้ลงทะเบียนใหม่ (<b>ยืนยันอีเมลแล้ว</b>) รอการอนุมัติ</p>
      <table cellpadding="4">
        <tr><td><b>อีเมล</b></td><td>${esc(r.email)}</td></tr>
        <tr><td><b>ชื่อ</b></td><td>${esc(data.name)}</td></tr>
        <tr><td><b>บริษัท</b></td><td>${esc(data.company)}</td></tr>
        <tr><td><b>โทร</b></td><td>${esc(data.phone)}</td></tr>
        <tr><td><b>โครงการที่ขอ</b></td><td>${esc(data.requestedProjects)}</td></tr>
        <tr><td><b>หมายเหตุ</b></td><td>${esc(data.reason)}</td></tr>
        <tr><td><b>ยินยอม PDPA</b></td><td>${new Date().toISOString()}</td></tr>
      </table>
      <p><b>วิธีอนุมัติ (ช่วงทดลอง):</b> ยืนยันตัวตนผู้ลงทะเบียนผ่านช่องทางอื่นก่อน แล้วเพิ่มอีเมลนี้ใน
      <code>APPROVED_EMAILS</code> ที่ Vercel → Settings → Environment Variables แล้ว Redeploy${url ? `<br>${esc(url)}` : ''}</p>`),
  });
  log('register_submitted', { email: r.email, ip });
  return json(res, 201, { ok: true, approved: false });
});
