/**
 * Evaluation-spend hard stop (threat model §6 cost table: "refuse when the next call would exceed the free allowance
 * minus 20 %"). Free allowances are the planning-time monthly free caps read on 2026-10-12
 * (docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md §3 and threat model §6) — ESTIMATES to re-verify before a run; the
 * vendor-console hard quotas set by the founder (FA-06) remain the real backstop.
 *
 * Usage is recorded in a local, git-ignored ledger per UTC calendar month so consecutive runs in the same month add
 * up. The harness cannot see calls made outside it (e.g. console experiments): the README tells the founder to start
 * from a fresh evaluation project or to pass the already-used amounts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

export const FREE_ALLOWANCE_PER_MONTH = {
  /** Google Autocomplete Requests (Essentials free cap). Counted per request: conservative even if a session is free. */
  'google:autocomplete-requests': 10_000,
  /** Google Place Details Essentials. */
  'google:place-details-essentials': 10_000,
  /** Google Geocoding (forward and reverse assumed to share one SKU: reverse SKU naming NF). */
  'google:geocoding': 10_000,
  'google:routes-essentials': 10_000,
  /** Routes Pro (traffic-aware assumed Pro: tier mapping NF). */
  'google:routes-pro': 5_000,
  /** Mapbox Search Box sessions, STANDARD allowance (preview allowance not assumed). */
  'mapbox:searchbox-sessions': 2_500,
  /** Mapbox Geocoding v6 temporary (forward, reverse and the autocomplete-via-geocoding variant share it). */
  'mapbox:temporary-geocoding': 100_000,
  'mapbox:directions': 100_000,
} as const;
export type BudgetBucket = keyof typeof FREE_ALLOWANCE_PER_MONTH;

/** Stop at 80 % of the free allowance (allowance minus 20 %). */
const STOP_FRACTION = 0.8;

export class BudgetStopError extends Error {
  override readonly name = 'BudgetStopError';
  constructor(readonly bucket: BudgetBucket) {
    super(`budget hard stop: ${bucket} would exceed ${STOP_FRACTION * 100} % of its monthly free allowance`);
  }
}

const ledgerSchema = z.record(z.string().regex(/^\d{4}-\d{2}$/), z.record(z.string(), z.number().int().nonnegative()));

export function stopLimit(bucket: BudgetBucket): number {
  return Math.floor(FREE_ALLOWANCE_PER_MONTH[bucket] * STOP_FRACTION);
}

/** Monthly usage ledger with a hard stop. */
export class BudgetGuard {
  private readonly used: Map<BudgetBucket, number>;
  private readonly month: string;

  constructor(
    private readonly ledgerPath: string | null,
    now: Date,
    alreadyUsed: Partial<Record<BudgetBucket, number>> = {},
  ) {
    this.month = now.toISOString().slice(0, 7);
    this.used = new Map();
    const ledger = this.readLedger();
    for (const bucket of Object.keys(FREE_ALLOWANCE_PER_MONTH) as BudgetBucket[]) {
      this.used.set(bucket, (ledger[this.month]?.[bucket] ?? 0) + (alreadyUsed[bucket] ?? 0));
    }
  }

  private readLedger(): z.infer<typeof ledgerSchema> {
    if (this.ledgerPath === null || !existsSync(this.ledgerPath)) return {};
    const parsed = ledgerSchema.safeParse(JSON.parse(readFileSync(this.ledgerPath, 'utf8')) as unknown);
    if (!parsed.success) throw new Error('usage ledger is malformed: fix or move it before running (it is never reset silently)');
    return parsed.data;
  }

  usedUnits(bucket: BudgetBucket): number {
    return this.used.get(bucket) ?? 0;
  }

  /** Whether `units` more would stay within the stop limit. */
  wouldFit(bucket: BudgetBucket, units: number): boolean {
    return this.usedUnits(bucket) + units <= stopLimit(bucket);
  }

  /** Reserves units BEFORE a call; throws BudgetStopError (and records nothing) if the stop limit would be exceeded. */
  reserve(bucket: BudgetBucket, units: number): void {
    if (units <= 0) return;
    if (!this.wouldFit(bucket, units)) throw new BudgetStopError(bucket);
    this.used.set(bucket, this.usedUnits(bucket) + units);
  }

  /** Persists this month's usage (other months are kept). */
  save(): void {
    if (this.ledgerPath === null) return;
    const ledger = this.readLedger();
    ledger[this.month] = Object.fromEntries(this.used);
    writeFileSync(this.ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  }

  snapshot(): Record<string, { used: number; stopAt: number; allowance: number }> {
    return Object.fromEntries(
      (Object.keys(FREE_ALLOWANCE_PER_MONTH) as BudgetBucket[]).map((b) => [
        b,
        { used: this.usedUnits(b), stopAt: stopLimit(b), allowance: FREE_ALLOWANCE_PER_MONTH[b] },
      ]),
    );
  }
}
