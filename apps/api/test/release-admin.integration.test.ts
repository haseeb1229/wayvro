/**
 * Staff release controls against real PostgreSQL/Valkey (API-CFG-05/06, BUD-07, T3-24/T3-25): app version policies
 * (draft/revise/submit by the drafter only, approval by a DIFFERENT RELEASE_MANAGER, guardrail refusals, activation now
 * or on server time, schedule cancellation, retirement, dry-run preview, concurrent activations with exactly one
 * winner) and runtime switches (safe state by one staff member with step-up, restore by maker-checker, registry-only
 * keys, allowed scopes, RIDER scope never touching a driver route, maintenance start/end through the switch), each
 * with audit, outbox and log signals. RUNTIME_SWITCH_CACHE_SECONDS=1; staff changes invalidate the local cache at once.
 *
 * Needs the RELEASE_MANAGER role CHECK widening of migration 0010 (staff.role_assignments) to grant the role.
 * Synthetic data only.
 */
import { randomBytes } from 'node:crypto';
import {
  AppConfigSchema,
  AppVersionPolicyListSchema,
  AppVersionPolicyPreviewSchema,
  AppVersionPolicySchema,
  ErrorEnvelopeSchema,
  RuntimeSwitchChangeListSchema,
  RuntimeSwitchChangeSchema,
  RuntimeSwitchListSchema,
} from '@wayvro/contracts';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, signIn, startApi, type Harness } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let rmA: Staff;
let rmB: Staff;
let auditor: Staff;

const idem = () => `idem-${randomBytes(12).toString('hex')}`;
beforeAll(async () => {
  h = await startApi({
    env: { ...STAFF_ENV, RUNTIME_SWITCH_CACHE_SECONDS: '1', APP_LATEST_RELEASED_BUILD_ANDROID: '500', APP_LATEST_RELEASED_BUILD_IOS: '0' },
  });
  kit = staffKit(h);
  const admins = await kit.bootstrapAdmins(2);
  rmA = await kit.staffWithRole(admins, 'RELEASE_MANAGER', 'Release One');
  rmB = await kit.staffWithRole(admins, 'RELEASE_MANAGER', 'Release Two');
  auditor = await kit.staffWithRole(admins, 'AUDITOR', 'Release Auditor');
}, 120_000);
afterAll(async () => {
  await h.close();
});

/** A step-up then one staff call (POST with JSON body, or GET). */
async function as(s: Staff, method: 'GET' | 'POST', url: string, body?: unknown, key = idem()) {
  await kit.stepUp(s);
  const opts: InjectOptions =
    method === 'GET' ? { method, url, headers: kit.sb(s) } : { method, url, payload: body ?? {}, headers: { ...kit.sb(s), 'idempotency-key': key } };
  return h.inject(opts);
}
const reasons = (res: LightMyRequestResponse) => ErrorEnvelopeSchema.parse(res.json()).error.details?.reasonCodes;
const policyValues = {
  minSupportedBuild: 100,
  recommendedBuild: 120,
  storeUrlKey: 'store.android',
  softMessageKey: 'release.soft.default',
  hardMessageKey: 'release.hard.default',
  blockedRanges: [{ fromBuild: 105, toBuild: 107, reasonCode: 'SECURITY' }],
};
async function approvedPolicy(values: Record<string, unknown> = {}, platform = 'ANDROID'): Promise<string> {
  const draft = await as(rmA, 'POST', '/v1/admin/release/policies', { platform, ...policyValues, ...values });
  expect(draft.statusCode, draft.body).toBe(201);
  const id = AppVersionPolicySchema.parse(draft.json()).id;
  expect((await as(rmA, 'POST', `/v1/admin/release/policies/${id}/submission`, {})).statusCode).toBe(200);
  const approved = await as(rmB, 'POST', `/v1/admin/release/policies/${id}/approval`, { decision: 'APPROVE' });
  expect(approved.statusCode, approved.body).toBe(200);
  return id;
}
const audits = async (action: string, objectId?: string) =>
  (
    await h.owner.query<{ actor_id: string | null; outcome: string; reason_code: string | null }>(
      `select actor_id, outcome, reason_code from audit.audit_events where action = $1 and ($2::uuid is null or object_id = $2) order by occurred_at`,
      [action, objectId ?? null],
    )
  ).rows;
