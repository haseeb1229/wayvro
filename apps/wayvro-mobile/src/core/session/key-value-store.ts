/**
 * Minimal async key/value port over OS secure storage (Q01). Every persisted item of the app — session tokens, the
 * installation id, idempotency intents, the pre-sign-in language choice and the evidence upload queue metadata — goes
 * through this port; the only
 * implementation in the app is `secure-token-store.ts` (expo-secure-store). There is no plain/AsyncStorage fallback.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

/** Storage keys (versioned so a format change never reads an older shape as current). */
export const STORAGE_KEYS = {
  session: 'wayvro.session.v1',
  installationId: 'wayvro.installation-id.v1',
  idempotencyIntents: 'wayvro.idempotency-intents.v1',
  uiLocale: 'wayvro.ui-locale.v1',
  /** P2.8 evidence upload queue: metadata only (ids, local file name, size, state) — never image bytes. */
  evidenceQueue: 'wayvro.evidence-queue.v1',
  /** P3.5 (A01/Q31): last app policy from GET /v1/app/config — installation-scoped, kept on sign-out. */
  appPolicy: 'wayvro.app-policy.v1',
  /** P3.5 (L08): Lite-mode preference — installation-scoped, kept on sign-out. */
  liteMode: 'wayvro.lite-mode.v1',
  /** P3.5 (V08, ADR-048): mode preference bound to an account id — a navigation HINT only, wiped on sign-out/expiry. */
  modePreference: 'wayvro.mode-preference.v1',
  /** P3.5 (V08): last quote group id + server expiry only (no coordinates, no prices) — wiped on sign-out/expiry. */
  lastQuoteGroup: 'wayvro.last-quote-group.v1',
} as const;
