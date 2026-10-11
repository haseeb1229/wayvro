import { databaseEnvSchema, httpEnvSchema, loadConfig, redisEnvSchema, serviceEnvSchema } from '@wayvro/config';
import { z } from 'zod';

const realtimeEnvSchema = serviceEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(httpEnvSchema.shape)
  .extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(4001),
    WAYVRO_BUILD_VERSION: z.string().min(1).default('dev'),
    /** How often an established connection re-checks its session (revocation reaches open sockets within this). */
    REALTIME_SESSION_REVALIDATE_MS: z.coerce.number().int().min(100).max(600_000).default(60_000),
  });

export type RealtimeConfig = Readonly<z.infer<typeof realtimeEnvSchema>>;

export function loadRealtimeConfig(env: Readonly<Record<string, string | undefined>>): RealtimeConfig {
  return loadConfig(realtimeEnvSchema, env);
}
