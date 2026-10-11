/**
 * P2.9 account security through the API, against REAL PostgreSQL (restricted roles), Valkey and SeaweedFS: consumer
 * step-up (SEC-K17), self-service phone change with the generic conflict refusal and the new-device cooldown (S13,
 * K08), "this wasn't me", the driver risk policy (RISK_HOLD + REVERIFICATION case, founder Q-14), lost-phone recovery
 * with strong proof only (SEC-RECOVERY: in-person check + second senior approver + cooldown), the dormant-number review
 * (SEC-S12: restricted session, no bypass by re-signing in, "I'm new" = clean account + SECURITY_HOLD) and deletion in
 * the app and on the web (SEC-DEL: step-up, grace, blockers, restricted session, generic web answers). The worker's
 * cooldown completion and deletion processing are covered in apps/worker. Synthetic data only.
 */
import {
  CurrentDeletionRequestSchema,
  DeletionRequestSchema,
  PhoneChangeStartedSchema,
  RecoveryReviewOutcomeSchema,
  SessionCreatedSchema,
} from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewKit, type Ready } from './review-helpers.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, codeFor, device, installation, post, requestCode, signIn, syntheticPhone, type Harness, type SignedIn, startApi } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let reviewer: Staff;
let senior2: Staff;
let r: ReturnType<typeof reviewKit>;
beforeAll(async () => {
  h = await startApi({ env: { ...STAFF_ENV, EVIDENCE_SLOTS_PER_10_MIN: '100' }, vault: true });
  kit = staffKit(h);
  r = reviewKit(h, kit);
  const admins = await kit.bootstrapAdmins(2);
  reviewer = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Security Reviewer');
  senior2 = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Security Senior Two');
}, 300_000);
afterAll(async () => {
  await h.close();
});

type Session = Pick<SignedIn, 'phone' | 'accessToken' | 'sessionId'>;
const get = (url: string, s: Session) => h.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
const errorOf = (res: { json: () => unknown }) =>
  (res.json() as { error?: { code: string; details?: { reasonCodes?: string[]; retryAfterSeconds?: number } } }).error;
const accountOf = async (sessionId: string) =>
  (await h.owner.query<{ account_id: string }>(`select account_id from identity.sessions where id = $1`, [sessionId])).rows[0]?.account_id ?? '';

async function stepUp(s: Session): Promise<void> {
  const res = await h.inject(post('/v1/account/step-ups', {}, bearer(s.accessToken)));
  expect(res.statusCode, res.body).toBe(202);
  await h.deliver();
  const verified = await h.inject(
    post(`/v1/account/step-ups/${res.json<{ challengeId: string }>().challengeId}/verifications`, { code: codeFor(h, s.phone) }, bearer(s.accessToken)),
  );
  expect(verified.statusCode, verified.body).toBe(200);
}

async function changePhone(s: Session, newPhone: string): Promise<{ id: string; challengeId: string }> {
  const res = await h.inject(post('/v1/account/phone-changes', { newPhone, locale: 'en' }, bearer(s.accessToken)));
  expect(res.statusCode, res.body).toBe(201);
  const started = PhoneChangeStartedSchema.parse(res.json());
  await h.deliver();
  return { id: started.phoneChange.id, challengeId: started.challenge.challengeId };
}

describe('step-up (A11/K17)', () => {
  it('a young session needs a fresh step-up for revoke-all; the code is bound to the session', async () => {
    const s = await signIn(h);
    const other = await signIn(h, s.phone);
    await h.owner.query(`update identity.sessions set created_at = now() - interval '1 hour' where id = $1`, [s.sessionId]);
    const revokeAll = () => h.inject(post('/v1/account/session-revocations', { scope: 'ALL_OTHERS' }, bearer(s.accessToken)));
    expect(errorOf(await revokeAll())?.code).toBe('WAYVRO_E_STEP_UP_REQUIRED');
    // a step-up code requested by one session cannot be verified by another session of the same account
    const challenge = await h.inject(post('/v1/account/step-ups', {}, bearer(s.accessToken)));
    await h.deliver();
    const id = challenge.json<{ challengeId: string }>().challengeId;
    expect((await h.inject(post(`/v1/account/step-ups/${id}/verifications`, { code: codeFor(h, s.phone) }, bearer(other.accessToken)))).statusCode).toBe(401);
    expect((await h.inject(post(`/v1/account/step-ups/${id}/verifications`, { code: '000000' }, bearer(s.accessToken)))).statusCode).toBe(401);
    expect((await h.inject(post(`/v1/account/step-ups/${id}/verifications`, { code: codeFor(h, s.phone) }, bearer(s.accessToken)))).statusCode).toBe(200);
    const state = (await get('/v1/account/state', s)).json<{ session: { stepUpExpiresAt: string | null } }>();
    expect(Date.parse(state.session.stepUpExpiresAt ?? '')).toBeGreaterThan(Date.now());
    expect((await revokeAll()).json()).toEqual({ revokedCount: 1 });
    expect((await get('/v1/account/state', other)).statusCode).toBe(401);
  });
});

