/** Small, dependency-free statistics used by the SP-01 aggregator (protocol §12). */

/** Nearest-rank percentile: rank = ceil(p/100 * n) on the ascending sample; null for an empty sample. */
export function nearestRank(values: readonly number[], p: number): number | null {
  if (!(p > 0 && p <= 100)) throw new Error('p must be in (0, 100]');
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? 0) + hi) / 2;
}

/**
 * Device clock offset (server − device) from round-trip samples: for each sample the device time at the server's
 * reading is estimated as the midpoint (t0 + t1) / 2; the offset is the median of ts − midpoint (robust to a few slow
 * round trips). Corrected device time = deviceMs + offset.
 */
export function estimateOffsetMs(samples: readonly { t0: number; ts: number; t1: number }[]): number | null {
  const valid = samples.filter((s) => s.t1 >= s.t0);
  const m = median(valid.map((s) => s.ts - (s.t0 + s.t1) / 2));
  return m === null ? null : Math.round(m);
}

export const round = (value: number | null, digits = 2): number | null =>
  value === null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits;

export const msToS = (value: number | null): number | null => (value === null ? null : round(value / 1000, 2));
