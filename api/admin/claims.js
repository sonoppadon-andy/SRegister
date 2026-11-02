// Admin: all claims, status updates (with a message to the submitter), CSV export.
import { handle, json, requireAccount, requirePostJson, clip, escapeHtml } from '../../lib/http.js';
import { CLAIM } from '../../config/claim.js';
import { getClaim, saveClaim, listAll } from '../../lib/claims.js';
import { sendMailSafe, layout } from '../../lib/mail.js';
import { audit } from '../../lib/audit.js';
import { appName } from '../../lib/config.js';

/** CSV cell: quote, and neutralise formulas (=,+,-,@) so Excel never executes user input. */
function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export default handle(async (req, res) => {
  const admin = await requireAccount(req, res, { admin: true });
  if (!admin) return;

  if (req.method === 'GET') {
    const claims = await listAll();
    if (req.query?.format === 'csv') {
      const fields = CLAIM.form.map((f) => f.name);
      const head = ['ref', 'submittedAt', 'status', 'project', ...fields, 'submittedBy', 'submittedName', 'submittedCompany', 'message'];
      const labels = ['เลขที่คำขอ', 'วันที่ส่ง', 'สถานะ', 'โครงการ', ...CLAIM.form.map((f) => f.label), 'อีเมลผู้แจ้ง', 'ชื่อผู้แจ้ง', 'บริษัทผู้แจ้ง', 'ข้อความถึงผู้แจ้ง'];
      const rows = claims.map((c) => head.map((h) => cell(fields.includes(h) ? c.values?.[h] : c[h])).join(','));
      await audit('admin_claims_export', { admin: admin.email, count: claims.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="claims-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send('\ufeff' + [labels.map(cell).join(','), ...rows].join('\r\n'));
    }
    return json(res, 200, { claims });
  }

  if (!requirePostJson(req, res)) return;
  const ref = String(req.body?.ref || '');
  const status = String(req.body?.status || '');
  const message = clip(req.body?.message, 1000);
  if (!CLAIM.statuses.includes(status)) return json(res, 400, { error: 'สถานะไม่ถูกต้อง' });
  const claim = await getClaim(ref);
  if (!claim) return json(res, 404, { error: 'ไม่พบคำขอ' });

  const before = claim.status;
  const changed = before !== status || (claim.message || '') !== message;
  if (!changed) return json(res, 200, { ok: true, claim });

  claim.status = status;
  claim.message = message;
  claim.history = [...(claim.history || []), { at: new Date().toISOString(), by: admin.email, action: 'status', from: before, status, message }].slice(-100);
  await saveClaim(claim);
  await audit('admin_claim_update', { admin: admin.email, ref, from: before, to: status });

  await sendMailSafe({
    to: [claim.submittedBy],
    subject: `${appName()}: อัปเดตคำขอ ${claim.ref}`,
    html: layout(`<p>คำขอแจ้งเคลม <b>${escapeHtml(claim.ref)}</b> มีการอัปเดต</p>
      <p>สถานะ: <b>${escapeHtml(status)}</b></p>${message ? `<p>ข้อความจากทีมงาน: ${escapeHtml(message)}</p>` : ''}
      <p>ดูรายละเอียดได้ที่เมนู "คำขอของฉัน"</p>`),
  }, { ref });

  return json(res, 200, { ok: true, claim });
});
