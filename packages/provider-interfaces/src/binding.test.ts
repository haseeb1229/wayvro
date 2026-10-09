import { describe, expect, it } from 'vitest';
import {
  InMemoryObjectStorage,
  ProviderBindingError,
  RecordingOtpDelivery,
  bindProviders,
  defaultProviderBindings,
  isMockProvider,
  type ObjectStoragePort,
} from './index.js';
import type { WayvroEnv } from '@wayvro/config';

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

describe('provider binding guard', () => {
  it.each<WayvroEnv>(['staging', 'production'])('production-like boot (%s) refuses every mock provider', (env) => {
    expect(() => bindProviders(env, { objectStorage: new InMemoryObjectStorage() })).toThrow(ProviderBindingError);
    expect(() => bindProviders(env, { otpDelivery: new RecordingOtpDelivery() })).toThrow(/refusing to bind mock provider "otpDelivery"/);
  });

  it.each<WayvroEnv>(['staging', 'production'])('default bindings in %s contain no mocks and fail loudly when used', (env) => {
    const defaults = defaultProviderBindings(env);
    expect(Object.values(defaults).some(isMockProvider)).toBe(false);
    const registry = bindProviders(env, defaults);
    expect(registry.bound).toEqual([]);
    expect(() => registry.get('otpDelivery')).toThrow(/not bound/);
  });

  it('accepts non-mock implementations in production', () => {
    const registry = bindProviders('production', { objectStorage: new FakeRealStorage() });
    expect(registry.get('objectStorage')).toBeInstanceOf(FakeRealStorage);
  });

  it.each<WayvroEnv>(['local', 'test'])('local/test (%s) bind recording mocks that never claim real delivery', async (env) => {
    const registry = bindProviders(env, defaultProviderBindings(env));
    expect(registry.bound).toEqual(['objectStorage', 'otpDelivery', 'pushNotification']);
    const otp = registry.get('otpDelivery') as RecordingOtpDelivery;
    const res = await otp.send({ to: '+923001234567', message: 'synthetic', channel: 'sms' });
    expect(res.providerMessageId).toMatch(/^mock-/);
    expect(otp.sent).toHaveLength(1);
    const storage = registry.get('objectStorage');
    await storage.putObject({ key: 'k', body: new Uint8Array([1]), contentType: 'application/octet-stream' });
    expect(await storage.getObject('k')).toEqual(new Uint8Array([1]));
    expect((await storage.createUploadUrl({ key: 'k', contentType: 'x', expiresInSeconds: 60 })).url).toMatch(/^mock-storage:/);
  });
});
