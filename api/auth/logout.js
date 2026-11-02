import { handle, json, requirePostJson } from '../../lib/http.js';
import { destroySession, getSessionEmail } from '../../lib/session.js';
import { audit } from '../../lib/audit.js';

export default handle(async (req, res) => {
  if (!requirePostJson(req, res)) return;
  const email = await getSessionEmail(req);
  await destroySession(req, res);
  if (email) await audit('logout', { email });
  return json(res, 200, { ok: true });
});
