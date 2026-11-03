/*
 * P3.5 / FA-02 (foreground-only Rider location; CLAUDE.md §9): removes expo-location's LocationTaskService from the
 * merged Android manifest of every variant.
 *
 * expo-location 57.0.20 declares `expo.modules.location.services.LocationTaskService` (non-exported,
 * foregroundServiceType="location") in its LIBRARY manifest, independent of the plugin options
 * `isAndroidBackgroundLocationEnabled` / `isAndroidForegroundServiceEnabled` (app.config.ts). The service is started only
 * by `LocationTaskConsumer`, i.e. `Location.startLocationUpdatesAsync` with a `foregroundService` option (TaskManager
 * background updates). Wayvro calls only the foreground APIs (`requestForegroundPermissionsAsync`,
 * `getForegroundPermissionsAsync`, `hasServicesEnabledAsync`, `getLastKnownPositionAsync`, `getCurrentPositionAsync`,
 * `watchPositionAsync` — apps/wayvro-mobile/src/platform/location), none of which binds or starts that service, so the
 * declaration is unused. A `tools:node="remove"` entry in the app manifest tells the Android manifest merger to drop it;
 * the upstream package is not modified. CI proves the result on the release AAB (infra/ci/android/check-intent-filters.mjs
 * FOREGROUND-SERVICE rule). Phase 4 Driver online tracking will need its own reviewed service decision (ADR-029/ADR-033).
 */
// expo/config-plugins has no ESM exports map: Node needs the file path (a CommonJS re-export of @expo/config-plugins).
import configPlugins from 'expo/config-plugins.js';

const { withAndroidManifest } = configPlugins;

export const LOCATION_TASK_SERVICE = 'expo.modules.location.services.LocationTaskService';

/** Adds (once) a `<service android:name=… tools:node="remove"/>` entry to the parsed app manifest. */
export function removeLocationTaskService(manifest) {
  const root = manifest.manifest;
  root.$ = { ...root.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
  root.application = root.application ?? [{ $: {} }];
  const application = root.application[0];
  application.service = application.service ?? [];
  const existing = application.service.find((s) => s.$?.['android:name'] === LOCATION_TASK_SERVICE);
  if (existing) existing.$ = { ...existing.$, 'tools:node': 'remove' };
  else application.service.push({ $: { 'android:name': LOCATION_TASK_SERVICE, 'tools:node': 'remove' } });
  return manifest;
}

export default function withNoLocationTaskService(config) {
  return withAndroidManifest(config, (c) => {
    c.modResults = removeLocationTaskService(c.modResults);
    return c;
  });
}
