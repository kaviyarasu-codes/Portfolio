// Static design review of a site's CSS: colour pairs with low contrast,
// invisible buttons, removed focus outlines, tiny text, missing breakpoints
// and consistency. Works on the stylesheet text, without rendering the page.

const NAMED = {
  white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', whitesmoke: '#f5f5f5',
  gainsboro: '#dcdcdc', yellow: '#ffff00', orange: '#ffa500', navy: '#000080', teal: '#008080', maroon: '#800000', purple: '#800080',
  aliceblue: '#f0f8ff', ghostwhite: '#f8f8ff', snow: '#fffafa', ivory: '#fffff0', beige: '#f5f5dc', linen: '#faf0e6', lightyellow: '#ffffe0',
};

/** Very small CSS parser: [{ selector, decls: {prop: value}, media }]. */
export function parseCss(text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const walk = (src, media) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      // find the matching close brace
      let depth = 1, j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      const body = src.slice(open + 1, j - 1);
      if (/^@(media|supports|layer|container)/i.test(head)) walk(body, /^@media/i.test(head) ? head : media);
      else if (!head.startsWith('@')) {
        const decls = {};
        for (const part of body.split(';')) {
          const k = part.indexOf(':');
          if (k < 0) continue;
          const prop = part.slice(0, k).trim().toLowerCase();
          const value = part.slice(k + 1).trim();
          if (prop) decls[prop] = value;
        }
        rules.push({ selector: head.replace(/\s+/g, ' '), decls, media });
      }
      i = j;
    }
  };
  walk(css, null);
  return rules;
}

function parseColor(v) {
  if (!v) return null;
  v = v.replace(/!important/i, '').trim().toLowerCase();
  if (NAMED[v]) v = NAMED[v];
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]) : 1 };
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}

