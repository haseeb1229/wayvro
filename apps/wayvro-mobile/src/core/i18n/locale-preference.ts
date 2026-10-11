import { LocaleSchema } from '@wayvro/contracts';
import { STORAGE_KEYS, type KeyValueStore } from '../session/key-value-store';
import type { UiLocale } from './strings';

/**
 * The language chosen BEFORE sign-in (no device-locale library is installed, so the default is English). After
 * sign-in the server's `preferredLocale` is authoritative and is mirrored here so the next cold start opens in it.
 */
export async function loadUiLocale(store: KeyValueStore): Promise<UiLocale> {
  const parsed = LocaleSchema.safeParse(await store.getItem(STORAGE_KEYS.uiLocale));
  return parsed.success ? parsed.data : 'en';
}

export function saveUiLocale(store: KeyValueStore, locale: UiLocale): Promise<void> {
  return store.setItem(STORAGE_KEYS.uiLocale, locale);
}
