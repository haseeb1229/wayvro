/**
 * SP-04 run (§5.3): for every captured case and every enabled component, identical requests through the candidate
 * adapters — autocomplete on 3/5/8-character prefixes and the full query per language variant, resolution of each
 * top-5 suggestion, forward geocode of the primary full query, reverse geocode of the true point, and a route per
 * ROUTE leg — with bounded concurrency, per-SKU timeouts (§6: 1.5/2.0/2.0/2.5 s) and the budget hard stop.
 *
 * The run record holds normalised results and coordinates: it is LOCAL ONLY (written under the git-ignored folder).
 */
import { randomUUID } from 'node:crypto';
import { GeoAdapterError } from '@wayvro/geo-adapters';
import type { GeoLocale, GeoPoint, GeoSku } from '@wayvro/provider-interfaces';
import { type BudgetBucket, type BudgetGuard, BudgetStopError, stopLimit } from './budget.js';
import type { PointCase, QueryLanguage, RouteCase } from './cases.js';
import type { Component } from './components.js';

const SKU_TIMEOUT_MS: Readonly<Record<GeoSku, number>> = { AUTOCOMPLETE: 1500, GEOCODE: 2000, PLACE_RESOLVE: 2000, REVERSE_GEOCODE: 2000, ROUTE: 2500 };
const PREFIX_LENGTHS = [3, 5, 8] as const;
const LOCALE: Readonly<Record<QueryLanguage, GeoLocale>> = { en: 'en', roman_urdu: 'ur-Latn', urdu: 'ur' };
/** Lahore coarse bias cell (2 decimals, as the gateway would send): a city-level constant, not a user location. */
const LAHORE_BIAS_CELL: GeoPoint = { lat: 31.52, lng: 74.35 };

interface CallRecord {
  readonly component: string;
  readonly sku: GeoSku;
  readonly latencyMs: number;
  readonly outcome: 'OK' | 'EMPTY' | 'ERROR';
  readonly errorCode: string | null;
}

interface PrefixResult {
  /** null = the full query. */
  readonly prefixLength: number | null;
  readonly ids: readonly string[];
  /** Only for geocode-points components (points arrive with the suggestions). */
  readonly points: readonly GeoPoint[] | null;
  readonly anyUrduName: boolean;
  readonly errorCode: string | null;
}

interface AutocompleteRecord {
  readonly caseId: string;
  readonly component: string;
  readonly language: QueryLanguage;
  readonly prefixes: readonly PrefixResult[];
  /** Resolution of the full query's top-5 suggestions (suggest-resolve components). */
  readonly resolved: readonly { readonly id: string; readonly point: GeoPoint | null; readonly errorCode: string | null }[];
}

interface GeocodeRecord {
  readonly caseId: string;
  readonly component: string;
  readonly points: readonly GeoPoint[];
  readonly errorCode: string | null;
}

interface ReverseRecord {
  readonly caseId: string;
  readonly component: string;
  readonly place: {
    readonly name: string | null;
    readonly block: string | null;
    readonly area: string | null;
    readonly city: string | null;
    readonly nameUrdu: string | null;
  } | null;
  readonly errorCode: string | null;
}

interface RouteRecord {
  readonly caseId: string;
  readonly component: string;
  readonly distanceM: number | null;
  readonly durationS: number | null;
  readonly geometry: readonly GeoPoint[];
  readonly errorCode: string | null;
}

export interface RunRecord {
  readonly version: 1;
  readonly caseListVersion: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: 'COMPLETE' | 'BUDGET_STOPPED';
  readonly stoppedBucket: string | null;
  readonly repeats: number;
  readonly components: readonly { readonly id: string; readonly bundle: string; readonly kind: string }[];
  readonly calls: readonly CallRecord[];
  readonly autocomplete: readonly AutocompleteRecord[];
  readonly geocode: readonly GeocodeRecord[];
  readonly reverse: readonly ReverseRecord[];
  readonly routes: readonly RouteRecord[];
  readonly budget: Record<string, { used: number; stopAt: number; allowance: number }>;
}

