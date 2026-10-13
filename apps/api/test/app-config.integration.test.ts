/**
 * API-CFG-01..04 + T3-26 against real PostgreSQL/Valkey (API as a LOGIN member of wayvro_api): the public, cacheable
 * `GET /v1/app/config` (Cache-Control/ETag/Vary/304, per-IP-prefix limit with the in-process fallback when Valkey is
 * down), 426 WAYVRO_E_APP_UPDATE_REQUIRED and 503 WAYVRO_E_MAINTENANCE envelopes on non-exempt routes, every exempt
 * route under HARD_UPDATE and MAINTENANCE, absent headers allowed with the APP_CLIENT_HEADERS_MISSING signal, and the
 * gate as a compatibility control only (a spoofed build changes nothing but the 426 evaluation). Policy and switch rows
 * are written by the database owner here (the staff maker-checker routes are covered in release-admin.integration);
 * RUNTIME_SWITCH_CACHE_SECONDS=1, so each change is visible after `settle()`. Synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { AppConfigSchema, ErrorEnvelopeSchema } from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, post, signIn, startApi, syntheticPhone, installation, type Harness } from './support.js';

const settle = () => new Promise((r) => setTimeout(r, 1100));
const ANDROID_OLD = { 'x-wayvro-platform': 'ANDROID', 'x-wayvro-app-build': '50', 'x-wayvro-app-version': '0.9.0' };
const ANDROID_BLOCKED = { 'x-wayvro-platform': 'ANDROID', 'x-wayvro-app-build': '106' };
const ANDROID_CURRENT = { 'x-wayvro-platform': 'ANDROID', 'x-wayvro-app-build': '130' };

let h: Harness;
let staffId: string;

beforeAll(async () => {
  h = await startApi({ env: { RUNTIME_SWITCH_CACHE_SECONDS: '1', APP_CONFIG_PER_MINUTE_IP_PREFIX: '100000', APP_LATEST_RELEASED_BUILD_ANDROID: '200' } });
  staffId = randomUUID();
  await h.owner.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'Synthetic', $2, 'ACTIVE', now())`, [
    staffId,
    `cfg.${randomBytes(4).toString('hex')}@example.org`,
  ]);
});
afterAll(async () => {
  await h.close();
});

let version = 0;
/** Writes an ACTIVE Android policy (min 100, recommended 120, SECURITY block 105..107), retiring any previous one. */
async function activateAndroidPolicy(): Promise<string> {
  const approver = randomUUID();
  await h.owner.query(`insert into staff.staff_accounts (id, display_name, work_email, status, activated_at) values ($1, 'Synthetic', $2, 'ACTIVE', now())`, [
    approver,
    `cfg.${randomBytes(4).toString('hex')}@example.org`,
  ]);
  const id = randomUUID();
  version++;
  await h.owner.query(
    `insert into platform.app_version_policies (id, platform, version, status, min_supported_build, recommended_build, store_url_key, soft_message_key, hard_message_key, drafted_by_staff_id)
     values ($1, 'ANDROID', $2, 'DRAFT', 100, 120, 'store.android', 'release.soft.default', 'release.hard.default', $3)`,
    [id, version, staffId],
  );
  await h.owner.query(`insert into platform.app_blocked_builds (policy_id, builds, reason_code) values ($1, '[105,107]', 'SECURITY')`, [id]);
  await h.owner.query(`update platform.app_version_policies set status = 'PENDING_APPROVAL' where id = $1`, [id]);
  await h.owner.query(`update platform.app_version_policies set status = 'APPROVED', approved_by_staff_id = $2 where id = $1`, [id, approver]);
  await h.owner.query(`update platform.app_version_policies set status = 'RETIRED', effective_until = now() where platform = 'ANDROID' and status = 'ACTIVE'`);
  await h.owner.query(`update platform.app_version_policies set status = 'ACTIVE', effective_from = now() where id = $1`, [id]);
  await settle();
  return id;
}
async function setMaintenance(active: boolean, expectedEndSeconds: number | null = 1800): Promise<void> {
  await h.owner.query(
    `insert into platform.runtime_switches (id, key, scope, state, reason_code, message_key, expected_end, changed_by_staff_id)
     values ($1, 'platform.maintenance', 'ALL', $2, 'PLANNED_MAINTENANCE', 'maintenance.planned', case when $3::int is null then null else now() + ($3::int * interval '1 second') end, $4)
     on conflict (key, scope, city_code) do update set state = excluded.state, message_key = excluded.message_key, expected_end = excluded.expected_end, version = platform.runtime_switches.version + 1`,
    [randomUUID(), active ? 'ENABLED' : 'DISABLED', expectedEndSeconds, staffId],
  );
  await settle();
}
const config = (headers: Record<string, string> = {}) => h.inject({ method: 'GET', url: '/v1/app/config', headers });

