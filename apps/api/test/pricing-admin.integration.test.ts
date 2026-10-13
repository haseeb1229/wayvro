/**
 * P3.3 staff pricing administration through the API as the restricted role (H06/E05; T3-23/T3-31/T3-33): tax policies
 * and rate cards under maker-checker (two DISTINCT PRICING_MANAGERs; service AND database refuse maker = checker; a
 * break-glass-active manager still cannot approve their own draft; STAFF_ADMIN is no pricing approver), the sanity
 * envelope override, activation (previous ACTIVE retired, outbox, audit), scheduling and cancellation, rollback as a new
 * version, QT-14 (stored quotes keep their card version), QT-15 at service level (production refuses synthetic and
 * placeholder configuration), previews without provider calls or quote rows, the reason-gated support quote lookup
 * (SUPPORT-QUOTE: districts and amounts, never coordinates) and CONC-PRICING for activations and version allocation.
 * Synthetic values only.
 */
import { randomUUID } from 'node:crypto';
import { PricingPreviewSchema, QuoteGroupSchema, RateCardSchema, StaffQuoteViewSchema, TaxPolicySchema } from '@wayvro/contracts';
import { createLogger } from '@wayvro/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdempotencyStore } from '../src/platform/idempotency.js';
import { PricingAdminService } from '../src/pricing/pricing-admin.service.js';
import type { StaffPrincipal } from '../src/staff/staff-session.js';
import type { GeoHarness } from './geo-helpers.js';
import { P, errorOf, getQuote, postQuote, quoteBody, quoteRows, startQuoteApi } from './pricing-helpers.js';
import { STAFF_ENV, staffKit, type Staff } from './staff-helpers.js';
import { key, post, signIn } from './support.js';

let g: GeoHarness & { zoneSetId: string };
let kit: ReturnType<typeof staffKit>;
let admins: Staff[];
let maker: Staff;
let checker: Staff;
let auditor: Staff;
let support: Staff;
const log = createLogger({ service: 'api', env: 'test', level: 'fatal' });

const values = (overrides: Record<string, string | number> = {}) => ({
  baseMinor: '12000',
  perKmMinor: '3600',
  perMinMinor: '500',
  minimumFareMinor: '25000',
  bookingFeeMinor: '1000',
  airportPickupFeeMinor: '20000',
  roundingStepMinor: '1000',
  roundingMode: 'HALF_UP',
  tollPolicy: 'EXCLUDED_DISCLOSED',
  taxPolicyId: P.taxPolicyId,
  quoteTtlSeconds: 300,
  maxDistanceM: 60000,
  maxDurationS: 7200,
  ...overrides,
});
const card = (res: { json: () => unknown }) => RateCardSchema.parse(res.json());
const as = (s: Staff, url: string, body: unknown) => g.h.inject(post(url, body, kit.sb(s)));
const stepped = (s: Staff, url: string, body: unknown) => kit.privileged(s, url, body);

async function draft(s: Staff, product = 'ECONOMY', v = values(), synthetic = true) {
  const res = await as(s, '/v1/admin/pricing/rate-cards', {
    cityCode: 'LHR',
    productCode: product,
    sourceReference: 'SYNTHETIC — not a Wayvro price',
    isSynthetic: synthetic,
    values: v,
  });
  expect(res.statusCode, res.body).toBe(201);
  return card(res);
}
async function approved(product = 'ECONOMY', v = values()) {
  const d = await draft(maker, product, v);
  const submitted = await as(maker, `/v1/admin/pricing/rate-cards/${d.id}/submission`, { envelopeOverrideReasonCode: 'SYNTHETIC_TEST_CHANGE' });
  expect(submitted.statusCode, submitted.body).toBe(200);
  const ok = await stepped(checker, `/v1/admin/pricing/rate-cards/${d.id}/approval`, { decision: 'APPROVE', reasonCode: 'SYNTHETIC_REVIEWED' });
  expect(ok.statusCode, ok.body).toBe(200);
  return card(ok);
}

beforeAll(async () => {
  g = await startQuoteApi({ env: STAFF_ENV });
  kit = staffKit(g.h);
  admins = await kit.bootstrapAdmins(2);
  maker = await kit.staffWithRole(admins, 'PRICING_MANAGER', 'Pricing Maker');
  checker = await kit.staffWithRole(admins, 'PRICING_MANAGER', 'Pricing Checker');
  auditor = await kit.staffWithRole(admins, 'AUDITOR', 'Pricing Auditor');
  support = await kit.staffWithRole(admins, 'SUPPORT_AGENT', 'Support Agent');
}, 180_000);
afterAll(async () => {
  await g.h.close();
});

