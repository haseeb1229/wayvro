import { describe, expect, it } from 'vitest';
import { accountState, errorBody, IDS, jsonResponse, SYNTHETIC_PHONE, tokens } from '../../__mocks__/fixtures';
import { MemoryStore } from '../../__mocks__/memory-store';
import { STORAGE_KEYS } from '../session/key-value-store';
import { SessionManager } from '../session/session-manager';
import { ApiError } from './errors';
import type { HttpDeps } from './http';
import { createIdempotencyIntentStore } from './idempotency-intents';
import { createRefreshCall, createWayvroClient } from './wayvro-client';

type Handler = (path: string, init: RequestInit) => Response | Promise<Response>;

/** Before the fixture tokens' access expiry (2099-01-01T00:15Z): calls go out with the stored token as issued. */
const BEFORE_EXPIRY = Date.parse('2099-01-01T00:00:00.000Z');
const AFTER_EXPIRY = Date.parse('2099-01-01T00:20:00.000Z');

function harness(handler: Handler, now: number = BEFORE_EXPIRY) {
  const calls: { path: string; init: RequestInit }[] = [];
  const store = new MemoryStore();
  let keyCounter = 0;
  const newKey = () => {
    keyCounter += 1;
    return `idem_key_${String(keyCounter).padStart(16, '0')}`;
  };
  const http: HttpDeps = {
    baseUrl: 'https://api.example.test',
    fetchFn: (async (url: string, init: RequestInit) => {
      const path = url.replace('https://api.example.test', '');
      calls.push({ path, init });
      return handler(path, init);
    }) as typeof fetch,
    newRequestId: () => 'req_synthetic_0001',
    clock: { offsetMs: 0 },
    sleep: () => Promise.resolve(),
    random: () => 0,
    now: () => now,
  };
  const session = new SessionManager({ store, refreshCall: createRefreshCall(http), newIdempotencyKey: newKey });
  const intents = createIdempotencyIntentStore(store, newKey);
  session.onWipe(() => intents.clear());
  const client = createWayvroClient({
    http,
    session,
    intents,
    installationId: 'installation_synthetic_01',
    device: { platform: 'ANDROID', appVersion: '0.0.0' },
    fingerprint: (s) => Promise.resolve(`fp:${s}`),
  });
  const header = (i: number, name: string) => (calls[i]?.init.headers as Record<string, string>)[name];
  return { client, session, store, calls, header };
}