const hex = (c) => `#${[c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (c, to, t) => ({ r: c.r + (to.r - c.r) * t, g: c.g + (to.g - c.g) * t, b: c.b + (to.b - c.b) * t, a: 1 });

/** Smallest colour change that reaches the target ratio (text first, then background). */
export function suggestColor(fg, bg, target = 4.5) {
  const BLACK = { r: 0, g: 0, b: 0 }, WHITE = { r: 255, g: 255, b: 255 };
  const toward = lum(bg) > 0.18 ? BLACK : WHITE;
  for (let t = 0.04; t <= 1.0001; t += 0.04) { const c = mix(fg, toward, t); if (contrast(c, bg) >= target) return `text ${hex(c)}`; }
  const bgToward = lum(fg) > 0.18 ? BLACK : WHITE;
  for (let t = 0.04; t <= 1.0001; t += 0.04) { const c = mix(bg, bgToward, t); if (contrast(fg, c) >= target) return `background ${hex(c)}`; }
  return `text ${hex(toward)}`;
}

function px(value, rootPx = 16) {
  const m = /^(-?[\d.]+)(px|rem|em|pt)$/.exec((value || '').trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'px' ? n : m[2] === 'pt' ? n * 4 / 3 : n * rootPx;
}

const f = (severity, id, title, detail, fix) => ({ severity, id, title, detail, fix });

/** @param {{url: string, text: string}[]} sheets */
export function reviewCss(sheets) {
  const rules = sheets.flatMap((s) => parseCss(s.text).map((r) => ({ ...r, sheet: s.url })));
  if (!rules.length) return { findings: [], stats: { rules: 0 } };
  // CSS variables: resolve var(--x) one level from any rule that defines them.
  const vars = {};
  for (const r of rules) for (const [k, v] of Object.entries(r.decls)) if (k.startsWith('--') && !(k in vars)) vars[k] = v;
  const val = (v) => (v || '').replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, name, fb) => vars[name] || fb || '').trim();
  const findings = [];
  const where = (r) => `${r.selector.slice(0, 80)}${r.media ? ` (${r.media.slice(0, 40)})` : ''}`;

  // 1. Low-contrast colour pairs declared together
  const lowPairs = [];
  for (const r of rules) {
    const fg = parseColor(val(r.decls.color));
    const bgRaw = val(r.decls['background-color'] || (/^(#|rgb|[a-z]+$)/i.test(val(r.decls.background)) ? r.decls.background : ''));
    const bg = parseColor(bgRaw);
    if (!fg || !bg || bg.a < 1 || fg.a < 0.5 || /::?placeholder|:disabled|\[disabled\]/i.test(r.selector)) continue;
    const ratio = contrast(fg, bg);
    const size = px(val(r.decls['font-size']));
    const bold = /bold|[6-9]00/.test(val(r.decls['font-weight']));
    const need = (size && size >= 24) || (size && size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) lowPairs.push({ r, fg, bg, ratio, need });
  }
  if (lowPairs.length) {
    lowPairs.sort((a, b) => a.ratio - b.ratio);
    findings.push(f(lowPairs[0].ratio < 3 ? 'high' : 'medium', 'DESIGN-CSS-CONTRAST', `${lowPairs.length} colour pair(s) in the CSS have low contrast`,
      lowPairs.slice(0, 8).map((p) => `• ${where(p.r)}: ${hex(p.fg)} on ${hex(p.bg)} = ${p.ratio.toFixed(2)}:1 → try ${suggestColor(p.fg, p.bg, p.need)}`).join('\n'),
      'Change the text or background colour of these rules to the suggested values (at least 4.5:1, or 3:1 for large text).'));
  }

  // 2. Focus outlines removed without a replacement
  const noFocus = rules.filter((r) => /:focus(?!-within)/.test(r.selector) && /^(none|0|0px)$/.test(val(r.decls.outline || r.decls['outline-style'] || '').replace(/\s*!important/, ''))
    && !r.decls['box-shadow'] && !r.decls.border && !r.decls['border-color'] && !r.decls['text-decoration'] && !r.decls.background && !r.decls['background-color']);
  if (noFocus.length) findings.push(f('medium', 'DESIGN-CSS-NO-FOCUS', 'Keyboard focus outline is removed', noFocus.slice(0, 6).map((r) => `• ${where(r)} { outline: ${r.decls.outline || r.decls['outline-style']} }`).join('\n'),
    'Keep a visible focus style: :focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; } (only hide it for mouse clicks with :focus:not(:focus-visible)).'));

  // 3. Buttons with no fill and no border
  const ghost = rules.filter((r) => /(^|[\s,.#>])(button|\.btn|\.button|\.cta|input\[type=["']?submit)/i.test(r.selector) && !/:(hover|focus|active|disabled)/.test(r.selector)
    && /^(transparent|none|rgba\([^)]*,\s*0\))$/i.test(val(r.decls['background-color'] || r.decls.background || ''))
    && /^(none|0|0px)?$/.test(val(r.decls.border || '').trim()) && !r.decls['border-color'] && !r.decls['box-shadow'] && !r.decls['text-decoration']);
  if (ghost.length) findings.push(f('low', 'DESIGN-CSS-GHOST-BUTTON', 'Some button styles have no fill and no border', ghost.slice(0, 6).map((r) => `• ${where(r)}`).join('\n'),
    'Make buttons look clickable: a solid background, or a visible border (3:1 against the page), plus a hover state.'));

  // 4. Tiny text
  const tiny = rules.filter((r) => { const s = px(val(r.decls['font-size'])); return s !== null && s > 0 && s < 12 && !/\b(sup|sub|small|code|kbd|\.sr-only|\.visually-hidden|::?placeholder)\b/i.test(r.selector); });
  if (tiny.length) findings.push(f('low', 'DESIGN-CSS-TINY-TEXT', `${tiny.length} rule(s) set text smaller than 12px`, tiny.slice(0, 8).map((r) => `• ${where(r)} { font-size: ${r.decls['font-size']} }`).join('\n'),
    'Use at least 16px for body text and 12px for small print.'));

  // 5. Cramped line-height on body text
  const tight = rules.filter((r) => /(^|[\s,])(body|p|li|\.content|article)([\s,:.]|$)/.test(r.selector) && /^(0?\.\d+|1(\.0+|\.1\d*)?)$/.test(val(r.decls['line-height'] || '')));
  if (tight.length) findings.push(f('low', 'DESIGN-CSS-TIGHT', 'Paragraph line spacing is cramped', tight.slice(0, 5).map((r) => `• ${where(r)} { line-height: ${r.decls['line-height']} }`).join('\n'), 'Use line-height: 1.5 for paragraphs.'));

  // 6. Responsiveness
  const hasMedia = rules.some((r) => r.media && /(max|min)-width/i.test(r.media)) || sheets.some((s) => /@media[^{]*(max|min)-width|@container/i.test(s.text));
  const usesFlexGrid = rules.some((r) => /^(flex|grid|inline-flex|inline-grid)$/.test(val(r.decls.display || '')));
  if (!hasMedia && !usesFlexGrid && rules.length > 30) findings.push(f('medium', 'DESIGN-CSS-NOT-RESPONSIVE', 'No mobile breakpoints in the CSS', 'The stylesheets have no @media width rules and no flexible layouts, so the layout probably does not adapt to phones.', 'Add responsive layout (flex/grid with wrapping) and @media (max-width: 768px) rules for phones.'));
  const hiddenOverflow = rules.filter((r) => /^(html|body)(\s*,\s*(html|body))?$/i.test(r.selector) && /hidden|clip/.test(val(r.decls['overflow-x'] || r.decls.overflow || '')));
  if (hiddenOverflow.length) findings.push(f('low', 'DESIGN-CSS-HIDE-OVERFLOW', 'Sideways scrolling is hidden instead of fixed', hiddenOverflow.map((r) => `• ${where(r)} { overflow: ${r.decls['overflow-x'] || r.decls.overflow} }`).join('\n'),
    'overflow-x: hidden on html/body hides elements that stick out (and can break sticky headers). Find and fix the wide element instead.'));
  const wide = rules.filter((r) => { const w = px(val(r.decls.width)); return w !== null && w >= 900 && !r.decls['max-width'] && !(r.media && /min-width/.test(r.media)); });
  if (wide.length) findings.push(f('low', 'DESIGN-CSS-FIXED-WIDTH', 'Fixed widths that are wider than phones', wide.slice(0, 6).map((r) => `• ${where(r)} { width: ${r.decls.width} }`).join('\n'), 'Use max-width with width: 100% so these elements shrink on small screens.'));

  // 7. Consistency and maintainability
  const colorSet = new Set();
  const fontSet = new Set();
  let important = 0;
  for (const r of rules) {
    for (const [k, v] of Object.entries(r.decls)) {
      if (/!important/i.test(v)) important++;
      if (/^(color|background-color|border-color)$/.test(k)) { const c = parseColor(val(v)); if (c && c.a > 0) colorSet.add(hex(c)); }
      if (k === 'font-family') fontSet.add(val(v).split(',')[0].replace(/["']/g, '').trim().toLowerCase());
    }
  }
  if (colorSet.size > 40) findings.push(f('info', 'DESIGN-CSS-MANY-COLORS', `${colorSet.size} different colours in the CSS`, 'Many near-identical colours make the design look inconsistent.', 'Define a small palette as CSS variables (--brand, --text, --muted, --bg) and reuse it.'));
  const fonts = [...fontSet].filter((x) => x && !/^(inherit|initial|var|sans-serif|serif|monospace|system-ui|-apple-system)$/.test(x));
  if (fonts.length > 4) findings.push(f('info', 'DESIGN-CSS-MANY-FONTS', `${fonts.length} font families in the CSS`, fonts.slice(0, 10).join(', '), 'Use 1–2 font families; each extra font also slows the page.'));
  if (important > 60) findings.push(f('info', 'DESIGN-CSS-IMPORTANT', `!important is used ${important} times`, 'Heavy use of !important makes styles hard to change and causes "my change does not show" bugs.', 'Reduce !important by using more specific selectors or cleaning up conflicting rules.'));

  return { findings, stats: { rules: rules.length, colors: colorSet.size, fonts: fonts.length, important, responsive: hasMedia || usesFlexGrid } };
}
