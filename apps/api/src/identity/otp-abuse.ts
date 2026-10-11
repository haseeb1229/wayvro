/**
 * OTP abuse controls (K08/Q06/T-01; docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md §3.4). All counters live in Valkey via
 * the atomic limiter; process memory is never authoritative.
 *
 *   per installation (daily)            exceeded -> 429 WAYVRO_E_RATE_LIMITED (the caller already knows its own id)
 *   per client IP prefix (hard, hourly)  exceeded -> 429 (IPv4 /24, IPv6 /56; CGNAT makes IP weak, so the hard cap is high)
 *   per client IP prefix (soft, hourly)  exceeded -> risk signal (log) only
 *   per phone (failed-challenge cooldown, hourly, daily) exceeded -> SILENT DROP (identical 202, no SMS)
 *   per +92 operator prefix: conversion monitor (verified ÷ sent) -> alert + per-minute friction cap -> silent drop
 *   global daily/monthly send budget     alerts at 50/80/100 %, exhausted -> 503 (never "verified without OTP")
 *
 * Limiter unavailable => FAIL CLOSED (503) for issuing and verifying codes. Recording counters after a database decision
 * (failed challenge, verified prefix) is best-effort and logged when it cannot be recorded — the database state (LOCKED
 * challenge, consumed code) stays authoritative.
 * Not implemented: ASN-level signals (no IP-to-ASN data source is approved) — documented residual risk.
 */
import { isIP } from 'node:net';
import type { KeyedHasher } from '@wayvro/field-crypto';
import { WayvroError, type Logger } from '@wayvro/observability';
import { LimiterUnavailableError, type LimitRule, type RateLimiter } from '@wayvro/server-runtime';
import type { ApiConfig } from '../config.js';

const HOUR = 3600;
const DAY = 86_400;

export type SendDecision =
  { readonly send: true } | { readonly send: false; readonly reason: 'PHONE_COOLDOWN' | 'PHONE_SEND_LIMIT' | 'PREFIX_FRICTION' | 'NO_ACCOUNT' };

export interface SendContext {
  readonly phoneKey: string;
  readonly installationKey: string;
  readonly clientIp: string;
  /** `+92` + operator code, e.g. `+92300`. */
  readonly operatorPrefix: string;
}

/**
 * `/24` for IPv4, `/56` for IPv6 (normalised), or `null` when the address cannot be parsed.
 * @internal exported for unit tests.
 */
export function ipPrefix(ip: string): string | null {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  if (isIP(ip) !== 6) return null;
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right].map((g) => g.padStart(4, '0'));
  // 56 bits = 3.5 groups: keep groups 0-2 and the high byte of group 3.
  return `${groups.slice(0, 3).join(':')}:${(groups[3] ?? '0000').slice(0, 2)}00::/56`;
}