describe('self-service phone change (A05/S13/K08)', () => {
  it('needs a step-up, moves the number, revokes other sessions and releases the old number for a new owner', async () => {
    const s = await signIn(h);
    const second = await signIn(h, s.phone);
    const accountId = await accountOf(s.sessionId);
    const newPhone = syntheticPhone();
    expect(errorOf(await h.inject(post('/v1/account/phone-changes', { newPhone, locale: 'en' }, bearer(s.accessToken))))?.code).toBe(
      'WAYVRO_E_STEP_UP_REQUIRED',
    );
    await stepUp(s);
    const change = await changePhone(s, newPhone);
    // the code went to the NEW number only
    const verified = await h.inject(
      post(`/v1/account/phone-changes/${change.id}/verifications`, { challengeId: change.challengeId, code: codeFor(h, newPhone) }, bearer(s.accessToken)),
    );
    expect(verified.statusCode, verified.body).toBe(200);
    expect(verified.json()).toMatchObject({ status: 'COMPLETED', kind: 'SELF_SERVICE' });
    expect((await get('/v1/account/state', second)).statusCode).toBe(401); // other sessions revoked (PHONE_CHANGED)
    expect((await get('/v1/account/state', s)).statusCode).toBe(200);
    const events = await h.owner.query<{ type: string }>(`select type from identity.security_events where account_id = $1`, [accountId]);
    expect(events.rows.map((e) => e.type)).toEqual(expect.arrayContaining(['STEP_UP_VERIFIED', 'PHONE_CHANGE_REQUESTED', 'PHONE_CHANGED']));
    // the new number signs into the same account; the old number now starts a different, new account
    expect(await accountOf((await signIn(h, newPhone)).sessionId)).toBe(accountId);
    const fresh = await signIn(h, s.phone);
    expect(fresh.isNewAccount).toBe(true);
    expect(await accountOf(fresh.sessionId)).not.toBe(accountId);
  });

  it('a number current on another account is refused with the generic conflict; nothing changes or merges', async () => {
    const s = await signIn(h);
    const owner = await signIn(h);
    await stepUp(s);
    const change = await changePhone(s, owner.phone);
    const res = await h.inject(
      post(`/v1/account/phone-changes/${change.id}/verifications`, { challengeId: change.challengeId, code: codeFor(h, owner.phone) }, bearer(s.accessToken)),
    );
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({ code: 'WAYVRO_E_CONFLICT' });
    expect(JSON.stringify(res.json())).not.toMatch(/another|exists|registered|owner/i);
    expect(await accountOf((await signIn(h, owner.phone)).sessionId)).toBe(await accountOf(owner.sessionId));
    expect(await accountOf((await signIn(h, s.phone)).sessionId)).toBe(await accountOf(s.sessionId));
  });

  it('a session on a device first seen within 24 h waits (SIM-swap pattern); "this wasn\'t me" cancels from any session', async () => {
    const s = await signIn(h);
    await h.owner.query(`update identity.account_devices set first_verified_at = now() - interval '30 days' where account_id = $1`, [
      await accountOf(s.sessionId),
    ]);
    const fresh = await signIn(h, s.phone, installation());
    await stepUp(fresh);
    const waiting = await h.inject(post('/v1/account/phone-changes', { newPhone: syntheticPhone(), locale: 'en' }, bearer(fresh.accessToken)));
    expect(waiting.statusCode).toBe(409);
    expect(errorOf(waiting)?.details?.reasonCodes).toEqual(['NEW_DEVICE_COOLDOWN']);
    expect(errorOf(waiting)?.details?.retryAfterSeconds).toBeGreaterThan(23 * 3600);
    // the established device can change the number; the new device sees the open change and cancels it
    await stepUp(s);
    const change = await changePhone(s, syntheticPhone());
    const current = (await get('/v1/account/phone-changes/current', fresh)).json<{ phoneChange: { id: string; status: string } | null }>();
    expect(current.phoneChange).toMatchObject({ id: change.id, status: 'CURRENT_PHONE_VERIFIED' });
    const cancelled = await h.inject(post(`/v1/account/phone-changes/${change.id}/cancellation`, {}, bearer(fresh.accessToken)));
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });
    expect((await h.inject(post(`/v1/account/phone-changes/${change.id}/cancellation`, {}, bearer(fresh.accessToken)))).statusCode).toBe(409);
    expect((await get('/v1/account/phone-changes/current', s)).json()).toEqual({ phoneChange: null });
    const stranger = await signIn(h);
    expect((await h.inject(post(`/v1/account/phone-changes/${change.id}/cancellation`, {}, bearer(stranger.accessToken)))).statusCode).toBe(404);
  });
});

