// Verifies the Firebase ID token sent by site-audit.html, so only the site
// owner can use the /api/* audit endpoints (they cost money and send requests
// to other sites). No SDK: the token is an RS256 JWT checked with WebCrypto
// against Google's published keys.
//
// Optional environment overrides (Cloudflare Pages → Settings → Variables and secrets):
//   FIREBASE_PROJECT_ID  defaults to this site's Firebase project
//   ADMIN_UID            Firebase Auth UID of the owner (strictest), or
//   ADMIN_EMAIL          owner's sign-in email (defaults to the admin.html account,
//                        matching the Firestore rules)

const DEFAULT_PROJECT_ID = 'portfolio-contact-39c14';
const DEFAULT_ADMIN_EMAIL = 'kaviyarasu.0aasai@gmail.com';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, expires: 0 };

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function decodePart(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function getKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.expires) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Could not load Google signing keys (${res.status})`);
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 3600);
  jwksCache = { keys: (await res.json()).keys, expires: Date.now() + maxAge * 1000 };
  return jwksCache.keys;
}

export class AuthError extends Error {}

/** Returns the verified token payload, or throws AuthError. */
export async function verifyFirebaseToken(token, env) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new AuthError('Missing or malformed sign-in token.');

  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== 'RS256') throw new AuthError('Unexpected token algorithm.');

  const jwk = (await getKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError('Unknown token signing key.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new AuthError('Invalid token signature.');

  const now = Math.floor(Date.now() / 1000);
  const project = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  if (payload.aud !== project || payload.iss !== `https://securetoken.google.com/${project}`) throw new AuthError('Token is for a different Firebase project.');
  if (!(payload.exp > now - 30) || !(payload.iat <= now + 30)) throw new AuthError('Sign-in expired. Please sign in again.');
  if (!payload.sub) throw new AuthError('Token has no user.');

  const ok = env.ADMIN_UID
    ? payload.sub === env.ADMIN_UID
    : (payload.email || '').toLowerCase() === (env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).toLowerCase();
  if (!ok) throw new AuthError('This account is not allowed to use the audit tool.');
  return payload;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Wraps a handler with owner-only auth and uniform error responses. */
export function ownerOnly(handler) {
  return async (context) => {
    const auth = context.request.headers.get('authorization') || '';
    // Local testing only (`wrangler pages dev` with DEV_BYPASS_AUTH=true in .dev.vars); never set in Cloudflare.
    const local = ['localhost', '127.0.0.1'].includes(new URL(context.request.url).hostname);
    try {
      if (!(local && context.env.DEV_BYPASS_AUTH === 'true')) await verifyFirebaseToken(auth.replace(/^Bearer\s+/i, ''), context.env);
    } catch (e) {
      return json({ error: e instanceof AuthError ? e.message : `Sign-in check failed: ${e.message}` }, 401);
    }
    try {
      return await handler(context);
    } catch (e) {
      return json({ error: e.message || String(e) }, e.status || 500);
    }
  };
}
