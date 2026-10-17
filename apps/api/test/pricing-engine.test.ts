/**
 * UNIT-QUOTE + PROP-QUOTE (pure): the `pe-v1` engine against the two worked SYNTHETIC examples of
 * docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md §6 (golden tests) and the §14 invariants P-01..P-10/P-14 with fast-check.
 * All values are synthetic and exercise the arithmetic only; none is a Wayvro price or a Pakistani tax rate.
 */
import { Money, type RoundingMode } from '@wayvro/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PRICING_ENGINE_VERSION,
  PricingInvariantError,
  priceQuote,
  type PricingInput,
  type RateCardValues,
  type TaxPolicyValues,
} from '../src/pricing/engine.js';

const ECONOMY_SYNTHETIC: RateCardValues = {
  baseMinor: 10000n,
  perKmMinor: 3500n,
  perMinMinor: 500n,
  minimumFareMinor: 25000n,
  bookingFeeMinor: 1000n,
  airportPickupFeeMinor: 20000n,
  roundingStepMinor: 1000n,
  roundingMode: 'HALF_UP',
  tollPolicy: 'EXCLUDED_DISCLOSED',
  maxDistanceM: 60000,
  maxDurationS: 7200,
};
const SYNTH_TAX_0: TaxPolicyValues = {
  id: '00000000-0000-7000-8000-00000000a001',
  version: 1,
  rateBp: 0,
  appliesTo: ['BASE', 'DISTANCE', 'TIME', 'MINIMUM_ADJUSTMENT', 'BOOKING_FEE'],
  inclusive: false,
  roundingMode: 'HALF_EVEN',
  isPlaceholder: true,
};
const SYNTH_TAX_10_TEST_ONLY: TaxPolicyValues = { ...SYNTH_TAX_0, id: '00000000-0000-7000-8000-00000000a002', rateBp: 1000 };

const priced = (input: PricingInput) => {
  const r = priceQuote(input);
  if (r.kind !== 'PRICED') throw new Error(`expected PRICED, got ${r.kind}`);
  return r;
};
const lines = (r: ReturnType<typeof priced>) => r.components.map((c) => [c.seq, c.kind, c.amount.minor.toString()]);