export interface RunOptions {
  readonly caseListVersion: string;
  readonly repeats: number;
  readonly concurrency: number;
  readonly guard: BudgetGuard;
  readonly now?: () => Date;
  readonly clock?: () => number;
  readonly newSessionId?: () => string;
}

/** Code-point prefixes 3/5/8 shorter than the full query (deduplicated). */
/** @internal exported for unit tests */
export function prefixesOf(query: string): number[] {
  const length = Array.from(query).length;
  return PREFIX_LENGTHS.filter((n) => n < length);
}

function primaryQuery(p: PointCase): { language: QueryLanguage; text: string } | null {
  for (const language of ['en', 'roman_urdu', 'urdu'] as const) {
    const text = p.queries[language];
    if (text !== undefined) return { language, text };
  }
  return null;
}

/** Upper bound of billable units per bucket for a planned run (checked against the stop limit BEFORE any call). */
export function planUsage(
  points: readonly PointCase[],
  routes: readonly RouteCase[],
  components: readonly Component[],
  repeats: number,
): Map<BudgetBucket, number> {
  const plan = new Map<BudgetBucket, number>();
  const add = (bucket: BudgetBucket | null, units: number) => {
    if (bucket !== null && units > 0) plan.set(bucket, (plan.get(bucket) ?? 0) + units);
  };
  for (const c of components) {
    if (c.kind === 'ROUTE') add(c.bucket, routes.length * repeats);
    else if (c.kind === 'GEOCODE' || c.kind === 'REVERSE_GEOCODE') add(c.bucket, points.length * repeats);
    else {
      for (const p of points) {
        for (const text of Object.values(p.queries)) {
          const suggests = prefixesOf(text).length + repeats;
          if (c.mode === 'geocode-points') add(c.bucket, suggests);
          else if (c.sessionBilled) add(c.suggestBucket, 1 + 4);
          else {
            add(c.suggestBucket, suggests);
            add(c.resolveBucket, 5);
          }
        }
      }
    }
  }
  return plan;
}

/** Buckets whose planned usage would cross the stop limit given the ledger. */
export function planViolations(plan: Map<BudgetBucket, number>, guard: BudgetGuard): { bucket: BudgetBucket; planned: number; used: number; stopAt: number }[] {
  return [...plan.entries()]
    .filter(([b, units]) => !guard.wouldFit(b, units))
    .map(([bucket, planned]) => ({ bucket, planned, used: guard.usedUnits(bucket), stopAt: stopLimit(bucket) }));
}

/** Next instant after `now` with the same weekday and Asia/Karachi (UTC+5, no DST) local time as the drive. */
/** @internal exported for unit tests */
export function nextDeparture(date: string, timeLocal: string, now: Date): Date {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const [hh, mm] = timeLocal.split(':').map(Number) as [number, number];
  for (let add = 0; add <= 8; add++) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add, hh - 5, mm));
    const localWeekday = new Date(day.getTime() + 5 * 3_600_000).getUTCDay();
    if (localWeekday === weekday && day.getTime() > now.getTime()) return day;
  }
  throw new Error('unreachable: a matching weekday occurs within 8 days');
}

class StopRun extends Error {}

