// Owner-only audit tool (site-audit.html).
// Website checks run on Cloudflare Pages Functions (/api/*); APKs are analysed
// in the browser (apk-audit.js). Everything that came from an audited site or
// app is inserted with textContent, never as HTML.
import { auditApk } from './apk-audit.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDSH6Ryd0MtbQOTiK1GYBSQa8oe65TGXpA',
  authDomain: 'portfolio-contact-39c14.firebaseapp.com',
  projectId: 'portfolio-contact-39c14',
  appId: '1:1011375934660:web:ac5b4ab463dc122de48d91',
};
const FIREBASE = 'https://www.gstatic.com/firebasejs/12.11.0';
// Local development only: `wrangler pages dev` with DEV_BYPASS_AUTH=true and ?dev in the URL.
const DEV = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('dev');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
const HISTORY_KEY = 'sa-history';
const HISTORY_MAX = 12;

const $ = (id) => document.getElementById(id);
let auth = null;
let fb = null;
let currentUser = null;
let busy = false;

/* ── Small safe DOM builder ─────────────────────────────── */

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* ── Styled notice dialog (replaces window.alert) ───────── */

function notice(title, message, { kind = 'info', focusAfter = null } = {}) {
  const dlg = $('saDialog');
  dlg.dataset.kind = kind;
  $('saDialogTitle').textContent = title;
  $('saDialogText').textContent = message;
  dlg.onclose = () => { if (focusAfter) focusAfter.focus(); };
  if (typeof dlg.showModal === 'function') dlg.showModal(); else window.alert(`${title}\n\n${message}`);
}
$('saDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

/* ── Theme ──────────────────────────────────────────────── */

function syncTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  $('themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0B0D12' : '#F6F7F9');
}
$('themeBtn').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  store.set('kk-theme', next);
  syncTheme();
});
syncTheme();

/* ── Auth ───────────────────────────────────────────────── */

function showView(name) {
  $('bootMsg').hidden = true;
  $('loginView').hidden = name !== 'login';
  $('toolView').hidden = name !== 'tool';
  $('signOutBtn').hidden = name !== 'tool' || DEV;
  if (name === 'tool') renderHistory();
}

async function initAuth() {
  if (DEV) { showView('tool'); return; }
  try {
    const [{ initializeApp }, authMod] = await Promise.all([import(`${FIREBASE}/firebase-app.js`), import(`${FIREBASE}/firebase-auth.js`)]);
    fb = authMod;
    auth = fb.getAuth(initializeApp(FIREBASE_CONFIG));
    fb.onAuthStateChanged(auth, (user) => { currentUser = user; showView(user ? 'tool' : 'login'); });
  } catch (e) {
    $('bootMsg').textContent = `Could not load sign-in (${e.message}). Check your connection and reload.`;
  }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('loginError');
  err.hidden = true;
  $('loginBtn').disabled = true;
  try {
    await fb.signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
  } catch (ex) {
    err.textContent = ex.code === 'auth/too-many-requests' ? 'Too many attempts. Wait a few minutes.' : 'Sign-in failed. Check your email and password.';
    err.hidden = false;
  } finally {
    $('loginBtn').disabled = false;
  }
});
$('signOutBtn').addEventListener('click', () => fb && fb.signOut(auth));

async function api(path, body) {
  const token = DEV ? 'dev' : await currentUser.getIdToken();
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ── Tabs ───────────────────────────────────────────────── */

const tabs = [$('tabWeb'), $('tabApk')];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next);
    next.focus();
  });
});

/* ── Progress steps ─────────────────────────────────────── */

function startSteps(labels) {
  const ol = $('steps');
  ol.replaceChildren(...labels.map((l, i) => h('li', { class: 'sa-step', 'data-state': 'pending', id: `step${i}` }, h('span', { class: 'sa-step-dot', 'aria-hidden': 'true' }), h('span', { class: 'sa-step-label', text: l }), h('span', { class: 'sa-step-note' }))));
  $('progress').hidden = false;
}
function step(i, state, note = '') {
  const li = $(`step${i}`);
  if (!li) return;
  li.dataset.state = state;
  li.querySelector('.sa-step-note').textContent = note;
}

