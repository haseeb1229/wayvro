/**
 * API integration harness: a migrated throwaway database, the API composed exactly like the local runner but connected
 * as a LOGIN member of the restricted `wayvro_api` role, OTP delivery run in-process as `wayvro_worker` against the
 * recording sink, and a unique rate-limit namespace per harness so Valkey state never leaks between runs.
 *
 * Synthetic data only: phone numbers use the +92 399 operator code with random digits; they are never sent anywhere —
 * no OTP provider exists (EG-01) and the recording sink makes no network call.
 */
import { randomBytes } from 'node:crypto';
import { runMigrations } from '@wayvro/db';
import { otpDeliveryJob } from '@wayvro/identity-core';
import { createLogger } from '@wayvro/observability';
import { bindProviders, type OidcKeysPort } from '@wayvro/provider-interfaces';
import { RecordingOtpDelivery } from '@wayvro/provider-test-doubles';
import { JobRunner, createRequestPathRedis } from '@wayvro/server-runtime';
import { captureLogs, createRestrictedLogin, createTestDatabase, type LogCapture } from '@wayvro/test-support';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { S3ObjectStorage } from '@wayvro/vault-adapters';
import { composeApi, type ApiRuntime } from '../src/composition.js';
import { loadApiConfig } from '../src/config.js';

