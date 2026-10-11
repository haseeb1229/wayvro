import { isIP } from 'node:net';
import {
  databaseEnvSchema,
  httpEnvSchema,
  isNonProductionLike,
  keyEnvSchema,
  loadConfig,
  redisEnvSchema,
  serviceEnvSchema,
  vaultEnvSchema,
} from '@wayvro/config';
import { z } from 'zod';

/** An IPv4/IPv6 address or CIDR block (e.g. 10.0.0.0/8, fd00::/8). */
function isAddressOrCidr(entry: string): boolean {
  const [address, prefix, extra] = entry.split('/');
  if (extra !== undefined || !address) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Reverse-proxy trust for client-IP derivation (OTP IP-prefix limits depend on it). `false` (default) uses the socket
 * peer; a comma-separated allowlist trusts X-Forwarded-For only from those proxy addresses/CIDRs; `true` (trust every
 * hop) is accepted in local/test only — staging/production refuse it, because a spoofable client IP must never become
 * the basis of OTP throttling (PHASE2_P2_1 deployment hardening).
 */
const trustProxySchema = z
  .string()
  .default('false')
  .transform((v, ctx): boolean | readonly string[] => {
    if (v === 'false') return false;
    if (v === 'true') return true;
    const entries = v.split(',').map((e) => e.trim());
    if (entries.length === 0 || entries.length > 32 || !entries.every(isAddressOrCidr)) {
      ctx.addIssue({ code: 'custom', message: 'must be false, true or a comma-separated list of proxy IP addresses/CIDR blocks' });
      return z.NEVER;
    }
    return Object.freeze(entries);
  });

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
  // U06 grace period before a deletion request is processed (14 days proposed; pending counsel, EG-16)
  ACCOUNT_DELETION_GRACE_DAYS: int(14, 1, 90),
  IDEMPOTENCY_TTL_SECONDS: int(86_400, 60, 604_800),
  IDEMPOTENCY_SESSION_RESPONSE_TTL_SECONDS: int(600, 60, 86_400),
});

const apiEnvSchema = serviceEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(httpEnvSchema.shape)
  .extend(keyEnvSchema.shape)
  .extend(identityPolicySchema.shape)
  .extend(vaultEnvSchema.shape)
  .extend({
    // Evidence uploads (KYC doc §4; configuration, not law): slot TTL 10 min, upload URL ≤ 5 min, ≤ 40 objects per
    // application, ≤ 10 slots per account per 10 minutes, optional capture challenge valid 10 min.
    EVIDENCE_SLOT_TTL_SECONDS: int(600, 60, 3600),
    EVIDENCE_UPLOAD_URL_SECONDS: int(300, 30, 300),
    EVIDENCE_MAX_PER_APPLICATION: int(40, 1, 200),
    EVIDENCE_SLOTS_PER_10_MIN: int(10, 1, 1000),
    CAPTURE_CHALLENGE_TTL_SECONDS: int(600, 60, 3600),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** Set only when a trusted reverse proxy terminates TLS in front of the API (see trustProxySchema). */
    TRUST_PROXY: trustProxySchema,
    WAYVRO_BUILD_VERSION: z.string().min(1).default('dev'),
    // Staff realm (K10/Q42; configurable defaults per the staff matrix §2): idle lock 15 min, absolute 8 h, step-up 5 min.
    STAFF_SESSION_IDLE_SECONDS: int(900, 60, 3600),
    STAFF_SESSION_ABSOLUTE_SECONDS: int(28_800, 900, 43_200),
    STAFF_STEP_UP_SECONDS: int(300, 30, 900),
    STAFF_INVITATION_TTL_SECONDS: int(86_400, 600, 259_200),
    STAFF_ASSERTIONS_PER_IP_PER_10_MIN: int(60, 1, 100_000),
    STAFF_ASSERTIONS_PER_STAFF_PER_10_MIN: int(20, 1, 100_000),
    /** WebAuthn relying party: the web-ops host name (no scheme/port) and the exact allowed origins. */
    STAFF_WEBAUTHN_RP_ID: z
      .string()
      .regex(/^[a-z0-9.-]{1,253}$/)
      .default('localhost'),
    STAFF_WEBAUTHN_RP_NAME: z.string().min(1).max(64).default('Wayvro Operations'),
    STAFF_WEBAUTHN_ORIGINS: z
      .string()
      .default('http://localhost:3310')
      .transform((v) => Object.freeze(v.split(',').map((o) => o.trim())))
      .refine((list) => list.length > 0 && list.every((o) => /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(o)), {
        message: 'comma-separated origins (scheme://host[:port])',
      }),
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

/** WAYVRO_ENV-dependent rules (reported together with the shared environment rules). */
function apiEnvironmentRules(c: z.infer<typeof apiEnvSchema>): string[] {
  if (isNonProductionLike(c.WAYVRO_ENV)) return [];
  const issues: string[] = [];
  if (c.STAFF_WEBAUTHN_RP_ID === 'localhost' || !c.STAFF_WEBAUTHN_ORIGINS.every((o) => o.startsWith('https://'))) {
    issues.push('STAFF_WEBAUTHN_ORIGINS: staging/production require a real relying-party id and https origins for staff WebAuthn');
  }
  if (c.TRUST_PROXY === true) issues.push('TRUST_PROXY: staging/production must list the trusted reverse-proxy addresses/CIDRs; trust-all is refused');
  return issues;
}

export function loadApiConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  return loadConfig(apiEnvSchema, env, apiEnvironmentRules);
}
