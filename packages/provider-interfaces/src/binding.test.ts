import { describe, expect, it } from 'vitest';
import { MOCK_PROVIDER, ProviderBindingError, bindProviders, isMockProvider, type MockBrand, type ObjectStoragePort, type OtpDeliveryPort } from './index.js';
import type { WayvroEnv } from '@wayvro/config';

/** Branded fake defined here: the real doubles live in @wayvro/provider-test-doubles, which depends on this package. */
class BrandedOtpFake implements OtpDeliveryPort, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;
  send(): Promise<{ providerMessageId: string }> {
    return Promise.resolve({ providerMessageId: 'fake' });
  }
}

class FakeRealStorage implements ObjectStoragePort {
  putObject(): Promise<void> {
    return Promise.resolve();
  }
  getObject(): Promise<Uint8Array | null> {
    return Promise.resolve(null);
  }
  createUploadUrl(): Promise<{ url: string; expiresAt: Date }> {
    return Promise.resolve({ url: 'https://storage.example/upload', expiresAt: new Date() });
  }
}

describe('provider binding guard (defence in depth, ADR-045)', () => {
  it.each<WayvroEnv>(['staging', 'production'])('production-like boot (%s) refuses every branded test double', (env) => {
    expect(() => bindProviders(env, { otpDelivery: new BrandedOtpFake() })).toThrow(ProviderBindingError);
    expect(() => bindProviders(env, { otpDelivery: new BrandedOtpFake() })).toThrow(/refusing to bind mock provider "otpDelivery"/);
  });

  it.each<WayvroEnv>(['staging', 'production'])('an empty binding set in %s fails loudly when a port is used', (env) => {
    const registry = bindProviders(env, {});
    expect(registry.bound).toEqual([]);
    expect(registry.has('otpDelivery')).toBe(false);
    expect(() => registry.get('otpDelivery')).toThrow(/not bound/);
  });

  it('accepts non-branded implementations in production', () => {
    const registry = bindProviders('production', { objectStorage: new FakeRealStorage() });
    expect(registry.get('objectStorage')).toBeInstanceOf(FakeRealStorage);
    expect(registry.has('objectStorage')).toBe(true);
    expect(registry.bound).toEqual(['objectStorage']);
  });

  it.each<WayvroEnv>(['local', 'test'])('local/test (%s) may bind branded doubles', (env) => {
    expect(bindProviders(env, { otpDelivery: new BrandedOtpFake() }).bound).toEqual(['otpDelivery']);
  });

  it('recognises the brand only on objects that carry it', () => {
    expect(isMockProvider(new BrandedOtpFake())).toBe(true);
    expect(isMockProvider(new FakeRealStorage())).toBe(false);
    expect(isMockProvider(null)).toBe(false);
    expect(isMockProvider('x')).toBe(false);
  });
});
