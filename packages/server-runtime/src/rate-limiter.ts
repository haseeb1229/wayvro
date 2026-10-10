/**
 * Atomic multi-dimensional rate limiter on Valkey/Redis (docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md §3.4).
 * One Lua script checks EVERY rule and increments all of them only if none is exceeded, so concurrent requests can
 * never overshoot a limit and a denied request consumes nothing. Windows are fixed windows that start at the first hit
 * of a key (TTL set atomically). Process memory is never authoritative state.
 *
 * Any Valkey error or timeout becomes `LimiterUnavailableError`; callers decide per use case — OTP issuance FAILS CLOSED.
 * Deployment note: the script touches several keys, so a Redis Cluster deployment must co-locate them (hash tags) or
 * use a non-cluster primary; P2.1 runs a single node (ADR-037), production engine choice stays with ADR-028.
 */
import { Redis } from 'ioredis';

export interface LimitRule {
  /** Business key without prefix, e.g. `otp:phone:h:<hash>`. */
  readonly key: string;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly cost?: number;
}

export interface LimitDecision {
  readonly allowed: boolean;
  /** Index of the first exceeded rule (in input order), when denied. */
  readonly deniedRule?: number;
  /** Seconds until the most restrictive exceeded window resets (0 when allowed). */
  readonly retryAfterSeconds: number;
}

export class LimiterUnavailableError extends Error {
  override readonly name = 'LimiterUnavailableError';
}

// ARGV[1] = mode (0 peek, 1 consume, 2 hit = increment unconditionally); then (limit, windowMs, cost) per key.
const SCRIPT = `
local mode = tonumber(ARGV[1])
local denied = 0
local retry = 0
for i = 1, #KEYS do
  local base = 1 + (i - 1) * 3
  local limit = tonumber(ARGV[base + 1])
  local window = tonumber(ARGV[base + 2])
  local cost = tonumber(ARGV[base + 3])
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if mode ~= 2 and current + cost > limit then
    local ttl = redis.call('PTTL', KEYS[i])
    if ttl < 0 then ttl = window end
    if ttl > retry then retry = ttl end
    if denied == 0 then denied = i end
  end
end
if denied > 0 or mode == 0 then return {denied, retry} end
for i = 1, #KEYS do
  local base = 1 + (i - 1) * 3
  local window = tonumber(ARGV[base + 2])
  local cost = tonumber(ARGV[base + 3])
  redis.call('INCRBY', KEYS[i], cost)
  if redis.call('PTTL', KEYS[i]) < 0 then redis.call('PEXPIRE', KEYS[i], window) end
end
return {0, 0}
`;

export class RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'wv:rl:',
  ) {}

  /** Checks every rule; increments all of them only when none would be exceeded. */
  consume(rules: readonly LimitRule[]): Promise<LimitDecision> {
    return this.run(1, rules);
  }

  /** Checks without consuming. */
  peek(rules: readonly LimitRule[]): Promise<LimitDecision> {
    return this.run(0, rules);
  }

  /** Increments unconditionally (event counters such as failed challenges); returns allowed=true. */
  async hit(rules: readonly LimitRule[]): Promise<void> {
    await this.run(2, rules);
  }

  /** Current count of one key (0 when absent). */
  async count(key: string): Promise<number> {
    try {
      return Number((await this.redis.get(this.prefix + key)) ?? '0');
    } catch (e) {
      throw new LimiterUnavailableError('rate limiter unavailable', { cause: e });
    }
  }

  private async run(mode: 0 | 1 | 2, rules: readonly LimitRule[]): Promise<LimitDecision> {
    if (rules.length === 0) return { allowed: true, retryAfterSeconds: 0 };
    const args: Array<string | number> = [mode];
    for (const r of rules) {
      const cost = r.cost ?? 1;
      if (!Number.isInteger(r.limit) || r.limit < 0 || !Number.isInteger(r.windowSeconds) || r.windowSeconds < 1 || !Number.isInteger(cost) || cost < 1) {
        throw new RangeError(`invalid limit rule for ${r.key}`);
      }
      args.push(r.limit, r.windowSeconds * 1000, cost);
    }
    let reply: unknown;
    try {
      reply = await this.redis.eval(SCRIPT, rules.length, ...rules.map((r) => this.prefix + r.key), ...args);
    } catch (e) {
      throw new LimiterUnavailableError('rate limiter unavailable', { cause: e });
    }
    const [denied, retryMs] = reply as [number, number];
    return denied > 0
      ? { allowed: false, deniedRule: denied - 1, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) }
      : { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * A Redis client for request-path use: no offline queue (commands fail immediately while disconnected), one attempt and
 * a short command timeout, so an outage surfaces as `LimiterUnavailableError` within milliseconds instead of hanging.
 */
export function createRequestPathRedis(url: string, commandTimeoutMs = 250): Redis {
  const client = new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: commandTimeoutMs, connectTimeout: 1000 });
  client.on('error', () => undefined); // surfaced per command as LimiterUnavailableError; reconnects in the background
  return client;
}

/** Waits (bounded) for a request-path client's first connection, so boot does not race the first request. */
export async function awaitRedisReady(client: Redis, timeoutMs: number): Promise<boolean> {
  if (client.status === 'ready') return true;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      new Promise<boolean>((resolve) => {
        client.once('ready', () => {
          resolve(true);
        });
      }),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
