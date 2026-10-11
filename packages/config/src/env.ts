/**
 * Typed environment configuration with boot-time validation (I01/I04). Every service builds its schema from
 * `serviceEnvSchema` + its own keys and calls `loadConfig` before doing anything else; an invalid environment stops
 * the process. Error messages name the offending keys but never echo values (they may be secrets).
 */
import { z } from 'zod';

export const WAYVRO_ENVIRONMENTS = ['local', 'test', 'staging', 'production'] as const;
export type WayvroEnv = (typeof WAYVRO_ENVIRONMENTS)[number];

/** Environments where synthetic/mock providers and developer conveniences are permitted. */
export function isNonProductionLike(env: WayvroEnv): boolean {
  return env === 'local' || env === 'test';
}

export const serviceEnvSchema = z.object({
  WAYVRO_ENV: z.enum(WAYVRO_ENVIRONMENTS),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
});

export const databaseEnvSchema = z.object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) });
export const redisEnvSchema = z.object({ REDIS_URL: z.url({ protocol: /^rediss?$/ }) });
export const httpEnvSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535),
});
/**
 * Field/lookup/MAC key material (data model §8.2). Only the LOCAL provider exists: a synthetic seed for local/test.
 * Staging/production refuse it here and in @wayvro/field-crypto (no production key provider until EG-05).
 */
export const keyEnvSchema = z.object({
  WAYVRO_LOCAL_KEY_SEED: z.string().min(32).optional(),
  WAYVRO_LOCAL_KEY_SPEC: z.string().min(1).optional(),
});

/**
 * Evidence-vault infrastructure (ADR-041). Optional: a service without it answers evidence routes with
 * 503 WAYVRO_E_DEPENDENCY_UNAVAILABLE. `DATABASE_VAULT_URL` authenticates as a member of `wayvro_vault` only.
 * Production storage/KMS is external gate EG-05 (P2.A4); staging/production refuse local or plaintext endpoints.
 */
const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');
export const vaultEnvSchema = z.object({
  DATABASE_VAULT_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  /** Endpoint embedded in device upload URLs (e.g. the Android emulator's view of the local stack). */
  S3_PRESIGN_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  S3_QUARANTINE_BUCKET: z.string().min(3).optional(),
  S3_QUARANTINE_PREFIX: z
    .string()
    .regex(/^([a-z0-9-]+\/)*$/)
    .default('quarantine/'),
  S3_VAULT_BUCKET: z.string().min(3).optional(),
  S3_VAULT_PREFIX: z
    .string()
    .regex(/^([a-z0-9-]+\/)*$/)
    .default('vault/'),
});

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  constructor(readonly issues: readonly string[]) {
    super(`invalid configuration: ${issues.join('; ')}`);
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

/**
 * Environment-separation rules that a schema alone cannot express: staging/production must not point at developer
 * infrastructure and must use encrypted transport (Q04).
 */
function environmentRules(config: Record<string, unknown>): string[] {
  const env = config['WAYVRO_ENV'] as WayvroEnv;
  if (isNonProductionLike(env)) return [];
  const issues: string[] = [];
  for (const name of ['DATABASE_URL', 'DATABASE_VAULT_URL']) {
    const db = config[name];
    if (typeof db !== 'string') continue;
    const u = new URL(db);
    if (LOCAL_HOSTS.has(u.hostname)) issues.push(`${name}: ${env} must not use a local host`);
    const ssl = u.searchParams.get('sslmode');
    if (ssl !== 'require' && ssl !== 'verify-full') issues.push(`${name}: ${env} requires sslmode=require or verify-full`);
  }
  for (const name of ['S3_ENDPOINT', 'S3_PRESIGN_ENDPOINT']) {
    const endpoint = config[name];
    if (typeof endpoint !== 'string') continue;
    const u = new URL(endpoint);
    if (LOCAL_HOSTS.has(u.hostname) || u.protocol !== 'https:') issues.push(`${name}: ${env} requires a non-local https endpoint`);
  }
  const redis = config['REDIS_URL'];
  if (typeof redis === 'string') {
    const u = new URL(redis);
    if (LOCAL_HOSTS.has(u.hostname)) issues.push(`REDIS_URL: ${env} must not use a local host`);
    if (u.protocol !== 'rediss:') issues.push(`REDIS_URL: ${env} requires TLS (rediss://)`);
  }
  if (config['LOG_LEVEL'] === 'trace' || config['LOG_LEVEL'] === 'debug') issues.push(`LOG_LEVEL: ${env} must not run at debug/trace`);
  if (config['WAYVRO_LOCAL_KEY_SEED'] !== undefined || config['WAYVRO_LOCAL_KEY_SPEC'] !== undefined) {
    issues.push(`WAYVRO_LOCAL_KEY_SEED/WAYVRO_LOCAL_KEY_SPEC: ${env} must not use local key material`);
  }
  return issues;
}

/**
 * Validates `source` against `schema`, applies the shared environment rules plus the service's own `rules` (checks
 * that depend on WAYVRO_ENV) and returns a frozen, typed config. Every environment problem is reported together.
 */
export function loadConfig<S extends z.ZodObject>(
  schema: S,
  source: Readonly<Record<string, string | undefined>>,
  rules: (config: z.infer<S>) => string[] = () => [],
): Readonly<z.infer<S>> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  const issues = [...environmentRules(parsed.data), ...rules(parsed.data)];
  if (issues.length > 0) throw new ConfigError(issues);
  return Object.freeze(parsed.data);
}
