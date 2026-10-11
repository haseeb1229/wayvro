import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { isMockProvider } from '@wayvro/provider-interfaces';
import { LocalOidcIssuer } from './oidc.js';

describe('LocalOidcIssuer (test-only OIDC issuer)', () => {
  it('is branded as a mock and publishes one RS256 signing key per provider', async () => {
    const issuer = await LocalOidcIssuer.create();
    expect(isMockProvider(issuer)).toBe(true);
    for (const provider of ['GOOGLE', 'APPLE'] as const) {
      const set = await issuer.keySet(provider);
      expect(set.keys).toHaveLength(1);
      expect(set.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
      expect(set.keys[0]).not.toHaveProperty('d'); // public material only
    }
  });

  it('mints tokens that verify against its own key set with the provider issuer, audience, subject and nonce', async () => {
    const issuer = await LocalOidcIssuer.create();
    const token = await issuer.mint({ provider: 'APPLE', subject: 'sub-1', audience: 'aud-1', nonce: 'n-1' });
    const { payload } = await jwtVerify(token, createLocalJWKSet({ keys: [...(await issuer.keySet('APPLE')).keys] }), {
      issuer: 'https://appleid.apple.com',
      audience: 'aud-1',
      algorithms: ['RS256'],
    });
    expect(payload).toMatchObject({ sub: 'sub-1', nonce: 'n-1' });
  });

  it('produces adversarial variants: unpublished key, other issuer, chosen times', async () => {
    const issuer = await LocalOidcIssuer.create();
    const keys = createLocalJWKSet({ keys: [...(await issuer.keySet('GOOGLE')).keys] });
    const forged = await issuer.mint({ provider: 'GOOGLE', subject: 's', audience: 'a', nonce: 'n', unpublishedKey: true });
    await expect(jwtVerify(forged, keys)).rejects.toThrow();
    const foreign = await issuer.mint({ provider: 'GOOGLE', subject: 's', audience: 'a', nonce: 'n', issuer: 'https://example.invalid' });
    expect(decodeJwt(foreign).iss).toBe('https://example.invalid');
    const old = await issuer.mint({ provider: 'GOOGLE', subject: 's', audience: 'a', nonce: 'n', issuedAtSeconds: 1_000, expiresInSeconds: 60 });
    expect(decodeJwt(old)).toMatchObject({ iat: 1_000, exp: 1_060 });
  });
});
