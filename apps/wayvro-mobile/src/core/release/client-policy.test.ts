import { describe, expect, it } from 'vitest';
import { appConfig } from '../../__mocks__/p3-fixtures';
import {
  DEFAULT_TUNING,
  evaluateClientPolicy,
  isBlocking,
  isEscapePath,
  rendersWithoutAccountState,
  maintenanceRetryDelayMs,
  parseCachedPolicy,
  shouldFetchPolicy,
  snapshotOf,
  SOFT_BANNER_INTERVAL_MS,
  switchDisabled,
  tuningOf,
  type ForcedState,
  type PolicyInput,
} from './client-policy';

const NOW = 1_800_000_000_000;
const input = (patch: Partial<PolicyInput>): PolicyInput => ({ snapshot: null, build: 10, forced: null, softDismissedAt: null, now: NOW, ...patch });

describe('UNIT-POLICY evaluateClientPolicy (A01/Q31)', () => {
  it('offline without any cached policy ⇒ OK (the server enforces on the next call)', () => {
    expect(evaluateClientPolicy(input({}))).toEqual({ kind: 'ok' });
    expect(evaluateClientPolicy(input({ build: null }))).toEqual({ kind: 'ok' });
  });

  it('build below the minimum ⇒ HARD_UPDATE (MINIMUM_BUILD), even if the cached state still says OK', () => {
    const snapshot = snapshotOf(appConfig({ minSupportedBuild: 11 }));
    expect(evaluateClientPolicy(input({ snapshot, build: 10 }))).toEqual({ kind: 'hard-update', reasonClass: 'MINIMUM_BUILD', storeUrlKey: null });
    expect(evaluateClientPolicy(input({ snapshot, build: 11 })).kind).toBe('ok');
  });

  it('a build in a blocked range (server HARD_UPDATE with its reason) ⇒ HARD_UPDATE with that reason', () => {
    for (const reasonClass of ['SECURITY', 'DATA_CORRUPTION', 'CONTRACT_BREAK', 'MINIMUM_BUILD'] as const) {
      const snapshot = snapshotOf(appConfig({ state: 'HARD_UPDATE', reasonClass, storeUrlKey: 'store.android' }));
      expect(evaluateClientPolicy(input({ snapshot }))).toEqual({ kind: 'hard-update', reasonClass, storeUrlKey: 'store.android' });
    }
  });

  it('min ≤ build < recommended ⇒ SOFT_UPDATE, banner at most once per 24 h after a dismissal', () => {
    const snapshot = snapshotOf(appConfig({ minSupportedBuild: 5, recommendedBuild: 12 }));
    expect(evaluateClientPolicy(input({ snapshot }))).toEqual({ kind: 'soft-update', bannerVisible: true });
    expect(evaluateClientPolicy(input({ snapshot, softDismissedAt: NOW - 1000 }))).toEqual({ kind: 'soft-update', bannerVisible: false });
    expect(evaluateClientPolicy(input({ snapshot, softDismissedAt: NOW - SOFT_BANNER_INTERVAL_MS }))).toEqual({ kind: 'soft-update', bannerVisible: true });
    expect(evaluateClientPolicy(input({ snapshot: snapshotOf(appConfig({ state: 'SOFT_UPDATE' })) })).kind).toBe('soft-update');
  });

  it('MAINTENANCE overrides SOFT_UPDATE; HARD_UPDATE outranks maintenance', () => {
    const soft = appConfig(
      { state: 'SOFT_UPDATE' },
      { maintenance: { active: true, messageKey: 'maintenance.planned', expectedEnd: '2026-10-13T12:00:00.000Z' } },
    );
    expect(evaluateClientPolicy(input({ snapshot: snapshotOf(soft) }))).toEqual({
      kind: 'maintenance',
      messageKey: 'maintenance.planned',
      expectedEnd: '2026-10-13T12:00:00.000Z',
    });
    expect(evaluateClientPolicy(input({ snapshot: snapshotOf(appConfig({ state: 'MAINTENANCE' })) })).kind).toBe('maintenance');
    expect(evaluateClientPolicy(input({ snapshot: snapshotOf(soft), forced: 'UPDATE_REQUIRED' })).kind).toBe('hard-update');
  });

  it('a 426 / 503-maintenance seen on any call flips the state immediately, with or without a cached policy', () => {
    const forced: readonly [ForcedState, string][] = [
      ['UPDATE_REQUIRED', 'hard-update'],
      ['MAINTENANCE', 'maintenance'],
    ];
    for (const [f, kind] of forced) {
      expect(evaluateClientPolicy(input({ forced: f })).kind).toBe(kind);
      expect(evaluateClientPolicy(input({ forced: f, snapshot: snapshotOf(appConfig()) })).kind).toBe(kind);
    }
  });

  it('blocking states are exactly HARD_UPDATE and MAINTENANCE; escape hatches are legal (both) and deletion (hard only)', () => {
    const hard = evaluateClientPolicy(input({ forced: 'UPDATE_REQUIRED' }));
    const maintenance = evaluateClientPolicy(input({ forced: 'MAINTENANCE' }));
    expect(isBlocking(hard) && isBlocking(maintenance)).toBe(true);
    expect(isBlocking({ kind: 'ok' }) || isBlocking({ kind: 'soft-update', bannerVisible: true })).toBe(false);
    for (const path of ['/legal', '/legal/TERMS/1']) {
      expect(isEscapePath(hard, path)).toBe(true);
      expect(isEscapePath(maintenance, path)).toBe(true);
    }
    expect(isEscapePath(hard, '/account/delete')).toBe(true);
    expect(isEscapePath(maintenance, '/account/delete')).toBe(false);
    for (const path of ['/', '/ride', '/ride/quote', '/drive', '/earn', '/home', '/sign-in', '/legalese'])
      expect(isEscapePath(hard, path) || isEscapePath(maintenance, path), path).toBe(false);
  });

  it('the session guard skips the gated account state only on an escape hatch of a blocking state (SP-08 #21)', () => {
    const hard = evaluateClientPolicy(input({ forced: 'UPDATE_REQUIRED' }));
    const maintenance = evaluateClientPolicy(input({ forced: 'MAINTENANCE' }));
    expect(rendersWithoutAccountState(hard, '/legal')).toBe(true);
    expect(rendersWithoutAccountState(hard, '/account/delete')).toBe(true);
    expect(rendersWithoutAccountState(maintenance, '/legal/TERMS/1')).toBe(true);
    expect(rendersWithoutAccountState(maintenance, '/account/delete')).toBe(false);
    for (const view of [{ kind: 'ok' } as const, { kind: 'soft-update', bannerVisible: true } as const])
      for (const path of ['/legal', '/account/delete', '/ride']) expect(rendersWithoutAccountState(view, path), `${view.kind} ${path}`).toBe(false);
    for (const path of ['/ride', '/drive', '/home'])
      expect(rendersWithoutAccountState(hard, path) || rendersWithoutAccountState(maintenance, path), path).toBe(false);
  });
});

