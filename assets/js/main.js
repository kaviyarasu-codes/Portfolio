/* ═══════════════════════════════════════════════════════
   KAVIYARASU K – PORTFOLIO  ·  main.js
   Purpose : All interactivity — theme toggle, navbar,
             animations, typed effect, ticker, bento glow,
             form handling, smooth scroll, back-to-top.
═══════════════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────────────── *
   0.  THEME – runs immediately (no DOMContentLoaded wait)
       Prevents flash of wrong theme on page load.
 * ────────────────────────────────────────────────────── */
(function applyThemeEarly() {
  const saved = localStorage.getItem('kk-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

/* ────────────────────────────────────────────────────── *
   1.  INIT – run after DOM is ready
 * ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavbar();
  initReveal();
  initTyped();
  initBentoGlow();
  initBackToTop();
  initSmoothScroll();
  markActiveNav();
});

/* ────────────────────────────────────────────────────── *
   THEME TOGGLE
   - Reads from localStorage 'kk-theme'
   - Applies data-theme="light"|"dark" on <html>
   - Updates all toggle buttons (☀/🌙) across the page
   - Persists choice in localStorage
 * ────────────────────────────────────────────────────── */
function initTheme() {
  const toggleBtns = document.querySelectorAll('.theme-toggle');
  if (!toggleBtns.length) return;

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kk-theme', theme);
    syncIcons(theme);
  }

  function syncIcons(theme) {
    toggleBtns.forEach(btn => {
      const icon = btn.querySelector('i');
      const label = btn.querySelector('.theme-label');
      if (!icon) return;
      if (theme === 'dark') {
        icon.className = 'fa fa-sun';
        if (label) label.textContent = 'Light Mode';
        btn.setAttribute('aria-label', 'Switch to light mode');
        btn.setAttribute('title', 'Light mode');
      } else {
        icon.className = 'fa fa-moon';
        if (label) label.textContent = 'Dark Mode';
        btn.setAttribute('aria-label', 'Switch to dark mode');
        btn.setAttribute('title', 'Dark mode');
      }
    });
  }

  // Set icon to match current theme on load
  syncIcons(getTheme());

  // Wire up all toggle buttons
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      setTheme(next);
    });
  });
}

/* ────────────────────────────────────────────────────── *
   2.  NAVBAR
       - Glass blur + shadow on scroll
       - Hamburger toggle (mobile)
       - aria-expanded sync
 * ────────────────────────────────────────────────────── */
function initNavbar() {
  const nav = document.getElementById('navbar');
  const btn = document.getElementById('hamburger');
  const menu = document.getElementById('navLinks');
  if (!nav) return;

  /* Scroll class */
  const toggleScrolled = () => nav.classList.toggle('scrolled', window.scrollY > 50);
  window.addEventListener('scroll', toggleScrolled, { passive: true });
  toggleScrolled(); // run on load in case page is pre-scrolled

  /* Hamburger */
  if (btn && menu) {
    btn.addEventListener('click', () => {
      const isOpen = menu.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
      btn.setAttribute('aria-expanded', String(isOpen));
    });

    /* Close on any link click */
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        menu.classList.remove('open');
        btn.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });

    /* Close on outside click */
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target)) {
        menu.classList.remove('open');
        btn.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

/* ────────────────────────────────────────────────────── *
   3.  MARK ACTIVE NAV LINK  (based on current filename)
 * ────────────────────────────────────────────────────── */
function markActiveNav() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = (a.getAttribute('href') || '').split('#')[0];
    if (href === page) a.classList.add('active');
    else a.classList.remove('active');
  });
}

/* ────────────────────────────────────────────────────── *
   4.  SCROLL REVEAL  (Intersection Observer)
       Supports: .reveal, .reveal-left, .reveal-right
       Staggers siblings inside a shared parent.
 * ────────────────────────────────────────────────────── */
function initReveal() {
  const items = document.querySelectorAll('.reveal, .reveal-left, .reveal-right');
  if (!items.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const siblings = [...(el.parentElement?.children || [])].filter(
        c => c.classList.contains('reveal') ||
          c.classList.contains('reveal-left') ||
          c.classList.contains('reveal-right')
      );
      const idx = siblings.indexOf(el);
      const delay = idx >= 0 ? idx * 90 : 0;
      setTimeout(() => el.classList.add('visible'), delay);
      io.unobserve(el);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -48px 0px' });

  items.forEach(el => io.observe(el));
}

/* ────────────────────────────────────────────────────── *
   5.  TYPED EFFECT  (hero role line)
       Loops through multiple strings with a cursor.
 * ────────────────────────────────────────────────────── */
function initTyped() {
  const el = document.getElementById('typed-role');
  if (!el) return;

  const strings = [
    'Full-Stack Python Developer (Django)',
    'Websites & Web Apps Builder',
    'Domain & Hosting Setup Expert',
    'SEO-Friendly Web Developer',
  ];

  let si = 0, ci = 0, deleting = false;

  const type = () => {
    const current = strings[si];
    if (!deleting) {
      el.textContent = current.slice(0, ++ci);
      if (ci === current.length) {
        deleting = true;
        setTimeout(type, 2200);
        return;
      }
    } else {
      el.textContent = current.slice(0, --ci);
      if (ci === 0) {
        deleting = false;
        si = (si + 1) % strings.length;
      }
    }
    setTimeout(type, deleting ? 42 : 68);
  };

  // Cursor blink via :after in CSS — or inject here
  el.style.borderRight = '2px solid var(--cyan)';
  el.style.paddingRight = '3px';
  el.style.animation = 'none';

  setTimeout(type, 900);
}

/* ────────────────────────────────────────────────────── *
   6.  BENTO CARD GLOW  (mouse-tracking radial gradient)
 * ────────────────────────────────────────────────────── */
function initBentoGlow() {
  document.querySelectorAll('.bc').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
    card.addEventListener('mouseleave', () => {
      card.style.setProperty('--mx', '50%');
      card.style.setProperty('--my', '50%');
    });
  });
}

