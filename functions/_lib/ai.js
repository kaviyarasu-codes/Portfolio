// Turns raw audit results into a plain-language, prioritised review.
//
// Providers:
//   - Cloudflare Workers AI (default, free daily allowance, no API key):
//     add a Workers AI binding named "AI" in Pages → Settings → Bindings.
//     Optional AI_MODEL overrides the model.
//   - Claude API: set AI_PROVIDER=claude and ANTHROPIC_API_KEY (secret).
//     Raw HTTP (fetch) because this site has no build step to bundle the SDK.
//     If Claude fails for billing/rate reasons and Workers AI is bound, the
//     review falls back to Workers AI.

const CLAUDE_MODEL = 'claude-opus-5-5';
const WORKERS_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const SYSTEM = `You are a senior web and mobile app reviewer helping a freelance developer (Kaviyarasu, Coimbatore) audit websites, web apps and Android APKs for clients.

You receive the raw output of automated checks as JSON (home page, other pages, detected technologies, DNS/hosting, public JavaScript scan, Lighthouse). Turn it into a review the developer can act on and explain to a client:
- Explain how the site/app is built: languages, platform or builder (including AI/no-code builders), frameworks, hosting, database/backend services. Say "likely" when evidence is indirect.
- Summarise each area (frontend, backend, database, security, network & hosting, performance, SEO & content, accessibility; mobile app for APKs). Use "not_checked" when the input has no evidence for an area; never invent problems.
- Judge severity by real impact for this kind of site, not by the tool's label. Demote items that do not matter here and say why.
- Flag likely false positives (links blocked by bot protection, HSTS on preloaded TLDs, public Firebase web keys or Supabase anon keys, which are meant to be public).
- Give specific, copy-pasteable fixes for the detected platform (WordPress, Shopify, Wix, Cloudflare, Nginx, Firebase, Supabase, React Native, Expo, Gradle...).
- Mention page-specific problems with the page URL.
- Write a fix plan: phases in the order to work (urgent first), each with small steps a developer can do one by one. Every step says what to change, how (exact setting/file/code), and how to verify it is fixed.
- Point out what is done well.
- Use simple English a business owner understands in summaries, and precise technical detail in how_to_fix.`;

const AREAS = ['frontend', 'backend', 'database', 'security', 'network_hosting', 'performance', 'seo_content', 'accessibility', 'mobile_app'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['grade', 'summary', 'technology_summary', 'area_summaries', 'strengths', 'priorities', 'fix_plan', 'quick_wins', 'false_positives', 'not_checked', 'page_notes', 'client_message'],
  properties: {
    grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
    summary: { type: 'string', description: '3-5 sentence overall verdict in plain language.' },
    technology_summary: { type: 'string', description: 'How it is built: languages, platform/builder, frameworks, hosting, backend/database.' },
    area_summaries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'status', 'summary'],
        properties: {
          area: { type: 'string', enum: AREAS },
          status: { type: 'string', enum: ['good', 'needs_work', 'poor', 'not_checked'] },
          summary: { type: 'string' },
        },
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
    priorities: {
      type: 'array',
      description: 'Most important problems first, merged by root cause. At most 12.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'area', 'why_it_matters', 'how_to_fix', 'effort'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          area: { type: 'string', enum: AREAS },
          why_it_matters: { type: 'string' },
          how_to_fix: { type: 'string' },
          effort: { type: 'string', description: 'e.g. "5 min", "1-2 h"' },
        },
      },
    },
    fix_plan: {
      type: 'array',
      description: 'Phases in the order to work, urgent first. 2-4 phases, 2-8 steps each.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phase', 'goal', 'steps'],
        properties: {
          phase: { type: 'string', description: 'e.g. "Phase 1 - Fix today"' },
          goal: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'how', 'verify', 'effort'],
              properties: {
                title: { type: 'string' },
                how: { type: 'string', description: 'Exact actions: setting, file, code or command.' },
                verify: { type: 'string', description: 'How to confirm it is fixed.' },
                effort: { type: 'string' },
              },
            },
          },
        },
      },
    },
    quick_wins: { type: 'array', items: { type: 'string' } },
    false_positives: { type: 'array', items: { type: 'string' } },
    not_checked: { type: 'array', items: { type: 'string' } },
    page_notes: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['page', 'notes'], properties: { page: { type: 'string' }, notes: { type: 'string' } } },
    },
    client_message: { type: 'string', description: 'Short friendly message the developer could send the owner offering to fix the top issues. Under 120 words.' },
  },
};

