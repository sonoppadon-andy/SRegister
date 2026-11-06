import { handle, json, requirePostJson, log } from '../../lib/http.js';
import { clearSession, getSessionEmail } from '../../lib/session.js';

export default handle(async (req, res) => {
  if (!requirePostJson(req, res)) return;
  const email = getSessionEmail(req);
  clearSession(res);
  if (email) log('logout', { email });
  json(res, 200, { ok: true });
});
