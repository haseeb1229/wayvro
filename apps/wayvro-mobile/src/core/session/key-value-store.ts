/**
 * Minimal async key/value port over OS secure storage (Q01). Every persisted item of the app — session tokens, the
 * installation id, idempotency intents and the pre-sign-in language choice — goes through this port; the only
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
} as const;