const ADMIN_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];
if (!ADMIN_URL || !REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;
const redisUrl: string = REDIS_URL;

const SEED = 'synthetic-api-integration-seed-0000000000';

export interface Harness {
  readonly runtime: ApiRuntime;
  readonly sink: RecordingOtpDelivery;
  readonly owner: pg.Pool;
  readonly logs: LogCapture;
  /** Present with `vault: true`: the storage adapter and a pool authenticated as a member of wayvro_vault. */
  readonly storage: S3ObjectStorage | null;
  readonly vault: pg.Pool | null;
  inject(opts: InjectOptions): Promise<LightMyRequestResponse>;
  /** Runs pending otp.deliver jobs (as the worker role). */
  deliver(): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  readonly env?: Readonly<Record<string, string>>;
  /** false = no OTP delivery adapter bound (production-like). */
  readonly otpDelivery?: boolean;
  /** true = evidence vault on: a wayvro_vault login + the REAL S3 adapter on the local SeaweedFS (per-run prefixes). */
  readonly vault?: boolean;
  /** P2.10: the local OIDC issuer bound as the provider key source (its client IDs go into OIDC_*_AUDIENCES). */
  readonly oidc?: OidcKeysPort;
}

export async function startApi(options: HarnessOptions = {}): Promise<Harness> {
  const database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  const apiLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_api');
  const workerLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_worker');
  const vaultLogin = options.vault ? await createRestrictedLogin(adminUrl, database.url, 'wayvro_vault') : null;
  const run = randomBytes(5).toString('hex');
  const storage = options.vault
    ? new S3ObjectStorage({
        endpoint: process.env['WAYVRO_S3_ENDPOINT'] ?? 'http://127.0.0.1:28333',
        region: 'us-east-1',
        accessKeyId: 'wayvro-local-access',
        secretAccessKey: 'wayvro-local-secret-not-for-production',
        forcePathStyle: true,
        areas: {
          quarantine: { bucket: 'wayvro-local', prefix: `api-it-${run}/quarantine/` },
          vault: { bucket: 'wayvro-local', prefix: `api-it-${run}/vault/` },
        },
        maxUploadUrlSeconds: 300,
        requestTimeoutMs: 10000,
      })
    : null;
  const prefix = `wv:it:${randomBytes(6).toString('hex')}:`;
  const config = loadApiConfig({
    WAYVRO_ENV: 'test',
    DATABASE_URL: apiLogin.url,
    REDIS_URL: redisUrl,
    WAYVRO_LOCAL_KEY_SEED: SEED,
    RATE_LIMIT_KEY_PREFIX: prefix,
    OTP_DAILY_SEND_BUDGET: '1000000',
    OTP_MONTHLY_SEND_BUDGET: '1000000',
    ...(vaultLogin ? { DATABASE_VAULT_URL: vaultLogin.url } : {}),
    ...options.env,
  });
  const logs = captureLogs();
  const log = createLogger({ service: 'api', env: 'test', level: 'info', destination: logs.stream });
  const sink = new RecordingOtpDelivery();
  const providers = bindProviders('test', {
    ...(options.otpDelivery === false ? {} : { otpDelivery: sink }),
    ...(storage ? { objectStorage: storage } : {}),
    ...(options.oidc ? { oidcKeys: options.oidc } : {}),
  });
  const runtime = await composeApi(config, log, { providers });
  await runtime.app.getHttpAdapter().getInstance().ready();
  const owner = new pg.Pool({ connectionString: database.url, max: 3 });
  const worker = new pg.Pool({ connectionString: workerLogin.url, max: 3 });
  const vault = vaultLogin ? new pg.Pool({ connectionString: vaultLogin.url, max: 3 }) : null;
  const runner = new JobRunner(worker, [otpDeliveryJob({ db: worker, cipher: runtime.cipher, port: sink })], {
    workerId: 'it-delivery',
    leaseMs: 30000,
    batchSize: 50,
    log,
  });
  return {
    runtime,
    sink,
    owner,
    logs,
    storage,
    vault,
    inject: (opts) => runtime.app.getHttpAdapter().getInstance().inject(opts),
    async deliver() {
      await runner.runOnce();
    },
    async close() {
      await runtime.close();
      await Promise.all([owner.end(), worker.end(), vault?.end()]);
      await apiLogin.drop();
      await workerLogin.drop();
      await vaultLogin?.drop();
      await database.drop();
      const redis = createRequestPathRedis(redisUrl, 2000);
      await new Promise((r) => setTimeout(r, 50));
      const keys = await redis.keys(`${prefix}*`).catch(() => [] as string[]);
      if (keys.length > 0) await redis.del(...keys);
      redis.disconnect();
    },
  };
}

let counter = 0;
/** +92 399 XXXXXXX — synthetic, never delivered. */
export function syntheticPhone(): string {
  counter = (counter + 1) % 100;
  return `+92399${String(randomBytes(3).readUIntBE(0, 3) % 100000).padStart(5, '0')}${String(counter).padStart(2, '0')}`;
}

export const installation = (): string => `inst-${randomBytes(12).toString('hex')}`;
export const key = (): string => `idem-${randomBytes(12).toString('hex')}`;
export const device = { platform: 'ANDROID', appVersion: '1.0.0' } as const;

export function post(url: string, payload: unknown, headers: Record<string, string> = {}): InjectOptions {
  return { method: 'POST', url, payload: payload as NonNullable<InjectOptions['payload']>, headers: { 'idempotency-key': key(), ...headers } };
}

/** The 6-digit code of the newest recorded message for `phone`. */
export function codeFor(h: Harness, phone: string): string {
  const m = /\b(\d{6})\b/.exec(h.sink.messagesFor(phone, 1)[0]?.message ?? '');
  if (!m?.[1]) throw new Error('no recorded code');
  return m[1];
}

export interface SignedIn {
  readonly phone: string;
  readonly installationId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly isNewAccount: boolean;
}

export async function requestCode(h: Harness, phone: string, installationId: string): Promise<string> {
  const res = await h.inject(post('/v1/auth/otp-challenges', { phone, purpose: 'SIGN_IN', installationId, locale: 'en' }));
  if (res.statusCode !== 202) throw new Error(`otp request failed: ${String(res.statusCode)} ${res.body}`);
  await h.deliver();
  return res.json<{ challengeId: string }>().challengeId;
}

export async function signIn(h: Harness, phone: string = syntheticPhone(), installationId: string = installation()): Promise<SignedIn> {
  const challengeId = await requestCode(h, phone, installationId);
  const res = await h.inject(post('/v1/auth/sessions', { challengeId, code: codeFor(h, phone), installationId, device }));
  if (res.statusCode !== 201) throw new Error(`sign-in failed: ${String(res.statusCode)} ${res.body}`);
  const body = res.json<{ accessToken: string; refreshToken: string; sessionId: string; isNewAccount: boolean }>();
  return { phone, installationId, ...body };
}

export const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