describe('API-CFG-01 GET /v1/app/config is public and cacheable', () => {
  it('answers without credentials: contract shape, Cache-Control public max-age, ETag, Vary; 304 on revalidation', async () => {
    const res = await config();
    expect(res.statusCode, res.body).toBe(200);
    const body = AppConfigSchema.parse(res.json());
    expect(body.client).toEqual({ state: 'OK', reasonClass: null, messageKey: null, storeUrlKey: null, recommendedBuild: null, minSupportedBuild: null });
    expect(body.map.rendererKind).toBe('none');
    expect(Math.abs(Date.parse(body.serverTime) - Date.now())).toBeLessThan(60_000);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.headers['vary']).toBe('x-wayvro-platform, x-wayvro-app-build');
    const etag = res.headers['etag'] as string;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{32}"$/);
    const again = await config({ 'if-none-match': etag });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    // every other route keeps no-store
    expect((await h.inject({ method: 'GET', url: '/v1/legal/policies' })).headers['cache-control']).toBe('no-store');
  });

  it('malformed compatibility headers are a 400; absent headers evaluate as OK', async () => {
    expect((await config({ 'x-wayvro-platform': 'WINDOWS', 'x-wayvro-app-build': '1' })).statusCode).toBe(400);
    expect((await config({ 'x-wayvro-platform': 'ANDROID' })).statusCode).toBe(400);
    expect((await config({ 'x-wayvro-platform': 'ANDROID', 'x-wayvro-app-build': '1', 'x-wayvro-app-version': 'not a version!' })).statusCode).toBe(400);
  });
});

describe('API-CFG-02/03 HARD_UPDATE: 426 on non-exempt routes; exempt routes stay reachable', () => {
  let session: Awaited<ReturnType<typeof signIn>>;
  beforeAll(async () => {
    session = await signIn(h);
    await activateAndroidPolicy();
  });

  it('app config tells each build its state (minimum, blocked range reason, soft update, current)', async () => {
    const state = async (headers: Record<string, string>) => AppConfigSchema.parse((await config(headers)).json()).client;
    expect(await state(ANDROID_OLD)).toEqual({
      state: 'HARD_UPDATE',
      reasonClass: 'MINIMUM_BUILD',
      messageKey: 'release.hard.default',
      storeUrlKey: 'store.android',
      recommendedBuild: 120,
      minSupportedBuild: 100,
    });
    expect(await state(ANDROID_BLOCKED)).toMatchObject({ state: 'HARD_UPDATE', reasonClass: 'SECURITY' });
    expect(await state({ 'x-wayvro-platform': 'ANDROID', 'x-wayvro-app-build': '110' })).toMatchObject({
      state: 'SOFT_UPDATE',
      messageKey: 'release.soft.default',
    });
    expect(await state(ANDROID_CURRENT)).toMatchObject({ state: 'OK' });
    expect(await state({ 'x-wayvro-platform': 'IOS', 'x-wayvro-app-build': '1' })).toMatchObject({ state: 'OK', minSupportedBuild: null });
    const varies = await Promise.all([config(ANDROID_OLD), config(ANDROID_CURRENT)]);
    expect(varies[0].headers['etag']).not.toBe(varies[1].headers['etag']);
  });

  it('non-exempt routes answer the 426 envelope (before authentication) for an old or blocked build', async () => {
    for (const headers of [ANDROID_OLD, ANDROID_BLOCKED]) {
      const res = await h.inject({ method: 'GET', url: '/v1/account/state', headers: { ...headers, 'x-request-id': 'req-update-required' } });
      expect(res.statusCode).toBe(426);
      const envelope = ErrorEnvelopeSchema.parse(res.json());
      expect(envelope.error.code).toBe('WAYVRO_E_APP_UPDATE_REQUIRED');
      expect(envelope.error.requestId).toBe('req-update-required');
      expect(envelope.error.details?.reasonCodes).toEqual([headers === ANDROID_OLD ? 'MINIMUM_BUILD' : 'SECURITY']);
    }
    const otp = await h.inject(
      post('/v1/auth/otp-challenges', { phone: syntheticPhone(), purpose: 'SIGN_IN', installationId: installation(), locale: 'en' }, ANDROID_OLD),
    );
    expect(otp.statusCode).toBe(426);
    expect(otp.headers['cache-control']).toBe('no-store');
  });

  it('a spoofed build header changes only the 426 evaluation (compatibility hint, never authorisation)', async () => {
    // a current build without a session is still unauthenticated; with a session it is just a normal request
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: ANDROID_CURRENT })).statusCode).toBe(401);
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: { ...ANDROID_CURRENT, ...bearer(session.accessToken) } })).statusCode).toBe(200);
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: { ...ANDROID_OLD, ...bearer(session.accessToken) } })).statusCode).toBe(426);
    // headers absent: allowed (web surfaces, Phase-2 builds) and counted in the access log
    h.logs.clear();
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(session.accessToken) })).statusCode).toBe(200);
    expect(h.logs.text()).toContain('"appClient":"ABSENT"');
    expect(h.logs.text()).toContain('APP_CLIENT_HEADERS_MISSING');
    // partial headers are never trusted: treated as unidentified, not as a pass for an old build
    expect(
      (await h.inject({ method: 'GET', url: '/v1/account/state', headers: { 'x-wayvro-platform': 'ANDROID', ...bearer(session.accessToken) } })).statusCode,
    ).toBe(200);
  });

  it('exempt routes stay reachable for an old build: health, app config, legal, deletion path + its step-up, token refresh, sign-out, staff', async () => {
    const signedIn = await signIn(h);
    const withOld = (token?: string) => ({ ...ANDROID_OLD, ...(token ? bearer(token) : {}) });
    const statuses = await exemptStatuses(signedIn, withOld);
    for (const [route, status] of Object.entries(statuses)) expect([426, 503], route).not.toContain(status);
  });
});

