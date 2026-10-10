import { databaseEnvSchema, httpEnvSchema, keyEnvSchema, loadConfig, redisEnvSchema, serviceEnvSchema } from '@wayvro/config';
import { z } from 'zod';

const int = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback);

/**
 * Identity policy knobs. Every value is a CONFIGURABLE DEFAULT (founder decisions Q-06/Q-07), not a protocol constant:
 * OTP 5 min / 5 attempts / 60-120-300 s resend cooldowns / 3 resends (docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md §3),
 * abuse limits per §3.4 (tuned with data), sessions 15 min / 60 days idle / 180 days absolute (§4), and a 90-day
 * dormancy threshold that is a PROVISIONAL local/test design value — not a PTA/MNO fact (EG-22).
 */
const identityPolicySchema = z.object({
  OTP_TTL_SECONDS: int(300, 60, 900),
  OTP_MAX_ATTEMPTS: int(5, 1, 10),
  OTP_RESEND_COOLDOWNS_SECONDS: z
    .string()
    .regex(/^\d{1,4}(,\d{1,4}){0,9}$/)
    .default('60,120,300')
    .transform((s) => s.split(',').map(Number)),
  OTP_MAX_RESENDS: int(3, 0, 10),
  OTP_PHONE_SENDS_PER_HOUR: int(5, 1, 1000),
  OTP_PHONE_SENDS_PER_DAY: int(10, 1, 1000),
  OTP_PHONE_FAILED_CHALLENGES_PER_DAY: int(5, 1, 1000),
  OTP_INSTALLATION_SENDS_PER_DAY: int(10, 1, 1000),
  OTP_IP_PREFIX_SENDS_PER_HOUR_SOFT: int(30, 1, 100000),
  OTP_IP_PREFIX_SENDS_PER_HOUR_HARD: int(200, 1, 100000),
  OTP_DAILY_SEND_BUDGET: int(5000, 1, 10_000_000),
  OTP_MONTHLY_SEND_BUDGET: int(100_000, 1, 100_000_000),
  OTP_PREFIX_MONITOR_MIN_SENDS: int(200, 1, 1_000_000),
  OTP_PREFIX_MIN_CONVERSION_PERCENT: int(30, 0, 100),
  OTP_PREFIX_ELEVATED_SENDS_PER_MINUTE: int(20, 1, 100000),
  OTP_VERIFY_ATTEMPTS_PER_INSTALLATION_HOUR: int(30, 1, 10000),
  SESSION_ACCESS_TTL_SECONDS: int(900, 60, 3600),
  SESSION_IDLE_TTL_SECONDS: int(5_184_000, 3600, 31_536_000),
  SESSION_ABSOLUTE_TTL_SECONDS: int(15_552_000, 3600, 31_536_000),
  SESSION_REFRESH_REPLAY_LEEWAY_SECONDS: int(30, 1, 120),
  SESSION_REFRESHES_PER_HOUR: int(120, 1, 100000),
  ACCOUNT_DORMANCY_RISK_DAYS: int(90, 1, 3650),
  IDEMPOTENCY_TTL_SECONDS: int(86_400, 60, 604_800),
  IDEMPOTENCY_SESSION_RESPONSE_TTL_SECONDS: int(600, 60, 86_400),
});

const apiEnvSchema = serviceEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(httpEnvSchema.shape)
  .extend(keyEnvSchema.shape)
  .extend(identityPolicySchema.shape)
  .extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** Set only when a trusted reverse proxy terminates TLS in front of the API. */
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    WAYVRO_BUILD_VERSION: z.string().min(1).default('dev'),
    /** Namespace for rate-limit keys when several environments or test runs share one Valkey. */
    RATE_LIMIT_KEY_PREFIX: z
      .string()
      .regex(/^[a-z0-9:_-]{1,40}$/)
      .default('wv:rl:'),
  })
  .refine((c) => c.SESSION_ACCESS_TTL_SECONDS <= c.SESSION_IDLE_TTL_SECONDS && c.SESSION_IDLE_TTL_SECONDS <= c.SESSION_ABSOLUTE_TTL_SECONDS, {
    message: 'session lifetimes must satisfy access <= idle <= absolute',
    path: ['SESSION_IDLE_TTL_SECONDS'],
  })
  .refine((c) => c.OTP_RESEND_COOLDOWNS_SECONDS.length > 0, { path: ['OTP_RESEND_COOLDOWNS_SECONDS'] });

export type ApiConfig = Readonly<z.infer<typeof apiEnvSchema>>;

export function loadApiConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  return loadConfig(apiEnvSchema, env);
}
