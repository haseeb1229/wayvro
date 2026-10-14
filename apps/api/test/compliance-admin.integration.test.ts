/**
 * K06 / A15 staff data entry with maker-checker (own harness: approving an age policy changes every account's
 * required actions): requirement-set draft → submit → approve by a DIFFERENT compliance admin → activate (retires the
 * placeholder, the checklist follows); age-policy values are entered from counsel's decision (no default threshold),
 * approved by a different admin, take effect on server time and re-require declarations; a drafter can never approve.
 */
import { AgeEligibilityPolicySchema, RequirementSetSchema } from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requirementSetActivationLockKey } from '../src/compliance/compliance-admin.service.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { bearer, signIn, startApi, type Harness } from './support.js';

let h: Harness;
let kit: ReturnType<typeof staffKit>;
let ca1: Staff;
let ca2: Staff;
beforeAll(async () => {
  h = await startApi({ env: STAFF_ENV });
  kit = staffKit(h);
  const admins = await kit.bootstrapAdmins(2);
  ca1 = await kit.staffWithRole(admins, 'COMPLIANCE_ADMIN', 'Compliance One');
  ca2 = await kit.staffWithRole(admins, 'COMPLIANCE_ADMIN', 'Compliance Two');
}, 60_000);
afterAll(async () => {
  await h.close();
});

