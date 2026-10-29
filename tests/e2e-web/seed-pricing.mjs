/*
 * Pricing-journey seed for the web-ops E2E stack (Phase 3, P3.3). SYNTHETIC data only, written into the throwaway
 * database `wayvro_e2e_ops`:
 *  - two DISTINCT PRICING_MANAGER staff (maker and checker; FA-10 — maker-checker needs two human identities) and one
 *    read-only AUDITOR, each with an ACTIVE assignment (requested by the first bootstrap admin, approved by the second)
 *    and an ENROLMENT invitation the spec redeems with a virtual authenticator;
 *  - a support-lookup fixture: a system-seeded placeholder tax policy (E2E-SYNTH-TAX, APPROVED), a RETIRED synthetic LHR
 *    zone set, a synthetic LHR/COMFORT rate card that is ACTIVE only while one synthetic quote group is priced with it
 *    and then RETIRED (so no ACTIVE card exists for any product: the catalog ENABLE prerequisite stays unmet and the
 *    spec's own COMFORT card is the one that becomes ACTIVE), and one PRICED quote with balanced components
 *    (BASE 15000 + DISTANCE 24500 + TIME 6500 + BOOKING_FEE 1000 = 47000 minor units).
 * The staff-less rows use the database's system-seed path (members of wayvro_migrator only — the local owner here),
 * exactly as the dev-only synthetic catalog seed does. Coordinates are coarse public-landmark points; the spec asserts
 * the staff quote view never shows them.
 */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

const fileUrl = (root, path) => new URL(`file://${join(root, path).replaceAll('\\', '/')}`).href;

const PICKUP = { lat: '31.52', lng: '74.35' };
const DROPOFF = { lat: '31.47', lng: '74.27' };

