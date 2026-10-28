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
const AREA_LABEL = { frontend: 'Frontend & design', backend: 'Backend & server', database: 'Database & data', security: 'Security', network_hosting: 'Network & hosting', performance: 'Performance', seo_content: 'SEO & content', accessibility: 'Accessibility', mobile_app: 'Mobile app' };
const STATUS_LABEL = { good: 'Good', needs_work: 'Needs work', poor: 'Poor', not_checked: 'Not checked' };
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

/* ── Review language (remembered in this browser) ───────── */

for (const id of ['optLangWeb', 'optLangApk']) {
  const sel = $(id);
  const saved = store.get('sa-lang');
  if (saved && [...sel.options].some((o) => o.value === saved)) sel.value = saved;
  sel.addEventListener('change', () => {
    store.set('sa-lang', sel.value);
    for (const other of ['optLangWeb', 'optLangApk']) $(other).value = sel.value;
  });
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

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

$('panelWeb').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const url = $('urlInput').value.trim();
  if (!url) { notice('Add a website address', 'Paste a link such as example.com or https://app.example.com/login.', { focusAfter: $('urlInput') }); return; }
  if (!$('permWeb').checked) { notice('Permission needed', 'Tick the box to confirm you own this site or have the owner\'s permission to review it.', { focusAfter: $('permWeb') }); return; }
  const useLh = $('optLighthouse').checked;
  const usePages = $('optPages').checked;
  const maxPages = Number($('optMaxPages').value) || 10;
  const pageShots = usePages && useLh && $('optPageShots').checked;
  const useAi = $('optAiWeb').checked;
  setBusy(true);
  $('results').hidden = true;
  startSteps([
    'Checking the home page (security, links, technology, DNS, code)',
    useLh ? 'Google Lighthouse + phone screenshot of the home page' : 'Google Lighthouse (off)',
    usePages ? `Checking the other pages (up to ${maxPages - 1})` : 'Other pages (off)',
    pageShots ? 'Screenshots + Lighthouse for each page (slow)' : 'Page screenshots (off)',
    useAi ? 'AI review and fix plan' : 'AI review (off)',
  ]);
  step(0, 'running');
  step(1, useLh ? 'running' : 'skipped');
  step(2, usePages ? 'pending' : 'skipped');
  step(3, pageShots ? 'pending' : 'skipped');
  step(4, useAi ? 'pending' : 'skipped');

  const auditP = api('/api/audit', { url }).then((r) => { step(0, 'done', `${r.findings.length} findings · ${r.technologies?.length || 0} technologies · ${r.pages_found?.length || 0} pages found`); return r; }, (err) => { step(0, 'error', err.message); throw err; });
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
  results.pages = [{
    url: results.final_url, final_url: results.final_url, status: results.status, ms: results.response_ms?.first, title: results.page?.title || null,
    score: results.score, home: true, findings: results.findings, screenshot: results.screenshot || null, lighthouse: lh ? { scores: lh.scores } : null,
  }];
  renderResults(results);

  if (usePages) {
    const others = (results.pages_found || []).filter((u) => u !== results.final_url).slice(0, maxPages - 1);
    let done = 0;
    step(2, 'running', others.length ? `0 of ${others.length}` : 'no other pages linked');
    await pool(others, 3, async (u) => {
      try {
        results.pages.push(await api('/api/page', { url: u }));
      } catch (err) {
        results.pages.push({ url: u, final_url: u, status: 0, error: err.message, findings: [{ severity: 'medium', id: 'BUG-PAGE-UNREACHABLE', title: 'Page could not be checked', detail: err.message, fix: 'Open the page in a browser to see if it loads.' }] });
      }
      step(2, 'running', `${++done} of ${others.length}`);
    });
    step(2, 'done', `${others.length} page(s) checked`);
    // Some tools only appear on inner pages (e.g. a contact form's backend).
    const techNames = new Set((results.technologies || []).map((t) => t.name));
    const langNames = new Set((results.languages || []).map((l) => l.name));
    for (const p of results.pages) {
      for (const t of p.technologies || []) if (!techNames.has(t.name)) { techNames.add(t.name); (results.technologies ||= []).push({ ...t, evidence: [...t.evidence, `page ${pathOf(p.final_url)}`] }); }
      for (const l of p.languages || []) if (!langNames.has(l.name)) { langNames.add(l.name); (results.languages ||= []).push(l); }
      results.databases = [...new Set([...(results.databases || []), ...(p.databases || [])])];
    }
    renderResults(results, { keepScroll: true });
    if (pageShots && others.length) {
      let shots = 0;
      const todo = results.pages.filter((p) => !p.home && p.status && p.status < 400);
      step(3, 'running', `0 of ${todo.length}`);
      await pool(todo, 2, async (p) => {
        try {
          const r = await api('/api/pagespeed', { url: p.final_url, strategy: 'mobile' });
          p.screenshot = r.screenshot;
          p.lighthouse = { scores: r.scores, metrics: r.metrics, failed_checks: r.failed_checks };
        } catch (err) {
          p.lighthouse_error = err.message;
        }
        step(3, 'running', `${++shots} of ${todo.length}`);
        const sec = document.querySelector('#pagesSection');
        if (sec) sec.replaceWith(pagesSection(results));
      });
      step(3, 'done');
    } else if (pageShots) step(3, 'skipped', 'no other pages');
  }
  saveHistory(results);
  if (useAi) await runAi(results, 4);
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
  startSteps(['Analysing the APK in your browser', useAi ? 'AI review and fix plan' : 'AI review (off)']);
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
    if (payload.pages) payload.pages = payload.pages.map(({ screenshot: _s, ...p }) => p);
    const language = $(results.kind === 'apk' ? 'optLangApk' : 'optLangWeb').value;
    const out = await api('/api/explain', { results: payload, language });
    results.ai_language = language;
    results.ai = out.review;
    results.ai_model = out.model;
    results.ai_provider = out.provider;
    results.ai_note = out.note || null;
    delete results.ai_error;
    step(stepIndex, 'done');
    saveHistory(results);
  } catch (err) {
    step(stepIndex, 'error', err.message);
    results.ai_error = err.message;
  }
  const fresh = document.querySelector('#aiPanel');
  if (fresh) fresh.replaceWith(aiPanel(results, stepIndex));
  const plan = document.querySelector('#planSection');
  if (plan) plan.replaceWith(planSection(results));
  const tech = document.querySelector('#techSection');
  if (tech) tech.replaceWith(techSection(results));
  updateGrade(results);
}

