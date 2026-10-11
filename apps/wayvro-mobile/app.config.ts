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
 * API origin (P2.3). There is deliberately NO default: a build without WAYVRO_API_URL shows a "service not configured"
 * state instead of guessing a production URL. WAYVRO_DEV_LOCAL_API=1 lets a DEVELOPMENT build (`__DEV__`) fall back to
 * the Android-emulator loopback of the local API runner; release builds ignore it (src/core/config/api-config.ts).
 */
const API_URL = env['WAYVRO_API_URL']?.trim() ?? '';
const DEV_LOCAL_API = env['WAYVRO_DEV_LOCAL_API'] === '1';

/**
 * Expo and its modules add these by default. None is justified by the shell or the P2.3 account slice, so they are removed from the
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
  // Contributed by androidx.biometric (an expo-secure-store dependency). The app never calls secure-store with
  // `requireAuthentication`, so no biometric prompt exists; a biometric unlock would need its own reviewed decision.
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
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
  // No URL scheme yet: deep links arrive with a reviewed link plan once the identifiers are cleared (docs/28 §15).
  plugins: ['expo-router'],
  extra: { wayvroApi: { ...(API_URL === '' ? {} : { baseUrl: API_URL }), devLocalApi: DEV_LOCAL_API } },
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
