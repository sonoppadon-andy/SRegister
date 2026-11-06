import { handle, json } from '../lib/http.js';
import { getSessionEmail, isAdmin, isApproved } from '../lib/session.js';

export default handle(async (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return json(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
  json(res, 200, { email, isAdmin: isAdmin(email), approved: isApproved(email) });
});
