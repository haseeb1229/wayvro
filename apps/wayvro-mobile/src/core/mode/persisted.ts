import { z } from 'zod';
import { STORAGE_KEYS, type KeyValueStore } from '../session/key-value-store';

/**
 * The two small records the mode layer keeps on the device (secure KeyValueStore port; both wiped on sign-out/expiry):
 *  - the mode preference — a navigation HINT bound to the account id, never a capability, KYC or restriction state;
 *  - the last quote group — its id and server expiry only (no coordinates, no prices, no addresses), so a restart can
 *    offer "Continue with your last price check" after the server confirms the group (owner-only GET).
 */
const ModePreferenceSchema = z.object({
  v: z.literal(1),
  accountId: z.uuid(),
  mode: z.enum(['RIDER', 'DRIVER']),
  savedAt: z.number().int().nonnegative(),
});
export type ModePreference = z.infer<typeof ModePreferenceSchema>;

const LastQuoteSchema = z.object({
  v: z.literal(1),
  quoteGroupId: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
  savedAt: z.number().int().nonnegative(),
});
export type LastQuote = z.infer<typeof LastQuoteSchema>;

async function readJson<T>(store: KeyValueStore, key: string, schema: z.ZodType<T>): Promise<T | null> {
  let raw: string | null;
  try {
    raw = await store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export const loadModePreference = (store: KeyValueStore): Promise<ModePreference | null> => readJson(store, STORAGE_KEYS.modePreference, ModePreferenceSchema);
export const saveModePreference = (store: KeyValueStore, preference: ModePreference): Promise<void> =>
  store.setItem(STORAGE_KEYS.modePreference, JSON.stringify(preference));

export const loadLastQuote = (store: KeyValueStore): Promise<LastQuote | null> => readJson(store, STORAGE_KEYS.lastQuoteGroup, LastQuoteSchema);
export const saveLastQuote = (store: KeyValueStore, last: LastQuote): Promise<void> => store.setItem(STORAGE_KEYS.lastQuoteGroup, JSON.stringify(last));
export const forgetLastQuote = (store: KeyValueStore): Promise<void> => store.deleteItem(STORAGE_KEYS.lastQuoteGroup);

/** Sign-out / session-expiry wipe of both records. */
export async function wipeModeRecords(store: KeyValueStore): Promise<void> {
  await store.deleteItem(STORAGE_KEYS.modePreference);
  await store.deleteItem(STORAGE_KEYS.lastQuoteGroup);
}