describe('tax policies (maker-checker)', () => {
  it('draft → submit (drafter only) → the drafter cannot approve (service + database) → a different manager approves → retire refused while in use', async () => {
    const created = await as(maker, '/v1/admin/pricing/tax-policies', {
      code: 'SYNTH-TAX-10',
      jurisdictionCode: 'PK-PB',
      rateBp: 1000,
      appliesTo: ['BASE', 'DISTANCE', 'TIME', 'MINIMUM_ADJUSTMENT', 'BOOKING_FEE'],
      inclusive: false,
      isPlaceholder: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    const tax = TaxPolicySchema.parse(created.json());
    expect(tax).toMatchObject({ status: 'DRAFT', version: 1, draftedByStaffId: maker.staffId, roundingMode: 'HALF_EVEN' });
    expect((await as(checker, `/v1/admin/pricing/tax-policies/${tax.id}/submission`, {})).statusCode).toBe(403);
    expect((await as(maker, `/v1/admin/pricing/tax-policies/${tax.id}/submission`, {})).json()).toMatchObject({ status: 'PENDING_APPROVAL' });
    const self = await stepped(maker, `/v1/admin/pricing/tax-policies/${tax.id}/approval`, { decision: 'APPROVE' });
    expect(self.statusCode).toBe(403);
    expect(errorOf(self)?.details?.reasonCodes).toEqual(['MAKER_IS_CHECKER']);
    await expect(
      g.h.runtime.db.pool.query(`update pricing.tax_policies set status = 'APPROVED', approved_by_staff_id = drafted_by_staff_id where id = $1`, [tax.id]),
    ).rejects.toMatchObject({ code: '42501' });
    expect((await stepped(checker, `/v1/admin/pricing/tax-policies/${tax.id}/approval`, { decision: 'APPROVE' })).json()).toMatchObject({
      status: 'APPROVED',
      approvedByStaffId: checker.staffId,
    });
    // a non-placeholder policy needs a legal reference (schema) — and the seeded placeholder in use cannot be retired
    expect(
      (
        await as(maker, '/v1/admin/pricing/tax-policies', {
          code: 'REAL-TAX',
          jurisdictionCode: 'PK',
          rateBp: 0,
          appliesTo: ['BASE'],
          inclusive: false,
          isPlaceholder: false,
        })
      ).statusCode,
    ).toBe(400);
    const inUse = await stepped(checker, `/v1/admin/pricing/tax-policies/${P.taxPolicyId}/retirement`, {});
    expect(inUse.statusCode).toBe(409);
    expect(errorOf(inUse)?.details?.reasonCodes).toEqual(['TAX_POLICY_IN_USE']);
    const list = await g.h.inject({ method: 'GET', url: '/v1/admin/pricing/tax-policies', headers: kit.sb(auditor) });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ taxPolicies: Array<{ code: string; activeCardCount: number }> }>().taxPolicies).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SYNTH-TAX-0', activeCardCount: 2 })]),
    );
  });
});