/** Calls every exempt route once; returns route → status (none may be 426/503). */
async function exemptStatuses(
  signedIn: Awaited<ReturnType<typeof signIn>>,
  headers: (token?: string) => Record<string, string>,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const call = async (name: string, opts: Parameters<Harness['inject']>[0]) => {
    out[name] = (await h.inject(opts)).statusCode;
  };
  await call('GET /v1/health/live', { method: 'GET', url: '/v1/health/live', headers: headers() });
  await call('GET /v1/app/config', { method: 'GET', url: '/v1/app/config', headers: headers() });
  await call('GET /v1/legal/policies', { method: 'GET', url: '/v1/legal/policies', headers: headers() });
  await call('GET /v1/legal/age-eligibility-policy', { method: 'GET', url: '/v1/legal/age-eligibility-policy', headers: headers() });
  await call('GET /v1/account/deletion-requests/current', {
    method: 'GET',
    url: '/v1/account/deletion-requests/current',
    headers: headers(signedIn.accessToken),
  });
  await call('POST /v1/account/step-ups', post('/v1/account/step-ups', {}, headers(signedIn.accessToken)));
  await call('POST /v1/account/deletion-requests', post('/v1/account/deletion-requests', {}, headers(signedIn.accessToken)));
  await call(
    'POST /v1/public/account-deletion-otp-challenges',
    post('/v1/public/account-deletion-otp-challenges', { phone: syntheticPhone(), browserId: installation(), locale: 'en' }, headers()),
  );
  await call('GET /v1/admin/me', { method: 'GET', url: '/v1/admin/me', headers: headers() });
  await call('POST /v1/auth/token-refreshes', post('/v1/auth/token-refreshes', { refreshToken: signedIn.refreshToken }, headers()));
  await call('DELETE /v1/auth/sessions/current', {
    method: 'DELETE',
    url: '/v1/auth/sessions/current',
    headers: { ...headers(signedIn.accessToken), 'idempotency-key': `idem-${randomBytes(12).toString('hex')}` },
  });
  expect(out['GET /v1/health/live']).toBe(200);
  expect(out['GET /v1/app/config']).toBe(200);
  expect(out['GET /v1/legal/policies']).toBe(200);
  expect(out['GET /v1/admin/me']).toBe(401);
  return out;
}

