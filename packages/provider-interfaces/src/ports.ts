/**
 * Vendor-neutral provider ports (CLAUDE.md §4: provider SDKs stay behind adapters). UI/domain code depends on these
 * interfaces only. Real adapters live in future `packages/provider-adapters/*` packages, one per vendor, added only
 * after the vendor ADR/contract (ADR-006/007/010/017). No real vendor integration exists in Phase 1.
 */

export interface ObjectStoragePort {
  putObject(input: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
  getObject(key: string): Promise<Uint8Array | null>;
  /** Short-lived upload URL; the adapter decides signing and must bound `expiresInSeconds`. */
  createUploadUrl(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<{ url: string; expiresAt: Date }>;
}

/** Delivers an already-generated one-time code. Code generation/verification is server domain logic, never the vendor's. */
export interface OtpDeliveryPort {
  send(input: { to: `+92${string}`; message: string; channel: 'sms' | 'whatsapp' }): Promise<{ providerMessageId: string }>;
}

export interface PushNotificationPort {
  send(input: { deviceToken: string; title: string; body: string; data: Readonly<Record<string, string>> }): Promise<{ accepted: boolean }>;
}

export interface ProviderPorts {
  readonly objectStorage: ObjectStoragePort;
  readonly otpDelivery: OtpDeliveryPort;
  readonly pushNotification: PushNotificationPort;
}

export type ProviderKind = keyof ProviderPorts;
export const PROVIDER_KINDS: readonly ProviderKind[] = ['objectStorage', 'otpDelivery', 'pushNotification'];