describe('driver risk policy (founder Q-14; REVERIFICATION)', () => {
  it('a driver phone change places a temporary appealable RISK_HOLD and a REVERIFICATION case; APPROVE lifts it', async () => {
    const d = await r.approvedDriver(reviewer);
    await stepUp(d.s);
    const newPhone = syntheticPhone();
    const change = await changePhone(d.s, newPhone);
    const done = await h.inject(
      post(`/v1/account/phone-changes/${change.id}/verifications`, { challengeId: change.challengeId, code: codeFor(h, newPhone) }, bearer(d.s.accessToken)),
    );
    expect(done.statusCode, done.body).toBe(200);
    const hold = (
      await h.owner.query<{ id: string; reason_code: string; appealable: boolean; hours: number }>(
        `select r.id, r.reason_code, r.appealable, extract(epoch from r.effective_until - now()) / 3600 hours
           from profile.restrictions r join compliance.driver_profiles p on p.id = r.driver_profile_id
          where p.account_id = $1 and r.reason_class = 'RISK_HOLD' and r.status = 'ACTIVE'`,
        [d.accountId],
      )
    ).rows[0];
    expect(hold).toMatchObject({ reason_code: 'RISK_PHONE_CHANGED', appealable: true });
    expect(Number(hold?.hours)).toBeGreaterThan(71);
    // rider-mode use is unaffected: the account itself is not restricted
    expect((await get('/v1/account/state', d.s)).statusCode).toBe(200);
    const caseId = (
      await h.owner.query<{ id: string }>(
        `select c.id from compliance.review_cases c join compliance.driver_profiles p on p.id = c.driver_profile_id where p.account_id = $1 and c.kind = 'REVERIFICATION' and c.status = 'OPEN'`,
        [d.accountId],
      )
    ).rows[0]?.id;
    expect(caseId).toBeDefined();
    const c = await r.claim(reviewer, caseId ?? '');
    expect(c).toMatchObject({ kind: 'REVERIFICATION', riskTriggers: ['RISK_PHONE_CHANGED'] });
    const base = { expectedVersion: c.version, checklist: r.allConfirmed, evidenceIds: d.evidenceIds.slice(0, 3), identityMatch: 'CONFIRMED_BY_REVIEWER' };
    expect((await r.decide(reviewer, caseId ?? '', { ...base, decision: 'NEEDS_INFO', reasonCodes: ['SELFIE_UNCLEAR'] })).statusCode).toBe(400);
    const approved = await r.decide(reviewer, caseId ?? '', { ...base, decision: 'APPROVE', reasonCodes: ['ALL_CHECKS_CONFIRMED'] });
    expect(approved.statusCode, approved.body).toBe(201);
    expect((await h.owner.query<{ status: string }>(`select status from profile.restrictions where id = $1`, [hold?.id])).rows[0]?.status).toBe('LIFTED');
  });
});

