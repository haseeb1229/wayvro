/**
 * Pricing engine `pe-v1` (P3.3; B04/B06/E05/H06; docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md §3–§4.1; ADR-013).
 *
 * PURE and server-only: it imports only `Money` and plain data and never reads time, the database or the network, so
 * identical inputs always give the identical component list (determinism, property P-05) and every stored quote can be
 * recomputed exactly from its stored inputs. All arithmetic is bigint minor units through `Money`; the only rounding
 * paths are `multiplyByRatio` (distance, time, tax) and the single final `roundToStep` (CON-P3-10: step and mode are
 * rate-card data). The engine never estimates: it prices only a server route snapshot that the caller already has, and
 * a route outside the card's limits is reported, never priced.
 *
 * Every value used here comes from SYNTHETIC local/test configuration in Phase 3; no real rate, fee, tax rate or
 * rounding policy exists (FA-15).
 */
import { Money, type RoundingMode } from '@wayvro/domain';

export const PRICING_ENGINE_VERSION = 'pe-v1';

type ComponentKind = 'BASE' | 'DISTANCE' | 'TIME' | 'MINIMUM_ADJUSTMENT' | 'BOOKING_FEE' | 'AIRPORT_FEE' | 'TOLL' | 'TAX' | 'ROUNDING';
/** Kinds a tax policy may name as taxable (the DB CHECK on `pricing.tax_policies.applies_to` uses the same list). */
export type TaxableKind = 'BASE' | 'DISTANCE' | 'TIME' | 'MINIMUM_ADJUSTMENT' | 'BOOKING_FEE' | 'AIRPORT_FEE';

/** Values of one immutable rate card (`pricing.rate_card_components`); amounts are PKR minor units. */
export interface RateCardValues {
  readonly baseMinor: bigint;
  readonly perKmMinor: bigint;
  readonly perMinMinor: bigint;
  readonly minimumFareMinor: bigint;
  readonly bookingFeeMinor: bigint;
  readonly airportPickupFeeMinor: bigint;
  readonly roundingStepMinor: bigint;
  readonly roundingMode: RoundingMode;
  readonly tollPolicy: 'NOT_APPLICABLE' | 'EXCLUDED_DISCLOSED';
  readonly maxDistanceM: number;
  readonly maxDurationS: number;
}

/** An APPROVED tax policy referenced by the card (`pricing.tax_policies`). */
export interface TaxPolicyValues {
  readonly id: string;
  readonly version: number;
  readonly rateBp: number;
  readonly appliesTo: readonly TaxableKind[];
  readonly inclusive: boolean;
  readonly roundingMode: RoundingMode;
  readonly isPlaceholder: boolean;
}

export interface PricingInput {
  readonly card: RateCardValues;
  readonly tax: TaxPolicyValues;
  /** Routed distance (integer metres) and duration (integer seconds) from the server route snapshot. */
  readonly distanceM: number;
  readonly durationS: number;
  /** The pickup snapped to an AIRPORT pickup point of an AIRPORT_PRECINCT zone (server-decided). */
  readonly airportPickup: { readonly pickupPointId: string } | null;
}

/** Ids and numbers only — never coordinates or personal data (bigint values are carried as decimal strings). */
type ComponentBasis = Readonly<Record<string, string | number | boolean | null>>;

export interface PricedComponent {
  readonly seq: number;
  readonly kind: ComponentKind;
  readonly amount: Money;
  readonly basis: ComponentBasis;
}

export type PricingResult =
  | {
      readonly kind: 'PRICED';
      readonly components: readonly PricedComponent[];
      readonly total: Money;
      /** Inclusive-tax disclosure (informational, not part of Σ); null for exclusive tax. */
      readonly taxIncluded: { readonly rateBp: number; readonly amount: Money } | null;
      readonly engineVersion: typeof PRICING_ENGINE_VERSION;
    }
  | { readonly kind: 'ROUTE_TOO_LONG' };

/** A violated engine invariant (a bug: the caller answers 500 and persists nothing). @internal exported for the engine tests */
export class PricingInvariantError extends Error {
  override readonly name = 'PricingInvariantError';
}

const SEQ: Readonly<Record<ComponentKind, number>> = {
  BASE: 1,
  DISTANCE: 2,
  TIME: 3,
  MINIMUM_ADJUSTMENT: 4,
  BOOKING_FEE: 5,
  AIRPORT_FEE: 6,
  TOLL: 7,
  TAX: 8,
  ROUNDING: 9,
};

const isTaxable = (kind: ComponentKind): kind is TaxableKind =>
  kind === 'BASE' || kind === 'DISTANCE' || kind === 'TIME' || kind === 'MINIMUM_ADJUSTMENT' || kind === 'BOOKING_FEE' || kind === 'AIRPORT_FEE';

