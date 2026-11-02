// Approved users only: create a claim request / list my own requests.
import { handle, json, requireAccount, requirePostJson, escapeHtml, validDate } from '../lib/http.js';
import { CLAIM } from '../config/claim.js';
import { saveClaim, listByUser, newRef, bangkokDate } from '../lib/claims.js';
import { adminEmails } from '../lib/users.js';
import { rateLimit } from '../lib/store.js';
import { sendMailSafe, layout } from '../lib/mail.js';
import { audit } from '../lib/audit.js';
import { appName, env } from '../lib/config.js';

function validate(body) {
  const values = {};
  for (const f of CLAIM.form) {
    const raw = body?.[f.name];
    const v = typeof raw === 'string' ? raw.trim() : raw;
    if (v === undefined || v === null || v === '') {
      if (f.required) return { error: `กรุณากรอก "${f.label}"` };
      continue;
    }
    if (f.type === 'date') {
      if (!validDate(v)) return { error: `"${f.label}" ไม่ใช่วันที่ที่ถูกต้อง` };
      if (v > bangkokDate()) return { error: `"${f.label}" ต้องไม่เป็นวันในอนาคต` };
      values[f.name] = v;
    } else if (f.type === 'number') {
      const n = Number(String(v).replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0 || n > 1e12) return { error: `"${f.label}" ต้องเป็นตัวเลขที่ไม่ติดลบ` };
      values[f.name] = n;
    } else if (f.type === 'tel') {
      if (!/^[0-9+\-\s()]{6,30}$/.test(String(v))) return { error: `"${f.label}" ไม่ถูกต้อง` };
      values[f.name] = String(v);
    } else {
      const s = String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
      if (s.length > (f.max || 255)) return { error: `"${f.label}" ยาวเกิน ${f.max || 255} ตัวอักษร` };
      values[f.name] = s;
    }
  }
  return { values };
}

/** What the submitter is allowed to see about their own claim. */
export const publicClaim = (c) => ({
  ref: c.ref, project: c.project, status: c.status, message: c.message || '',
  submittedAt: c.submittedAt, ...c.values,
});

export default handle(async (req, res) => {
  const acc = await requireAccount(req, res, { approved: true });
  if (!acc) return;

  if (req.method === 'GET') {
    const claims = await listByUser(acc.email);
    return json(res, 200, { claims: claims.map(publicClaim) });
  }

  if (!requirePostJson(req, res)) return;
  if (!(await rateLimit(`rl:claim:${acc.email}`, 10, 3600))) {
    return json(res, 429, { error: 'ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง หากเร่งด่วนให้ติดต่อทีม Claim โดยตรง' });
  }

  const wanted = String(req.body?.project || '').trim().toLowerCase();
  const project = acc.projects.find((p) => p.toLowerCase() === wanted);
  if (!project) return json(res, 403, { error: 'คุณไม่มีสิทธิ์แจ้งเคลมสำหรับโครงการนี้' });

  const v = validate(req.body);
  if (v.error) return json(res, 400, { error: v.error });

  const now = new Date().toISOString();
  const claim = await saveClaim({
    ref: newRef(),
    project,
    values: v.values,
    status: CLAIM.initialStatus,
    message: '',
    submittedBy: acc.email,
    submittedName: acc.name,
    submittedCompany: acc.company,
    submittedAt: now,
    history: [{ at: now, by: acc.email, action: 'submitted', status: CLAIM.initialStatus }],
  });
  await audit('claim_submitted', { email: acc.email, ref: claim.ref, project });

  const summary = `<table cellpadding="4">
    <tr><td><b>เลขที่คำขอ</b></td><td>${escapeHtml(claim.ref)}</td></tr>
    <tr><td><b>โครงการ</b></td><td>${escapeHtml(project)}</td></tr>
    <tr><td><b>กรมธรรม์</b></td><td>${escapeHtml(claim.values.policy)}</td></tr>
    <tr><td><b>ผู้แจ้ง</b></td><td>${escapeHtml(acc.name)} (${escapeHtml(acc.email)})</td></tr></table>`;
  const notify = env('CLAIM_NOTIFY_EMAIL', '') ? [env('CLAIM_NOTIFY_EMAIL')] : adminEmails();
  await Promise.all([
    sendMailSafe({ to: [acc.email], subject: `ได้รับคำขอแจ้งเคลมแล้ว ${claim.ref}`, html: layout(`<p>ระบบได้รับคำขอแจ้งเคลมของคุณแล้ว ทีมงานจะตรวจสอบและติดต่อกลับ ติดตามสถานะได้ที่เมนู "คำขอของฉัน"</p>${summary}`) }, { ref: claim.ref }),
    notify.length && sendMailSafe({ to: notify, subject: `[Claim Request] ${claim.ref} - ${project}`, html: layout(`<p>มีคำขอแจ้งเคลมใหม่ใน ${escapeHtml(appName())}</p>${summary}`) }, { ref: claim.ref }),
  ]);

  return json(res, 201, { ok: true, ref: claim.ref });
});
