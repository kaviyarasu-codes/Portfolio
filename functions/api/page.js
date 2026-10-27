// POST /api/page  { url }  →  checks for one more page of the site (owner only)
import { ownerOnly, json } from '../_lib/auth.js';
import { runPageAudit } from '../_lib/checks.js';

export const onRequestPost = ownerOnly(async ({ request, env }) => {
  const { url } = await request.json().catch(() => ({}));
  return json(await runPageAudit(url, { allowLocal: env.ALLOW_LOCAL_TARGETS === 'true' }));
});
