/**
 * Readiness probes shared by every server process (api, worker, realtime). A probe must resolve — never reject —
 * within its own bounded timeout, so a dead dependency cannot hang health endpoints or orchestrator checks.
 */
import type { Database } from '@wayvro/db';
import { Redis } from 'ioredis';

const PROBE_TIMEOUT_MS = 1000;

/** A named dependency probe; resolves `true` when the dependency answered in time. */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<boolean>;
}

export function databaseCheck(db: Database): ReadinessCheck {
  return { name: 'database', check: () => db.ping(PROBE_TIMEOUT_MS) };
}

/** Redis/Valkey probe with no offline queue and a bounded timeout. */
export function redisCheck(url: string): ReadinessCheck & { close(): void } {
  const redis = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: PROBE_TIMEOUT_MS });
  redis.on('error', () => undefined); // connection errors surface as a failed probe, not an unhandled 'error' event
  return {
    name: 'redis',
    async check() {
      let timer: NodeJS.Timeout | undefined;
      try {
        if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('redis ping timed out'));
          }, PROBE_TIMEOUT_MS);
        });
        await Promise.race([redis.ping(), timeout]); // resolves only with PONG; errors/timeouts throw
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    close: () => {
      redis.disconnect();
    },
  };
}

/** Runs every probe concurrently and summarises the result in the contract's readiness shape. */
export async function evaluateReadiness(checks: readonly ReadinessCheck[]): Promise<{ status: 'ready' | 'not_ready'; checks: Record<string, 'ok' | 'fail'> }> {
  const results = await Promise.all(checks.map(async (c) => [c.name, (await c.check()) ? 'ok' : 'fail'] as const));
  return { status: results.every(([, s]) => s === 'ok') ? 'ready' : 'not_ready', checks: Object.fromEntries(results) };
}