describe('wayvro client', () => {
  it('requests an OTP with installation id, locale and an idempotency key, and validates the response', async () => {
    const h = harness(() =>
      jsonResponse(202, {
        challengeId: IDS.challenge,
        expiresAt: '2026-10-11T10:05:00.000Z',
        resendAvailableAt: '2026-10-11T10:01:00.000Z',
        channel: 'SMS',
        maskedDestination: '+92 3** *** **01',
      }),
    );
    const challenge = await h.client.requestOtp(SYNTHETIC_PHONE, 'ur-Latn');
    expect(challenge.challengeId).toBe(IDS.challenge);
    expect(JSON.parse(h.calls[0]!.init.body as string)).toEqual({
      phone: SYNTHETIC_PHONE,
      purpose: 'SIGN_IN',
      installationId: 'installation_synthetic_01',
      locale: 'ur-Latn',
    });
    expect(h.header(0, 'idempotency-key')).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(h.header(0, 'authorization')).toBeUndefined();
  });

  it('verifying a code persists the session before returning and never returns tokens to the caller', async () => {
    const h = harness(() => jsonResponse(201, { ...tokens(1), isNewAccount: true, requiredActions: ['ACCEPT_POLICIES'] }));
    await h.session.load();
    const result = await h.client.verifyOtp(IDS.challenge, '123456');
    expect(result).toEqual({ isNewAccount: true, requiredActions: ['ACCEPT_POLICIES'] });
    expect(h.store.data.get(STORAGE_KEYS.session)).toContain(tokens(1).refreshToken);
    expect(h.session.getState()).toEqual({ status: 'signed-in', sessionId: IDS.session });
    expect(JSON.parse(h.calls[0]!.init.body as string)).toMatchObject({ device: { platform: 'ANDROID', appVersion: '0.0.0' } });
  });

  it('on 401 refreshes once (single-flight) and retries each call once with the new token', async () => {
    let refreshes = 0;
    const h = harness((path, init) => {
      const auth = (init.headers as Record<string, string>)['authorization'];
      if (path === '/v1/auth/token-refreshes') {
        refreshes += 1;
        return jsonResponse(200, tokens(2));
      }
      return auth === `Bearer ${tokens(2).accessToken}` ? jsonResponse(200, accountState()) : jsonResponse(401, errorBody('WAYVRO_E_UNAUTHENTICATED'));
    });
    await h.session.establish(tokens(1));
    const results = await Promise.all([h.client.accountState(), h.client.accountState(), h.client.accountState()]);
    expect(results).toHaveLength(3);
    expect(refreshes).toBe(1);
    const refreshCall = h.calls.find((c) => c.path === '/v1/auth/token-refreshes')!;
    expect(JSON.parse(refreshCall.init.body as string)).toEqual({ refreshToken: tokens(1).refreshToken });
  });

  it('SP02-F1: a token already expired at the first call of the process is refreshed BEFORE the request (no doomed 401)', async () => {
    const seen: string[] = [];
    const h = harness((path, init) => {
      const auth = (init.headers as Record<string, string>)['authorization'];
      seen.push(`${path} ${auth ?? '-'}`);
      if (path === '/v1/auth/token-refreshes') return jsonResponse(200, tokens(2));
      return auth === `Bearer ${tokens(2).accessToken}` ? jsonResponse(200, accountState()) : jsonResponse(401, errorBody('WAYVRO_E_UNAUTHENTICATED'));
    }, AFTER_EXPIRY);
    await h.session.establish(tokens(1));
    await h.client.accountState();
    expect(seen).toEqual(['/v1/auth/token-refreshes -', `/v1/account/state Bearer ${tokens(2).accessToken}`]);
  });

  it('SP02-F1: the early refresh happens at most once per process (a wrong clock costs one spare refresh, then the 401 path)', async () => {
    let refreshes = 0;
    const h = harness((path) => {
      if (path === '/v1/auth/token-refreshes') {
        refreshes += 1;
        return jsonResponse(200, tokens(refreshes + 1));
      }
      return jsonResponse(200, accountState());
    }, AFTER_EXPIRY);
    await h.session.establish(tokens(1));
    await h.client.accountState();
    await h.client.accountState();
    await h.client.accountState();
    expect(refreshes).toBe(1);
  });

  it('SP02-F1: a token that has not expired is sent as is (no refresh)', async () => {
    let refreshes = 0;
    const h = harness((path) => {
      if (path === '/v1/auth/token-refreshes') refreshes += 1;
      return jsonResponse(200, accountState());
    });
    await h.session.establish(tokens(1));
    await h.client.accountState();
    expect(refreshes).toBe(0);
  });

  it('SP02-F1: a refused early refresh ends the session exactly like a refused refresh after a 401', async () => {
    const h = harness(
      (path) => (path === '/v1/auth/token-refreshes' ? jsonResponse(401, errorBody('WAYVRO_E_UNAUTHENTICATED')) : jsonResponse(200, accountState())),
      AFTER_EXPIRY,
    );
    await h.session.establish(tokens(1));
    await expect(h.client.accountState()).rejects.toMatchObject({ kind: 'session-expired' });
    expect(h.session.getState()).toEqual({ status: 'signed-out', reason: 'expired' });
    expect(h.store.data.has(STORAGE_KEYS.session)).toBe(false);
  });

  it('a second 401 after a successful refresh ends the session', async () => {
    const h = harness((path) =>
      path === '/v1/auth/token-refreshes' ? jsonResponse(200, tokens(2)) : jsonResponse(401, errorBody('WAYVRO_E_UNAUTHENTICATED')),
    );
    await h.session.establish(tokens(1));
    await expect(h.client.accountState()).rejects.toMatchObject({ kind: 'session-expired' });
    expect(h.session.getState()).toEqual({ status: 'signed-out', reason: 'expired' });
    expect(h.store.data.has(STORAGE_KEYS.session)).toBe(false);
  });

  it('a refused refresh ends the session and wipes tokens and idempotency intents', async () => {
    const h = harness((path) =>
      path === '/v1/auth/token-refreshes' ? jsonResponse(401, errorBody('WAYVRO_E_UNAUTHENTICATED')) : jsonResponse(401, errorBody('WAYVRO_E_UNAUTHENTICATED')),
    );
    await h.session.establish(tokens(1));
    await h.store.setItem(STORAGE_KEYS.idempotencyIntents, '{}');
    await expect(h.client.sessions()).rejects.toMatchObject({ kind: 'session-expired' });
    expect(h.store.data.has(STORAGE_KEYS.session)).toBe(false);
    expect(h.store.data.has(STORAGE_KEYS.idempotencyIntents)).toBe(false);
  });

  it('a mutation whose response was lost is retried with the SAME idempotency key, also by a later user retry', async () => {
    let attempts = 0;
    const h = harness(() => {
      attempts += 1;
      if (attempts <= 3) throw new TypeError('Network request failed');
      return jsonResponse(201, {
        id: IDS.consent,
        policyKey: 'TERMS',
        version: 1,
        locale: 'en',
        action: 'ACCEPTED',
        recordedAt: '2026-10-11T10:00:00.000Z',
        requiredActions: [],
      });
    });
    await h.session.establish(tokens(1));
    const request = { policyKey: 'TERMS', version: 1, locale: 'en', contentSha256: 'a'.repeat(64), action: 'ACCEPTED' } as const;
    await expect(h.client.recordConsent(request)).rejects.toMatchObject({ kind: 'offline' });
    await h.client.recordConsent(request);
    const keys = new Set(h.calls.map((_, i) => h.header(i, 'idempotency-key')));
    expect(h.calls).toHaveLength(4);
    expect(keys.size).toBe(1);
    // Settled after success: the next acceptance gets a fresh key.
    expect(h.store.data.has(STORAGE_KEYS.idempotencyIntents)).toBe(false);
  });

  it('a definitive error settles the intent so a corrected request gets a new key', async () => {
    const h = harness(() => jsonResponse(401, errorBody('WAYVRO_E_OTP_INVALID_OR_EXPIRED')));
    await h.session.load();
    await expect(h.client.verifyOtp(IDS.challenge, '111111')).rejects.toMatchObject({ kind: 'validation', code: 'WAYVRO_E_OTP_INVALID_OR_EXPIRED' });
    await expect(h.client.verifyOtp(IDS.challenge, '222222')).rejects.toBeInstanceOf(ApiError);
    expect(h.header(0, 'idempotency-key')).not.toBe(h.header(1, 'idempotency-key'));
    // A wrong OTP on the public route is not a session expiry.
    expect(h.session.getState()).toEqual({ status: 'signed-out', reason: 'none' });
  });

  it('sign-out wipes local state even when the server cannot be reached', async () => {
    const h = harness(() => {
      throw new TypeError('offline');
    });
    await h.session.establish(tokens(1));
    const result = await h.client.signOut();
    expect(result).toEqual({ serverConfirmed: false });
    expect(h.session.getState()).toEqual({ status: 'signed-out', reason: 'signed-out' });
    expect(h.store.data.has(STORAGE_KEYS.session)).toBe(false);
  });

  it('sign-out reports server confirmation on 204', async () => {
    const h = harness(() => jsonResponse(204, undefined));
    await h.session.establish(tokens(1));
    expect(await h.client.signOut()).toEqual({ serverConfirmed: true });
    expect(h.calls[0]!.path).toBe('/v1/auth/sessions/current');
    expect(h.calls[0]!.init.method).toBe('DELETE');
  });

  it('authenticated calls without a session fail as session-expired without a request', async () => {
    const h = harness(() => jsonResponse(200, accountState()));
    await h.session.load();
    await expect(h.client.accountState()).rejects.toMatchObject({ kind: 'session-expired' });
    expect(h.calls).toHaveLength(0);
  });

  it('surfaces STEP_UP_REQUIRED for revoking all other sessions', async () => {
    const h = harness(() => jsonResponse(403, errorBody('WAYVRO_E_STEP_UP_REQUIRED')));
    await h.session.establish(tokens(1));
    await expect(h.client.revokeOtherSessions()).rejects.toMatchObject({ kind: 'step-up-required' });
    expect(JSON.parse(h.calls[0]!.init.body as string)).toEqual({ scope: 'ALL_OTHERS' });
  });

  it('fetches public legal content without a bearer token, in the requested locale', async () => {
    const h = harness(() => jsonResponse(200, { policies: [] }));
    await h.client.policies('ur');
    expect(h.calls[0]!.path).toBe('/v1/legal/policies?locale=ur');
    expect(h.header(0, 'authorization')).toBeUndefined();
  });
});