function setBusy(on) {
  busy = on;
  for (const id of ['runWebBtn', 'runApkBtn']) $(id).disabled = on;
}

/* ── Website audit ──────────────────────────────────────── */

$('panelWeb').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const url = $('urlInput').value.trim();
  if (!url) { notice('Add a website address', 'Paste a link such as example.com or https://app.example.com/login.', { focusAfter: $('urlInput') }); return; }
  if (!$('permWeb').checked) { notice('Permission needed', 'Tick the box to confirm you own this site or have the owner\'s permission to review it.', { focusAfter: $('permWeb') }); return; }
  const useLh = $('optLighthouse').checked;
  const useAi = $('optAiWeb').checked;
  setBusy(true);
  $('results').hidden = true;
  startSteps(['Checking the website (page, links, headers, DNS)', useLh ? 'Google Lighthouse on a phone (~20–40 s)' : 'Google Lighthouse (off)', useAi ? 'AI review by Claude' : 'AI review (off)']);
  step(0, 'running');
  step(1, useLh ? 'running' : 'skipped');
  step(2, useAi ? 'pending' : 'skipped');

  const auditP = api('/api/audit', { url }).then((r) => { step(0, 'done', `${r.findings.length} findings`); return r; }, (err) => { step(0, 'error', err.message); throw err; });
  const lhP = useLh ? api('/api/pagespeed', { url, strategy: 'mobile' }).then((r) => { step(1, 'done'); return r; }, (err) => { step(1, 'error', err.message); return null; }) : Promise.resolve(null);

  let results;
  try {
    results = await auditP;
  } catch {
    setBusy(false);
    return;
  }
  const lh = await lhP;
  if (lh) {
    results.screenshot = lh.screenshot;
    delete lh.screenshot;
    results.lighthouse = lh;
  }
  renderResults(results);
  saveHistory(results);
  if (useAi) await runAi(results, 2);
  setBusy(false);
});

/* ── APK audit ──────────────────────────────────────────── */

const apkInput = $('apkInput');
apkInput.addEventListener('change', () => {
  const f = apkInput.files[0];
  $('apkName').textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : '.apk, .apks or .xapk';
});
const drop = $('dropZone');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
drop.addEventListener('drop', (e) => {
  if (!e.dataTransfer.files.length) return;
  apkInput.files = e.dataTransfer.files;
  apkInput.dispatchEvent(new Event('change'));
});

$('panelApk').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const file = apkInput.files[0];
  if (!file) { notice('No APK selected', 'Choose an .apk, .apks or .xapk file, or drop it onto the upload box. It is analysed in your browser and never uploaded.', { focusAfter: $('apkInput') }); return; }
  if (!$('permApk').checked) { notice('Permission needed', 'Tick the box to confirm this is your app or you have the owner\'s permission to review it.', { focusAfter: $('permApk') }); return; }
  const useAi = $('optAiApk').checked;
  setBusy(true);
  $('results').hidden = true;
  startSteps(['Analysing the APK in your browser', useAi ? 'AI review by Claude' : 'AI review (off)']);
  step(0, 'running');
  step(1, useAi ? 'pending' : 'skipped');
  let results;
  try {
    results = await auditApk(file, (msg) => step(0, 'running', msg));
    step(0, 'done', `${results.findings.length} findings`);
  } catch (err) {
    step(0, 'error', err.message);
    setBusy(false);
    return;
  }
  renderResults(results);
  saveHistory(results);
  if (useAi) await runAi(results, 1);
  setBusy(false);
});

/* ── AI review ──────────────────────────────────────────── */

async function runAi(results, stepIndex) {
  const panel = document.querySelector('#aiPanel');
  step(stepIndex, 'running', 'usually 20–60 s');
  if (panel) panel.replaceChildren(aiLoading());
  try {
    const { screenshot, ai, ...payload } = results;
    const out = await api('/api/explain', { results: payload });
    results.ai = out.review;
    results.ai_model = out.model;
    step(stepIndex, 'done');
    saveHistory(results);
  } catch (err) {
    step(stepIndex, 'error', err.message);
    results.ai_error = err.message;
  }
  const fresh = document.querySelector('#aiPanel');
  if (fresh) fresh.replaceWith(aiPanel(results, stepIndex));
  updateGrade(results);
}