function aiLoading() {
  return h('div', { class: 'sa-ai-loading' }, h('span', { class: 'sa-spinner', 'aria-hidden': 'true' }), 'The AI is reviewing the results and writing a fix plan… (usually 20–60 s)');
}

function aiPanel(r, stepIndex) {
  const box = h('section', { class: 'sa-card sa-ai', id: 'aiPanel', 'aria-labelledby': 'aiTitle' }, h('h2', { id: 'aiTitle', text: 'AI review' }));
  if (!r.ai) {
    if (r.ai_error) {
      box.append(h('p', { class: 'sa-error', text: r.ai_error }), h('button', { class: 'sa-btn sa-btn-ghost no-print', type: 'button', onclick: () => runAi(r, stepIndex ?? 0), text: 'Try again' }));
    } else {
      box.append(h('p', { class: 'sa-muted', text: 'Not run for this audit.' }), h('button', { class: 'sa-btn sa-btn-ghost no-print', type: 'button', onclick: () => { startSteps(['AI review and fix plan']); runAi(r, 0); }, text: 'Run AI review' }));
    }
    return box;
  }
  const ai = r.ai;
  box.append(h('p', { class: 'sa-ai-summary', text: ai.summary }));
  if (r.ai_note) box.append(h('p', { class: 'sa-muted sa-small', text: r.ai_note }));
  if (ai.area_summaries?.length) {
    box.append(h('h3', { text: 'Area by area' }), h('div', { class: 'sa-areas' }, ai.area_summaries.map((a) => h('div', { class: `sa-area is-${a.status}` },
      h('div', { class: 'sa-area-head' }, h('strong', { text: AREA_LABEL[a.area] || a.area }), h('span', { class: 'sa-area-status', text: STATUS_LABEL[a.status] || a.status })),
      h('p', { text: a.summary })))));
  }
  if (ai.priorities?.length) {
    box.append(h('h3', { text: 'Most important problems' }));
    box.append(h('ol', { class: 'sa-priorities' }, ai.priorities.map((p) => h('li', { class: 'sa-priority' },
      h('div', { class: 'sa-priority-head' }, badge(p.severity), h('span', { class: 'sa-tag', text: p.area }), h('strong', { text: p.title }), h('span', { class: 'sa-effort', text: p.effort })),
      h('p', { text: p.why_it_matters }),
      h('p', { class: 'sa-fix' }, h('b', { text: 'Fix: ' }), p.how_to_fix)))));
  }
  const list = (title, items, cls) => (items?.length ? [h('h3', { text: title }), h('ul', { class: `sa-bullets ${cls || ''}` }, items.map((t) => h('li', { text: t })))] : []);
  box.append(h('div', { class: 'sa-ai-grid' },
    h('div', {}, ...list('Quick wins', ai.quick_wins), ...list('What is good', ai.strengths, 'is-good')),
    h('div', {}, ...list('Probably not a problem', ai.false_positives), ...list('Check by hand', ai.not_checked))));
  if (ai.page_notes?.length) box.append(h('h3', { text: 'Page notes' }), h('ul', { class: 'sa-bullets' }, ai.page_notes.map((n) => h('li', {}, h('b', { text: `${n.page}: ` }), n.notes))));
  if (ai.client_message) {
    box.append(h('h3', { text: 'Message for the owner' }), h('blockquote', { class: 'sa-quote', text: ai.client_message }),
      h('button', { class: 'sa-btn sa-btn-ghost no-print', type: 'button', onclick: async (e) => { try { await navigator.clipboard.writeText(ai.client_message); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; } }, text: 'Copy message' }));
  }
  if (r.ai_model) box.append(h('p', { class: 'sa-muted sa-small', text: `Reviewed by ${r.ai_provider ? `${r.ai_provider} · ` : ''}${r.ai_model}. AI can be wrong: verify important findings before sending them to a client.` }));
  return box;
}

