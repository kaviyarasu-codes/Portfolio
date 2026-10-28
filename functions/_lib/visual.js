// Real-browser design check through Cloudflare Browser Rendering (REST API).
// The page is opened in Chrome at phone and desktop sizes; designAudit() runs
// inside it, numbered boxes are drawn around problems, and one /snapshot call
// returns both the page HTML (with the results embedded) and a screenshot.
//
// Environment: CF_ACCOUNT_ID, CF_API_TOKEN (secret; token permission
// "Account → Browser Rendering → Edit").
import { designAudit } from './design-check.js';

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

export const VIEWS = [
  { name: 'phone', viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, userAgent: MOBILE_UA },
  { name: 'desktop', viewport: { width: 1366, height: 900, deviceScaleFactor: 1 } },
];

const SEV_COLOR = { critical: '#b42318', high: '#e11d48', medium: '#b45309', low: '#2563eb' };

/** Script injected into the page: run the checks, mark problems, embed the result as JSON. */
export function injectedScript() {
  return `(() => {
  const emit = (data) => {
    const out = document.createElement('script');
    out.type = 'application/json';
    out.id = '__si_result';
    out.textContent = JSON.stringify(data).replace(/</g, '\\\\u003c');
    document.documentElement.appendChild(out);
  };
  try {
    const designAudit = ${designAudit.toString()};
    const res = designAudit();
    const colors = ${JSON.stringify(SEV_COLOR)};
    res.issues.forEach((iss, i) => { iss.n = i + 1; });
    for (const iss of res.issues) {
      if (iss.severity === 'info') continue;
      (window.__siEls[iss.id] || []).slice(0, 4).forEach((el) => {
        if (el === document.body) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const c = colors[iss.severity] || '#2563eb';
        const box = document.createElement('div');
        Object.assign(box.style, { position: 'absolute', left: (r.left + scrollX - 3) + 'px', top: (r.top + scrollY - 3) + 'px', width: (r.width + 6) + 'px', height: (r.height + 6) + 'px', border: '3px solid ' + c, borderRadius: '4px', zIndex: '2147483647', pointerEvents: 'none', boxSizing: 'border-box' });
        const tag = document.createElement('span');
        tag.textContent = String(iss.n);
        Object.assign(tag.style, { position: 'absolute', top: '-13px', left: '-13px', minWidth: '22px', height: '22px', padding: '0 4px', borderRadius: '11px', background: c, color: '#fff', font: 'bold 12px/22px Arial, sans-serif', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.4)' });
        box.appendChild(tag);
        document.body.appendChild(box);
      });
    }
    emit(res);
  } catch (e) {
    emit({ error: String(e && e.message || e) });
  }
})();`;
}

/** Pulls the embedded JSON back out of the rendered HTML. */
export function extractResult(html) {
  const m = /<script[^>]*id="__si_result"[^>]*>([\s\S]*?)<\/script>/.exec(html || '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function imageUri(b64) {
  if (!b64) return null;
  if (b64.startsWith('data:')) return b64;
  return `data:${b64.startsWith('/9j/') ? 'image/jpeg' : 'image/png'};base64,${b64}`;
}

async function snapshot(env, url, view) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/snapshot`;
  const body = {
    url,
    viewport: view.viewport,
    gotoOptions: { waitUntil: 'networkidle2', timeout: 45000 },
    addScriptTag: [{ content: injectedScript() }],
    screenshotOptions: { fullPage: true, type: 'jpeg', quality: 60 },
  };
  if (view.userAgent) body.userAgent = view.userAgent;
  let res, data;
  try {
    res = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { name: view.name, error: `Browser Rendering request failed: ${e.message}` };
  }
  if (!res.ok || data.success === false) {
    const msg = data?.errors?.[0]?.message || `Browser Rendering error ${res.status}`;
    const hint = res.status === 429 ? ' (free limit reached; try again in a minute or tomorrow)' : res.status === 401 || res.status === 403 ? ' (check CF_API_TOKEN has Browser Rendering → Edit permission and CF_ACCOUNT_ID is right)' : '';
    return { name: view.name, error: msg + hint };
  }
  const result = data.result || {};
  const found = extractResult(result.content);
  const screenshot = imageUri(result.screenshot);
  if (!found) return { name: view.name, screenshot, error: 'The page did not run the design check. Its security policy (CSP) may block injected scripts, or it did not finish loading.' };
  if (found.error) return { name: view.name, screenshot, error: `Design check failed in the page: ${found.error}` };
  return { name: view.name, viewport: `${view.viewport.width}×${view.viewport.height}`, issues: found.issues, summary: found.summary, screenshot };
}

export async function visualCheck(url, env) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    throw Object.assign(new Error('Real-browser design check is not set up. Add CF_ACCOUNT_ID and CF_API_TOKEN (Browser Rendering) in Cloudflare Pages settings.'), { status: 501 });
  }
  const views = await Promise.all(VIEWS.map((v) => snapshot(env, url, v)));
  return { url, checked_at: new Date().toISOString(), views };
}