const consumerState = (headers: Record<string, string>) => h.inject({ method: 'GET', url: '/v1/account/state', headers });
const OLD_ANDROID = { 'x-wayvro-platform': 'ANDROID', 'x-wayvro-app-build': '50' };

describe('app version policies: maker-checker, guardrails, activation (A01/Q31/T3-25)', () => {
  it('draft → revise/submit by the drafter only → approval by a different manager → activate now; every step audited', async () => {
    const draft = await as(rmA, 'POST', '/v1/admin/release/policies', { platform: 'ANDROID', ...policyValues });
    expect(draft.statusCode, draft.body).toBe(201);
    const created = AppVersionPolicySchema.parse(draft.json());
    expect(created).toMatchObject({ status: 'DRAFT', platform: 'ANDROID', draftedByStaffId: rmA.staffId, approvedByStaffId: null, scheduled: false });
    expect(created.blockedRanges).toEqual([{ fromBuild: 105, toBuild: 107, reasonCode: 'SECURITY' }]);
    const id = created.id;

    // only the drafter revises or submits (denials audited)
    expect((await as(rmB, 'POST', `/v1/admin/release/policies/${id}/revision`, policyValues)).statusCode).toBe(403);
    expect((await as(rmB, 'POST', `/v1/admin/release/policies/${id}/submission`, {})).statusCode).toBe(403);
    expect((await audits('STAFF_ACCESS_DENIED', id)).map((a) => a.reason_code)).toEqual(['NOT_DRAFTER', 'NOT_DRAFTER']);
    const revised = await as(rmA, 'POST', `/v1/admin/release/policies/${id}/revision`, {
      ...policyValues,
      blockedRanges: [{ fromBuild: 90, toBuild: 95, reasonCode: 'DATA_CORRUPTION' }],
    });
    expect(revised.statusCode, revised.body).toBe(200);
    expect(AppVersionPolicySchema.parse(revised.json()).blockedRanges).toEqual([{ fromBuild: 90, toBuild: 95, reasonCode: 'DATA_CORRUPTION' }]);
    expect(AppVersionPolicySchema.parse((await as(rmA, 'POST', `/v1/admin/release/policies/${id}/submission`, {})).json()).status).toBe('PENDING_APPROVAL');
    expect((await as(rmA, 'POST', `/v1/admin/release/policies/${id}/revision`, policyValues)).statusCode).toBe(409);

    // the drafter can never approve (service refusal, audited; the database CHECK is the second wall)
    expect((await as(rmA, 'POST', `/v1/admin/release/policies/${id}/approval`, { decision: 'APPROVE' })).statusCode).toBe(403);
    expect((await audits('STAFF_ACCESS_DENIED', id)).at(-1)?.reason_code).toBe('MAKER_IS_CHECKER');
    const approved = await as(rmB, 'POST', `/v1/admin/release/policies/${id}/approval`, { decision: 'APPROVE' });
    expect(AppVersionPolicySchema.parse(approved.json())).toMatchObject({ status: 'APPROVED', approvedByStaffId: rmB.staffId });

    // the old build is not yet refused: nothing is ACTIVE
    expect((await consumerState(OLD_ANDROID)).statusCode).toBe(401);
    const activated = await as(rmA, 'POST', `/v1/admin/release/policies/${id}/activation`, { when: 'NOW' });
    expect(activated.statusCode, activated.body).toBe(200);
    expect(AppVersionPolicySchema.parse(activated.json())).toMatchObject({ status: 'ACTIVE', scheduled: false });
    // this process applies its own change at once (no wait for the cache TTL)
    expect((await consumerState(OLD_ANDROID)).statusCode).toBe(426);
    expect((await as(rmA, 'POST', `/v1/admin/release/policies/${id}/activation`, { when: 'NOW' })).statusCode).toBe(409);

    for (const action of ['APP_POLICY_DRAFTED', 'APP_POLICY_REVISED', 'APP_POLICY_SUBMITTED', 'APP_POLICY_APPROVED', 'APP_POLICY_ACTIVATED']) {
      expect((await audits(action, id)).length, action).toBe(1);
    }
    expect((await audits('APP_POLICY_APPROVED', id))[0]?.actor_id).toBe(rmB.staffId);
    const events = await h.owner.query(`select payload from platform.outbox_events where type = 'platform.app-policy.activated.v1' and aggregate_id = $1`, [
      id,
    ]);
    expect(events.rows[0]?.payload).toMatchObject({ platform: 'ANDROID', scheduled: false });
    expect(h.logs.text()).toContain('APP_POLICY_ACTIVATED');

    // retire: no ACTIVE policy = no enforcement (documented fail-open)
    const retired = await as(rmB, 'POST', `/v1/admin/release/policies/${id}/retirement`, {});
    expect(AppVersionPolicySchema.parse(retired.json()).status).toBe('RETIRED');
    expect((await consumerState(OLD_ANDROID)).statusCode).toBe(401);
    expect((await as(rmB, 'POST', `/v1/admin/release/policies/${id}/retirement`, {})).statusCode).toBe(409);
  });

  it('structural problems are refused at draft; release guardrails at submit/approve/activate (reason codes)', async () => {
    const draft = (values: Record<string, unknown>) => as(rmA, 'POST', '/v1/admin/release/policies', { platform: 'ANDROID', ...policyValues, ...values });
    const below = await draft({ recommendedBuild: 99 });
    expect(below.statusCode).toBe(400);
    expect(reasons(below)).toEqual(['RECOMMENDED_BELOW_MINIMUM']);
    const overlap = await draft({
      blockedRanges: [
        { fromBuild: 1, toBuild: 10, reasonCode: 'SECURITY' },
        { fromBuild: 10, toBuild: 12, reasonCode: 'CONTRACT_BREAK' },
      ],
    });
    expect(reasons(overlap)).toEqual(['BLOCKED_RANGES_OVERLAP']);

    // minimum above the latest released build (500) and a range covering it: refused at submit
    for (const [values, code] of [
      [{ minSupportedBuild: 501, recommendedBuild: 501 }, 'MINIMUM_ABOVE_LATEST_RELEASED'],
      [{ blockedRanges: [{ fromBuild: 400, toBuild: 600, reasonCode: 'SECURITY' }] }, 'BLOCKED_RANGE_COVERS_LATEST_RELEASED'],
    ] as const) {
      const created = await draft(values);
      expect(created.statusCode, created.body).toBe(201);
      const submitted = await as(rmA, 'POST', `/v1/admin/release/policies/${AppVersionPolicySchema.parse(created.json()).id}/submission`, {});
      expect(submitted.statusCode).toBe(400);
      expect(reasons(submitted)).toEqual([code]);
    }
    // iOS: nothing released (0) ⇒ any minimum above 0 is refused
    const ios = await as(rmA, 'POST', '/v1/admin/release/policies', { platform: 'IOS', ...policyValues, blockedRanges: [] });
    const iosSubmit = await as(rmA, 'POST', `/v1/admin/release/policies/${AppVersionPolicySchema.parse(ios.json()).id}/submission`, {});
    expect(reasons(iosSubmit)).toEqual(['MINIMUM_ABOVE_LATEST_RELEASED']);
    // malformed bodies and unknown fields are 400 (never read)
    expect((await draft({ minSupportedBuild: -1 })).statusCode).toBe(400);
    expect((await draft({ storeUrlKey: 'https://play.example/app' })).statusCode).toBe(400);
    expect((await as(rmA, 'POST', '/v1/admin/release/policies', { platform: 'ANDROID', ...policyValues, approvedByStaffId: rmB.staffId })).statusCode).toBe(
      400,
    );
  });

  it('schedule on server time (never back-dated), cancel the schedule; a stale or older activation is a clean 409', async () => {
    const id = await approvedPolicy();
    const past = await as(rmA, 'POST', `/v1/admin/release/policies/${id}/activation`, {
      when: 'SCHEDULED',
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.statusCode).toBe(400);
    expect(reasons(past)).toEqual(['EFFECTIVE_FROM_IN_PAST']);
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const scheduled = AppVersionPolicySchema.parse(
      (await as(rmA, 'POST', `/v1/admin/release/policies/${id}/activation`, { when: 'SCHEDULED', effectiveFrom: at })).json(),
    );
    expect(scheduled).toMatchObject({ status: 'APPROVED', scheduled: true });
    expect(Date.parse(scheduled.effectiveFrom ?? '')).toBe(Date.parse(at));
    expect((await audits('APP_POLICY_SCHEDULED', id)).length).toBe(1);
    const cancelled = AppVersionPolicySchema.parse((await as(rmA, 'POST', `/v1/admin/release/policies/${id}/schedule-cancellation`, {})).json());
    expect(cancelled).toMatchObject({ status: 'APPROVED', scheduled: false, effectiveFrom: null });
    expect((await as(rmA, 'POST', `/v1/admin/release/policies/${id}/schedule-cancellation`, {})).statusCode).toBe(409);

    // a newer policy activated first: the older one can no longer be activated
    const newer = await approvedPolicy();
    expect((await as(rmA, 'POST', `/v1/admin/release/policies/${newer}/activation`, { when: 'NOW' })).statusCode).toBe(200);
    const older = await as(rmA, 'POST', `/v1/admin/release/policies/${id}/activation`, { when: 'NOW' });
    expect(older.statusCode).toBe(409);
    expect(reasons(older)).toEqual(['NEWER_POLICY_ACTIVE']);
    // the scheduled-activation job won (simulated by its status change): a staff activation sees a clean 409
    const raced = await approvedPolicy();
    await h.owner.query(
      `update platform.app_version_policies set status = 'RETIRED', effective_until = now() where platform = 'ANDROID' and status = 'ACTIVE'`,
    );
    await h.owner.query(`update platform.app_version_policies set status = 'ACTIVE', effective_from = now() where id = $1`, [raced]);
    expect((await as(rmA, 'POST', `/v1/admin/release/policies/${raced}/activation`, { when: 'NOW' })).statusCode).toBe(409);
    await as(rmA, 'POST', `/v1/admin/release/policies/${raced}/retirement`, {});
  });

  it('two concurrent activations of one policy: exactly one 200, the other 409; one ACTIVE per platform', async () => {
    const id = await approvedPolicy({}, 'ANDROID');
    await kit.stepUp(rmA);
    await kit.stepUp(rmB);
    const [a, b] = await Promise.all(
      [rmA, rmB].map((s) =>
        h.inject({
          method: 'POST',
          url: `/v1/admin/release/policies/${id}/activation`,
          payload: { when: 'NOW' },
          headers: { ...kit.sb(s), 'idempotency-key': idem() },
        }),
      ),
    );
    expect([a?.statusCode, b?.statusCode].sort()).toEqual([200, 409]);
    expect((await h.owner.query(`select count(*)::int n from platform.app_version_policies where platform = 'ANDROID' and status = 'ACTIVE'`)).rows[0]).toEqual(
      { n: 1 },
    );
    await as(rmA, 'POST', `/v1/admin/release/policies/${id}/retirement`, {});
  });

  it('dry-run preview: guardrail verdict + active sessions per recorded app version (builds are not recorded)', async () => {
    await signIn(h); // an ANDROID session on app version 1.0.0
    const draft = await as(rmA, 'POST', '/v1/admin/release/policies', { platform: 'ANDROID', ...policyValues, minSupportedBuild: 600, recommendedBuild: 600 });
    const id = AppVersionPolicySchema.parse(draft.json()).id;
    const preview = AppVersionPolicyPreviewSchema.parse((await as(auditor, 'GET', `/v1/admin/release/policies/${id}/preview`)).json());
    expect(preview).toMatchObject({
      policyId: id,
      platform: 'ANDROID',
      latestReleasedBuild: 500,
      guardrailProblems: ['MINIMUM_ABOVE_LATEST_RELEASED'],
      buildsRecorded: false,
    });
    expect(preview.activeSessionsByAppVersion.find((v) => v.appVersion === '1.0.0')?.activeSessions).toBeGreaterThanOrEqual(1);
    expect((await as(rmA, 'GET', '/v1/admin/release/policies/00000000-0000-7000-8000-000000000000/preview')).statusCode).toBe(404);
  });

  it('read-only AUDITOR lists and reads; every mutation needs the release permissions and a fresh step-up; replays are idempotent', async () => {
    const list = AppVersionPolicyListSchema.parse((await as(auditor, 'GET', '/v1/admin/release/policies?platform=ANDROID')).json());
    expect(list.policies.length).toBeGreaterThan(0);
    expect(list.policies.every((p) => p.platform === 'ANDROID')).toBe(true);
    expect((await as(auditor, 'POST', '/v1/admin/release/policies', { platform: 'ANDROID', ...policyValues })).statusCode).toBe(403);
    expect(
      (await as(auditor, 'POST', '/v1/admin/switches/safe-state-changes', { key: 'rider.quotes', scope: 'ALL', reasonCode: 'OPS_INCIDENT' })).statusCode,
    ).toBe(403);
    // stale step-up
    await h.owner.query(`update staff.sessions set step_up_at = now() - interval '1 hour' where staff_id = $1`, [rmA.staffId]);
    const stale = await h.inject({
      method: 'POST',
      url: '/v1/admin/release/policies',
      payload: { platform: 'ANDROID', ...policyValues },
      headers: { ...kit.sb(rmA), 'idempotency-key': idem() },
    });
    expect(stale.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.parse(stale.json()).error.code).toBe('WAYVRO_E_STEP_UP_REQUIRED');
    // same key + same body replays; same key + different body is a conflict
    const key = idem();
    const first = await as(rmA, 'POST', '/v1/admin/release/policies', { platform: 'ANDROID', ...policyValues }, key);
    const replay = await as(rmA, 'POST', '/v1/admin/release/policies', { platform: 'ANDROID', ...policyValues }, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect((await as(rmA, 'POST', '/v1/admin/release/policies', { platform: 'IOS', ...policyValues }, key)).statusCode).toBe(409);
  });
});

describe('runtime switches: safe state by one staff member, restore by maker-checker (A01/V10/T3-24/BUD-07)', () => {
  it('lists every registered switch with its default; history pages', async () => {
    const list = RuntimeSwitchListSchema.parse((await as(auditor, 'GET', '/v1/admin/switches')).json());
    expect(list.switches.map((s) => s.key).sort()).toEqual([
      'platform.geo-autocomplete',
      'platform.geo-geocode',
      'platform.geo-reverse',
      'platform.geo-routing',
      'platform.maintenance',
      'rider.quotes',
    ]);
    expect(list.switches.find((s) => s.key === 'platform.maintenance')).toMatchObject({
      safeState: 'ENABLED',
      defaultState: 'DISABLED',
      baseState: 'DISABLED',
    });
    expect(RuntimeSwitchChangeListSchema.parse((await as(auditor, 'GET', '/v1/admin/switches/changes')).json()).nextCursor).toBeNull();
  });

  it('stop quotes now (single staff, step-up, audited, outbox, alert signal); a second stop conflicts; restore needs a different approver', async () => {
    const stop = await as(rmA, 'POST', '/v1/admin/switches/safe-state-changes', { key: 'rider.quotes', scope: 'ALL', reasonCode: 'OPS_INCIDENT' });
    expect(stop.statusCode, stop.body).toBe(201);
    const change = RuntimeSwitchChangeSchema.parse(stop.json());
    expect(change).toMatchObject({
      key: 'rider.quotes',
      direction: 'TO_SAFE',
      status: 'APPLIED',
      fromState: 'ENABLED',
      toState: 'DISABLED',
      requestedByStaffId: rmA.staffId,
    });
    expect(await h.runtime.switches.isStopped('rider.quotes')).toBe(true);
    expect(await h.runtime.switches.isStopped('rider.quotes', { scope: 'RIDER', cityCode: 'LHR' })).toBe(true);
    expect((await audits('RUNTIME_SWITCH_SAFE_STATE_APPLIED')).at(-1)).toMatchObject({ actor_id: rmA.staffId, reason_code: 'OPS_INCIDENT' });
    const events = await h.owner.query(
      `select payload from platform.outbox_events where type = 'platform.runtime-switch.changed.v1' order by created_at desc limit 1`,
    );
    expect(events.rows[0]?.payload).toMatchObject({ key: 'rider.quotes', state: 'DISABLED', direction: 'TO_SAFE' });
    expect(h.logs.text()).toContain('RUNTIME_SWITCH_CHANGED');
    const cfg = AppConfigSchema.parse((await h.inject({ method: 'GET', url: '/v1/app/config' })).json());
    expect(cfg.switches.find((s) => s.key === 'rider.quotes')?.state).toBe('DISABLED');
    const again = await as(rmB, 'POST', '/v1/admin/switches/safe-state-changes', { key: 'rider.quotes', scope: 'ALL', reasonCode: 'OPS_INCIDENT' });
    expect(again.statusCode).toBe(409);
    expect(reasons(again)).toEqual(['ALREADY_IN_SAFE_STATE']);

    // restore: request by A, A cannot approve, B approves
    const request = await as(rmA, 'POST', '/v1/admin/switches/restore-requests', { key: 'rider.quotes', scope: 'ALL', reasonCode: 'INCIDENT_RESOLVED' });
    expect(request.statusCode, request.body).toBe(201);
    const pending = RuntimeSwitchChangeSchema.parse(request.json());
    expect(pending).toMatchObject({ direction: 'FROM_SAFE', status: 'PENDING_APPROVAL', fromState: 'DISABLED', toState: 'ENABLED' });
    expect(
      reasons(await as(rmB, 'POST', '/v1/admin/switches/restore-requests', { key: 'rider.quotes', scope: 'ALL', reasonCode: 'INCIDENT_RESOLVED' })),
    ).toEqual(['RESTORE_ALREADY_PENDING']);
    expect(RuntimeSwitchListSchema.parse((await as(auditor, 'GET', '/v1/admin/switches')).json()).pendingRequests.map((p) => p.id)).toContain(pending.id);
    expect((await as(rmA, 'POST', `/v1/admin/switches/restore-requests/${pending.id}/approval`, { decision: 'APPROVE' })).statusCode).toBe(403);
    expect((await audits('STAFF_ACCESS_DENIED')).at(-1)).toMatchObject({ actor_id: rmA.staffId, reason_code: 'MAKER_IS_CHECKER' });
    expect(await h.runtime.switches.isStopped('rider.quotes')).toBe(true);
    const approved = await as(rmB, 'POST', `/v1/admin/switches/restore-requests/${pending.id}/approval`, { decision: 'APPROVE' });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(RuntimeSwitchChangeSchema.parse(approved.json())).toMatchObject({ status: 'APPLIED', approvedByStaffId: rmB.staffId });
    expect(await h.runtime.switches.isStopped('rider.quotes')).toBe(false);
    expect((await audits('RUNTIME_SWITCH_RESTORED')).at(-1)?.actor_id).toBe(rmB.staffId);
    expect((await as(rmB, 'POST', `/v1/admin/switches/restore-requests/${pending.id}/approval`, { decision: 'APPROVE' })).statusCode).toBe(409);
    expect(
      reasons(await as(rmA, 'POST', '/v1/admin/switches/restore-requests', { key: 'rider.quotes', scope: 'ALL', reasonCode: 'INCIDENT_RESOLVED' })),
    ).toEqual(['NOT_IN_SAFE_STATE']);
  });

  it('a rejected restore leaves the switch stopped; history records every change', async () => {
    await as(rmA, 'POST', '/v1/admin/switches/safe-state-changes', { key: 'platform.geo-routing', scope: 'ALL', reasonCode: 'BUDGET_EXHAUSTED' });
    const request = RuntimeSwitchChangeSchema.parse(
      (await as(rmB, 'POST', '/v1/admin/switches/restore-requests', { key: 'platform.geo-routing', scope: 'ALL', reasonCode: 'BUDGET_RAISED' })).json(),
    );
    const rejected = await as(rmA, 'POST', `/v1/admin/switches/restore-requests/${request.id}/approval`, { decision: 'REJECT' });
    expect(RuntimeSwitchChangeSchema.parse(rejected.json())).toMatchObject({ status: 'REJECTED', approvedByStaffId: null });
    expect(await h.runtime.switches.isStopped('platform.geo-routing')).toBe(true);
    const history = RuntimeSwitchChangeListSchema.parse((await as(auditor, 'GET', '/v1/admin/switches/changes')).json());
    expect(history.changes.filter((c) => c.key === 'platform.geo-routing').map((c) => c.status)).toEqual(['REJECTED', 'APPLIED']);
  });

  it('registry-only keys, allowed scopes, known cities, future times; unknown fields refused', async () => {
    const refuse = async (body: Record<string, unknown>) => as(rmA, 'POST', '/v1/admin/switches/safe-state-changes', { reasonCode: 'OPS_INCIDENT', ...body });
    expect(reasons(await refuse({ key: 'rider.no-such-switch', scope: 'ALL' }))).toEqual(['UNKNOWN_SWITCH']);
    expect(reasons(await refuse({ key: 'platform.maintenance', scope: 'RIDER' }))).toEqual(['SCOPE_NOT_ALLOWED']);
    expect(reasons(await refuse({ key: 'platform.geo-reverse', scope: 'ALL', cityCode: 'XXX' }))).toEqual(['UNKNOWN_CITY']);
    expect(reasons(await refuse({ key: 'platform.geo-reverse', scope: 'ALL', effectiveUntil: new Date(Date.now() - 1000).toISOString() }))).toEqual([
      'TIME_IN_PAST',
    ]);
    expect((await refuse({ key: 'admin.anything', scope: 'ALL' })).statusCode).toBe(400);
    expect((await refuse({ key: 'platform.geo-reverse', scope: 'ALL', state: 'ENABLED' })).statusCode).toBe(400);
    expect(await h.runtime.switches.isStopped('platform.geo-reverse')).toBe(false);
    await expect(h.runtime.switches.isStopped('rider.no-such-switch')).rejects.toThrow(/unknown runtime switch/);
    // an end time is stored for the worker's expiry
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const timed = await refuse({ key: 'platform.geo-reverse', scope: 'ALL', cityCode: 'LHR', effectiveUntil: until });
    expect(RuntimeSwitchChangeSchema.parse(timed.json())).toMatchObject({ cityCode: 'LHR', effectiveUntil: until });
    expect(await h.runtime.switches.isStopped('platform.geo-reverse', { cityCode: 'LHR' })).toBe(true);
    expect(await h.runtime.switches.isStopped('platform.geo-reverse')).toBe(false);
  });

  it('a RIDER-scoped stop never changes a driver route or the DRIVER scope', async () => {
    const rider = await signIn(h);
    const before = await h.inject({ method: 'GET', url: '/v1/driver/compliance', headers: bearer(rider.accessToken) });
    const stop = await as(rmA, 'POST', '/v1/admin/switches/safe-state-changes', { key: 'rider.quotes', scope: 'RIDER', reasonCode: 'RIDER_INCIDENT' });
    expect(stop.statusCode, stop.body).toBe(201);
    expect(await h.runtime.switches.isStopped('rider.quotes', { scope: 'RIDER' })).toBe(true);
    expect(await h.runtime.switches.isStopped('rider.quotes', { scope: 'DRIVER' })).toBe(false);
    const after = await h.inject({ method: 'GET', url: '/v1/driver/compliance', headers: bearer(rider.accessToken) });
    expect(after.statusCode).toBe(before.statusCode);
    const withoutRequestId = (body: string) => body.replace(/"requestId":"[^"]*"/, '');
    expect(withoutRequestId(after.body)).toBe(withoutRequestId(before.body));
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(rider.accessToken) })).statusCode).toBe(200);
  });

  it('maintenance: start = safe state (one staff member) ⇒ consumer 503, staff routes stay up; end = maker-checker', async () => {
    const expectedEnd = new Date(Date.now() + 1_800_000).toISOString();
    const start = await as(rmA, 'POST', '/v1/admin/switches/safe-state-changes', {
      key: 'platform.maintenance',
      scope: 'ALL',
      reasonCode: 'PLANNED_MAINTENANCE',
      messageKey: 'maintenance.planned',
      expectedEnd,
    });
    expect(start.statusCode, start.body).toBe(201);
    const consumer = await consumerState({});
    expect(consumer.statusCode).toBe(503);
    expect(ErrorEnvelopeSchema.parse(consumer.json()).error.details?.retryAfterSeconds).toBeGreaterThan(1700);
    const cfg = AppConfigSchema.parse((await h.inject({ method: 'GET', url: '/v1/app/config' })).json());
    expect(cfg.maintenance).toEqual({ active: true, messageKey: 'maintenance.planned', expectedEnd: new Date(expectedEnd).toISOString() });
    // staff keep working during maintenance and end it with two people
    const request = RuntimeSwitchChangeSchema.parse(
      (await as(rmA, 'POST', '/v1/admin/switches/restore-requests', { key: 'platform.maintenance', scope: 'ALL', reasonCode: 'MAINTENANCE_DONE' })).json(),
    );
    expect(request.toState).toBe('DISABLED');
    expect((await as(rmB, 'POST', `/v1/admin/switches/restore-requests/${request.id}/approval`, { decision: 'APPROVE' })).statusCode).toBe(200);
    expect((await consumerState({})).statusCode).toBe(401);
    expect(AppConfigSchema.parse((await h.inject({ method: 'GET', url: '/v1/app/config' })).json()).maintenance.active).toBe(false);
  });
});
