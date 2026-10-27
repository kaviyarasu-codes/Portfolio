// POST /api/explain  { results }  →  AI review (owner only)
import { ownerOnly, json } from '../_lib/auth.js';
import { explain } from '../_lib/ai.js';

export const onRequestPost = ownerOnly(async ({ request, env }) => {
  const { results } = await request.json().catch(() => ({}));
  if (!results || !['website', 'apk'].includes(results.kind) || !Array.isArray(results.findings)) {
    return json({ error: 'Send the results of a website or APK check.' }, 400);
  }
  return json(await explain(results, env));
});