/* ── Lighthouse checks as plain-language findings ───────── */

const LH_FIX = {
  'color-contrast': ['medium', 'Text with low colour contrast (hard to read)', 'Darken the text or lighten the background until contrast is at least 4.5:1 (3:1 for large or bold text). The examples show the current colours; test new ones with a contrast checker.'],
  'button-name': ['medium', 'Buttons without readable text', 'Give every button visible text, or an aria-label for icon-only buttons (e.g. aria-label="Open menu").'],
  'link-name': ['medium', 'Links without readable text', 'Add text, or an aria-label for icon links (e.g. aria-label="WhatsApp").'],
  'image-alt': ['medium', 'Images without alt text', 'Add alt text that describes each image, or alt="" for decorative images.'],
  'label': ['medium', 'Form fields without labels', 'Add a visible <label for="…"> to each field; placeholders disappear while typing.'],
  'target-size': ['medium', 'Buttons or links too small or too close to tap', 'Make tap targets at least 24×24 px (44×44 is better) with space between them.'],
  'link-in-text-block': ['low', 'Links look like normal text', 'Underline links inside paragraphs, or give them a clearly different colour (at least 3:1 against the text).'],
  'heading-order': ['low', 'Headings skip levels', 'Use headings in order (h1 → h2 → h3) without jumping levels.'],
  'html-has-lang': ['medium', 'Page language not set', 'Add lang="en" (or the right language) to the <html> tag.'],
  'document-title': ['medium', 'Page has no title', 'Add a descriptive <title>.'],
  'meta-description': ['low', 'No meta description', 'Add a 120–160 character description for search results.'],
  'image-aspect-ratio': ['low', 'Images are stretched or squashed', 'Keep width and height in proportion, or use CSS object-fit: cover.'],
  'image-size-responsive': ['low', 'Images are too low-resolution (look blurry)', 'Upload images at least twice their displayed size, in WebP, so they are sharp on phones.'],
  'errors-in-console': ['medium', 'JavaScript errors in the browser console', 'Open the page, press F12 → Console, and fix the listed errors; they often break buttons, sliders or forms.'],
  'font-size': ['low', 'Text too small to read on phones', 'Use at least 16px for body text and 12px for small print.'],
  'is-crawlable': ['high', 'Page is blocked from search engines', 'Remove noindex / robots.txt blocking if this page should appear in Google.'],
  'link-text': ['low', 'Links say "click here" or "read more"', 'Use link text that says where it goes (e.g. "View our courses").'],
  'list': ['low', 'Lists are not built correctly', 'Put list items (<li>) directly inside <ul> or <ol>.'],
  'duplicate-id-aria': ['low', 'Duplicate element IDs', 'Give every id on the page a unique value.'],
  'aria-allowed-attr': ['low', 'Incorrect accessibility (ARIA) attributes', 'Remove ARIA attributes that do not belong on those elements.'],
  'frame-title': ['low', 'Embedded frames (maps, videos) have no title', 'Add title="…" to each <iframe>.'],
  'video-caption': ['medium', 'Videos without captions', 'Add captions so people without sound can follow.'],
  'tabindex': ['low', 'Unusual keyboard order (tabindex above 0)', 'Remove tabindex values above 0.'],
  'deprecations': ['low', 'The site uses features browsers are removing', 'Update the libraries or code listed by Lighthouse.'],
};

function lighthouseFindings(checks) {
  return (checks || []).map((c) => {
    const [severity, title, fix] = LH_FIX[c.id] || ['low', c.title, 'See the examples; Lighthouse lists the elements to change.'];
    const examples = (c.examples || []).map((x) => `• ${x.label || x.selector || x.snippet}${x.explanation ? ` – ${x.explanation}` : ''}`);
    return { severity, id: `LH-${c.id}`, title: `${title}${c.items ? ` (${c.items})` : ''}`, detail: examples.length ? examples.join('\n') : `Lighthouse check "${c.title}" failed.`, fix };
  });
}

/* ── Merging findings across pages ──────────────────────── */

function pathOf(u) { try { const x = new URL(u); return `${x.pathname}${x.search}` || '/'; } catch { return u; } }

/** All findings of the audit: home/site-wide plus each page, merged by issue, with the pages affected. */
function allFindings(r) {
  const map = new Map();
  const add = (f, page) => {
    const key = f.id.startsWith('LH-') ? f.id : `${f.id}|${f.title}`;
    if (!map.has(key)) map.set(key, { ...f, pages: [] });
    if (page && !map.get(key).pages.includes(page)) map.get(key).pages.push(page);
  };
  for (const f of r.findings) add(f, r.kind === 'website' ? pathOf(r.final_url) : null);
  for (const f of lighthouseFindings(r.lighthouse?.failed_checks)) add(f, pathOf(r.final_url));
  for (const p of (r.pages || []).filter((x) => !x.home)) {
    for (const f of p.findings || []) add(f, pathOf(p.final_url || p.url));
    for (const f of lighthouseFindings(p.lighthouse?.failed_checks)) add(f, pathOf(p.final_url || p.url));
  }
  const order = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
  return [...map.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.pages.length - a.pages.length);
}

