import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OTP_LOCALES, bearerToken, hashToken, newOpaqueToken, renderOtpMessage, tokenKind } from './index.js';

describe('opaque tokens', () => {
  it('carry 256 random bits with a kind prefix, and are hashed with SHA-256', () => {
    const access = newOpaqueToken('access');
    const refresh = newOpaqueToken('refresh');
    expect(access).toMatch(/^wva_[A-Za-z0-9_-]{43}$/);
    expect(refresh).toMatch(/^wvr_[A-Za-z0-9_-]{43}$/);
    expect(tokenKind(access)).toBe('access');
    expect(tokenKind(refresh)).toBe('refresh');
    expect(hashToken(access)).toHaveLength(32);
    expect(hashToken(access).equals(hashToken(access))).toBe(true);
    expect(new Set(Array.from({ length: 5000 }, () => newOpaqueToken('access'))).size).toBe(5000);
  });

  it('rejects anything that is not a well-formed Wayvro token (property)', () => {
    fc.assert(fc.property(fc.string({ maxLength: 80 }), (s) => tokenKind(s) === null || /^wv[ar]_[A-Za-z0-9_-]{43}$/.test(s)));
    expect(tokenKind('wvx_' + 'a'.repeat(43))).toBeNull();
    expect(tokenKind(newOpaqueToken('access') + 'x')).toBeNull();
  });

  it('parses only strict Bearer headers', () => {
    const t = newOpaqueToken('access');
    expect(bearerToken(`Bearer ${t}`)).toBe(t);
    for (const h of [undefined, '', t, `bearer ${t}`, `Bearer  ${t}`, `Bearer ${t} extra`, `Basic ${t}`]) expect(bearerToken(h)).toBeNull();
  });
});

describe('OTP message catalogue', () => {
  it('renders every locale with the code and TTL and rejects malformed codes', () => {
    for (const locale of OTP_LOCALES) {
      const m = renderOtpMessage(locale, '048213', 5);
      expect(m).toContain('048213');
      expect(m).toContain('5');
      expect(m).toContain('Wayvro');
    }
    expect(() => renderOtpMessage('en', '12345', 5)).toThrow(RangeError);
  });
});
