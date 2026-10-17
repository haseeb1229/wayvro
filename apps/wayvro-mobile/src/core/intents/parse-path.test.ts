import { describe, expect, it } from 'vitest';
import { P3_IDS } from '../../__mocks__/p3-fixtures';
import { DEFERRED_INTENT_TTL_MS, DeferredIntents, systemIntents } from './deferred';
import { redirectSystemPath } from './native-intent';
import { MAX_SYSTEM_PATH_LENGTH, parseWayvroPath } from './parse-path';

describe('parseWayvroPath (bounded allowlist; never decodes)', () => {
  it('maps every allowlisted path to its intent', () => {
    expect(parseWayvroPath('/ride')).toEqual({ kind: 'intent', intent: { kind: 'OPEN_RIDER_HOME' } });
    expect(parseWayvroPath(`/ride/quote?group=${P3_IDS.group}`)).toEqual({ kind: 'intent', intent: { kind: 'OPEN_QUOTE', quoteGroupId: P3_IDS.group } });
    expect(parseWayvroPath('/drive/')).toEqual({ kind: 'intent', intent: { kind: 'OPEN_DRIVER_HOME' } });
    expect(parseWayvroPath('/earn')).toEqual({ kind: 'intent', intent: { kind: 'OPEN_DRIVER_APPLICATION' } });
    expect(parseWayvroPath('/earn/compliance')).toEqual({ kind: 'intent', intent: { kind: 'OPEN_DRIVER_COMPLIANCE' } });
    expect(parseWayvroPath(`/earn/renewal?document=${P3_IDS.document}`)).toEqual({
      kind: 'intent',
      intent: { kind: 'OPEN_DOCUMENT_RENEWAL', documentId: P3_IDS.document },
    });
    expect(parseWayvroPath(`/account/appeal?restriction=${P3_IDS.restriction}`)).toEqual({
      kind: 'intent',
      intent: { kind: 'OPEN_RESTRICTION_APPEAL', restrictionId: P3_IDS.restriction },
    });
    expect(parseWayvroPath('/account')).toEqual({ kind: 'intent', intent: { kind: 'OPEN_ACCOUNT_SECURITY' } });
    expect(parseWayvroPath('/legal')).toEqual({ kind: 'intent', intent: { kind: 'OPEN_LEGAL' } });
    expect(parseWayvroPath('/legal/PRIVACY/3')).toEqual({ kind: 'intent', intent: { kind: 'OPEN_LEGAL', policyKey: 'PRIVACY', version: '3' } });
  });

  it('ignores a scheme/authority prefix and a fragment; the root is a plain start', () => {
    expect(parseWayvroPath('exp+wayvro://expo-development-client/?url=http')).toEqual({ kind: 'rejected', reason: 'NOT_ALLOWED' });
    expect(parseWayvroPath('exp+wayvro://expo-development-client/')).toEqual({ kind: 'none' });
    expect(parseWayvroPath('wayvro://host/ride#top')).toEqual({ kind: 'intent', intent: { kind: 'OPEN_RIDER_HOME' } });
    expect(parseWayvroPath('/')).toEqual({ kind: 'none' });
    expect(parseWayvroPath('')).toEqual({ kind: 'none' });
  });

  it('rejects anything outside the allowlist: unknown paths, extra/duplicate/missing params, traversal, non-uuid ids', () => {
    const rejected = [
      '/home',
      '/profile',
      '/earn/capture',
      '/drive/health?x=1',
      '/ride?group=1',
      `/ride/quote?group=${P3_IDS.group}&group=${P3_IDS.group}`,
      `/ride/quote?group=${P3_IDS.group}&admin=1`,
      '/ride/quote',
      '/ride/quote?group=not-a-uuid',
      '/ride/../drive',
      '//ride',
      '/legal/TERMS/0',
      '/legal/terms/1',
      '/ride/quote?group',
      '/ride/quote?=x',
    ];
    for (const path of rejected) expect(parseWayvroPath(path).kind, path).toBe('rejected');
  });

  it('caps the input at 512 characters BEFORE anything else (decode-uri-component gate)', () => {
    const long = `/ride/quote?group=${P3_IDS.group}`.padEnd(MAX_SYSTEM_PATH_LENGTH + 1, 'a');
    expect(parseWayvroPath(long)).toEqual({ kind: 'rejected', reason: 'TOO_LONG' });
    expect(parseWayvroPath('%'.repeat(100_000))).toEqual({ kind: 'rejected', reason: 'TOO_LONG' });
  });

  it('fuzz: malformed percent-encoding and hostile input is rejected in bounded time and never throws', () => {
    const seeds = [
      '%',
      '%%',
      '%E0%A4%A',
      '%uD800',
      '%C0%AF',
      '%25%32%35',
      '%F0%9F%98',
      '%ZZ',
      '%%30%30',
      '+%2B',
      '\u0000',
      '\uD800',
      'é',
      '<script>',
      '../',
      '//',
      '?',
      '&',
      '=',
    ];
    let state = 1234567;
    const next = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state;
    };
    const started = Date.now();
    for (let i = 0; i < 5000; i += 1) {
      let s = next() % 2 === 0 ? '/ride/quote?group=' : '/';
      const parts = 1 + (next() % 40);
      for (let j = 0; j < parts; j += 1) s += seeds[next() % seeds.length] ?? '';
      const result = parseWayvroPath(s);
      expect(result.kind === 'intent', s).toBe(false);
    }
    // 5,000 hostile inputs: a linear parser finishes far inside this bound on any CI machine.
    expect(Date.now() - started).toBeLessThan(5000);
    expect(parseWayvroPath(`/ride/quote?group=${P3_IDS.group}%00`).kind).toBe('rejected');
  });
});

describe('deferred intents (memory only, one-shot, 10-minute TTL)', () => {
  it('replays once and drops intents older than 10 minutes', () => {
    const held = new DeferredIntents();
    held.hold({ kind: 'OPEN_RIDER_HOME' }, 0);
    expect(held.take(DEFERRED_INTENT_TTL_MS)).toEqual({ kind: 'OPEN_RIDER_HOME' });
    expect(held.take(DEFERRED_INTENT_TTL_MS)).toBeNull();
    held.hold({ kind: 'OPEN_RIDER_HOME' }, 0);
    expect(held.take(DEFERRED_INTENT_TTL_MS + 1)).toBeNull();
    held.hold({ kind: 'OPEN_LEGAL' }, 0);
    held.clear();
    expect(held.take(1)).toBeNull();
  });
});

describe('+native-intent redirectSystemPath', () => {
  it('always hands the router the entry route and holds a recognised intent for the session layer', () => {
    systemIntents.clear();
    expect(redirectSystemPath({ path: '/earn/compliance', initial: true }, 1000)).toBe('/');
    expect(systemIntents.take(1000)).toEqual({ kind: 'OPEN_DRIVER_COMPLIANCE' });
    expect(redirectSystemPath({ path: '/totally/unknown', initial: false }, 1000)).toBe('/');
    expect(redirectSystemPath({ path: '%'.repeat(600), initial: false }, 1000)).toBe('/');
    expect(systemIntents.take(1000)).toBeNull();
  });
});