describe('lost-phone recovery — strong proof only (SEC-RECOVERY)', () => {
  it('DRIVER_KYC opens a case that needs an in-person check and a second senior; every caller sees RECEIVED', async () => {
    const d: Ready = await r.approvedDriver(reviewer);
    const rider = await signIn(h);
    const caller = await signIn(h); // the new number: a clean new account
    const recover = (body: Record<string, unknown>) => h.inject(post('/v1/account-recoveries', body, bearer(caller.accessToken)));
    expect((await recover({ proof: 'LINKED_OIDC', previousPhone: d.s.phone })).statusCode).toBe(404); // P2.10
    const riderAttempt = await recover({ proof: 'DRIVER_KYC', previousPhone: rider.phone });
    const driverAttempt = await recover({ proof: 'DRIVER_KYC', previousPhone: d.s.phone });
    expect([riderAttempt.statusCode, driverAttempt.statusCode]).toEqual([202, 202]);
    expect(riderAttempt.json()).toEqual(driverAttempt.json());
    expect((await h.owner.query(`select 1 from identity.phone_change_requests where account_id = $1`, [await accountOf(rider.sessionId)])).rowCount).toBe(0);
    // the driver's own sessions see the open recovery ("cancel if this wasn't you")
    const open = (await get('/v1/account/phone-changes/current', d.s)).json<{ phoneChange: { id: string; kind: string; status: string } }>().phoneChange;
    expect(open).toMatchObject({ kind: 'RECOVERY_DRIVER_KYC', status: 'MANUAL_REVIEW' });
    const caseId =
      (await h.owner.query<{ id: string }>(`select id from compliance.review_cases where phone_change_request_id = $1`, [open.id])).rows[0]?.id ?? '';
    let c = await r.claim(reviewer, caseId);
    expect(c).toMatchObject({ kind: 'ACCOUNT_RECOVERY', recovery: { kind: 'LOST_PHONE' } });
    const approve = (version: number) => ({
      expectedVersion: version,
      decision: 'APPROVE',
      reasonCodes: ['ALL_CHECKS_CONFIRMED'],
      checklist: r.allConfirmed,
      identityMatch: 'CONFIRMED_BY_REVIEWER',
      evidenceIds: d.evidenceIds.slice(0, 3),
    });
    const early = await r.decide(reviewer, caseId, approve(c.version));
    expect(early.statusCode).toBe(409);
    expect(errorOf(early)?.details?.reasonCodes).toEqual(['IN_PERSON_CHECK_REQUIRED']);
    const inPerson = await r.decide(reviewer, caseId, {
      ...approve(c.version),
      decision: 'REQUIRE_IN_PERSON',
      reasonCodes: ['IN_PERSON_IDENTITY_CHECK'],
    });
    expect(inPerson.statusCode, inPerson.body).toBe(201);
    c = await r.claim(reviewer, caseId);
    const pending = await r.decide(reviewer, caseId, approve(c.version));
    expect(pending.statusCode, pending.body).toBe(201);
    expect(pending.json()).toMatchObject({ pendingSecondApproval: true, caseStatus: 'ESCALATED' });
    const decisionId = pending.json<{ decisionId: string }>().decisionId;
    const second = await kit.privileged(senior2, `/v1/admin/review-decisions/${decisionId}/second-approvals`, { outcome: 'APPROVED' });
    expect(second.statusCode, second.body).toBe(200);
    const request = (
      await h.owner.query<{ status: string; hours: number }>(
        `select status, extract(epoch from cooldown_until - now()) / 3600 hours from identity.phone_change_requests where id = $1`,
        [open.id],
      )
    ).rows[0];
    expect(request?.status).toBe('COOLDOWN');
    expect(Number(request?.hours)).toBeGreaterThan(71);
    // the owner can still stop it during the cooldown
    const cancelled = await h.inject(post(`/v1/account/phone-changes/${open.id}/cancellation`, {}, bearer(d.s.accessToken)));
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });
  });
});