function assertInputs(input: PricingInput): void {
  const { card, tax, distanceM, durationS } = input;
  if (!Number.isSafeInteger(distanceM) || distanceM <= 0) throw new PricingInvariantError('distance must be a positive integer of metres');
  if (!Number.isSafeInteger(durationS) || durationS < 0) throw new PricingInvariantError('duration must be a non-negative integer of seconds');
  for (const v of [card.baseMinor, card.perKmMinor, card.perMinMinor, card.minimumFareMinor, card.bookingFeeMinor, card.airportPickupFeeMinor]) {
    if (v < 0n) throw new PricingInvariantError('rate-card amounts must be non-negative');
  }
  if (card.roundingStepMinor <= 0n) throw new PricingInvariantError('rounding step must be positive');
  // the DB CHECK guarantees this; with it, rounding never takes the total below the minimum fare (P-04)
  if (card.minimumFareMinor % card.roundingStepMinor !== 0n) throw new PricingInvariantError('minimum fare must be a multiple of the rounding step');
  if (!Number.isInteger(tax.rateBp) || tax.rateBp < 0 || tax.rateBp > 10000) throw new PricingInvariantError('tax rate must be 0..10000 basis points');
}

/** Prices one product for one route snapshot (`pe-v1`, pricing doc §4.1). */
export function priceQuote(input: PricingInput): PricingResult {
  assertInputs(input);
  const { card, tax, distanceM, durationS, airportPickup } = input;
  if (distanceM > card.maxDistanceM || durationS > card.maxDurationS) return { kind: 'ROUTE_TOO_LONG' };

  const components: PricedComponent[] = [];
  const emit = (kind: ComponentKind, amount: Money, basis: ComponentBasis = {}): void => {
    components.push({ seq: SEQ[kind], kind, amount, basis });
  };

  const base = Money.ofMinor(card.baseMinor);
  const distance = Money.ofMinor(card.perKmMinor).multiplyByRatio(distanceM, 1000, 'HALF_EVEN');
  const time = Money.ofMinor(card.perMinMinor).multiplyByRatio(durationS, 60, 'HALF_EVEN');
  emit('BASE', base);
  emit('DISTANCE', distance, { distanceM, perKmMinor: card.perKmMinor.toString() });
  emit('TIME', time, { durationS, perMinMinor: card.perMinMinor.toString() });

  const trip = base.add(distance).add(time);
  const minimum = Money.ofMinor(card.minimumFareMinor);
  if (trip.compare(minimum) < 0) emit('MINIMUM_ADJUSTMENT', minimum.subtract(trip), { minimumFareMinor: card.minimumFareMinor.toString() });
  if (card.bookingFeeMinor > 0n) emit('BOOKING_FEE', Money.ofMinor(card.bookingFeeMinor));
  if (airportPickup && card.airportPickupFeeMinor > 0n)
    emit('AIRPORT_FEE', Money.ofMinor(card.airportPickupFeeMinor), { pickupPointId: airportPickup.pickupPointId });
  if (card.tollPolicy === 'EXCLUDED_DISCLOSED') emit('TOLL', Money.zero(), { policy: 'EXCLUDED_DISCLOSED' });

  const taxable = components.filter((c) => isTaxable(c.kind) && tax.appliesTo.includes(c.kind)).reduce((sum, c) => sum.add(c.amount), Money.zero());
  let taxIncluded: { rateBp: number; amount: Money } | null = null;
  if (tax.inclusive) {
    // amounts already contain the tax: disclosed, never added to Σ (pricing doc §3.1)
    taxIncluded = { rateBp: tax.rateBp, amount: taxable.multiplyByRatio(tax.rateBp, 10000 + tax.rateBp, tax.roundingMode) };
  } else {
    // an exclusive TAX line is always emitted (even at 0 bp) so the tax treatment is visible and auditable
    emit('TAX', taxable.multiplyByRatio(tax.rateBp, 10000, tax.roundingMode), {
      taxPolicyId: tax.id,
      version: tax.version,
      rateBp: tax.rateBp,
      isPlaceholder: tax.isPlaceholder,
    });
  }

  const preRound = components.reduce((sum, c) => sum.add(c.amount), Money.zero());
  const total = preRound.roundToStep(card.roundingStepMinor, card.roundingMode);
  const rounding = total.subtract(preRound);
  if (!rounding.isZero()) emit('ROUNDING', rounding, { stepMinor: card.roundingStepMinor.toString(), mode: card.roundingMode });

  // invariants (a violation is a bug: the caller answers 500 and persists nothing)
  const sum = components.reduce((s, c) => s.add(c.amount), Money.zero());
  if (!sum.equals(total)) throw new PricingInvariantError('sum of components differs from the total');
  if (total.isNegative()) throw new PricingInvariantError('negative total');
  if (components.some((c) => c.kind !== 'ROUNDING' && c.amount.isNegative())) throw new PricingInvariantError('only ROUNDING may be negative');
  return { kind: 'PRICED', components, total, taxIncluded, engineVersion: PRICING_ENGINE_VERSION };
}
