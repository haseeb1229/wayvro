/** Bounded retry timing (CLAUDE.md §13: no retry storms). */

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
/** A 503 asking for a longer wait is surfaced as "unavailable" instead of blocking the user. */
export const MAX_RETRY_AFTER_SECONDS = 10;

/**
 * Delay before retry number `attempt` (1-based): the server's Retry-After when given, otherwise exponential backoff
 * with full jitter, capped.
 */
export function backoffDelayMs(attempt: number, retryAfterSeconds: number | null, random: () => number): number {
  if (retryAfterSeconds !== null) return Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_SECONDS * 1000);
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}
