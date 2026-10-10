import { databaseEnvSchema, keyEnvSchema, loadConfig, redisEnvSchema, serviceEnvSchema } from '@wayvro/config';
import { z } from 'zod';

const int = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback);

const workerEnvSchema = serviceEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(keyEnvSchema.shape)
  .extend({
    HEALTH_HOST: z.string().min(1).default('127.0.0.1'),
    HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4002),
    WAYVRO_BUILD_VERSION: z.string().min(1).default('dev'),
    JOB_POLL_INTERVAL_MS: int(500, 50, 60_000),
    JOB_LEASE_MS: int(60_000, 1000, 3_600_000),
    /** Only audit rows older than this are sealed (in-flight transactions are bounded by statement timeouts). */
    AUDIT_SEAL_LAG_SECONDS: int(60, 0, 3600),
    AUDIT_SEAL_BATCH_SIZE: int(1000, 1, 100_000),
    /** Retention placeholders — NOT_COUNSEL_APPROVED until the retention matrix exists (EG-16). */
    OTP_CHALLENGE_RETENTION_DAYS: int(7, 1, 365),
    SUCCEEDED_JOB_RETENTION_DAYS: int(7, 1, 365),
    KEY_ROTATION_BATCH_SIZE: int(500, 1, 10_000),
  });

export type WorkerConfig = Readonly<z.infer<typeof workerEnvSchema>>;

export function loadWorkerConfig(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  return loadConfig(workerEnvSchema, env);
}
