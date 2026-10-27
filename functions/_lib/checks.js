// Visitor-level website checks for the owner-only audit tool.
// Everything here is what a browser or search crawler would request:
// the page itself, its links and assets, robots/security.txt/sitemap and
// public DNS. No path guessing, form submission or load testing.

const UA = 'Mozilla/5.0 (compatible; KaviyarasuSiteAudit/1.0; +https://kaviyarasu-portfolio.pages.dev)';
const MAX_HTML = 2 * 1024 * 1024;
const LINK_CHECK_LIMIT = 15;
const ASSET_CHECK_LIMIT = 12;

function finding(severity, id, title, detail, fix, extra = {}) {
  return { severity, id, title, detail, fix, ...extra };
}

// ── Target validation ────────────────────────────────────────

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.localhost|.*\.internal|.*\.home\.arpa)$/i;

function isPrivateIp(host) {
  if (/^\[?[0-9a-f:]+\]?$/i.test(host) && host.includes(':')) return true; // IPv6 literal: refuse all
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function normalizeTarget(input, { allowLocal = false } = {}) {
  let raw = String(input || '').trim();
  if (!raw) throw Object.assign(new Error('Enter a website address.'), { status: 400 });
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('That is not a valid web address.'), { status: 400 }); }
  if (!['http:', 'https:'].includes(u.protocol)) throw Object.assign(new Error('Only http:// and https:// addresses can be checked.'), { status: 400 });
  if (u.username || u.password) throw Object.assign(new Error('Remove the username/password from the address.'), { status: 400 });
  if (!allowLocal && (PRIVATE_HOST.test(u.hostname) || isPrivateIp(u.hostname) || !u.hostname.includes('.'))) {
    throw Object.assign(new Error('Private or local addresses cannot be checked from the server.'), { status: 400 });
  }
  u.hash = '';
  return u;
}

// ── HTTP helpers ─────────────────────────────────────────────

async function timedFetch(url, init = {}, timeoutMs = 15000) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'manual', ...init, signal: ctrl.signal, headers: { 'user-agent': UA, accept: '*/*', ...(init.headers || {}) } });
    return { res, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function readText(res, limit = MAX_HTML) {
  const reader = res.body?.getReader();
  if (!reader) return { text: '', bytes: 0, truncated: false };
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > limit) { truncated = true; chunks.push(value.subarray(0, value.length - (bytes - limit))); await reader.cancel(); break; }
    chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return { text: new TextDecoder().decode(all), bytes, truncated };
}

async function followRedirects(url, max = 6) {
  const chain = [];
  let current = url;
  for (let i = 0; i <= max; i++) {
    const { res, ms } = await timedFetch(current, { headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
    const location = res.headers.get('location');
    chain.push({ url: current, status: res.status, ms, location });
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, current).href;
      continue;
    }
    return { chain, res, ms };
  }
  throw new Error('Too many redirects (more than 6).');
}

// ── Header, cookie and CSP analysis ──────────────────────────

function parseCsp(value) {
  const d = {};
  for (const part of value.split(';')) {
    const t = part.trim().split(/\s+/).filter(Boolean);
    if (t.length) d[t[0].toLowerCase()] = t.slice(1);
  }
  return d;
}

