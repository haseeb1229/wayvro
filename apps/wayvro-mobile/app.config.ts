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
 * Expo and its modules add these by default. None is justified by the shell, the P2.3 account slice or the P2.8 Driver/Partner
 * onboarding (which needs only CAMERA, requested just in time), so they are removed from the
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
  // P2.8: document imports use the Android system Photo Picker (no permission). expo-image-picker / expo-file-system
  // declare legacy storage access; no media, storage or audio permission is ever requested (Q01, CLAUDE.md §9).
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.ACCESS_MEDIA_LOCATION',
];

/**
 * The ONLY camera use (P2.8, K02/K03): photographing documents and one selfie for MANUAL review inside the
 * Driver/Partner application, requested just in time on the capture screen. Shown by iOS; Android has no usage string.
 */
const CAMERA_USAGE =
  'Wayvro uses the camera only when you choose to photograph a document or take a selfie for your Driver/Partner application. People review the photos; the camera never runs in the background.';
const PHOTOS_USAGE = 'Wayvro opens the system photo picker only when you choose to add a photo of a document to your Driver/Partner application.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Wayvro',
  slug: 'wayvro',
  version: '0.0.0',
  orientation: 'portrait',
  // No over-the-air updates in Phase 1 (ADR-031 is PROPOSED: JS-only, signed, staged — never permissions/native).
  updates: { enabled: false },
  platforms: ['android', 'ios'],
  // No URL scheme in release builds: deep links arrive with a reviewed link plan once the identifiers are cleared (docs/28
  // §15) and the decode-uri-component exception is closed (ADR-043). CI verifies the release AAB's exported components and
  // intent filters (infra/ci/android/check-intent-filters.mjs).
  plugins: [
    'expo-router',
    // F-P3-01: expo-dev-client would otherwise append its generated `exp+<slug>` scheme to the shared main manifest, which
    // the release variant inherits. Listing it here (prebuild then skips its automatic copy) turns that off; the local
    // plugin below re-adds the scheme to the debug/debugOptimized source-set manifests only, so development builds keep
    // the dev-launcher launch path.
    ['expo-dev-client', { addGeneratedScheme: false }],
    './plugins/dev-client-scheme.mjs',
    // No microphone, no video audio, no barcode scanner (smaller binary; RECORD_AUDIO also blocked above). The barcode
    // flag only takes effect because package.json `expo.autolinking.android.buildFromSource` compiles expo-camera from
    // source: its prebuilt AAR always links ML Kit barcode scanning and the Play services code scanner.
    ['expo-camera', { cameraPermission: CAMERA_USAGE, microphonePermission: false, recordAudioAndroid: false, barcodeScannerEnabled: false }],
    // Gallery access only through the system picker. `cameraPermission` is NOT `false` here: that option makes the plugin
    // BLOCK android.permission.CAMERA and delete the iOS camera usage string, which would break the expo-camera capture
    // above; the picker's own camera launcher is never used.
    ['expo-image-picker', { photosPermission: PHOTOS_USAGE, cameraPermission: CAMERA_USAGE, microphonePermission: false }],
  ],
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
