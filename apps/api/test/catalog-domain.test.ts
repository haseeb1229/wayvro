/**
 * P3.1 pure catalog evaluators (server-only): HRS-01..11 + PROP-HOURS (brute-force minute oracle in Asia/Karachi,
 * UTC+05:00, no DST), zone policy cases + PROP-ZONE-DECISION, vehicle eligibility cases + PROP-ELIG-VEH. Property runs:
 * 500 per property (PHASE3_TEST_STRATEGY §4.2 PR tier); failures print the seed and shrunk counterexample.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cityProductObjectId } from '../src/catalog/catalog-admin.service.js';
import { isOpen, nextOpening, overlappingWindows, parseLocalTime, type ServiceHoursRow } from '../src/catalog/service-hours.js';
import { evaluateVehicleEligibility, type BodyType, type EligibilityRuleFacts, type VehicleFacts } from '../src/catalog/vehicle-eligibility.js';
import { decideZones, isServed, type PickupPointCandidate, type ZoneHit, type ZoneKind } from '../src/catalog/zone-decision.js';

const RUNS = { numRuns: 500 };
const H = 3_600_000;
const M = 60_000;
const row = (weekday: number, opens: string, closes: string, productCode: string | null = null): ServiceHoursRow => ({
  productCode,
  weekday,
  opensMs: parseLocalTime(opens),
  closesMs: parseLocalTime(closes),
});
/** A Karachi wall-clock instant (UTC+05:00) as a server Date. */
const pkt = (isoLocal: string): Date => new Date(`${isoLocal}+05:00`);
const DAILY = [0, 1, 2, 3, 4, 5, 6].map((d) => row(d, '06:00', '23:00'));