/* ── Fix plan (AI plan when available, otherwise built from findings) ── */

function effortFor(id) {
  if (/^(SEO|A11Y|CONTENT|SEC-(HSTS|CSP|CLICKJACK|NOSNIFF|REFERRER|PERMISSIONS|VERSION)|DNS|COOKIE|UX)/.test(id)) return '5–20 min';
  if (/^(DB|BE)-/.test(id)) return '1–3 h';
  return '30–60 min';
}

function verifyFor(f) {
  if (/^SEC-|^CSP-|^COOKIE-/.test(f.id)) return 'Run the audit again: this item should disappear and the security headers grade should go up. Also check the browser console for blocked resources.';
  if (/BROKEN|MISSING|UNREACHABLE/.test(f.id)) return 'Open each listed link or file in a browser; it should load without an error. Then run the audit again.';
  if (/^DNS-/.test(f.id)) return 'DNS changes can take up to a few hours; then run the audit again (or check with an online SPF/DMARC checker).';
  if (/^LH-/.test(f.id)) return 'Run the audit again with Lighthouse on: this check should pass on every page listed.';
  if (/^PERF-/.test(f.id)) return 'Run the audit with Lighthouse on: the performance score and response time should improve.';
  if (/^APK-/.test(f.id)) return 'Build a new release APK and analyse it again: this item should be gone.';
  return 'Make the change, then run the audit again: this item should no longer appear.';
}

function autoPlan(r) {
  const items = allFindings(r);
  const where = (f) => (f.pages?.length > 1 ? ` (${f.pages.length} pages)` : f.pages?.length === 1 && f.pages[0] !== '/' ? ` (${f.pages[0]})` : '');
  const toStep = (f) => ({ title: `${f.title}${where(f)}`, how: f.fix, verify: verifyFor(f), effort: effortFor(f.id) });
  const phases = [
    { phase: 'Phase 1 – Fix first', goal: 'Stop anything that breaks the site, loses visitors or exposes data.', sev: ['critical', 'high'] },
    { phase: 'Phase 2 – Important', goal: 'Close security gaps and fix problems visitors notice.', sev: ['medium'] },
    { phase: 'Phase 3 – Polish', goal: 'Best practice, search ranking and small details.', sev: ['low'] },
    { phase: 'Phase 4 – Nice to have', goal: 'Optional improvements.', sev: ['info'] },
  ];
  return phases.map((ph) => ({ phase: ph.phase, goal: ph.goal, steps: items.filter((f) => ph.sev.includes(f.severity)).slice(0, 15).map(toStep) })).filter((ph) => ph.steps.length);
}

function planSection(r) {
  const fromAi = !!r.ai?.fix_plan?.length;
  const plan = fromAi ? r.ai.fix_plan : autoPlan(r);
  const key = `sa-plan-${r.id || 'tmp'}`;
  let doneSet;
  try { doneSet = new Set(JSON.parse(store.get(key) || '[]')); } catch { doneSet = new Set(); }
  const all = plan.flatMap((ph, i) => ph.steps.map((st, j) => `${fromAi ? 'ai' : 'auto'}:${i}:${j}:${st.title.slice(0, 40)}`));
  const bar = h('span', {});
  const label = h('span', { class: 'sa-muted sa-small' });
  const update = () => {
    const n = all.filter((k) => doneSet.has(k)).length;
    bar.style.width = `${all.length ? Math.round((n / all.length) * 100) : 0}%`;
    label.textContent = `${n} of ${all.length} steps done`;
  };
  const section = h('section', { class: 'sa-card sa-plan', id: 'planSection', 'aria-labelledby': 'planTitle' },
    h('div', { class: 'sa-plan-head' }, h('h2', { id: 'planTitle', text: 'Fix plan – step by step' }), h('span', { class: 'sa-tag', text: fromAi ? 'Written by AI' : 'Built from the automatic checks' })),
    h('p', { class: 'sa-muted', text: 'Work through the phases in order. Tick each step when it is done; progress is saved in this browser. Run the audit again at the end to confirm.' }),
    h('div', { class: 'sa-progress' }, h('div', { class: 'sa-progress-bar' }, bar), label));
  if (!plan.length) section.append(h('p', { class: 'sa-muted', text: 'Nothing to fix: no issues were found.' }));
  plan.forEach((ph, i) => {
    section.append(h('h3', { class: 'sa-phase', text: ph.phase }), ph.goal ? h('p', { class: 'sa-muted sa-small', text: ph.goal }) : null,
      h('ol', { class: 'sa-plan-steps' }, ph.steps.map((st, j) => {
        const k = `${fromAi ? 'ai' : 'auto'}:${i}:${j}:${st.title.slice(0, 40)}`;
        const id = `ps-${i}-${j}`;
        const box = h('input', { type: 'checkbox', id, onchange: (e) => {
          if (e.target.checked) doneSet.add(k); else doneSet.delete(k);
          store.set(key, JSON.stringify([...doneSet]));
          li.classList.toggle('is-done', e.target.checked);
          update();
        } });
        box.checked = doneSet.has(k);
        const li = h('li', { class: `sa-plan-step ${box.checked ? 'is-done' : ''}` },
          h('div', { class: 'sa-plan-row' }, box, h('label', { for: id }, h('strong', { text: st.title })), st.effort ? h('span', { class: 'sa-effort', text: st.effort }) : null),
          h('dl', {}, h('dt', { text: 'How to fix' }), h('dd', { class: 'sa-fix', text: st.how }), h('dt', { text: 'How to check it is fixed' }), h('dd', { text: st.verify })));
        return li;
      })));
  });
  update();
  return section;
}

