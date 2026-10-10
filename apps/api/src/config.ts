import { databaseEnvSchema, httpEnvSchema, loadConfig, redisEnvSchema, serviceEnvSchema } from '@wayvro/config';
import { z } from 'zod';

const apiEnvSchema = serviceEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(httpEnvSchema.shape)
  .extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** Set only when a trusted reverse proxy terminates TLS in front of the API. */
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    WAYVRO_BUILD_VERSION: z.string().min(1).default('dev'),
  });

export type ApiConfig = Readonly<z.infer<typeof apiEnvSchema>>;

export function loadApiConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  return loadConfig(apiEnvSchema, env);
}
