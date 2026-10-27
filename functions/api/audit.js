// POST /api/audit  { url }  →  automated website checks (owner only)
import { ownerOnly, json } from '../_lib/auth.js';
import { runWebsiteAudit } from '../_lib/checks.js';

export const onRequestPost = ownerOnly(async ({ request, env }) => {
  const { url } = await request.json().catch(() => ({}));
  const result = await runWebsiteAudit(url, { allowLocal: env.ALLOW_LOCAL_TARGETS === 'true' });
  return json(result);
});
