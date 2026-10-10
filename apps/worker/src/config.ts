import { databaseEnvSchema, loadConfig, redisEnvSchema, serviceEnvSchema } from '@wayvro/config';
import { z } from 'zod';

const workerEnvSchema = serviceEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend({
    HEALTH_HOST: z.string().min(1).default('127.0.0.1'),
    HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4002),
    WAYVRO_BUILD_VERSION: z.string().min(1).default('dev'),
  });

export type WorkerConfig = Readonly<z.infer<typeof workerEnvSchema>>;

export function loadWorkerConfig(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  return loadConfig(workerEnvSchema, env);
}