const cut = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…` : s);
const slimFinding = (f) => ({ severity: f.severity, id: f.id, title: f.title, detail: cut(f.detail, 220), fix: cut(f.fix, 160) });

// Keep the request small: drop screenshots and passing checks, shorten text.
export function compact(results, maxChars) {
  const r = structuredClone(results);
  delete r.screenshot;
  delete r.ai;
  if (r.findings) r.findings = r.findings.slice(0, 60).map(slimFinding);
  if (r.links) {
    r.links.checked = (r.links.checked || []).filter((x) => x.status !== 200).slice(0, 15);
    r.links.assets_checked = (r.links.assets_checked || []).filter((x) => x.status !== 200).slice(0, 15);
  }
  if (r.redirect_chain) r.redirect_chain = r.redirect_chain.slice(0, 6);
  if (r.pages) {
    r.pages = r.pages.map((p) => ({
      url: p.final_url || p.url, title: p.title, status: p.status, ms: p.ms, score: p.score,
      lighthouse: p.lighthouse?.scores || null,
      findings: (p.findings || []).filter((f) => f.severity !== 'info').slice(0, 12).map((f) => ({ severity: f.severity, id: f.id, title: f.title, detail: cut(f.detail, 120) })),
    }));
  }
  if (r.lighthouse) delete r.lighthouse.screenshot;
  delete r.pages_found;
  delete r.robots_txt;
  let s = JSON.stringify(r);
  if (s.length > maxChars) {
    // Shrink the biggest parts first, then hard-cut.
    if (r.pages) r.pages = r.pages.map((p) => ({ ...p, findings: p.findings.slice(0, 5).map(({ detail, ...x }) => x) }));
    if (r.findings) r.findings = r.findings.slice(0, 40).map(({ fix, ...x }) => x);
    s = JSON.stringify(r);
  }
  return s.length > maxChars ? s.slice(0, maxChars) : s;
}

const LANGUAGES = {
  en: 'English',
  ta: 'Tamil (தமிழ் script)',
  tanglish: 'Tanglish (Tamil written in English letters, the way people chat on WhatsApp)',
  hi: 'Hindi (Devanagari script)',
};

function userPrompt(results, maxChars, language = 'en') {
  const kind = results.kind === 'apk' ? 'Android APK' : 'website / web application';
  const lang = LANGUAGES[language] || LANGUAGES.en;
  const langNote = language && language !== 'en' ? `\n\nWrite every text value in ${lang}. Keep technical names (HTTPS, DNS, WordPress, file names, settings, code) in English. Keep JSON keys and enum values in English.` : '';
  return `Review this ${kind} audit. Automated results (JSON):\n\n${compact(results, maxChars)}${langNote}`;
}

/** Fills gaps so the page can always render the review. */
export function normalizeReview(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const arr = (x) => (Array.isArray(x) ? x : []);
  const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
  const sev = (x) => (['critical', 'high', 'medium', 'low'].includes(x) ? x : 'medium');
  const area = (x) => (AREAS.includes(x) ? x : 'frontend');
  return {
    grade: ['A', 'B', 'C', 'D', 'F'].includes(r.grade) ? r.grade : '–',
    summary: str(r.summary),
    technology_summary: str(r.technology_summary),
    area_summaries: arr(r.area_summaries).map((a) => ({ area: area(a?.area), status: ['good', 'needs_work', 'poor', 'not_checked'].includes(a?.status) ? a.status : 'needs_work', summary: str(a?.summary) })),
    strengths: arr(r.strengths).map(str),
    priorities: arr(r.priorities).slice(0, 12).map((p) => ({ title: str(p?.title), severity: sev(p?.severity), area: area(p?.area), why_it_matters: str(p?.why_it_matters), how_to_fix: str(p?.how_to_fix), effort: str(p?.effort) })),
    fix_plan: arr(r.fix_plan).slice(0, 5).map((ph) => ({ phase: str(ph?.phase), goal: str(ph?.goal), steps: arr(ph?.steps).slice(0, 10).map((st) => ({ title: str(st?.title), how: str(st?.how), verify: str(st?.verify), effort: str(st?.effort) })) })).filter((ph) => ph.steps.length),
    quick_wins: arr(r.quick_wins).map(str),
    false_positives: arr(r.false_positives).map(str),
    not_checked: arr(r.not_checked).map(str),
    page_notes: arr(r.page_notes).map((p) => ({ page: str(p?.page), notes: str(p?.notes) })),
    client_message: str(r.client_message),
  };
}

/** Parses JSON even if the model wrapped it in prose or code fences. */
export function parseJsonLoose(text) {
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw Object.assign(new Error('The AI review was not valid JSON; try again.'), { status: 502 });
}

// ── Cloudflare Workers AI (free tier) ───────────────────────

async function workersAi(results, env, language) {
  const model = env.AI_MODEL || WORKERS_MODEL;
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(results, 34000, language) }];
  let out;
  try {
    out = await env.AI.run(model, { messages, response_format: { type: 'json_schema', json_schema: SCHEMA }, max_tokens: 7000, temperature: 0.2 });
  } catch (e) {
    if (/neuron|quota|limit|429/i.test(e.message)) throw Object.assign(new Error('Free Workers AI limit reached for today. It resets daily (00:00 UTC); try again later.'), { status: 429 });
    // Some models reject JSON mode: ask for JSON in the prompt instead.
    messages.push({ role: 'system', content: `Reply with only one JSON object matching this JSON Schema, no other text:\n${JSON.stringify(SCHEMA)}` });
    out = await env.AI.run(model, { messages, max_tokens: 7000, temperature: 0.2 });
  }
  const review = parseJsonLoose(out?.response ?? out);
  return { review: normalizeReview(review), model, provider: 'Cloudflare Workers AI (free)' };
}

// ── Claude API (optional, paid) ─────────────────────────────

async function claude(results, env, language) {
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
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: userPrompt(results, 60000, language) }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Claude API error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status === 429 || res.status >= 500 ? 503 : 502, billing: /credit|billing|balance/i.test(msg) || res.status === 429 || res.status >= 500 });
  }
  if (data.stop_reason === 'refusal') throw Object.assign(new Error('Claude declined to review this input.'), { status: 422 });
  if (data.stop_reason === 'max_tokens') throw Object.assign(new Error('The AI review was cut off; try again.'), { status: 502 });
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { review: normalizeReview(parseJsonLoose(text)), model: data.model, provider: 'Claude API' };
}

export async function explain(results, env, { language = 'en' } = {}) {
  const hasWorkers = !!(env.AI && typeof env.AI.run === 'function');
  const wantsClaude = env.AI_PROVIDER === 'claude' && env.ANTHROPIC_API_KEY;
  if (wantsClaude || (!hasWorkers && env.ANTHROPIC_API_KEY)) {
    try {
      return await claude(results, env, language);
    } catch (e) {
      if (!(hasWorkers && e.billing)) throw e;
      const out = await workersAi(results, env, language);
      return { ...out, note: `Claude unavailable (${e.message}); used the free model instead.` };
    }
  }
  if (hasWorkers) return workersAi(results, env, language);
  throw Object.assign(new Error('No AI is set up. In Cloudflare Pages → Settings → Bindings, add a "Workers AI" binding named AI (free), then redeploy.'), { status: 500 });
}
