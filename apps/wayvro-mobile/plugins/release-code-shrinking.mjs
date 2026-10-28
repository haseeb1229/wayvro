/*
 * PB-07 (FA-07, SP-02): R8 code shrinking for release-mode builds (the release AAB and the SP-08 E2E APK).
 *
 * Without it the release AAB carried about 49 MB of uncompressed dex (every class of every Android library, used or
 * not). ART runs that code straight from the APK, so the touched pages count towards PSS: on the Galaxy A30 reference
 * device Rider home measured p90 169–170 MB against the 160 MB budget (docs/phase3/evidence/device/SP02_SAMSUNG_A30.md).
 *
 * - `android.enableMinifyInReleaseBuilds=true` is the Expo template's own switch (android/app/build.gradle reads it for
 *   `minifyEnabled` in the release build type only). Debug and development builds are unchanged.
 * - `-dontobfuscate`: R8 removes unused code but keeps class names. Crash stack traces stay readable without a mapping
 *   upload, and the release-purity gate (infra/ci/android/check-release-purity.mjs) can still find dev-launcher classes
 *   by name. A renamed class would pass that gate for the wrong reason.
 * - Resource shrinking stays OFF: React Native loads bundled JS image assets by resource NAME at runtime, which R8
 *   cannot see. Resources are not dex code and do not explain the PB-07 result.
 *
 * Libraries ship their own consumer keep rules (React Native, Expo modules, AndroidX); the generated proguard-rules.pro
 * keeps its template entries. The release E2E suite (SP-08) runs on the shrunk variant, so a missing keep rule fails CI.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// expo/config-plugins has no ESM exports map: Node needs the file path (a CommonJS re-export of @expo/config-plugins).
import configPlugins from 'expo/config-plugins.js';

const { withDangerousMod, withGradleProperties } = configPlugins;

export const MINIFY_PROPERTY = 'android.enableMinifyInReleaseBuilds';
export const RESOURCE_SHRINK_PROPERTY = 'android.enableShrinkResourcesInReleaseBuilds';
export const KEEP_NAMES_RULE = '-dontobfuscate';

/**
 * Sets minify on and resource shrinking off in the parsed gradle.properties entries (idempotent).
 * @param {Array<{ type: string; key?: string; value?: string }>} properties
 * @returns {Array<{ type: string; key?: string; value?: string }>}
 */
export function setShrinkingProperties(properties) {
  const wanted = { [MINIFY_PROPERTY]: 'true', [RESOURCE_SHRINK_PROPERTY]: 'false' };
  const out = properties.filter((p) => !(p.type === 'property' && p.key in wanted));
  for (const [key, value] of Object.entries(wanted)) out.push({ type: 'property', key, value });
  return out;
}

/**
 * Appends the keep-names rule to proguard-rules.pro content once.
 * @param {string} rules
 * @returns {string}
 */
export function addKeepNamesRule(rules) {
  if (rules.split(/\r?\n/).some((line) => line.trim() === KEEP_NAMES_RULE)) return rules;
  const base = rules.length === 0 || rules.endsWith('\n') ? rules : `${rules}\n`;
  return `${base}\n# PB-07 (plugins/release-code-shrinking.mjs): shrink unused code, keep class names readable.\n${KEEP_NAMES_RULE}\n`;
}

export default function withReleaseCodeShrinking(config) {
  const withProperties = withGradleProperties(config, (c) => {
    c.modResults = setShrinkingProperties(c.modResults);
    return c;
  });
  return withDangerousMod(withProperties, [
    'android',
    (c) => {
      const file = join(c.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
      writeFileSync(file, addKeepNamesRule(current));
      return c;
    },
  ]);
}
