// Site Inspector popup: reads the current tab (only when you click the icon),
// detects technologies with the same rules as the Site Audit tool, adds what
// only a live page reveals (JavaScript globals), and lists quick issues.
import { detectTechnologies, versionFindings } from './tech.js';

const AUDIT_URL = 'https://kaviyarasu-portfolio.pages.dev/site-audit';
const $ = (id) => document.getElementById(id);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

/* ── Runs inside the page (MAIN world) ─────────────────── */

function collectFromPage() {
  const g = window;
  const take = (fn) => { try { return fn(); } catch { return undefined; } };
  const globals = {};
  const has = (name, fn) => { const r = take(fn); if (r) globals[name] = typeof r === 'string' || typeof r === 'number' ? String(r) : ''; };
  has('jQuery', () => g.jQuery && (g.jQuery.fn && g.jQuery.fn.jquery || true));
  has('jQuery UI', () => g.jQuery && g.jQuery.ui && (g.jQuery.ui.version || true));
  has('Bootstrap', () => (g.bootstrap && g.bootstrap.Tooltip && g.bootstrap.Tooltip.VERSION) || (g.jQuery && g.jQuery.fn.tooltip && g.jQuery.fn.tooltip.Constructor && g.jQuery.fn.tooltip.Constructor.VERSION));
  has('AngularJS (1.x, end of life)', () => g.angular && g.angular.version && g.angular.version.full);
  has('Angular', () => { const el = document.querySelector('[ng-version]'); return el && el.getAttribute('ng-version'); });
  has('Next.js', () => g.__NEXT_DATA__ && ((g.next && g.next.version) || true));
  has('Nuxt', () => g.__NUXT__ || g.$nuxt);
  has('Gatsby', () => g.___gatsby);
  has('Remix', () => g.__remixContext);
  has('Lodash', () => g._ && typeof g._.chunk === 'function' && g._.VERSION);
  has('Moment.js', () => g.moment && g.moment.version);
  has('GSAP', () => g.gsap && (g.gsap.version || true));
  has('Swiper', () => g.Swiper);
  has('Alpine.js', () => g.Alpine && (g.Alpine.version || true));
  has('htmx', () => g.htmx && (g.htmx.version || true));
  has('Three.js', () => g.THREE && (g.THREE.REVISION ? `r${g.THREE.REVISION}` : true));
  has('WordPress', () => g.wp && (g.wp.i18n || g.wp.hooks || g.wp.apiFetch));
  has('Elementor', () => g.elementorFrontend && ((g.elementorFrontendConfig && g.elementorFrontendConfig.version) || true));
  has('WooCommerce', () => g.wc_add_to_cart_params || g.woocommerce_params);
  has('Shopify', () => g.Shopify && (g.Shopify.shop || true));
  has('Wix', () => g.wixBiSession || g.wixEmbedsAPI);
  has('Webflow', () => g.Webflow);
  has('Google Analytics', () => g.gtag || g.ga || g.GoogleAnalyticsObject);
  has('Google Tag Manager', () => g.google_tag_manager);
  has('Meta Pixel (Facebook)', () => g.fbq);
  has('Microsoft Clarity', () => g.clarity);
  has('Hotjar', () => g.hj);
  has('Razorpay', () => g.Razorpay);
  has('Stripe', () => g.Stripe);
  has('Firebase', () => g.firebase && (g.firebase.SDK_VERSION || true));
  has('Supabase', () => g.supabase && g.supabase.createClient);
  has('Laravel Livewire', () => g.Livewire);
  has('Hotwire Turbo', () => g.Turbo);
  has('Tawk.to', () => g.Tawk_API);
  has('Crisp chat', () => g.$crisp);
  has('Intercom', () => g.Intercom);
  has('Google reCAPTCHA', () => g.grecaptcha);
  // React and Vue leave markers on DOM nodes rather than globals.
  take(() => {
    const els = document.querySelectorAll('body *');
    for (let i = 0; i < Math.min(els.length, 400); i++) {
      if (Object.keys(els[i]).some((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$') || k === '_reactRootContainer')) { globals.React = (g.React && g.React.version) || ''; break; }
    }
  });
  take(() => {
    const app = [...document.querySelectorAll('[data-v-app], #app, #__nuxt')].map((e) => e.__vue_app__).find(Boolean);
    if (app) globals['Vue.js'] = app.version || '';
    else if (g.Vue) globals['Vue.js'] = g.Vue.version || '';
  });
  const nav = take(() => performance.getEntriesByType('navigation')[0]);
  return {
    url: location.href,
    title: document.title,
    html: document.documentElement.outerHTML.slice(0, 500000),
    srcs: [...document.scripts].map((s) => s.src).filter(Boolean).concat([...document.querySelectorAll('link[rel~="stylesheet"]')].map((l) => l.href)),
    resources: take(() => performance.getEntriesByType('resource').map((r) => r.name).slice(0, 500)) || [],
    cookies: document.cookie ? document.cookie.split(';').map((c) => c.trim()) : [],
    globals,
    timing: nav ? { ttfb: Math.round(nav.responseStart), load: Math.round(nav.loadEventEnd || nav.domComplete), kb: Math.round((nav.transferSize || 0) / 1024) } : null,
    favicon: (document.querySelector('link[rel~="icon"]') || {}).href || '',
  };
}

// Runs in the extension's isolated world: response headers of the page itself.
async function headersFromPage() {
  try {
    const res = await fetch(location.href, { method: 'HEAD', cache: 'no-store', credentials: 'include' });
    return Object.fromEntries(res.headers);
  } catch { return {}; }
}

/* ── Categories for technologies found only through page globals ─── */

const GLOBAL_CATEGORY = {
  React: 'JavaScript framework', 'Vue.js': 'JavaScript framework', 'Laravel Livewire': 'Backend framework', 'Hotwire Turbo': 'JavaScript library',
};
const CATEGORY_ORDER = ['CMS / website builder', 'AI / no-code builder', 'E-commerce', 'JavaScript framework', 'JavaScript library', 'CSS framework', 'Backend framework', 'Database / backend service', 'Web server', 'Hosting / CDN', 'Analytics & tracking', 'Chat & marketing', 'Payments', 'Forms & email', 'Security', 'Fonts & icons'];
const ICON = {
  'CMS / website builder': 'M3 4h18v16H3zM3 9h18M9 9v11',
  'AI / no-code builder': 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z',
  'E-commerce': 'M3 4h2l2 12h11l2-8H6M9 20h.01M17 20h.01',
  'JavaScript framework': 'M8 7l-5 5 5 5M16 7l5 5-5 5',
  'JavaScript library': 'M4 6h16M4 12h16M4 18h10',
  'CSS framework': 'M4 20l6-6M14 4l6 6-8 8-6-6z',
  'Backend framework': 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
  'Database / backend service': 'M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0zM4 6c0 2 16 2 16 0M4 12c0 2 16 2 16 0',
  'Web server': 'M4 5h16v6H4zM4 13h16v6H4z',
  'Hosting / CDN': 'M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z',
  'Analytics & tracking': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  'Chat & marketing': 'M4 5h16v11H8l-4 4z',
  Payments: 'M3 6h18v12H3zM3 10h18',
  'Forms & email': 'M3 6h18v12H3zM3 6l9 7 9-7',
  Security: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z',
  'Fonts & icons': 'M5 19L12 5l7 14M8 13h8',
};

function icon(cat) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICON[cat] || 'M4 4h16v16H4z');
  svg.append(p);
  return svg;
}

// Not official logos: a coloured initial badge per technology.
function avatar(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return h('span', { class: 'avatar', style: `background:hsl(${hash % 360} 55% 42%)`, 'aria-hidden': 'true', text: initials });
}

/* ── Quick issues ──────────────────────────────────────── */

function quickIssues(page, headers, tech) {
  const out = [];
  const add = (severity, title, detail) => out.push({ severity, title, detail });
  const u = new URL(page.url);
  const hd = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const gotHeaders = Object.keys(hd).length > 0;
  const html = page.html;
  if (u.protocol !== 'https:') add('high', 'Not using HTTPS', 'Visitors\' data travels unencrypted.');
  if (gotHeaders && u.protocol === 'https:') {
    if (!hd['strict-transport-security'] && !/\.(dev|app|page)$/i.test(u.hostname)) add('medium', 'No HSTS header', 'Browsers are not told to always use HTTPS.');
    if (!hd['content-security-policy']) add('medium', 'No Content-Security-Policy', 'No browser protection against injected scripts.');
    if (!hd['x-frame-options'] && !/frame-ancestors/i.test(hd['content-security-policy'] || '')) add('medium', 'No clickjacking protection', 'Other sites can embed this page in a frame.');
    if ((hd['x-content-type-options'] || '').toLowerCase() !== 'nosniff') add('low', 'No X-Content-Type-Options', 'Add "nosniff".');
  }
  if (hd['x-powered-by']) add('low', 'Technology disclosed in X-Powered-By', hd['x-powered-by']);
  if (/\d/.test(hd.server || '')) add('low', 'Server version disclosed', hd.server);
  for (const f of tech.findings) add(f.severity, f.title, f.detail);
  const mixed = page.resources.filter((r) => r.startsWith('http:'));
  if (u.protocol === 'https:' && mixed.length) add('medium', `${mixed.length} file(s) loaded over HTTP`, mixed.slice(0, 3).join(', '));
  if (!/<meta[^>]+name=["']?viewport/i.test(html)) add('high', 'Not mobile-friendly (no viewport tag)', 'Phones show a zoomed-out desktop page.');
  if (!/<html[^>]*\slang=/i.test(html)) add('medium', 'Missing page language', 'Add lang="en" (or the right language) to <html>.');
  if (!/<meta[^>]+name=["']?description/i.test(html)) add('low', 'No meta description', 'Search results will show random text.');
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const missingAlt = imgs.filter((t) => !/\salt=/i.test(t)).length;
  if (missingAlt) add('medium', `${missingAlt} image(s) without alt text`, 'Screen readers cannot describe them.');
  if (page.timing && page.timing.ttfb > 800) add('medium', `Slow server response (${page.timing.ttfb} ms)`, 'Measured from your browser on this visit.');
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* ── Render ────────────────────────────────────────────── */

let current = null;

function render(page, headers) {
  const tech = detectTechnologies({ html: page.html, headers, cookies: page.cookies, srcs: [...page.srcs, ...page.resources] });
  const byName = new Map(tech.technologies.map((t) => [t.name, t]));
  for (const [name, version] of Object.entries(page.globals)) {
    const known = byName.get(name);
    if (known) {
      if (!known.version && version) known.version = version;
      if (!known.evidence.includes('live page')) known.evidence.push('live page');
    } else {
      const t = { name, category: GLOBAL_CATEGORY[name] || guessCategory(name), version: version || null, evidence: ['live page'] };
      tech.technologies.push(t);
      byName.set(name, t);
    }
  }
  // Version checks again, now that live versions (e.g. window.jQuery.fn.jquery) are known.
  const findings = [...tech.findings];
  for (const f of versionFindings(tech.technologies)) if (!findings.some((x) => x.title === f.title)) findings.push(f);
  const issues = quickIssues(page, headers, { findings });
  current = { page, tech: tech.technologies, languages: tech.languages, databases: tech.databases, issues };

  const u = new URL(page.url);
  $('host').textContent = u.hostname;
  $('status').textContent = `${tech.technologies.length} technologies · ${issues.length} quick issues${page.timing ? ` · ${page.timing.load} ms load` : ''}`;
  if (page.favicon) $('favicon').src = page.favicon;

  const view = $('viewTech');
  view.replaceChildren();
  if (tech.languages.length) view.append(h('div', { class: 'langs', 'aria-label': 'Languages' }, tech.languages.map((l) => h('span', { class: `lang ${l.confidence === 'likely' ? 'likely' : ''}`, text: l.confidence === 'likely' ? `${l.name}?` : l.name }))));
  const groups = new Map();
  for (const t of tech.technologies) (groups.get(t.category) || groups.set(t.category, []).get(t.category)).push(t);
  const cats = [...groups.keys()].sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 99) % 99 - (CATEGORY_ORDER.indexOf(b) + 99) % 99);
  if (!cats.length) view.append(h('p', { class: 'empty', text: 'No known technologies detected. It may be hand-coded or heavily customised.' }));
  for (const cat of cats) {
    view.append(h('div', { class: 'cat' },
      h('div', { class: 'cat-head' }, icon(cat), cat),
      groups.get(cat).map((t) => h('div', { class: 'tech' }, avatar(t.name),
        h('span', { class: 'tech-name' }, t.name, h('small', { text: `found in ${t.evidence.join(', ')}` })),
        t.version ? h('span', { class: 'ver', text: t.version }) : null))));
  }
  if (tech.databases.length) view.append(h('div', { class: 'cat' }, h('div', { class: 'cat-head' }, icon('Database / backend service'), 'Likely database'), tech.databases.map((d) => h('div', { class: 'tech' }, avatar(d), h('span', { class: 'tech-name', text: d })))));

  $('issueCount').textContent = String(issues.length);
  const iv = $('viewIssues');
  iv.replaceChildren(...(issues.length ? issues.map((i) => h('div', { class: 'issue' }, h('span', { class: `dot ${i.severity}`, title: i.severity }), h('div', {}, h('strong', { text: i.title }), i.detail ? h('p', { text: i.detail }) : null))) : [h('p', { class: 'empty', text: 'No quick issues found. Run the full audit for a deeper check.' })]));
}

function guessCategory(name) {
  if (/Analytics|Pixel|Clarity|Hotjar|Tag Manager/.test(name)) return 'Analytics & tracking';
  if (/Razorpay|Stripe/.test(name)) return 'Payments';
  if (/Tawk|Crisp|Intercom/.test(name)) return 'Chat & marketing';
  if (/Firebase|Supabase/.test(name)) return 'Database / backend service';
  if (/reCAPTCHA/.test(name)) return 'Security';
  return 'JavaScript library';
}

/* ── Start ─────────────────────────────────────────────── */

async function inspect() {
  const params = new URLSearchParams(location.search);
  let tabId = Number(params.get('tab')) || null; // used by automated tests
  if (!tabId) [{ id: tabId }] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || '')) {
    $('status').textContent = 'Open a website (http or https) and click the icon again.';
    $('viewTech').replaceChildren(h('p', { class: 'empty', text: 'Browser pages, the Chrome Web Store and local files cannot be inspected.' }));
    return;
  }
  try {
    const [[{ result: page }], [{ result: headers }]] = await Promise.all([
      chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: collectFromPage }),
      chrome.scripting.executeScript({ target: { tabId }, func: headersFromPage }),
    ]);
    render(page, headers || {});
  } catch (e) {
    $('status').textContent = 'This page could not be inspected.';
    $('viewTech').replaceChildren(h('p', { class: 'empty', text: e.message }));
  }
}

