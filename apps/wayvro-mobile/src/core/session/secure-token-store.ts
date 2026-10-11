import * as SecureStore from 'expo-secure-store';
import type { KeyValueStore } from './key-value-store';

/**
 * The ONLY module that touches expo-secure-store (Android Keystore-backed encrypted preferences / iOS Keychain).
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps items out of iCloud Keychain migration and device-to-device restore; Android
 * backup is disabled app-wide (`allowBackup: false`). A static test enforces that no other module imports the library.
 */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const secureTokenStore: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key, OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
