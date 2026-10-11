/**
 * Vendor-neutral provider ports (CLAUDE.md §4: provider SDKs stay behind adapters). UI/domain code depends on these
 * interfaces only. Real adapters live in server-only packages (e.g. `@wayvro/vault-adapters`, ADR-041), one per
 * concern, added only after the vendor ADR/contract (ADR-006/007/010/017/041).
 */

/**
 * Storage areas (ADR-041 §2.3). `quarantine` holds untrusted uploads until scanning and sanitisation; it is the ONLY
 * area for which an upload URL can be created. `vault` holds encrypted, sanitised evidence and is server-side only —
 * no port method returns a download URL for any area.
 */
export type StorageArea = 'quarantine' | 'vault';

export interface StoredObjectInfo {
  readonly key: string;
  readonly size: number;
  readonly lastModified: Date;
}

export interface ObjectStoragePort {
  putObject(input: { area: StorageArea; key: string; body: Uint8Array; contentType: string }): Promise<void>;
  /** The object's bytes, or null when it does not exist. */
  getObject(input: { area: StorageArea; key: string }): Promise<Uint8Array | null>;
  /** Size and content type as stored, or null when the object does not exist. */
  headObject(input: { area: StorageArea; key: string }): Promise<{ size: number; contentType: string | null } | null>;
  /** Idempotent: deleting a missing object succeeds. */
  deleteObject(input: { area: StorageArea; key: string }): Promise<void>;
  /** Objects under `prefix` (bounded by `limit`), for orphan reconciliation. */
  listObjects(input: { area: StorageArea; prefix: string; limit: number }): Promise<readonly StoredObjectInfo[]>;
  /**
   * Short-lived single-object upload URL into QUARANTINE. Content type and length are part of the signature; the
   * adapter bounds `expiresInSeconds`. The client must send exactly the returned headers.
   */
  createUploadUrl(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; method: 'PUT'; headers: Readonly<Record<string, string>>; expiresAt: Date }>;
}

/** Malware scan verdict. A scanner that cannot answer THROWS (the object is then retried, never treated as clean). */
export type ScanVerdict = { readonly verdict: 'CLEAN' } | { readonly verdict: 'FOUND'; readonly signature: string };

export interface MalwareScannerPort {
  scan(bytes: Uint8Array): Promise<ScanVerdict>;
}

/** Why the sanitiser refused an input. Every value is terminal for that object (never "clean"). */
export type SanitiserRejection = 'UNSUPPORTED_FORMAT' | 'LIMITS' | 'UNREADABLE';

export type SanitiserResult =
  | {
      readonly outcome: 'CLEAN';
      readonly format: 'JPEG' | 'PNG';
      readonly width: number;
      readonly height: number;
      /** Canonical re-encoded bytes: metadata absent by construction (ADR-041 §2.1). */
      readonly bytes: Uint8Array;
    }
  | { readonly outcome: 'REJECTED'; readonly reason: SanitiserRejection };

/**
 * Isolated decode/re-encode sanitiser (ADR-041). Implementations run the decoder outside the calling process with no
 * network, no secrets and resource limits. An infrastructure failure (runner unavailable) THROWS so the job retries.
 */
export interface ImageSanitiserPort {
  sanitise(bytes: Uint8Array): Promise<SanitiserResult>;
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
  readonly malwareScanner: MalwareScannerPort;
  readonly imageSanitiser: ImageSanitiserPort;
  readonly otpDelivery: OtpDeliveryPort;
  readonly pushNotification: PushNotificationPort;
}

export type ProviderKind = keyof ProviderPorts;
export const PROVIDER_KINDS: readonly ProviderKind[] = ['objectStorage', 'malwareScanner', 'imageSanitiser', 'otpDelivery', 'pushNotification'];
