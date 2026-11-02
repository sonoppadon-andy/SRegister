// Admin: list registrations, approve / reject / suspend / reactivate / update access.
import { handle, json, requireAccount, requirePostJson, normEmail, validDate, clip } from '../../lib/http.js';
import { getUser, saveUser, listUsers, isAdminEmail, STATUS } from '../../lib/users.js';
import { sendMailSafe, layout } from '../../lib/mail.js';
import { audit } from '../../lib/audit.js';
import { appName, env } from '../../lib/config.js';
import { bangkokDate } from '../../lib/claims.js';

const ORDER = { pending: 0, approved: 1, suspended: 2, rejected: 3 };

function parseProjects(v) {
  const list = (Array.isArray(v) ? v : String(v || '').split(/[,;\n]/))
    .map((s) => clip(s, 100))
    .filter(Boolean);
  const seen = new Map();
  for (const p of list) if (!seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p); // keep first spelling
  return [...seen.values()].slice(0, 30);
}

export default handle(async (req, res) => {
  const admin = await requireAccount(req, res, { admin: true });
  if (!admin) return;

  if (req.method === 'GET') {
    const users = (await listUsers())
      .filter((u) => !isAdminEmail(u.email) || u.source !== 'admin-bootstrap')
      .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || (a.createdAt < b.createdAt ? 1 : -1));
    return json(res, 200, { users });
  }

  if (!requirePostJson(req, res)) return;
  const { action } = req.body || {};
  const email = normEmail(req.body?.email);
  if (!email) return json(res, 400, { error: 'อีเมลไม่ถูกต้อง' });
  if (email === admin.email) return json(res, 400, { error: 'ไม่สามารถเปลี่ยนสถานะบัญชีของตัวเองได้' });
  const user = await getUser(email);
  if (!user) return json(res, 404, { error: 'ไม่พบผู้ใช้' });

  const now = new Date().toISOString();
  const before = user.status;
  const note = clip(req.body?.note, 300);
  let mail = null;

  if (action === 'approve' || action === 'update' || action === 'reactivate') {
    if (action === 'approve' && user.status !== STATUS.PENDING) return json(res, 409, { error: 'ผู้ใช้นี้ไม่ได้อยู่ในสถานะรออนุมัติ' });
    if (action === 'update' && user.status !== STATUS.APPROVED) return json(res, 409, { error: 'แก้ไขสิทธิ์ได้เฉพาะผู้ใช้ที่อนุมัติแล้ว' });
    if (action === 'reactivate' && ![STATUS.SUSPENDED, STATUS.REJECTED].includes(user.status)) return json(res, 409, { error: 'สถานะนี้เปิดใช้งานใหม่ไม่ได้' });

    const projects = parseProjects(req.body?.projects);
    if (!projects.length) return json(res, 400, { error: 'กรุณาระบุโครงการที่อนุญาตอย่างน้อย 1 โครงการ' });
    const expiry = String(req.body?.expiry || '').trim();
    if (expiry && (!validDate(expiry) || expiry < bangkokDate())) return json(res, 400, { error: 'วันหมดสิทธิ์ต้องเป็นวันที่ในอนาคต' });

    user.projects = projects;
    user.expiry = expiry;
    user.status = STATUS.APPROVED;
    if (action !== 'update') {
      user.approvedBy = admin.email;
      user.approvedAt = now;
      mail = {
        subject: `${appName()}: บัญชีของคุณได้รับการอนุมัติแล้ว`,
        html: `<p>บัญชีของคุณได้รับการอนุมัติแล้ว เข้าสู่ระบบด้วยอีเมลนี้เพื่อแจ้งเคลมและติดตามสถานะได้</p>${expiry ? `<p>สิทธิ์ใช้งานถึงวันที่ ${expiry}</p>` : ''}${env('APP_URL', '') ? `<p>${env('APP_URL')}</p>` : ''}`,
      };
    }
  } else if (action === 'reject') {
    if (user.status !== STATUS.PENDING) return json(res, 409, { error: 'ปฏิเสธได้เฉพาะผู้ใช้ที่รออนุมัติ' });
    user.status = STATUS.REJECTED;
    mail = { subject: `${appName()}: ผลการลงทะเบียน`, html: '<p>คำขอลงทะเบียนของคุณยังไม่ได้รับการอนุมัติ หากมีข้อสงสัยกรุณาติดต่อผู้ประสานงานของบริษัท</p>' };
  } else if (action === 'suspend') {
    if (user.status !== STATUS.APPROVED) return json(res, 409, { error: 'ระงับได้เฉพาะผู้ใช้ที่อนุมัติแล้ว' });
    user.status = STATUS.SUSPENDED;
  } else {
    return json(res, 400, { error: 'คำสั่งไม่ถูกต้อง' });
  }

  user.history = [...(user.history || []), { at: now, by: admin.email, action, from: before, to: user.status, note }].slice(-50);
  await saveUser(user);
  await audit('admin_user_' + action, { admin: admin.email, email, from: before, to: user.status, projects: user.projects });
  if (mail) await sendMailSafe({ to: [email], subject: mail.subject, html: layout(mail.html) }, { event: 'user_' + action, email });

  return json(res, 200, { ok: true, user });
});
