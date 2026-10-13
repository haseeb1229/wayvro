import {
  databaseEnvSchema,
  isNonProductionLike,
  keyEnvSchema,
  loadConfig,
  redisEnvSchema,
  releaseEnvSchema,
  serviceEnvSchema,
  vaultEnvSchema,
} from '@wayvro/config';
import { z } from 'zod';

const int = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback);

const workerEnvSchema = serviceEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(keyEnvSchema.shape)
  .extend(vaultEnvSchema.shape)
  // Phase 3 release controls (ADR-049): the scheduled app-policy activation re-checks the guardrails against the same
  // latest-released-build configuration as the API
  .extend(releaseEnvSchema.shape)
  .extend({
    // Evidence pipeline (ADR-041). The scanner and the sanitiser are bound only when configured; without them evidence
    // stays UPLOADED and is retried — never treated as clean.
    CLAMD_HOST: z.string().min(1).optional(),
    CLAMD_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    CLAMD_TIMEOUT_MS: int(30_000, 1000, 300_000),
    /** 'docker' = one hardened container per image via the Docker CLI: LOCAL DEVELOPMENT AND CI ONLY (refused below). */
    SANITISER_RUNNER: z.enum(['none', 'docker']).default('none'),
    SANITISER_IMAGE: z.string().min(1).default('wayvro-sanitiser:local'),
    SANITISER_TIMEOUT_MS: int(60_000, 1000, 300_000),
    /** Orphan reconciliation reports instead of deleting until an operator turns this off (KYC doc §4). */
    EVIDENCE_ORPHAN_DRY_RUN: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    HEALTH_HOST: z.string().min(1).default('127.0.0.1'),
    HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4002),
    WAYVRO_BUILD_VERSION: z.string().min(1).default('dev'),
    JOB_POLL_INTERVAL_MS: int(500, 50, 60_000),
    JOB_LEASE_MS: int(60_000, 1000, 3_600_000),
    /** Idle poll of the transactional-outbox relay (a non-empty batch re-polls immediately). */
    OUTBOX_POLL_INTERVAL_MS: int(1000, 50, 60_000),
    /** Only audit rows older than this are sealed (in-flight transactions are bounded by statement timeouts). */
    AUDIT_SEAL_LAG_SECONDS: int(60, 0, 3600),
    AUDIT_SEAL_BATCH_SIZE: int(1000, 1, 100_000),
    /** Retention placeholders — NOT_COUNSEL_APPROVED until the retention matrix exists (EG-16). */
    OTP_CHALLENGE_RETENTION_DAYS: int(7, 1, 365),
    SUCCEEDED_JOB_RETENTION_DAYS: int(7, 1, 365),
    /** Inactive DRAFT/CONSENTED/DOCUMENTS_PENDING applications become EXPIRED_DRAFT (data model §4.5; proposal 30). */
    APPLICATION_DRAFT_EXPIRY_DAYS: int(30, 1, 365),
    KEY_ROTATION_BATCH_SIZE: int(500, 1, 10_000),
  });

export type WorkerConfig = Readonly<z.infer<typeof workerEnvSchema>>;

/** WAYVRO_ENV-dependent rules: a production worker never holds a Docker socket (ADR-041 §2.2; hosting is P2.A4). */
function workerEnvironmentRules(c: z.infer<typeof workerEnvSchema>): string[] {
  if (isNonProductionLike(c.WAYVRO_ENV)) return [];
  return c.SANITISER_RUNNER === 'docker'
    ? [`SANITISER_RUNNER: ${c.WAYVRO_ENV} refuses the Docker CLI runner (isolated sanitiser hosting is activation track P2.A4)`]
    : [];
}

export function loadWorkerConfig(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  return loadConfig(workerEnvSchema, env, workerEnvironmentRules);
}