export function analyzeCsp(value) {
  const out = [];
  const d = parseCsp(value);
  const scriptSrc = d['script-src'] || d['default-src'];
  if (!scriptSrc) {
    out.push(finding('medium', 'CSP-NO-SCRIPT-SRC', 'Security policy does not restrict scripts', 'CSP has neither script-src nor default-src.', "Add script-src 'self' (plus nonces/hashes) or a restrictive default-src."));
  } else {
    const nonceOrHash = scriptSrc.some((s) => /^'(nonce|sha256|sha384|sha512)-/.test(s));
    if (scriptSrc.includes("'unsafe-inline'") && !nonceOrHash) out.push(finding('medium', 'CSP-UNSAFE-INLINE', "CSP allows 'unsafe-inline' scripts", 'Injected inline scripts (XSS) would still run.', "Replace 'unsafe-inline' with nonces or hashes."));
    if (scriptSrc.includes("'unsafe-eval'")) out.push(finding('low', 'CSP-UNSAFE-EVAL', "CSP allows 'unsafe-eval'", 'eval() and new Function() are allowed.', "Remove 'unsafe-eval' if possible."));
    if (!scriptSrc.includes("'strict-dynamic'") && scriptSrc.some((s) => ['*', 'https:', 'http:', 'data:'].includes(s))) out.push(finding('medium', 'CSP-WILDCARD', 'CSP allows scripts from anywhere', `script sources: ${scriptSrc.join(' ')}`, 'List the exact script hosts instead of a wildcard.'));
  }
  if (!d['object-src'] && !(d['default-src'] || []).includes("'none'")) out.push(finding('low', 'CSP-OBJECT-SRC', "CSP lacks object-src 'none'", 'Plugin content is not explicitly blocked.', "Add object-src 'none'."));
  if (!d['base-uri']) out.push(finding('low', 'CSP-BASE-URI', 'CSP lacks base-uri', 'An injected <base> tag could redirect relative script URLs.', "Add base-uri 'self'."));
  return { directives: d, findings: out };
}

const SESSION_COOKIE = /(sess|sid|auth|token|jwt|login|remember|csrf|xsrf|phpsessid|jsessionid)/i;

export function analyzeCookies(setCookies, isHttps) {
  const out = [];
  const list = [];
  for (const raw of setCookies) {
    const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
    const name = pair.split('=')[0];
    const lower = attrs.map((a) => a.toLowerCase());
    const sameSite = ((lower.find((a) => a.startsWith('samesite=')) || '').split('=')[1]) || null;
    const c = { name, secure: lower.includes('secure'), httpOnly: lower.includes('httponly'), sameSite };
    list.push(c);
    const sensitive = SESSION_COOKIE.test(name);
    if (isHttps && !c.secure) out.push(finding(sensitive ? 'medium' : 'low', 'COOKIE-NO-SECURE', `Cookie "${name}" is missing Secure`, 'It can be sent over unencrypted HTTP.', 'Add the Secure attribute.'));
    if (sensitive && !c.httpOnly) out.push(finding('medium', 'COOKIE-NO-HTTPONLY', `Login/session cookie "${name}" is missing HttpOnly`, 'Page scripts (including injected ones) can read it.', 'Add HttpOnly to session cookies.'));
    if (!sameSite) out.push(finding('low', 'COOKIE-NO-SAMESITE', `Cookie "${name}" has no SameSite`, 'Browser defaults differ.', 'Set SameSite=Lax (or Strict).'));
  }
  return { cookies: list, findings: out };
}

export function analyzeHeaders(headers, { isHttps, setCookies = [], hostname = '' }) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v);
  const f = [];
  // Whole TLDs on the HSTS preload list: browsers always use HTTPS for them.
  const preloadedTld = /\.(dev|app|page|new|day|foo|bank|insurance)$/i.test(hostname);

  if (!isHttps) {
    f.push(finding('high', 'SEC-PLAINTEXT', 'Site is served over plain HTTP', 'Visitors\' traffic can be read or changed in transit.', 'Serve the site over HTTPS and redirect HTTP to it.'));
  } else if (!h['strict-transport-security']) {
    if (!preloadedTld) f.push(finding('medium', 'SEC-HSTS', 'HSTS header missing', 'Browsers are not told to always use HTTPS, so first visits can be downgraded.', 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains.'));
  } else {
    const maxAge = Number((/max-age=(\d+)/i.exec(h['strict-transport-security']) || [])[1] || 0);
    if (maxAge < 15552000) f.push(finding('low', 'SEC-HSTS-SHORT', 'HSTS max-age is under 6 months', h['strict-transport-security'], 'Use max-age=31536000.'));
  }

  let csp = null;
  if (h['content-security-policy']) {
    csp = analyzeCsp(h['content-security-policy']);
    f.push(...csp.findings);
  } else {
    f.push(finding('medium', 'SEC-CSP', h['content-security-policy-report-only'] ? 'Content-Security-Policy is report-only' : 'No Content-Security-Policy', 'No browser-enforced protection against injected scripts.', 'Add a CSP (start with Content-Security-Policy-Report-Only, then enforce).'));
  }
  if (!h['x-frame-options'] && !(csp && csp.directives['frame-ancestors'])) f.push(finding('medium', 'SEC-CLICKJACK', 'No clickjacking protection', 'Other sites can embed this page in a frame.', "Add CSP frame-ancestors 'self' or X-Frame-Options: DENY."));
  if ((h['x-content-type-options'] || '').toLowerCase() !== 'nosniff') f.push(finding('low', 'SEC-NOSNIFF', 'X-Content-Type-Options: nosniff missing', 'Browsers may guess file types.', 'Send X-Content-Type-Options: nosniff.'));
  if (!h['referrer-policy']) f.push(finding('low', 'SEC-REFERRER', 'Referrer-Policy missing', 'Full URLs may leak to other sites.', 'Send Referrer-Policy: strict-origin-when-cross-origin.'));
  if (!h['permissions-policy']) f.push(finding('info', 'SEC-PERMISSIONS', 'Permissions-Policy missing', 'Camera, microphone etc. are not explicitly disabled.', 'Send Permissions-Policy: camera=(), microphone=(), geolocation=().'));
  for (const leak of ['x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator']) {
    if (h[leak]) f.push(finding('low', 'SEC-VERSION-LEAK', `Technology disclosed in ${leak} header`, `${leak}: ${h[leak]}`, 'Remove the header.'));
  }
  if (h.server && /\d/.test(h.server)) f.push(finding('low', 'SEC-VERSION-LEAK', 'Server version disclosed', `server: ${h.server}`, 'Hide the version number in the Server header.'));
  if (h['access-control-allow-origin'] === '*' && /true/i.test(h['access-control-allow-credentials'] || '')) f.push(finding('medium', 'SEC-CORS', 'CORS allows any origin with credentials', 'Misconfigured cross-origin policy.', 'Allow only specific origins.'));

  const ck = analyzeCookies(setCookies, isHttps);
  f.push(...ck.findings);
  const score = Math.max(0, 100 - f.reduce((s, x) => s + ({ critical: 40, high: 25, medium: 10, low: 4, info: 0 }[x.severity] || 0), 0));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';
  return { grade, score, findings: f, cookies: ck.cookies, hsts_preloaded_tld: preloadedTld };
}

// ── HTML analysis ────────────────────────────────────────────

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
};
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const decode = (s) => (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function analyzeHtml(rawHtml, pageUrl) {
  // Ignore scripts/styles/comments for content checks.
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const isHttps = pageUrl.startsWith('https:');
  const f = [];
  const meta = (key, val) => { const t = tags(html, 'meta').find((m) => (attr(m, key) || '').toLowerCase() === val); return t ? decode(attr(t, 'content')) : null; };

  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]?.trim()) || null;
  const description = meta('name', 'description');
  const viewport = meta('name', 'viewport');
  const robots = meta('name', 'robots');
  const generator = meta('name', 'generator');
  const lang = attr((/<html\b[^>]*>/i.exec(html) || [''])[0], 'lang');
  const canonical = attr(tags(html, 'link').find((l) => /rel\s*=\s*["']?canonical/i.test(l)) || '', 'href');
  const og = { title: meta('property', 'og:title'), description: meta('property', 'og:description'), image: meta('property', 'og:image') };
  const favicon = tags(html, 'link').some((l) => /rel\s*=\s*["'][^"']*icon/i.test(l));
  const h1 = (body.match(/<h1\b/gi) || []).length;
  const headings = [...body.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  const skipped = headings.findIndex((lv, i) => i > 0 && lv > headings[i - 1] + 1);
  const imgs = tags(body, 'img');
  const noAlt = imgs.filter((t) => attr(t, 'alt') === null).map((t) => attr(t, 'src')).filter(Boolean);
  const noDims = imgs.filter((t) => !attr(t, 'width') || !attr(t, 'height')).length;
  const lazy = imgs.filter((t) => /loading\s*=\s*["']?lazy/i.test(t)).length;
  const inputs = tags(body, 'input').concat(tags(body, 'select'), tags(body, 'textarea'));
  const unlabeled = inputs.filter((t) => {
    if (/type\s*=\s*["']?(hidden|submit|button|image|reset)/i.test(t)) return false;
    if (attr(t, 'aria-label') || attr(t, 'aria-labelledby') || attr(t, 'title')) return false;
    const id = attr(t, 'id');
    return !(id && new RegExp(`for\\s*=\\s*["']?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\\s>]`, 'i').test(body));
  });
  const anchors = tags(body, 'a');
  const links = anchors.map((t) => decode(attr(t, 'href'))).filter(Boolean);
  const emptyLinks = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter((m) =>
    !m[2].replace(/<[^>]+>/g, '').trim()
    && !/aria-label(ledby)?\s*=|title\s*=/i.test(m[1])
    && !/<img[^>]+alt\s*=\s*["'][^"']+|aria-label\s*=/i.test(m[2])).length;
  const buttonsNoName = [...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].filter((m) => !m[2].replace(/<[^>]+>/g, '').trim() && !/aria-label|title=/i.test(m[1])).length;
  const scripts = tags(html, 'script').map((t) => ({ src: decode(attr(t, 'src')), integrity: !!attr(t, 'integrity'), async: /\s(async|defer)\b/i.test(t), type: attr(t, 'type') })).filter((s) => s.src);
  const styles = tags(html, 'link').filter((l) => /rel\s*=\s*["']?stylesheet/i.test(l)).map((t) => ({ href: decode(attr(t, 'href')), integrity: !!attr(t, 'integrity') }));
  const forms = [...body.matchAll(/<form\b[^>]*>/gi)].map((m) => ({ action: decode(attr(m[0], 'action')), method: (attr(m[0], 'method') || 'get').toLowerCase() }));
  const hasPassword = /<input[^>]+type\s*=\s*["']?password/i.test(body);
  const blankNoOpener = anchors.filter((t) => /target\s*=\s*["']?_blank/i.test(t) && !/rel\s*=\s*["'][^"']*noopener/i.test(t)).length;
  const jsonLd = (html.match(/<script[^>]+application\/ld\+json/gi) || []).length;
  const text = body.replace(/<[^>]+>/g, ' ');
  const placeholder = /lorem ipsum|your (title|text) here|sample text|coming soon/i.exec(text);
  const brokenRender = /\bundefined\b|\bNaN\b|\{\{\s*[\w.]+\s*\}\}|â€™|â€œ/.exec(text);
  const year = new Date().getFullYear();
  const copyright = /(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/i.exec(rawHtml);

  if (!title) f.push(finding('medium', 'SEO-NO-TITLE', 'Page has no <title>', 'Search results and browser tabs show the URL instead.', 'Add a unique, descriptive title (50–60 characters).'));
  else if (title.length > 65) f.push(finding('low', 'SEO-LONG-TITLE', `Title is ${title.length} characters`, title, 'Keep titles around 60 characters so Google does not cut them off.'));
  if (!description) f.push(finding('low', 'SEO-NO-DESCRIPTION', 'No meta description', 'Google will pick random text for the search snippet.', 'Add a 120–160 character meta description.'));
  if (robots && /noindex/i.test(robots)) f.push(finding('high', 'SEO-NOINDEX', 'Page tells search engines not to index it', `robots: ${robots}`, 'Remove noindex if this page should appear in Google.'));
  if (!viewport) f.push(finding('high', 'UX-NO-VIEWPORT', 'Not mobile-friendly: no viewport tag', 'Phones will show a tiny zoomed-out desktop layout.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'));
  else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport)) f.push(finding('medium', 'A11Y-NO-ZOOM', 'Pinch-zoom is disabled', viewport, 'Remove user-scalable=no and maximum-scale=1 (WCAG 1.4.4).'));
  if (!lang) f.push(finding('medium', 'A11Y-NO-LANG', '<html> has no lang attribute', 'Screen readers may read the page in the wrong language.', 'Add lang, e.g. <html lang="en">.'));
  if (h1 === 0) f.push(finding('low', 'SEO-NO-H1', 'No <h1> heading', 'Search engines and screen readers lack a main heading.', 'Add one <h1> that describes the page.'));
  else if (h1 > 1) f.push(finding('info', 'SEO-MULTI-H1', `${h1} <h1> headings`, 'Usually one main heading is clearer.', 'Use one <h1> and h2–h6 for sections.'));
  if (skipped > 0) f.push(finding('info', 'A11Y-HEADING-SKIP', 'Heading levels skip', `h${headings[skipped - 1]} is followed by h${headings[skipped]}.`, 'Do not skip heading levels (WCAG 1.3.1).'));
  if (noAlt.length) f.push(finding('medium', 'A11Y-IMG-ALT', `${noAlt.length} image(s) without alt text`, noAlt.slice(0, 8).join(', '), 'Add descriptive alt text, or alt="" for decorative images (WCAG 1.1.1).'));
  if (noDims > 2) f.push(finding('low', 'PERF-IMG-DIMENSIONS', `${noDims} image(s) without width/height`, 'The layout jumps as images load (CLS).', 'Set width and height attributes on images.'));
  if (imgs.length > 8 && lazy === 0) f.push(finding('low', 'PERF-NO-LAZY', `${imgs.length} images, none lazy-loaded`, 'All images download up front.', 'Add loading="lazy" to images below the first screen.'));
  if (unlabeled.length) f.push(finding('medium', 'A11Y-FORM-LABEL', `${unlabeled.length} form field(s) without a label`, unlabeled.slice(0, 4).join(' '), 'Connect each field to a <label for> or add aria-label (WCAG 1.3.1).'));
  if (emptyLinks) f.push(finding('medium', 'A11Y-EMPTY-LINK', `${emptyLinks} link(s) with no text or label`, 'Screen readers announce them as just "link".', 'Add visible text or aria-label to icon-only links.'));
  if (buttonsNoName) f.push(finding('medium', 'A11Y-EMPTY-BUTTON', `${buttonsNoName} button(s) with no text or label`, 'Screen readers announce them as just "button".', 'Add aria-label to icon-only buttons.'));
  if (!canonical) f.push(finding('info', 'SEO-NO-CANONICAL', 'No canonical URL', 'Duplicate URLs (www/non-www, ?utm=) may compete.', 'Add <link rel="canonical" href="…">.'));
  if (!og.title || !og.image) f.push(finding('low', 'SEO-NO-OG', 'Missing social sharing preview (Open Graph)', `og:title ${og.title ? 'set' : 'missing'}, og:image ${og.image ? 'set' : 'missing'}`, 'Add og:title, og:description and og:image so links look good on WhatsApp, LinkedIn etc.'));
  if (!favicon) f.push(finding('low', 'UX-NO-FAVICON', 'No favicon declared', 'Browser tabs and bookmarks show a blank icon.', 'Add <link rel="icon" href="/favicon.png">.'));
  if (!jsonLd) f.push(finding('info', 'SEO-NO-SCHEMA', 'No structured data', 'Google cannot show rich results (business info, ratings…).', 'Add JSON-LD (e.g. Organization, LocalBusiness or Person).'));
  if (isHttps) {
    const mixed = [...html.matchAll(/<(?:script|img|link|iframe|source|video|audio)\b[^>]*\s(?:src|href)\s*=\s*["']?(http:\/\/[^"'\s>]+)/gi)].map((m) => m[1]);
    if (mixed.length) f.push(finding('medium', 'SEC-MIXED-CONTENT', `${mixed.length} resource(s) loaded over HTTP on an HTTPS page`, mixed.slice(0, 6).join(', '), 'Change these to https:// URLs.'));
  }
  const thirdPartyNoSri = scripts.filter((s) => /^(https?:)?\/\//.test(s.src) && !s.src.includes(new URL(pageUrl).host) && !s.integrity);
  if (thirdPartyNoSri.length) f.push(finding('low', 'SEC-NO-SRI', `${thirdPartyNoSri.length} third-party script(s) without integrity check`, thirdPartyNoSri.slice(0, 6).map((s) => s.src).join(', '), 'Add integrity="sha384-…" crossorigin="anonymous" to pinned CDN scripts, or self-host them.'));
  const blocking = scripts.filter((s) => !s.async && s.type !== 'module').length;
  if (blocking > 3) f.push(finding('low', 'PERF-BLOCKING-JS', `${blocking} render-blocking scripts`, 'The page waits for these before showing content.', 'Add defer to scripts that are not needed for the first paint.'));
  for (const form of forms) {
    if (form.action && /^http:\/\//i.test(form.action)) f.push(finding('high', 'SEC-FORM-HTTP', 'A form submits over plain HTTP', `action="${form.action}"`, 'Use an https:// form action.'));
  }
  if (hasPassword && forms.some((x) => x.method === 'get')) f.push(finding('high', 'SEC-PASSWORD-GET', 'A password form uses GET', 'Passwords would appear in URLs, logs and history.', 'Use method="post".'));
  if (blankNoOpener > 0) f.push(finding('info', 'SEC-BLANK-NOOPENER', `${blankNoOpener} target="_blank" link(s) without rel="noopener"`, 'Modern browsers protect against this by default; older ones do not.', 'Add rel="noopener noreferrer".'));
  if (placeholder) f.push(finding('medium', 'CONTENT-PLACEHOLDER', 'Placeholder text found on the page', `"${placeholder[0]}"`, 'Replace placeholder content before launch.'));
  if (brokenRender) f.push(finding('medium', 'BUG-RENDER-ARTIFACT', 'Broken text on the page', `Found "${brokenRender[0]}" in visible text (template/encoding error).`, 'Fix the template variable or character encoding (use UTF-8).'));
  if (copyright && Number(copyright[1]) < year - 1) f.push(finding('low', 'CONTENT-OLD-YEAR', `Footer shows © ${copyright[1]}`, 'Makes the site look unmaintained.', 'Update the year (or print it with JavaScript).'));

  const tech = [];
  if (generator) tech.push(generator);
  if (/wp-content|wp-includes/i.test(rawHtml)) tech.push('WordPress');
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(rawHtml)) tech.push('Shopify');
  if (/static\.wixstatic\.com|wix\.com/i.test(rawHtml)) tech.push('Wix');
  if (/squarespace/i.test(rawHtml)) tech.push('Squarespace');
  if (/__NEXT_DATA__|\/_next\//.test(rawHtml)) tech.push('Next.js');
  if (/data-reactroot|react-dom/i.test(rawHtml)) tech.push('React');
  if (/ng-version=/i.test(rawHtml)) tech.push('Angular');
  if (/data-v-[0-9a-f]{6,}|__NUXT__/i.test(rawHtml)) tech.push('Vue/Nuxt');
  if (/gstatic\.com\/firebasejs|firebaseapp\.com/i.test(rawHtml)) tech.push('Firebase');
  if (/googletagmanager\.com|google-analytics\.com|gtag\(/i.test(rawHtml)) tech.push('Google Analytics/Tag Manager');
  if (/jquery[.-]?(\d[\d.]*)?(\.min)?\.js/i.test(rawHtml)) tech.push(`jQuery${(/jquery[.-](\d[\d.]+)/i.exec(rawHtml) || [])[1] ? ' ' + /jquery[.-](\d[\d.]+)/i.exec(rawHtml)[1] : ''}`);
  const wpVer = /ver=(\d+\.\d+(?:\.\d+)?)/.exec(rawHtml);
  if (generator && /WordPress\s+(\d+\.\d+)/i.test(generator)) f.push(finding('low', 'SEC-VERSION-LEAK', 'WordPress version is public', generator, 'Remove the generator tag and keep WordPress, themes and plugins updated.'));

  return {
    facts: { title, description, lang, viewport, canonical, robots, og, favicon, h1, images: imgs.length, images_without_alt: noAlt.length, lazy_images: lazy, links: links.length, scripts: scripts.length, stylesheets: styles.length, forms: forms.length, has_password_field: hasPassword, json_ld_blocks: jsonLd, tech: [...new Set(tech)], wp_asset_version_hint: wpVer ? wpVer[1] : null },
    links,
    assets: [...scripts.map((s) => s.src), ...styles.map((s) => s.href), ...imgs.map((t) => decode(attr(t, 'src'))).filter((s) => s && !s.startsWith('data:'))],
    findings: f,
  };
}

// ── DNS (DNS-over-HTTPS) ─────────────────────────────────────

async function doh(name, type) {
  const { res } = await timedFetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } }, 8000);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.Answer || []).filter((a) => a.type === { TXT: 16, MX: 15, CAA: 257 }[type]).map((a) => String(a.data).replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
}

export function analyzeSpf(records, hasMx) {
  const spf = records.filter((r) => /^v=spf1\b/i.test(r));
  const note = hasMx ? '' : ' (this domain has no mail servers; publish "v=spf1 -all" to stop others faking it)';
  if (!spf.length) return [finding('medium', 'DNS-SPF', 'No SPF email record', `Anyone can send email pretending to be this domain${note}.`, 'Publish an SPF TXT record, e.g. "v=spf1 include:<your mail provider> -all".')];
  if (spf.length > 1) return [finding('medium', 'DNS-SPF-MULTI', 'More than one SPF record', 'Mail servers treat this as an error.', 'Merge them into one record.')];
  if (/\+all\b/i.test(spf[0])) return [finding('high', 'DNS-SPF-ALL', 'SPF allows every server (+all)', spf[0], 'End the record with -all or ~all.')];
  if (/\?all\b/i.test(spf[0])) return [finding('medium', 'DNS-SPF-NEUTRAL', 'SPF is neutral (?all)', spf[0], 'End the record with -all or ~all.')];
  return [];
}

export function analyzeDmarc(records) {
  const d = records.find((r) => /^v=DMARC1/i.test(r));
  if (!d) return [finding('medium', 'DNS-DMARC', 'No DMARC email record', 'Fake emails using this domain are not rejected, and you get no reports.', 'Publish _dmarc TXT "v=DMARC1; p=quarantine; rua=mailto:you@domain".')];
  if (/;\s*p=none/i.test(d)) return [finding('low', 'DNS-DMARC-NONE', 'DMARC is monitor-only (p=none)', d, 'Move to p=quarantine, then p=reject.')];
  return [];
}

async function dnsChecks(hostname) {
  // Check the registrable-ish domain (strip "www." only; good enough for most sites).
  const domain = hostname.replace(/^www\./i, '');
  const [txt, dmarc, mx, caa] = await Promise.all([doh(domain, 'TXT'), doh(`_dmarc.${domain}`, 'TXT'), doh(domain, 'MX'), doh(domain, 'CAA')]);
  const f = [...analyzeSpf(txt, mx.length > 0), ...analyzeDmarc(dmarc)];
  if (!caa.length) f.push(finding('info', 'DNS-CAA', 'No CAA record', 'Any certificate authority may issue certificates for this domain.', 'Add a CAA record naming your certificate provider.'));
  return { domain, spf: txt.filter((r) => /^v=spf1/i.test(r)), dmarc, mx, caa, findings: f };
}

// ── Main audit ───────────────────────────────────────────────

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

async function checkUrl(url) {
  try {
    let { res, ms } = await timedFetch(url, { method: 'HEAD' }, 10000);
    if ([403, 405, 501].includes(res.status)) ({ res, ms } = await timedFetch(url, { method: 'GET' }, 10000));
    await res.body?.cancel();
    return { url, status: res.status, ms };
  } catch (e) {
    return { url, status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

export async function runWebsiteAudit(input, { allowLocal = false } = {}) {
  const target = normalizeTarget(input, { allowLocal });
  const started = Date.now();
  const findings = [];

  const { chain, res, ms } = await followRedirects(target.href);
  const finalUrl = new URL(chain[chain.length - 1].url);
  const headers = Object.fromEntries(res.headers);
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const contentType = res.headers.get('content-type') || '';
  const { text: html, bytes, truncated } = /html|xml|text/i.test(contentType) || !contentType ? await readText(res) : { text: '', bytes: Number(res.headers.get('content-length') || 0), truncated: false };

  if (res.status >= 500) findings.push(finding('critical', 'BUG-SERVER-ERROR', `Site returns a server error (${res.status})`, `${finalUrl.href} answered ${res.status}.`, 'Check the server/hosting logs; the site is down for visitors.'));
  else if (res.status >= 400) findings.push(finding('critical', 'BUG-PAGE-ERROR', `Page returns ${res.status}`, `${finalUrl.href} answered ${res.status}.`, 'Fix the URL or the server configuration.'));
  if (chain.length > 3) findings.push(finding('low', 'PERF-REDIRECT-CHAIN', `${chain.length - 1} redirects before the page loads`, chain.map((c) => `${c.status} ${c.url}`).join(' → '), 'Redirect straight to the final URL in one hop.'));
  if (finalUrl.host !== target.host && finalUrl.hostname.replace(/^www\./, '') !== target.hostname.replace(/^www\./, '')) findings.push(finding('info', 'INFO-OTHER-HOST', 'Redirects to a different site', `${target.href} → ${finalUrl.href}`, 'Make sure this is intended.'));

  // HTTP → HTTPS redirect check
  let httpRedirect = null;
  if (finalUrl.protocol === 'https:') {
    try {
      const { res: r } = await timedFetch(`http://${finalUrl.host}${finalUrl.pathname}`, {}, 8000);
      await r.body?.cancel();
      const loc = r.headers.get('location') || '';
      httpRedirect = { status: r.status, location: loc };
      if (!(r.status >= 300 && r.status < 400 && loc.startsWith('https://'))) findings.push(finding('medium', 'SEC-NO-HTTPS-REDIRECT', 'http:// version does not redirect to https://', `http://${finalUrl.host}${finalUrl.pathname} answered ${r.status}${loc ? ` → ${loc}` : ''}.`, 'Redirect all HTTP traffic to HTTPS (301/308).'));
    } catch (e) {
      httpRedirect = { error: e.message };
    }
  }

  const headerResult = analyzeHeaders(headers, { isHttps: finalUrl.protocol === 'https:', setCookies, hostname: finalUrl.hostname });
  findings.push(...headerResult.findings);
  if (!/(gzip|br|zstd|deflate)/i.test(headers['content-encoding'] || '') && bytes > 20000) findings.push(finding('low', 'PERF-NO-COMPRESSION', 'HTML is not compressed', `${Math.round(bytes / 1024)} KB sent without gzip/brotli.`, 'Enable gzip or Brotli compression on the server/CDN.'));
  if (ms > 1500) findings.push(finding('medium', 'PERF-SLOW-SERVER', `Server took ${ms} ms to respond`, 'Measured from Cloudflare\'s network. Over 800 ms feels slow.', 'Add page caching or a CDN; check slow database queries or plugins.'));

  const page = html ? analyzeHtml(html, finalUrl.href) : { facts: {}, links: [], assets: [], findings: [] };
  findings.push(...page.findings);
  if (bytes > 500 * 1024) findings.push(finding('low', 'PERF-HEAVY-HTML', `HTML is ${Math.round(bytes / 1024)} KB`, 'Large HTML slows the first paint on phones.', 'Remove inline data/styles or paginate content.'));

  // Links and assets: same-site links first, then external, deduped.
  const resolve = (h) => { try { const u = new URL(h, finalUrl); u.hash = ''; return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
  const uniq = (arr) => [...new Set(arr.map(resolve).filter(Boolean))];
  const allLinks = uniq(page.links).filter((u) => u !== finalUrl.href);
  const internal = allLinks.filter((u) => new URL(u).host === finalUrl.host);
  const external = allLinks.filter((u) => new URL(u).host !== finalUrl.host);
  const toCheck = [...internal.slice(0, 10), ...external.slice(0, LINK_CHECK_LIMIT - Math.min(10, internal.length))];
  const assets = uniq(page.assets).slice(0, ASSET_CHECK_LIMIT);

  const [linkResults, assetResults, robots, securityTxt, sitemap, dns, samples] = await Promise.all([
    pool(toCheck, 5, checkUrl),
    pool(assets, 5, checkUrl),
    timedFetch(`${finalUrl.origin}/robots.txt`, {}, 8000).then(async ({ res: r }) => (r.ok ? (await readText(r, 64 * 1024)).text : null)).catch(() => null),
    timedFetch(`${finalUrl.origin}/.well-known/security.txt`, {}, 8000).then(async ({ res: r }) => (r.ok ? (await readText(r, 16 * 1024)).text : null)).catch(() => null),
    timedFetch(`${finalUrl.origin}/sitemap.xml`, {}, 8000).then(async ({ res: r }) => ({ status: r.status, body: r.ok ? (await readText(r, 256 * 1024)).text : '' })).catch(() => null),
    dnsChecks(finalUrl.hostname).catch((e) => ({ error: e.message, findings: [] })),
    pool([0, 1], 1, async () => { const r = await checkUrl(finalUrl.href); return r.ms; }),
  ]);

  // Bot-blocking sites return 403/429 (or refuse the connection) to automated
  // checks, so only clear "not found"/server errors count as broken.
  const broken = linkResults.filter((r) => r.status === 404 || r.status === 410 || r.status >= 500);
  const unreachable = linkResults.filter((r) => r.status === 0);
  if (unreachable.length) findings.push(finding('low', 'BUG-UNREACHABLE-LINK', `${unreachable.length} link(s) could not be reached`, unreachable.map((r) => `${r.error} ${r.url}`).join('\n'), 'Open them in a browser: the site may be down, the domain expired, or it may just block automated checks.'));
  const brokenInternal = broken.filter((r) => new URL(r.url).host === finalUrl.host);
  const brokenExternal = broken.filter((r) => new URL(r.url).host !== finalUrl.host);
  if (brokenInternal.length) findings.push(finding('high', 'BUG-BROKEN-LINK', `${brokenInternal.length} broken link(s) to your own pages`, brokenInternal.map((r) => `${r.status || r.error} ${r.url}`).join('\n'), 'Fix the links or add 301 redirects to the new pages.'));
  if (brokenExternal.length) findings.push(finding('medium', 'BUG-BROKEN-EXTERNAL', `${brokenExternal.length} broken link(s) to other sites`, brokenExternal.map((r) => `${r.status || r.error} ${r.url}`).join('\n'), 'Update or remove the dead links.'));
  const brokenAssets = assetResults.filter((r) => r.status === 404 || r.status === 410 || r.status >= 500);
  if (brokenAssets.length) findings.push(finding('high', 'BUG-MISSING-ASSET', `${brokenAssets.length} missing image/script/style file(s)`, brokenAssets.map((r) => `${r.status} ${r.url}`).join('\n'), 'Upload the missing files or fix their paths; missing scripts often break features.'));

  if (robots === null) findings.push(finding('info', 'SEO-NO-ROBOTS', 'No robots.txt', 'Not required, but useful to point crawlers to your sitemap.', 'Add robots.txt with a Sitemap: line.'));
  else if (/^\s*disallow:\s*\/\s*$/im.test(robots) && /user-agent:\s*\*/i.test(robots)) findings.push(finding('critical', 'SEO-BLOCKED', 'robots.txt blocks the whole site from search engines', 'Disallow: / for all crawlers.', 'Remove "Disallow: /" unless the site should be hidden.'));
  if (!sitemap || sitemap.status !== 200 || !/<(urlset|sitemapindex)/i.test(sitemap.body)) findings.push(finding('low', 'SEO-NO-SITEMAP', 'No sitemap.xml found', 'Search engines discover pages more slowly.', 'Generate a sitemap.xml and submit it in Google Search Console.'));
  if (!securityTxt || !/^contact:/im.test(securityTxt)) findings.push(finding('info', 'SEC-NO-SECURITY-TXT', 'No security.txt', 'People who find a security problem have no published way to report it.', 'Add /.well-known/security.txt with Contact and Expires (RFC 9116).'));
  findings.push(...(dns.findings || []));

  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const penalty = findings.reduce((s, x) => s + ({ critical: 25, high: 12, medium: 5, low: 2, info: 0 }[x.severity] || 0), 0);

  return {
    kind: 'website',
    target: target.href,
    final_url: finalUrl.href,
    checked_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    score: Math.max(0, Math.round(100 - penalty * 100 / (penalty + 100))),
    status: res.status,
    redirect_chain: chain,
    http_redirect: httpRedirect,
    response_ms: { first: ms, repeat: samples },
    html_kb: Math.round(bytes / 1024),
    html_truncated: truncated,
    security_headers: { grade: headerResult.grade, score: headerResult.score, hsts_preloaded_tld: headerResult.hsts_preloaded_tld, headers: pick(headers, ['server', 'content-type', 'content-encoding', 'cache-control', 'strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy', 'x-powered-by', 'cf-cache-status', 'age']), cookies: headerResult.cookies },
    page: page.facts,
    links: { total: allLinks.length, internal: internal.length, external: external.length, checked: linkResults, assets_checked: assetResults },
    robots_txt: robots ? robots.slice(0, 1500) : null,
    security_txt: !!securityTxt,
    sitemap: sitemap ? { status: sitemap.status, urls: (sitemap.body.match(/<loc>/g) || []).length } : null,
    dns: { domain: dns.domain, spf: dns.spf, dmarc: dns.dmarc, mx: dns.mx, caa: dns.caa, error: dns.error },
    findings,
  };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
