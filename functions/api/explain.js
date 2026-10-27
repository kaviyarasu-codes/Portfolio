// POST /api/explain  { results }  →  Claude's prioritised review (owner only)
import { ownerOnly, json } from '../_lib/auth.js';
import { explainWithClaude } from '../_lib/claude.js';

export const onRequestPost = ownerOnly(async ({ request, env }) => {
  const { results } = await request.json().catch(() => ({}));
  if (!results || !['website', 'apk'].includes(results.kind) || !Array.isArray(results.findings)) {
    return json({ error: 'Send the results of a website or APK check.' }, 400);
  }
  return json(await explainWithClaude(results, env));
});