/* ── Technology, network and pages ──────────────────────── */

function techSection(r) {
  const sec = h('section', { class: 'sa-card', id: 'techSection', 'aria-labelledby': 'techTitle' }, h('h2', { id: 'techTitle', text: 'How it is built' }));
  if (r.ai?.technology_summary) sec.append(h('p', { class: 'sa-ai-summary', text: r.ai.technology_summary }));
  if (r.kind === 'apk') {
    const a = r.app;
    sec.append(table([['Frameworks', a.frameworks.length ? a.frameworks : ['Native Android (Java/Kotlin) or not detected']], ['Native code (ABIs)', a.abis.length ? a.abis : ['none']], ['Min / target SDK', `${a.min_sdk} / ${a.target_sdk}`]]));
    return sec;
  }
  if (r.languages?.length) sec.append(h('h3', { text: 'Languages' }), h('div', { class: 'sa-chips-static' }, r.languages.map((l) => h('span', { class: `sa-chip-static ${l.confidence === 'likely' ? 'is-likely' : ''}`, text: l.confidence === 'likely' ? `${l.name} (likely)` : l.name }))));
  const groups = {};
  for (const t of r.technologies || []) (groups[t.category] ||= []).push(t);
  const cats = Object.keys(groups);
  if (cats.length) {
    sec.append(h('h3', { text: 'Platform, frameworks and tools' }), h('div', { class: 'sa-tech-grid' }, cats.map((c) => h('div', { class: 'sa-tech-group' },
      h('span', { class: 'sa-tile-label', text: c }),
      h('ul', {}, groups[c].map((t) => h('li', {}, h('b', { text: t.name }), t.version ? ` ${t.version}` : '', h('small', { class: 'sa-muted', text: ` · found in ${t.evidence.join(', ')}` }))))))));
  } else sec.append(h('p', { class: 'sa-muted', text: 'No known platform or framework detected (often a hand-coded site or a heavily customised build).' }));
  if (r.databases?.length) sec.append(h('h3', { text: 'Database / backend (from the site\'s public code)' }), h('ul', { class: 'sa-bullets' }, r.databases.map((d) => h('li', { text: d }))));
  const n = r.network || {};
  sec.append(h('h3', { text: 'Network and hosting' }), table([
    ['DNS provider', n.dns_provider], ['Email provider', n.mail_provider], ['Name servers', n.name_servers],
    ['IPv4 addresses', n.ipv4], ['IPv6', n.ipv6?.length ? n.ipv6 : 'not enabled'], ['HTTP/3', n.http3 ? 'yes' : 'no'], ['CDN cache status', n.cdn_cache],
    ['Server header', r.security_headers?.headers?.server], ['Backend/API addresses in public code', r.backend_endpoints?.length ? r.backend_endpoints : null],
    ['JavaScript files scanned', r.js_files_scanned?.length ? r.js_files_scanned.map(pathOf) : null],
  ]));
  return sec;
}

