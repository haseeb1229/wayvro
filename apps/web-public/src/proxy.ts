import { buildContentSecurityPolicy, createNonce } from '@wayvro/web-security';
import { NextResponse, type NextRequest } from 'next/server';

/** Per-request nonce CSP (Next.js attaches the nonce to its own scripts when it sees the request CSP header). */
export function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({ nonce, development: process.env.NODE_ENV === 'development' });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