describe('UNIT-QUOTE golden examples (pricing doc §6)', () => {
  it('Example A — standard trip, ECONOMY synthetic v1, SYNTH-TAX-0', () => {
    const r = priced({ card: ECONOMY_SYNTHETIC, tax: SYNTH_TAX_0, distanceM: 7351, durationS: 1234, airportPickup: null });
    expect(lines(r)).toEqual([
      [1, 'BASE', '10000'],
      [2, 'DISTANCE', '25728'],
      [3, 'TIME', '10283'],
      [5, 'BOOKING_FEE', '1000'],
      [7, 'TOLL', '0'],
      [8, 'TAX', '0'],
      [9, 'ROUNDING', '-11'],
    ]);
    expect(r.total.minor).toBe(47000n);
    expect(r.taxIncluded).toBeNull();
    expect(r.engineVersion).toBe(PRICING_ENGINE_VERSION);
    expect(r.components.find((c) => c.kind === 'TAX')?.basis).toEqual({ taxPolicyId: SYNTH_TAX_0.id, version: 1, rateBp: 0, isPlaceholder: true });
    expect(r.components.find((c) => c.kind === 'DISTANCE')?.basis).toEqual({ distanceM: 7351, perKmMinor: '3500' });
  });

  it('Example B — short airport pickup, TEST-ONLY 1000 bp exclusive tax (airport fee not taxable)', () => {
    const r = priced({
      card: ECONOMY_SYNTHETIC,
      tax: SYNTH_TAX_10_TEST_ONLY,
      distanceM: 2100,
      durationS: 420,
      airportPickup: { pickupPointId: '00000000-0000-7000-8000-0000000000b1' },
    });
    expect(lines(r)).toEqual([
      [1, 'BASE', '10000'],
      [2, 'DISTANCE', '7350'],
      [3, 'TIME', '3500'],
      [4, 'MINIMUM_ADJUSTMENT', '4150'],
      [5, 'BOOKING_FEE', '1000'],
      [6, 'AIRPORT_FEE', '20000'],
      [7, 'TOLL', '0'],
      [8, 'TAX', '2600'],
      [9, 'ROUNDING', '400'],
    ]);
    expect(r.total.minor).toBe(49000n);
  });

  it('inclusive tax is disclosed, never added to the sum', () => {
    const r = priced({ card: ECONOMY_SYNTHETIC, tax: { ...SYNTH_TAX_10_TEST_ONLY, inclusive: true }, distanceM: 7351, durationS: 1234, airportPickup: null });
    expect(r.components.some((c) => c.kind === 'TAX')).toBe(false);
    // taxable = 10000 + 25728 + 10283 + 1000 = 47011; 47011 × 1000 / 11000 = 4273.7 → HALF_EVEN 4274
    expect(r.taxIncluded).toEqual({ rateBp: 1000, amount: Money.ofMinor(4274) });
    expect(r.total.minor).toBe(47000n);
  });

  it('NOT_APPLICABLE tolls emit no TOLL line; a zero booking fee emits no line; no airport point ⇒ no airport fee', () => {
    const r = priced({
      card: { ...ECONOMY_SYNTHETIC, tollPolicy: 'NOT_APPLICABLE', bookingFeeMinor: 0n },
      tax: SYNTH_TAX_0,
      distanceM: 7351,
      durationS: 1234,
      airportPickup: null,
    });
    expect(r.components.map((c) => c.kind)).toEqual(['BASE', 'DISTANCE', 'TIME', 'TAX', 'ROUNDING']);
  });

  it('a route beyond the card limits is reported, never priced (P-14)', () => {
    expect(priceQuote({ card: ECONOMY_SYNTHETIC, tax: SYNTH_TAX_0, distanceM: 60001, durationS: 10, airportPickup: null })).toEqual({ kind: 'ROUTE_TOO_LONG' });
    expect(priceQuote({ card: ECONOMY_SYNTHETIC, tax: SYNTH_TAX_0, distanceM: 1000, durationS: 7201, airportPickup: null })).toEqual({
      kind: 'ROUTE_TOO_LONG',
    });
  });

  it('P-06 regression (CI run 38427719184): a tax on the minimum top-up without BASE + DISTANCE + TIME is refused', () => {
    // fast-check counterexample: TIME untaxed, top-up taxed at 50.01 % ⇒ 44 s cost 5 minor, 53 s cost 4 minor
    const card: RateCardValues = {
      baseMinor: 0n,
      perKmMinor: 0n,
      perMinMinor: 4n,
      minimumFareMinor: 4n,
      bookingFeeMinor: 0n,
      airportPickupFeeMinor: 0n,
      roundingStepMinor: 1n,
      roundingMode: 'HALF_EVEN',
      tollPolicy: 'NOT_APPLICABLE',
      maxDistanceM: 100,
      maxDurationS: 66,
    };
    const inconsistent: TaxPolicyValues = { ...SYNTH_TAX_0, rateBp: 5001, appliesTo: ['MINIMUM_ADJUSTMENT'], isPlaceholder: false };
    expect(() => priceQuote({ card, tax: inconsistent, distanceM: 1, durationS: 44, airportPickup: null })).toThrow(PricingInvariantError);
    // the consistent treatment of the same trip is monotonic
    const consistent: TaxPolicyValues = { ...inconsistent, appliesTo: ['BASE', 'DISTANCE', 'TIME', 'MINIMUM_ADJUSTMENT'] };
    const shorter = priced({ card, tax: consistent, distanceM: 1, durationS: 44, airportPickup: null }).total.minor;
    const longer = priced({ card, tax: consistent, distanceM: 1, durationS: 53, airportPickup: null }).total.minor;
    expect(longer >= shorter).toBe(true);
  });

  it('refuses inputs outside the database CHECKs (a bug, never a price)', () => {
    const base = { card: ECONOMY_SYNTHETIC, tax: SYNTH_TAX_0, distanceM: 1000, durationS: 60, airportPickup: null };
    expect(() => priceQuote({ ...base, distanceM: 0 })).toThrow(PricingInvariantError);
    expect(() => priceQuote({ ...base, distanceM: 1.5 })).toThrow(PricingInvariantError);
    expect(() => priceQuote({ ...base, durationS: -1 })).toThrow(PricingInvariantError);
    expect(() => priceQuote({ ...base, card: { ...ECONOMY_SYNTHETIC, minimumFareMinor: 25500n } })).toThrow(PricingInvariantError);
    expect(() => priceQuote({ ...base, card: { ...ECONOMY_SYNTHETIC, perKmMinor: -1n } })).toThrow(PricingInvariantError);
    expect(() => priceQuote({ ...base, tax: { ...SYNTH_TAX_0, rateBp: 10001 } })).toThrow(PricingInvariantError);
  });
});