function aiLoading() {
  return h('div', { class: 'sa-ai-loading' }, h('span', { class: 'sa-spinner', 'aria-hidden': 'true' }), 'Claude is reviewing the results…');
}

function aiPanel(r, stepIndex) {
  const box = h('section', { class: 'sa-card sa-ai', id: 'aiPanel', 'aria-labelledby': 'aiTitle' }, h('h2', { id: 'aiTitle', text: 'AI review' }));
  if (!r.ai) {
    if (r.ai_error) {
      box.append(h('p', { class: 'sa-error', text: r.ai_error }), h('button', { class: 'sa-btn sa-btn-ghost no-print', type: 'button', onclick: () => runAi(r, stepIndex ?? 0), text: 'Try again' }));
    } else {
      box.append(h('p', { class: 'sa-muted', text: 'Not run for this audit.' }), h('button', { class: 'sa-btn sa-btn-ghost no-print', type: 'button', onclick: () => { startSteps(['AI review by Claude']); runAi(r, 0); }, text: 'Run AI review' }));
    }
    return box;
  }
  const ai = r.ai;
  box.append(h('p', { class: 'sa-ai-summary', text: ai.summary }));
  if (ai.priorities?.length) {
    box.append(h('h3', { text: 'Fix in this order' }));
    box.append(h('ol', { class: 'sa-priorities' }, ai.priorities.map((p) => h('li', { class: 'sa-priority' },
      h('div', { class: 'sa-priority-head' }, badge(p.severity), h('span', { class: 'sa-tag', text: p.area }), h('strong', { text: p.title }), h('span', { class: 'sa-effort', text: p.effort })),
      h('p', { text: p.why_it_matters }),
      h('p', { class: 'sa-fix' }, h('b', { text: 'Fix: ' }), p.how_to_fix)))));
  }
  const list = (title, items, cls) => (items?.length ? [h('h3', { text: title }), h('ul', { class: `sa-bullets ${cls || ''}` }, items.map((t) => h('li', { text: t })))] : []);
  box.append(h('div', { class: 'sa-ai-grid' },
    h('div', {}, ...list('Quick wins', ai.quick_wins), ...list('What is good', ai.strengths, 'is-good')),
    h('div', {}, ...list('Probably not a problem', ai.false_positives), ...list('Check by hand', ai.not_checked))));
  if (ai.client_message) {
    box.append(h('h3', { text: 'Message for the owner' }), h('blockquote', { class: 'sa-quote', text: ai.client_message }),
      h('button', { class: 'sa-btn sa-btn-ghost no-print', type: 'button', onclick: async (e) => { try { await navigator.clipboard.writeText(ai.client_message); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; } }, text: 'Copy message' }));
  }
  if (r.ai_model) box.append(h('p', { class: 'sa-muted sa-small', text: `Reviewed by ${r.ai_model}. Verify important findings before sending them to a client.` }));
  return box;
}

/* ── Results rendering ──────────────────────────────────── */

function badge(sev) { return h('span', { class: `sa-badge sev-${sev}`, text: SEV_LABEL[sev] || sev }); }

function tile(label, value, extra = {}) {
  return h('div', { class: `sa-tile ${extra.cls || ''}` }, h('span', { class: 'sa-tile-label', text: label }), h('b', { text: value ?? '–' }), extra.sub ? h('small', { text: extra.sub }) : null);
}

function scoreClass(n) { return n == null ? '' : n >= 90 ? 'is-good' : n >= 50 ? 'is-ok' : 'is-bad'; }

function updateGrade(r) {
  const el = document.querySelector('#gradeTile b');
  if (el) el.textContent = r.ai?.grade || '–';
}