describe('HRS: service hours in Asia/Karachi from server time', () => {
  it('HRS-01 opens is inclusive; HRS-02 closes is exclusive', () => {
    expect(isOpen(DAILY, 'ECONOMY', pkt('2026-10-12T06:00:00.000'))).toBe(true);
    expect(isOpen(DAILY, 'ECONOMY', pkt('2026-10-12T05:59:59.999'))).toBe(false);
    expect(isOpen(DAILY, 'ECONOMY', pkt('2026-10-12T23:00:00.000'))).toBe(false);
    expect(isOpen(DAILY, 'ECONOMY', pkt('2026-10-12T22:59:59.999'))).toBe(true);
  });

  it('HRS-03/04/05 an overnight window is two rows (Fri 22:00–24:00, Sat 00:00–02:00)', () => {
    const rows = [row(5, '22:00', '24:00'), row(6, '00:00', '02:00')];
    expect(isOpen(rows, 'ECONOMY', pkt('2026-10-17T01:00:00.000'))).toBe(true);
    expect(isOpen(rows, 'ECONOMY', pkt('2026-10-17T02:00:00.000'))).toBe(false);
    expect(isOpen(rows, 'ECONOMY', pkt('2026-10-16T23:59:59.999'))).toBe(true);
    expect(isOpen(rows, 'ECONOMY', pkt('2026-10-17T00:00:00.000'))).toBe(true);
    expect(isOpen([row(5, '22:00', '24:00')], 'ECONOMY', pkt('2026-10-17T00:00:00.000'))).toBe(false);
  });

  it('HRS-06 the Karachi date decides: Sunday 20:30 UTC is Monday 01:30 PKT', () => {
    const rows = [row(1, '00:00', '06:00')];
    expect(isOpen(rows, 'ECONOMY', new Date('2026-10-11T20:30:00.000Z'))).toBe(true);
    expect(isOpen([row(0, '00:00', '24:00')], 'ECONOMY', new Date('2026-10-11T20:30:00.000Z'))).toBe(false);
  });

  it('HRS-07 product rows replace the general rows for that product; HRS-08 no applicable rows = closed', () => {
    const rows = [row(1, '00:00', '24:00'), row(1, '09:00', '10:00', 'COMFORT')];
    expect(isOpen(rows, 'ECONOMY', pkt('2026-10-12T20:00:00.000'))).toBe(true);
    expect(isOpen(rows, 'COMFORT', pkt('2026-10-12T20:00:00.000'))).toBe(false);
    expect(isOpen(rows, 'COMFORT', pkt('2026-10-12T09:30:00.000'))).toBe(true);
    expect(isOpen([], 'ECONOMY', pkt('2026-10-12T12:00:00.000'))).toBe(false);
    expect(isOpen([row(1, '09:00', '10:00', 'COMFORT')], 'ECONOMY', pkt('2026-10-12T09:30:00.000'))).toBe(false);
    expect(nextOpening([], 'ECONOMY', pkt('2026-10-12T12:00:00.000'))).toBeNull();
  });

  it('HRS-09 opens = closes means the whole day', () => {
    expect(isOpen([row(1, '10:00', '10:00')], 'ECONOMY', pkt('2026-10-12T00:00:00.000'))).toBe(true);
    expect(isOpen([row(1, '10:00', '10:00')], 'ECONOMY', pkt('2026-10-12T23:59:59.999'))).toBe(true);
    expect(isOpen([row(1, '10:00', '10:00')], 'ECONOMY', pkt('2026-10-13T00:00:00.000'))).toBe(false);
  });

  it('HRS-11 the next opening is computed in Asia/Karachi (Mon 23:30 PKT -> Tue 06:00 PKT = 01:00Z)', () => {
    expect(nextOpening(DAILY, 'ECONOMY', pkt('2026-10-12T23:30:00.000'))?.toISOString()).toBe('2026-10-13T01:00:00.000Z');
    expect(nextOpening(DAILY, 'ECONOMY', pkt('2026-10-12T05:00:00.000'))?.toISOString()).toBe('2026-10-12T01:00:00.000Z');
    // only Saturdays: from Sunday the next opening is six days later
    expect(nextOpening([row(6, '08:00', '09:00')], 'ECONOMY', pkt('2026-10-11T10:00:00.000'))?.toISOString()).toBe('2026-10-17T03:00:00.000Z');
    // open now = now
    const now = pkt('2026-10-12T12:00:00.000');
    expect(nextOpening(DAILY, 'ECONOMY', now)?.getTime()).toBe(now.getTime());
  });

  it('local time parsing accepts PostgreSQL time text incl. 24:00 and refuses garbage; overlaps are found per (product, weekday)', () => {
    expect(parseLocalTime('24:00:00')).toBe(24 * H);
    expect(parseLocalTime('06:30')).toBe(6 * H + 30 * M);
    expect(parseLocalTime('06:30:15.250000')).toBe(6 * H + 30 * M + 15_250);
    expect(() => parseLocalTime('25:00')).toThrow(RangeError);
    expect(() => parseLocalTime('6pm')).toThrow(RangeError);
    expect(overlappingWindows([row(1, '06:00', '12:00'), row(1, '11:00', '13:00')])).toEqual([{ productCode: null, weekday: 1 }]);
    expect(overlappingWindows([row(1, '06:00', '12:00'), row(1, '12:00', '13:00'), row(2, '11:00', '13:00', 'COMFORT')])).toEqual([]);
    expect(overlappingWindows([row(1, '10:00', '10:00'), row(1, '11:00', '12:00')])).toEqual([{ productCode: null, weekday: 1 }]);
  });
});

