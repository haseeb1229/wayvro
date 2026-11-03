/**
 * SP-04 §6 metrics per component, computed from the local run record, the founder's ground truth, the blind ratings
 * and the route review. Outputs are numbers, flags, ranks and case ids only (no coordinates, no text).
 */
import type { GeoPoint, GeoSku } from '@wayvro/provider-interfaces';
import type { Category, QueryLanguage, ValidationResult } from './cases.js';
import { CONSTRAINT_CATEGORIES } from './cases.js';
import { corridorOverlap, haversineM, percentile } from './geo.js';
import type { LegTruth } from './gpx.js';
import type { RunRecord } from './runner.js';
import type { ReviewEntry } from './sheets.js';

const HIT_RADIUS_M = 50;

export interface Rate {
  readonly hits: number;
  readonly n: number;
  readonly value: number | null;
}

function rate(hits: number, n: number): Rate {
  return { hits, n, value: n === 0 ? null : hits / n };
}

interface SkuStats {
  readonly requests: number;
  readonly failureRate: Rate;
  readonly latencyP50Ms: number | null;
  readonly latencyP95Ms: number | null;
}

interface CriticalFinding {
  readonly caseId: string;
  readonly component: string;
  readonly criticalClass: string;
  readonly cleared: boolean;
  readonly clearingAction: string | null;
}

interface EtaStats {
  readonly n: number;
  readonly signedMedianPct: number | null;
  readonly absMedianPct: number | null;
  readonly absP90Pct: number | null;
}

export interface ComponentMetrics {
  readonly id: string;
  readonly bundle: string;
  readonly kind: string;
  readonly sku: Partial<Record<GeoSku, SkuStats>>;
  readonly autocomplete?: {
    readonly top5: Rate;
    readonly perLanguage: Readonly<Record<QueryLanguage, Rate>>;
    readonly keystrokesToHit: Readonly<Record<'3' | '5' | '8' | 'full' | 'not_found', number>>;
    readonly urduHandling: Rate;
  };
  readonly geocode?: { readonly top1: Rate; readonly top3: Rate; readonly medianTop1ErrorM: number | null };
  readonly reverse?: { readonly useful: Rate; readonly unrated: number };
  readonly route?: {
    readonly distanceErrorMedianPct: number | null;
    readonly distanceErrorP90Pct: number | null;
    readonly distanceLegs: number;
    readonly flaggedLegs: number;
    readonly odometerOnlyLegs: number;
    readonly etaOffPeak: EtaStats;
    readonly etaPeak: EtaStats;
    readonly constraintPlausibility: Rate;
    readonly corridorOverlapMedianPct: number | null;
    readonly critical: readonly CriticalFinding[];
    readonly unresolvedCritical: number;
    readonly unreviewed: number;
  };
}

export interface Evidence {
  readonly autocomplete: { caseId: string; category: Category; component: string; language: QueryLanguage; rank: number | null; keystrokes: string | null }[];
  readonly geocode: { caseId: string; category: Category; component: string; top1ErrorM: number | null; top1Hit: boolean; top3Hit: boolean }[];
  readonly reverse: { caseId: string; category: Category; component: string; usefulness: number | null }[];
  readonly routes: {
    caseId: string;
    category: Category;
    component: string;
    peak: boolean;
    distanceErrorPct: number | null;
    etaErrorPct: number | null;
    corridorOverlapPct: number | null;
    classification: string | null;
  }[];
}

export interface MetricInputs {
  readonly cases: ValidationResult;
  readonly run: RunRecord;
  /** `${caseId}|${component}` → usefulness 0–3 (un-blinded). */
  readonly ratings: ReadonlyMap<string, number>;
  /** `${caseId}|${component}` → review entry. */
  readonly review: ReadonlyMap<string, ReviewEntry>;
  readonly truths: ReadonlyMap<string, LegTruth>;
  readonly peakSessions: ReadonlySet<string>;
}

function skuStats(run: RunRecord, component: string): Partial<Record<GeoSku, SkuStats>> {
  const out: Partial<Record<GeoSku, SkuStats>> = {};
  const skus = new Set(run.calls.filter((c) => c.component === component).map((c) => c.sku));
  for (const sku of skus) {
    const calls = run.calls.filter((c) => c.component === component && c.sku === sku);
    // Latency over answered calls only (a fast failure must not improve the latency score; failures count in failureRate).
    const latencies = calls.filter((c) => c.outcome !== 'ERROR').map((c) => c.latencyMs);
    out[sku] = {
      requests: calls.length,
      failureRate: rate(calls.filter((c) => c.outcome !== 'OK').length, calls.length),
      latencyP50Ms: percentile(latencies, 50),
      latencyP95Ms: percentile(latencies, 95),
    };
  }
  return out;
}

