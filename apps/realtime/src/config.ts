import { httpEnvSchema, loadConfig, redisEnvSchema, serviceEnvSchema } from '@wayvro/config';
import { z } from 'zod';

const realtimeEnvSchema = serviceEnvSchema
  .extend(redisEnvSchema.shape)
  .extend(httpEnvSchema.shape)
  .extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(4001),
    WAYVRO_BUILD_VERSION: z.string().min(1).default('dev'),
  });

export type RealtimeConfig = Readonly<z.infer<typeof realtimeEnvSchema>>;

export function loadRealtimeConfig(env: Readonly<Record<string, string | undefined>>): RealtimeConfig {
  return loadConfig(realtimeEnvSchema, env);
}