describe('requirement sets (K06/R46)', () => {
  it('draft → submit → approve (different admin) → activate retires the placeholder', async () => {
    const draft = await kit.privileged(ca1, '/v1/admin/requirement-sets', {
      cityCode: 'LHR',
      serviceCategory: 'CAR',
      sourceReference: 'SYNTHETIC TEST REFERENCE — not a legal source',
      items: [
        { documentType: 'CNIC', mandatory: true, minValidityDaysAtSubmission: 30, renewalLeadDays: 30, appliesToOwnershipTypes: [], licenceClassesAllowed: [] },
        {
          documentType: 'DRIVING_LICENCE',
          mandatory: true,
          minValidityDaysAtSubmission: 30,
          renewalLeadDays: 30,
          appliesToOwnershipTypes: [],
          licenceClassesAllowed: ['LTV'],
        },
        {
          documentType: 'ROUTE_PERMIT',
          mandatory: true,
          minValidityDaysAtSubmission: 0,
          renewalLeadDays: 30,
          appliesToOwnershipTypes: [],
          licenceClassesAllowed: [],
        },
      ],
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const set = RequirementSetSchema.parse(draft.json());
    expect(set).toMatchObject({ status: 'DRAFT', version: 1, isPlaceholder: false, draftedByStaffId: ca1.staffId });
    expect(
      (
        await kit.privileged(ca1, '/v1/admin/requirement-sets', {
          cityCode: 'LHR',
          serviceCategory: 'CAR',
          sourceReference: 'x ref',
          items: [
            {
              documentType: 'NOT_A_TYPE',
              mandatory: true,
              minValidityDaysAtSubmission: 0,
              renewalLeadDays: 0,
              appliesToOwnershipTypes: [],
              licenceClassesAllowed: [],
            },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect((await kit.privileged(ca1, `/v1/admin/requirement-sets/${set.id}/activation`, {})).statusCode).toBe(409);
    expect(RequirementSetSchema.parse((await kit.privileged(ca1, `/v1/admin/requirement-sets/${set.id}/submission`, {})).json()).status).toBe(
      'PENDING_APPROVAL',
    );
    expect((await kit.privileged(ca1, `/v1/admin/requirement-sets/${set.id}/approval`, { decision: 'APPROVE' })).statusCode).toBe(403);
    expect(
      RequirementSetSchema.parse((await kit.privileged(ca2, `/v1/admin/requirement-sets/${set.id}/approval`, { decision: 'APPROVE' })).json()),
    ).toMatchObject({
      status: 'APPROVED',
      approvedByStaffId: ca2.staffId,
    });
    const active = RequirementSetSchema.parse((await kit.privileged(ca2, `/v1/admin/requirement-sets/${set.id}/activation`, {})).json());
    expect(active.status).toBe('ACTIVE');
    const list = (await h.inject({ method: 'GET', url: '/v1/admin/requirement-sets', headers: kit.sb(ca1) })).json<{
      sets: Array<{ version: number; status: string; isPlaceholder: boolean }>;
    }>().sets;
    expect(list.find((s) => s.version === 0)).toMatchObject({ status: 'RETIRED', isPlaceholder: true });
    expect(list.find((s) => s.version === 1)?.status).toBe('ACTIVE');
    // the database itself refuses an approver equal to the drafter
    await expect(
      h.owner.query(`update compliance.requirement_sets set approved_by_staff_id = drafted_by_staff_id where id = $1`, [set.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('requirement-set activation under concurrency', () => {
  const ITEMS = [
    { documentType: 'CNIC', mandatory: true, minValidityDaysAtSubmission: 30, renewalLeadDays: 30, appliesToOwnershipTypes: [], licenceClassesAllowed: [] },
  ];
  async function approvedSet(serviceCategory: string): Promise<string> {
    const d = await kit.privileged(ca1, '/v1/admin/requirement-sets', {
      cityCode: 'LHR',
      serviceCategory,
      sourceReference: 'SYNTHETIC TEST REFERENCE — not a legal source',
      items: ITEMS,
    });
    expect(d.statusCode, d.body).toBe(201);
    const id = RequirementSetSchema.parse(d.json()).id;
    expect((await kit.privileged(ca1, `/v1/admin/requirement-sets/${id}/submission`, {})).statusCode).toBe(200);
    expect((await kit.privileged(ca2, `/v1/admin/requirement-sets/${id}/approval`, { decision: 'APPROVE' })).statusCode).toBe(200);
    return id;
  }

  // Regression: an activation whose transaction began before a competing activation of the same (city, category)
  // committed must retire that set (not trip the one-ACTIVE index) and keep effective_until ≥ effective_from.
  it('an activation that waited behind a competing one retires it, in time order', async () => {
    const current = await approvedSet('BIKE');
    expect((await kit.privileged(ca2, `/v1/admin/requirement-sets/${current}/activation`, {})).statusCode).toBe(200);
    const [x, y] = [await approvedSet('BIKE'), await approvedSet('BIKE')];
    const competitor = await h.owner.connect();
    try {
      // the competitor holds what every activation writer holds: the (city, category) lock and the current ACTIVE row
      await competitor.query('begin');
      await competitor.query('select pg_advisory_xact_lock(hashtext($1))', [requirementSetActivationLockKey('LHR', 'BIKE')]);
      await competitor.query(
        `select id from compliance.requirement_sets where city_code = 'LHR' and service_category = 'BIKE' and status = 'ACTIVE' for update`,
      );
      const pending = kit.privileged(ca2, `/v1/admin/requirement-sets/${y}/activation`, {});
      // the request's transaction has started and is waiting on the competitor
      await expect
        .poll(
          async () =>
            (await h.owner.query<{ n: number }>(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`))
              .rows[0]?.n,
          { timeout: 10_000 },
        )
        .toBeGreaterThanOrEqual(1);
      await competitor.query(
        `update compliance.requirement_sets set status = 'RETIRED', effective_until = clock_timestamp() where city_code = 'LHR' and service_category = 'BIKE' and status = 'ACTIVE'`,
      );
      await competitor.query(`update compliance.requirement_sets set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [x]);
      await competitor.query('commit');
      const res = await pending;
      expect(res.statusCode, res.body).toBe(200);
    } finally {
      competitor.release();
    }
    const rows = await h.owner.query<{ id: string; status: string; ordered: boolean | null }>(
      `select id, status, effective_until >= effective_from ordered from compliance.requirement_sets where id = any($1::uuid[]) order by version`,
      [[x, y]],
    );
    expect(rows.rows).toEqual([
      { id: x, status: 'RETIRED', ordered: true },
      { id: y, status: 'ACTIVE', ordered: null },
    ]);
  });
});

describe('age-policy data entry (A15)', () => {
  it('values from counsel are entered by one admin, approved by another, then become current and re-require declarations', async () => {
    const rider = await signIn(h);
    const auth = bearer(rider.accessToken);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: '/v1/account/age-declarations',
          payload: { policyVersion: 1, affirmed: true },
          headers: { ...auth, 'idempotency-key': 'idem-age-before-000001' },
        })
      ).statusCode,
    ).toBe(201);
    const values = {
      riderDeclarationMode: 'AFFIRM_MINIMUM_AGE',
      riderMinimumAge: 30,
      driverMinimumAge: 30,
      guardianRulesRef: null,
      approvalRef: 'SYNTHETIC-COUNSEL-REF-1',
      effectiveAt: new Date(Date.now() - 1000).toISOString(),
    };
    // no threshold may be omitted for a mode that needs one
    expect((await kit.privileged(ca1, '/v1/admin/age-policies', { ...values, riderMinimumAge: null })).statusCode).toBe(400);
    const drafted = await kit.privileged(ca1, '/v1/admin/age-policies', values);
    expect(drafted.statusCode, drafted.body).toBe(201);
    const version = drafted.json<{ version: number; status: string }>();
    expect(version).toMatchObject({ version: 2, status: 'PENDING_APPROVAL' });
    // pending versions are not current
    expect(AgeEligibilityPolicySchema.parse((await h.inject({ method: 'GET', url: '/v1/legal/age-eligibility-policy' })).json()).version).toBe(1);
    expect((await kit.privileged(ca1, `/v1/admin/age-policies/${String(version.version)}/approval`, { decision: 'APPROVE' })).statusCode).toBe(403);
    expect((await kit.privileged(ca2, `/v1/admin/age-policies/${String(version.version)}/approval`, { decision: 'APPROVE' })).json()).toMatchObject({
      status: 'APPROVED',
      approvedByStaffId: ca2.staffId,
    });
    expect(AgeEligibilityPolicySchema.parse((await h.inject({ method: 'GET', url: '/v1/legal/age-eligibility-policy' })).json())).toMatchObject({
      version: 2,
      status: 'APPROVED',
      riderMinimumAge: 30,
    });
    const state = (await h.inject({ method: 'GET', url: '/v1/account/state', headers: auth })).json<{ requiredActions: string[] }>();
    expect(state.requiredActions).toContain('AGE_DECLARATION');
    // approved values are immutable in the database
    await expect(h.owner.query(`update legal.age_eligibility_policies set rider_minimum_age = 1 where version = 2`)).rejects.toMatchObject({ code: '42501' });
    const list = (await h.inject({ method: 'GET', url: '/v1/admin/age-policies', headers: kit.sb(ca1) })).json<{
      versions: Array<{ version: number; status: string }>;
    }>().versions;
    expect(list.map((v) => [v.version, v.status])).toEqual([
      [2, 'APPROVED'],
      [1, 'PLACEHOLDER_NOT_FOR_PRODUCTION'],
    ]);
  });
});
