/**
 * UNIT-POLICY (PHASE3_TEST_STRATEGY): the pure app version policy evaluator, the runtime-switch evaluation semantics,
 * the release-state cache (TTL with an injected clock, documented fail-open when the store is unreachable) and the
 * exempt-route list of the 426/503 enforcement hook. No infrastructure.
 */
import { API_ROUTES } from '@wayvro/contracts';
import { RUNTIME_SWITCH_REGISTRY, runtimeSwitchDefinition, type RuntimeSwitchDefinition } from '@wayvro/config';
import { createLogger } from '@wayvro/observability';
import type { Queryable } from '@wayvro/server-runtime';
import { captureLogs } from '@wayvro/test-support';
import { describe, expect, it } from 'vitest';
import { EXEMPT_ROUTES, isExemptRoute, readAppClient } from '../src/platform/release/enforcement.js';
import { evaluateAppPolicy, maintenanceRetryAfterSeconds, type ActiveAppPolicy, type MaintenanceView } from '../src/platform/release/policy.js';
import { ReleaseStateCache, type SwitchRowState } from '../src/platform/release/state.js';
import { RuntimeSwitchStore, baseState, switchStopped } from '../src/platform/release/switches.js';

const policy: ActiveAppPolicy = {
  id: '00000000-0000-7000-8000-000000000001',
  platform: 'ANDROID',
  version: 3,
  minSupportedBuild: 100,
  recommendedBuild: 120,
  storeUrlKey: 'store.android',
  softMessageKey: 'release.soft.default',
  hardMessageKey: 'release.hard.default',
  blockedRanges: [
    { fromBuild: 105, toBuild: 107, reasonCode: 'SECURITY' },
    { fromBuild: 90, toBuild: 95, reasonCode: 'DATA_CORRUPTION' },
  ],
};
const off: MaintenanceView = { active: false, messageKey: null, expectedEnd: null };
const on: MaintenanceView = { active: true, messageKey: 'maintenance.planned', expectedEnd: new Date('2026-10-13T02:00:00Z') };
const android = (build: number) => ({ platform: 'ANDROID' as const, build });

describe('evaluateAppPolicy (UNIT-POLICY)', () => {
  it('build below the minimum ⇒ HARD_UPDATE (MINIMUM_BUILD) with the hard message and store key', () => {
    expect(evaluateAppPolicy({ client: android(99), policy, maintenance: off })).toEqual({
      state: 'HARD_UPDATE',
      reasonClass: 'MINIMUM_BUILD',
      messageKey: 'release.hard.default',
      storeUrlKey: 'store.android',
      recommendedBuild: 120,
      minSupportedBuild: 100,
    });
  });

  it('build inside a blocked range ⇒ HARD_UPDATE with that range reason (even above the minimum; the range reason wins)', () => {
    for (const build of [105, 106, 107])
      expect(evaluateAppPolicy({ client: android(build), policy, maintenance: off })).toMatchObject({ state: 'HARD_UPDATE', reasonClass: 'SECURITY' });
    expect(evaluateAppPolicy({ client: android(92), policy, maintenance: off })).toMatchObject({ state: 'HARD_UPDATE', reasonClass: 'DATA_CORRUPTION' });
    expect(evaluateAppPolicy({ client: android(108), policy, maintenance: off }).state).toBe('SOFT_UPDATE');
  });

  it('minimum <= build < recommended ⇒ SOFT_UPDATE; build >= recommended ⇒ OK (boundaries inclusive/exclusive as specified)', () => {
    expect(evaluateAppPolicy({ client: android(100), policy, maintenance: off })).toMatchObject({
      state: 'SOFT_UPDATE',
      messageKey: 'release.soft.default',
      reasonClass: null,
    });
    expect(evaluateAppPolicy({ client: android(119), policy, maintenance: off }).state).toBe('SOFT_UPDATE');
    expect(evaluateAppPolicy({ client: android(120), policy, maintenance: off })).toEqual({
      state: 'OK',
      reasonClass: null,
      messageKey: null,
      storeUrlKey: 'store.android',
      recommendedBuild: 120,
      minSupportedBuild: 100,
    });
  });

  it('maintenance overrides SOFT_UPDATE and OK, but a build that must update is told so (HARD wins)', () => {
    expect(evaluateAppPolicy({ client: android(110), policy, maintenance: on })).toMatchObject({
      state: 'MAINTENANCE',
      messageKey: 'maintenance.planned',
      storeUrlKey: null,
    });
    expect(evaluateAppPolicy({ client: android(130), policy, maintenance: on }).state).toBe('MAINTENANCE');
    expect(evaluateAppPolicy({ client: null, policy: null, maintenance: on })).toEqual({
      state: 'MAINTENANCE',
      reasonClass: null,
      messageKey: 'maintenance.planned',
      storeUrlKey: null,
      recommendedBuild: null,
      minSupportedBuild: null,
    });
    expect(evaluateAppPolicy({ client: android(50), policy, maintenance: on }).state).toBe('HARD_UPDATE');
  });

  it('documented fail-open: no headers or no ACTIVE policy ⇒ OK; a policy of another platform never applies', () => {
    const ok = { state: 'OK', reasonClass: null, messageKey: null, storeUrlKey: null, recommendedBuild: null, minSupportedBuild: null };
    expect(evaluateAppPolicy({ client: null, policy, maintenance: off })).toEqual(ok);
    expect(evaluateAppPolicy({ client: android(1), policy: null, maintenance: off })).toEqual(ok);
    expect(evaluateAppPolicy({ client: { platform: 'IOS', build: 1 }, policy, maintenance: off })).toEqual(ok);
  });

  it('Retry-After comes from the expected end (never negative; absent without an end)', () => {
    const now = Date.parse('2026-10-13T01:00:00Z');
    expect(maintenanceRetryAfterSeconds(on, now)).toBe(3600);
    expect(maintenanceRetryAfterSeconds(on, Date.parse('2026-10-13T03:00:00Z'))).toBeUndefined();
    expect(maintenanceRetryAfterSeconds({ ...on, expectedEnd: null }, now)).toBeUndefined();
    expect(maintenanceRetryAfterSeconds(off, now)).toBeUndefined();
  });
});

