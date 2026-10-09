/**
 * Security headers for the Next.js web surfaces (Q04; docs/10 "strict CSP"). The CSP is nonce-based: every response
 * gets a fresh nonce, Next.js attaches it to its own scripts, and no `unsafe-inline`/`unsafe-eval` script source is
 * allowed in production builds.
 */

export interface CspOptions {
  readonly nonce: string;
  /** `next dev` needs `unsafe-eval` for React Refresh; never set this for production builds. */
  readonly development: boolean;
  /** Extra origins the page may call (e.g. the API); same-origin is always allowed. */
  readonly connectSrc?: readonly string[];
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  const scriptSrc = [`'self'`, `'nonce-${options.nonce}'`, `'strict-dynamic'`, ...(options.development ? [`'unsafe-eval'`] : [])];
  const directives: Record<string, string[]> = {
    'default-src': [`'self'`],
    'script-src': scriptSrc,
    'style-src': [`'self'`, `'nonce-${options.nonce}'`],
    'img-src': [`'self'`, 'data:'],
    'font-src': [`'self'`],
    'connect-src': [`'self'`, ...(options.connectSrc ?? [])],
    'object-src': [`'none'`],
    'base-uri': [`'self'`],
    'form-action': [`'self'`],
    'frame-ancestors': [`'none'`],
    'upgrade-insecure-requests': [],
  };
  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ');
}

/** Headers that do not depend on the request; applied to every route via next.config `headers()`. */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
];

/** Extra headers for the private operations surface: never indexed, never cached by shared caches. */
export const PRIVATE_SURFACE_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
  { key: 'Cache-Control', value: 'no-store' },
];

/** 128-bit random nonce, base64-encoded, using Web Crypto (available in the Next.js proxy/edge runtime). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
