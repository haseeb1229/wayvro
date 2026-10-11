/**
 * P2.7 refusal paths against real PostgreSQL/Valkey/SeaweedFS (SEC-REV, SEC-IDOR): unknown/foreign ids, city scope,
 * conflict of interest, leases, versions, decision permissions, incomplete claims, unknown signals, escalation and
 * in-person routing, second-approval rejection, appeal refusals, pagination cursors (tampered cursors are 400) and the
 * auditor's log filters. Every refusal changes nothing and is answered with a stable code. Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewKit } from './review-helpers.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, post, signIn, startApi, type Harness } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let r: ReturnType<typeof reviewKit>;
let admins: Staff[];
let reviewer: Staff;
let senior: Staff;
let senior2: Staff;
let trustSafety: Staff;
let auditor: Staff;
beforeAll(async () => {
  h = await startApi({ env: { ...STAFF_ENV, EVIDENCE_SLOTS_PER_10_MIN: '100' }, vault: true });
  kit = staffKit(h);
  r = reviewKit(h, kit);
  admins = await kit.bootstrapAdmins(2);
  reviewer = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Reviewer R');
  senior = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Senior R1');
  senior2 = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Senior R2');
  trustSafety = await kit.staffWithRole(admins, 'TRUST_SAFETY_AGENT', 'TS R');
  auditor = await kit.staffWithRole(admins, 'AUDITOR', 'Auditor R');
}, 300_000);
afterAll(async () => {
  await h.close();
});

const code = (res: { json: () => unknown }) => (res.json() as { error?: { code: string; details?: { reasonCodes?: string[] } } }).error;
const unknown = () => randomUUID();

describe('queue and claims', () => {
  it('pagination cursors work and tampered cursors are 400; unknown, foreign-city and conflicted cases are refused', async () => {
    const a = await r.submittedApplication();
    const b = await r.submittedApplication();
    await r.intake(a.appId);
    const other = await r.intake(b.appId);
    const page1 = (await r.get('/v1/admin/review-cases?limit=1', kit.sb(reviewer))).json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = (await r.get(`/v1/admin/review-cases?limit=1&cursor=${page1.nextCursor ?? ''}`, kit.sb(reviewer))).json<{ items: Array<{ id: string }> }>();
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
    expect((await r.get('/v1/admin/review-cases?cursor=bm90LWEtY3Vyc29y', kit.sb(reviewer))).statusCode).toBe(400);
    expect((await r.get('/v1/admin/review-cases?status=DECIDED', kit.sb(reviewer))).statusCode).toBe(400);
    expect((await h.inject(post(`/v1/admin/review-cases/${unknown()}/claim`, {}, kit.sb(reviewer)))).statusCode).toBe(404);
    expect((await h.inject(post(`/v1/admin/review-cases/${unknown()}/release`, {}, kit.sb(reviewer)))).statusCode).toBe(404);
    expect((await r.get(`/v1/admin/review-cases/${unknown()}`, kit.sb(senior))).statusCode).toBe(404);
    // another city
    await h.owner.query(
      `insert into catalog.cities (code, name_en, name_ur, status) values ('ISB', 'Synthetic City', 'مصنوعی', 'ENABLED') on conflict do nothing`,
    );
    await h.owner.query(`update compliance.review_cases set city_code = 'ISB' where id = $1`, [other]);
    expect((await h.inject(post(`/v1/admin/review-cases/${other}/claim`, {}, kit.sb(reviewer)))).statusCode).toBe(403);
    expect((await r.get(`/v1/admin/review-cases/${other}`, kit.sb(senior))).statusCode).toBe(403);
    await h.owner.query(`update compliance.review_cases set city_code = 'LHR' where id = $1`, [other]);
    // conflict of interest
    await h.owner.query(`update staff.staff_accounts set consumer_account_id = $2 where id = $1`, [reviewer.staffId, b.accountId]);
    expect((await h.inject(post(`/v1/admin/review-cases/${other}/claim`, {}, kit.sb(reviewer)))).statusCode).toBe(403);
    await h.owner.query(`update staff.staff_accounts set consumer_account_id = null where id = $1`, [reviewer.staffId]);
    // release by someone who does not hold the claim
    await r.claim(reviewer, other);
    expect((await h.inject(post(`/v1/admin/review-cases/${other}/release`, {}, kit.sb(senior)))).statusCode).toBe(409);
    expect((await h.inject(post(`/v1/admin/review-cases/${other}/claim`, {}, kit.sb(trustSafety)))).statusCode).toBe(403); // no permission
  });
});

describe('decision refusals and routing', () => {
  it('escalation goes to seniors; in-person keeps the case open; incomplete claims and unknown signals are refused', async () => {
    const a = await r.submittedApplication();
    const caseId = await r.intake(a.appId);
    let c = await r.claim(reviewer, caseId);
    const base = { checklist: r.allConfirmed, evidenceIds: a.evidenceIds.slice(0, 1) };
    expect((await r.decide(reviewer, unknown(), { ...base, expectedVersion: 1, decision: 'ESCALATE', reasonCodes: ['SENIOR_REVIEW_NEEDED'] })).statusCode).toBe(
      404,
    );
    expect(
      code(
        await r.decide(reviewer, caseId, {
          ...base,
          expectedVersion: c.version,
          decision: 'REJECT',
          reasonCodes: ['LICENCE_INVALID'],
          identityMatch: 'CONFIRMED_BY_REVIEWER',
          signalResolutions: [{ signalId: unknown(), outcome: 'CONFIRMED_FRAUD' }],
        }),
      )?.code,
    ).toBe('WAYVRO_E_VALIDATION');
    expect(
      code(
        await r.decide(reviewer, caseId, {
          ...base,
          expectedVersion: c.version,
          decision: 'NEEDS_INFO',
          reasonCodes: ['SELFIE_UNCLEAR'],
          signalResolutions: [{ signalId: unknown(), outcome: 'CLEARED' }],
        }),
      )?.code,
    ).toBe('WAYVRO_E_VALIDATION');
    const escalated = await r.decide(reviewer, caseId, { ...base, expectedVersion: c.version, decision: 'ESCALATE', reasonCodes: ['SENIOR_REVIEW_NEEDED'] });
    expect(escalated.json()).toMatchObject({ caseStatus: 'ESCALATED' });
    expect((await h.inject(post(`/v1/admin/review-cases/${caseId}/claim`, {}, kit.sb(reviewer)))).statusCode).toBe(403);
    expect((await r.get('/v1/admin/review-cases?status=ESCALATED', kit.sb(reviewer))).json<{ items: unknown[] }>().items).toEqual([]);
    c = await r.claim(senior, caseId);
    const inPerson = await r.decide(senior, caseId, {
      ...base,
      expectedVersion: c.version,
      decision: 'REQUIRE_IN_PERSON',
      reasonCodes: ['ACCESSIBILITY_ALTERNATIVE'],
    });
    expect(inPerson.json()).toMatchObject({ caseStatus: 'OPEN', applicationState: 'MANUAL_REVIEW' });
    const view = (await r.get('/v1/driver-onboarding/applications/current', bearer(a.s.accessToken))).json<{ review: { inPersonRequired: boolean } }>();
    expect(view.review.inPersonRequired).toBe(true);
    // claims incomplete: approval refused, nothing recorded
    c = await r.claim(senior, caseId);
    await h.owner.query(`update compliance.driver_applications set legal_name_envelope = null where id = $1`, [a.appId]);
    const incomplete = await r.decide(senior, caseId, {
      ...base,
      expectedVersion: c.version,
      decision: 'APPROVE',
      reasonCodes: ['ALL_CHECKS_CONFIRMED'],
      identityMatch: 'CONFIRMED_BY_REVIEWER',
    });
    expect(code(incomplete)?.details?.reasonCodes).toEqual(['CLAIMS_INCOMPLETE']);
    // an application that is no longer under review
    await h.owner.query(`update compliance.driver_applications set state = 'NEEDS_INFO' where id = $1`, [a.appId]);
    expect(code(await r.decide(senior, caseId, { ...base, expectedVersion: c.version, decision: 'NEEDS_INFO', reasonCodes: ['SELFIE_UNCLEAR'] }))?.code).toBe(
      'WAYVRO_E_CONFLICT',
    );
  });

  it('a REJECT can confirm fraud signals; a rejected second approval sends the case back; unknown decisions are 404', async () => {
    const first = await r.submittedApplication();
    const a = await r.submittedApplication({ cnic: first.cnic });
    const caseId = await r.intake(a.appId);
    let c = await r.claim(senior, caseId);
    const signals = c.duplicateSignals.map((s) => ({ signalId: s.id, outcome: 'CLEARED' as const }));
    const approve = await r.decide(senior, caseId, {
      expectedVersion: c.version,
      decision: 'APPROVE',
      reasonCodes: ['ALL_CHECKS_CONFIRMED'],
      checklist: r.allConfirmed,
      identityMatch: 'CONFIRMED_BY_REVIEWER',
      evidenceIds: a.evidenceIds,
      signalResolutions: signals,
    });
    const decisionId = approve.json<{ decisionId: string }>().decisionId;
    expect((await kit.privileged(senior2, `/v1/admin/review-decisions/${unknown()}/second-approvals`, { outcome: 'APPROVED' })).statusCode).toBe(404);
    const rejected = await kit.privileged(senior2, `/v1/admin/review-decisions/${decisionId}/second-approvals`, { outcome: 'REJECTED' });
    expect(rejected.json()).toMatchObject({ caseStatus: 'OPEN', applicationState: 'MANUAL_REVIEW' });
    c = await r.claim(senior2, caseId);
    const fraud = await r.decide(senior2, caseId, {
      expectedVersion: c.version,
      decision: 'REJECT',
      reasonCodes: ['DUPLICATE_IDENTITY_CONFIRMED'],
      checklist: r.allConfirmed,
      identityMatch: 'NOT_MATCHING',
      evidenceIds: a.evidenceIds.slice(0, 2),
      signalResolutions: signals.map((s) => ({ ...s, outcome: 'CONFIRMED_FRAUD' as const })),
    });
    expect(fraud.json()).toMatchObject({ applicationState: 'REJECTED' });
    expect((await h.owner.query(`select distinct status from compliance.duplicate_signals where subject_application_id = $1`, [a.appId])).rows).toEqual([
      { status: 'CONFIRMED_FRAUD' },
    ]);
    // a decision that never needed a second approver
    const fraudId = fraud.json<{ decisionId: string }>().decisionId;
    expect((await kit.privileged(senior, `/v1/admin/review-decisions/${fraudId}/second-approvals`, { outcome: 'APPROVED' })).statusCode).toBe(409);
  });
});

describe('appeal refusals', () => {
  it('unknown or non-appealable subjects; foreign decisions; role and conflict checks; double decisions', async () => {
    const s = await signIn(h);
    const t = bearer(s.accessToken);
    expect((await h.inject(post('/v1/account/appeals', { reviewDecisionId: unknown(), statement: 'Synthetic appeal text.' }, t))).statusCode).toBe(404);
    expect((await h.inject(post('/v1/account/appeals', { restrictionId: unknown(), statement: 'Synthetic appeal text.' }, t))).statusCode).toBe(404);
    expect((await h.inject(post('/v1/account/appeals', { statement: 'Neither subject given.' }, t))).statusCode).toBe(400);
    const accountId = (await h.owner.query<{ account_id: string }>(`select account_id from identity.sessions where id = $1`, [s.sessionId])).rows[0]
      ?.account_id;
    const notAppealable = await kit.privileged(trustSafety, '/v1/admin/restrictions', {
      scope: 'ACCOUNT',
      accountId,
      reasonClass: 'FRAUD',
      reasonCode: 'SYNTHETIC_FRAUD',
      appealable: false,
    });
    expect(
      (await h.inject(post('/v1/account/appeals', { restrictionId: notAppealable.json<{ id: string }>().id, statement: 'Synthetic appeal text.' }, t)))
        .statusCode,
    ).toBe(409);
    // a NEEDS_INFO decision is not appealable; someone else's decision is 404
    const a = await r.submittedApplication();
    const caseId = await r.intake(a.appId);
    const c = await r.claim(reviewer, caseId);
    const decided = await r.decide(reviewer, caseId, {
      expectedVersion: c.version,
      decision: 'NEEDS_INFO',
      reasonCodes: ['SELFIE_UNCLEAR'],
      checklist: r.allConfirmed,
      evidenceIds: [],
    });
    const decisionId = decided.json<{ decisionId: string }>().decisionId;
    expect(
      (await h.inject(post('/v1/account/appeals', { reviewDecisionId: decisionId, statement: 'Not a rejection.' }, bearer(a.s.accessToken)))).statusCode,
    ).toBe(409);
    expect((await h.inject(post('/v1/account/appeals', { reviewDecisionId: decisionId, statement: 'Not my decision.' }, t))).statusCode).toBe(404);
    // staff side
    expect(
      (await kit.privileged(senior, `/v1/admin/appeals/${unknown()}/decisions`, { outcome: 'UPHELD', reasonCode: 'ORIGINAL_DECISION_CONFIRMED' })).statusCode,
    ).toBe(404);
    const rejectedApp = await r.submittedApplication();
    const rc = await r.intake(rejectedApp.appId);
    const rcase = await r.claim(senior, rc);
    const rej = await r.decide(senior, rc, {
      expectedVersion: rcase.version,
      decision: 'REJECT',
      reasonCodes: ['LICENCE_INVALID'],
      checklist: r.allConfirmed,
      identityMatch: 'CONFIRMED_BY_REVIEWER',
      evidenceIds: [],
    });
    const appeal = await h.inject(
      post(
        '/v1/account/appeals',
        { reviewDecisionId: rej.json<{ decisionId: string }>().decisionId, statement: 'My licence is valid (synthetic).' },
        bearer(rejectedApp.s.accessToken),
      ),
    );
    const appealId = appeal.json<{ id: string }>().id;
    expect(
      (await kit.privileged(trustSafety, `/v1/admin/appeals/${appealId}/decisions`, { outcome: 'UPHELD', reasonCode: 'ORIGINAL_DECISION_CONFIRMED' }))
        .statusCode,
    ).toBe(403);
    await h.owner.query(`update staff.staff_accounts set consumer_account_id = $2 where id = $1`, [senior2.staffId, rejectedApp.accountId]);
    expect(
      (await kit.privileged(senior2, `/v1/admin/appeals/${appealId}/decisions`, { outcome: 'UPHELD', reasonCode: 'ORIGINAL_DECISION_CONFIRMED' })).statusCode,
    ).toBe(403);
    await h.owner.query(`update staff.staff_accounts set consumer_account_id = null where id = $1`, [senior2.staffId]);
    const list = (await r.get('/v1/admin/appeals?limit=1', kit.sb(senior2))).json<{ items: unknown[]; nextCursor: string | null }>();
    expect(list.items).toHaveLength(1);
    expect((await r.get('/v1/admin/appeals?cursor=bm90LWEtZGF0ZQ', kit.sb(senior2))).statusCode).toBe(400);
    expect(
      (await kit.privileged(senior2, `/v1/admin/appeals/${appealId}/decisions`, { outcome: 'UPHELD', reasonCode: 'ORIGINAL_DECISION_CONFIRMED' })).statusCode,
    ).toBe(200);
    expect(
      (await kit.privileged(senior2, `/v1/admin/appeals/${appealId}/decisions`, { outcome: 'UPHELD', reasonCode: 'ORIGINAL_DECISION_CONFIRMED' })).statusCode,
    ).toBe(409);
  });
});

describe('monitoring filters', () => {
  it('roster and access-log cursors and filters; tampered cursors are 400', async () => {
    expect((await r.get('/v1/admin/compliance/expiry-roster?cursor=bm9wZQ', kit.sb(reviewer))).statusCode).toBe(400);
    expect((await r.get('/v1/admin/compliance/expiry-roster?withinDays=400', kit.sb(reviewer))).statusCode).toBe(400);
    expect((await r.get('/v1/admin/evidence-access-log?cursor=bm9wZQ', kit.sb(auditor))).statusCode).toBe(400);
    const a = await r.submittedApplication();
    await kit.privileged(senior, '/v1/admin/evidence-views', { evidenceId: a.evidenceIds[0], reasonCode: 'CASE_REVIEW' });
    await kit.privileged(senior, '/v1/admin/evidence-views', { evidenceId: a.evidenceIds[1], reasonCode: 'CASE_REVIEW' });
    const one = (await r.get(`/v1/admin/evidence-access-log?staffId=${senior.staffId}&limit=1`, kit.sb(auditor))).json<{
      items: unknown[];
      nextCursor: string | null;
    }>();
    expect(one.items).toHaveLength(1);
    const two = (await r.get(`/v1/admin/evidence-access-log?staffId=${senior.staffId}&limit=1&cursor=${one.nextCursor ?? ''}`, kit.sb(auditor))).json<{
      items: unknown[];
    }>();
    expect(two.items).toHaveLength(1);
  });
});