describe('PROP-HOURS: isOpen/nextOpening equal a minute-by-minute oracle over a year', () => {
  const PRODUCTS = [null, 'ECONOMY', 'COMFORT'] as const;
  const rowsArb = fc.array(
    fc
      .record({
        productCode: fc.constantFrom(...PRODUCTS),
        weekday: fc.integer({ min: 0, max: 6 }),
        opens: fc.integer({ min: 0, max: 1439 }),
        span: fc.integer({ min: 0, max: 1440 }),
      })
      .map(({ productCode, weekday, opens, span }) => ({
        productCode,
        weekday,
        opensMs: opens * M,
        closesMs: Math.min(opens + span, 1440) * M,
      })),
    { maxLength: 10 },
  );
  const YEAR_START = Date.UTC(2026, 0, 1);
  const YEAR_MS = 365 * 24 * H;
  const instantArb = fc.integer({ min: 0, max: YEAR_MS - 1 }).map((o) => new Date(YEAR_START + o));
  /** Independent oracle: weekly minute bitmap from Date UTC accessors shifted by +05:00. */
  const oracle = (rows: readonly ServiceHoursRow[], product: string) => {
    const own = rows.filter((r) => r.productCode === product);
    const applicable = own.length > 0 ? own : rows.filter((r) => r.productCode === null);
    const open = new Array<boolean>(7 * 1440).fill(false);
    for (const r of applicable) {
      const [a, b] = r.opensMs === r.closesMs ? [0, 1440] : [r.opensMs / M, r.closesMs / M];
      for (let m = a; m < b; m++) open[r.weekday * 1440 + m] = true;
    }
    const minuteOfWeek = (t: number) => {
      const d = new Date(t + 5 * H);
      return d.getUTCDay() * 1440 + d.getUTCHours() * 60 + d.getUTCMinutes();
    };
    return { open: (t: number) => open[minuteOfWeek(t)] === true, any: applicable.length > 0 };
  };

  it('isOpen(t) = oracle(t)', () => {
    fc.assert(
      fc.property(rowsArb, instantArb, fc.constantFrom('ECONOMY', 'COMFORT'), (rows, at, product) => {
        expect(isOpen(rows, product, at)).toBe(oracle(rows, product).open(at.getTime()));
      }),
      RUNS,
    );
  });

  it('nextOpening(t) is t when open, else the first open minute boundary after t (null without rows)', () => {
    fc.assert(
      fc.property(rowsArb, instantArb, fc.constantFrom('ECONOMY', 'COMFORT'), (rows, at, product) => {
        const o = oracle(rows, product);
        const next = nextOpening(rows, product, at);
        const t = at.getTime();
        if (o.open(t)) {
          expect(next?.getTime()).toBe(t);
          return;
        }
        let expected: number | null = null;
        for (let m = Math.floor(t / M) + 1; m <= Math.floor(t / M) + 8 * 1440; m++) {
          if (o.open(m * M)) {
            expected = m * M;
            break;
          }
        }
        expect(next?.getTime() ?? null).toBe(expected);
        if (!o.any) expect(next).toBeNull();
      }),
      { numRuns: 200 },
    );
  });
});

const hit = (kind: ZoneKind, at: { pickup?: boolean; dropoff?: boolean }, products: string[] = [], zoneId = `${kind}-1`): ZoneHit => ({
  zoneId,
  code: zoneId,
  kind,
  products,
  pickup: at.pickup ?? false,
  dropoff: at.dropoff ?? false,
});
const SA = hit('SERVICE_AREA', { pickup: true, dropoff: true });
const point = (
  zoneId: string,
  distanceM: number,
  kind: PickupPointCandidate['kind'] = 'DESIGNATED',
  covering: ZoneKind[] = ['SERVICE_AREA', 'PICKUP_RESTRICTED'],
): PickupPointCandidate => ({
  id: `${zoneId}-${String(distanceM)}`,
  zoneId,
  kind,
  distanceM,
  coveringZones: covering.map((k) => ({ kind: k, products: [] })),
});
const SNAP = 300;

