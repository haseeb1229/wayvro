/**
 * `GET /v1/app/config` assembly without infrastructure (injected clock, fake store and limiter): last-known state served
 * at most 10 minutes while the store is unreachable (flagged stale), then 503; never loaded ⇒ 503; the in-process
 * fallback bucket per IP prefix when Valkey is unavailable; ETag stability across `serverTime`.
 */
import { createLogger } from '@wayvro/observability';
import { LimiterUnavailableError, type Queryable, type RateLimiter } from '@wayvro/server-runtime';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG_STALE_LIMIT_MS, AppConfigService, etagMatches, type AppConfigPolicy } from '../src/platform/release/app-config.service.js';
import { ReleaseStateCache } from '../src/platform/release/state.js';
import { RuntimeSwitchStore } from '../src/platform/release/switches.js';

const log = createLogger({ service: 'api', env: 'test', level: 'fatal' });
const policy: AppConfigPolicy = {
  APP_CONFIG_PER_MINUTE_IP_PREFIX: 2,
  GEO_RENDERER_KIND: 'none',
  APP_GEO_AUTOCOMPLETE_MIN_CHARS: 3,
  APP_GEO_AUTOCOMPLETE_DEBOUNCE_MS: 300,
  APP_GEO_REVERSE_DEBOUNCE_MS: 600,
  APP_LITE_AUTO_SUGGEST_AFTER_SLOW_REQUESTS: 3,
  APP_LITE_SLOW_REQUEST_MS: 4000,
};

