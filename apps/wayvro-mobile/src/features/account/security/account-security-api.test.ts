import { describe, expect, it } from 'vitest';
import { errorBody, jsonResponse, tokens } from '../../../__mocks__/fixtures';
import { MemoryStore } from '../../../__mocks__/memory-store';
import type { HttpDeps } from '../../../core/api/http';
import { createIdempotencyIntentStore } from '../../../core/api/idempotency-intents';
import { createRefreshCall, createWayvroClient } from '../../../core/api/wayvro-client';
import { STORAGE_KEYS } from '../../../core/session/key-value-store';
import { SessionManager } from '../../../core/session/session-manager';
import { createAccountSecurityApi } from './account-security-api';

/** Synthetic ids, numbers and tokens only. */
const CHALLENGE = '0190d000-0000-7000-8000-000000000011';
const CHANGE = '0190d000-0000-7000-8000-000000000012';
const REVIEW = '0190d000-0000-7000-8000-000000000013';
const DELETION = '0190d000-0000-7000-8000-000000000014';
const challenge = {
  challengeId: CHALLENGE,
  expiresAt: '2026-10-11T10:05:00.000Z',
  resendAvailableAt: '2026-10-11T10:01:00.000Z',
  channel: 'SMS',
  maskedDestination: '+92 3** *** **01',
};

type Handler = (path: string, init: RequestInit) => Response | Promise<Response>;

async function harness(handler: Handler) {
  const calls: { path: string; init: RequestInit }[] = [];
  const store = new MemoryStore();
  let n = 0;
  const newKey = () => `idem_key_${String(++n).padStart(16, '0')}`;
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
  };
  const session = new SessionManager({ store, refreshCall: createRefreshCall(http), newIdempotencyKey: newKey });
  const intents = createIdempotencyIntentStore(store, newKey);
  const wiped: string[] = [];
  session.onWipe(async () => {
    await intents.clear();
    wiped.push('intents');
  });
  await session.establish(tokens(1));
  const client = createWayvroClient({
    http,
    session,
    intents,
    installationId: 'installation_synthetic_01',
    device: { platform: 'ANDROID', appVersion: '0.0.0' },
    fingerprint: (s) => Promise.resolve(`fp:${s}`),
  });
  const header = (i: number, name: string) => (calls[i]?.init.headers as Record<string, string>)[name];
  const body = (i: number): unknown => {
    const raw = calls[i]?.init.body;
    return typeof raw === 'string' ? JSON.parse(raw) : undefined;
  };
  return { api: createAccountSecurityApi(client.session), calls, header, body, session, store, wiped };
}

