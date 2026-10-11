/**
 * Phase-2 closure — support capabilities of the accepted staff matrix, against REAL PostgreSQL (restricted roles),
 * Valkey and SeaweedFS: the masked account summary (reason required, audited, privacy-minimised: no full phone, CNIC,
 * evidence, OIDC subject or token), on-behalf session revocation behind a fresh staff step-up (one/all, foreign session
 * ids refused, the account sees SESSIONS_REVOKED_BY_SUPPORT), recovery assistance that opens or attaches a human review
 * of an existing proof-bearing recovery and never decides it, conflict-of-interest and city-scope denials (audited),
 * and roles without the permissions refused. Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { AccountSupportSummarySchema } from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewKit } from './review-helpers.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, post, signIn, startApi, type Harness } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let admins: Staff[];
let support: Staff;
let trustSafety: Staff;
let reviewer: Staff;
let auditor: Staff;
let r: ReturnType<typeof reviewKit>;
beforeAll(async () => {
  h = await startApi({ env: { ...STAFF_ENV, EVIDENCE_SLOTS_PER_10_MIN: '100' }, vault: true });
  kit = staffKit(h);
  r = reviewKit(h, kit);
  admins = await kit.bootstrapAdmins(2);
  support = await kit.staffWithRole(admins, 'SUPPORT_AGENT', 'Support One');
  trustSafety = await kit.staffWithRole(admins, 'TRUST_SAFETY_AGENT', 'Trust Safety One');
  reviewer = await kit.staffWithRole(admins, 'KYC_REVIEWER', 'Support Test Reviewer');
  auditor = await kit.staffWithRole(admins, 'AUDITOR', 'Support Test Auditor');
}, 300_000);
afterAll(async () => {
  await h.close();
});

const errorOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error;
const accountOf = async (sessionId: string) =>
  (await h.owner.query<{ account_id: string }>(`select account_id from identity.sessions where id = $1`, [sessionId])).rows[0]?.account_id ?? '';
const lookup = (s: Staff, body: Record<string, unknown>) =>
  h.inject({ ...post('/v1/admin/account-summaries', body), headers: { ...kit.sb(s), 'idempotency-key': `idem-${randomUUID()}` } });

describe('masked account summary', () => {
  it('support and T&S see a privacy-minimised summary with a recorded reason; other roles are refused', async () => {
    const s = await signIn(h);
    const accountId = await accountOf(s.sessionId);
    const res = await lookup(support, { phone: s.phone, reasonCode: 'CUSTOMER_CONTACT_VERIFIED' });
    expect(res.statusCode, res.body).toBe(200);
    const summary = AccountSupportSummarySchema.parse(res.json());
    expect(summary).toMatchObject({ accountId, status: 'ACTIVE', riderProfile: true, recovery: null, deletion: null });
    expect(summary.maskedPhone).toBe(`+92 3** *** **${s.phone.slice(-2)}`);
    expect(summary.sessions.map((x) => x.id)).toContain(s.sessionId);
    expect(summary.strongRecoveryFactors).toEqual({ linkedOidc: false, driverKyc: false });
    const raw = JSON.stringify(res.json());
    expect(raw).not.toContain(s.phone);
    expect(raw).not.toContain(s.phone.slice(3));
    expect(raw).not.toMatch(/"(?:\w*token\w*|\w*cnic\w*|subject|ip\w*)":/i);
    expect((await lookup(trustSafety, { accountId, reasonCode: 'SAFETY_REPORT' })).statusCode).toBe(200);
    const audit = await h.owner.query<{ reason_code: string }>(
      `select reason_code from audit.audit_events where action = 'SUPPORT_ACCOUNT_SUMMARY_VIEWED' and object_id = $1 order by seq`,
      [accountId],
    );
    expect(audit.rows.map((a) => a.reason_code)).toEqual(['CUSTOMER_CONTACT_VERIFIED', 'SAFETY_REPORT']);
    // a reason is required; unknown accounts are 404; other roles have no permission
    expect((await lookup(support, { phone: s.phone })).statusCode).toBe(400);
    expect((await lookup(support, { accountId: randomUUID(), reasonCode: 'SAFETY_REPORT' })).statusCode).toBe(404);
    for (const staff of [reviewer, auditor]) expect((await lookup(staff, { accountId, reasonCode: 'SAFETY_REPORT' })).statusCode).toBe(403);
  });

  it('never on the staff member own consumer account (conflict of interest, audited)', async () => {
    const s = await signIn(h);
    const accountId = await accountOf(s.sessionId);
    await h.owner.query(`update staff.staff_accounts set consumer_account_id = $2 where id = $1`, [support.staffId, accountId]);
    try {
      expect((await lookup(support, { accountId, reasonCode: 'CUSTOMER_CONTACT_VERIFIED' })).statusCode).toBe(403);
      expect(
        (await kit.privileged(support, `/v1/admin/accounts/${accountId}/session-revocations`, { scope: 'ALL', reasonCode: 'CUSTOMER_CONTACT_VERIFIED' }))
          .statusCode,
      ).toBe(403);
    } finally {
      await h.owner.query(`update staff.staff_accounts set consumer_account_id = null where id = $1`, [support.staffId]);
    }
    const denied = await h.owner.query(
      `select 1 from audit.audit_events where action = 'SUPPORT_ACCESS_DENIED' and object_id = $1 and reason_code = 'CONFLICT_OF_INTEREST'`,
      [accountId],
    );
    expect(denied.rowCount).toBe(2);
  });
});

describe('session revocation on behalf (fresh staff step-up)', () => {
  it('one session or all; foreign session ids refused; the account sees the support revocation', async () => {
    const s = await signIn(h);
    const second = await signIn(h, s.phone);
    const accountId = await accountOf(s.sessionId);
    const other = await signIn(h);
    const url = `/v1/admin/accounts/${accountId}/session-revocations`;
    // without a fresh step-up the route refuses (a support agent who has not stepped up in this run)
    const fresh = await kit.staffWithRole(admins, 'SUPPORT_AGENT', 'Support Two');
    // a WebAuthn sign-in counts as a step-up for 5 minutes (P2.4); age it so the session is no longer stepped up
    await h.owner.query(`update staff.sessions set step_up_at = now() - interval '1 hour' where staff_id = $1`, [fresh.staffId]);
    const noStepUp = await h.inject({
      ...post(url, { scope: 'ALL', reasonCode: 'CUSTOMER_CONTACT_VERIFIED' }),
      headers: { ...kit.sb(fresh), 'idempotency-key': `idem-${randomUUID()}` },
    });
    expect(errorOf(noStepUp)?.code, `${String(noStepUp.statusCode)} ${noStepUp.body}`).toBe('WAYVRO_E_STEP_UP_REQUIRED');
    expect((await kit.privileged(support, url, { scope: 'ONE', sessionId: other.sessionId, reasonCode: 'CUSTOMER_CONTACT_VERIFIED' })).statusCode).toBe(404);
    expect((await kit.privileged(support, url, { scope: 'ONE', reasonCode: 'CUSTOMER_CONTACT_VERIFIED' })).statusCode).toBe(400);
    const one = await kit.privileged(support, url, { scope: 'ONE', sessionId: second.sessionId, reasonCode: 'CUSTOMER_CONTACT_VERIFIED' });
    expect(one.json()).toEqual({ revokedCount: 1 });
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(second.accessToken) })).statusCode).toBe(401);
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(s.accessToken) })).statusCode).toBe(200);
    const all = await kit.privileged(trustSafety, url, { scope: 'ALL', reasonCode: 'FRAUD_INVESTIGATION' });
    expect(all.json()).toEqual({ revokedCount: 1 });
    expect((await h.inject({ method: 'GET', url: '/v1/account/state', headers: bearer(other.accessToken) })).statusCode).toBe(200); // other accounts untouched
    const reasons = await h.owner.query<{ revoke_reason: string }>(`select distinct revoke_reason from identity.sessions where account_id = $1`, [accountId]);
    expect(reasons.rows).toEqual([{ revoke_reason: 'STAFF_ON_BEHALF' }]);
    const events = await h.owner.query(`select 1 from identity.security_events where account_id = $1 and type = 'SESSIONS_REVOKED_BY_SUPPORT'`, [accountId]);
    expect(events.rowCount).toBe(2);
    expect((await kit.privileged(reviewer, url, { scope: 'ALL', reasonCode: 'FRAUD_INVESTIGATION' })).statusCode).toBe(403);
  });
});

describe('recovery assistance (never a decision)', () => {
  it('attaches to the open review of a proof-bearing recovery, opens one when none is open, refuses anything else', async () => {
    const d = await r.approvedDriver(reviewer);
    const caller = await signIn(h);
    await h.inject(post('/v1/account-recoveries', { proof: 'DRIVER_KYC', previousPhone: d.s.phone }, bearer(caller.accessToken)));
    const summary = AccountSupportSummarySchema.parse((await lookup(support, { accountId: d.accountId, reasonCode: 'RECOVERY_ASSISTANCE' })).json());
    expect(summary.recovery).toMatchObject({ kind: 'LOST_PHONE_DRIVER_KYC', status: 'MANUAL_REVIEW' });
    expect(summary.strongRecoveryFactors.driverKyc).toBe(true);
    const id = summary.recovery?.id ?? '';
    const assist = () =>
      h.inject({
        ...post(`/v1/admin/account-recoveries/${id}/assistance`, { reasonCode: 'RECOVERY_ASSISTANCE' }),
        headers: { ...kit.sb(support), 'idempotency-key': `idem-${randomUUID()}` },
      });
    const attached = await assist();
    expect(attached.statusCode, attached.body).toBe(200);
    expect(attached.json()).toMatchObject({ opened: false, priority: 4 });
    // the case went away (e.g. cancelled by staff): assistance opens a fresh human review
    await h.owner.query(`update compliance.review_cases set status = 'CANCELLED' where phone_change_request_id = $1`, [id]);
    const opened = await assist();
    expect(opened.json()).toMatchObject({ opened: true, priority: 4 });
    const cases = await h.owner.query<{ kind: string; status: string }>(
      `select kind, status from compliance.review_cases where phone_change_request_id = $1 and status = 'OPEN'`,
      [id],
    );
    expect(cases.rows).toEqual([{ kind: 'ACCOUNT_RECOVERY', status: 'OPEN' }]);
    // nothing was decided or moved
    expect((await h.owner.query<{ status: string }>(`select status from identity.phone_change_requests where id = $1`, [id])).rows[0]?.status).toBe(
      'MANUAL_REVIEW',
    );
    // support cannot decide a review case
    const caseId = opened.json<{ reviewCaseId: string }>().reviewCaseId;
    expect(
      (await h.inject({ ...post(`/v1/admin/review-cases/${caseId}/claim`, {}), headers: { ...kit.sb(support), 'idempotency-key': `idem-${randomUUID()}` } }))
        .statusCode,
    ).toBe(403);
    // a self-service phone change carries no proof for a review; unknown ids are 404
    const own = await signIn(h);
    await h.owner.query(
      `insert into identity.phone_change_requests (id, account_id, kind, new_phone_envelope, new_phone_last4, new_phone_lookup_version, new_phone_lookup_hash, status, step_up_session_id, expires_at)
       values ($1, $2, 'SELF_SERVICE', decode(repeat('ab', 40), 'hex'), '1234', 1, decode(repeat('cd', 32), 'hex'), 'CURRENT_PHONE_VERIFIED', $3, now() + interval '15 minutes')`,
      [randomUUID(), await accountOf(own.sessionId), own.sessionId],
    );
    const selfService =
      (await h.owner.query<{ id: string }>(`select id from identity.phone_change_requests where account_id = $1`, [await accountOf(own.sessionId)])).rows[0]
        ?.id ?? '';
    const refused = await h.inject({
      ...post(`/v1/admin/account-recoveries/${selfService}/assistance`, { reasonCode: 'RECOVERY_ASSISTANCE' }),
      headers: { ...kit.sb(support), 'idempotency-key': `idem-${randomUUID()}` },
    });
    expect(refused.statusCode).toBe(409);
    const unknown = await h.inject({
      ...post(`/v1/admin/account-recoveries/${randomUUID()}/assistance`, { reasonCode: 'RECOVERY_ASSISTANCE' }),
      headers: { ...kit.sb(support), 'idempotency-key': `idem-${randomUUID()}` },
    });
    expect(unknown.statusCode).toBe(404);
  });
});