// ── PROP-QUOTE ───────────────────────────────────────────────────────────────────────────────────────────────────
const RUNS = Number(process.env['WAYVRO_PROPERTY_RUNS'] ?? 500);
// the manual full tier runs 50,000 cases per property: give each property time in proportion (5 s at the PR default)
const PROPERTY_TIMEOUT_MS = Math.max(5_000, RUNS * 3);
const MODES: readonly RoundingMode[] = ['HALF_EVEN', 'HALF_UP', 'FLOOR', 'CEILING'];
const amount = fc.bigInt({ min: 0n, max: 10_000_000n });
const cardArb: fc.Arbitrary<RateCardValues> = fc
  .record({
    baseMinor: amount,
    perKmMinor: amount,
    perMinMinor: amount,
    minimumSteps: fc.bigInt({ min: 0n, max: 1000n }),
    bookingFeeMinor: amount,
    airportPickupFeeMinor: amount,
    roundingStepMinor: fc.constantFrom(1n, 5n, 10n, 50n, 100n, 1000n, 10000n),
    roundingMode: fc.constantFrom(...MODES),
    tollPolicy: fc.constantFrom('NOT_APPLICABLE' as const, 'EXCLUDED_DISCLOSED' as const),
    maxDistanceM: fc.integer({ min: 100, max: 200000 }),
    maxDurationS: fc.integer({ min: 60, max: 21600 }),
  })
  .map(({ minimumSteps, ...c }) => ({ ...c, minimumFareMinor: minimumSteps * c.roundingStepMinor }))
  .filter((c) => c.minimumFareMinor <= 10_000_000n);
const taxArb: fc.Arbitrary<TaxPolicyValues> = fc.record({
  id: fc.constant('00000000-0000-7000-8000-00000000a0ff'),
  version: fc.integer({ min: 1, max: 99 }),
  rateBp: fc.integer({ min: 0, max: 10000 }),
  // only CONSISTENT policies (the DB CHECK, the contract and the engine refuse a taxable top-up without BASE + DISTANCE + TIME)
  appliesTo: fc
    .subarray(['BASE', 'DISTANCE', 'TIME', 'MINIMUM_ADJUSTMENT', 'BOOKING_FEE', 'AIRPORT_FEE'] as const, { minLength: 1 })
    .filter((kinds) => !kinds.includes('MINIMUM_ADJUSTMENT') || (['BASE', 'DISTANCE', 'TIME'] as const).every((k) => kinds.includes(k))),
  inclusive: fc.boolean(),
  roundingMode: fc.constantFrom(...MODES),
  isPlaceholder: fc.boolean(),
});
const inputArb: fc.Arbitrary<PricingInput> = fc.tuple(cardArb, taxArb, fc.boolean()).chain(([card, tax, airport]) =>
  fc.record({
    card: fc.constant(card),
    tax: fc.constant(tax),
    distanceM: fc.integer({ min: 1, max: card.maxDistanceM }),
    durationS: fc.integer({ min: 0, max: card.maxDurationS }),
    airportPickup: fc.constant(airport ? { pickupPointId: '00000000-0000-7000-8000-0000000000b1' } : null),
  }),
);

