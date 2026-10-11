/**
 * S3-compatible object storage adapter (ADR-010, ADR-041 §2.3) on the official AWS SDK v3. Checksums are computed and
 * validated only WHEN_REQUIRED (ADR-010 finding: SeaweedFS and other S3-compatible stores reject the SDK's default
 * flexible-checksum headers on presigned uploads). Each storage area maps to a bucket + key prefix by configuration.
 *
 * Upload URLs exist for the QUARANTINE area only, for one key, at most `maxUploadUrlSeconds`, with Content-Type and
 * Content-Length in the signature. No download URL is ever created. The presign client may use a different (public)
 * endpoint than the server client because the host is part of the signature.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStoragePort, StorageArea, StoredObjectInfo } from '@wayvro/provider-interfaces';

export interface S3StorageConfig {
  /** Server-side endpoint (omit for AWS itself). */
  readonly endpoint?: string | undefined;
  /** Endpoint embedded in upload URLs handed to devices (defaults to `endpoint`). */
  readonly presignEndpoint?: string | undefined;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
  readonly areas: Readonly<Record<StorageArea, { readonly bucket: string; readonly prefix: string }>>;
  readonly maxUploadUrlSeconds: number;
  readonly requestTimeoutMs: number;
}

const KEY = /^[a-z0-9][a-z0-9/_-]{0,200}$/;

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly client: S3Client;
  private readonly presigner: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    const base = (endpoint: string | undefined): S3ClientConfig => ({
      region: config.region,
      ...(endpoint === undefined ? {} : { endpoint }),
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 3,
      requestHandler: { requestTimeout: config.requestTimeoutMs, connectionTimeout: Math.min(config.requestTimeoutMs, 5000) },
    });
    this.client = new S3Client(base(config.endpoint));
    this.presigner = new S3Client(base(config.presignEndpoint ?? config.endpoint));
  }

  private locate(area: StorageArea, key: string): { Bucket: string; Key: string } {
    if (!KEY.test(key) || key.includes('..')) throw new Error('invalid object key');
    const a = this.config.areas[area];
    return { Bucket: a.bucket, Key: `${a.prefix}${key}` };
  }

  async putObject(input: { area: StorageArea; key: string; body: Uint8Array; contentType: string }): Promise<void> {
    await this.client.send(new PutObjectCommand({ ...this.locate(input.area, input.key), Body: input.body, ContentType: input.contentType }));
  }

  async getObject(input: { area: StorageArea; key: string }): Promise<Uint8Array | null> {
    try {
      const r = await this.client.send(new GetObjectCommand(this.locate(input.area, input.key)));
      return r.Body ? await r.Body.transformToByteArray() : null;
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }

  async headObject(input: { area: StorageArea; key: string }): Promise<{ size: number; contentType: string | null } | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand(this.locate(input.area, input.key)));
      return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }

  async deleteObject(input: { area: StorageArea; key: string }): Promise<void> {
    await this.client.send(new DeleteObjectCommand(this.locate(input.area, input.key)));
  }

  async listObjects(input: { area: StorageArea; prefix: string; limit: number }): Promise<readonly StoredObjectInfo[]> {
    const a = this.config.areas[input.area];
    const r = await this.client.send(new ListObjectsV2Command({ Bucket: a.bucket, Prefix: `${a.prefix}${input.prefix}`, MaxKeys: input.limit }));
    return (r.Contents ?? []).flatMap((o) =>
      o.Key === undefined ? [] : [{ key: o.Key.slice(a.prefix.length), size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) }],
    );
  }

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; method: 'PUT'; headers: Readonly<Record<string, string>>; expiresAt: Date }> {
    const expiresIn = Math.max(1, Math.min(input.expiresInSeconds, this.config.maxUploadUrlSeconds));
    const command = new PutObjectCommand({ ...this.locate('quarantine', input.key), ContentType: input.contentType, ContentLength: input.contentLength });
    const url = await getSignedUrl(this.presigner, command, {
      expiresIn,
      // Both headers are part of the SigV4 signature, so a different type or length fails at the storage service.
      signableHeaders: new Set(['content-type', 'content-length']),
      unhoistableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': input.contentType, 'content-length': String(input.contentLength) },
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }
}

function notFound(e: unknown): boolean {
  return e instanceof S3ServiceException && (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata.httpStatusCode === 404);
}

/** The object-storage part of a service configuration (`vaultEnvSchema` in @wayvro/config). */
export interface ObjectStorageSettings {
  readonly S3_ENDPOINT?: string | undefined;
  readonly S3_PRESIGN_ENDPOINT?: string | undefined;
  readonly S3_REGION: string;
  readonly S3_ACCESS_KEY_ID?: string | undefined;
  readonly S3_SECRET_ACCESS_KEY?: string | undefined;
  readonly S3_FORCE_PATH_STYLE: boolean;
  readonly S3_QUARANTINE_BUCKET?: string | undefined;
  readonly S3_QUARANTINE_PREFIX: string;
  readonly S3_VAULT_BUCKET?: string | undefined;
  readonly S3_VAULT_PREFIX: string;
}

/** A storage adapter when credentials and both buckets are configured; otherwise undefined (the port stays unbound). */
export function objectStorageFromSettings(s: ObjectStorageSettings, maxUploadUrlSeconds = 300): S3ObjectStorage | undefined {
  if (!s.S3_ACCESS_KEY_ID || !s.S3_SECRET_ACCESS_KEY || !s.S3_QUARANTINE_BUCKET || !s.S3_VAULT_BUCKET) return undefined;
  return new S3ObjectStorage({
    endpoint: s.S3_ENDPOINT,
    presignEndpoint: s.S3_PRESIGN_ENDPOINT,
    region: s.S3_REGION,
    accessKeyId: s.S3_ACCESS_KEY_ID,
    secretAccessKey: s.S3_SECRET_ACCESS_KEY,
    forcePathStyle: s.S3_FORCE_PATH_STYLE,
    areas: { quarantine: { bucket: s.S3_QUARANTINE_BUCKET, prefix: s.S3_QUARANTINE_PREFIX }, vault: { bucket: s.S3_VAULT_BUCKET, prefix: s.S3_VAULT_PREFIX } },
    maxUploadUrlSeconds,
    requestTimeoutMs: 15000,
  });
}