const within = (a: GeoPoint, b: GeoPoint) => haversineM(a, b) <= HIT_RADIUS_M;
const median = (values: readonly number[]) => percentile(values, 50);

function etaStats(values: readonly number[]): EtaStats {
  const abs = values.map((v) => Math.abs(v));
  return { n: values.length, signedMedianPct: median(values), absMedianPct: median(abs), absP90Pct: percentile(abs, 90) };
}

/** Computes per-component metrics and the per-case evidence table. */
export function computeMetrics(input: MetricInputs): { components: ComponentMetrics[]; evidence: Evidence } {
  const { cases, run } = input;
  const pointById = new Map(cases.points.map((p) => [p.id, p]));
  const routeById = new Map(cases.routes.map((r) => [r.id, r]));
  const evidence: Evidence = { autocomplete: [], geocode: [], reverse: [], routes: [] };
  const components: ComponentMetrics[] = [];

  for (const c of run.components) {
    const base = { id: c.id, bundle: c.bundle, kind: c.kind, sku: skuStats(run, c.id) };
    if (c.kind === 'AUTOCOMPLETE') {
      const perLanguage: Record<QueryLanguage, { hits: number; n: number }> = { en: { hits: 0, n: 0 }, roman_urdu: { hits: 0, n: 0 }, urdu: { hits: 0, n: 0 } };
      const keystrokes = { '3': 0, '5': 0, '8': 0, full: 0, not_found: 0 };
      let urduHits = 0;
      let urduN = 0;
      for (const rec of run.autocomplete.filter((r) => r.component === c.id)) {
        const point = pointById.get(rec.caseId);
        if (point === undefined) continue;
        const full = rec.prefixes.find((p) => p.prefixLength === null);
        const correct = new Set<string>();
        let rank: number | null = null;
        if (full !== undefined) {
          for (let i = 0; i < full.ids.length; i++) {
            const id = full.ids[i] as string;
            const candidate = full.points !== null ? full.points[i] : rec.resolved.find((r) => r.id === id)?.point;
            if (candidate !== undefined && candidate !== null && within(candidate, point.truth)) {
              correct.add(id);
              rank ??= i + 1;
            }
          }
        }
        let keystroke: string | null = null;
        for (const p of rec.prefixes.filter((x) => x.prefixLength !== null).sort((a, b) => (a.prefixLength ?? 0) - (b.prefixLength ?? 0))) {
          const hit = p.points !== null ? p.points.some((pt) => within(pt, point.truth)) : p.ids.some((id) => correct.has(id));
          if (hit) {
            keystroke = String(p.prefixLength);
            break;
          }
        }
        if (keystroke === null && rank !== null) keystroke = 'full';
        keystrokes[(keystroke ?? 'not_found') as keyof typeof keystrokes] += 1;
        const bucket = perLanguage[rec.language];
        bucket.n += 1;
        if (rank !== null) bucket.hits += 1;
        if (rec.language === 'urdu') {
          urduN += 1;
          if (rank !== null || full?.anyUrduName === true) urduHits += 1;
        }
        evidence.autocomplete.push({ caseId: rec.caseId, category: point.category, component: c.id, language: rec.language, rank, keystrokes: keystroke });
      }
      const totalHits = perLanguage.en.hits + perLanguage.roman_urdu.hits + perLanguage.urdu.hits;
      const totalN = perLanguage.en.n + perLanguage.roman_urdu.n + perLanguage.urdu.n;
      components.push({
        ...base,
        autocomplete: {
          top5: rate(totalHits, totalN),
          perLanguage: {
            en: rate(perLanguage.en.hits, perLanguage.en.n),
            roman_urdu: rate(perLanguage.roman_urdu.hits, perLanguage.roman_urdu.n),
            urdu: rate(perLanguage.urdu.hits, perLanguage.urdu.n),
          },
          keystrokesToHit: keystrokes,
          urduHandling: rate(urduHits, urduN),
        },
      });
    } else if (c.kind === 'GEOCODE') {
      let top1 = 0;
      let top3 = 0;
      let n = 0;
      const errors: number[] = [];
      for (const rec of run.geocode.filter((r) => r.component === c.id)) {
        const point = pointById.get(rec.caseId);
        if (point === undefined) continue;
        n += 1;
        const first = rec.points[0];
        const err = first === undefined ? null : haversineM(first, point.truth);
        if (err !== null) errors.push(err);
        const hit1 = err !== null && err <= HIT_RADIUS_M;
        const hit3 = rec.points.slice(0, 3).some((p) => within(p, point.truth));
        if (hit1) top1 += 1;
        if (hit3) top3 += 1;
        evidence.geocode.push({
          caseId: rec.caseId,
          category: point.category,
          component: c.id,
          top1ErrorM: err === null ? null : Math.round(err),
          top1Hit: hit1,
          top3Hit: hit3,
        });
      }
      components.push({ ...base, geocode: { top1: rate(top1, n), top3: rate(top3, n), medianTop1ErrorM: median(errors) } });
    } else if (c.kind === 'REVERSE_GEOCODE') {
      let useful = 0;
      let rated = 0;
      let unrated = 0;
      for (const rec of run.reverse.filter((r) => r.component === c.id)) {
        const point = pointById.get(rec.caseId);
        if (point === undefined) continue;
        const score = rec.errorCode !== null || rec.place === null ? 0 : input.ratings.get(`${rec.caseId}|${c.id}`);
        if (score === undefined) unrated += 1;
        else {
          rated += 1;
          if (score >= 2) useful += 1;
        }
        evidence.reverse.push({ caseId: rec.caseId, category: point.category, component: c.id, usefulness: score ?? null });
      }
      components.push({ ...base, reverse: { useful: rate(useful, rated), unrated } });
    } else {
      const distance: number[] = [];
      let flagged = 0;
      let odometerOnly = 0;
      const etaOff: number[] = [];
      const etaPeak: number[] = [];
      const overlaps: number[] = [];
      const critical: CriticalFinding[] = [];
      let unreviewed = 0;
      let constraintHits = 0;
      let constraintN = 0;
      for (const rec of run.routes.filter((r) => r.component === c.id)) {
        const leg = routeById.get(rec.caseId);
        // Field legs always have a truth; a DESK_OSM leg has none (no drive), so only the review and the hard gate apply.
        const truth = input.truths.get(rec.caseId);
        if (leg === undefined || (truth === undefined && cases.source === 'FIELD')) continue;
        const peak = input.peakSessions.has(leg.sessionId);
        const review = input.review.get(`${rec.caseId}|${c.id}`);
        let distancePct: number | null = null;
        let etaPct: number | null = null;
        let overlapPct: number | null = null;
        if (rec.errorCode === null && rec.distanceM !== null && rec.durationS !== null) {
          if (truth !== undefined && leg.actualMinutes !== null) {
            distancePct = (Math.abs(rec.distanceM - truth.distanceM) / truth.distanceM) * 100;
            etaPct = ((rec.durationS - leg.actualMinutes * 60) / (leg.actualMinutes * 60)) * 100;
            if (leg.followedNaturalRoute === true) {
              if (truth.flagged) flagged += 1;
              else {
                distance.push(distancePct);
                if (truth.source === 'ODOMETER') odometerOnly += 1;
              }
              (peak ? etaPeak : etaOff).push(etaPct);
            }
            const overlap = truth.track === null ? null : corridorOverlap(rec.geometry, truth.track);
            if (overlap !== null) {
              overlapPct = overlap * 100;
              overlaps.push(overlapPct);
            }
          }
          if (review === undefined) unreviewed += 1;
          else {
            if (review.classification === 'CRITICAL') {
              critical.push({
                caseId: rec.caseId,
                component: c.id,
                criticalClass: review.criticalClass ?? 'UNSPECIFIED',
                cleared: review.cleared,
                clearingAction: review.clearingAction,
              });
            }
            if (CONSTRAINT_CATEGORIES.has(leg.category)) {
              constraintN += 1;
              if (review.classification === 'NONE') constraintHits += 1;
            }
          }
        }
        evidence.routes.push({
          caseId: rec.caseId,
          category: leg.category,
          component: c.id,
          peak,
          distanceErrorPct: distancePct,
          etaErrorPct: etaPct,
          corridorOverlapPct: overlapPct,
          classification: review?.classification ?? null,
        });
      }
      components.push({
        ...base,
        route: {
          distanceErrorMedianPct: median(distance),
          distanceErrorP90Pct: percentile(distance, 90),
          distanceLegs: distance.length,
          flaggedLegs: flagged,
          odometerOnlyLegs: odometerOnly,
          etaOffPeak: etaStats(etaOff),
          etaPeak: etaStats(etaPeak),
          constraintPlausibility: rate(constraintHits, constraintN),
          corridorOverlapMedianPct: median(overlaps),
          critical,
          unresolvedCritical: critical.filter((f) => !f.cleared).length,
          unreviewed,
        },
      });
    }
  }
  return { components, evidence };
}