function renderResults(r) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, r.findings.filter((f) => f.severity === s).length]));
  const tiles = [
    tile('Score', `${r.score}/100`, { cls: scoreClass(r.score), sub: 'automated checks' }),
    h('div', { class: 'sa-tile', id: 'gradeTile' }, h('span', { class: 'sa-tile-label', text: 'AI grade' }), h('b', { text: r.ai?.grade || '–' })),
    ...SEVERITIES.map((s) => tile(SEV_LABEL[s], String(counts[s]), { cls: `sev-tile sev-${s}` })),
  ];
  const facts = [];
  if (r.kind === 'website') {
    facts.push(tile('Security headers', r.security_headers?.grade), tile('Server response', r.response_ms ? `${r.response_ms.first} ms` : null), tile('HTML size', `${r.html_kb} KB`), tile('Links checked', String(r.links?.checked?.length ?? 0), { sub: `of ${r.links?.total ?? 0}` }));
    if (r.lighthouse) for (const [k, v] of Object.entries(r.lighthouse.scores)) facts.push(tile(`Lighthouse ${k.replace('-', ' ')}`, v == null ? '–' : String(v), { cls: scoreClass(v) }));
  } else {
    const a = r.app;
    facts.push(tile('Package', a.package), tile('Version', `${a.version_name ?? '?'} (${a.version_code ?? '?'})`), tile('Target SDK', String(a.target_sdk), { sub: `min ${a.min_sdk}` }), tile('Size', `${a.size_mb} MB`), tile('Built with', a.frameworks.join(', ') || 'Native/unknown'));
  }

  const header = h('div', { class: 'sa-res-head' },
    h('div', {}, h('p', { class: 'sa-kicker', text: r.kind === 'apk' ? 'Android APK' : 'Website / web app' }),
      h('h2', { class: 'sa-target', text: r.final_url || r.target }),
      h('p', { class: 'sa-muted sa-small', text: `Checked ${new Date(r.checked_at).toLocaleString()}${r.final_url && r.final_url !== r.target ? ` · started at ${r.target}` : ''}` })),
    h('div', { class: 'sa-res-actions no-print' },
      h('button', { class: 'sa-btn sa-btn-ghost', type: 'button', onclick: () => downloadJson(r), text: 'Download JSON' }),
      h('button', { class: 'sa-btn sa-btn-ghost', type: 'button', onclick: printReport, text: 'Print / Save PDF' })));

  const side = r.kind === 'website' && r.screenshot
    ? h('figure', { class: 'sa-card sa-shot' }, h('img', { src: r.screenshot, alt: `Phone screenshot of ${r.final_url}`, loading: 'lazy' }), h('figcaption', { class: 'sa-muted sa-small', text: 'How it looks on a phone (Lighthouse)' }))
    : null;

  const container = $('results');
  container.replaceChildren(
    h('section', { class: 'sa-card' }, header, h('div', { class: 'sa-tiles' }, tiles), h('div', { class: 'sa-tiles sa-tiles-facts' }, facts)),
    h('div', { class: `sa-two ${side ? '' : 'is-single'}` }, aiPanel(r), side),
    findingsSection(r),
    detailsSection(r),
  );
  container.hidden = false;
  container.querySelector('.sa-target').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function findingsSection(r) {
  const list = h('div', { class: 'sa-findings' });
  const draw = (filter) => list.replaceChildren(...r.findings.filter((f) => filter === 'all' || f.severity === filter).map((f) =>
    h('details', { class: `sa-finding sev-${f.severity}` },
      h('summary', {}, badge(f.severity), h('span', { text: f.title })),
      h('dl', {}, h('dt', { text: 'Details' }), h('dd', { class: 'sa-pre', text: f.detail }), h('dt', { text: 'How to fix' }), h('dd', { text: f.fix }), h('dt', { text: 'Check ID' }), h('dd', { class: 'sa-muted', text: f.id })))));
  const chips = h('div', { class: 'sa-chips no-print', role: 'group', 'aria-label': 'Filter findings' }, ['all', ...SEVERITIES].map((s) => {
    const n = s === 'all' ? r.findings.length : r.findings.filter((f) => f.severity === s).length;
    return h('button', { type: 'button', class: 'sa-chip', 'aria-pressed': s === 'all' ? 'true' : 'false', disabled: n === 0 && s !== 'all', onclick: (e) => {
      for (const c of chips.children) c.setAttribute('aria-pressed', 'false');
      e.currentTarget.setAttribute('aria-pressed', 'true');
      draw(s);
    } }, `${s === 'all' ? 'All' : SEV_LABEL[s]} (${n})`);
  }));
  draw('all');
  return h('section', { class: 'sa-card', 'aria-labelledby': 'findTitle' }, h('h2', { id: 'findTitle', text: 'Automated findings' }), chips, r.findings.length ? list : h('p', { class: 'sa-muted', text: 'No issues found by the automated checks.' }));
}