describe('rate cards (H06/T3-23)', () => {
  it('only the drafter edits a DRAFT; values freeze at submission; a DRAFT tax policy blocks the submission', async () => {
    const d = await draft(maker);
    expect(d).toMatchObject({ status: 'DRAFT', version: 2, activeCardId: P.economyCardId });
    expect(d.diffVsActive.map((x) => x.field).sort()).toEqual(['baseMinor', 'perKmMinor']);
    const other = await as(checker, `/v1/admin/pricing/rate-cards/${d.id}/values`, { values: values() });
    expect(errorOf(other)?.details?.reasonCodes).toEqual(['NOT_DRAFTER']);
    expect(card(await as(maker, `/v1/admin/pricing/rate-cards/${d.id}/values`, { values: values({ baseMinor: '11000' }) })).values?.baseMinor).toBe('11000');
    // a minimum fare that is not a multiple of the rounding step is a schema error
    expect((await as(maker, `/v1/admin/pricing/rate-cards/${d.id}/values`, { values: values({ minimumFareMinor: '25500' }) })).statusCode).toBe(400);
    // a client-supplied amount as a JSON number is refused (money is a decimal string)
    expect((await as(maker, `/v1/admin/pricing/rate-cards/${d.id}/values`, { values: { ...values(), baseMinor: 11000 } })).statusCode).toBe(400);
    const draftTax = TaxPolicySchema.parse(
      (
        await as(maker, '/v1/admin/pricing/tax-policies', {
          code: 'SYNTH-TAX-D',
          jurisdictionCode: 'PK',
          rateBp: 0,
          appliesTo: ['BASE'],
          inclusive: false,
          isPlaceholder: true,
        })
      ).json(),
    );
    const blocked = await draft(maker, 'COMFORT', values({ taxPolicyId: draftTax.id }));
    const refused = await as(maker, `/v1/admin/pricing/rate-cards/${blocked.id}/submission`, {});
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused)?.details?.reasonCodes).toEqual(['TAX_POLICY_NOT_APPROVED']);
    const submitted = card(await as(maker, `/v1/admin/pricing/rate-cards/${d.id}/submission`, {}));
    expect(submitted.status).toBe('PENDING_APPROVAL');
    // the default synthetic preview is recorded at submission: ACTIVE first, the change visible per tuple
    expect(submitted.submissionPreview?.benchmarkSet).toBe('DEFAULT_SYNTHETIC_V1');
    expect(submitted.submissionPreview?.cards.map((c) => c.rateCardId)).toEqual([P.economyCardId, d.id]);
    expect(submitted.submissionPreview?.rows).toHaveLength(12);
    expect(submitted.submissionPreview?.rows[0]?.results[1]?.deltaVsFirst).not.toBeNull();
    expect((await as(maker, `/v1/admin/pricing/rate-cards/${d.id}/values`, { values: values() })).statusCode).toBe(409);
    expect(
      (await g.h.owner.query(`select action from audit.audit_events where object_id = $1 and action like 'RATE_CARD_%' order by seq`, [d.id])).rows.map(
        (r: { action: string }) => r.action,
      ),
    ).toEqual(['RATE_CARD_DRAFTED', 'RATE_CARD_VALUES_REPLACED', 'RATE_CARD_PREVIEWED', 'RATE_CARD_SUBMITTED']);
    // reject to leave the pipeline clean
    expect(card(await stepped(checker, `/v1/admin/pricing/rate-cards/${d.id}/approval`, { decision: 'REJECT', reasonCode: 'SYNTHETIC_TEST' })).status).toBe(
      'REJECTED',
    );
  });

  it('the sanity envelope: values outside the bounds or > the max change need an explicit override reason the approver sees', async () => {
    const d = await draft(maker, 'ECONOMY', values({ perKmMinor: '90000' }));
    expect(d.envelopeViolations).toEqual(expect.arrayContaining(['ENVELOPE_PER_KM_OUT_OF_BOUNDS', 'ENVELOPE_PER_KM_CHANGE_EXCEEDED']));
    const refused = await as(maker, `/v1/admin/pricing/rate-cards/${d.id}/submission`, {});
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused)?.details?.reasonCodes?.[0]).toBe('ENVELOPE_OVERRIDE_REQUIRED');
    const ok = card(await as(maker, `/v1/admin/pricing/rate-cards/${d.id}/submission`, { envelopeOverrideReasonCode: 'SYNTHETIC_STRESS_VALUE' }));
    expect(ok).toMatchObject({ status: 'PENDING_APPROVAL', envelopeOverrideReasonCode: 'SYNTHETIC_STRESS_VALUE' });
    const seen = card(await g.h.inject({ method: 'GET', url: `/v1/admin/pricing/rate-cards/${d.id}`, headers: kit.sb(checker) }));
    expect(seen.envelopeOverrideReasonCode).toBe('SYNTHETIC_STRESS_VALUE');
    expect(card(await stepped(checker, `/v1/admin/pricing/rate-cards/${d.id}/approval`, { decision: 'REJECT' })).status).toBe('REJECTED');
  });

  it('maker ≠ checker: refused for the drafter (even break-glass active), refused for STAFF_ADMIN, refused by the database; approval needs a reason', async () => {
    const d = await draft(maker);
    await as(maker, `/v1/admin/pricing/rate-cards/${d.id}/submission`, { envelopeOverrideReasonCode: 'SYNTHETIC_TEST_CHANGE' });
    // the maker also holds a break-glass-capable role (KYC reviewer, LHR) and activates break-glass: still no shortcut
    await kit.grant(admins[0] as Staff, admins[1] as Staff, maker.staffId, 'KYC_REVIEWER', ['LHR']);
    const bg = await stepped(maker, '/v1/admin/break-glass', {
      reasonCode: 'SYSTEM_RECOVERY',
      justification: 'synthetic break-glass maker-checker probe',
      durationMinutes: 5,
    });
    expect(bg.statusCode, bg.body).toBe(201);
    const self = await stepped(maker, `/v1/admin/pricing/rate-cards/${d.id}/approval`, { decision: 'APPROVE', reasonCode: 'SYNTHETIC_REVIEWED' });
    expect(self.statusCode).toBe(403);
    expect(errorOf(self)?.details?.reasonCodes).toEqual(['MAKER_IS_CHECKER']);
    expect(
      (
        await g.h.owner.query(
          `select 1 from audit.audit_events where action = 'BREAK_GLASS_ACTION' and actor_id = $1 and reason_code = 'PRICING_RATE_CARD_APPROVE'`,
          [maker.staffId],
        )
      ).rowCount,
    ).toBeGreaterThan(0);
    const end = await g.h.inject(post(`/v1/admin/break-glass/${bg.json<{ id: string }>().id}/end`, {}, kit.sb(maker)));
    expect(end.statusCode, end.body).toBeLessThan(300);
    // STAFF_ADMIN holds no pricing permission at all
    expect(
      (await stepped(admins[0] as Staff, `/v1/admin/pricing/rate-cards/${d.id}/approval`, { decision: 'APPROVE', reasonCode: 'SYNTHETIC_REVIEWED' }))
        .statusCode,
    ).toBe(403);
    // the database refuses maker = checker on its own
    await expect(
      g.h.runtime.db.pool.query(
        `update pricing.rate_cards set status = 'APPROVED', approved_by_staff_id = drafted_by_staff_id, approval_reason_code = 'SYNTHETIC_REVIEWED' where id = $1`,
        [d.id],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const noReason = await stepped(checker, `/v1/admin/pricing/rate-cards/${d.id}/approval`, { decision: 'APPROVE' });
    expect(errorOf(noReason)).toMatchObject({ code: 'WAYVRO_E_VALIDATION', details: { reasonCodes: ['APPROVAL_REASON_REQUIRED'] } });
    expect(card(await stepped(checker, `/v1/admin/pricing/rate-cards/${d.id}/approval`, { decision: 'REJECT' })).status).toBe('REJECTED');
  });

  it('activation now retires the previous ACTIVE card (outbox + audit); QT-14: stored quotes keep their card version, new quotes use the new one', async () => {
    const rider = await signIn(g.h);
    const before = QuoteGroupSchema.parse((await postQuote(g.h, rider.accessToken, quoteBody())).json());
    expect(before.options[0]?.rateCardVersion).toBe(1);
    const a = await approved();
    const active = card(await stepped(checker, `/v1/admin/pricing/rate-cards/${a.id}/activation`, { when: 'NOW' }));
    expect(active).toMatchObject({ status: 'ACTIVE', scheduled: false, activeCardId: null });
    expect((await g.h.owner.query(`select status from pricing.rate_cards where id = $1`, [P.economyCardId])).rows).toEqual([{ status: 'RETIRED' }]);
    const event = await g.h.owner.query<{ payload: Record<string, unknown> }>(
      `select payload from platform.outbox_events where type = 'pricing.rate-card.activated.v1' and aggregate_id = $1`,
      [a.id],
    );
    expect(event.rows[0]?.payload).toMatchObject({
      cityCode: 'LHR',
      productCode: 'ECONOMY',
      version: a.version,
      previousRateCardId: P.economyCardId,
      scheduled: false,
    });
    expect(g.h.logs.text()).toContain('RATE_CARD_ACTIVATED');
    const restored = QuoteGroupSchema.parse((await getQuote(g.h, rider.accessToken, before.quoteGroupId)).json());
    expect(restored.options[0]).toMatchObject({ rateCardVersion: 1, total: before.options[0]?.total, components: before.options[0]?.components });
    const after = QuoteGroupSchema.parse((await postQuote(g.h, rider.accessToken, quoteBody())).json());
    expect(after.options[0]?.rateCardVersion).toBe(a.version);
    // activating the now-ACTIVE card again is a clean conflict
    expect((await stepped(checker, `/v1/admin/pricing/rate-cards/${a.id}/activation`, { when: 'NOW' })).statusCode).toBe(409);
  });

  it('scheduling: never in the past; cancellable while APPROVED; an older version than the ACTIVE card cannot be activated', async () => {
    const a = await approved();
    const past = await stepped(checker, `/v1/admin/pricing/rate-cards/${a.id}/activation`, {
      when: 'SCHEDULED',
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(errorOf(past)?.details?.reasonCodes).toEqual(['EFFECTIVE_FROM_IN_PAST']);
    const at = new Date(Date.now() + 3_600_000).toISOString();
    expect(card(await stepped(checker, `/v1/admin/pricing/rate-cards/${a.id}/activation`, { when: 'SCHEDULED', effectiveFrom: at }))).toMatchObject({
      status: 'APPROVED',
      scheduled: true,
      effectiveFrom: at,
    });
    expect(card(await stepped(maker, `/v1/admin/pricing/rate-cards/${a.id}/schedule-cancellation`, {}))).toMatchObject({
      scheduled: false,
      effectiveFrom: null,
    });
    expect(errorOf(await stepped(maker, `/v1/admin/pricing/rate-cards/${a.id}/schedule-cancellation`, {}))?.details?.reasonCodes).toEqual(['NOT_SCHEDULED']);
    // a newer version becomes ACTIVE first; the older APPROVED card is then refused
    const b = await approved();
    expect(card(await stepped(checker, `/v1/admin/pricing/rate-cards/${b.id}/activation`, { when: 'NOW' })).status).toBe('ACTIVE');
    const older = await stepped(checker, `/v1/admin/pricing/rate-cards/${a.id}/activation`, { when: 'NOW' });
    expect(errorOf(older)?.details?.reasonCodes).toEqual(['NEWER_CARD_ACTIVE']);
  });

  it('rollback: a NEW version cloned from a RETIRED card, PENDING_APPROVAL, approved by the other manager; history is never rewritten', async () => {
    const res = await stepped(maker, `/v1/admin/pricing/rate-cards/${P.economyCardId}/rollbacks`, {});
    expect(res.statusCode, res.body).toBe(201);
    const r = card(res);
    expect(r).toMatchObject({ status: 'PENDING_APPROVAL', supersedesId: P.economyCardId, draftedByStaffId: maker.staffId });
    expect(r.values).toMatchObject({ baseMinor: String(P.cards.ECONOMY.baseMinor), perKmMinor: String(P.cards.ECONOMY.perKmMinor) });
    expect((await stepped(maker, `/v1/admin/pricing/rate-cards/${r.id}/approval`, { decision: 'APPROVE', reasonCode: 'ROLLBACK_APPROVED' })).statusCode).toBe(
      403,
    );
    expect(card(await stepped(checker, `/v1/admin/pricing/rate-cards/${r.id}/approval`, { decision: 'APPROVE', reasonCode: 'ROLLBACK_APPROVED' })).status).toBe(
      'APPROVED',
    );
    expect(card(await stepped(checker, `/v1/admin/pricing/rate-cards/${r.id}/activation`, { when: 'NOW' })).status).toBe('ACTIVE');
    expect((await g.h.owner.query(`select status from pricing.rate_cards where id = $1`, [P.economyCardId])).rows).toEqual([{ status: 'RETIRED' }]);
    // a DRAFT cannot be a rollback source
    const d = await draft(maker);
    expect(errorOf(await stepped(maker, `/v1/admin/pricing/rate-cards/${d.id}/rollbacks`, {}))?.details?.reasonCodes).toEqual(['ROLLBACK_SOURCE_INVALID']);
    const clone = card(await as(maker, `/v1/admin/pricing/rate-cards/${r.id}/clones`, {}));
    expect(clone).toMatchObject({ status: 'DRAFT', supersedesId: r.id, values: r.values });
  });

  it('CONC-PRICING: concurrent activations of two APPROVED cards leave exactly one ACTIVE; concurrent drafts get distinct versions', async () => {
    const [x, y] = [await approved('COMFORT'), await approved('COMFORT')];
    await Promise.all([kit.stepUp(checker)]);
    const results = await Promise.all([x, y].map((c) => g.h.inject(post(`/v1/admin/pricing/rate-cards/${c.id}/activation`, { when: 'NOW' }, kit.sb(checker)))));
    for (const r of results) expect([200, 409]).toContain(r.statusCode);
    expect(
      (await g.h.owner.query(`select count(*)::int n from pricing.rate_cards where city_code = 'LHR' and product_code = 'COMFORT' and status = 'ACTIVE'`))
        .rows[0],
    ).toEqual({
      n: 1,
    });
    const drafts = await Promise.all([0, 1, 2].map(() => draft(maker, 'COMFORT')));
    expect(new Set(drafts.map((d) => d.version)).size).toBe(3);
  });

  it('AUDITOR reads configuration history but cannot draft; unknown ids are 404', async () => {
    expect(
      (await g.h.inject({ method: 'GET', url: '/v1/admin/pricing/rate-cards?cityCode=LHR&productCode=ECONOMY', headers: kit.sb(auditor) })).statusCode,
    ).toBe(200);
    expect(
      (await as(auditor, '/v1/admin/pricing/rate-cards', { cityCode: 'LHR', productCode: 'ECONOMY', sourceReference: 'x source', values: values() }))
        .statusCode,
    ).toBe(403);
    expect((await g.h.inject({ method: 'GET', url: `/v1/admin/pricing/rate-cards/${randomUUID()}`, headers: kit.sb(auditor) })).statusCode).toBe(404);
    expect(
      (await as(maker, '/v1/admin/pricing/rate-cards', { cityCode: 'XYZ', productCode: 'ECONOMY', sourceReference: 'x source', values: values() })).statusCode,
    ).toBe(404);
  });
});

describe('production refusals at service level (QT-15, T3-31)', () => {
  const principal = (s: Staff): StaffPrincipal => ({
    staffId: s.staffId,
    sessionId: randomUUID(),
    sessionStatus: 'ACTIVE',
    displayName: 'Synthetic',
    consumerAccountId: null,
    assignments: [],
    permissions: new Set(),
    stepUpAt: new Date(),
    activeCredentials: 1,
    breakGlassId: null,
    absoluteExpiresAt: new Date(Date.now() + 3_600_000),
  });

  it('a production profile refuses to activate a synthetic card on a placeholder tax policy (audited); no quote then exists for it', async () => {
    const a = await approved('COMFORT');
    const prod = new PricingAdminService(
      g.h.runtime.db.pool,
      new IdempotencyStore(g.h.runtime.db.pool, g.h.runtime.cipher),
      { WAYVRO_ENV: 'production', IDEMPOTENCY_TTL_SECONDS: 3600, PRICING_ENVELOPE_MAX_CHANGE_PERCENT: 50 },
      log,
    );
    const refused = await prod.activateRateCard(principal(checker), a.id, { when: 'NOW' }, key());
    expect(refused.outcome).toMatchObject({
      kind: 'error',
      code: 'WAYVRO_E_CONFLICT',
      details: { reasonCodes: ['SYNTHETIC_REFUSED_IN_PRODUCTION', 'PLACEHOLDER_TAX_REFUSED_IN_PRODUCTION'] },
    });
    expect((await g.h.owner.query(`select status from pricing.rate_cards where id = $1`, [a.id])).rows).toEqual([{ status: 'APPROVED' }]);
    expect((await g.h.owner.query(`select 1 from audit.audit_events where action = 'RATE_CARD_ACTIVATION_REFUSED' and object_id = $1`, [a.id])).rowCount).toBe(
      1,
    );
  });
});

describe('previews (no provider call, no quote row; audited)', () => {
  it('default synthetic benchmark set and custom tuples with up to 3 cards; deltas vs the first card', async () => {
    const before = { quotes: await quoteRows(g.h), route: g.doubles.control.calls('ROUTE') };
    const d = await draft(maker, 'ECONOMY', values({ perKmMinor: '4000' }));
    const res = await as(maker, '/v1/admin/pricing/previews', { rateCardIds: [P.economyCardId, d.id] });
    expect(res.statusCode, res.body).toBe(200);
    const preview = PricingPreviewSchema.parse(res.json());
    expect(preview.benchmarkSet).toBe('DEFAULT_SYNTHETIC_V1');
    expect(preview.rows).toHaveLength(12);
    for (const row of preview.rows) {
      const [first, second] = row.results;
      expect(first?.deltaVsFirst).toBeNull();
      if (first?.total && second?.total) expect(BigInt(second.deltaVsFirst?.minor ?? 'x')).toBe(BigInt(second.total.minor) - BigInt(first.total.minor));
    }
    const custom = PricingPreviewSchema.parse(
      (
        await as(maker, '/v1/admin/pricing/previews', {
          rateCardIds: [P.economyCardId],
          tuples: [
            { label: 'Example A', distanceM: 7351, durationS: 1234, airportPickup: false },
            { label: 'too long', distanceM: 70000, durationS: 600, airportPickup: false },
          ],
        })
      ).json(),
    );
    expect(custom.benchmarkSet).toBe('CUSTOM');
    expect(custom.rows[0]?.results[0]?.total).toEqual({ currency: 'PKR', minor: '47000' });
    expect(custom.rows[1]?.results[0]).toMatchObject({ outcome: 'ROUTE_TOO_LONG', total: null });
    expect(await quoteRows(g.h)).toEqual(before.quotes);
    expect(g.doubles.control.calls('ROUTE')).toBe(before.route);
    expect(
      (
        await g.h.owner.query(`select 1 from audit.audit_events where action = 'RATE_CARD_PREVIEWED' and object_id = $1 and reason_code = 'CUSTOM'`, [
          P.economyCardId,
        ])
      ).rowCount,
    ).toBe(1);
    expect((await as(maker, '/v1/admin/pricing/previews', { rateCardIds: [randomUUID()] })).statusCode).toBe(404);
    expect((await as(maker, '/v1/admin/pricing/previews', { rateCardIds: [P.economyCardId, P.economyCardId] })).statusCode).toBe(400);
  });
});

describe('SUPPORT-QUOTE: reason-gated support lookup (T3-33)', () => {
  it('shows districts, amounts, components and versions — never coordinates or a polyline; audited; unknown ⇒ 404; no reason ⇒ 400', async () => {
    const rider = await signIn(g.h);
    const lat = 31.5204917;
    const q = QuoteGroupSchema.parse(
      (await postQuote(g.h, rider.accessToken, quoteBody({ lat, lng: 74.3587123 }, { lat: 31.4704917, lng: 74.2787123 }))).json(),
    );
    const quoteId = q.options[0]?.quoteId ?? '';
    const res = await as(maker, '/v1/admin/pricing/quote-lookups', { quoteId, reasonCode: 'FARE_DISPUTE' });
    expect(res.statusCode, res.body).toBe(200);
    const view = StaffQuoteViewSchema.parse(res.json());
    expect(view).toMatchObject({ quoteGroupId: q.quoteGroupId, cityCode: 'LHR', pickupDistrictCode: null, dropoffDistrictCode: null });
    expect(view.options[0]).toMatchObject({ quoteId, total: q.options[0]?.total, rateCardVersion: q.options[0]?.rateCardVersion });
    for (const f of ['31.5204', '74.3587', '31.4704', '74.2787', 'polyline', '"lat"', '"lng"']) expect(res.body).not.toContain(f);
    expect(
      (
        await g.h.owner.query(`select 1 from audit.audit_events where action = 'QUOTE_VIEWED_BY_STAFF' and object_id = $1 and reason_code = 'FARE_DISPUTE'`, [
          q.quoteGroupId,
        ])
      ).rowCount,
    ).toBe(1);
    expect((await as(maker, '/v1/admin/pricing/quote-lookups', { quoteGroupId: q.quoteGroupId, reasonCode: 'FARE_DISPUTE' })).statusCode).toBe(200);
    expect((await as(maker, '/v1/admin/pricing/quote-lookups', { quoteId })).statusCode).toBe(400);
    expect((await as(maker, '/v1/admin/pricing/quote-lookups', { quoteId: randomUUID(), reasonCode: 'FARE_DISPUTE' })).statusCode).toBe(404);
    expect((await as(auditor, '/v1/admin/pricing/quote-lookups', { quoteId, reasonCode: 'FARE_DISPUTE' })).statusCode).toBe(403);
    expect((await as(support, '/v1/admin/pricing/quote-lookups', { quoteId, reasonCode: 'FARE_DISPUTE' })).statusCode).toBe(403);
  });
});
