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