function table(rows) {
  return h('table', { class: 'sa-table' }, h('tbody', {}, rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => h('tr', {}, h('th', { scope: 'row', text: k }), h('td', { text: Array.isArray(v) ? v.join(', ') || '–' : typeof v === 'object' ? JSON.stringify(v) : String(v) })))));
}

function detailsSection(r) {
  const blocks = [];
  const block = (title, ...content) => blocks.push(h('details', { class: 'sa-detail' }, h('summary', { text: title }), ...content));
  if (r.kind === 'website') {
    const p = r.page || {};
    block('Page', table([['Title', p.title], ['Description', p.description], ['Language', p.lang], ['Viewport', p.viewport], ['Canonical', p.canonical], ['Robots meta', p.robots], ['Technology', p.tech], ['Images', `${p.images ?? 0} (${p.images_without_alt ?? 0} without alt, ${p.lazy_images ?? 0} lazy)`], ['Links', `${r.links?.internal ?? 0} internal, ${r.links?.external ?? 0} external`], ['Scripts / stylesheets', `${p.scripts ?? 0} / ${p.stylesheets ?? 0}`], ['Forms', p.forms], ['Structured data blocks', p.json_ld_blocks]]));
    block('Redirects and response', table([...r.redirect_chain.map((c, i) => [`Hop ${i + 1}`, `${c.status} ${c.url} (${c.ms} ms)`]), ['http:// check', r.http_redirect ? (r.http_redirect.error || `${r.http_redirect.status} → ${r.http_redirect.location || '(no redirect)'}`) : 'n/a'], ['Repeat response times', (r.response_ms?.repeat || []).map((m) => `${m} ms`)]]));
    block('Security headers', table([...Object.entries(r.security_headers?.headers || {}), ['Cookies', (r.security_headers?.cookies || []).map((c) => `${c.name} (${[c.secure && 'Secure', c.httpOnly && 'HttpOnly', c.sameSite && `SameSite=${c.sameSite}`].filter(Boolean).join(', ') || 'no flags'})`)]]));
    const bad = [...(r.links?.checked || []), ...(r.links?.assets_checked || [])].filter((l) => l.status !== 200);
    block('Links and files that did not return 200', bad.length ? table(bad.map((l) => [l.status > 0 ? String(l.status) : l.error, l.url])) : h('p', { class: 'sa-muted', text: 'All checked links and files returned 200.' }));
    block('DNS and email', table([['Domain', r.dns?.domain], ['SPF', r.dns?.spf], ['DMARC', r.dns?.dmarc], ['MX', r.dns?.mx], ['CAA', r.dns?.caa], ['robots.txt', r.robots_txt ? 'present' : 'missing'], ['sitemap.xml', r.sitemap ? `${r.sitemap.status}${r.sitemap.urls ? `, ${r.sitemap.urls} URLs` : ''}` : 'missing'], ['security.txt', r.security_txt ? 'present' : 'missing']]));
    if (r.lighthouse) {
      const m = r.lighthouse.metrics;
      block('Lighthouse (phone)', table([['Largest Contentful Paint', m.lcp?.value], ['Cumulative Layout Shift', m.cls?.value], ['Total Blocking Time', m.tbt?.value], ['First Contentful Paint', m.fcp?.value], ['Speed Index', m.speed_index?.value], ['Real-user data (28 days)', r.lighthouse.field_data ? `${r.lighthouse.field_data.overall} · LCP ${r.lighthouse.field_data.lcp_ms} ms · INP ${r.lighthouse.field_data.inp_ms} ms · CLS ${r.lighthouse.field_data.cls}` : 'not enough traffic'], ...r.lighthouse.opportunities.map((o) => [`Opportunity`, `${o.title}${o.savings ? ` (${o.savings})` : ''}`]), ...r.lighthouse.failed_checks.map((c) => [`Failed ${c.category}`, `${c.title}${c.items ? ` (${c.items})` : ''}`])]));
    }
  } else {
    const a = r.app;
    block('App', table([['Package', a.package], ['Version', `${a.version_name} (${a.version_code})`], ['SDK', `min ${a.min_sdk} · target ${a.target_sdk} · compile ${a.compile_sdk ?? '?'}`], ['Size', `${a.size_mb} MB, ${a.dex_files} dex file(s)`], ['Native ABIs', a.abis], ['Frameworks', a.frameworks], ['Signing', `v1 ${a.signing.v1 ? 'yes' : 'no'} · v2+ ${a.signing.v2_or_later ? 'yes' : 'no'} · debug certificate ${a.signing.debug_certificate ? 'YES' : 'no'}`], ['Components', `${a.components.activities} activities, ${a.components.services} services, ${a.components.receivers} receivers, ${a.components.providers} providers`]]));
    block(`Permissions (${a.permissions.length})`, a.permissions.length ? h('ul', { class: 'sa-bullets sa-cols' }, a.permissions.map((p) => h('li', { text: p }))) : h('p', { class: 'sa-muted', text: 'None' }));
    if (a.deep_links.length) block('Deep links', h('ul', { class: 'sa-bullets' }, a.deep_links.map((l) => h('li', { text: l }))));
  }
  return h('section', { class: 'sa-card', 'aria-labelledby': 'detTitle' }, h('h2', { id: 'detTitle', text: 'Technical details' }), ...blocks);
}