function pagesSection(r) {
  const pages = r.pages || [];
  const sec = h('section', { class: 'sa-card', id: 'pagesSection', 'aria-labelledby': 'pagesTitle' }, h('h2', { id: 'pagesTitle', text: `Pages (${pages.length})` }));
  if (r.sections?.length) sec.append(h('p', { class: 'sa-muted sa-small', text: `One-page sections linked in the menu: ${r.sections.join(', ')}` }));
  if (pages.length <= 1 && !(r.pages_found || []).length) { sec.append(h('p', { class: 'sa-muted', text: 'No other pages are linked from the home page.' })); return sec; }
  sec.append(h('div', { class: 'sa-pages' }, pages.map((p) => {
    const counts = SEVERITIES.slice(0, 4).map((s) => [s, (p.findings || []).filter((f) => f.severity === s).length]).filter(([, n]) => n);
    return h('article', { class: 'sa-page' },
      p.screenshot ? h('img', { class: 'sa-page-shot', src: p.screenshot, alt: `Phone screenshot of ${pathOf(p.final_url || p.url)}`, loading: 'lazy' }) : h('div', { class: 'sa-page-shot is-empty', text: p.lighthouse_error ? 'Screenshot failed' : 'No screenshot' }),
      h('div', { class: 'sa-page-body' },
        h('p', { class: 'sa-page-path', text: p.home ? `${pathOf(p.final_url)} (home)` : pathOf(p.final_url || p.url) }),
        h('p', { class: 'sa-page-title', text: p.title || p.error || '(no title)' }),
        h('p', { class: 'sa-small' }, h('span', { class: `sa-page-status ${p.status >= 400 || !p.status ? 'is-bad' : ''}`, text: p.status ? `HTTP ${p.status}` : 'not reached' }), p.ms ? ` · ${p.ms} ms` : '', p.score != null ? ` · score ${p.score}` : ''),
        p.lighthouse?.scores ? h('p', { class: 'sa-small sa-muted', text: `Lighthouse: speed ${p.lighthouse.scores.performance ?? '–'} · access ${p.lighthouse.scores.accessibility ?? '–'} · SEO ${p.lighthouse.scores.seo ?? '–'}` }) : null,
        h('div', { class: 'sa-page-counts' }, counts.length ? counts.map(([s, n]) => h('span', { class: `sa-badge sev-${s}`, text: `${n} ${SEV_LABEL[s]}` })) : h('span', { class: 'sa-muted sa-small', text: 'No issues' })),
        (p.findings || []).length ? h('details', { class: 'sa-page-details' }, h('summary', { text: 'Issues on this page' }), h('ul', { class: 'sa-bullets' }, p.findings.map((f) => h('li', {}, badge(f.severity), ' ', f.title)))) : null));
  })));
  const unchecked = (r.pages_found || []).length - pages.length;
  if (unchecked > 0) sec.append(h('p', { class: 'sa-muted sa-small', text: `${unchecked} more page(s) were found but not checked. Raise "Pages to check" to include them.` }));
  return sec;
}

/* ── Since the last audit ───────────────────────────────── */

function auditKey(r) {
  if (r.kind === 'apk') return `apk:${r.app?.package || r.target}`;
  try { return `web:${new URL(r.final_url || r.target).hostname.replace(/^www\./, '')}`; } catch { return `web:${r.target}`; }
}

// Counts in titles change between runs ("3 images…" → "1 image…"), so compare without digits.
const issueKey = (f) => `${f.id}|${f.title.replace(/\d+/g, '#')}`;

function previousAudit(r) {
  const key = auditKey(r);
  const prev = readHistory()
    .filter((x) => x.id !== r.id && (x.key || auditKey({ kind: x.kind, target: x.target })) === key && x.date < r.checked_at)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!prev) return null;
  try { return JSON.parse(store.get(`sa-r-${prev.id}`) || 'null'); } catch { return null; }
}

function compareSection(r) {
  const prev = previousAudit(r);
  if (!prev || !Array.isArray(prev.findings)) return null;
  const now = allFindings(r);
  const before = allFindings(prev);
  const nowKeys = new Set(now.map(issueKey));
  const beforeKeys = new Set(before.map(issueKey));
  const fixed = before.filter((f) => !nowKeys.has(issueKey(f)));
  const added = now.filter((f) => !beforeKeys.has(issueKey(f)));
  const still = now.filter((f) => beforeKeys.has(issueKey(f)));
  const diff = r.score - prev.score;
  const list = (items, empty) => (items.length
    ? h('ul', { class: 'sa-bullets' }, items.slice(0, 15).map((f) => h('li', {}, badge(f.severity), ' ', f.title)), items.length > 15 ? h('li', { class: 'sa-muted', text: `…and ${items.length - 15} more` }) : null)
    : h('p', { class: 'sa-muted sa-small', text: empty }));
  return h('section', { class: 'sa-card', id: 'compareSection', 'aria-labelledby': 'cmpTitle' },
    h('h2', { id: 'cmpTitle', text: 'Since the last audit' }),
    h('p', { class: 'sa-muted', text: `Compared with ${new Date(prev.checked_at).toLocaleString()}.` }),
    h('div', { class: 'sa-tiles' },
      tile('Score change', `${diff > 0 ? '+' : ''}${diff}`, { cls: diff > 0 ? 'is-good' : diff < 0 ? 'is-bad' : '', sub: `${prev.score} → ${r.score}` }),
      tile('Fixed', String(fixed.length), { cls: fixed.length ? 'is-good' : '' }),
      tile('New', String(added.length), { cls: added.length ? 'is-bad' : '' }),
      tile('Still open', String(still.length))),
    h('div', { class: 'sa-ai-grid' },
      h('div', {}, h('h3', { text: 'Fixed since last time' }), list(fixed, 'Nothing fixed yet.')),
      h('div', {}, h('h3', { text: 'New problems' }), list(added, 'No new problems.'))));
}

/* ── Copy a short summary for WhatsApp / email ──────────── */