/* ────────────────────────────────────────────────────── *
   7.  BACK TO TOP BUTTON
 * ────────────────────────────────────────────────────── */
function initBackToTop() {
  const btn = document.getElementById('btt');
  if (!btn) return;

  window.addEventListener('scroll', () => {
    btn.classList.toggle('show', window.scrollY > 500);
  }, { passive: true });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ────────────────────────────────────────────────────── *
   8.  SMOOTH SCROLL for anchor links  (#section)
       Plus Floating WhatsApp Button visibility toggle.
 * ────────────────────────────────────────────────────── */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        const offset = 80; // navbar height
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // Floating WhatsApp button logic
  const waBtn = document.getElementById('floatWa');
  if (waBtn) {
    window.addEventListener('scroll', () => {
      const scrollPercent = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
      if (scrollPercent > 20) {
        waBtn.classList.add('show');
      } else {
        waBtn.classList.remove('show');
      }
    }, { passive: true });
  }
}

/* ────────────────────────────────────────────────────── *
   9.  CONTACT FORM HANDLER
       Replace the setTimeout block with a real API call
       (Formspree / EmailJS / your Django endpoint).
 * ────────────────────────────────────────────────────── */
window.handleForm = function handleForm(e) {
  e.preventDefault();

  const form = document.getElementById('contactForm');
  const btn = document.getElementById('submit-btn');
  const btnTxt = document.getElementById('btn-text');
  const status = document.getElementById('form-status');
  if (!form || !btn) return;

  /* Basic HTML5 validation */
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  /* Loading state */
  btn.disabled = true;
  btnTxt.textContent = 'Sending…';
  btn.querySelector('i').className = 'fa fa-spinner fa-spin';
  status.style.display = 'none';
  status.className = '';

  /* ── Replace this block with a real fetch() call ── */
  /*
  const data = new FormData(form);
  fetch('https://formspree.io/f/YOUR_FORM_ID', {
    method: 'POST', body: data, headers: { 'Accept': 'application/json' }
  })
  .then(r => r.ok ? showSuccess() : showError())
  .catch(showError);
  */

  // Demo:  simulate network delay
  setTimeout(() => {
    showSuccess();
    form.reset();
  }, 1500);

  function showSuccess() {
    btn.disabled = false;
    btnTxt.textContent = 'Send Message';
    btn.querySelector('i').className = 'fa fa-paper-plane';
    status.style.display = 'block';
    status.className = 'success';
    status.textContent = '✅ Message sent! I\'ll reply within 24 hours.';
    setTimeout(() => { status.style.display = 'none'; }, 6000);
  }

  function showError() {
    btn.disabled = false;
    btnTxt.textContent = 'Send Message';
    btn.querySelector('i').className = 'fa fa-paper-plane';
    status.style.display = 'block';
    status.className = 'error';
    status.textContent = '❌ Something went wrong. Please email me directly.';
  }
};

/* ────────────────────────────────────────────────────── *
   10. TICKER PAUSE on hover (accessibility)
 * ────────────────────────────────────────────────────── */
(function initTicker() {
  const track = document.getElementById('ticker');
  if (!track) return;
  track.closest('#proof')?.addEventListener('mouseenter', () => {
    track.style.animationPlayState = 'paused';
  });
  track.closest('#proof')?.addEventListener('mouseleave', () => {
    track.style.animationPlayState = 'running';
  });
})();

/* ────────────────────────────────────────────────────── *
   11. COUNT-UP ANIMATION for hero stats
 * ────────────────────────────────────────────────────── */
(function initCountUp() {
  const nums = document.querySelectorAll('[data-count]');
  if (!nums.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.dataset.count, 10);
      const suffix = el.dataset.suffix || '';
      let current = 0;
      const step = Math.ceil(target / 40);
      const timer = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = current + suffix;
        if (current >= target) clearInterval(timer);
      }, 35);
      io.unobserve(el);
    });
  }, { threshold: 0.6 });
  nums.forEach(el => io.observe(el));
})();
