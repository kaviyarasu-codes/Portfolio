// Technology fingerprinting from what a visitor's browser receives:
// HTML, response headers, cookies, script/style URLs and public JS bundles.
// Each rule lists the evidence it matched so results can be checked by hand.

const C = {
  cms: 'CMS / website builder',
  ai: 'AI / no-code builder',
  fw: 'JavaScript framework',
  lib: 'JavaScript library',
  css: 'CSS framework',
  backend: 'Backend framework',
  server: 'Web server',
  host: 'Hosting / CDN',
  data: 'Database / backend service',
  analytics: 'Analytics & tracking',
  chat: 'Chat & marketing',
  pay: 'Payments',
  forms: 'Forms & email',
  security: 'Security',
  fonts: 'Fonts & icons',
  shop: 'E-commerce',
};

// html: matched against the raw HTML; src: against script/style URLs (one per line);
// header: { name: regex }; cookie: regex on cookie names; js: regex on JS bundle text.
// version: regex whose first group is the version, tried against src + html.
const RULES = [
  // CMS and builders
  { name: 'WordPress', cat: C.cms, langs: ['PHP'], db: 'MySQL / MariaDB', html: /\/wp-(content|includes)\/|<meta[^>]+generator[^>]+WordPress/i, version: /WordPress\s+([\d.]+)/i },
  { name: 'Elementor', cat: C.cms, html: /elementor-(kit|widget|section)|\/plugins\/elementor\//i, version: /elementor(?:-pro)?\/assets[^"']*ver=([\d.]+)/i },
  { name: 'Divi', cat: C.cms, html: /et_pb_|\/themes\/Divi\//i },
  { name: 'WooCommerce', cat: C.shop, langs: ['PHP'], html: /woocommerce/i },
  { name: 'Shopify', cat: C.shop, html: /cdn\.shopify\.com|Shopify\.theme/i },
  { name: 'Wix', cat: C.cms, html: /static\.wixstatic\.com|wix-warmup-data|X-Wix-/i, header: { 'x-wix-request-id': /./ } },
  { name: 'Squarespace', cat: C.cms, html: /static1\.squarespace\.com|Squarespace\.Constants/i },
  { name: 'Webflow', cat: C.ai, html: /data-wf-page|webflow\.js|assets\.website-files\.com/i },
  { name: 'Framer', cat: C.ai, html: /framerusercontent\.com|data-framer-|Made in Framer/i },
  { name: 'Lovable (AI app builder)', cat: C.ai, html: /lovable\.dev|gptengineer|data-lov-id|lovable-badge/i },
  { name: 'Bolt.new (AI app builder)', cat: C.ai, html: /bolt\.new|stackblitz.*bolt/i },
  { name: 'v0 by Vercel (AI)', cat: C.ai, html: /v0\.dev|generator[^>]+v0/i },
  { name: 'Durable (AI website builder)', cat: C.ai, html: /durable\.co|durablesites/i },
  { name: 'Hostinger Website Builder', cat: C.ai, html: /zyrosite\.com|zyro\.com|generator[^>]+(Hostinger|Zyro)/i },
  { name: 'GoDaddy Website Builder', cat: C.cms, html: /img1\.wsimg\.com|godaddy.*website.?builder/i },
  { name: 'Google Sites', cat: C.cms, html: /sites\.google\.com\/|gstatic\.com\/_\/atari/i },
  { name: 'Blogger', cat: C.cms, html: /blogger\.com\/static|<meta[^>]+generator[^>]+Blogger/i },
  { name: 'Ghost', cat: C.cms, langs: ['JavaScript (Node.js)'], html: /<meta[^>]+generator[^>]+Ghost/i, version: /Ghost\s+([\d.]+)/i },
  { name: 'Drupal', cat: C.cms, langs: ['PHP'], html: /Drupal\.settings|\/sites\/default\/files\/|<meta[^>]+generator[^>]+Drupal/i, header: { 'x-generator': /drupal/i } },
  { name: 'Joomla', cat: C.cms, langs: ['PHP'], html: /\/media\/jui\/|<meta[^>]+generator[^>]+Joomla/i },
  { name: 'Odoo', cat: C.cms, langs: ['Python'], db: 'PostgreSQL', html: /\/web\/assets\/|odoo\.define|data-oe-model/i },
  { name: 'Zoho Sites', cat: C.cms, html: /zohositescontent|zsite/i },
  { name: 'Weebly', cat: C.cms, html: /editmysite\.com|weebly/i },
  // JS frameworks
  { name: 'Next.js', cat: C.fw, langs: ['JavaScript / TypeScript (React)'], html: /__NEXT_DATA__|\/_next\/static\//, header: { 'x-powered-by': /Next\.js/i } },
  { name: 'Nuxt', cat: C.fw, langs: ['JavaScript / TypeScript (Vue)'], html: /__NUXT__|\/_nuxt\//i },
  { name: 'Gatsby', cat: C.fw, langs: ['JavaScript (React)'], html: /___gatsby|gatsby-/i },
  { name: 'Astro', cat: C.fw, html: /astro-island|<meta[^>]+generator[^>]+Astro/i, version: /Astro v?([\d.]+)/i },
  { name: 'SvelteKit', cat: C.fw, langs: ['JavaScript / TypeScript (Svelte)'], html: /__sveltekit|data-sveltekit/i },
  { name: 'Remix', cat: C.fw, langs: ['JavaScript / TypeScript (React)'], html: /__remixContext/i },
  { name: 'Angular', cat: C.fw, langs: ['TypeScript'], html: /ng-version=|<app-root/i, version: /ng-version="([\d.]+)"/i },
  { name: 'AngularJS (1.x, end of life)', cat: C.fw, html: /ng-app=|angular(\.min)?\.js/i, version: /angular[.-]?([\d.]+)(\.min)?\.js/i },
  { name: 'React', cat: C.fw, langs: ['JavaScript (React)'], html: /data-reactroot|react-dom|__REACT_DEVTOOLS/i, js: /react-dom|createElement\("div"|__SECRET_INTERNALS_DO_NOT_USE/ },
  { name: 'Vue.js', cat: C.fw, langs: ['JavaScript (Vue)'], html: /data-v-[0-9a-f]{6,}|vue(\.min|\.global)?\.js/i, js: /__VUE__|createApp\(/ },
  { name: 'Vite (build tool)', cat: C.fw, html: /<script type="module"[^>]+\/assets\/index-[\w-]+\.js/i },
  { name: 'Flutter Web', cat: C.fw, langs: ['Dart'], html: /flutter\.js|flutter_bootstrap|main\.dart\.js/i },
  // Libraries
  { name: 'jQuery', cat: C.lib, html: /jquery[.-]?[\d.]*(\.min)?\.js|jquery\/[\d.]+\//i, version: /(?:jquery[-./@]v?|jquery(?:\.min)?\.js\?ver=)(\d+\.\d+(?:\.\d+)?)/i },
  { name: 'jQuery UI', cat: C.lib, html: /jquery-ui|jquery\.ui/i, version: /(?:jquery-ui[-./@]v?|jquery\.com\/ui\/|jqueryui\/)(\d+\.\d+(?:\.\d+)?)/i },
  { name: 'Lodash', cat: C.lib, html: /lodash[.-]?[\d.]*(\.min)?\.js/i, version: /lodash[-./@]v?(\d+\.\d+\.\d+)/i },
  { name: 'Moment.js', cat: C.lib, html: /moment[.-]?[\d.]*(\.min)?\.js/i, version: /moment[-./@]v?(\d+\.\d+\.\d+)/i },
  { name: 'GSAP', cat: C.lib, html: /gsap(\.min)?\.js|greensock/i },
  { name: 'Swiper', cat: C.lib, html: /swiper(-bundle)?(\.min)?\.(js|css)/i },
  { name: 'AOS (animate on scroll)', cat: C.lib, html: /aos(\.min)?\.(js|css)|data-aos=/i },
  { name: 'Alpine.js', cat: C.lib, html: /alpinejs|x-data=/i },
  { name: 'htmx', cat: C.lib, html: /htmx(\.min)?\.js|hx-get=|hx-post=/i },
  { name: 'Three.js', cat: C.lib, html: /three(\.module)?(\.min)?\.js/i },
  // CSS frameworks
  { name: 'Bootstrap', cat: C.css, html: /bootstrap(\.bundle)?(\.min)?\.(css|js)/i, version: /bootstrap[-./@]v?(\d+\.\d+\.\d+)/i },
  { name: 'Tailwind CSS', cat: C.css, html: /tailwind|class="[^"]*\b(?:px|py|mt|mb)-\d[^"]*\b(?:text|bg)-(?:gray|slate|blue|red)-\d00/i },
  { name: 'Bulma', cat: C.css, html: /bulma(\.min)?\.css/i },
  { name: 'Materialize / Material UI', cat: C.css, html: /materialize(\.min)?\.css|MuiButton|mui-/i },
  // Backend (from headers/cookies)
  { name: 'PHP', cat: C.backend, langs: ['PHP'], header: { 'x-powered-by': /PHP/i }, cookie: /^PHPSESSID$/i, html: /href="[^"]+\.php[?"]/i, version: /PHP\/([\d.]+)/i },
  { name: 'Laravel', cat: C.backend, langs: ['PHP'], cookie: /^laravel_session$|^XSRF-TOKEN$/i },
  { name: 'CodeIgniter', cat: C.backend, langs: ['PHP'], cookie: /^ci_session$/i },
  { name: 'Django', cat: C.backend, langs: ['Python'], cookie: /^csrftoken$|^sessionid$/i, html: /csrfmiddlewaretoken/i },
  { name: 'Flask', cat: C.backend, langs: ['Python'], header: { server: /Werkzeug/i } },
  { name: 'Ruby on Rails', cat: C.backend, langs: ['Ruby'], html: /<meta name="csrf-param" content="authenticity_token"/i, cookie: /_session$/ },
  { name: 'ASP.NET', cat: C.backend, langs: ['C# (.NET)'], header: { 'x-powered-by': /ASP\.NET/i, 'x-aspnet-version': /./ }, cookie: /^ASP\.NET_SessionId$|^\.AspNetCore\./i, html: /__VIEWSTATE/ },
  { name: 'Java (Servlet / Spring)', cat: C.backend, langs: ['Java'], cookie: /^JSESSIONID$/i },
  { name: 'Express (Node.js)', cat: C.backend, langs: ['JavaScript (Node.js)'], header: { 'x-powered-by': /Express/i }, cookie: /^connect\.sid$/i },
  // Servers and hosting
  { name: 'Nginx', cat: C.server, header: { server: /nginx/i }, version: /nginx\/([\d.]+)/i },
  { name: 'Apache', cat: C.server, header: { server: /Apache/i }, version: /Apache\/([\d.]+)/i },
  { name: 'LiteSpeed', cat: C.server, header: { server: /LiteSpeed/i, 'x-litespeed-cache': /./ } },
  { name: 'Microsoft IIS', cat: C.server, header: { server: /IIS/i }, version: /IIS\/([\d.]+)/i },
  { name: 'OpenResty', cat: C.server, header: { server: /openresty/i } },
  { name: 'Cloudflare', cat: C.host, header: { 'cf-ray': /./, server: /cloudflare/i } },
  { name: 'Cloudflare Pages', cat: C.host, html: /\.pages\.dev/i, header: { 'cf-ray': /./ }, needAll: true },
  { name: 'Vercel', cat: C.host, header: { 'x-vercel-id': /./, server: /Vercel/i } },
  { name: 'Netlify', cat: C.host, header: { 'x-nf-request-id': /./, server: /Netlify/i } },
  { name: 'GitHub Pages', cat: C.host, header: { server: /GitHub\.com/i } },
  { name: 'Firebase Hosting', cat: C.host, header: { 'x-firebase-hosting': /./ }, html: /\.web\.app\b|firebaseapp\.com\/__\/firebase\/init/i },
  { name: 'Amazon CloudFront / AWS', cat: C.host, header: { 'x-amz-cf-id': /./, 'x-amz-request-id': /./, server: /AmazonS3|awselb/i } },
  { name: 'Google Cloud', cat: C.host, header: { server: /Google Frontend|gws/i, via: /google/i } },
  { name: 'Hostinger', cat: C.host, header: { platform: /hostinger/i, 'x-hcdn-request-id': /./, server: /hcdn/i } },
  { name: 'Fastly', cat: C.host, header: { 'x-served-by': /cache-/i, via: /varnish/i } },
  { name: 'Render', cat: C.host, header: { 'rndr-id': /./ } },
  { name: 'Heroku', cat: C.host, header: { via: /vegur/i } },
  // Data / backend services
  { name: 'Firebase', cat: C.data, db: 'Firestore / Realtime Database (NoSQL)', html: /gstatic\.com\/firebasejs|firebaseapp\.com|firebaseio\.com/i, js: /firebaseio\.com|firestore\.googleapis\.com|initializeApp\(\{[^}]*apiKey/ },
  { name: 'Supabase', cat: C.data, db: 'PostgreSQL (Supabase)', html: /\.supabase\.co/i, js: /\.supabase\.co/ },
  { name: 'Appwrite', cat: C.data, html: /appwrite/i, js: /appwrite\.io|new Client\(\)\.setEndpoint/ },
  { name: 'PocketBase', cat: C.data, db: 'SQLite (PocketBase)', js: /pocketbase/i },
  { name: 'MongoDB Atlas / Realm', cat: C.data, db: 'MongoDB', js: /realm\.mongodb\.com|mongodb\+srv:/ },
  { name: 'Hasura / GraphQL', cat: C.data, js: /\/v1\/graphql|hasura\.app/ },
  { name: 'GraphQL API', cat: C.data, js: /["'`][^"'`]*\/graphql["'`]/ },
  { name: 'Strapi (headless CMS)', cat: C.data, js: /\/api\/[a-z-]+\?populate=|strapi/i },
  { name: 'Contentful', cat: C.data, js: /cdn\.contentful\.com|images\.ctfassets\.net/, html: /ctfassets\.net/i },
  { name: 'Sanity', cat: C.data, js: /\.sanity\.io/, html: /cdn\.sanity\.io/i },
  // Analytics and marketing
  { name: 'Google Analytics', cat: C.analytics, html: /google-analytics\.com|gtag\(|googletagmanager\.com\/gtag/i },
  { name: 'Google Tag Manager', cat: C.analytics, html: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i },
  { name: 'Meta Pixel (Facebook)', cat: C.analytics, html: /connect\.facebook\.net[^"']*fbevents|fbq\(/i },
  { name: 'Microsoft Clarity', cat: C.analytics, html: /clarity\.ms/i },
  { name: 'Hotjar', cat: C.analytics, html: /hotjar\.com|hjid/i },
  { name: 'LinkedIn Insight', cat: C.analytics, html: /snap\.licdn\.com/i },
  { name: 'Cloudflare Web Analytics', cat: C.analytics, html: /static\.cloudflareinsights\.com/i },
  { name: 'Google Ads', cat: C.analytics, html: /googleadservices\.com|AW-\d{6,}/i },
  { name: 'Google AdSense', cat: C.analytics, html: /pagead2\.googlesyndication\.com/i },
  { name: 'Tawk.to', cat: C.chat, html: /embed\.tawk\.to/i },
  { name: 'Crisp chat', cat: C.chat, html: /client\.crisp\.chat/i },
  { name: 'Intercom', cat: C.chat, html: /widget\.intercom\.io/i },
  { name: 'Zoho SalesIQ', cat: C.chat, html: /salesiq\.zoho/i },
  { name: 'WhatsApp chat link', cat: C.chat, html: /wa\.me\/|api\.whatsapp\.com\/send/i },
  { name: 'Elfsight widgets', cat: C.chat, html: /elfsight/i },
  // Payments, forms, security
  { name: 'Razorpay', cat: C.pay, html: /checkout\.razorpay\.com|razorpay/i },
  { name: 'Stripe', cat: C.pay, html: /js\.stripe\.com/i },
  { name: 'PayPal', cat: C.pay, html: /paypal\.com\/sdk|paypalobjects/i },
  { name: 'PhonePe / UPI', cat: C.pay, html: /phonepe|upi:\/\/pay/i },
  { name: 'Instamojo', cat: C.pay, html: /instamojo/i },
  { name: 'EmailJS', cat: C.forms, html: /emailjs/i, js: /api\.emailjs\.com/ },
  { name: 'Formspree', cat: C.forms, html: /formspree\.io/i },
  { name: 'Netlify Forms', cat: C.forms, html: /data-netlify="true"|netlify-honeypot/i },
  { name: 'Google Forms', cat: C.forms, html: /docs\.google\.com\/forms/i },
  { name: 'Contact Form 7', cat: C.forms, html: /wpcf7/i },
  { name: 'WPForms', cat: C.forms, html: /wpforms/i },
  { name: 'Google reCAPTCHA', cat: C.security, html: /google\.com\/recaptcha|grecaptcha/i },
  { name: 'hCaptcha', cat: C.security, html: /hcaptcha\.com/i },
  { name: 'Cloudflare Turnstile', cat: C.security, html: /challenges\.cloudflare\.com\/turnstile/i },
  { name: 'Wordfence', cat: C.security, html: /wordfence/i },
  // Fonts and icons
  { name: 'Google Fonts', cat: C.fonts, html: /fonts\.googleapis\.com/i },
  { name: 'Font Awesome', cat: C.fonts, html: /font-?awesome|\bfa-(solid|regular|brands)\b|\bfa fa-/i, version: /font-?awesome[/@-]v?(\d+\.\d+\.\d+)/i },
  { name: 'Phosphor Icons', cat: C.fonts, html: /phosphor-icons|class="ph ph-/i },
  { name: 'Material Icons', cat: C.fonts, html: /Material\+Icons|material-icons|material-symbols/i },
  { name: 'Bootstrap Icons', cat: C.fonts, html: /bootstrap-icons/i },
];

// Library versions with well-known, fixed security issues.
const KNOWN_ISSUES = [
  { name: 'jQuery', below: '3.5.0', severity: 'medium', note: 'Versions before 3.5.0 have known XSS issues (CVE-2020-11022, CVE-2020-11023).', fix: 'Upgrade jQuery to the latest 3.x and test plugins.' },
  { name: 'jQuery UI', below: '1.13.0', severity: 'medium', note: 'Versions before 1.13.0 have known XSS issues (CVE-2021-41182/41183/41184).', fix: 'Upgrade jQuery UI to 1.13 or later.' },
  { name: 'Bootstrap', below: '3.4.1', severity: 'medium', note: 'Bootstrap before 3.4.1 has known XSS issues in tooltips/popovers (CVE-2019-8331).', fix: 'Upgrade Bootstrap (3.4.1+, or 4.3.1+/5.x).' },
  { name: 'Lodash', below: '4.17.21', severity: 'medium', note: 'Lodash before 4.17.21 has command-injection/prototype-pollution issues (CVE-2021-23337, CVE-2020-8203).', fix: 'Upgrade Lodash to 4.17.21+.' },
  { name: 'Moment.js', below: '2.29.4', severity: 'low', note: 'Moment before 2.29.4 has a ReDoS issue (CVE-2022-31129), and Moment is no longer developed.', fix: 'Upgrade to 2.29.4+ or move to date-fns / Day.js / Intl.' },
  { name: 'AngularJS (1.x, end of life)', below: '999', severity: 'medium', note: 'AngularJS reached end of life in January 2022 and gets no security fixes.', fix: 'Plan a migration to a supported framework.' },
];

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * @param {{html:string, headers:Object, cookies:string[], srcs:string[], js:string}} input
 */
export function detectTechnologies({ html = '', headers = {}, cookies = [], srcs = [], js = '' }) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v);
  const cookieNames = cookies.map((c) => c.split('=')[0].trim());
  const srcText = srcs.join('\n');
  const found = [];
  for (const r of RULES) {
    const evidence = [];
    if (r.html && (r.html.test(html) || r.html.test(srcText))) evidence.push('page code');
    if (r.header) for (const [name, re] of Object.entries(r.header)) if (h[name] && re.test(h[name])) evidence.push(`${name} header`);
    if (r.cookie) { const c = cookieNames.find((n) => r.cookie.test(n)); if (c) evidence.push(`cookie ${c}`); }
    if (r.js && js && r.js.test(js)) evidence.push('JavaScript files');
    if (!evidence.length || (r.needAll && evidence.length < 2)) continue;
    let version = null;
    if (r.version) {
      const m = r.version.exec(srcText) || r.version.exec(html) || Object.values(h).map((v) => r.version.exec(v)).find(Boolean);
      if (m) version = m[1];
    }
    found.push({ name: r.name, category: r.cat, version, evidence: [...new Set(evidence)], langs: r.langs || [], db: r.db || null });
  }

  // Languages: always the front-end trio; back-end ones only with evidence.
  const langs = new Map([['HTML', 'confirmed'], ['CSS', 'confirmed']]);
  if (srcs.some((s) => /\.m?js(\?|$)/i.test(s)) || /<script\b/i.test(html)) langs.set('JavaScript', 'confirmed');
  for (const t of found) for (const l of t.langs) if (!langs.has(l)) langs.set(l, t.category === C.backend || t.category === C.cms ? 'confirmed' : 'likely');
  const databases = [...new Set(found.map((t) => t.db).filter(Boolean))];

  const findings = [];
  for (const t of found) {
    const issue = KNOWN_ISSUES.find((k) => k.name === t.name);
    if (issue && (issue.below === '999' || (t.version && cmpVersion(t.version, issue.below) < 0))) {
      findings.push({ severity: issue.severity, id: 'TECH-OUTDATED-LIB', title: `${t.name}${t.version ? ` ${t.version}` : ''} has known security issues`, detail: issue.note, fix: issue.fix });
    }
  }
  const wp = found.find((t) => t.name === 'WordPress');
  if (wp && wp.version) findings.push({ severity: 'low', id: 'TECH-WP-VERSION', title: `WordPress version ${wp.version} is public`, detail: 'The version number helps attackers pick known exploits.', fix: 'Hide the generator tag (security plugin) and keep WordPress, themes and plugins updated.' });

  return {
    technologies: found.map(({ langs: _l, db: _d, ...t }) => t),
    languages: [...langs].map(([name, confidence]) => ({ name, confidence })),
    databases,
    findings,
  };
}

// ── DNS-based providers ──────────────────────────────────────

export function dnsProvider(ns = []) {
  const s = ns.join(' ').toLowerCase();
  const map = [[/cloudflare/, 'Cloudflare DNS'], [/domaincontrol/, 'GoDaddy DNS'], [/dns-parking|hostinger/, 'Hostinger DNS'], [/awsdns/, 'Amazon Route 53'], [/googledomains|ns-cloud|google\.com/, 'Google Cloud DNS'], [/registrar-servers/, 'Namecheap DNS'], [/bigrock|resellerclub/, 'BigRock DNS'], [/vercel-dns/, 'Vercel DNS'], [/nsone/, 'NS1'], [/netlify/, 'Netlify DNS'], [/digitalocean/, 'DigitalOcean DNS'], [/azure-dns/, 'Azure DNS'], [/wixdns/, 'Wix DNS'], [/squarespacedns/, 'Squarespace DNS'], [/zoho/, 'Zoho DNS'], [/cpanel|hostgator|bluehost/, 'Shared hosting DNS (cPanel)']];
  return (map.find(([re]) => re.test(s)) || [null, ns.length ? 'Other' : null])[1];
}

export function mailProvider(mx = []) {
  const s = mx.join(' ').toLowerCase();
  const map = [[/google\.com|googlemail/, 'Google Workspace (Gmail)'], [/outlook\.com|protection\.outlook/, 'Microsoft 365 (Outlook)'], [/zoho/, 'Zoho Mail'], [/titan\.email/, 'Titan Mail'], [/hostinger/, 'Hostinger Mail'], [/secureserver\.net/, 'GoDaddy Mail'], [/mimecast/, 'Mimecast'], [/protonmail/, 'Proton Mail'], [/improvmx/, 'ImprovMX forwarding'], [/mx\.cloudflare\.net/, 'Cloudflare Email Routing']];
  return (map.find(([re]) => re.test(s)) || [null, mx.length ? 'Other / self-hosted' : null])[1];
}

// ── Public JavaScript scan ───────────────────────────────────

const SECRET_PATTERNS = [
  ['critical', 'Private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----(?:\\n|\s)+[A-Za-z0-9+/=]{64,}/g],
  ['critical', 'Stripe live secret key', /\bsk_live_[0-9a-zA-Z]{20,}/g],
  ['high', 'AWS access key ID', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['high', 'GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['high', 'OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ['high', 'Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['high', 'SendGrid API key', /\bSG\.[\w-]{22}\.[\w-]{43}\b/g],
  ['high', 'Slack token', /\bxox[baprs]-[0-9A-Za-z-]{10,}/g],
  ['high', 'Razorpay secret', /\brzp_live_[A-Za-z0-9]{14,}\b[^\n]{0,40}(?:secret|key_secret)/gi],
];

function redact(s) { return s.length <= 12 ? `${s.slice(0, 4)}…` : `${s.slice(0, 8)}…${s.slice(-3)}`; }

function jwtRole(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role || null;
  } catch { return null; }
}

/** Scans already-downloaded public JS for leaked secrets and backend hints. */
export function scanJavaScript(files) {
  const findings = [];
  const endpoints = new Set();
  const seen = new Set();
  for (const { url, text } of files) {
    for (const [sev, label, re] of SECRET_PATTERNS) {
      for (const m of text.matchAll(re)) {
        if (seen.has(m[0])) continue;
        seen.add(m[0]);
        findings.push({ severity: sev, id: 'SEC-JS-SECRET', title: `Possible ${label} in public JavaScript`, detail: `${redact(m[0])} in ${url}`, fix: 'Anyone can read this file. Revoke/rotate the key now and move the call to a server.' });
      }
    }
    for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
      const role = jwtRole(m[0]);
      if (role === 'service_role' && !seen.has(m[0])) { seen.add(m[0]); findings.push({ severity: 'critical', id: 'DB-SUPABASE-SERVICE-KEY', title: 'Supabase service_role key is public', detail: `${redact(m[0])} in ${url}. This key bypasses all database security rules.`, fix: 'Rotate it in Supabase → Settings → API immediately; only the anon key may be used in the browser.' }); }
      if (role === 'anon' && !seen.has('anon')) { seen.add('anon'); findings.push({ severity: 'info', id: 'DB-SUPABASE-ANON', title: 'Supabase anon key in the site (normal)', detail: 'The anon key is meant to be public, so your data is protected only by Row Level Security (RLS).', fix: 'In Supabase → Table editor, make sure RLS is enabled with policies on every table.' }); }
    }
    for (const m of text.matchAll(/https:\/\/([a-z0-9-]+\.)+(supabase\.co|firebaseio\.com|firebasedatabase\.app|appwrite\.io|hasura\.app|herokuapp\.com|onrender\.com|railway\.app|vercel\.app|azurewebsites\.net|amazonaws\.com|run\.app)\b/gi)) endpoints.add(m[0]);
    for (const m of text.matchAll(/["'`](https:\/\/api\.[a-z0-9.-]+\.[a-z]{2,}(?:\/[^"'`\s]*)?)["'`]/gi)) endpoints.add(m[1].split('?')[0]);
    if (/\/\/[#@] sourceMappingURL=(?!data:)/.test(text.slice(-500)) && !seen.has(`map:${url}`)) {
      seen.add(`map:${url}`);
      findings.push({ severity: 'low', id: 'FE-SOURCE-MAP', title: 'Source maps are published', detail: `${url} points to a .map file, which lets anyone read the original source code.`, fix: 'Disable production source maps (e.g. Vite build.sourcemap=false) or upload them privately to your error tracker.' });
    }
    if (/firebaseio\.com|firestore\.googleapis|initializeApp\(/.test(text) && !seen.has('fb')) {
      seen.add('fb');
      findings.push({ severity: 'info', id: 'DB-FIREBASE', title: 'Uses Firebase from the browser', detail: 'The web config is public by design; data safety depends on Firestore/Realtime Database security rules.', fix: 'Check that rules do not allow public read/write (Firebase console → Rules), and enable App Check.' });
    }
  }
  return { findings, endpoints: [...endpoints].slice(0, 20) };
}
