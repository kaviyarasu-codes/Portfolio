/* ═══════════════════════════════════════════════════════
   KAVIYARASU K – PORTFOLIO  ·  main.js
   Theme toggle, navbar, reveal animations, typed role,
   count-up stats, project filters, back-to-top, WhatsApp
   button, footer year. Contact form logic lives in
   contact.html; the admin dashboard is self-contained.
═══════════════════════════════════════════════════════ */

'use strict';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Safe localStorage (private mode / blocked storage must not break the page) */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
};

/* 0. THEME – apply immediately to avoid a flash of the wrong theme */
document.documentElement.setAttribute('data-theme', store.get('kk-theme') || 'light');

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavbar();
  markActiveNav();
  initReveal();
  initTyped();
  initCountUp();
  initBentoGlow();
  initBackToTop();
  initSmoothScroll();
  initFloatingWhatsApp();
  initTicker();
  initProjectFilter();
  initFooterYear();
  initLocalTime();
  initCopy();
  initGlow();
  initProgress();
  initButterfly();
  initGallery();
});

/* ── THEME TOGGLE ─────────────────────────────────────── */
function initTheme() {
  const buttons = document.querySelectorAll('.theme-toggle');
  if (!buttons.length) return;

  const current = () => document.documentElement.getAttribute('data-theme') || 'light';

  const sync = (theme) => {
    buttons.forEach(btn => {
      const icon = btn.querySelector('i');
      const label = btn.querySelector('.theme-label');
      const toLight = theme === 'dark';
      if (icon) icon.className = toLight ? 'ph ph-sun' : 'ph ph-moon';
      if (label) label.textContent = toLight ? 'Light Mode' : 'Dark Mode';
      btn.setAttribute('aria-label', toLight ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('title', toLight ? 'Light mode' : 'Dark mode');
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B0D12' : '#F6F7F9');
  };

  sync(current());
  buttons.forEach(btn => btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('kk-theme', next);
    sync(next);
  }));
}

/* ── NAVBAR (scroll state + mobile menu) ──────────────── */
function initNavbar() {
  const nav = document.getElementById('navbar');
  const btn = document.getElementById('hamburger');
  const menu = document.getElementById('navLinks');
  if (!nav) return;

  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 50);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (!btn || !menu) return;

  const icon = btn.querySelector('i');
  const setOpen = (open) => {
    menu.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (icon) icon.className = open ? 'ph ph-x' : 'ph ph-list';
  };
  const close = () => setOpen(false);

  btn.addEventListener('click', () => setOpen(!menu.classList.contains('open')));
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', () => { if (window.innerWidth > 900) close(); });
}

/* ── ACTIVE NAV LINK (by current file name) ───────────── */
function markActiveNav() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a.nav-link').forEach(a => {
    const href = (a.getAttribute('href') || '').split('#')[0];
    if (!href.endsWith('.html')) return;
    const match = href === page || (page === '' && href === 'index.html') || (href === page + '.html');
    a.classList.toggle('active', match);
    if (match) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

/* ── SCROLL REVEAL ────────────────────────────────────── */
function initReveal() {
  const items = document.querySelectorAll('.reveal, .reveal-left, .reveal-right');
  if (!items.length) return;

  if (REDUCED_MOTION || !('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('visible'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const siblings = [...(el.parentElement?.children || [])].filter(c =>
        c.classList.contains('reveal') || c.classList.contains('reveal-left') || c.classList.contains('reveal-right'));
      const idx = Math.max(0, siblings.indexOf(el));
      setTimeout(() => el.classList.add('visible'), Math.min(idx, 6) * 90);
      io.unobserve(el);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -48px 0px' });

  items.forEach(el => io.observe(el));
}

/* ── TYPED ROLE (hero) ────────────────────────────────── */
function initTyped() {
  const el = document.getElementById('typed-role');
  if (!el) return;

  const strings = [
    'Full-Stack & App Developer',
    'Next.js · NestJS · PostgreSQL',
    'Android Apps with Expo',
    'Python · Django · MySQL',
    'Deploying to VPS, Vercel & Cloudflare'
  ];
  el.setAttribute('aria-label', strings.join(', '));
  if (REDUCED_MOTION) { el.textContent = strings[0]; return; }

  let si = 0, ci = 0, deleting = false;
  el.style.borderRight = '2px solid var(--indigo)';
  el.style.paddingRight = '3px';
  el.style.minHeight = '1.6em';

  const tick = () => {
    const current = strings[si];
    if (!deleting) {
      el.textContent = current.slice(0, ++ci);
      if (ci === current.length) { deleting = true; return setTimeout(tick, 2200); }
    } else {
      el.textContent = current.slice(0, --ci);
      if (ci === 0) { deleting = false; si = (si + 1) % strings.length; }
    }
    setTimeout(tick, deleting ? 40 : 65);
  };
  el.textContent = '';
  setTimeout(tick, 700);
}

/* ── COUNT-UP (elements with data-count) ──────────────── */
function initCountUp() {
  const nums = document.querySelectorAll('[data-count]');
  if (!nums.length || REDUCED_MOTION || !('IntersectionObserver' in window)) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.dataset.count, 10) || 0;
      const suffix = el.dataset.suffix || '';
      const start = performance.now(), dur = 900;
      const step = (now) => {
        const p = Math.min(1, (now - start) / dur);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      io.unobserve(el);
    });
  }, { threshold: 0.6 });
  nums.forEach(el => io.observe(el));
}

