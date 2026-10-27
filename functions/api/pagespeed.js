// POST /api/pagespeed  { url, strategy }  →  Google Lighthouse via the
// PageSpeed Insights API (owner only): scores, Core Web Vitals, top
// opportunities, failed accessibility checks and a phone screenshot.
//
// Environment: PAGESPEED_API_KEY (optional, raises Google's free quota).
import { ownerOnly, json } from '../_lib/auth.js';
import { normalizeTarget } from '../_lib/checks.js';

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

export const onRequestPost = ownerOnly(async ({ request, env }) => {
  const body = await request.json().catch(() => ({}));
  const target = normalizeTarget(body.url);
  const strategy = body.strategy === 'desktop' ? 'desktop' : 'mobile';
  const qs = new URLSearchParams({ url: target.href, strategy });
  for (const c of CATEGORIES) qs.append('category', c);
  if (env.PAGESPEED_API_KEY) qs.set('key', env.PAGESPEED_API_KEY);

  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: data?.error?.message || `PageSpeed Insights error ${res.status}` }, res.status === 429 ? 429 : 502);

  const lh = data.lighthouseResult || {};
  const audits = lh.audits || {};
  const score = (c) => (lh.categories?.[c]?.score == null ? null : Math.round(lh.categories[c].score * 100));
  const metric = (id) => audits[id] ? { value: audits[id].displayValue || null, score: audits[id].score } : null;
  const refs = (cat) => (lh.categories?.[cat]?.auditRefs || []).map((r) => audits[r.id]).filter(Boolean);
  const field = data.loadingExperience?.metrics || null;

  return json({
    strategy,
    final_url: lh.finalDisplayedUrl || lh.finalUrl || target.href,
    scores: Object.fromEntries(CATEGORIES.map((c) => [c, score(c)])),
    metrics: { lcp: metric('largest-contentful-paint'), cls: metric('cumulative-layout-shift'), tbt: metric('total-blocking-time'), fcp: metric('first-contentful-paint'), speed_index: metric('speed-index') },
    field_data: field ? { overall: data.loadingExperience.overall_category, lcp_ms: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null, inp_ms: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null, cls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null } : null,
    opportunities: refs('performance')
      .filter((a) => a.details?.type === 'opportunity' && a.score !== null && a.score < 0.9)
      .sort((a, b) => (b.details.overallSavingsMs || 0) - (a.details.overallSavingsMs || 0))
      .slice(0, 6)
      .map((a) => ({ title: a.title, savings: a.displayValue || null })),
    failed_checks: ['accessibility', 'best-practices', 'seo'].flatMap((c) => refs(c)
      .filter((a) => a.score === 0 && a.scoreDisplayMode === 'binary')
      .map((a) => ({ category: c, title: a.title, items: (a.details?.items || []).length }))),
    screenshot: audits['final-screenshot']?.details?.data || null,
  });
});
