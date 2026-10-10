import { bindProviders, isMockProvider } from '@wayvro/provider-interfaces';
import { describe, expect, it } from 'vitest';
import { createTestDoubleBindings, InMemoryObjectStorage, RecordingOtpDelivery } from './index.js';

describe('provider test doubles (dev/test only)', () => {
  it('every double carries the brand that production composition refuses', () => {
    const doubles = createTestDoubleBindings();
    expect(Object.values(doubles).every(isMockProvider)).toBe(true);
    expect(() => bindProviders('production', doubles)).toThrow(/refusing to bind mock provider/);
    expect(() => bindProviders('staging', { objectStorage: new InMemoryObjectStorage() })).toThrow(/objectStorage/);
  });

  it('local/test compositions can bind them; the recording sink records without claiming real delivery', async () => {
    const doubles = createTestDoubleBindings();
    const registry = bindProviders('test', doubles);
    expect(registry.bound).toEqual(['objectStorage', 'otpDelivery', 'pushNotification']);
    const res = await registry.get('otpDelivery').send({ to: '+923000000001', message: 'synthetic', channel: 'sms' });
    expect(res.providerMessageId).toMatch(/^local-recording-/);
    expect(doubles.otpDelivery.messagesFor('+923000000001')).toHaveLength(1);
    expect(doubles.otpDelivery.messagesFor('+923000000002')).toHaveLength(0);
    const storage = registry.get('objectStorage');
    await storage.putObject({ key: 'k', body: new Uint8Array([1]), contentType: 'application/octet-stream' });
    expect(await storage.getObject('k')).toEqual(new Uint8Array([1]));
    expect(await storage.getObject('missing')).toBeNull();
    expect((await storage.createUploadUrl({ key: 'k', contentType: 'x', expiresInSeconds: 60 })).url).toMatch(/^mock-storage:/);
    expect(await registry.get('pushNotification').send({ deviceToken: 'd', title: 't', body: 'b', data: {} })).toEqual({ accepted: true });
    expect(doubles.pushNotification.sent).toEqual([{ deviceToken: 'd', title: 't' }]);
  });

  it('can inject delivery failures to exercise outage paths', async () => {
    const otp = new RecordingOtpDelivery();
    otp.failNext(1);
    await expect(otp.send({ to: '+923000000001', message: 'm', channel: 'sms' })).rejects.toThrow(/injected/);
    await expect(otp.send({ to: '+923000000001', message: 'm', channel: 'sms' })).resolves.toMatchObject({ providerMessageId: expect.any(String) });
    expect(otp.messagesFor('+923000000001', 1)).toHaveLength(1);
  });
});