describe('policy fetch cadence and maintenance backoff', () => {
  it('start and retry always fetch; foreground at most once per 15 minutes', () => {
    expect(shouldFetchPolicy('start', NOW, NOW)).toBe(true);
    expect(shouldFetchPolicy('retry', NOW, NOW)).toBe(true);
    expect(shouldFetchPolicy('foreground', null, NOW)).toBe(true);
    expect(shouldFetchPolicy('foreground', NOW - 14 * 60_000, NOW)).toBe(false);
    expect(shouldFetchPolicy('foreground', NOW - 15 * 60_000, NOW)).toBe(true);
  });

  it('maintenance re-checks back off 30 s → 60 s → 120 s → 240 s → 5 min (capped, never faster)', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(maintenanceRetryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    expect(maintenanceRetryDelayMs(-3)).toBe(30_000);
  });
});

describe('cached policy, tuning and presentation switches', () => {
  it('parses only a well-formed v1 cache; anything else counts as "no cached policy"', () => {
    const snapshot = snapshotOf(appConfig());
    expect(parseCachedPolicy(JSON.stringify({ v: 1, savedAt: 1, snapshot, softDismissedAt: null }))?.snapshot).toEqual(snapshot);
    expect(parseCachedPolicy(null)).toBeNull();
    expect(parseCachedPolicy('{not json')).toBeNull();
    expect(parseCachedPolicy(JSON.stringify({ v: 2, savedAt: 1, snapshot, softDismissedAt: null }))).toBeNull();
  });

  it('the cached snapshot never contains the map descriptor or a client token', () => {
    const config = appConfig(
      {},
      { map: { rendererKind: 'maplibre', styleUrl: 'https://tiles.example.test/style.json', attributionCodes: ['OSM_ODBL'], clientToken: 'synthetic-token' } },
    );
    expect(JSON.stringify(snapshotOf(config))).not.toMatch(/synthetic-token|tiles\.example/);
  });

  it('tuning defaults to 300 ms / 3 characters without a policy and follows the server otherwise', () => {
    expect(tuningOf(null)).toEqual(DEFAULT_TUNING);
    expect(DEFAULT_TUNING).toMatchObject({ autocompleteMinChars: 3, autocompleteDebounceMs: 300, liteSlowRequestMs: 4000, liteSuggestAfterSlowRequests: 3 });
    const snapshot = snapshotOf(
      appConfig(
        {},
        {
          geo: { autocompleteMinChars: 5, autocompleteDebounceMs: 450, reverseDebounceMs: 900 },
          lite: { autoSuggestAfterSlowRequests: 4, slowRequestMs: 6000 },
        },
      ),
    );
    expect(tuningOf(snapshot)).toEqual({
      autocompleteMinChars: 5,
      autocompleteDebounceMs: 450,
      reverseDebounceMs: 900,
      liteSlowRequestMs: 6000,
      liteSuggestAfterSlowRequests: 4,
    });
  });

  it('a switch is "disabled" for display only when the server lists it DISABLED', () => {
    const snapshot = snapshotOf(appConfig({}, { switches: [{ key: 'rider.quotes', state: 'DISABLED', messageKey: null }] }));
    expect(switchDisabled(snapshot, 'rider.quotes')).toBe(true);
    expect(switchDisabled(snapshot, 'platform.geo-autocomplete')).toBe(false);
    expect(switchDisabled(null, 'rider.quotes')).toBe(false);
  });
});