describe('dormant-number review (SEC-S12)', () => {
  async function dormantSignIn(s: SignedIn): Promise<SignedIn & { requiredActions: string[] }> {
    await h.owner.query(`update identity.accounts set last_active_at = now() - interval '120 days' where id = $1`, [await accountOf(s.sessionId)]);
    const inst = installation();
    const challengeId = await requestCode(h, s.phone, inst);
    const res = await h.inject(post('/v1/auth/sessions', { challengeId, code: codeFor(h, s.phone), installationId: inst, device }));
    const body = SessionCreatedSchema.parse(res.json());
    return { phone: s.phone, installationId: inst, ...body };
  }

  it('restricts the session, survives re-sign-in, and "I\'m new" gives a clean account while the old one is held', async () => {
    const old = await signIn(h);
    const oldAccount = await accountOf(old.sessionId);
    const restricted = await dormantSignIn(old);
    expect(restricted.requiredActions).toEqual(['RECOVERY_REVIEW']);
    expect(await accountOf(restricted.sessionId)).toBe(oldAccount);
    for (const url of ['/v1/account/state', '/v1/account/sessions', '/v1/account/security-events', '/v1/account/phone-changes/current']) {
      expect(errorOf(await get(url, restricted))?.code).toBe('WAYVRO_E_RECOVERY_REQUIRED');
    }
    const review = (await get('/v1/account/recovery-reviews/current', restricted)).json<{ review: { id: string; choices: string[] } }>().review;
    expect(review.choices).toEqual(['I_AM_NEW']); // rider-only: no strong proof exists
    expect(
      (await h.inject(post(`/v1/account/recovery-reviews/${review.id}/choices`, { choice: 'THIS_IS_MY_ACCOUNT' }, bearer(restricted.accessToken)))).statusCode,
    ).toBe(409);
    // signing in again on the same new installation does not turn it into a known device
    const again = await (async () => {
      const challengeId = await requestCode(h, old.phone, restricted.installationId);
      return SessionCreatedSchema.parse(
        (await h.inject(post('/v1/auth/sessions', { challengeId, code: codeFor(h, old.phone), installationId: restricted.installationId, device }))).json(),
      );
    })();
    expect(again.requiredActions).toEqual(['RECOVERY_REVIEW']);
    const outcome = await h.inject(post(`/v1/account/recovery-reviews/${review.id}/choices`, { choice: 'I_AM_NEW' }, bearer(restricted.accessToken)));
    expect(outcome.statusCode, outcome.body).toBe(200);
    const parsed = RecoveryReviewOutcomeSchema.parse(outcome.json());
    expect(parsed.review.status).toBe('RESOLVED_NEW_ACCOUNT');
    const fresh = parsed.newAccountSession;
    expect(fresh?.isNewAccount).toBe(true);
    const freshAccount = await accountOf(fresh?.sessionId ?? '');
    expect(freshAccount).not.toBe(oldAccount);
    const state = await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(fresh?.accessToken ?? '') });
    expect(state.statusCode).toBe(200);
    expect(state.json<{ account: { id: string; displayName: string | null } }>().account).toMatchObject({ id: freshAccount, displayName: null });
    // the old account: number released, SECURITY_HOLD (appealable), every session revoked
    expect((await get('/v1/account/state', old)).statusCode).toBe(401);
    expect((await get('/v1/account/state', restricted)).statusCode).toBe(401);
    const hold = (
      await h.owner.query<{ reason_class: string; appealable: boolean }>(`select reason_class, appealable from profile.restrictions where account_id = $1`, [
        oldAccount,
      ])
    ).rows;
    expect(hold).toEqual([{ reason_class: 'SECURITY_HOLD', appealable: true }]);
    expect(await accountOf((await signIn(h, old.phone)).sessionId)).toBe(freshAccount);
  });

  it('a dormant DRIVER account can be claimed: an ACCOUNT_RECOVERY case keeps the session restricted', async () => {
    const d = await r.approvedDriver(reviewer);
    const restricted = await dormantSignIn(d.s);
    const review = (await get('/v1/account/recovery-reviews/current', restricted)).json<{ review: { id: string; choices: string[] } }>().review;
    expect(review.choices).toEqual(['I_AM_NEW', 'THIS_IS_MY_ACCOUNT']);
    const claimed = await h.inject(post(`/v1/account/recovery-reviews/${review.id}/choices`, { choice: 'THIS_IS_MY_ACCOUNT' }, bearer(restricted.accessToken)));
    expect(RecoveryReviewOutcomeSchema.parse(claimed.json())).toMatchObject({
      review: { status: 'IN_REVIEW', choices: ['I_AM_NEW'] },
      newAccountSession: null,
    });
    expect(errorOf(await get('/v1/account/state', restricted))?.code).toBe('WAYVRO_E_RECOVERY_REQUIRED');
    const c = (await h.owner.query<{ kind: string }>(`select kind from compliance.review_cases where dormant_number_review_id = $1`, [review.id])).rows;
    expect(c).toEqual([{ kind: 'ACCOUNT_RECOVERY' }]);
    expect((await get('/v1/account/state', d.s)).statusCode).toBe(200); // the owner's existing session is unaffected
  });
});