describe('API-CFG-03/04 MAINTENANCE: 503 envelope with Retry-After; exempt routes and staff stay reachable', () => {
  afterAll(async () => {
    await setMaintenance(false);
  });

  it('consumer routes answer 503 WAYVRO_E_MAINTENANCE with retryAfterSeconds from the expected end', async () => {
    await setMaintenance(true, 1800);
    const res = await h.inject({ method: 'GET', url: '/v1/account/state', headers: ANDROID_CURRENT });
    expect(res.statusCode).toBe(503);
    const envelope = ErrorEnvelopeSchema.parse(res.json());
    expect(envelope.error.code).toBe('WAYVRO_E_MAINTENANCE');
    const retry = envelope.error.details?.retryAfterSeconds ?? 0;
    expect(retry).toBeGreaterThan(1700);
    expect(retry).toBeLessThanOrEqual(1800);
    expect(res.headers['retry-after']).toBe(String(retry));
    // headers absent are still subject to maintenance (it is not a compatibility control)
    expect(
      (await h.inject(post('/v1/auth/otp-challenges', { phone: syntheticPhone(), purpose: 'SIGN_IN', installationId: installation(), locale: 'en' })))
        .statusCode,
    ).toBe(503);
    const cfg = AppConfigSchema.parse((await config(ANDROID_CURRENT)).json());
    expect(cfg.maintenance).toMatchObject({ active: true, messageKey: 'maintenance.planned' });
    expect(cfg.client.state).toBe('MAINTENANCE');
    // a build that must update is told so even during maintenance (HARD wins), and the hook agrees
    expect(AppConfigSchema.parse((await config(ANDROID_OLD)).json()).client.state).toBe('HARD_UPDATE');
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: ANDROID_OLD })).statusCode).toBe(426);
    expect(cfg.switches.find((s) => s.key === 'platform.maintenance')).toEqual({
      key: 'platform.maintenance',
      state: 'ENABLED',
      messageKey: 'maintenance.planned',
    });
  });

  it('without an expected end there is no Retry-After', async () => {
    await setMaintenance(true, null);
    const res = await h.inject({ method: 'GET', url: '/v1/account/state' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBeUndefined();
    expect(ErrorEnvelopeSchema.parse(res.json()).error.details).toBeUndefined();
  });

  it('exempt routes and staff routes stay reachable under maintenance', async () => {
    await setMaintenance(true, 600);
    // a session created before maintenance started (sign-in itself is a gated consumer route)
    await setMaintenance(false);
    const signedIn = await signIn(h);
    await setMaintenance(true, 600);
    const statuses = await exemptStatuses(signedIn, (token) => ({ ...ANDROID_CURRENT, ...(token ? bearer(token) : {}) }));
    for (const [route, status] of Object.entries(statuses)) expect([426, 503], route).not.toContain(status);
  });
});

describe('per-IP-prefix limit on the public endpoint', () => {
  it('Valkey: the configured limit per minute answers 429 RATE_LIMITED', async () => {
    const limited = await startApi({ env: { APP_CONFIG_PER_MINUTE_IP_PREFIX: '2' } });
    try {
      const get = () => limited.inject({ method: 'GET', url: '/v1/app/config' });
      expect((await get()).statusCode).toBe(200);
      expect((await get()).statusCode).toBe(200);
      const denied = await get();
      expect(denied.statusCode).toBe(429);
      expect(ErrorEnvelopeSchema.parse(denied.json()).error.code).toBe('WAYVRO_E_RATE_LIMITED');
    } finally {
      await limited.close();
    }
  }, 120_000); // boots its own API (throwaway database) inside the test

  it('Valkey unavailable: the in-process fallback bucket still limits and the endpoint keeps answering', async () => {
    const down = await startApi({ env: { APP_CONFIG_PER_MINUTE_IP_PREFIX: '2', REDIS_URL: 'redis://127.0.0.1:1' } });
    try {
      const get = () => down.inject({ method: 'GET', url: '/v1/app/config' });
      expect((await get()).statusCode).toBe(200);
      expect((await get()).statusCode).toBe(200);
      expect((await get()).statusCode).toBe(429);
    } finally {
      await down.close();
    }
  }, 120_000); // boots its own API (throwaway database) inside the test
});
