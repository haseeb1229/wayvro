import type { AutocompleteResult } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { autocompleteResult } from '../../../__mocks__/p3-fixtures';
import { ApiError } from '../../../core/api/errors';
import { RequestCancelledError } from '../../../core/api/http';
import { SearchController, searchFailure, type SearchDeps } from './search-controller';
import { resultCountKey, searchFieldParam, suggestionLabel } from './search-view';

interface Ctx {
  readonly minChars: number;
  readonly debounceMs: number;
  readonly session: string;
}

interface Call {
  readonly q: string;
  readonly mode: 'SUGGEST' | 'GEOCODE';
  readonly signal: AbortSignal;
  readonly context: Ctx;
  resolve: (r: AutocompleteResult) => void;
  reject: (e: unknown) => void;
}

const STANDARD: Ctx = { minChars: 3, debounceMs: 300, session: 'session-1' };

function harness() {
  const calls: Call[] = [];
  const timers = new Map<number, { run: () => void; ms: number }>();
  let id = 0;
  const deps: SearchDeps<Ctx> = {
    autocomplete: (q, mode, signal, context) =>
      new Promise((resolve, reject) => {
        calls.push({ q, mode, signal, context, resolve, reject });
        signal.addEventListener('abort', () => {
          reject(new RequestCancelledError());
        });
      }),
    setTimer: (run, ms) => {
      id += 1;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
  };
  const controller = new SearchController(deps);
  const fire = (): void => {
    const pending = [...timers.values()];
    timers.clear();
    for (const timer of pending) timer.run();
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { controller, calls, timers, fire, flush };
}

describe('Where-to search controller (debounce, min chars, one request in flight)', () => {
  it('waits for the minimum length and the debounce before asking the server, with the keystroke context', async () => {
    const h = harness();
    h.controller.setQuery('Li', STANDARD);
    expect(h.controller.getState().status).toBe('too-short');
    expect(h.timers.size).toBe(0);
    h.controller.setQuery('Lib', STANDARD);
    expect(h.controller.getState().status).toBe('waiting');
    expect([...h.timers.values()][0]?.ms).toBe(300);
    expect(h.calls).toHaveLength(0);
    h.fire();
    expect(h.controller.getState().status).toBe('loading');
    expect(h.calls[0]?.context).toBe(STANDARD);
    h.calls[0]?.resolve(autocompleteResult(2));
    await h.flush();
    expect(h.controller.getState()).toMatchObject({ status: 'results', stale: false });
    expect(h.controller.getState().suggestions).toHaveLength(2);
    h.controller.setQuery('  ', STANDARD);
    expect(h.controller.getState().status).toBe('idle');
  });

  it('typing again cancels the pending timer and aborts the in-flight request; a late answer is dropped', async () => {
    const h = harness();
    h.controller.setQuery('Libe', STANDARD);
    h.fire();
    const first = h.calls[0];
    h.controller.setQuery('Liberty', STANDARD);
    expect(first?.signal.aborted).toBe(true);
    h.fire();
    expect(h.calls).toHaveLength(2);
    first?.resolve(autocompleteResult(5));
    h.calls[1]?.resolve(autocompleteResult(1));
    await h.flush();
    expect(h.controller.getState().suggestions).toHaveLength(1);
    expect(h.calls.filter((c) => !c.signal.aborted)).toHaveLength(1);
  });

  it('empty, stale-served, offline, degraded and error states', async () => {
    const h = harness();
    const runWith = async (settle: (c: Call) => void) => {
      h.controller.setQuery(`Gulberg ${String(h.calls.length)}`, STANDARD);
      h.fire();
      const call = h.calls[h.calls.length - 1];
      if (call) settle(call);
      await h.flush();
      return h.controller.getState();
    };
    expect(
      (
        await runWith((c) => {
          c.resolve(autocompleteResult(0));
        })
      ).status,
    ).toBe('empty');
    expect(
      await runWith((c) => {
        c.resolve(autocompleteResult(2, 'STALE_SERVED'));
      }),
    ).toMatchObject({ status: 'results', stale: true });
    const failures: [ApiError, string][] = [
      [new ApiError('offline', { transient: true }), 'offline'],
      [new ApiError('rate-limited', { status: 429 }), 'degraded'],
      [new ApiError('unavailable', { status: 503, reasonCodes: ['GEO_BUDGET_EXHAUSTED'] }), 'degraded'],
      [new ApiError('unavailable', { status: 503, reasonCodes: ['GEO_PROVIDER_UNAVAILABLE'] }), 'degraded'],
      [new ApiError('unavailable', { status: 503 }), 'error'],
      [new ApiError('feature-disabled', { status: 404 }), 'degraded'],
    ];
    for (const [error, status] of failures) {
      const state = await runWith((c) => {
        c.reject(error);
      });
      expect(state.status, status).toBe(status);
    }
  });

  it('retry re-runs the same query; "type the full address" switches to GEOCODE immediately', async () => {
    const h = harness();
    h.controller.setQuery('Model Town', STANDARD);
    h.fire();
    h.calls[0]?.reject(new ApiError('offline', { transient: true }));
    await h.flush();
    h.controller.retry(STANDARD);
    expect(h.calls[1]).toMatchObject({ q: 'Model Town', mode: 'SUGGEST' });
    h.controller.searchFullAddress(STANDARD);
    expect(h.calls[1]?.signal.aborted).toBe(true);
    expect(h.calls[2]).toMatchObject({ q: 'Model Town', mode: 'GEOCODE' });
    h.controller.retry(STANDARD);
    expect(h.calls).toHaveLength(3);
  });

  it('Lite tuning (500 ms / 4 characters) comes with the context', () => {
    const h = harness();
    const lite: Ctx = { minChars: 4, debounceMs: 500, session: 'session-1' };
    h.controller.setQuery('Lib', lite);
    expect(h.controller.getState().status).toBe('too-short');
    h.controller.setQuery('Libe', lite);
    expect([...h.timers.values()][0]?.ms).toBe(500);
  });

  it('dispose stops everything (screen blur / sign-out)', () => {
    const h = harness();
    h.controller.setQuery('Liberty', STANDARD);
    h.fire();
    h.controller.dispose();
    expect(h.calls[0]?.signal.aborted).toBe(true);
    expect(h.timers.size).toBe(0);
  });

  it('maps failures without leaking server text', () => {
    expect(searchFailure(new Error('raw'))).toBe('error');
    expect(searchFailure(new ApiError('offline'))).toBe('offline');
  });
});

describe('search view helpers', () => {
  it('focuses the drop-off unless the pickup is asked for; one spoken sentence per row', () => {
    expect(searchFieldParam('pickup')).toBe('pickup');
    expect(searchFieldParam('dropoff')).toBe('dropoff');
    expect(searchFieldParam(undefined)).toBe('dropoff');
    expect(searchFieldParam(['pickup'])).toBe('dropoff');
    expect(suggestionLabel('Liberty Market', 'Gulberg III')).toBe('Liberty Market, Gulberg III');
    expect(suggestionLabel('Liberty Market', null)).toBe('Liberty Market');
  });
});

describe('results-count announcement', () => {
  it('uses the singular string for exactly one result and the counted string otherwise', () => {
    expect(resultCountKey(1)).toBe('rider.search.countOne');
    expect(resultCountKey(0)).toBe('rider.search.count');
    expect(resultCountKey(2)).toBe('rider.search.count');
    expect(resultCountKey(8)).toBe('rider.search.count');
  });
});
