import * as Location from 'expo-location';
import { oneShotFix, PIN_WATCH, type DeviceFix, type FixOutcome } from './fix-policy';
import { snapshotFromPermission, type PermissionSnapshot } from './machine';

/**
 * Rider-only location entry point (A07; FA-02 APPROVED scope: foreground, when-in-use, just in time). Called ONLY after
 * the rider tapped "Use current location" and saw the in-app rationale (the state machine enforces the order). No
 * background permission, no location task, no geofencing, no foreground service — the architecture test bans those
 * APIs by name. Coordinates are returned to memory only; nothing is persisted or logged.
 */

/** The single OS foreground request (the user may grant precise or approximate). */
export async function requestForegroundLocation(): Promise<PermissionSnapshot> {
  const [permission, servicesEnabled] = await Promise.all([Location.requestForegroundPermissionsAsync(), Location.hasServicesEnabledAsync()]);
  return snapshotFromPermission(permission, servicesEnabled);
}

const toFix = (location: Location.LocationObject): DeviceFix => ({
  lat: location.coords.latitude,
  lng: location.coords.longitude,
  accuracyM: location.coords.accuracy,
  timestamp: location.timestamp,
});

/** Balanced accuracy and no "improve accuracy" system dialog: services-off is explained by the app itself. */
const OPTIONS: Location.LocationOptions = { accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false };

/** One fix attempt (fresh last-known position, else the current position bounded by the 10 s app-side timeout). */
export function currentFix(): Promise<FixOutcome> {
  return oneShotFix({
    lastKnown: async () => {
      const last = await Location.getLastKnownPositionAsync();
      return last === null ? null : toFix(last);
    },
    current: async () => toFix(await Location.getCurrentPositionAsync(OPTIONS)),
    now: Date.now,
    delay: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  });
}

/**
 * Scoped watch for the pin screen (≥ 5 s, ≥ 10 m). The caller stops it on blur, background, sign-out and revocation;
 * `onError` receives a failure of the platform watch (the pin screen then falls back to search/pickup points).
 */
export async function watchPickupFix(onFix: (fix: DeviceFix) => void, onError: () => void): Promise<() => void> {
  const subscription = await Location.watchPositionAsync(
    { ...OPTIONS, timeInterval: PIN_WATCH.timeIntervalMs, distanceInterval: PIN_WATCH.distanceIntervalM },
    (location) => {
      onFix(toFix(location));
    },
    () => {
      onError();
    },
  );
  return () => {
    subscription.remove();
  };
}