describe('zone policy (E08, T3-14)', () => {
  it('served inside a service area; exclusion wins; both ends must be served', () => {
    expect(decideZones('ECONOMY', { zones: [SA], pickupPoints: [], snapMaxMeters: SNAP })).toEqual({
      kind: 'SERVED',
      snappedPickup: null,
      airportPickup: false,
    });
    expect(decideZones('ECONOMY', { zones: [SA, hit('EXCLUSION', { pickup: true })], pickupPoints: [], snapMaxMeters: SNAP }).kind).toBe('ZONE_NOT_SERVED');
    expect(decideZones('ECONOMY', { zones: [SA, hit('EXCLUSION', { dropoff: true })], pickupPoints: [], snapMaxMeters: SNAP }).kind).toBe('ZONE_NOT_SERVED');
    expect(decideZones('ECONOMY', { zones: [hit('SERVICE_AREA', { pickup: true })], pickupPoints: [], snapMaxMeters: SNAP }).kind).toBe('ZONE_NOT_SERVED');
    expect(decideZones('ECONOMY', { zones: [], pickupPoints: [], snapMaxMeters: SNAP }).kind).toBe('ZONE_NOT_SERVED');
  });

  it('ZB-12 zone product applicability: a zone scoped to COMFORT does not serve ECONOMY; an exclusion scoped to COMFORT does not exclude ECONOMY', () => {
    const comfortOnly = hit('SERVICE_AREA', { pickup: true, dropoff: true }, ['COMFORT']);
    expect(decideZones('ECONOMY', { zones: [comfortOnly], pickupPoints: [], snapMaxMeters: SNAP }).kind).toBe('ZONE_NOT_SERVED');
    expect(decideZones('COMFORT', { zones: [comfortOnly], pickupPoints: [], snapMaxMeters: SNAP }).kind).toBe('SERVED');
    const exclComfort = hit('EXCLUSION', { pickup: true }, ['COMFORT']);
    expect(decideZones('ECONOMY', { zones: [SA, exclComfort], pickupPoints: [], snapMaxMeters: SNAP }).kind).toBe('SERVED');
    expect(decideZones('COMFORT', { zones: [SA, exclComfort], pickupPoints: [], snapMaxMeters: SNAP }).kind).toBe('ZONE_NOT_SERVED');
  });

  it('ZB-09 a restricted pickup snaps to the nearest served point within the radius, else PICKUP_RESTRICTED; ZB-11 drop-off inside is allowed', () => {
    const restricted = hit('PICKUP_RESTRICTED', { pickup: true }, [], 'R1');
    expect(decideZones('ECONOMY', { zones: [SA, restricted], pickupPoints: [], snapMaxMeters: SNAP }).kind).toBe('PICKUP_RESTRICTED');
    const far = point('R1', 301);
    expect(decideZones('ECONOMY', { zones: [SA, restricted], pickupPoints: [far], snapMaxMeters: SNAP }).kind).toBe('PICKUP_RESTRICTED');
    const near = point('R1', 120);
    const nearer = point('R1', 40);
    const d = decideZones('ECONOMY', { zones: [SA, restricted], pickupPoints: [near, nearer, far], snapMaxMeters: SNAP });
    expect(d).toEqual({ kind: 'SERVED', snappedPickup: nearer, airportPickup: false });
    // a point that is itself excluded never serves
    const excludedPoint = point('R1', 10, 'DESIGNATED', ['SERVICE_AREA', 'EXCLUSION']);
    expect(decideZones('ECONOMY', { zones: [SA, restricted], pickupPoints: [excludedPoint], snapMaxMeters: SNAP }).kind).toBe('PICKUP_RESTRICTED');
    const dropoffInside = hit('PICKUP_RESTRICTED', { dropoff: true }, [], 'R2');
    expect(decideZones('ECONOMY', { zones: [SA, dropoffInside], pickupPoints: [], snapMaxMeters: SNAP }).kind).toBe('SERVED');
  });

  it('ZB-10 an airport precinct pickup snaps only to AIRPORT points and is flagged airportPickup', () => {
    const airport = hit('AIRPORT_PRECINCT', { pickup: true }, [], 'A1');
    const designated = point('A1', 5, 'DESIGNATED', ['SERVICE_AREA', 'AIRPORT_PRECINCT']);
    expect(decideZones('ECONOMY', { zones: [SA, airport], pickupPoints: [designated], snapMaxMeters: SNAP }).kind).toBe('PICKUP_RESTRICTED');
    const bay = point('A1', 50, 'AIRPORT', ['SERVICE_AREA', 'AIRPORT_PRECINCT']);
    expect(decideZones('ECONOMY', { zones: [SA, airport], pickupPoints: [designated, bay], snapMaxMeters: SNAP })).toEqual({
      kind: 'SERVED',
      snappedPickup: bay,
      airportPickup: true,
    });
  });
});