describe('compatibility headers are hints, never trusted', () => {
  it('absent, partial and malformed headers are classified without throwing', () => {
    expect(readAppClient({})).toEqual({ kind: 'ABSENT' });
    expect(readAppClient({ 'x-wayvro-platform': 'ANDROID', 'x-wayvro-app-build': '120' })).toEqual({ kind: 'PRESENT', client: android(120) });
    expect(readAppClient({ 'x-wayvro-platform': 'ANDROID' })).toEqual({ kind: 'INVALID' });
    expect(readAppClient({ 'x-wayvro-app-build': '120' })).toEqual({ kind: 'INVALID' });
    expect(readAppClient({ 'x-wayvro-platform': 'WINDOWS', 'x-wayvro-app-build': '1' })).toEqual({ kind: 'INVALID' });
    expect(readAppClient({ 'x-wayvro-platform': 'IOS', 'x-wayvro-app-build': '-1' })).toEqual({ kind: 'INVALID' });
    expect(readAppClient({ 'x-wayvro-platform': 'IOS', 'x-wayvro-app-build': '1234567890' })).toEqual({ kind: 'INVALID' });
  });
});

describe('exempt routes (always reachable under HARD_UPDATE and MAINTENANCE)', () => {
  it('every listed exempt route exists in the published contract (no drift)', () => {
    const published = new Set(API_ROUTES.map((r) => `${r.method} ${r.path}`));
    for (const r of EXEMPT_ROUTES) expect(published.has(r), r).toBe(true);
  });

  it('staff, health, legal reads, app config, sign-out, token refresh and the deletion path are exempt; consumer routes are not', () => {
    expect(isExemptRoute('GET', '/v1/admin/switches')).toBe(true);
    expect(isExemptRoute('POST', '/v1/admin/switches/restore-requests/:id/approval')).toBe(true);
    expect(isExemptRoute('GET', '/v1/health/ready')).toBe(true);
    expect(isExemptRoute('GET', '/v1/legal/policies/:policyKey/versions/:version')).toBe(true);
    expect(isExemptRoute('GET', '/v1/app/config')).toBe(true);
    expect(isExemptRoute('DELETE', '/v1/auth/sessions/current')).toBe(true);
    expect(isExemptRoute('POST', '/v1/account/step-ups/:challengeId/verifications')).toBe(true);
    expect(isExemptRoute('POST', '/v1/account/deletion-requests/:id/cancellation')).toBe(true);
    expect(isExemptRoute('POST', '/v1/public/account-deletion-requests')).toBe(true);
    expect(isExemptRoute('POST', '/v1/account/consents')).toBe(false);
    expect(isExemptRoute('GET', '/v1/account/state')).toBe(false);
    expect(isExemptRoute('POST', '/v1/auth/otp-challenges')).toBe(false);
    expect(isExemptRoute('GET', '/v1/driver/compliance')).toBe(false);
  });
});

const row = (key: string, state: 'ENABLED' | 'DISABLED', scope: SwitchRowState['scope'] = 'ALL', cityCode: string | null = null): SwitchRowState => ({
  id: `${key}-${scope}-${cityCode ?? 'x'}`,
  key,
  scope,
  cityCode,
  state,
  messageKey: null,
  expectedEnd: null,
});
const def = (key: string): RuntimeSwitchDefinition => {
  const d = runtimeSwitchDefinition(key);
  if (!d) throw new Error(key);
  return d;
};

