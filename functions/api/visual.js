// POST /api/visual  { url }  →  real-browser design check at phone and desktop size (owner only)
import { ownerOnly, json } from '../_lib/auth.js';
import { normalizeTarget } from '../_lib/checks.js';
import { visualCheck } from '../_lib/visual.js';

export const onRequestPost = ownerOnly(async ({ request, env }) => {
  const { url } = await request.json().catch(() => ({}));
  const target = normalizeTarget(url, { allowLocal: env.ALLOW_LOCAL_TARGETS === 'true' });
  return json(await visualCheck(target.href, env));
});