export class OtpAbuseControls {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly hasher: KeyedHasher,
    private readonly policy: ApiConfig,
    private readonly log: Logger,
  ) {}

  private failClosed(e: unknown): never {
    if (e instanceof LimiterUnavailableError) {
      this.log.error({ err: e }, 'otp abuse controls unavailable; failing closed');
      throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE', { cause: e });
    }
    throw e;
  }

  private ipKey(clientIp: string): string | null {
    const prefix = ipPrefix(clientIp);
    return prefix ? this.hasher.active('risk_signals', `ip-prefix|${prefix}`).digest.toString('hex') : null;
  }

  /** Decides whether a code may be sent; throws 429/503 for caller-visible limits and outages. */
  async admitSend(ctx: SendContext, now: Date = new Date()): Promise<SendDecision> {
    const p = this.policy;
    try {
      const ip = this.ipKey(ctx.clientIp);
      const hard: LimitRule[] = [{ key: `otp:inst:d:${ctx.installationKey}`, limit: p.OTP_INSTALLATION_SENDS_PER_DAY, windowSeconds: DAY }];
      if (ip) hard.push({ key: `otp:ip:h:${ip}`, limit: p.OTP_IP_PREFIX_SENDS_PER_HOUR_HARD, windowSeconds: HOUR });
      const hardDecision = await this.limiter.consume(hard);
      if (!hardDecision.allowed) throw new WayvroError('WAYVRO_E_RATE_LIMITED', { details: { retryAfterSeconds: hardDecision.retryAfterSeconds } });

      if (ip) {
        const soft = { key: `otp:ipsoft:h:${ip}`, limit: p.OTP_IP_PREFIX_SENDS_PER_HOUR_SOFT, windowSeconds: HOUR };
        await this.limiter.hit([soft]);
        if ((await this.limiter.count(soft.key)) > soft.limit)
          this.log.warn({ signal: 'OTP_IP_PREFIX_SOFT_LIMIT' }, 'otp risk signal: client IP prefix above the soft limit');
      }

      // peek denies once the failed-challenge count has reached the limit (count + 1 > limit).
      const cooldown = await this.limiter.peek([{ key: `otp:phone:fail:${ctx.phoneKey}`, limit: p.OTP_PHONE_FAILED_CHALLENGES_PER_DAY, windowSeconds: DAY }]);
      if (!cooldown.allowed) return { send: false, reason: 'PHONE_COOLDOWN' };
      const phone = await this.limiter.consume([
        { key: `otp:phone:h:${ctx.phoneKey}`, limit: p.OTP_PHONE_SENDS_PER_HOUR, windowSeconds: HOUR },
        { key: `otp:phone:d:${ctx.phoneKey}`, limit: p.OTP_PHONE_SENDS_PER_DAY, windowSeconds: DAY },
      ]);
      if (!phone.allowed) return { send: false, reason: 'PHONE_SEND_LIMIT' };

      if (await this.prefixElevated(ctx.operatorPrefix)) {
        const cap = await this.limiter.consume([
          { key: `otp:prefix:cap:m:${ctx.operatorPrefix}`, limit: p.OTP_PREFIX_ELEVATED_SENDS_PER_MINUTE, windowSeconds: 60 },
        ]);
        if (!cap.allowed) return { send: false, reason: 'PREFIX_FRICTION' };
      }

      await this.spendBudget(now);
      await this.limiter.hit([{ key: `otp:prefix:sends:h:${ctx.operatorPrefix}`, limit: 0, windowSeconds: HOUR }]);
      return { send: true };
    } catch (e) {
      return this.failClosed(e);
    }
  }

  /** Conversion monitor: an operator prefix with many sends and few verifications looks like SMS pumping. */
  private async prefixElevated(prefix: string): Promise<boolean> {
    const sends = await this.limiter.count(`otp:prefix:sends:h:${prefix}`);
    if (sends < this.policy.OTP_PREFIX_MONITOR_MIN_SENDS) return false;
    const verified = await this.limiter.count(`otp:prefix:verified:h:${prefix}`);
    const elevated = verified * 100 < sends * this.policy.OTP_PREFIX_MIN_CONVERSION_PERCENT;
    if (elevated)
      this.log.warn(
        { signal: 'OTP_PREFIX_LOW_CONVERSION', prefix, sends, verified },
        'otp alert: low verification rate for an operator prefix; friction applied',
      );
    return elevated;
  }

  private async spendBudget(now: Date): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const rules = [
      { key: `otp:budget:d:${day}`, limit: this.policy.OTP_DAILY_SEND_BUDGET, windowSeconds: 2 * DAY },
      { key: `otp:budget:m:${month}`, limit: this.policy.OTP_MONTHLY_SEND_BUDGET, windowSeconds: 32 * DAY },
    ];
    const decision = await this.limiter.consume(rules);
    if (!decision.allowed) {
      this.log.error(
        { signal: 'OTP_BUDGET_EXHAUSTED', window: decision.deniedRule === 0 ? 'day' : 'month' },
        'otp alert: send budget exhausted; refusing new sends',
      );
      throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE');
    }
    for (const rule of rules) {
      const used = await this.limiter.count(rule.key);
      for (const pct of [50, 80, 100]) {
        if (used === Math.ceil((rule.limit * pct) / 100))
          this.log.warn(
            { signal: 'OTP_BUDGET_THRESHOLD', percent: pct, window: rule.key.includes(':d:') ? 'day' : 'month' },
            'otp alert: send budget threshold reached',
          );
      }
    }
  }

  async admitVerify(installationKey: string): Promise<void> {
    try {
      const d = await this.limiter.consume([
        { key: `otp:verify:inst:h:${installationKey}`, limit: this.policy.OTP_VERIFY_ATTEMPTS_PER_INSTALLATION_HOUR, windowSeconds: HOUR },
      ]);
      if (!d.allowed) throw new WayvroError('WAYVRO_E_RATE_LIMITED', { details: { retryAfterSeconds: d.retryAfterSeconds } });
    } catch (e) {
      this.failClosed(e);
    }
  }

  async admitRefresh(sessionId: string): Promise<void> {
    try {
      const d = await this.limiter.consume([{ key: `auth:refresh:sess:h:${sessionId}`, limit: this.policy.SESSION_REFRESHES_PER_HOUR, windowSeconds: HOUR }]);
      if (!d.allowed) throw new WayvroError('WAYVRO_E_RATE_LIMITED', { details: { retryAfterSeconds: d.retryAfterSeconds } });
    } catch (e) {
      this.failClosed(e);
    }
  }

  /** A challenge was locked by wrong codes: counts towards the phone's 24 h cooldown (best-effort, logged). */
  async recordFailedChallenge(phoneKey: string): Promise<void> {
    await this.bestEffort([{ key: `otp:phone:fail:${phoneKey}`, limit: 0, windowSeconds: DAY }], 'failed-challenge');
  }

  /** A code was verified: feeds the per-prefix conversion monitor (best-effort, logged). */
  async recordVerified(operatorPrefix: string): Promise<void> {
    await this.bestEffort([{ key: `otp:prefix:verified:h:${operatorPrefix}`, limit: 0, windowSeconds: HOUR }], 'prefix-verified');
  }

  private async bestEffort(rules: LimitRule[], counter: string): Promise<void> {
    try {
      await this.limiter.hit(rules);
    } catch (e) {
      if (!(e instanceof LimiterUnavailableError)) throw e;
      this.log.warn({ counter, err: e }, 'otp counter not recorded: limiter unavailable (database state remains authoritative)');
    }
  }
}