describe('runtime switch evaluation (switches only reduce capability)', () => {
  it('no row ⇒ registry default for the environment', () => {
    for (const s of RUNTIME_SWITCH_REGISTRY) expect(switchStopped(s, [], 'production')).toBe(s.defaults.production === s.safeState);
    expect(baseState(def('platform.maintenance'), [], 'test')).toBe('DISABLED');
  });

  it('a RIDER-scoped stop never stops the DRIVER scope; a city stop applies only to that city; ALL stops everyone', () => {
    const quotes = def('rider.quotes');
    const riderStop = [row('rider.quotes', 'DISABLED', 'RIDER')];
    expect(switchStopped(quotes, riderStop, 'test', { scope: 'RIDER' })).toBe(true);
    expect(switchStopped(quotes, riderStop, 'test', { scope: 'DRIVER' })).toBe(false);
    expect(switchStopped(quotes, riderStop, 'test')).toBe(false);
    const cityStop = [row('rider.quotes', 'DISABLED', 'ALL', 'LHR')];
    expect(switchStopped(quotes, cityStop, 'test', { cityCode: 'LHR' })).toBe(true);
    expect(switchStopped(quotes, cityStop, 'test', { cityCode: 'KHI' })).toBe(false);
    expect(switchStopped(quotes, [row('rider.quotes', 'DISABLED')], 'test', { scope: 'DRIVER', cityCode: 'KHI' })).toBe(true);
  });

  it('a narrower row in the running state cannot re-enable a stopped base', () => {
    const quotes = def('rider.quotes');
    expect(switchStopped(quotes, [row('rider.quotes', 'DISABLED'), row('rider.quotes', 'ENABLED', 'RIDER')], 'test', { scope: 'RIDER' })).toBe(true);
  });

  it('maintenance: safe state ENABLED; the reader refuses unknown keys', async () => {
    const empty: Queryable = { query: () => Promise.resolve({ rows: [], rowCount: 0 }) } as unknown as Queryable;
    const store = new RuntimeSwitchStore(
      new ReleaseStateCache(empty, { ttlMs: 1000, log: createLogger({ service: 'api', env: 'test', level: 'fatal' }) }),
      'test',
    );
    expect(store.maintenanceOf([row('platform.maintenance', 'ENABLED')])).toEqual({ active: true, messageKey: null, expectedEnd: null });
    expect(store.maintenanceOf([row('platform.maintenance', 'DISABLED')]).active).toBe(false);
    expect(store.maintenanceOf([]).active).toBe(false);
    await expect(store.isStopped('platform.no-such-switch')).rejects.toThrow(/unknown runtime switch/);
    await expect(store.isStopped('rider.quotes', { scope: 'RIDER' })).resolves.toBe(false);
    expect(store.clientSwitchesOf([]).map((s) => s.key)).toEqual(RUNTIME_SWITCH_REGISTRY.filter((s) => s.clientVisible).map((s) => s.key));
  });
});

describe('release-state cache (TTL with an injected clock; fail-open)', () => {
  function harness() {
    let now = 1_000_000;
    let calls = 0;
    let failing = false;
    let switchState: 'ENABLED' | 'DISABLED' = 'DISABLED';
    const db = {
      query: (sql: string) => {
        calls++;
        if (failing) return Promise.reject(new Error('connection refused'));
        if (sql.includes('runtime_switches')) {
          return Promise.resolve({
            rows: [{ id: 's1', key: 'rider.quotes', scope: 'ALL', city_code: null, state: switchState, message_key: null, expected_end: null }],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    } as unknown as Queryable;
    const logs = captureLogs();
    const cache = new ReleaseStateCache(db, {
      ttlMs: 10_000,
      log: createLogger({ service: 'api', env: 'test', level: 'warn', destination: logs.stream }),
      now: () => now,
    });
    return {
      cache,
      logs,
      advance: (ms: number) => {
        now += ms;
      },
      setFailing: (f: boolean) => {
        failing = f;
      },
      setSwitch: (s: 'ENABLED' | 'DISABLED') => {
        switchState = s;
      },
      calls: () => calls,
    };
  }

  it('reloads only after the TTL; concurrent readers share one load; invalidate forces a reload', async () => {
    const h = harness();
    await Promise.all([h.cache.get(), h.cache.get(), h.cache.get()]);
    expect(h.calls()).toBe(2); // one load = two queries
    h.setSwitch('ENABLED');
    h.advance(9_999);
    expect((await h.cache.get()).switches[0]?.state).toBe('DISABLED');
    h.advance(1);
    expect((await h.cache.get()).switches[0]?.state).toBe('ENABLED');
    expect(h.calls()).toBe(4);
    h.cache.invalidate();
    await h.cache.get();
    expect(h.calls()).toBe(6);
  });

  it('store unreachable at boot ⇒ empty snapshot (no policy, registry defaults), flagged stale; later failures keep the last-known state', async () => {
    const h = harness();
    h.setFailing(true);
    const boot = await h.cache.get();
    expect(boot).toMatchObject({ loadedAt: null, stale: true, switches: [] });
    expect(boot.policies.size).toBe(0);
    expect(h.logs.text()).toContain('RELEASE_STATE_UNAVAILABLE');
    // bounded: no second attempt before the TTL elapses
    await h.cache.get();
    expect(h.calls()).toBe(2);
    h.setFailing(false);
    h.advance(10_000);
    const loaded = await h.cache.get();
    expect(loaded).toMatchObject({ stale: false, loadedAt: 1_010_000 });
    h.setFailing(true);
    h.advance(10_000);
    const stale = await h.cache.get();
    expect(stale).toMatchObject({ stale: true, loadedAt: 1_010_000 });
    expect(stale.switches).toHaveLength(1);
  });
});