describe('PROP-ZONE-DECISION', () => {
  const zoneArb = fc.record({
    kind: fc.constantFrom<ZoneKind>('SERVICE_AREA', 'EXCLUSION', 'PICKUP_RESTRICTED', 'AIRPORT_PRECINCT'),
    products: fc.constantFrom<string[]>([], ['ECONOMY'], ['COMFORT'], ['ECONOMY', 'COMFORT']),
    pickup: fc.boolean(),
    dropoff: fc.boolean(),
    zoneId: fc.constantFrom('Z1', 'Z2', 'Z3', 'Z4'),
  });
  const pointArb = fc.record({
    id: fc.uuid(),
    zoneId: fc.constantFrom('Z1', 'Z2', 'Z3', 'Z4'),
    kind: fc.constantFrom<PickupPointCandidate['kind']>('AIRPORT', 'DESIGNATED', 'LANDMARK'),
    distanceM: fc.double({ min: 0, max: 2000, noNaN: true }),
    coveringZones: fc.array(
      fc.record({
        kind: fc.constantFrom<ZoneKind>('SERVICE_AREA', 'EXCLUSION', 'PICKUP_RESTRICTED', 'AIRPORT_PRECINCT'),
        products: fc.constantFrom<string[]>([], ['ECONOMY'], ['COMFORT']),
      }),
      { maxLength: 4 },
    ),
  });
  const input = fc.record({
    zones: fc.array(zoneArb, { maxLength: 6 }).map((zs) => zs.map((z) => ({ ...z, code: z.zoneId }))),
    pickupPoints: fc.array(pointArb, { maxLength: 5 }),
    snapMaxMeters: fc.integer({ min: 25, max: 2000 }),
  });
  const applies = (z: { products: readonly string[] }, p: string) => z.products.length === 0 || z.products.includes(p);

  it('an applicable EXCLUSION at either end, or no applicable SERVICE_AREA, is always ZONE_NOT_SERVED; restricted pickups are never served unsnapped', () => {
    fc.assert(
      fc.property(input, fc.constantFrom('ECONOMY', 'COMFORT'), (i, product) => {
        const d = decideZones(product, i);
        for (const end of ['pickup', 'dropoff'] as const) {
          const at = i.zones.filter((z) => z[end] && applies(z, product));
          if (at.some((z) => z.kind === 'EXCLUSION') || !at.some((z) => z.kind === 'SERVICE_AREA')) expect(d.kind).toBe('ZONE_NOT_SERVED');
        }
        const restricted = i.zones.some((z) => z.pickup && applies(z, product) && (z.kind === 'PICKUP_RESTRICTED' || z.kind === 'AIRPORT_PRECINCT'));
        if (d.kind === 'SERVED' && restricted) {
          expect(d.snappedPickup).not.toBeNull();
          expect(d.snappedPickup?.distanceM).toBeLessThanOrEqual(i.snapMaxMeters);
          expect(isServed(d.snappedPickup?.coveringZones ?? [], product)).toBe(true);
          if (d.airportPickup) expect(d.snappedPickup?.kind).toBe('AIRPORT');
        }
        if (d.kind === 'SERVED' && !restricted) expect(d.snappedPickup).toBeNull();
      }),
      RUNS,
    );
  });
});