/* ── BENTO CARD GLOW (mouse-tracking) ─────────────────── */
function initBentoGlow() {
  document.querySelectorAll('.bc').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
}

/* ── BACK TO TOP ──────────────────────────────────────── */
function initBackToTop() {
  const btn = document.getElementById('btt');
  if (!btn) return;
  window.addEventListener('scroll', () => btn.classList.toggle('show', window.scrollY > 500), { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' }));
}

/* ── SMOOTH SCROLL for in-page anchors ────────────────── */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const target = id && document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
      if (id === 'main') target.setAttribute('tabindex', '-1'), target.focus({ preventScroll: true });
    });
  });
}

/* ── FLOATING WHATSAPP (shows after a little scroll; always on short pages) ── */
function initFloatingWhatsApp() {
  const wa = document.getElementById('floatWa');
  if (!wa) return;
  // Show after a little scroll; hide again once the footer (which has its own WhatsApp tile) is on screen
  const footer = document.querySelector('.footer');
  let footerVisible = false;
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const scrolled = max < 200 || window.scrollY / max > 0.15;
    wa.classList.toggle('show', scrolled && !footerVisible);
  };
  if (footer && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { footerVisible = e.isIntersecting; update(); }, { threshold: 0.05 }).observe(footer);
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

/* ── TICKER: duplicate items for a seamless loop, pause on hover ── */
function initTicker() {
  const track = document.getElementById('ticker');
  if (!track) return;
  if (!track.dataset.cloned) {
    [...track.children].forEach(item => track.appendChild(item.cloneNode(true)));
    track.dataset.cloned = '1';
  }
  const wrap = track.closest('#proof');
  wrap?.addEventListener('mouseenter', () => { track.style.animationPlayState = 'paused'; });
  wrap?.addEventListener('mouseleave', () => { track.style.animationPlayState = 'running'; });
}

/* ── PROJECT FILTER (projects.html) ───────────────────── */
function initProjectFilter() {
  const buttons = document.querySelectorAll('.filter-btn');
  const items = document.querySelectorAll('#project-list [data-cats]');
  if (!buttons.length || !items.length) return;
  const empty = document.getElementById('filterEmpty');

  // show counts on each button
  buttons.forEach(btn => {
    const f = btn.dataset.filter;
    const n = f === 'all' ? items.length : [...items].filter(i => i.dataset.cats.split(' ').includes(f)).length;
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = `(${n})`;
    btn.appendChild(c);
  });

  const apply = (f) => {
    let shown = 0;
    items.forEach(item => {
      const ok = f === 'all' || item.dataset.cats.split(' ').includes(f);
      item.classList.toggle('is-hidden', !ok);
      if (ok) {
        shown++;
        item.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => el.classList.add('visible'));
      }
    });
    buttons.forEach(b => {
      const on = b.dataset.filter === f;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    // hide wrapper sections (e.g. "More builds") whose cards are all filtered out
    document.querySelectorAll('#project-list section:not([data-cats])').forEach(sec => {
      const cards = sec.querySelectorAll('[data-cats]');
      if (cards.length) sec.classList.toggle('is-empty-section', [...cards].every(c => c.classList.contains('is-hidden')));
    });
    if (empty) empty.style.display = shown ? 'none' : 'block';
  };

  buttons.forEach(btn => btn.addEventListener('click', () => {
    apply(btn.dataset.filter);
    if (history.replaceState) history.replaceState(null, '', btn.dataset.filter === 'all' ? location.pathname : `#${btn.dataset.filter}`);
  }));

  // deep-link: projects.html#live etc. (case-study ids still scroll normally)
  const hash = location.hash.slice(1);
  if ([...buttons].some(b => b.dataset.filter === hash)) apply(hash);
}

/* ── FOOTER YEAR ──────────────────────────────────────── */
function initFooterYear() {
  const y = String(new Date().getFullYear());
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = y; });
}