/* ── Export ─────────────────────────────────────────────── */

function slug(s) { return String(s).replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'audit'; }

function downloadJson(r) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `audit-${slug(r.final_url || r.target)}-${r.checked_at.slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function printReport() {
  const closed = [...document.querySelectorAll('#results details:not([open])')];
  closed.forEach((d) => { d.open = true; });
  window.print();
  closed.forEach((d) => { d.open = false; });
}

/* ── History (this browser only) ────────────────────────── */

function readHistory() {
  try { return JSON.parse(store.get(HISTORY_KEY) || '[]'); } catch { return []; }
}

function saveHistory(r) {
  r.id ||= `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { screenshot, ...lean } = r;
  let list = readHistory().filter((x) => x.id !== r.id);
  list.unshift({ id: r.id, kind: r.kind, target: r.final_url || r.target, score: r.score, grade: r.ai?.grade || null, date: r.checked_at });
  for (const old of list.slice(HISTORY_MAX)) store.del(`sa-r-${old.id}`);
  list = list.slice(0, HISTORY_MAX);
  // If storage is full, drop the oldest saved results until it fits.
  while (!store.set(`sa-r-${r.id}`, JSON.stringify(lean)) && list.length > 1) store.del(`sa-r-${list.pop().id}`);
  store.set(HISTORY_KEY, JSON.stringify(list));
  renderHistory();
}

function renderHistory() {
  const list = readHistory();
  const ul = $('history');
  if (!list.length) { ul.replaceChildren(h('li', { class: 'sa-muted', text: 'No audits yet.' })); return; }
  ul.replaceChildren(...list.map((x) => h('li', {},
    h('button', { type: 'button', class: 'sa-history-item', onclick: () => {
      const raw = store.get(`sa-r-${x.id}`);
      if (!raw) { notice('Result not available', 'This saved audit was removed to free up browser storage. Run the audit again to see it.', { kind: 'error' }); return; }
      $('progress').hidden = true;
      renderResults(JSON.parse(raw));
    } },
    h('span', { class: `sa-history-score ${scoreClass(x.score)}`, text: String(x.score) }),
    h('span', { class: 'sa-history-target', text: x.target }),
    h('span', { class: 'sa-muted sa-small', text: `${x.kind === 'apk' ? 'APK' : 'Web'} · ${new Date(x.date).toLocaleDateString()}${x.grade ? ` · AI ${x.grade}` : ''}` })))));
}

initAuth();
