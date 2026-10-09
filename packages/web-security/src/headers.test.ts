import { describe, expect, it } from 'vitest';
import { PRIVATE_SURFACE_HEADERS, STATIC_SECURITY_HEADERS, buildContentSecurityPolicy, createNonce } from './index.js';

describe('content security policy', () => {
  it('is nonce-based with no unsafe script sources in production', () => {
    const csp = buildContentSecurityPolicy({ nonce: 'abc123', development: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp.split('; ')).toContain('upgrade-insecure-requests');
  });

  it('allows unsafe-eval only for development and adds declared connect origins', () => {
    const csp = buildContentSecurityPolicy({ nonce: 'n', development: true, connectSrc: ['https://api.example.test'] });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' https://api.example.test");
  });
});

describe('nonces and static headers', () => {
  it('generates unique 128-bit nonces', () => {
    const a = createNonce();
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
    expect(createNonce()).not.toBe(a);
  });

  it('ships the baseline and private-surface headers', () => {
    const keys = STATIC_SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(['X-Content-Type-Options', 'Strict-Transport-Security', 'X-Frame-Options', 'Permissions-Policy']));
    expect(PRIVATE_SURFACE_HEADERS.find((h) => h.key === 'X-Robots-Tag')?.value).toContain('noindex');
  });
});
