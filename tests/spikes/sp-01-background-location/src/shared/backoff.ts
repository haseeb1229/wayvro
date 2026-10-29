/**
 * Bounded exponential backoff with jitter (protocol §5.3, CLAUDE.md §13: no retry storms). "Equal jitter": half of the
 * capped exponential delay is fixed, the other half random, so retries never collapse to zero delay.
 */
export type BackoffPolicy = { readonly baseMs: number; readonly maxMs: number };

export const UPLOAD_BACKOFF: BackoffPolicy = { baseMs: 2_000, maxMs: 60_000 };

export function backoffDelayMs(failures: number, policy: BackoffPolicy, random: () => number = Math.random): number {
  if (failures <= 0) return 0;
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.min(failures - 1, 30));
  const r = Math.min(Math.max(random(), 0), 1);
  return Math.round(exp / 2 + (exp / 2) * r);
}
