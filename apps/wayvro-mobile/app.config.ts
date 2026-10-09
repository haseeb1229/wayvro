import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The ONE public Wayvro app (ADR-026; docs/28). Rider mode and the Driver/Partner mode live in this single binary as
 * isolated feature modules; there is no separate driver app.
 *
 * Identifiers: `dev.wayvro.app` is a TECHNICAL DEVELOPMENT identifier only. The final Android applicationId / iOS
 * bundle id are decided after brand, company, domain and store clearance (ADR-001, docs/28 §15) and must not be
 * treated as registered. Override with WAYVRO_APP_ID for local experiments.
 */
// app.config.ts runs in Node, but the app tsconfig deliberately excludes Node globals from React Native code.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const APP_ID = env['WAYVRO_APP_ID'] ?? 'dev.wayvro.app';

/**
 * Expo and its modules add these by default. None is justified by the Phase 1 shell, so they are removed from the
 * merged manifest; CI then verifies the release AAB against infra/ci/android/permission-allowlist.json. Later
 * features request permissions just in time and add them to the allowlist with a requirement ID (CLAUDE.md §9).
 */
const BLOCKED_ANDROID_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.VIBRATE',
  'android.permission.CHANGE_WIFI_MULTICAST_STATE',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.RECORD_AUDIO',
];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Wayvro',
  slug: 'wayvro',
  version: '0.0.0',
  orientation: 'portrait',
  // No over-the-air updates in Phase 1 (ADR-031 is PROPOSED: JS-only, signed, staged — never permissions/native).
  updates: { enabled: false },
  platforms: ['android', 'ios'],
  android: {
    package: APP_ID,
    blockedPermissions: BLOCKED_ANDROID_PERMISSIONS,
    allowBackup: false,
    predictiveBackGestureEnabled: false,
  },
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
  },
});
