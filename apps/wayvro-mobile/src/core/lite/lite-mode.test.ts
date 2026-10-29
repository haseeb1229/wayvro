import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../__mocks__/memory-store';
import { STORAGE_KEYS } from '../session/key-value-store';
import { ACCOUNT_STALE_MS, isStale, LITE_WINDOW, LiteModeStore, pushSample, quoteDetail, searchTuning, shouldSuggestLite, slowSample } from './lite-mode';

const thresholds = { slowRequestMs: 4000, suggestAfterSlowRequests: 3 };

describe('UNIT-LITE timing heuristic (L08)', () => {
  it('a sample is slow when the response took longer than the threshold or the app-side timeout fired', () => {
    expect(slowSample({ durationMs: 4001, outcome: 'response' }, 4000)).toBe(true);
    expect(slowSample({ durationMs: 4000, outcome: 'response' }, 4000)).toBe(false);
    expect(slowSample({ durationMs: 10, outcome: 'timeout' }, 4000)).toBe(true);
  });

  it('cancelled requests and instant network failures (offline) are not samples', () => {
    expect(slowSample({ durationMs: 9000, outcome: 'cancelled' }, 4000)).toBeNull();
    expect(slowSample({ durationMs: 9000, outcome: 'network' }, 4000)).toBeNull();
  });

  it('suggests Lite after 3 of the last 5 calls were slow, and only the last 5 count', () => {
    let window: readonly boolean[] = [];
    for (const slow of [true, false, true, false]) window = pushSample(window, slow);
    expect(shouldSuggestLite(window, 3)).toBe(false);
    window = pushSample(window, true);
    expect(window).toHaveLength(LITE_WINDOW);
    expect(shouldSuggestLite(window, 3)).toBe(true);
    for (const slow of [false, false, false]) window = pushSample(window, slow);
    expect(window).toHaveLength(LITE_WINDOW);
    expect(shouldSuggestLite(window, 3)).toBe(false);
  });

  it('the threshold comes from the server config', () => {
    expect(shouldSuggestLite([true, true, true, false, false], 4)).toBe(false);
    expect(shouldSuggestLite([true, true, true, true, false], 4)).toBe(true);
  });
});

describe('UNIT-LITE behaviour switches', () => {
  it('Lite asks quotes for detail=lite (no polyline)', () => {
    expect(quoteDetail(true)).toBe('lite');
    expect(quoteDetail(false)).toBe('full');
  });

  it('Lite searches later and with more characters (500 ms / 4) but never lighter than the server asks', () => {
    expect(searchTuning(false, { minChars: 3, debounceMs: 300 })).toEqual({ minChars: 3, debounceMs: 300 });
    expect(searchTuning(true, { minChars: 3, debounceMs: 300 })).toEqual({ minChars: 4, debounceMs: 500 });
    expect(searchTuning(true, { minChars: 6, debounceMs: 800 })).toEqual({ minChars: 6, debounceMs: 800 });
  });

  it('stale indicator: account data older than 5 minutes shows its age', () => {
    expect(isStale(0, ACCOUNT_STALE_MS, ACCOUNT_STALE_MS)).toBe(false);
    expect(isStale(0, ACCOUNT_STALE_MS + 1, ACCOUNT_STALE_MS)).toBe(true);
  });
});

describe('LiteModeStore', () => {
  it('suggests (never enables) after slow samples, stops suggesting once dismissed', () => {
    const lite = new LiteModeStore(new MemoryStore(), () => thresholds);
    for (let i = 0; i < 3; i += 1) lite.record({ durationMs: 5000, outcome: 'response' });
    expect(lite.getState()).toEqual({ enabled: false, suggested: true });
    lite.dismissSuggestion();
    lite.record({ durationMs: 5000, outcome: 'response' });
    expect(lite.getState()).toEqual({ enabled: false, suggested: false });
  });

  it('persists the manual choice in wayvro.lite-mode.v1 and restores it on the next start', async () => {
    const store = new MemoryStore();
    const lite = new LiteModeStore(store, () => thresholds);
    expect(await lite.setEnabled(true)).toBe(true);
    expect(JSON.parse(store.data.get(STORAGE_KEYS.liteMode) ?? 'null')).toEqual({ v: 1, enabled: true });
    const restarted = new LiteModeStore(store, () => thresholds);
    await restarted.load();
    expect(restarted.getState().enabled).toBe(true);
  });

  it('unreadable or foreign data means Lite off; a failed write still applies in memory and reports false', async () => {
    const store = new MemoryStore();
    store.data.set(STORAGE_KEYS.liteMode, '{broken');
    const lite = new LiteModeStore(store, () => thresholds);
    await lite.load();
    expect(lite.getState().enabled).toBe(false);
    const failing = new LiteModeStore(
      { getItem: () => Promise.reject(new Error('x')), setItem: () => Promise.reject(new Error('x')), deleteItem: () => Promise.resolve() },
      () => thresholds,
    );
    await failing.load();
    expect(await failing.setEnabled(true)).toBe(false);
    expect(failing.getState().enabled).toBe(true);
  });
});