for (const [tabBtn, other] of [[$('tabTech'), $('tabIssues')], [$('tabIssues'), $('tabTech')]]) {
  tabBtn.addEventListener('click', () => {
    tabBtn.setAttribute('aria-selected', 'true'); tabBtn.tabIndex = 0;
    other.setAttribute('aria-selected', 'false'); other.tabIndex = -1;
    $(tabBtn.getAttribute('aria-controls')).hidden = false;
    $(other.getAttribute('aria-controls')).hidden = true;
  });
}

$('auditBtn').addEventListener('click', async () => {
  const url = current?.page?.url || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.url || '';
  chrome.tabs.create({ url: `${AUDIT_URL}${url ? `?url=${encodeURIComponent(url)}` : ''}` });
});

$('copyBtn').addEventListener('click', async () => {
  if (!current) return;
  const lines = [`${new URL(current.page.url).hostname} is built with:`];
  if (current.languages.length) lines.push(`Languages: ${current.languages.map((l) => l.name).join(', ')}`);
  const groups = {};
  for (const t of current.tech) (groups[t.category] ||= []).push(`${t.name}${t.version ? ` ${t.version}` : ''}`);
  for (const [cat, items] of Object.entries(groups)) lines.push(`${cat}: ${items.join(', ')}`);
  if (current.issues.length) lines.push('', 'Quick issues:', ...current.issues.slice(0, 8).map((i) => `- ${i.title}`));
  await navigator.clipboard.writeText(lines.join('\n'));
  $('copyBtn').textContent = 'Copied ✓';
  setTimeout(() => { $('copyBtn').textContent = 'Copy list'; }, 1500);
});

inspect();
