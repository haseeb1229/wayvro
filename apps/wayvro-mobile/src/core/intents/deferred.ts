import type { Intent } from './intent';

/**
 * A deferred intent waits for sign-in, a required action or the app-policy gate. It is held IN MEMORY only (never
 * persisted), replayed once, and dropped after 10 minutes. One slot: a newer intent replaces an older one.
 * @internal exported for unit tests
 */
export const DEFERRED_INTENT_TTL_MS = 10 * 60 * 1000;

/** @internal exported for unit tests */
export class DeferredIntents {
  private held: { readonly intent: Intent; readonly at: number } | null = null;

  hold(intent: Intent, now: number): void {
    this.held = { intent, at: now };
  }

  /** Takes the held intent (one-shot); an intent older than the TTL is dropped and null returned. */
  take(now: number): Intent | null {
    const held = this.held;
    this.held = null;
    if (held === null) return null;
    const age = now - held.at;
    return age >= 0 && age <= DEFERRED_INTENT_TTL_MS ? held.intent : null;
  }

  clear(): void {
    this.held = null;
  }
}

/** The process-wide holder for system-delivered intents (written by `+native-intent`, read by the session layer). */
export const systemIntents = new DeferredIntents();
