# Kaviyarasu K — Portfolio

![Portfolio preview](assets/img/og-image.jpg)

My personal portfolio: **[kaviyarasu-portfolio.pages.dev](https://kaviyarasu-portfolio.pages.dev)**

## Features
- Light/dark theme, bento-style home page, floating navigation, mobile-first layout
- Projects page with filters and collapsible app / admin screen galleries
- **Contact form** → saved to Firebase Firestore, email to me + auto-reply to the sender (EmailJS), spam honeypot
- **Admin dashboard** (`admin.html`) behind Firebase Auth: live inbox, search, unread/starred filters, pagination, Excel export
- Animated logo footer, WhatsApp QR, SEO meta, Open Graph image, sitemap, security headers

## Tech
HTML · CSS · JavaScript · Firebase (Firestore, Auth) · EmailJS · SheetJS · Phosphor Icons · Cloudflare Pages

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
Every push to `main` deploys automatically to Cloudflare Pages.

---

Built by **Kaviyarasu K** — Full-Stack & App Developer, Coimbatore · [Portfolio](https://kaviyarasu-portfolio.pages.dev) · [LinkedIn](https://www.linkedin.com/in/kaviyarasu-kanthavel/)

## Private Site Audit tool (`/site-audit`)

Owner-only page for reviewing client websites, web apps and Android APKs. Paste a link (or drop an APK) and get:
- **Exact elements from Lighthouse**: failing contrast, tap-size, button/link name, image and console checks list the elements and colours involved, as plain-language findings in the fix plan.
- **Design check in a real browser** (`functions/_lib/visual.js`, optional): opens the page in Chrome at phone (390 px) and desktop (1366 px) size through Cloudflare Browser Rendering, boxes and numbers every problem on full-page screenshots and lists the exact element: low-contrast text with the colour to use instead, buttons that blend in, are covered by another element or are too small to tap, links that look like text, content wider than the screen, cut-off text, broken/blurry/stretched images, placeholder-only fields, missing focus outlines, tiny text and cramped lines. Pages with a strict Content-Security-Policy may block the check script; the screenshot still shows.
- **CSS design review** (`functions/_lib/css-review.js`, always on): reads the site's own stylesheets for low-contrast colour pairs (with a suggested colour), removed focus outlines, ghost buttons, tiny fonts, tight line height, fixed widths, no responsive rules, too many colours/fonts/`!important`.
- **Every page**: the home page plus up to 25 pages found in the menu, links and sitemap, each with HTTP status, response time, issues, and (optionally) a phone screenshot and Lighthouse scores.
- **How it is built**: languages, CMS / site builder (WordPress, Shopify, Wix, Webflow, Framer, AI builders such as Lovable, Bolt, v0, Hostinger), frameworks and library versions, backend framework, database/backend services, hosting/CDN, web server, DNS and email providers, analytics, chat, payments and forms.
- **Checks by area**: frontend (layout basics, accessibility, broken images/links, stray text), backend (visible PHP warnings, debug pages, stack traces), database (visible SQL/connection errors, Firebase/Supabase exposure in public code), security (HTTPS, headers, cookies, leaked keys in public JavaScript, outdated libraries with known CVEs, source maps), network & hosting (DNS, IPv6, HTTP/3, SPF/DMARC/CAA), performance and SEO.
- **Android APK checks** in the browser (`assets/js/apk-audit.js`; the APK is never uploaded).
- **AI review and a step-by-step fix plan**: plain-language summary, area-by-area status, phases of steps with "how to fix" and "how to check it is fixed". Tick steps off as you go (saved in the browser). Without AI, a plan is built from the automatic checks.

Only checks what a normal visitor's browser downloads; nothing is submitted, guessed, brute-forced or load-tested. Review only sites and apps you own or have permission to review.

### Setup (Cloudflare Pages → your project → Settings)

1. **Free AI (recommended)**: Settings → **Bindings** → **Add** → **Workers AI** → Variable name `AI` → Save. Free daily allowance, no key or card needed.
2. **Variables and secrets** (Production and Preview):

| Name | Required | Value |
|---|---|---|
| `PAGESPEED_API_KEY` (secret) | recommended | Google Cloud API key restricted to the PageSpeed Insights API (screenshots + Lighthouse) |
| `CF_ACCOUNT_ID` + `CF_API_TOKEN` (secret) | optional | Real-browser design check. Account ID: Workers & Pages overview (right side). Token: My Profile → API Tokens → Create Token → Custom → permission **Account → Browser Rendering → Edit** (free plan has a small daily allowance) |
| `AI_MODEL` | optional | Another Workers AI model ID (default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`) |
| `AI_PROVIDER` + `ANTHROPIC_API_KEY` (secret) | optional, paid | Set `AI_PROVIDER=claude` to use Claude instead; falls back to Workers AI if Claude has no credit |
| `ADMIN_UID` | optional | Lock the tool to one Firebase account UID (default: the admin email used by `admin.html` and the Firestore rules) |

3. Redeploy after changing settings (Deployments → ⋯ → Retry deployment).

Sign in at `/site-audit` with your admin account (the same login as `/admin`). Every `/api/*` call verifies your Firebase sign-in token on the server.

### Run locally

```bash
printf 'DEV_BYPASS_AUTH=true\nALLOW_LOCAL_TARGETS=true\n' > .dev.vars   # never commit this file
npx wrangler pages dev .                      # then open http://127.0.0.1:8788/site-audit?dev
```
`DEV_BYPASS_AUTH` only works on localhost and must never be set in Cloudflare.

## Firestore rules

`firestore.rules` holds the security rules for the contact form. Paste them into Firebase console → Firestore Database → Rules → Publish whenever they change.

## Site Inspector browser extension (`browser-extension/`)

A Chrome/Edge extension (Manifest V3), like Wappalyzer: click its icon on any website to see languages, CMS/builders, frameworks and library versions, hosting, analytics, chat, payments and forms, plus quick issues (HTTPS, security headers, outdated libraries, mixed content, viewport, alt text). It also reads the live page's JavaScript (e.g. `jQuery.fn.jquery`, React/Vue markers), so it finds things a server-side check cannot. Everything runs in the browser; nothing is sent anywhere. "Full audit" (and the right-click menu) opens `/site-audit?url=…`.

- **Design tab** (`design-check.js`) checks the rendered page: low-contrast text with the exact colours, ratio and a suggested passing colour; buttons that blend into the background, are covered by other elements (cookie bars, invisible layers), have no text, or are too small to tap; links that look like plain text; content wider than the screen; cut-off text; oversized fixed bars; broken, blurry, oversized or distorted images; placeholder-only form fields; missing keyboard focus outlines; tiny text, cramped or very long lines; too many fonts, sizes or colours. "Show" scrolls to and outlines each example on the page.
- Uses the same detection rules as the Site Audit (`functions/_lib/tech.js`, copied in by `build.sh`).
- Permissions: `activeTab` + `scripting` (access only to the tab you click on), `contextMenus`.
- Build the download: `bash browser-extension/build.sh` → `assets/downloads/site-inspector.zip` (linked from `/site-audit`).
- Install: unzip → `chrome://extensions` → Developer mode → Load unpacked. Publishing to the Chrome Web Store needs a one-time US$5 developer account.
