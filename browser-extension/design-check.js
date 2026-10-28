// Design and usability checks that need the real, rendered page: colours,
// sizes, overlaps, focus outlines. Injected into the inspected tab (isolated
// world) by popup.js. Each function must be self-contained.

/** Runs in the page. Returns grouped issues; keeps element references for highlighting. */
export function designAudit() {
  const MAX_ELEMENTS = 2500;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const issues = {};
  const els = {};
  window.__siEls = els;

  // ── helpers ───────────────────────────────────────────
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const hex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  // Background colour actually behind an element (null if an image/gradient is behind it).
  const bgCache = new Map();
  const background = (el) => {
    if (bgCache.has(el)) return bgCache.get(el);
    const layers = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const st = getComputedStyle(node);
      if (st.backgroundImage && st.backgroundImage !== 'none') { bgCache.set(el, null); return null; }
      const c = parse(st.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      node = node.parentElement;
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    bgCache.set(el, out);
    return out;
  };
  const visible = (el, st = getComputedStyle(el)) => {
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.1) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) return `${s}#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => c && !/^(__si|is-|has-)/.test(c)).slice(0, 2) : [];
    if (cls.length) s += `.${cls.join('.')}`;
    const parent = el.parentElement;
    if (parent && parent !== document.body) {
      const p = parent.id ? `#${parent.id}` : parent.tagName.toLowerCase();
      s = `${p} > ${s}`;
    }
    return s;
  };
  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  // Smallest change that passes: first the text colour (towards black/white);
  // if even pure black/white text cannot pass, change the background instead.
  const mix = (c, to, t) => ({ r: c.r + (to.r - c.r) * t, g: c.g + (to.g - c.g) * t, b: c.b + (to.b - c.b) * t, a: 1 });
  const BLACK = { r: 0, g: 0, b: 0 }, WHITE = { r: 255, g: 255, b: 255 };
  const fixColor = (fg, bg, target) => {
    const toward = lum(bg) > 0.18 ? BLACK : WHITE;
    for (let t = 0.04; t <= 1.0001; t += 0.04) { const c = mix(fg, toward, t); if (ratio(c, bg) >= target) return `text ${hex(c)}`; }
    const bgToward = lum(fg) > 0.18 ? BLACK : WHITE;
    for (let t = 0.04; t <= 1.0001; t += 0.04) { const c = mix(bg, bgToward, t); if (ratio(fg, c) >= target) return `background ${hex(c)}`; }
    return `text ${hex(toward)}`;
  };
  const add = (id, severity, title, detail, fix, el, extra = '') => {
    if (!issues[id]) { issues[id] = { id, severity, title, detail, fix, count: 0, items: [] }; els[id] = []; }
    const it = issues[id];
    it.count++;
    if (it.items.length < 8) { it.items.push({ where: describe(el), text: label(el), extra }); els[id].push(el); }
  };

  const all = [...document.body.querySelectorAll('*')].slice(0, MAX_ELEMENTS);
  const fonts = new Set(), sizes = new Set(), colors = new Set();
  const contrastGroups = new Map();

  for (const el of all) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|PATH|BR|HEAD|META|LINK)$/i.test(el.tagName) || el.closest('svg')) continue;
    const st = getComputedStyle(el);
    if (!visible(el, st)) continue;
    const text = ownText(el);
    const size = parseFloat(st.fontSize);
    if (text.length > 1) {
      fonts.add(st.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      sizes.add(Math.round(size));
      colors.add(st.color);
      // Text contrast
      const fg = parse(st.color);
      const bg = background(el);
      if (fg && bg) {
        const fgBlended = fg.a < 1 ? blend(fg, bg) : fg;
        const large = size >= 24 || (size >= 18.66 && Number(st.fontWeight) >= 700);
        const need = large ? 3 : 4.5;
        const r = ratio(fgBlended, bg);
        if (r < need) {
          const key = `${hex(fgBlended)}|${hex(bg)}|${need}`;
          if (!contrastGroups.has(key)) contrastGroups.set(key, { fg: fgBlended, bg, r, need, els: [] });
          contrastGroups.get(key).els.push(el);
        }
      }
      if (size < 12 && !/^(SUP|SUB)$/.test(el.tagName)) add('tiny-text', 'low', 'Text too small to read', 'Text smaller than 12px is hard to read, especially on phones.', 'Use at least 16px for body text and 12px for small print (font-size).', el, `${size}px`);
      const lh = parseFloat(st.lineHeight);
      if (el.matches('p, li') && lh && lh < size * 1.2 && el.getBoundingClientRect().height > size * 2.2) add('tight-lines', 'low', 'Lines of text are too close together', 'Cramped line spacing makes paragraphs tiring to read.', 'Use line-height: 1.5 for paragraphs.', el, `line-height ${Math.round(lh)}px on ${Math.round(size)}px text`);
      if (el.matches('p') && el.getBoundingClientRect().width / (size * 0.5) > 110) add('long-lines', 'info', 'Lines of text are very long', 'Lines over ~80 characters are hard to follow.', 'Limit paragraph width, e.g. max-width: 70ch.', el);
    }
    // Clipped / cut-off text
    if (text.length > 3 && /hidden|clip/.test(st.overflowX + st.overflow) && el.scrollWidth > el.clientWidth + 2 && st.textOverflow !== 'ellipsis') add('clipped-text', 'medium', 'Text is cut off', 'Part of the text is hidden because its box is too small.', 'Let the text wrap (remove fixed width/height or white-space: nowrap) or use text-overflow: ellipsis with a tooltip.', el);
    // Horizontal overflow
    const rect = el.getBoundingClientRect();
    if (rect.right > vw + 2 && st.position !== 'fixed' && !el.closest('[style*="overflow"]')) {
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(ps.overflowX)) { clipped = true; break; } }
      if (!clipped && !els['overflow']?.some((x) => x.contains(el))) add('overflow', 'high', 'Content wider than the screen', 'This element sticks out past the right edge, causing sideways scrolling.', 'Use max-width: 100%, allow wrapping, and avoid fixed pixel widths on small screens.', el, `right edge ${Math.round(rect.right)}px, screen ${vw}px`);
    }
    // Sticky / fixed bars covering a lot of the screen
    if ((st.position === 'fixed' || st.position === 'sticky') && rect.height > vh * 0.35 && rect.width > vw * 0.6 && rect.top < vh && rect.bottom > 0) add('big-overlay', 'medium', 'A fixed bar or popup covers a large part of the screen', 'Fixed headers, banners or popups taller than a third of the screen hide content, especially on phones.', 'Make it smaller, collapsible, or dismissable with a clear close button.', el, `${Math.round(rect.height)}px tall`);
  }

  for (const g of contrastGroups.values()) {
    const sev = g.r < 3 ? 'high' : 'medium';
    for (const el of g.els) add(`contrast-${sev}`, sev, sev === 'high' ? 'Text is very hard to read (very low contrast)' : 'Text has low colour contrast', 'The text colour is too close to the background colour.', 'Change the text colour (or the background) to the suggested colour; aim for 4.5:1, or 3:1 for large text.', el, `${hex(g.fg)} on ${hex(g.bg)} = ${g.r.toFixed(2)}:1 → try ${fixColor(g.fg, g.bg, g.need)}`);
  }

  // ── Buttons and links ─────────────────────────────────
  const interactive = [...document.querySelectorAll('a[href], button, input[type="submit"], input[type="button"], [role="button"], select, input:not([type="hidden"]), textarea')].filter((el) => visible(el)).slice(0, 400);
  for (const el of interactive) {
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const isButton = el.matches('button, input[type="submit"], input[type="button"], [role="button"]') || /\b(btn|button|cta)\b/i.test(typeof el.className === 'string' ? el.className : '');
    const name = label(el);
    // Empty buttons/links
    if (!name && !el.querySelector('img[alt]:not([alt=""])') && !el.matches('input:not([type="submit"]):not([type="button"]), select, textarea')) add('no-name', 'medium', 'Buttons or links with no text or label', 'Screen readers announce them as just "button" or "link", and some users cannot tell what they do.', 'Add visible text, or aria-label="…" for icon-only buttons.', el);
    // Tap size
    const inline = el.matches('a') && st.display === 'inline' && el.parentElement && ownText(el.parentElement).length > 20;
    if (!inline && (r.width < 24 || r.height < 24)) add('small-target', 'medium', 'Buttons or links too small to tap', 'Targets smaller than 24×24 px are easy to miss on phones.', 'Make them at least 24×24 px (44×44 is better), e.g. padding: 10px 14px; min-height: 44px.', el, `${Math.round(r.width)}×${Math.round(r.height)} px`);
    // Button blends into background (no fill difference and no visible border)
    if (isButton && !el.matches('input:not([type="submit"]):not([type="button"])')) {
      const own = parse(st.backgroundColor);
      const parentBg = el.parentElement ? background(el.parentElement) : { r: 255, g: 255, b: 255, a: 1 };
      const fill = own && own.a > 0 ? blend(own, parentBg) : parentBg;
      const borderC = parse(st.borderTopColor);
      const borderW = parseFloat(st.borderTopWidth) || 0;
      const fillDiff = parentBg ? ratio(fill, parentBg) : 2;
      const borderDiff = borderC && borderW >= 1 && parentBg ? ratio(blend(borderC, parentBg), parentBg) : 1;
      if (parentBg && fillDiff < 1.3 && borderDiff < 1.5 && !st.boxShadow.includes('rgb') && st.backgroundImage === 'none') add('button-blends', 'medium', 'Buttons blend into the background', 'The button has no fill or border that stands out, so it looks like plain text.', 'Give buttons a solid fill or a visible border (at least 3:1 against the background).', el, `button ${hex(fill)} on ${hex(parentBg)}`);
    }
    // Covered by another element (e.g. cookie banner, sticky header, invisible layer)
    if (r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw) {
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      if (top && top !== el && !el.contains(top) && !top.contains(el) && !top.closest('.__si-hl')) add('covered', 'high', 'Buttons or links covered by another element', 'Something is on top of these, so clicking them hits the other element instead.', 'Fix the overlapping element (z-index, position, or an invisible full-screen layer) so the button can be clicked.', el, `covered by ${describe(top)}`);
    }
    // Links that look like plain text inside paragraphs
    if (el.matches('a') && st.display === 'inline' && el.parentElement && ownText(el.parentElement).length > 20 && !/underline/.test(st.textDecorationLine)) {
      const pc = parse(getComputedStyle(el.parentElement).color), lc = parse(st.color);
      if (pc && lc && ratio(lc, pc) < 3 && Number(st.fontWeight) <= Number(getComputedStyle(el.parentElement).fontWeight)) add('link-like-text', 'low', 'Links look like normal text', 'Links inside sentences have no underline and almost the same colour as the text.', 'Underline links in text (text-decoration: underline) or use a clearly different colour and weight.', el, `${hex(lc)} vs text ${hex(pc)}`);
    }
  }

  // Placeholder used instead of a label
  for (const input of document.querySelectorAll('input[placeholder]:not([type="hidden"]), textarea[placeholder]')) {
    if (!visible(input)) continue;
    const id = input.id;
    const hasLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby') || input.closest('label') || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
    if (!hasLabel) add('placeholder-label', 'medium', 'Form fields use a placeholder instead of a label', 'The hint disappears while typing, and screen readers may not read it.', 'Add a visible <label> above each field.', input, `placeholder "${input.placeholder.slice(0, 40)}"`);
  }

  // Images: broken, blurry (stretched), much bigger than shown
  for (const img of document.images) {
    if (!visible(img) && !(img.complete && img.naturalWidth === 0)) continue;
    const r = img.getBoundingClientRect();
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) add('broken-image', 'high', 'Broken images', 'These images fail to load and show an empty box or icon.', 'Fix the file path or upload the missing image.', img, img.currentSrc.split('/').pop().slice(0, 60));
    else if (img.naturalWidth && r.width > img.naturalWidth * 1.5 * (window.devicePixelRatio > 1 ? 0.75 : 1) && r.width > 120) add('blurry-image', 'low', 'Images stretched larger than their real size (blurry)', 'The image file is smaller than the space it fills.', 'Upload a larger image (at least 2× the displayed width for sharp phone screens).', img, `file ${img.naturalWidth}px, shown ${Math.round(r.width)}px`);
    else if (img.naturalWidth > r.width * 3 && img.naturalWidth > 1200 && r.width > 0) add('oversized-image', 'low', 'Images much bigger than needed (slow)', 'Large files are downloaded and then shrunk by the browser.', 'Resize to about 2× the displayed width and convert to WebP; add srcset for different screens.', img, `file ${img.naturalWidth}px, shown ${Math.round(r.width)}px`);
    if (r.width > 40 && (img.naturalWidth && img.naturalHeight) && Math.abs(r.width / r.height - img.naturalWidth / img.naturalHeight) > 0.15 * (img.naturalWidth / img.naturalHeight) && !/cover|contain/.test(getComputedStyle(img).objectFit)) add('distorted-image', 'medium', 'Images are stretched or squashed', 'The shape on screen does not match the image, so it looks distorted.', 'Set only width (height: auto), or use object-fit: cover.', img, `file ${img.naturalWidth}×${img.naturalHeight}, shown ${Math.round(r.width)}×${Math.round(r.height)}`);
  }

  // Keyboard focus: is there any visible change when focused?
  const prev = document.activeElement;
  const focusables = interactive.filter((el) => !el.matches('input, select, textarea')).slice(0, 30);
  for (const el of focusables) {
    const before = getComputedStyle(el);
    const snap = [before.outlineStyle, before.outlineWidth, before.boxShadow, before.backgroundColor, before.borderColor, before.textDecorationLine, before.color].join('|');
    try { el.focus({ preventScroll: true }); } catch { continue; }
    if (document.activeElement !== el) continue;
    const after = getComputedStyle(el);
    const outlineVisible = after.outlineStyle !== 'none' && parseFloat(after.outlineWidth) > 0;
    const changed = [after.outlineStyle, after.outlineWidth, after.boxShadow, after.backgroundColor, after.borderColor, after.textDecorationLine, after.color].join('|') !== snap;
    if (!outlineVisible && !changed) add('no-focus', 'medium', 'No visible focus outline for keyboard users', 'People using the keyboard (Tab key) cannot see which button or link is selected.', 'Do not remove outlines; add a style like :focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }', el);
  }
  try {
    if (prev && prev !== document.body && prev.focus) prev.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  } catch { /* ignore */ }

  // Consistency
  if (document.documentElement.scrollWidth > vw + 2 && !issues.overflow) add('overflow', 'high', 'Content wider than the screen', 'The page scrolls sideways.', 'Find wide elements (images, tables, fixed widths) and constrain them with max-width: 100%.', document.body, `page ${document.documentElement.scrollWidth}px, screen ${vw}px`);
  const summary = { fonts: [...fonts].filter(Boolean), fontSizes: [...sizes].sort((a, b) => a - b), textColors: colors.size, viewport: `${vw}×${vh}` };
  if (summary.fonts.length > 3) add('many-fonts', 'info', `${summary.fonts.length} different fonts`, `Fonts used: ${summary.fonts.slice(0, 8).join(', ')}.`, 'Use 1–2 font families for a clean, consistent look.', document.body);
  if (summary.fontSizes.length > 12) add('many-sizes', 'info', `${summary.fontSizes.length} different text sizes`, `Sizes: ${summary.fontSizes.join(', ')} px.`, 'Use a small type scale (e.g. 12, 14, 16, 20, 24, 32, 48).', document.body);
  if (summary.textColors > 14) add('many-colors', 'info', `${summary.textColors} different text colours`, 'Many slightly different colours look inconsistent.', 'Define a small colour palette (CSS variables) and reuse it.', document.body);

  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return { issues: Object.values(issues).sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count), summary };
}

/** Runs in the page: scrolls to an element found by designAudit and outlines it. */
export function highlightElement(id, index) {
  document.querySelectorAll('.__si-hl').forEach((n) => n.remove());
  const el = window.__siEls && window.__siEls[id] && window.__siEls[id][index];
  if (!el || !el.isConnected) return false;
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  setTimeout(() => {
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = '__si-hl';
    Object.assign(box.style, {
      position: 'absolute', left: `${r.left + scrollX - 4}px`, top: `${r.top + scrollY - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`,
      border: '3px solid #ff2d55', borderRadius: '6px', boxShadow: '0 0 0 4px rgba(255,45,85,.25)', zIndex: '2147483647', pointerEvents: 'none',
    });
    document.body.append(box);
    setTimeout(() => box.remove(), 5000);
  }, 450);
  return true;
}