export async function seedPricing({ root, pool, adminIds }) {
  const { issueInvitation } = await import(fileUrl(root, 'apps/api/dist/staff/staff-admin.service.js'));
  const client = await pool.connect();
  try {
    await client.query('begin');
    const staff = async (displayName, workEmail, role) => {
      const staffId = randomUUID();
      const invitationId = randomUUID();
      await client.query(`insert into staff.staff_accounts (id, display_name, work_email, status) values ($1, $2, $3, 'INVITED')`, [
        staffId,
        displayName,
        workEmail,
      ]);
      await client.query(`insert into staff.invitations (id, staff_id, kind, status, created_by) values ($1, $2, 'ENROLMENT', 'PENDING_APPROVAL', $3)`, [
        invitationId,
        staffId,
        adminIds[0],
      ]);
      const invitation = await issueInvitation(client, invitationId, 3600);
      await client.query(
        `insert into staff.role_assignments (id, staff_id, role, status, requested_by, approved_by, decided_at, valid_from) values ($1, $2, $3, 'ACTIVE', $4, $5, now(), now())`,
        [randomUUID(), staffId, role, adminIds[0], adminIds[1]],
      );
      return { staffId, invitation: invitation.token };
    };
    const maker = await staff('E2E Pricing Maker', 'e2e.pricing.maker@example.org', 'PRICING_MANAGER');
    const checker = await staff('E2E Pricing Checker', 'e2e.pricing.checker@example.org', 'PRICING_MANAGER');
    const auditor = await staff('E2E Pricing Auditor', 'e2e.pricing.auditor@example.org', 'AUDITOR');

    // ── support-lookup fixture (system-seeded synthetic configuration) ──
    const taxPolicyId = randomUUID();
    await client.query(
      `insert into pricing.tax_policies (id, code, version, status, jurisdiction_code, rate_bp, applies_to, inclusive, rounding_mode, is_placeholder)
       values ($1, 'E2E-SYNTH-TAX', 1, 'APPROVED', 'PK', 0, '{BASE,DISTANCE,TIME,MINIMUM_ADJUSTMENT,BOOKING_FEE}', false, 'HALF_EVEN', true)`,
      [taxPolicyId],
    );
    const zoneSetId = randomUUID();
    await client.query(
      `insert into catalog.zone_sets (id, city_code, version, status, is_synthetic, source_reference, effective_from, effective_until)
       select $1, 'LHR', coalesce(max(version), 0) + 1, 'RETIRED', true, 'SYNTHETIC — E2E support-lookup fixture (no zones)', now() - interval '2 hours',
              now() - interval '1 hour'
         from catalog.zone_sets where city_code = 'LHR'`,
      [zoneSetId],
    );
    const cardId = randomUUID();
    const card = await client.query(
      `insert into pricing.rate_cards (id, city_code, product_code, version, status, is_synthetic, source_reference)
       select $1, 'LHR', 'COMFORT', coalesce(max(version), 0) + 1, 'DRAFT', true, 'SYNTHETIC — not a Wayvro price (E2E fixture)'
         from pricing.rate_cards where city_code = 'LHR' and product_code = 'COMFORT'
       returning version`,
      [cardId],
    );
    const cardVersion = card.rows[0].version;
    await client.query(
      `insert into pricing.rate_card_components (rate_card_id, base_minor, per_km_minor, per_min_minor, minimum_fare_minor, booking_fee_minor, airport_pickup_fee_minor,
                                                 rounding_step_minor, rounding_mode, toll_policy, tax_policy_id, quote_ttl_seconds, max_distance_m, max_duration_s)
       values ($1, 15000, 5000, 700, 35000, 1000, 20000, 1000, 'HALF_UP', 'EXCLUDED_DISCLOSED', $2, 300, 60000, 7200)`,
      [cardId, taxPolicyId],
    );
    await client.query(`update pricing.rate_cards set status = 'ACTIVE', effective_from = clock_timestamp() where id = $1`, [cardId]);
    const snapshotId = randomUUID();
    await client.query(
      `insert into pricing.route_snapshots (id, provider_key, sku, routing_profile, fetched_at, cache_status, confidence, distance_m, duration_s, polyline, latency_ms)
       values ($1, 'geo-e2e', 'ROUTE', 'CAR', now(), 'MISS', 'LOW', 4900, 930, null, 12)`,
      [snapshotId],
    );
    const accountId = randomUUID();
    await client.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [accountId]);
    const quoteId = randomUUID();
    const quoteGroupId = randomUUID();
    await client.query(
      `insert into pricing.quotes (id, quote_group_id, account_id, city_code, product_code, rate_card_id, rate_card_version, zone_set_id, pricing_engine_version,
                                   pickup, dropoff, airport_pickup, pickup_district_code, dropoff_district_code, distance_m, duration_s, route_snapshot_id, currency,
                                   total_minor, toll_policy, is_synthetic, status, created_at, expires_at, request_hash)
       values ($1, $2, $3, 'LHR', 'COMFORT', $4, $5, $6, 'pe-v1', ST_GeogFromText($7), ST_GeogFromText($8), false, 'LHR-LAHORE', 'LHR-LAHORE', 4900, 930, $9, 'PKR',
               47000, 'EXCLUDED_DISCLOSED', true, 'PRICED', now(), now() + interval '300 seconds', $10)`,
      [
        quoteId,
        quoteGroupId,
        accountId,
        cardId,
        cardVersion,
        zoneSetId,
        `POINT(${PICKUP.lng} ${PICKUP.lat})`,
        `POINT(${DROPOFF.lng} ${DROPOFF.lat})`,
        snapshotId,
        createHash('sha256').update(quoteId).digest(),
      ],
    );
    const components = [
      ['BASE', 15000],
      ['DISTANCE', 24500],
      ['TIME', 6500],
      ['BOOKING_FEE', 1000],
    ];
    for (const [n, [kind, amount]] of components.entries()) {
      await client.query(`insert into pricing.quote_components (quote_id, seq, kind, amount_minor) values ($1, $2, $3, $4)`, [quoteId, n + 1, kind, amount]);
    }
    await client.query(`update pricing.rate_cards set status = 'RETIRED', effective_until = clock_timestamp() where id = $1`, [cardId]);
    await client.query('commit');
    return {
      makerInvitation: maker.invitation,
      makerId: maker.staffId,
      checkerInvitation: checker.invitation,
      checkerId: checker.staffId,
      auditorInvitation: auditor.invitation,
      fixtureCardVersion: cardVersion,
      quoteId,
      quoteGroupId,
      pickup: PICKUP,
      dropoff: DROPOFF,
    };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