describe('account deletion (SEC-DEL; U06)', () => {
  it('app: step-up → GRACE with retained categories → restricted session → cancel; one open request', async () => {
    const s = await signIn(h);
    expect(errorOf(await h.inject(post('/v1/account/deletion-requests', {}, bearer(s.accessToken))))?.code).toBe('WAYVRO_E_STEP_UP_REQUIRED');
    await stepUp(s);
    const created = await h.inject(post('/v1/account/deletion-requests', {}, bearer(s.accessToken)));
    expect(created.statusCode, created.body).toBe(201);
    const request = DeletionRequestSchema.parse(created.json());
    expect(request).toMatchObject({ status: 'GRACE', channel: 'APP', blockers: [] });
    expect((Date.parse(request.graceUntil ?? '') - Date.now()) / 86_400_000).toBeGreaterThan(13.9);
    expect(request.retained.map((x) => x.dataCategory)).toEqual(['CONSENT_AND_AGE_RECORDS', 'SECURITY_AND_AUDIT_RECORDS']);
    expect(request.retained.every((x) => x.basisRef.includes('EG-16'))).toBe(true);
    expect((await get('/v1/account/state', s)).json<{ account: { status: string } }>().account.status).toBe('DELETION_PENDING');
    const blocked = await h.inject({
      method: 'PATCH',
      url: '/v1/account/profile',
      payload: { displayName: 'Synthetic' },
      headers: { ...bearer(s.accessToken), 'idempotency-key': `idem-${'b'.repeat(20)}` },
    });
    expect(errorOf(blocked)).toMatchObject({ code: 'WAYVRO_E_ACCOUNT_RESTRICTED', details: { reasonCodes: ['DELETION_PENDING'] } });
    expect((await h.inject(post('/v1/account/deletion-requests', {}, bearer(s.accessToken)))).statusCode).toBe(409);
    const cancelled = await h.inject(post(`/v1/account/deletion-requests/${request.id}/cancellation`, {}, bearer(s.accessToken)));
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });
    expect((await get('/v1/account/state', s)).json<{ account: { status: string } }>().account.status).toBe('ACTIVE');
    expect(CurrentDeletionRequestSchema.parse((await get('/v1/account/deletion-requests/current', s)).json())).toEqual({ deletionRequest: null });
  });

  it('a legal hold blocks the request explicitly', async () => {
    const s = await signIn(h);
    await h.owner.query(
      `insert into profile.restrictions (id, scope, account_id, reason_code, reason_class, status, appealable, created_by_system) values (gen_random_uuid(), 'ACCOUNT', $1, 'LEGAL_HOLD_ORDER', 'LEGAL', 'ACTIVE', false, 'test-fixture')`,
      [await accountOf(s.sessionId)],
    );
    await stepUp(s);
    const created = await h.inject(post('/v1/account/deletion-requests', {}, bearer(s.accessToken)));
    expect(DeletionRequestSchema.parse(created.json())).toMatchObject({ status: 'BLOCKED', blockers: ['LEGAL_HOLD'] });
  });

  it('web: identical answers whether or not the number has an account; a valid code records the request', async () => {
    const s = await signIn(h);
    const unknown = syntheticPhone();
    const browserId = `browser-${'a'.repeat(20)}`;
    const ask = (phone: string) => h.inject(post('/v1/public/account-deletion-otp-challenges', { phone, browserId, locale: 'en' }));
    const a = await ask(unknown);
    const b = await ask(s.phone);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect(Object.keys(a.json<object>()).sort()).toEqual(Object.keys(b.json<object>()).sort());
    await h.deliver();
    expect(h.sink.messagesFor(unknown, 5)).toHaveLength(0); // no SMS to a number without an account
    const record = (challengeId: string, code: string) => h.inject(post('/v1/public/account-deletion-requests', { challengeId, code, browserId }));
    expect((await record(a.json<{ challengeId: string }>().challengeId, '123456')).statusCode).toBe(401);
    const ok = await record(b.json<{ challengeId: string }>().challengeId, codeFor(h, s.phone));
    expect(ok.statusCode, ok.body).toBe(202);
    expect(ok.json()).toEqual({ status: 'RECEIVED' });
    const rows = await h.owner.query<{ channel: string; status: string }>(
      `select channel, status from identity.account_deletion_requests where account_id = $1`,
      [await accountOf(s.sessionId)],
    );
    expect(rows.rows).toEqual([{ channel: 'WEB', status: 'GRACE' }]);
  });
});
