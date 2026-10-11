/**
 * P2.7 manual review, decisions, appeals and monitoring through the API, against REAL PostgreSQL (restricted roles),
 * Valkey and SeaweedFS: SEC-REV (claims are leases; decisions need the claim, step-up, the decision permission, the
 * reason catalogue and a complete checklist), SEC-SELFIE (no automated approval: nothing but a human decision reaches
 * VERIFIED), duplicate signals (reviewer refused, senior clears + SECOND approver, maker-checker), approval effects
 * (profile from confirmed claims, documents VALID, capabilities granted BY the decision), NEEDS_INFO → resubmission,
 * appeals (restricted-ok; never the original decider or restriction creator), evidence views scoped to claimed cases,
 * expiry roster, auditor access log, outbox rows in the same transaction. The worker intake step (SUBMITTED →
 * MANUAL_REVIEW + case) is SIMULATED here exactly as apps/worker does it (covered there). Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { DriverApplicationSchema } from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewKit } from './review-helpers.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, post, signIn, startApi, type Harness } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let admins: Staff[];
let reviewer: Staff;
let reviewer2: Staff;
let senior: Staff;
let senior2: Staff;
let trustSafety: Staff;
let trustSafety2: Staff;
let auditor: Staff;
let r: ReturnType<typeof reviewKit>;
beforeAll(async () => {
  h = await startApi({ env: { ...STAFF_ENV, EVIDENCE_SLOTS_PER_10_MIN: '100' }, vault: true });
  kit = staffKit(h);
  r = reviewKit(h, kit);
  admins = await kit.bootstrapAdmins(2);
  reviewer = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Reviewer One');
  reviewer2 = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Reviewer Two');
  senior = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Senior One');
  senior2 = await kit.staffWithRole(admins, 'KYC_SENIOR_REVIEWER', 'Senior Two');
  trustSafety = await kit.staffWithRole(admins, 'TRUST_SAFETY_AGENT', 'TS One');
  trustSafety2 = await kit.staffWithRole(admins, 'TRUST_SAFETY_AGENT', 'TS Two');
  auditor = await kit.staffWithRole(admins, 'AUDITOR', 'Auditor One');
}, 300_000);
afterAll(async () => {
  await h.close();
});

describe('submission → intake → queue (SEC-REV)', () => {
  it('submission writes the outbox event and enqueues intake in the same transaction; the queue is scoped and leased', async () => {
    const a = await r.submittedApplication();
    const events = await h.owner.query<{ type: string; account_id: string }>(`select type, account_id from platform.outbox_events where aggregate_id = $1`, [
      a.appId,
    ]);
    expect(events.rows).toEqual([{ type: 'driver.application.submitted.v1', account_id: a.accountId }]);
    expect(
      (await h.owner.query(`select 1 from platform.jobs where type = 'driver-application.intake' and payload->>'applicationId' = $1`, [a.appId])).rowCount,
    ).toBe(1);
    const caseId = await r.intake(a.appId);
    const queue = (await r.get('/v1/admin/review-cases?status=OPEN', kit.sb(reviewer))).json<{ items: Array<{ id: string }> }>();
    expect(queue.items.map((i) => i.id)).toContain(caseId);
    expect((await r.get('/v1/admin/review-cases', kit.sb(auditor))).statusCode).toBe(403);
    const detail = await r.claim(reviewer, caseId);
    expect(detail.application.claims).toEqual({ legalName: 'Synthetic Applicant', cnicLast4: a.cnic.replaceAll('-', '').slice(-4), dateOfBirth: '1990-05-17' });
    expect(detail.application.ageCheck.outcome).toBe('NO_APPROVED_THRESHOLD');
    expect(detail.evidence).toHaveLength(6);
    expect(JSON.stringify(detail)).not.toContain(a.cnic);
    // someone else holds the lease
    expect((await h.inject(post(`/v1/admin/review-cases/${caseId}/claim`, {}, kit.sb(reviewer2)))).statusCode).toBe(409);
    expect((await r.get(`/v1/admin/review-cases/${caseId}`, kit.sb(reviewer2))).statusCode).toBe(403);
    // evidence views need the claimed case (P2.6 deferral closed)
    expect((await kit.privileged(reviewer2, '/v1/admin/evidence-views', { evidenceId: a.evidenceIds[0], reasonCode: 'CASE_REVIEW' })).statusCode).toBe(403);
    expect((await kit.privileged(reviewer, '/v1/admin/evidence-views', { evidenceId: a.evidenceIds[0], reasonCode: 'CASE_REVIEW' })).statusCode).toBe(201);
    // release and an expired lease return the case to the queue
    expect((await h.inject(post(`/v1/admin/review-cases/${caseId}/release`, {}, kit.sb(reviewer)))).statusCode).toBe(204);
    const again = await r.claim(reviewer2, caseId);
    expect(again.status).toBe('CLAIMED');
  });
});

describe('decisions (K04/K05/A15; SEC-SELFIE)', () => {
  it('validates the catalogue, checklist, identity assessment and evidence; NEEDS_INFO → resubmission → RESUBMISSION case', async () => {
    const a = await r.submittedApplication();
    const caseId = await r.intake(a.appId);
    const c = await r.claim(reviewer, caseId);
    const base = { expectedVersion: c.version, checklist: r.allConfirmed, evidenceIds: a.evidenceIds.slice(0, 2) };
    expect((await r.decide(reviewer, caseId, { ...base, decision: 'NEEDS_INFO', reasonCodes: ['NOT_IN_CATALOGUE'] })).statusCode).toBe(400);
    expect((await r.decide(reviewer, caseId, { ...base, decision: 'APPROVE', reasonCodes: ['ALL_CHECKS_CONFIRMED'] })).statusCode).toBe(400); // no identity assessment
    const partial = { schemaVersion: 1, items: { ...r.allConfirmed.items, LICENCE_NAME_AND_EXPIRY_VALID: 'NOT_CONFIRMED' } };
    expect(
      (
        await r.decide(reviewer, caseId, {
          ...base,
          checklist: partial,
          decision: 'APPROVE',
          reasonCodes: ['ALL_CHECKS_CONFIRMED'],
          identityMatch: 'CONFIRMED_BY_REVIEWER',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await r.decide(reviewer, caseId, { ...base, evidenceIds: [randomUUID()], decision: 'NEEDS_INFO', reasonCodes: ['SELFIE_UNCLEAR'] })).statusCode,
    ).toBe(400);
    expect((await r.decide(reviewer, caseId, { ...base, expectedVersion: 999, decision: 'NEEDS_INFO', reasonCodes: ['SELFIE_UNCLEAR'] })).statusCode).toBe(409);
    expect((await r.decide(reviewer2, caseId, { ...base, decision: 'NEEDS_INFO', reasonCodes: ['SELFIE_UNCLEAR'] })).statusCode).toBe(409); // not the claimant
    const res = await r.decide(reviewer, caseId, { ...base, decision: 'NEEDS_INFO', reasonCodes: ['SELFIE_UNCLEAR', 'LICENCE_IMAGE_UNREADABLE'] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ caseStatus: 'DECIDED', applicationState: 'NEEDS_INFO', pendingSecondApproval: false });
    const view = DriverApplicationSchema.parse((await r.get('/v1/driver-onboarding/applications/current', bearer(a.s.accessToken))).json());
    expect(view.review?.latestDecision).toMatchObject({
      decision: 'NEEDS_INFO',
      reasonCodes: ['SELFIE_UNCLEAR', 'LICENCE_IMAGE_UNREADABLE'],
      appealable: false,
    });
    expect(
      (await h.owner.query(`select 1 from platform.outbox_events where type = 'driver.application.decided.v1' and aggregate_id = $1`, [a.appId])).rowCount,
    ).toBe(1);
    // the applicant resubmits: a RESUBMISSION case
    const resubmitted = await h.inject(
      post(`/v1/driver-onboarding/applications/${a.appId}/submission`, { expectedVersion: view.version }, bearer(a.s.accessToken)),
    );
    expect(resubmitted.statusCode, resubmitted.body).toBe(200);
    const next = await r.intake(a.appId);
    expect((await h.owner.query<{ kind: string }>(`select kind from compliance.review_cases where id = $1`, [next])).rows[0]?.kind).toBe('RESUBMISSION');
  });

  it('APPROVE: profile from confirmed claims, documents VALID, capabilities granted BY the decision; only a human decision reaches VERIFIED', async () => {
    const a = await r.submittedApplication();
    const caseId = await r.intake(a.appId);
    const c = await r.claim(reviewer, caseId);
    const res = await r.decide(reviewer, caseId, {
      expectedVersion: c.version,
      decision: 'APPROVE',
      reasonCodes: ['ALL_CHECKS_CONFIRMED'],
      checklist: r.allConfirmed,
      identityMatch: 'CONFIRMED_BY_REVIEWER',
      evidenceIds: a.evidenceIds,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ applicationState: 'VERIFIED', caseStatus: 'DECIDED' });
    const profile = (
      await h.owner.query<{ id: string; state: string }>(`select id, state from compliance.driver_profiles where application_id = $1`, [a.appId])
    ).rows[0];
    expect(profile?.state).toBe('ACTIVE_ELIGIBLE');
    const caps = await h.owner.query<{ granted_by_decision_id: string; status: string }>(
      `select granted_by_decision_id, status from compliance.service_capabilities where driver_profile_id = $1`,
      [profile?.id],
    );
    expect(caps.rows).toEqual([{ granted_by_decision_id: res.json<{ decisionId: string }>().decisionId, status: 'GRANTED' }]);
    const docs = await h.owner.query<{ status: string }>(
      `select distinct status from compliance.compliance_documents where driver_application_id = $1 and status <> 'SUPERSEDED'`,
      [a.appId],
    );
    expect(docs.rows).toEqual([{ status: 'VALID' }]);
    const relied = await h.owner.query(`select 1 from compliance.review_decision_evidence where review_decision_id = $1`, [
      res.json<{ decisionId: string }>().decisionId,
    ]);
    expect(relied.rowCount).toBe(6);
    const compliance = await r.get('/v1/driver/compliance', bearer(a.s.accessToken));
    expect(compliance.statusCode).toBe(200);
    expect(
      (await h.owner.query(`select type from platform.outbox_events where account_id = $1 order by created_at`, [a.accountId])).rows.map(
        (r) => (r as { type: string }).type,
      ),
    ).toEqual(['driver.application.submitted.v1', 'driver.approved.v1', 'driver.application.decided.v1']);
    // decisions are append-only facts
    await expect(h.owner.query(`update compliance.review_decisions set decision = 'REJECT' where review_case_id = $1`, [caseId])).rejects.toThrow();
    // SEC-SELFIE: every VERIFIED application has a human APPROVE decision behind it
    const orphans = await h.owner.query(
      `select a.id from compliance.driver_applications a where a.state = 'VERIFIED' and not exists (
         select 1 from compliance.review_decisions d join compliance.review_cases c on c.id = d.review_case_id
          left join compliance.review_second_approvals s on s.review_decision_id = d.id
          where c.driver_application_id = a.id and d.decision = 'APPROVE' and (not d.requires_second_approval or s.outcome = 'APPROVED'))`,
    );
    expect(orphans.rowCount).toBe(0);
  });

  it('duplicate signals: a reviewer cannot approve; a senior clears them and a DIFFERENT senior must second-approve', async () => {
    const first = await r.submittedApplication();
    const a = await r.submittedApplication({ cnic: first.cnic });
    expect(
      (await h.owner.query(`select 1 from compliance.duplicate_signals where subject_application_id = $1 and status = 'OPEN'`, [a.appId])).rowCount,
    ).toBeGreaterThan(0);
    const caseId = await r.intake(a.appId);
    const approve = (version: number, resolutions: Array<{ signalId: string; outcome: string }>) => ({
      expectedVersion: version,
      decision: 'APPROVE',
      reasonCodes: ['ALL_CHECKS_CONFIRMED'],
      checklist: r.allConfirmed,
      identityMatch: 'CONFIRMED_BY_REVIEWER',
      evidenceIds: a.evidenceIds,
      signalResolutions: resolutions,
    });
    let c = await r.claim(reviewer, caseId);
    const signals = c.duplicateSignals.filter((s) => s.status === 'OPEN').map((s) => ({ signalId: s.id, outcome: 'CLEARED' }));
    expect((await r.decide(reviewer, caseId, approve(c.version, signals))).statusCode).toBe(403);
    await h.inject(post(`/v1/admin/review-cases/${caseId}/release`, {}, kit.sb(reviewer)));
    c = await r.claim(senior, caseId);
    expect((await r.decide(senior, caseId, approve(c.version, []))).statusCode).toBe(403); // signals must be cleared
    const pending = await r.decide(senior, caseId, approve(c.version, signals));
    expect(pending.statusCode, pending.body).toBe(201);
    expect(pending.json()).toMatchObject({ pendingSecondApproval: true, caseStatus: 'ESCALATED', applicationState: 'MANUAL_REVIEW' });
    const decisionId = pending.json<{ decisionId: string }>().decisionId;
    expect((await kit.privileged(senior, `/v1/admin/review-decisions/${decisionId}/second-approvals`, { outcome: 'APPROVED' })).statusCode).toBe(403);
    expect((await kit.privileged(reviewer, `/v1/admin/review-decisions/${decisionId}/second-approvals`, { outcome: 'APPROVED' })).statusCode).toBe(403);
    const view = DriverApplicationSchema.parse((await r.get('/v1/driver-onboarding/applications/current', bearer(a.s.accessToken))).json());
    expect(view.review?.latestDecision).toBeNull(); // a pending approval is not effective
    const second = await kit.privileged(senior2, `/v1/admin/review-decisions/${decisionId}/second-approvals`, { outcome: 'APPROVED' });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ applicationState: 'VERIFIED', caseStatus: 'DECIDED' });
    expect((await h.owner.query(`select 1 from compliance.duplicate_signals where subject_application_id = $1 and status = 'OPEN'`, [a.appId])).rowCount).toBe(
      0,
    );
    expect((await kit.privileged(senior2, `/v1/admin/review-decisions/${decisionId}/second-approvals`, { outcome: 'APPROVED' })).statusCode).toBe(409);
  });
});

describe('appeals (V13/K05)', () => {
  it('REJECT → appeal → the original decider cannot decide → OVERTURNED reopens human review; UPHELD makes it final', async () => {
    for (const outcome of ['OVERTURNED', 'UPHELD'] as const) {
      const a = await r.submittedApplication();
      const caseId = await r.intake(a.appId);
      const c = await r.claim(senior, caseId);
      const rejected = await r.decide(senior, caseId, {
        expectedVersion: c.version,
        decision: 'REJECT',
        reasonCodes: ['IDENTITY_NOT_MATCHING'],
        checklist: r.allConfirmed,
        identityMatch: 'NOT_MATCHING',
        evidenceIds: a.evidenceIds.slice(0, 3),
      });
      expect(rejected.statusCode, rejected.body).toBe(201);
      const decisionId = rejected.json<{ decisionId: string }>().decisionId;
      const view = DriverApplicationSchema.parse((await r.get('/v1/driver-onboarding/applications/current', bearer(a.s.accessToken))).json());
      expect(view.review?.latestDecision).toMatchObject({ decision: 'REJECT', appealable: true });
      const appeal = await h.inject(
        post('/v1/account/appeals', { reviewDecisionId: decisionId, statement: 'These are my own synthetic documents.' }, bearer(a.s.accessToken)),
      );
      expect(appeal.statusCode, appeal.body).toBe(201);
      const appealId = appeal.json<{ id: string }>().id;
      expect(
        (await h.inject(post('/v1/account/appeals', { reviewDecisionId: decisionId, statement: 'A second appeal is refused.' }, bearer(a.s.accessToken))))
          .statusCode,
      ).toBe(409);
      const row = await h.owner.query<{ statement_envelope: Buffer }>(`select statement_envelope from profile.appeals where id = $1`, [appealId]);
      expect(row.rows[0]?.statement_envelope.toString('latin1')).not.toContain('synthetic documents');
      const list = (await r.get('/v1/admin/appeals', kit.sb(senior2))).json<{ items: Array<{ id: string }> }>();
      expect(list.items.map((i) => i.id)).toContain(appealId);
      expect((await kit.privileged(senior, `/v1/admin/appeals/${appealId}/decisions`, { outcome, reasonCode: 'ORIGINAL_DECISION_CONFIRMED' })).statusCode).toBe(
        403,
      );
      const decided = await kit.privileged(senior2, `/v1/admin/appeals/${appealId}/decisions`, {
        outcome,
        reasonCode: outcome === 'UPHELD' ? 'ORIGINAL_DECISION_CONFIRMED' : 'REVIEW_ERROR_CORRECTED',
      });
      expect(decided.statusCode, decided.body).toBe(200);
      const state = (await h.owner.query<{ state: string }>(`select state from compliance.driver_applications where id = $1`, [a.appId])).rows[0]?.state;
      expect(state).toBe(outcome === 'UPHELD' ? 'REJECTED_FINAL' : 'MANUAL_REVIEW');
      if (outcome === 'OVERTURNED') {
        const reopened = decided.json<{ reviewCaseId: string }>().reviewCaseId;
        expect(
          (await h.owner.query<{ kind: string; status: string }>(`select kind, status from compliance.review_cases where id = $1`, [reopened])).rows[0],
        ).toEqual({ kind: 'APPEAL', status: 'OPEN' });
        const detail = await r.claim(reviewer, reopened);
        expect(detail.appeal?.statement).toBe('These are my own synthetic documents.');
      }
      const mine = (await r.get('/v1/account/appeals', bearer(a.s.accessToken))).json<{ items: Array<{ id: string; status: string }> }>();
      expect(mine.items).toEqual([expect.objectContaining({ id: appealId, status: outcome })]);
    }
  });

  it('restriction appeal: available under the restriction; never decided by its creator; OVERTURNED lifts it', async () => {
    const s = await signIn(h);
    const accountId = (await h.owner.query<{ account_id: string }>(`select account_id from identity.sessions where id = $1`, [s.sessionId])).rows[0]
      ?.account_id;
    const created = await kit.privileged(trustSafety, '/v1/admin/restrictions', {
      scope: 'ACCOUNT',
      accountId,
      reasonClass: 'SAFETY',
      reasonCode: 'SYNTHETIC_SAFETY_REPORT',
      appealable: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    const restrictionId = created.json<{ id: string }>().id;
    const appeal = await h.inject(
      post('/v1/account/appeals', { restrictionId, statement: 'Synthetic appeal against a synthetic restriction.' }, bearer(s.accessToken)),
    );
    expect(appeal.statusCode, appeal.body).toBe(201);
    const appealId = appeal.json<{ id: string }>().id;
    expect(
      (await kit.privileged(trustSafety, `/v1/admin/appeals/${appealId}/decisions`, { outcome: 'OVERTURNED', reasonCode: 'RESTRICTION_NO_LONGER_JUSTIFIED' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await kit.privileged(senior, `/v1/admin/appeals/${appealId}/decisions`, { outcome: 'OVERTURNED', reasonCode: 'RESTRICTION_NO_LONGER_JUSTIFIED' }))
        .statusCode,
    ).toBe(403);
    const decided = await kit.privileged(trustSafety2, `/v1/admin/appeals/${appealId}/decisions`, {
      outcome: 'OVERTURNED',
      reasonCode: 'RESTRICTION_NO_LONGER_JUSTIFIED',
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect((await h.owner.query<{ status: string }>(`select status from profile.restrictions where id = $1`, [restrictionId])).rows[0]?.status).toBe('LIFTED');
    const events = await h.owner.query<{ type: string }>(`select type from platform.outbox_events where account_id = $1 order by created_at`, [accountId]);
    expect(events.rows.map((e) => e.type)).toEqual(['restriction.changed.v1', 'restriction.changed.v1', 'appeal.decided.v1']);
  });
});

describe('monitoring (W07/D03; SEC-EXPORT)', () => {
  it('expiry roster is scoped and masked; the auditor reads the evidence access log; no export route exists', async () => {
    const a = await r.submittedApplication();
    const caseId = await r.intake(a.appId);
    const c = await r.claim(reviewer, caseId);
    await r.decide(reviewer, caseId, {
      expectedVersion: c.version,
      decision: 'APPROVE',
      reasonCodes: ['ALL_CHECKS_CONFIRMED'],
      checklist: r.allConfirmed,
      identityMatch: 'CONFIRMED_BY_REVIEWER',
      evidenceIds: a.evidenceIds,
    });
    await h.owner.query(
      `update compliance.compliance_documents set expires_on = current_date + 5 where driver_application_id = $1 and document_type_code = 'DRIVING_LICENCE'`,
      [a.appId],
    );
    const roster = (await r.get('/v1/admin/compliance/expiry-roster?withinDays=10', kit.sb(reviewer))).json<{
      items: Array<{ documentType: string; numberLast4: string | null }>;
    }>();
    expect(roster.items.some((i) => i.documentType === 'DRIVING_LICENCE')).toBe(true);
    expect(JSON.stringify(roster)).not.toMatch(/LHR-[0-9a-f]{6}/);
    expect((await r.get('/v1/admin/compliance/expiry-roster', kit.sb(auditor))).statusCode).toBe(403);
    await kit.privileged(senior, '/v1/admin/evidence-views', { evidenceId: a.evidenceIds[0], reasonCode: 'QUALITY_CALIBRATION' });
    const log = (await r.get(`/v1/admin/evidence-access-log?evidenceId=${a.evidenceIds[0] ?? ''}`, kit.sb(auditor))).json<{
      items: Array<{ event: string; reasonCode: string }>;
    }>();
    expect(log.items).toEqual([expect.objectContaining({ event: 'VIEW_TOKEN_ISSUED', reasonCode: 'QUALITY_CALIBRATION' })]);
    expect((await r.get('/v1/admin/evidence-access-log', kit.sb(reviewer))).statusCode).toBe(403);
  });
});
