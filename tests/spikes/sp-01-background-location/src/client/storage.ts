/**
 * Minimal persisted spike state (AsyncStorage). No position, no token-like secret (the spike-local-only token is not a
 * secret), no device identifier. Sign-out removes every key (TC-17).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClientEvent, LocationProfile } from '../shared/protocol.ts';

export type ReceiverConfig = { readonly baseUrl: string; readonly gatewayUrl: string; readonly token: string };
export type Mode = 'rider' | 'driver';
/** Set when the user went online in some process; cleared on any stop. Survives a crash so the next open can reconcile. */
export type OnlineIntent = { readonly runId: string; readonly sinceDeviceMs: number };
export type Notice = { readonly kind: NoticeKind; readonly code: string; readonly atDeviceMs: number };
export type NoticeKind =
  'tracking-stopped' | 'forced-offline' | 'permission-lost' | 'go-online-refused' | 'background-start-refused' | 'tc10-invalid' | 'stopped';

const KEYS = {
  config: 'sp01.config',
  mode: 'sp01.mode',
  profile: 'sp01.profile',
  onlineIntent: 'sp01.onlineIntent',
  pendingEvents: 'sp01.pendingEvents',
  notice: 'sp01.notice',
} as const;

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt spike value is discarded rather than trusted.
    await AsyncStorage.removeItem(key);
    return null;
  }
}

const writeJson = (key: string, value: unknown): Promise<void> =>
  value === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, JSON.stringify(value));

export const store = {
  config: () => readJson<ReceiverConfig>(KEYS.config),
  setConfig: (v: ReceiverConfig | null) => writeJson(KEYS.config, v),
  mode: async (): Promise<Mode> => ((await readJson<Mode>(KEYS.mode)) === 'driver' ? 'driver' : 'rider'),
  setMode: (v: Mode) => writeJson(KEYS.mode, v),
  profile: async (): Promise<LocationProfile> => ((await readJson<LocationProfile>(KEYS.profile)) === 'economy' ? 'economy' : 'standard'),
  setProfile: (v: LocationProfile) => writeJson(KEYS.profile, v),
  onlineIntent: () => readJson<OnlineIntent>(KEYS.onlineIntent),
  setOnlineIntent: (v: OnlineIntent | null) => writeJson(KEYS.onlineIntent, v),
  pendingEvents: async (): Promise<ClientEvent[]> => (await readJson<ClientEvent[]>(KEYS.pendingEvents)) ?? [],
  setPendingEvents: (v: readonly ClientEvent[]) => writeJson(KEYS.pendingEvents, v.length ? v.slice(-100) : null),
  notice: () => readJson<Notice>(KEYS.notice),
  setNotice: (v: Notice | null) => writeJson(KEYS.notice, v),
  clearAll: () => AsyncStorage.multiRemove(Object.values(KEYS)),
};