describe('PROP-QUOTE invariants (pricing doc §14)', { timeout: PROPERTY_TIMEOUT_MS }, () => {
  it('P-01/P-02/P-07: Σ components = total, total ≥ 0 and a step multiple, only ROUNDING negative, kinds unique, no DISCOUNT', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = priced(input);
        expect(r.components.reduce((s, c) => s + c.amount.minor, 0n)).toBe(r.total.minor);
        expect(r.total.minor >= 0n).toBe(true);
        expect(r.total.minor % input.card.roundingStepMinor).toBe(0n);
        expect(r.components.filter((c) => c.kind !== 'ROUNDING').every((c) => c.amount.minor >= 0n)).toBe(true);
        expect(new Set(r.components.map((c) => c.kind)).size).toBe(r.components.length);
        expect(r.components.map((c) => c.seq)).toEqual([...r.components.map((c) => c.seq)].sort((a, b) => a - b));
        expect(r.components.some((c) => (c.kind as string) === 'DISCOUNT')).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });

  it('P-03: |ROUNDING| ≤ step/2 for HALF modes and < step for FLOOR/CEILING', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = priced(input);
        const rounding = r.components.find((c) => c.kind === 'ROUNDING')?.amount.minor ?? 0n;
        const abs = rounding < 0n ? -rounding : rounding;
        const step = input.card.roundingStepMinor;
        if (input.card.roundingMode === 'HALF_EVEN' || input.card.roundingMode === 'HALF_UP') expect(abs * 2n <= step).toBe(true);
        else expect(abs < step).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('P-04: the total is never below the minimum fare', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(priced(input).total.minor >= input.card.minimumFareMinor).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('P-05: determinism — identical inputs (also after a JSON round trip of the card) give identical results', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const a = priced(input);
        const card = JSON.parse(
          JSON.stringify(input.card, (_k, v: unknown) => (typeof v === 'bigint' ? `${v.toString()}n` : v)),
          (_k, v: unknown) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v),
        ) as RateCardValues;
        const b = priced({ ...input, card });
        expect(lines(b)).toEqual(lines(a));
        expect(b.components.map((c) => c.basis)).toEqual(a.components.map((c) => c.basis));
        expect(b.total.equals(a.total)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('P-06: monotonic — more distance (fixed duration) or more duration (fixed distance) never lowers the total', () => {
    fc.assert(
      fc.property(inputArb, fc.integer({ min: 0, max: 200000 }), fc.integer({ min: 0, max: 21600 }), (input, dd, dt) => {
        const base = priced(input).total.minor;
        const longer = { ...input, distanceM: Math.min(input.card.maxDistanceM, input.distanceM + dd) };
        const slower = { ...input, durationS: Math.min(input.card.maxDurationS, input.durationS + dt) };
        expect(priced(longer).total.minor >= base).toBe(true);
        expect(priced(slower).total.minor >= base).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('P-08: exclusive TAX = multiplyByRatio(taxable, rateBp, 10000, mode) exactly; inclusive tax never enters Σ', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = priced(input);
        const taxable = r.components.filter((c) => (input.tax.appliesTo as readonly string[]).includes(c.kind)).reduce((s, c) => s.add(c.amount), Money.zero());
        const tax = r.components.find((c) => c.kind === 'TAX');
        if (input.tax.inclusive) {
          expect(tax).toBeUndefined();
          expect(r.taxIncluded?.amount.equals(taxable.multiplyByRatio(input.tax.rateBp, 10000 + input.tax.rateBp, input.tax.roundingMode))).toBe(true);
        } else {
          expect(tax?.amount.equals(taxable.multiplyByRatio(input.tax.rateBp, 10000, input.tax.roundingMode))).toBe(true);
          expect(r.taxIncluded).toBeNull();
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('P-09: zero per-km/per-min rates still emit DISTANCE/TIME at 0', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = priced({ ...input, card: { ...input.card, perKmMinor: 0n, perMinMinor: 0n } });
        expect(r.components.find((c) => c.kind === 'DISTANCE')?.amount.minor).toBe(0n);
        expect(r.components.find((c) => c.kind === 'TIME')?.amount.minor).toBe(0n);
      }),
      { numRuns: RUNS },
    );
  });

  it('P-10: bigint safety — maximal CHECK-bounded inputs stay exact and serialise as decimal strings', () => {
    const max: PricingInput = {
      card: {
        baseMinor: 10_000_000n,
        perKmMinor: 10_000_000n,
        perMinMinor: 10_000_000n,
        minimumFareMinor: 10_000_000n,
        bookingFeeMinor: 10_000_000n,
        airportPickupFeeMinor: 10_000_000n,
        roundingStepMinor: 10_000n,
        roundingMode: 'HALF_EVEN',
        tollPolicy: 'EXCLUDED_DISCLOSED',
        maxDistanceM: 200000,
        maxDurationS: 21600,
      },
      tax: { ...SYNTH_TAX_0, rateBp: 10000, appliesTo: ['BASE', 'DISTANCE', 'TIME', 'MINIMUM_ADJUSTMENT', 'BOOKING_FEE', 'AIRPORT_FEE'] },
      distanceM: 200000,
      durationS: 21600,
      airportPickup: { pickupPointId: '00000000-0000-7000-8000-0000000000b1' },
    };
    const r = priced(max);
    // DISTANCE = 1e7 × 200000 / 1000 = 2e9; TIME = 1e7 × 21600 / 60 = 3.6e9 — beyond 2^31, exact as bigint
    expect(r.components.find((c) => c.kind === 'DISTANCE')?.amount.minor).toBe(2_000_000_000n);
    expect(r.components.find((c) => c.kind === 'TIME')?.amount.minor).toBe(3_600_000_000n);
    expect(JSON.parse(JSON.stringify(r.total.toJSON()))).toEqual({ currency: 'PKR', minor: r.total.minor.toString() });
  });
});