export async function runBenchmark(
  points: readonly PointCase[],
  routes: readonly RouteCase[],
  components: readonly Component[],
  options: RunOptions,
): Promise<RunRecord> {
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());
  const newSession = options.newSessionId ?? (() => randomUUID());
  const startedAt = now().toISOString();
  const calls: CallRecord[] = [];
  const autocomplete: AutocompleteRecord[] = [];
  const geocode: GeocodeRecord[] = [];
  const reverse: ReverseRecord[] = [];
  const routeRecords: RouteRecord[] = [];
  const state: { stoppedBucket: BudgetBucket | null } = { stoppedBucket: null };
  const pointById = new Map(points.map((p) => [p.id, p]));

  /** One provider call: budget reservation first, then a timed call; adapter failures are recorded, never hidden. */
  async function call<T>(
    component: string,
    sku: GeoSku,
    bucket: BudgetBucket | null,
    units: number,
    fn: (signal: AbortSignal) => Promise<T>,
    empty: (value: T) => boolean,
  ): Promise<{ value: T | null; errorCode: string | null }> {
    if (state.stoppedBucket !== null) throw new StopRun();
    if (bucket !== null) {
      try {
        options.guard.reserve(bucket, units);
      } catch (error) {
        if (error instanceof BudgetStopError) {
          state.stoppedBucket = error.bucket;
          throw new StopRun();
        }
        throw error;
      }
    }
    const started = clock();
    try {
      const value = await fn(AbortSignal.timeout(SKU_TIMEOUT_MS[sku]));
      calls.push({ component, sku, latencyMs: Math.round(clock() - started), outcome: empty(value) ? 'EMPTY' : 'OK', errorCode: null });
      return { value, errorCode: null };
    } catch (error) {
      if (!(error instanceof GeoAdapterError)) throw error;
      calls.push({ component, sku, latencyMs: Math.round(clock() - started), outcome: 'ERROR', errorCode: error.code });
      return { value: null, errorCode: error.code };
    }
  }

  const tasks: (() => Promise<void>)[] = [];
  for (const c of components) {
    if (c.kind === 'AUTOCOMPLETE') {
      for (const p of points) {
        for (const [language, text] of Object.entries(p.queries) as [QueryLanguage, string][]) {
          tasks.push(async () => {
            const session = newSession();
            const locale = LOCALE[language];
            const prefixes: PrefixResult[] = [];
            let sessionOpened = false;
            const suggestOnce = async (query: string, prefixLength: number | null): Promise<PrefixResult> => {
              if (c.mode === 'geocode-points') {
                const r = await call(
                  c.id,
                  'AUTOCOMPLETE',
                  c.bucket,
                  1,
                  (s) => c.geocoder.geocode({ text: query, locale, countryCode: 'PK' }, s),
                  (v) => v.length === 0,
                );
                const pts = (r.value ?? []).slice(0, 5).map((x) => x.point);
                return {
                  prefixLength,
                  ids: pts.map((_, i) => `p${i}`),
                  points: pts,
                  anyUrduName: (r.value ?? []).some((x) => x.components.nameUrdu !== null),
                  errorCode: r.errorCode,
                };
              }
              const units = c.sessionBilled ? (sessionOpened ? 0 : 1) : 1;
              const r = await call(
                c.id,
                'AUTOCOMPLETE',
                c.suggestBucket,
                units,
                (s) => c.suggest.suggest({ text: query, locale, biasCell: LAHORE_BIAS_CELL, countryCode: 'PK', searchSessionId: session }, s),
                (v) => v.length === 0,
              );
              sessionOpened = true;
              const list = (r.value ?? []).slice(0, 5);
              return {
                prefixLength,
                ids: list.map((x) => x.providerPlaceId),
                points: null,
                anyUrduName: list.some((x) => x.components.nameUrdu !== null),
                errorCode: r.errorCode,
              };
            };
            for (const n of prefixesOf(text)) prefixes.push(await suggestOnce(Array.from(text).slice(0, n).join(''), n));
            let full: PrefixResult | null = null;
            for (let i = 0; i < options.repeats; i++) {
              const r = await suggestOnce(text, null);
              full ??= r;
            }
            if (full !== null) prefixes.push(full);
            const resolved: { id: string; point: GeoPoint | null; errorCode: string | null }[] = [];
            if (c.mode === 'suggest-resolve' && full !== null) {
              let first = true;
              for (const id of full.ids) {
                const units = c.sessionBilled ? (first ? 0 : 1) : 1;
                first = false;
                const r = await call(
                  c.id,
                  'PLACE_RESOLVE',
                  c.resolveBucket,
                  units,
                  (s) => c.resolver.resolve({ providerPlaceId: id, searchSessionId: session, locale }, s),
                  () => false,
                );
                resolved.push({ id, point: r.value?.point ?? null, errorCode: r.errorCode });
              }
            }
            autocomplete.push({ caseId: p.id, component: c.id, language, prefixes, resolved });
          });
        }
      }
    } else if (c.kind === 'GEOCODE') {
      for (const p of points) {
        const q = primaryQuery(p);
        if (q === null) continue;
        tasks.push(async () => {
          let first: GeocodeRecord | null = null;
          for (let i = 0; i < options.repeats; i++) {
            const r = await call(
              c.id,
              'GEOCODE',
              c.bucket,
              1,
              (s) => c.adapter.geocode({ text: q.text, locale: LOCALE[q.language], countryCode: 'PK' }, s),
              (v) => v.length === 0,
            );
            first ??= { caseId: p.id, component: c.id, points: (r.value ?? []).slice(0, 5).map((x) => x.point), errorCode: r.errorCode };
          }
          if (first !== null) geocode.push(first);
        });
      }
    } else if (c.kind === 'REVERSE_GEOCODE') {
      for (const p of points) {
        tasks.push(async () => {
          let first: ReverseRecord | null = null;
          for (let i = 0; i < options.repeats; i++) {
            const r = await call(
              c.id,
              'REVERSE_GEOCODE',
              c.bucket,
              1,
              (s) => c.adapter.reverse({ point: p.truth, locale: 'en' }, s),
              (v) => v === null,
            );
            const place = r.value;
            first ??= {
              caseId: p.id,
              component: c.id,
              place: place
                ? {
                    name: place.components.name,
                    block: place.components.block,
                    area: place.components.area,
                    city: place.components.city,
                    nameUrdu: place.components.nameUrdu,
                  }
                : null,
              errorCode: r.errorCode,
            };
          }
          if (first !== null) reverse.push(first);
        });
      }
    } else {
      for (const leg of routes) {
        const origin = pointById.get(leg.originId);
        const dest = pointById.get(leg.destId);
        if (origin === undefined || dest === undefined) continue;
        tasks.push(async () => {
          let first: RouteRecord | null = null;
          const departAt = nextDeparture(leg.date, leg.timeLocal, now());
          for (let i = 0; i < options.repeats; i++) {
            const r = await call(
              c.id,
              'ROUTE',
              c.bucket,
              1,
              (s) => c.adapter.route({ origin: origin.truth, destination: dest.truth, profile: 'CAR', departAt }, s),
              () => false,
            );
            first ??= {
              caseId: leg.id,
              component: c.id,
              distanceM: r.value?.distanceM ?? null,
              durationS: r.value?.durationS ?? null,
              geometry: r.value?.geometry ?? [],
              errorCode: r.errorCode,
            };
          }
          if (first !== null) routeRecords.push(first);
        });
      }
    }
  }

  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency, tasks.length)) }, async () => {
    while (state.stoppedBucket === null && next < tasks.length) {
      const task = tasks[next++] as () => Promise<void>;
      try {
        await task();
      } catch (error) {
        if (!(error instanceof StopRun)) throw error;
      }
    }
  });
  await Promise.all(workers);

  const byCase = <T extends { caseId: string; component: string }>(list: T[]) =>
    list.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.component.localeCompare(b.component));
  return {
    version: 1,
    caseListVersion: options.caseListVersion,
    startedAt,
    finishedAt: now().toISOString(),
    status: state.stoppedBucket === null ? 'COMPLETE' : 'BUDGET_STOPPED',
    stoppedBucket: state.stoppedBucket,
    repeats: options.repeats,
    components: components.map((c) => ({ id: c.id, bundle: c.bundle, kind: c.kind })),
    calls,
    autocomplete: byCase(autocomplete),
    geocode: byCase(geocode),
    reverse: byCase(reverse),
    routes: byCase(routeRecords),
    budget: options.guard.snapshot(),
  };
}
