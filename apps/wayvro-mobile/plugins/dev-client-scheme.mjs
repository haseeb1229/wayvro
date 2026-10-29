/*
 * F-P3-01 (ADR-043): the expo-dev-client generated `exp+<slug>` URL scheme exists ONLY in development builds.
 *
 * expo-dev-client's own option `addGeneratedScheme: false` (app.config.ts) stops it from appending the scheme to the
 * SHARED main manifest, which every variant — including release — inherits. This plugin re-adds the same scheme, with
 * the same intent filter the dev-client plugin generates (VIEW + DEFAULT + BROWSABLE on MainActivity), to the debug and
 * debugOptimized SOURCE-SET manifests only. The Android manifest merger applies those manifests to development variants
 * alone, so the dev launcher keeps its launch path (`exp+wayvro://expo-development-client/?url=…`) while the release AAB
 * exposes no external scheme. CI proves the release half on the artefact (infra/ci/android/check-intent-filters.mjs).
 *
 * iOS: there is no iOS build yet (ADR-036); `addGeneratedScheme: false` also leaves the iOS Info.plist without the
 * scheme. An iOS development build will need a Debug-configuration-only URL type when iOS builds start (recorded in
 * the Phase-3 implementation record).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
// expo/config-plugins has no ESM exports map: Node needs the file path (a CommonJS re-export of @expo/config-plugins).
import configPlugins from 'expo/config-plugins.js';

const { AndroidConfig, withDangerousMod } = configPlugins;

/** Same derivation as expo-dev-client's getDefaultScheme (RFC 3986 scheme characters, lower case, `exp+` prefix). */
function devClientScheme(slug) {
  const cleaned = String(slug ?? '')
    .replace(/[^A-Za-z0-9+\-.]/g, '')
    .toLowerCase();
  if (cleaned.length === 0) throw new Error('dev-client-scheme: app slug has no URL-safe characters');
  return `exp+${cleaned}`;
}

const DEV_SOURCE_SETS = ['debug', 'debugOptimized'];

function addSchemeToManifest(manifest, scheme) {
  const root = manifest.manifest;
  root.$ = { ...root.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
  root.application = root.application ?? [{ $: {} }];
  const application = root.application[0];
  application.activity = application.activity ?? [];
  let activity = application.activity.find((a) => a.$?.['android:name'] === '.MainActivity');
  if (!activity) {
    activity = { $: { 'android:name': '.MainActivity', 'tools:node': 'merge' }, 'intent-filter': [] };
    application.activity.push(activity);
  }
  activity['intent-filter'] = activity['intent-filter'] ?? [];
  const present = activity['intent-filter'].some((f) => (f.data ?? []).some((d) => d.$?.['android:scheme'] === scheme));
  if (!present) {
    activity['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }, { $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
      data: [{ $: { 'android:scheme': scheme } }],
    });
  }
  return manifest;
}

export default function withDevOnlyDevClientScheme(config) {
  const scheme = devClientScheme(config.slug);
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const appSrc = join(cfg.modRequest.platformProjectRoot, 'app', 'src');
      for (const sourceSet of DEV_SOURCE_SETS) {
        const file = join(appSrc, sourceSet, 'AndroidManifest.xml');
        // The React Native template ships debug (and, on 0.80+, debugOptimized) manifests; never invent a source set.
        if (!existsSync(file)) continue;
        const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(file);
        await AndroidConfig.Manifest.writeAndroidManifestAsync(file, addSchemeToManifest(manifest, scheme));
      }
      return cfg;
    },
  ]);
}
