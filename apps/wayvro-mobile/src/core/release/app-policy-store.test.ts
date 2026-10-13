import type { AppConfig } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../__mocks__/memory-store';
import { appConfig } from '../../__mocks__/p3-fixtures';
import { ApiError } from '../api/errors';
import { STORAGE_KEYS } from '../session/key-value-store';
import { AppPolicyStore } from './app-policy-store';

function setup(fetchConfig: () => Promise<AppConfig>, build: number | null = 10, store = new MemoryStore()) {
  let now = 1_000_000;
  const policy = new AppPolicyStore({ fetchConfig, store, build, now: () => now });
  return {
    policy,
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('AppPolicyStore (gate state; installation-scoped cache)', () => {
  it('starts OK, fetches, caches the policy in wayvro.app-policy.v1 and survives a restart from the cache', async () => {
    const { policy, store } = setup(() => Promise.resolve(appConfig({ state: 'HARD_UPDATE', reasonClass: 'SECURITY' })));
    expect(policy.getState().view.kind).toBe('ok');
    await policy.refresh('start');
    expect(policy.getState().view).toMatchObject({ kind: 'hard-update', reasonClass: 'SECURITY' });
    expect(store.data.has(STORAGE_KEYS.appPolicy)).toBe(true);

    const restarted = setup(() => Promise.reject(new ApiError('offline', { transient: true })), 10, store).policy;
    await restarted.load();
    expect(restarted.getState().view.kind).toBe('hard-update');
    await restarted.refresh('start');
    expect(restarted.getState().view.kind).toBe('hard-update');
  });

  it('offline on the first start with no cache ⇒ the app proceeds (OK)', async () => {
    const { policy } = setup(() => Promise.reject(new ApiError('offline', { transient: true })));
    await policy.load();
    await policy.refresh('start');
    expect(policy.getState().view.kind).toBe('ok');
  });

  it('a 426 or a maintenance 503 on ANY call flips the gate; a later successful config fetch reflects server truth again', async () => {
    let config = appConfig();
    const { policy } = setup(() => Promise.resolve(config));
    await policy.refresh('start');
    policy.report(new ApiError('update-required', { status: 426 }));
    expect(policy.getState().view.kind).toBe('hard-update');
    policy.report(new ApiError('maintenance', { status: 503 }));
    expect(policy.getState().view.kind).toBe('hard-update');
    await policy.refresh('retry');
    expect(policy.getState().view.kind).toBe('ok');
    policy.report(new ApiError('maintenance', { status: 503 }));
    expect(policy.getState().view.kind).toBe('maintenance');
    policy.report(null);
    policy.report(new ApiError('offline'));
    expect(policy.getState().view.kind).toBe('maintenance');
    config = appConfig({}, { maintenance: { active: false, messageKey: null, expectedEnd: null } });
    await policy.refresh('retry');
    expect(policy.getState().view.kind).toBe('ok');
  });

  it('the config call refused with 426 is honoured too', async () => {
    const { policy } = setup(() => Promise.reject(new ApiError('update-required', { status: 426 })));
    await policy.refresh('start');
    expect(policy.getState().view.kind).toBe('hard-update');
  });

  it('foreground refetches are throttled to once per 15 minutes; maintenance retries count up for the backoff', async () => {
    let calls = 0;
    const { policy, advance } = setup(() => {
      calls += 1;
      return Promise.resolve(appConfig({ state: 'MAINTENANCE' }));
    });
    await policy.refresh('start');
    await policy.refresh('foreground');
    expect(calls).toBe(1);
    advance(15 * 60_000);
    await policy.refresh('foreground');
    expect(calls).toBe(2);
    expect(policy.getState().maintenanceAttempt).toBe(0);
    await policy.refresh('retry');
    await policy.refresh('retry');
    expect(policy.getState().maintenanceAttempt).toBe(2);
  });

  it('a soft-update dismissal hides the banner for 24 h and is remembered', async () => {
    const { policy, store, advance } = setup(() => Promise.resolve(appConfig({ state: 'SOFT_UPDATE' })));
    await policy.refresh('start');
    expect(policy.getState().view).toEqual({ kind: 'soft-update', bannerVisible: true });
    policy.dismissSoftUpdate();
    expect(policy.getState().view).toEqual({ kind: 'soft-update', bannerVisible: false });
    await Promise.resolve();
    expect(JSON.parse(store.data.get(STORAGE_KEYS.appPolicy) ?? '{}')).toMatchObject({ softDismissedAt: 1_000_000 });
    advance(24 * 60 * 60 * 1000);
    await policy.refresh('retry');
    expect(policy.getState().view).toEqual({ kind: 'soft-update', bannerVisible: true });
  });

  it('a build below the server minimum blocks even when the server state is OK', async () => {
    const { policy } = setup(() => Promise.resolve(appConfig({ minSupportedBuild: 20 })), 19);
    await policy.refresh('start');
    expect(policy.getState().view).toMatchObject({ kind: 'hard-update', reasonClass: 'MINIMUM_BUILD' });
  });

  it('exposes the server tuning for search and Lite', async () => {
    const { policy } = setup(() => Promise.resolve(appConfig({}, { geo: { autocompleteMinChars: 4, autocompleteDebounceMs: 350, reverseDebounceMs: 600 } })));
    await policy.refresh('start');
    expect(policy.getState().tuning).toMatchObject({ autocompleteMinChars: 4, autocompleteDebounceMs: 350 });
  });
});
