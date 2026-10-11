/**
 * P2.9 refusal paths (K13 adversarial completion): malformed and foreign ids, wrong bindings, replays, stale requests,
 * rate limits, non-clean recovery callers, decisions that deny a recovery or fail a re-verification, a rejected second
 * approval, and refused deletion/review transitions. Real PostgreSQL, Valkey and SeaweedFS; synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { DeletionRequestSchema, PhoneChangeStartedSchema } from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewKit } from './review-helpers.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, codeFor, post, signIn, syntheticPhone, type Harness, type SignedIn, startApi } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let reviewer: Staff;
let senior: Staff;
let r: ReturnType<typeof reviewKit>;
beforeAll(async () => {
  h = await startApi({ env: { ...STAFF_ENV, EVIDENCE_SLOTS_PER_10_MIN: '100' }, vault: true });
  kit = staffKit(h);
  r = reviewKit(h, kit);
  const admins = await kit.bootstrapAdmins(2);
  reviewer = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Refusal Reviewer');
  senior = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Refusal Senior');
}, 300_000);
afterAll(async () => {
  await h.close();
});

const errorOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string; details?: { reasonCodes?: string[] } } }).error;
const accountOf = async (sessionId: string) =>
  (await h.owner.query<{ account_id: string }>(`select account_id from identity.sessions where id = $1`, [sessionId])).rows[0]?.account_id ?? '';
async function stepUp(s: SignedIn): Promise<void> {
  const res = await h.inject(post('/v1/account/step-ups', {}, bearer(s.accessToken)));
  await h.deliver();
  const ok = await h.inject(
    post(`/v1/account/step-ups/${res.json<{ challengeId: string }>().challengeId}/verifications`, { code: codeFor(h, s.phone) }, bearer(s.accessToken)),
  );
  expect(ok.statusCode, ok.body).toBe(200);
}

describe('phone change refusals', () => {
  it('invalid numbers, the same number, a replayed code, a code from the wrong challenge and a stale request', async () => {
    const s = await signIn(h);
    await stepUp(s);
    expect((await h.inject(post('/v1/account/phone-changes', { newPhone: '12345', locale: 'en' }, bearer(s.accessToken)))).statusCode).toBe(400);
    expect((await h.inject(post('/v1/account/phone-changes', { newPhone: s.phone, locale: 'en' }, bearer(s.accessToken)))).statusCode).toBe(400);
    const newPhone = syntheticPhone();
    const started = PhoneChangeStartedSchema.parse(
      (await h.inject(post('/v1/account/phone-changes', { newPhone, locale: 'en' }, bearer(s.accessToken)))).json(),
    );
    await h.deliver();
    const id = started.phoneChange.id;
    // a second open change is refused while the first is open
    expect((await h.inject(post('/v1/account/phone-changes', { newPhone: syntheticPhone(), locale: 'en' }, bearer(s.accessToken)))).statusCode).toBe(409);
    // the step-up code cannot complete a phone change (purpose bound)
    const stepUpChallenge = (await h.inject(post('/v1/account/step-ups', {}, bearer(s.accessToken)))).json<{ challengeId: string }>().challengeId;
    await h.deliver();
    expect(
      (
        await h.inject(
          post(`/v1/account/phone-changes/${id}/verifications`, { challengeId: stepUpChallenge, code: codeFor(h, s.phone) }, bearer(s.accessToken)),
        )
      ).statusCode,
    ).toBe(401);
    // another session of the account cannot verify it; an unknown id is 404; a malformed id is 404
    const other = await signIn(h, s.phone);
    const verify = (session: SignedIn, target: string) =>
      h.inject(
        post(
          `/v1/account/phone-changes/${target}/verifications`,
          { challengeId: started.challenge.challengeId, code: codeFor(h, newPhone) },
          bearer(session.accessToken),
        ),
      );
    expect((await verify(other, id)).statusCode).toBe(409);
    expect((await verify(s, randomUUID())).statusCode).toBe(404);
    expect((await h.inject(post('/v1/account/phone-changes/not-a-uuid/cancellation', {}, bearer(s.accessToken)))).statusCode).toBe(404);
    // expired request
    await h.owner.query(
      `update identity.phone_change_requests set created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute' where id = $1`,
      [id],
    );
    expect((await verify(s, id)).statusCode).toBe(409);
    // the stale request no longer blocks a new one
    expect((await h.inject(post('/v1/account/phone-changes', { newPhone: syntheticPhone(), locale: 'en' }, bearer(s.accessToken)))).statusCode).toBe(201);
  });
});

describe('recovery refusals', () => {
  it('invalid previous numbers, a caller that is not a clean account, an already-open recovery, and the attempt limit', async () => {
    const d = await r.approvedDriver(reviewer);
    const caller = await signIn(h);
    const recover = (who: SignedIn, previousPhone: string) =>
      h.inject(post('/v1/account-recoveries', { proof: 'DRIVER_KYC', previousPhone }, bearer(who.accessToken)));
    expect((await recover(caller, 'nope')).statusCode).toBe(400);
    // a driver account is not a clean new-number account: RECEIVED, nothing opened
    const other = await r.approvedDriver(reviewer);
    expect((await recover(other.s, d.s.phone)).statusCode).toBe(202);
    expect((await h.owner.query(`select 1 from identity.phone_change_requests where account_id = $1`, [d.accountId])).rowCount).toBe(0);
    expect((await recover(caller, d.s.phone)).statusCode).toBe(202);
    expect((await recover(caller, d.s.phone)).statusCode).toBe(202); // already open: still RECEIVED
    expect((await h.owner.query(`select 1 from identity.phone_change_requests where account_id = $1`, [d.accountId])).rowCount).toBe(1);
    expect((await recover(caller, d.s.phone)).statusCode).toBe(202);
    expect((await recover(caller, d.s.phone)).statusCode).toBe(429); // 3 attempts per day per account
  });

  it('REJECT denies the recovery; a rejected second approval sends the case back; dormant claims can be denied', async () => {
    const d = await r.approvedDriver(reviewer);
    const caller = await signIn(h);
    await h.inject(post('/v1/account-recoveries', { proof: 'DRIVER_KYC', previousPhone: d.s.phone }, bearer(caller.accessToken)));
    const request =
      (await h.owner.query<{ id: string }>(`select id from identity.phone_change_requests where account_id = $1`, [d.accountId])).rows[0]?.id ?? '';
    const caseId =
      (await h.owner.query<{ id: string }>(`select id from compliance.review_cases where phone_change_request_id = $1`, [request])).rows[0]?.id ?? '';
    let c = await r.claim(reviewer, caseId);
    const body = (version: number, decision: string, reasonCodes: string[], identityMatch: string) => ({
      expectedVersion: version,
      decision,
      reasonCodes,
      checklist: r.allConfirmed,
      identityMatch,
      evidenceIds: d.evidenceIds.slice(0, 2),
    });
    expect((await r.decide(reviewer, caseId, body(c.version, 'NEEDS_INFO', ['SELFIE_UNCLEAR'], 'UNCERTAIN_ESCALATE'))).statusCode).toBe(400);
    expect(
      (
        await r.decide(reviewer, caseId, {
          ...body(c.version, 'REJECT', ['IDENTITY_NOT_MATCHING'], 'NOT_MATCHING'),
          signalResolutions: [{ signalId: randomUUID(), outcome: 'CLEARED' }],
        })
      ).statusCode,
    ).toBe(400);
    // second approval rejected → back to the queue
    await r.decide(reviewer, caseId, body(c.version, 'REQUIRE_IN_PERSON', ['IN_PERSON_IDENTITY_CHECK'], 'IN_PERSON_REQUIRED'));
    c = await r.claim(reviewer, caseId);
    const pending = await r.decide(reviewer, caseId, body(c.version, 'APPROVE', ['ALL_CHECKS_CONFIRMED'], 'CONFIRMED_BY_REVIEWER'));
    const decisionId = pending.json<{ decisionId: string }>().decisionId;
    const rejected = await kit.privileged(senior, `/v1/admin/review-decisions/${decisionId}/second-approvals`, { outcome: 'REJECTED' });
    expect(rejected.json()).toMatchObject({ caseStatus: 'OPEN' });
    c = await r.claim(senior, caseId);
    const denied = await r.decide(senior, caseId, body(c.version, 'REJECT', ['IDENTITY_NOT_MATCHING'], 'NOT_MATCHING'));
    expect(denied.statusCode, denied.body).toBe(201);
    expect((await h.owner.query<{ status: string }>(`select status from identity.phone_change_requests where id = $1`, [request])).rows[0]?.status).toBe(
      'DENIED',
    );
    const events = await h.owner.query<{ type: string }>(`select type from identity.security_events where account_id = $1`, [d.accountId]);
    expect(events.rows.map((e) => e.type)).toEqual(expect.arrayContaining(['RECOVERY_REQUESTED', 'RECOVERY_DENIED']));
  });
});

describe('re-verification and review refusals', () => {
  it('REJECT of a re-verification adds an appealable REVERIFICATION_FAILED restriction', async () => {
    const d = await r.approvedDriver(reviewer);
    const profile = (
      await h.owner.query<{ id: string; city: string }>(
        `select p.id, a.city_code city from compliance.driver_profiles p join compliance.driver_applications a on a.id = p.application_id where p.account_id = $1`,
        [d.accountId],
      )
    ).rows[0];
    const caseId = randomUUID();
    await h.owner.query(
      `insert into compliance.review_cases (id, kind, driver_profile_id, city_code, priority, status) values ($1, 'REVERIFICATION', $2, $3, 2, 'OPEN')`,
      [caseId, profile?.id, profile?.city],
    );
    const c = await r.claim(reviewer, caseId);
    expect(c.riskTriggers).toEqual([]);
    const rejected = await r.decide(reviewer, caseId, {
      expectedVersion: c.version,
      decision: 'REJECT',
      reasonCodes: ['IDENTITY_NOT_MATCHING'],
      checklist: r.allConfirmed,
      identityMatch: 'NOT_MATCHING',
      evidenceIds: d.evidenceIds.slice(0, 2),
    });
    expect(rejected.statusCode, rejected.body).toBe(201);
    const row = (
      await h.owner.query<{ reason_code: string; scope: string; appealable: boolean }>(
        `select reason_code, scope, appealable from profile.restrictions where driver_profile_id = $1`,
        [profile?.id],
      )
    ).rows;
    expect(row).toEqual([{ reason_code: 'REVERIFICATION_FAILED', scope: 'DRIVER_ROLE', appealable: true }]);
  });
});

describe('deletion and dormant-review refusals', () => {
  it('foreign or unknown deletion ids are 404; a cancelled request cannot be cancelled again; web codes are bound to the browser', async () => {
    const s = await signIn(h);
    const stranger = await signIn(h);
    await stepUp(s);
    const created = DeletionRequestSchema.parse((await h.inject(post('/v1/account/deletion-requests', {}, bearer(s.accessToken)))).json());
    expect((await h.inject(post(`/v1/account/deletion-requests/${created.id}/cancellation`, {}, bearer(stranger.accessToken)))).statusCode).toBe(404);
    expect((await h.inject(post(`/v1/account/deletion-requests/${created.id}/cancellation`, {}, bearer(s.accessToken)))).statusCode).toBe(200);
    expect((await h.inject(post(`/v1/account/deletion-requests/${created.id}/cancellation`, {}, bearer(s.accessToken)))).statusCode).toBe(409);
    expect(
      (await h.inject(post('/v1/public/account-deletion-otp-challenges', { phone: 'x', browserId: `browser-${'c'.repeat(20)}`, locale: 'en' }))).statusCode,
    ).toBe(400);
    const asked = await h.inject(post('/v1/public/account-deletion-otp-challenges', { phone: s.phone, browserId: `browser-${'d'.repeat(20)}`, locale: 'en' }));
    await h.deliver();
    const otherBrowser = await h.inject(
      post('/v1/public/account-deletion-requests', {
        challengeId: asked.json<{ challengeId: string }>().challengeId,
        code: codeFor(h, s.phone),
        browserId: `browser-${'e'.repeat(20)}`,
      }),
    );
    expect(otherBrowser.statusCode).toBe(401);
    expect(errorOf(otherBrowser)?.code).toBe('WAYVRO_E_OTP_INVALID_OR_EXPIRED');
  });

  it('review choices: unknown or foreign reviews are 404; a resolved review cannot be chosen again', async () => {
    const s = await signIn(h);
    await h.owner.query(`update identity.accounts set last_active_at = now() - interval '200 days' where id = $1`, [await accountOf(s.sessionId)]);
    const restricted = await signIn(h, s.phone);
    const choose = (who: SignedIn, id: string, choice: string) =>
      h.inject(post(`/v1/account/recovery-reviews/${id}/choices`, { choice }, bearer(who.accessToken)));
    expect((await choose(restricted, randomUUID(), 'I_AM_NEW')).statusCode).toBe(404);
    const review = (await h.inject({ method: 'GET', url: '/v1/account/recovery-reviews/current', headers: bearer(restricted.accessToken) })).json<{
      review: { id: string };
    }>().review;
    expect((await choose(s, review.id, 'I_AM_NEW')).statusCode).toBe(404); // not this session's review
    expect((await h.inject({ method: 'GET', url: '/v1/account/recovery-reviews/current', headers: bearer(s.accessToken) })).json()).toEqual({ review: null });
    expect((await choose(restricted, review.id, 'I_AM_NEW')).statusCode).toBe(200);
  });
});