describe('account-security API on the contract schemas', () => {
  it('step-up: code request then verification with the code only', async () => {
    const h = await harness((path) =>
      path.endsWith('/verifications') ? jsonResponse(200, { stepUpExpiresAt: '2026-10-11T10:10:00.000Z' }) : jsonResponse(202, challenge),
    );
    expect((await h.api.startStepUp()).maskedDestination).toBe('+92 3** *** **01');
    expect(h.calls[0]?.path).toBe('/v1/account/step-ups');
    expect((await h.api.verifyStepUp(CHALLENGE, '123456')).stepUpExpiresAt).toBe('2026-10-11T10:10:00.000Z');
    expect(h.calls[1]?.path).toBe(`/v1/account/step-ups/${CHALLENGE}/verifications`);
    expect(h.body(1)).toEqual({ code: '123456' });
  });

  it('a phone change refused with "step-up required" is retried with a NEW idempotency key', async () => {
    let attempt = 0;
    const h = await harness(() => {
      attempt += 1;
      if (attempt === 1) return jsonResponse(403, errorBody('WAYVRO_E_STEP_UP_REQUIRED'));
      return jsonResponse(201, {
        phoneChange: {
          id: CHANGE,
          kind: 'SELF_SERVICE',
          status: 'CURRENT_PHONE_VERIFIED',
          maskedNewPhone: '+92 3** *** **02',
          cooldownUntil: null,
          createdAt: '2026-10-11T10:00:00.000Z',
        },
        challenge,
      });
    });
    await expect(h.api.startPhoneChange('+923990000002', 'ur')).rejects.toMatchObject({ kind: 'step-up-required' });
    const started = await h.api.startPhoneChange('+923990000002', 'ur');
    expect(started.phoneChange.id).toBe(CHANGE);
    expect(h.body(0)).toEqual({ newPhone: '+923990000002', locale: 'ur' });
    expect(h.header(0, 'idempotency-key')).not.toBe(h.header(1, 'idempotency-key'));
  });

  it('keeps the cooldown details of a refused change; current change and cancellation are validated', async () => {
    const h = await harness((path) => {
      if (path === '/v1/account/phone-changes')
        return jsonResponse(409, {
          error: { code: 'WAYVRO_E_CONFLICT', message: 'x', requestId: 'r', details: { reasonCodes: ['NEW_DEVICE_COOLDOWN'], retryAfterSeconds: 86400 } },
        });
      if (path.endsWith('/current')) return jsonResponse(200, { phoneChange: null });
      return jsonResponse(200, {
        id: CHANGE,
        kind: 'RECOVERY_DRIVER_KYC',
        status: 'CANCELLED',
        maskedNewPhone: '+92 3** *** **02',
        cooldownUntil: null,
        createdAt: '2026-10-11T10:00:00.000Z',
      });
    });
    await expect(h.api.startPhoneChange('+923990000002', 'en')).rejects.toMatchObject({
      detail: { reasonCodes: ['NEW_DEVICE_COOLDOWN'], retryAfterSeconds: 86400 },
    });
    expect(await h.api.currentPhoneChange()).toBeNull();
    expect((await h.api.cancelPhoneChange(CHANGE)).status).toBe('CANCELLED');
    expect(h.calls[2]?.path).toBe(`/v1/account/phone-changes/${CHANGE}/cancellation`);
  });

  it('lost-phone recovery always answers RECEIVED', async () => {
    const h = await harness(() => jsonResponse(202, { status: 'RECEIVED' }));
    expect(await h.api.requestRecovery('03990000003', 'DRIVER_KYC')).toBe('RECEIVED');
    expect(h.body(0)).toEqual({ proof: 'DRIVER_KYC', previousPhone: '03990000003' });
  });

  it('"I\'m new" returns a session for a fresh account that replaces the stored tokens in one write, then wipes local data', async () => {
    const h = await harness((path) =>
      path.endsWith('/current')
        ? jsonResponse(200, { review: { id: REVIEW, status: 'PENDING', choices: ['I_AM_NEW'] } })
        : jsonResponse(200, {
            review: { id: REVIEW, status: 'RESOLVED_NEW_ACCOUNT', choices: [] },
            newAccountSession: { ...tokens(2), isNewAccount: true, requiredActions: ['ACCEPT_POLICIES'] },
          }),
    );
    expect((await h.api.currentRecoveryReview())?.choices).toEqual(['I_AM_NEW']);
    const outcome = await h.api.chooseRecoveryReview(REVIEW, 'I_AM_NEW');
    expect(h.body(1)).toEqual({ choice: 'I_AM_NEW' });
    if (outcome.newAccountSession === null) throw new Error('expected a new session');
    const writesBefore = h.store.log.length;
    expect(await h.session.switchAccount(outcome.newAccountSession)).toEqual({ complete: true });
    expect(h.store.log.slice(writesBefore)[0]).toBe(`set:${STORAGE_KEYS.session}`);
    expect(h.store.data.get(STORAGE_KEYS.session)).toContain(tokens(2).refreshToken);
    expect(h.store.data.get(STORAGE_KEYS.session)).not.toContain(tokens(1).refreshToken);
    expect(h.session.accessToken()).toBe(tokens(2).accessToken);
    expect(h.wiped).toEqual(['intents']);
  });

  it('deletion request, current request and cancellation', async () => {
    const deletion = {
      id: DELETION,
      status: 'GRACE',
      channel: 'APP',
      graceUntil: '2026-10-25T10:00:00.000Z',
      blockers: [],
      retained: [],
      createdAt: '2026-10-11T10:00:00.000Z',
    };
    const h = await harness((path) => {
      if (path.endsWith('/current')) return jsonResponse(200, { deletionRequest: deletion });
      if (path.endsWith('/cancellation')) return jsonResponse(200, { ...deletion, status: 'CANCELLED' });
      return jsonResponse(201, deletion);
    });
    expect((await h.api.requestDeletion()).status).toBe('GRACE');
    expect((await h.api.currentDeletion())?.id).toBe(DELETION);
    expect((await h.api.cancelDeletion(DELETION)).status).toBe('CANCELLED');
    expect(h.calls.map((c) => c.path)).toEqual([
      '/v1/account/deletion-requests',
      '/v1/account/deletion-requests/current',
      `/v1/account/deletion-requests/${DELETION}/cancellation`,
    ]);
  });
});
