// Turns raw audit results into a plain-language, prioritised review using the
// Claude API. Raw HTTP (fetch) because this site deploys as static files on
// Cloudflare Pages with no build step to bundle the npm SDK.
//
// Environment: ANTHROPIC_API_KEY (secret).

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are a senior web and mobile app reviewer helping a freelance developer (Kaviyarasu, Coimbatore) audit websites, web apps and Android APKs.

You receive the raw output of automated checks as JSON. Turn it into a review the developer can act on and explain to a client:
- Judge severity by real impact for this kind of site or app, not by the tool's label. Demote items that do not matter here, and say why.
- Flag likely false positives (e.g. links blocked by bot protection, HSTS on preloaded TLDs, public Firebase web API keys which are not secrets).
- Prefer specific, copy-pasteable fixes for the detected platform (WordPress, Shopify, Cloudflare, Nginx, Firebase, React Native, Expo, Gradle...).
- Point out what is done well; clients take criticism better with balance.
- Only use facts present in the input. If something important was not checked, list it under not_checked rather than guessing.
- Write in clear, simple English for a non-technical business owner in summaries, and precise technical detail in how_to_fix.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['grade', 'summary', 'strengths', 'priorities', 'quick_wins', 'false_positives', 'not_checked', 'client_message'],
  properties: {
    grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
    summary: { type: 'string', description: '3-5 sentence overall verdict in plain language.' },
    strengths: { type: 'array', items: { type: 'string' } },
    priorities: {
      type: 'array',
      description: 'Most important problems first, merged by root cause. At most 10.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'area', 'why_it_matters', 'how_to_fix', 'effort'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          area: { type: 'string', enum: ['security', 'bugs', 'design', 'accessibility', 'performance', 'seo', 'content', 'mobile', 'compliance'] },
          why_it_matters: { type: 'string' },
          how_to_fix: { type: 'string' },
          effort: { type: 'string', description: 'e.g. "5 min", "1-2 h"' },
        },
      },
    },
    quick_wins: { type: 'array', items: { type: 'string' }, description: 'Small changes with a visible payoff, under 30 minutes each.' },
    false_positives: { type: 'array', items: { type: 'string' } },
    not_checked: { type: 'array', items: { type: 'string' }, description: 'Important things automated checks could not cover and that should be checked by hand.' },
    client_message: { type: 'string', description: 'A short, friendly message the developer could send to the site/app owner offering to fix the top issues. Under 120 words.' },
  },
};

// Keep the request small: drop bulky fields the model does not need.
function compact(results) {
  const r = structuredClone(results);
  delete r.screenshot;
  if (r.links) { r.links.checked = (r.links.checked || []).filter((x) => x.status !== 200).slice(0, 20); r.links.assets_checked = (r.links.assets_checked || []).filter((x) => x.status !== 200).slice(0, 20); }
  if (r.redirect_chain) r.redirect_chain = r.redirect_chain.slice(0, 8);
  const s = JSON.stringify(r);
  return s.length > 60000 ? s.slice(0, 60000) : s;
}

export async function explainWithClaude(results, env) {
  if (!env.ANTHROPIC_API_KEY) throw Object.assign(new Error('Server is missing ANTHROPIC_API_KEY.'), { status: 500 });
  const kind = results.kind === 'apk' ? 'Android APK' : 'website / web application';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2026-10-21',
      // If a safety classifier declines, retry on Anthropic's recommended fallback model.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `Review this ${kind} audit. Automated results (JSON):\n\n${compact(results)}` }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Claude API error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status === 429 || res.status >= 500 ? 503 : 502 });
  }
  if (data.stop_reason === 'refusal') throw Object.assign(new Error('Claude declined to review this input.'), { status: 422 });
  if (data.stop_reason === 'max_tokens') throw Object.assign(new Error('The AI review was cut off; try again.'), { status: 502 });

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let review;
  try { review = JSON.parse(text); } catch { throw Object.assign(new Error('The AI review was not valid JSON; try again.'), { status: 502 }); }
  return { review, model: data.model, usage: data.usage ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens } : null };
}
