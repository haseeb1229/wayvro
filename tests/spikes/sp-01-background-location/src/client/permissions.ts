/**
 * Driver go-online permission steps for the spike (protocol §5.1; PHASE3_PERMISSION_LOCATION_MODEL §5):
 * fine (precise required) → background "Allow all the time" (Android 11+ shows the system settings page) →
 * notifications (Android 13+, denial tolerated). Requested only from the go-online flow, never at start-up.
 */
import * as Location from 'expo-location';
import { PermissionsAndroid, Platform } from 'react-native';

export type PermissionSnapshot = {
  readonly foreground: 'granted' | 'denied' | 'undetermined';
  readonly precise: boolean;
  readonly background: 'granted' | 'denied' | 'undetermined';
  readonly servicesEnabled: boolean;
};

export async function readPermissions(): Promise<PermissionSnapshot> {
  const [fg, bg, services] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Location.hasServicesEnabledAsync(),
  ]);
  return {
    foreground: fg.status,
    precise: fg.granted && fg.android?.accuracy !== 'coarse',
    background: bg.status,
    servicesEnabled: services,
  };
}

export async function requestForeground(): Promise<PermissionSnapshot> {
  await Location.requestForegroundPermissionsAsync();
  return readPermissions();
}

/** On Android 11+ the system opens the app's location settings page; the promise settles when the user returns. */
export async function requestBackground(): Promise<PermissionSnapshot> {
  await Location.requestBackgroundPermissionsAsync();
  return readPermissions();
}

export type NotificationOutcome = 'granted' | 'denied' | 'not-required';

export async function requestNotifications(): Promise<NotificationOutcome> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return 'not-required';
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  return r === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
}

export const isReadyToGoOnline = (p: PermissionSnapshot): boolean => p.foreground === 'granted' && p.precise && p.background === 'granted' && p.servicesEnabled;