/* ── LOCAL TIME in Coimbatore (hero tile) ─────────────── */
function initLocalTime() {
  const els = document.querySelectorAll('#localTime, [data-localtime]');
  if (!els.length) return;
  const fmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const tick = () => { const t = fmt.format(new Date()).toUpperCase() + ' IST'; els.forEach(el => { el.textContent = t; }); };
  tick();
  setInterval(tick, 30000);
}

/* ── COPY TO CLIPBOARD (footer "Copy email") ─────────── */
function initCopy() {
  document.querySelectorAll('[data-copy]').forEach(btn => {
    const label = btn.querySelector('span');
    const icon = btn.querySelector('i');
    const original = label ? label.textContent : '';
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        ta.remove();
      }
      if (label) label.textContent = ok ? 'Copied' : text;
      if (icon && ok) icon.className = 'ph ph-check';
      btn.classList.toggle('copied', ok);
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { if (label) label.textContent = original; if (icon) icon.className = 'ph ph-copy'; btn.classList.remove('copied'); }, 2000);
    });
  });
}

/* ── CARD SPOTLIGHT (mouse-follow glow) ───────────────── */
function initGlow() {
  if (REDUCED_MOTION || !window.matchMedia('(hover: hover)').matches) return;
  const cards = document.querySelectorAll('.tile-small, .work-feature, .work-card, .service, .mini, .case, .stack > div, .tl-item, .step');
  cards.forEach(card => {
    card.classList.add('glow');
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
}

/* ── SCROLL PROGRESS BAR ──────────────────────────────── */
function initProgress() {
  const bar = document.getElementById('progressBar');
  if (!bar) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0) + '%';
  };
  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  window.addEventListener('resize', update);
  update();
}

/* ── FOOTER LOGO: tilts toward the pointer, circuit lights up under it ── */
function initButterfly() {
  const art = document.getElementById('footerArt');
  const footer = document.querySelector('.footer');
  if (!art || !footer || REDUCED_MOTION || !window.matchMedia('(hover: hover)').matches) return;
  const logo = document.getElementById('bf');
  const right = art.querySelector('.la-right');
  let raf = 0, px = 0, py = 0;
  const frame = () => {
    raf = 0;
    const b = art.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, (px - (b.left + b.width / 2)) / (b.width / 2)));
    const ny = Math.max(-1, Math.min(1, (py - (b.top + b.height / 2)) / (b.height / 2)));
    logo.style.setProperty('--rx', (nx * 14).toFixed(2) + 'deg');
    logo.style.setProperty('--ry', (-ny * 10).toFixed(2) + 'deg');
    const r = right.getBoundingClientRect();
    right.style.setProperty('--lx', ((px - r.left) / r.width * 100).toFixed(1) + '%');
    right.style.setProperty('--ly', ((py - r.top) / r.height * 100).toFixed(1) + '%');
  };
  footer.addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; art.style.setProperty('--hover', 1); if (!raf) raf = requestAnimationFrame(frame); });
  footer.addEventListener('pointerleave', () => { art.style.setProperty('--hover', 0); logo.style.setProperty('--rx', '0deg'); logo.style.setProperty('--ry', '0deg'); });
}

/* ── PROJECT SCREENS GALLERY: tabs + lightbox ─────────── */
function initGallery() {
  document.querySelectorAll('.gallery').forEach(g => {
    const tabs = [...g.querySelectorAll('[role="tab"]')];
    const select = (tab, focus) => {
      tabs.forEach(t => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          select(tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length], true);
        }
      });
    });
  });

  const box = document.getElementById('lightbox');
  if (!box || typeof box.showModal !== 'function') return;
  const img = box.querySelector('img');
  const cap = box.querySelector('.lb-cap');
  let opener = null;
  document.querySelectorAll('.gal-open').forEach(btn => btn.addEventListener('click', () => {
    opener = btn;
    const fig = btn.closest('figure');
    img.src = btn.dataset.full;
    img.alt = btn.querySelector('img')?.alt || '';
    cap.textContent = fig?.querySelector('figcaption')?.textContent || '';
    box.showModal();
  }));
  box.querySelector('.lb-close').addEventListener('click', () => box.close());
  box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
  box.addEventListener('close', () => { img.src = ''; opener?.focus(); });
}