const BODIES: readonly BodyType[] = ['HATCHBACK', 'SEDAN', 'SUV', 'CROSSOVER', 'MPV', 'MOTORCYCLE', 'AUTO_RICKSHAW'];
const NOW = new Date('2026-10-13T10:00:00.000Z');
const baseRule: EligibilityRuleFacts = {
  id: 'rule-1',
  version: 3,
  vehicleClass: 'CAR',
  minModelYear: null,
  maxVehicleAgeYears: 10,
  minSeats: 4,
  acRequired: true,
  allowedBodyTypes: ['SEDAN', 'SUV'],
};
const car: VehicleFacts = { serviceCategory: 'CAR', modelYear: 2020, seats: 4, bodyType: 'SEDAN', airConditioned: true };

describe('vehicle eligibility (H10)', () => {
  it('ELIGIBLE / NOT_ELIGIBLE(reasons) / UNKNOWN(missing) with the rule version recorded', () => {
    expect(evaluateVehicleEligibility(baseRule, car, NOW)).toEqual({ kind: 'ELIGIBLE', ruleId: 'rule-1', ruleVersion: 3 });
    expect(evaluateVehicleEligibility(baseRule, { ...car, modelYear: 2015 }, NOW)).toEqual({
      kind: 'NOT_ELIGIBLE',
      reasons: ['VEHICLE_TOO_OLD'],
      ruleId: 'rule-1',
      ruleVersion: 3,
    });
    expect(evaluateVehicleEligibility(baseRule, { ...car, seats: null, bodyType: null, airConditioned: null }, NOW)).toEqual({
      kind: 'UNKNOWN',
      missingAttributes: ['seats', 'airConditioned', 'bodyType'],
      ruleId: 'rule-1',
      ruleVersion: 3,
    });
    // a failing criterion beats unknown attributes
    expect(evaluateVehicleEligibility(baseRule, { ...car, seats: null, airConditioned: false }, NOW).kind).toBe('NOT_ELIGIBLE');
    expect(evaluateVehicleEligibility(baseRule, { ...car, serviceCategory: 'BIKE' }, NOW)).toMatchObject({ reasons: ['VEHICLE_CLASS_MISMATCH'] });
    expect(evaluateVehicleEligibility({ ...baseRule, maxVehicleAgeYears: null, minModelYear: 2021 }, car, NOW)).toMatchObject({
      reasons: ['MODEL_YEAR_TOO_OLD'],
    });
    expect(evaluateVehicleEligibility(null, car, NOW)).toEqual({ kind: 'NOT_ELIGIBLE', reasons: ['NO_ACTIVE_RULE'], ruleId: null, ruleVersion: null });
  });

  it('vehicle age uses the Karachi year of the server instant (31 Dec 19:30 UTC is already the new year in PKT)', () => {
    const rule = { ...baseRule, maxVehicleAgeYears: 5, minSeats: null, acRequired: false, allowedBodyTypes: [] };
    const v = { ...car, modelYear: 2021 };
    expect(evaluateVehicleEligibility(rule, v, new Date('2026-12-31T18:59:59.000Z')).kind).toBe('ELIGIBLE');
    expect(evaluateVehicleEligibility(rule, v, new Date('2026-12-31T19:00:00.000Z')).kind).toBe('NOT_ELIGIBLE');
  });
});