function summaryText(r) {
  const merged = allFindings(r).filter((f) => ['critical', 'high', 'medium'].includes(f.severity));
  const name = r.kind === 'apk' ? `${r.app?.package || r.target}${r.app?.version_name ? ` v${r.app.version_name}` : ''}` : (() => { try { return new URL(r.final_url || r.target).hostname; } catch { return r.target; } })();
  const lines = [
    `${r.kind === 'apk' ? 'App' : 'Website'} check: ${name} (${new Date(r.checked_at).toLocaleDateString()})`,
    `Score: ${r.score}/100${r.ai?.grade && r.ai.grade !== '–' ? ` · Grade ${r.ai.grade}` : ''}`,
  ];
  if (merged.length) {
    lines.push('', 'Top things to fix:');
    merged.slice(0, 5).forEach((f, i) => lines.push(`${i + 1}. ${f.title}${f.pages?.length > 1 ? ` (${f.pages.length} pages)` : ''}`));
    if (merged.length > 5) lines.push(`…plus ${merged.length - 5} more in the full report.`);
  } else lines.push('', 'No important problems found.');
  if (r.ai?.strengths?.length) lines.push('', `Good: ${r.ai.strengths.slice(0, 2).join('; ')}`);
  lines.push('', 'I can help fix these. Full report available on request.', '– Kaviyarasu K, https://kaviyarasu-portfolio.pages.dev');
  return lines.join('\n');
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    notice('Copied', `${what} copied. Paste it into WhatsApp, email or a document.`);
  } catch {
    notice('Copy failed', 'Your browser blocked the clipboard. Use Download instead.', { kind: 'error' });
  }
}

function downloadText(text, filename) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ── Security checklist for website owners ─────────────── */

const OWNER_CHECKLIST = [
  ['Accounts and passwords', [
    'Use a password manager and a different long password for hosting, domain, email and website admin.',
    'Turn on two-step login (2FA) for the domain registrar, hosting, email, Google/Cloudflare and website admin accounts.',
    'Remove old admin accounts (ex-staff, agencies, test users) and give each person their own login.',
  ]],
  ['Updates', [
    'Update WordPress/CMS core, themes and plugins every month (or turn on automatic updates).',
    'Delete plugins and themes you do not use.',
    'Ask your host to use a supported PHP version (8.2 or newer).',
  ]],
  ['Backups', [
    'Keep automatic daily backups of files and database, stored outside the hosting account.',
    'Test restoring a backup at least twice a year.',
  ]],
  ['Domain and email', [
    'Turn on domain auto-renew with a card that will not expire, and keep the transfer lock on.',
    'Add SPF, DKIM and DMARC records so others cannot send email pretending to be you.',
    'Keep DNS records tidy: delete records for old sites and services you no longer use.',
  ]],
  ['Website', [
    'Always use HTTPS and redirect http:// to https://.',
    'Protect admin and login pages with login limits, a CAPTCHA and 2FA.',
    'Never put passwords or secret API keys in website code; keep them on the server.',
    'Publish a privacy policy and get consent before tracking where the law requires it.',
  ]],
  ['People', [
    'Teach staff to spot fake login pages and urgent "pay now" emails.',
    'Keep a contact for emergencies: who to call if the site is down or hacked.',
    'Run a website check every few months and after big changes.',
  ]],
];

function checklistText() {
  return ['Security checklist for website owners', '', ...OWNER_CHECKLIST.flatMap(([group, items]) => [group, ...items.map((t) => `[ ] ${t}`), '']), 'Prepared by Kaviyarasu K – https://kaviyarasu-portfolio.pages.dev'].join('\n');
}

function renderChecklist() {
  $('checklistBody').replaceChildren(...OWNER_CHECKLIST.map(([group, items]) => h('div', { class: 'sa-tech-group' },
    h('span', { class: 'sa-tile-label', text: group }),
    h('ul', { class: 'sa-bullets' }, items.map((t) => h('li', { text: t }))))));
}
renderChecklist();
$('copyChecklistBtn').addEventListener('click', () => copyText(checklistText(), 'Checklist'));
$('downloadChecklistBtn').addEventListener('click', () => downloadText(checklistText(), 'website-security-checklist.txt'));

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

