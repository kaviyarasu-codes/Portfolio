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
- **Automated website checks** (Cloudflare Pages Function `functions/api/audit.js`): status and redirects, HTTPS, security headers and cookies, page markup (title, description, viewport, lang, headings, alt text, form labels, empty links/buttons), mixed content, scripts without integrity checks, broken links and missing files, robots.txt / sitemap / security.txt, SPF / DMARC / CAA, response time.
- **Google Lighthouse** on a phone via PageSpeed Insights (`functions/api/pagespeed.js`): performance, accessibility, best practices and SEO scores, Core Web Vitals, top fixes and a phone screenshot.
- **Android APK checks** in the browser (`assets/js/apk-audit.js`; the APK is never uploaded): debuggable / testOnly / backup / cleartext flags, network security config, target SDK, exported components, deep links, restricted permissions, signing (debug certificate, v1/v2), 64-bit and 16 KB page-size native libraries, hardcoded secrets, risky WebView/TLS code.
- **AI review by Claude** (`functions/api/explain.js`): plain-language summary, fix-first list with effort, quick wins, likely false positives and a ready-to-send message for the owner.

Only checks what a normal visitor's browser sees; nothing is submitted, brute-forced or load-tested. Review only sites and apps you own or have permission to review.

### Setup (Cloudflare Pages → your project → Settings → Variables and secrets, for Production and Preview)

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` (secret) | Your Claude API key from console.anthropic.com |
| `FIREBASE_PROJECT_ID` | `portfolio-contact-39c14` |
| `ADMIN_UID` | Your Firebase Auth user UID (Firebase console → Authentication → Users). Or set `ADMIN_EMAIL` instead. |
| `PAGESPEED_API_KEY` (optional) | Google Cloud API key with the PageSpeed Insights API enabled (raises the free quota) |

Sign in at `/site-audit` with your admin account (the same login as `/admin`). Every `/api/*` call verifies your Firebase sign-in token on the server, so nobody else can use the tool or your API credit. Each AI review costs roughly a few cents of Claude API usage.

### Run locally

```bash
printf 'DEV_BYPASS_AUTH=true\nALLOW_LOCAL_TARGETS=true\nANTHROPIC_API_KEY=sk-ant-...\n' > .dev.vars   # never commit this file
npx wrangler pages dev .                      # then open http://127.0.0.1:8788/site-audit?dev
```
`DEV_BYPASS_AUTH` only works on localhost and must never be set in Cloudflare.