describe('PROP-ELIG-VEH', () => {
  const ruleArb = fc.record({
    id: fc.constant('r'),
    version: fc.integer({ min: 1, max: 50 }),
    vehicleClass: fc.constantFrom('CAR', 'BIKE'),
    minModelYear: fc.option(fc.integer({ min: 1990, max: 2030 }), { nil: null }),
    maxVehicleAgeYears: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
    minSeats: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
    acRequired: fc.boolean(),
    allowedBodyTypes: fc.subarray([...BODIES]),
  });
  const vehicleArb = fc.record({
    serviceCategory: fc.constantFrom('CAR', 'BIKE'),
    modelYear: fc.integer({ min: 1985, max: 2030 }),
    seats: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
    bodyType: fc.option(fc.constantFrom(...BODIES), { nil: null }),
    airConditioned: fc.option(fc.boolean(), { nil: null }),
  });
  /** A rule at least as strict as `r` on every criterion. */
  const tighten = (r: EligibilityRuleFacts, t: { year: number; age: number; seats: number; ac: boolean; bodies: BodyType[] }): EligibilityRuleFacts => ({
    ...r,
    minModelYear: r.minModelYear === null ? null : r.minModelYear + t.year,
    maxVehicleAgeYears: r.maxVehicleAgeYears === null ? null : Math.max(0, r.maxVehicleAgeYears - t.age),
    minSeats: r.minSeats === null ? (t.seats > 0 ? t.seats : null) : Math.min(12, r.minSeats + t.seats),
    acRequired: r.acRequired || t.ac,
    allowedBodyTypes:
      r.allowedBodyTypes.length === 0
        ? t.bodies
        : r.allowedBodyTypes.filter((b) => t.bodies.length === 0 || t.bodies.includes(b)).length > 0
          ? r.allowedBodyTypes.filter((b) => t.bodies.length === 0 || t.bodies.includes(b))
          : r.allowedBodyTypes,
  });
  const tightArb = fc.record({
    year: fc.integer({ min: 0, max: 10 }),
    age: fc.integer({ min: 0, max: 10 }),
    seats: fc.integer({ min: 0, max: 6 }),
    ac: fc.boolean(),
    bodies: fc.subarray([...BODIES]),
  });

  it('any failing attribute => NOT_ELIGIBLE; UNKNOWN is never ELIGIBLE; the rule version is recorded', () => {
    fc.assert(
      fc.property(ruleArb, vehicleArb, (rule, v) => {
        const r = evaluateVehicleEligibility(rule, v, NOW);
        expect(r.ruleVersion).toBe(rule.version);
        const year = 2026;
        const fails =
          v.serviceCategory !== rule.vehicleClass ||
          (rule.minModelYear !== null && v.modelYear < rule.minModelYear) ||
          (rule.maxVehicleAgeYears !== null && year - v.modelYear > rule.maxVehicleAgeYears) ||
          (rule.minSeats !== null && v.seats !== null && v.seats < rule.minSeats) ||
          (rule.acRequired && v.airConditioned === false) ||
          (rule.allowedBodyTypes.length > 0 && v.bodyType !== null && !rule.allowedBodyTypes.includes(v.bodyType));
        if (fails) expect(r.kind).toBe('NOT_ELIGIBLE');
        if (r.kind === 'UNKNOWN') expect(r.missingAttributes.length).toBeGreaterThan(0);
      }),
      RUNS,
    );
  });

  it('tightening a rule never turns NOT_ELIGIBLE or UNKNOWN into ELIGIBLE (monotonicity)', () => {
    fc.assert(
      fc.property(ruleArb, tightArb, vehicleArb, (rule, t, v) => {
        const loose = evaluateVehicleEligibility(rule, v, NOW);
        const strict = evaluateVehicleEligibility(tighten(rule, t), v, NOW);
        if (strict.kind === 'ELIGIBLE') expect(loose.kind).toBe('ELIGIBLE');
        if (loose.kind === 'NOT_ELIGIBLE') expect(strict.kind).toBe('NOT_ELIGIBLE');
      }),
      RUNS,
    );
  });
});

describe('city-product audit ids', () => {
  it('are deterministic RFC 9562 version-8 UUIDs per (city, product)', () => {
    const a = cityProductObjectId('LHR', 'ECONOMY');
    expect(a).toBe(cityProductObjectId('LHR', 'ECONOMY'));
    expect(a).not.toBe(cityProductObjectId('LHR', 'COMFORT'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
