import { handle, json, requireAccount } from '../lib/http.js';
import { canClaim } from '../lib/users.js';

export default handle(async (req, res) => {
  const acc = await requireAccount(req, res);
  if (!acc) return;
  json(res, 200, {
    email: acc.email,
    name: acc.name,
    company: acc.company,
    status: acc.status,
    isAdmin: acc.isAdmin,
    canClaim: canClaim(acc),
    projects: acc.projects || [],
    requestedProjects: acc.requestedProjects || '',
    expiry: acc.expiry || '',
  });
});
