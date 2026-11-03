/**
 * Staff price preview (P3.3; pricing doc §10; T3-23): prices numeric benchmark tuples with up to three rate cards
 * through the pure engine — no provider call, no route, no coordinates, no quote row. The DEFAULT benchmark set is
 * code-defined and SYNTHETIC (short/medium/long, peak-like durations, airport pickups); it is not field data. Once SP-04
 * has run, Wayvro-derived distance/duration numbers (never raw provider responses) may be supplied as tuples instead.
 */
import { priceQuote, type PricedComponent, type RateCardValues, type TaxPolicyValues } from './engine.js';

export interface BenchmarkTuple {
  readonly label: string;
  readonly distanceM: number;
  readonly durationS: number;
  readonly airportPickup: boolean;
}

/** SYNTHETIC benchmark tuples (≈ 12): distances/durations chosen to exercise the arithmetic, not measured routes. */
export const DEFAULT_BENCHMARK_TUPLES: readonly BenchmarkTuple[] = [
  { label: 'SYN short 1.5 km', distanceM: 1500, durationS: 300, airportPickup: false },
  { label: 'SYN short 3 km', distanceM: 3000, durationS: 540, airportPickup: false },
  { label: 'SYN medium 6 km', distanceM: 6000, durationS: 900, airportPickup: false },
  { label: 'SYN medium 9 km', distanceM: 9000, durationS: 1500, airportPickup: false },
  { label: 'SYN medium 9 km peak-like', distanceM: 9000, durationS: 2700, airportPickup: false },
  { label: 'SYN long 15 km', distanceM: 15000, durationS: 1800, airportPickup: false },
  { label: 'SYN long 22 km', distanceM: 22000, durationS: 2700, airportPickup: false },
  { label: 'SYN long 22 km peak-like', distanceM: 22000, durationS: 4500, airportPickup: false },
  { label: 'SYN very long 35 km', distanceM: 35000, durationS: 3600, airportPickup: false },
  { label: 'SYN airport pickup 4 km', distanceM: 4000, durationS: 600, airportPickup: true },
  { label: 'SYN airport pickup 18 km', distanceM: 18000, durationS: 2100, airportPickup: true },
  { label: 'SYN near card limits 55 km', distanceM: 55000, durationS: 6600, airportPickup: false },
];

export interface PreviewCard {
  readonly id: string;
  readonly cityCode: string;
  readonly productCode: string;
  readonly version: number;
  readonly status: string;
  readonly values: RateCardValues;
  readonly tax: TaxPolicyValues;
}

const componentView = (c: PricedComponent) => ({ kind: c.kind, amount: c.amount.toJSON(), basis: c.basis });

/** A benchmark airport pickup has no real pickup point; the basis names the benchmark instead of an id. */
const BENCHMARK_AIRPORT = { pickupPointId: 'BENCHMARK' } as const;

/** The preview body (contract `PricingPreview`): per tuple, per card the full breakdown and the delta to the first card. */
export function previewCards(cards: readonly PreviewCard[], tuples: readonly BenchmarkTuple[], benchmarkSet: 'DEFAULT_SYNTHETIC_V1' | 'CUSTOM') {
  return {
    benchmarkSet,
    cards: cards.map((c) => ({ rateCardId: c.id, cityCode: c.cityCode, productCode: c.productCode, version: c.version, status: c.status })),
    rows: tuples.map((t) => {
      const priced = cards.map((c) =>
        priceQuote({ card: c.values, tax: c.tax, distanceM: t.distanceM, durationS: t.durationS, airportPickup: t.airportPickup ? BENCHMARK_AIRPORT : null }),
      );
      const first = priced[0];
      return {
        label: t.label,
        distanceM: t.distanceM,
        durationS: t.durationS,
        airportPickup: t.airportPickup,
        results: priced.map((p, i) => {
          const card = cards[i];
          if (!card) throw new Error('preview card missing');
          if (p.kind !== 'PRICED') return { rateCardId: card.id, outcome: 'ROUTE_TOO_LONG' as const, total: null, components: [], deltaVsFirst: null };
          return {
            rateCardId: card.id,
            outcome: 'PRICED' as const,
            total: p.total.toJSON(),
            components: p.components.map(componentView),
            deltaVsFirst: i > 0 && first?.kind === 'PRICED' ? p.total.subtract(first.total).toJSON() : null,
          };
        }),
      };
    }),
  };
}
