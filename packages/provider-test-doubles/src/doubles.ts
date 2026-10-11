/**
 * Local/test-only provider doubles (ADR-045). Every double carries the MOCK_PROVIDER brand, so the production binding
 * guard refuses it outside `local`/`test`; more importantly this package is never installed into a deployable artefact.
 * Doubles record what they were asked to do. They never pretend that an SMS, push or upload reached a real recipient,
 * make no network calls, and a recorded OTP message is never evidence for the real OTP vendor gate (EG-01).
 */
import { randomUUID } from 'node:crypto';
import {
  MOCK_PROVIDER,
  type MockBrand,
  type ObjectStoragePort,
  type OtpDeliveryPort,
  type PushNotificationPort,
  type StorageArea,
  type StoredObjectInfo,
} from '@wayvro/provider-interfaces';

export class InMemoryObjectStorage implements ObjectStoragePort, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string; lastModified: Date }>();

  private static id(area: StorageArea, key: string): string {
    return `${area}:${key}`;
  }

  putObject(input: { area: StorageArea; key: string; body: Uint8Array; contentType: string }): Promise<void> {
    this.objects.set(InMemoryObjectStorage.id(input.area, input.key), { body: input.body, contentType: input.contentType, lastModified: new Date() });
    return Promise.resolve();
  }

  getObject(input: { area: StorageArea; key: string }): Promise<Uint8Array | null> {
    return Promise.resolve(this.objects.get(InMemoryObjectStorage.id(input.area, input.key))?.body ?? null);
  }

  headObject(input: { area: StorageArea; key: string }): Promise<{ size: number; contentType: string | null } | null> {
    const o = this.objects.get(InMemoryObjectStorage.id(input.area, input.key));
    return Promise.resolve(o ? { size: o.body.byteLength, contentType: o.contentType } : null);
  }

  deleteObject(input: { area: StorageArea; key: string }): Promise<void> {
    this.objects.delete(InMemoryObjectStorage.id(input.area, input.key));
    return Promise.resolve();
  }

  listObjects(input: { area: StorageArea; prefix: string; limit: number }): Promise<readonly StoredObjectInfo[]> {
    const head = InMemoryObjectStorage.id(input.area, input.prefix);
    return Promise.resolve(
      [...this.objects.entries()]
        .filter(([id]) => id.startsWith(head))
        .slice(0, input.limit)
        .map(([id, o]) => ({ key: id.slice(input.area.length + 1), size: o.body.byteLength, lastModified: o.lastModified })),
    );
  }

  /** Never a reachable URL: a local double records intent only (uploads in local development use the real S3 adapter). */
  createUploadUrl(input: { key: string; contentType: string; contentLength: number; expiresInSeconds: number }): Promise<{
    url: string;
    method: 'PUT';
    headers: Readonly<Record<string, string>>;
    expiresAt: Date;
  }> {
    return Promise.resolve({
      url: `mock-storage://quarantine/${encodeURIComponent(input.key)}`,
      method: 'PUT',
      headers: { 'content-type': input.contentType, 'content-length': String(input.contentLength) },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    });
  }
}

export interface RecordedOtpMessage {
  readonly to: `+92${string}`;
  readonly channel: 'sms' | 'whatsapp';
  readonly message: string;
  readonly providerMessageId: string;
  readonly recordedAt: Date;
}

/** Local recording sink. `failNext` lets tests inject delivery failures (outage behaviour) without any network. */
export class RecordingOtpDelivery implements OtpDeliveryPort, MockBrand {
  readonly [MOCK_PROVIDER] = true as const;
  readonly sent: RecordedOtpMessage[] = [];
  private failures = 0;

  /** The next `count` sends reject, simulating a provider outage. */
  failNext(count: number): void {
    this.failures = count;
  }

  send(input: { to: `+92${string}`; message: string; channel: 'sms' | 'whatsapp' }): Promise<{ providerMessageId: string }> {
    if (this.failures > 0) {
      this.failures--;
      return Promise.reject(new Error('recording sink: injected delivery failure'));
    }
    const providerMessageId = `local-recording-${randomUUID()}`;
    this.sent.push({ ...input, providerMessageId, recordedAt: new Date() });
    return Promise.resolve({ providerMessageId });
  }

  /** Most recent messages for one destination, newest first. */
  messagesFor(to: string, limit = 5): readonly RecordedOtpMessage[] {
    return this.sent
      .filter((m) => m.to === to)
      .slice(-limit)
      .reverse();
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

/** Full set of doubles for a local runner or a test composition. */
export function createTestDoubleBindings(): {
  readonly objectStorage: InMemoryObjectStorage;
  readonly otpDelivery: RecordingOtpDelivery;
  readonly pushNotification: RecordingPushNotification;
} {
  return { objectStorage: new InMemoryObjectStorage(), otpDelivery: new RecordingOtpDelivery(), pushNotification: new RecordingPushNotification() };
}