function renderResults(r, { keepScroll = false } = {}) {
  r.id ||= `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const merged = allFindings(r);
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, merged.filter((f) => f.severity === s).length]));
  const tiles = [
    tile('Score', `${r.score}/100`, { cls: scoreClass(r.score), sub: 'automated checks' }),
    h('div', { class: 'sa-tile', id: 'gradeTile' }, h('span', { class: 'sa-tile-label', text: 'AI grade' }), h('b', { text: r.ai?.grade || '–' })),
    ...SEVERITIES.map((s) => tile(SEV_LABEL[s], String(counts[s]), { cls: `sev-tile sev-${s}` })),
  ];
  const facts = [];
  if (r.kind === 'website') {
    const main = (r.technologies || []).find((t) => /CMS|builder|framework/i.test(t.category));
    facts.push(tile('Built with', main ? main.name : 'Custom / unknown'), tile('Pages checked', String((r.pages || []).length || 1), { sub: `${(r.pages_found || []).length} found` }), tile('Security headers', r.security_headers?.grade), tile('Server response', r.response_ms ? `${r.response_ms.first} ms` : null), tile('Hosting / DNS', (r.technologies || []).find((t) => t.category === 'Hosting / CDN')?.name || r.network?.dns_provider || '–'));
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
      h('button', { class: 'sa-btn sa-btn-primary', type: 'button', onclick: () => copyText(summaryText(r), 'Summary'), text: 'Copy summary for WhatsApp / email' }),
      h('button', { class: 'sa-btn sa-btn-ghost', type: 'button', onclick: () => downloadJson(r), text: 'Download JSON' }),
      h('button', { class: 'sa-btn sa-btn-ghost', type: 'button', onclick: printReport, text: 'Print / Save PDF' })));

  const side = r.kind === 'website' && r.screenshot
    ? h('figure', { class: 'sa-card sa-shot' }, h('img', { src: r.screenshot, alt: `Phone screenshot of ${r.final_url}`, loading: 'lazy' }), h('figcaption', { class: 'sa-muted sa-small', text: 'How it looks on a phone (Lighthouse)' }))
    : null;

  const container = $('results');
  container.replaceChildren(...[
    h('section', { class: 'sa-card' }, header, h('div', { class: 'sa-tiles' }, tiles), h('div', { class: 'sa-tiles sa-tiles-facts' }, facts)),
    h('div', { class: `sa-two ${side ? '' : 'is-single'}` }, aiPanel(r), side),
    compareSection(r),
    planSection(r),
    techSection(r),
    r.kind === 'website' ? pagesSection(r) : null,
    findingsSection(r, merged),
    detailsSection(r),
  ].filter(Boolean));
  container.hidden = false;
  if (!keepScroll) container.querySelector('.sa-target').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function findingsSection(r, merged = allFindings(r)) {
  const list = h('div', { class: 'sa-findings' });
  const draw = (filter) => list.replaceChildren(...merged.filter((f) => filter === 'all' || f.severity === filter).map((f) =>
    h('details', { class: `sa-finding sev-${f.severity}` },
      h('summary', {}, badge(f.severity), h('span', { text: f.title }), f.pages?.length > 1 ? h('span', { class: 'sa-muted sa-small', text: ` · ${f.pages.length} pages` }) : null),
      h('dl', {}, h('dt', { text: 'Details' }), h('dd', { class: 'sa-pre', text: f.detail }), h('dt', { text: 'How to fix' }), h('dd', { text: f.fix }),
        f.pages?.length ? [h('dt', { text: 'Where' }), h('dd', { class: 'sa-pre', text: f.pages.join('\n') })] : null,
        h('dt', { text: 'Check ID' }), h('dd', { class: 'sa-muted', text: f.id })))));
  const chips = h('div', { class: 'sa-chips no-print', role: 'group', 'aria-label': 'Filter findings' }, ['all', ...SEVERITIES].map((s) => {
    const n = s === 'all' ? merged.length : merged.filter((f) => f.severity === s).length;
    return h('button', { type: 'button', class: 'sa-chip', 'aria-pressed': s === 'all' ? 'true' : 'false', disabled: n === 0 && s !== 'all', onclick: (e) => {
      for (const c of chips.children) c.setAttribute('aria-pressed', 'false');
      e.currentTarget.setAttribute('aria-pressed', 'true');
      draw(s);
    } }, `${s === 'all' ? 'All' : SEV_LABEL[s]} (${n})`);
  }));
  draw('all');
  return h('section', { class: 'sa-card', 'aria-labelledby': 'findTitle' }, h('h2', { id: 'findTitle', text: 'All issues found' }), chips, merged.length ? list : h('p', { class: 'sa-muted', text: 'No issues found by the automated checks.' }));
}

function table(rows) {
  return h('table', { class: 'sa-table' }, h('tbody', {}, rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => h('tr', {}, h('th', { scope: 'row', text: k }), h('td', { text: Array.isArray(v) ? v.join(', ') || '–' : typeof v === 'object' ? JSON.stringify(v) : String(v) })))));
}

function detailsSection(r) {
  const blocks = [];
  const block = (title, ...content) => blocks.push(h('details', { class: 'sa-detail' }, h('summary', { text: title }), ...content));
  if (r.kind === 'website') {
    const p = r.page || {};
    block('Page', table([['Title', p.title], ['Description', p.description], ['Language', p.lang], ['Viewport', p.viewport], ['Canonical', p.canonical], ['Robots meta', p.robots], ['Generator tag', p.generator], ['Images', `${p.images ?? 0} (${p.images_without_alt ?? 0} without alt, ${p.lazy_images ?? 0} lazy)`], ['Links', `${r.links?.internal ?? 0} internal, ${r.links?.external ?? 0} external`], ['Scripts / stylesheets', `${p.scripts ?? 0} / ${p.stylesheets ?? 0}`], ['Forms', p.forms], ['Structured data blocks', p.json_ld_blocks]]));
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
  if (lean.pages) lean.pages = lean.pages.map(({ screenshot: _s, ...p }) => p);
  let list = readHistory().filter((x) => x.id !== r.id);
  list.unshift({ id: r.id, kind: r.kind, key: auditKey(r), target: r.final_url || r.target, score: r.score, grade: r.ai?.grade || null, date: r.checked_at });
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

// Opened from the Site Inspector extension: /site-audit?url=https://example.com
const presetUrl = new URLSearchParams(location.search).get('url');
if (presetUrl && /^https?:\/\//i.test(presetUrl)) $('urlInput').value = presetUrl;

initAuth();
