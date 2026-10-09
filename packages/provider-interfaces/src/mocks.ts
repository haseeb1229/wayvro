/**
 * Local/test-only mock providers. Every mock carries the MOCK_PROVIDER brand; `bindProviders` refuses branded
 * implementations unless WAYVRO_ENV is `local` or `test`, so no mock success path is reachable in staging/production.
 * Mocks record what they were asked to do — they never pretend that an SMS, push or upload reached a real recipient.
 */
import { randomUUID } from 'node:crypto';
import type { ObjectStoragePort, OtpDeliveryPort, PushNotificationPort } from './ports.js';

export const MOCK_PROVIDER: unique symbol = Symbol.for('wayvro.provider.mock');
export interface MockBrand {
  readonly [MOCK_PROVIDER]: true;
}

export function isMockProvider(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Partial<MockBrand>)[MOCK_PROVIDER] === true;
}

export class InMemoryObjectStorage implements ObjectStoragePort, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;
  private readonly objects = new Map<string, Uint8Array>();

  putObject(input: { key: string; body: Uint8Array; contentType: string }): Promise<void> {
    this.objects.set(input.key, input.body);
    return Promise.resolve();
  }

  getObject(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  createUploadUrl(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<{ url: string; expiresAt: Date }> {
    return Promise.resolve({ url: `mock-storage://upload/${encodeURIComponent(input.key)}`, expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000) });
  }
}

export class RecordingOtpDelivery implements OtpDeliveryPort, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;
  readonly sent: Array<{ to: string; channel: 'sms' | 'whatsapp'; message: string }> = [];

  send(input: { to: `+92${string}`; message: string; channel: 'sms' | 'whatsapp' }): Promise<{ providerMessageId: string }> {
    this.sent.push(input);
    return Promise.resolve({ providerMessageId: `mock-${randomUUID()}` });
  }
}

export class RecordingPushNotification implements PushNotificationPort, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;
  readonly sent: Array<{ deviceToken: string; title: string }> = [];

  send(input: { deviceToken: string; title: string; body: string; data: Readonly<Record<string, string>> }): Promise<{ accepted: boolean }> {
    this.sent.push({ deviceToken: input.deviceToken, title: input.title });
    return Promise.resolve({ accepted: true });
  }
}