function harness(limiter: Pick<RateLimiter, 'consume'>) {
  let now = Date.parse('2026-10-13T00:00:00Z');
  let failing = false;
  const db = {
    query: (sql: string) => {
      if (failing) return Promise.reject(new Error('connection refused'));
      if (sql.includes('app_version_policies')) {
        return Promise.resolve({
          rows: [
            {
              id: 'p1',
              platform: 'ANDROID',
              version: 1,
              min_supported_build: 100,
              recommended_build: 120,
              store_url_key: null,
              soft_message_key: 'release.soft.default',
              hard_message_key: 'release.hard.default',
              ranges: [{ lower: 105, upper: 108, reason: 'SECURITY' }],
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Queryable;
  const clock = () => now;
  const state = new ReleaseStateCache(db, { ttlMs: 10_000, log, now: clock });
  const service = new AppConfigService(state, new RuntimeSwitchStore(state, 'test'), limiter as RateLimiter, policy, log, clock);
  return {
    service,
    advance: (ms: number) => {
      now += ms;
    },
    fail: (f: boolean) => {
      failing = f;
    },
  };
}
const allowAll = { consume: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }) };

describe('app config assembly', () => {
  it('evaluates the calling build (int4range upper bound is exclusive), with defaults for map/geo/lite', async () => {
    const h = harness(allowAll);
    const blocked = await h.service.build({ platform: 'ANDROID', build: 107 });
    expect(blocked.body.client).toEqual({
      state: 'HARD_UPDATE',
      reasonClass: 'SECURITY',
      messageKey: 'release.hard.default',
      storeUrlKey: null,
      recommendedBuild: 120,
      minSupportedBuild: 100,
    });
    expect((await h.service.build({ platform: 'ANDROID', build: 108 })).body.client.state).toBe('SOFT_UPDATE');
    const anonymous = await h.service.build(null);
    expect(anonymous.body.client.state).toBe('OK');
    expect(anonymous.body.map).toEqual({ rendererKind: 'none', styleUrl: null, attributionCodes: [], clientToken: null });
    expect(anonymous.body.geo).toEqual({ autocompleteMinChars: 3, autocompleteDebounceMs: 300, reverseDebounceMs: 600 });
    expect(anonymous.body.maintenance).toEqual({ active: false, messageKey: null, expectedEnd: null });
    // no switch rows: registry defaults (maintenance not running, quotes running)
    const states = Object.fromEntries(anonymous.body.switches.map((s) => [s.key, s.state]));
    expect(states).toMatchObject({ 'platform.maintenance': 'DISABLED', 'rider.quotes': 'ENABLED', 'platform.geo-routing': 'ENABLED' });
  });

  it('the ETag ignores serverTime and changes with the content', async () => {
    const h = harness(allowAll);
    const a = await h.service.build(null);
    h.advance(1000);
    const b = await h.service.build(null);
    expect(a.body.serverTime).not.toBe(b.body.serverTime);
    expect(a.etag).toBe(b.etag);
    expect((await h.service.build({ platform: 'ANDROID', build: 1 })).etag).not.toBe(a.etag);
    expect(etagMatches(a.etag, a.etag)).toBe(true);
    expect(etagMatches(`"other", W/${a.etag}`, a.etag)).toBe(true);
    expect(etagMatches('*', a.etag)).toBe(true);
    expect(etagMatches('"other"', a.etag)).toBe(false);
    expect(etagMatches(undefined, a.etag)).toBe(false);
  });

  it('store unreachable: last-known state for at most 10 minutes (stale), then 503; never loaded ⇒ 503', async () => {
    const h = harness(allowAll);
    expect((await h.service.build(null)).stale).toBe(false);
    h.fail(true);
    h.advance(10_000);
    const stale = await h.service.build({ platform: 'ANDROID', build: 50 });
    expect(stale.stale).toBe(true);
    expect(stale.body.client.state).toBe('HARD_UPDATE');
    h.advance(APP_CONFIG_STALE_LIMIT_MS - 10_000);
    expect((await h.service.build(null)).stale).toBe(true);
    h.advance(1);
    await expect(h.service.build(null)).rejects.toMatchObject({ code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE' });
    const cold = harness(allowAll);
    cold.fail(true);
    await expect(cold.service.build(null)).rejects.toMatchObject({ code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE' });
  });

  it('rate limit: Valkey decision, else an in-process bucket per IP prefix (fixed 60 s window)', async () => {
    const denied = harness({ consume: () => Promise.resolve({ allowed: false, retryAfterSeconds: 42 }) });
    await expect(denied.service.admit('203.0.113.7')).rejects.toMatchObject({ code: 'WAYVRO_E_RATE_LIMITED', details: { retryAfterSeconds: 42 } });
    const down = harness({ consume: () => Promise.reject(new LimiterUnavailableError('down')) });
    await down.service.admit('203.0.113.7');
    await down.service.admit('203.0.113.8'); // same /24
    await expect(down.service.admit('203.0.113.9')).rejects.toMatchObject({ code: 'WAYVRO_E_RATE_LIMITED' });
    await down.service.admit('198.51.100.1'); // another prefix has its own bucket
    down.advance(60_000);
    await down.service.admit('203.0.113.7');
    const broken = harness({ consume: () => Promise.reject(new Error('programming error')) });
    await expect(broken.service.admit('203.0.113.7')).rejects.toThrow('programming error');
  });
});

describe('release state cache — concurrent reads during a refresh', () => {
  it('a caller arriving while a refresh is in flight gets the refreshed state, never the snapshot being replaced', async () => {
    let now = Date.parse('2026-10-15T00:00:00Z');
    const maintenanceOn = {
      id: 's1',
      key: 'platform.maintenance',
      scope: 'ALL',
      city_code: null,
      state: 'ENABLED',
      message_key: null,
      expected_end: null,
    };
    let switchRows: unknown[] = [];
    let hold: Promise<void> = Promise.resolve();
    const db = {
      query: async (sql: string) => {
        if (sql.includes('app_version_policies')) return { rows: [] };
        const rows = switchRows;
        await hold;
        return { rows };
      },
    } as unknown as Queryable;
    const state = new ReleaseStateCache(db, { ttlMs: 1000, log, now: () => now });
    const switches = new RuntimeSwitchStore(state, 'test');
    expect(switches.maintenanceOf((await state.get()).switches).active).toBe(false);

    // maintenance starts; the TTL elapses; the next refresh's query is slow
    switchRows = [maintenanceOn];
    now += 1000;
    let release = (): void => undefined;
    hold = new Promise((resolve) => {
      release = resolve;
    });
    const first = state.get(); // starts the refresh (e.g. the enforcement hook of an account-state call)
    const second = state.get(); // arrives meanwhile (e.g. GET /v1/app/config of the same app start)
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(switches.maintenanceOf(a.switches).active).toBe(true);
    expect(switches.maintenanceOf(b.switches).active).toBe(true);
    // single-flight is kept: within the TTL no further query runs
    switchRows = [];
    expect(switches.maintenanceOf((await state.get()).switches).active).toBe(true);
  });
});
