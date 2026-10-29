/*
 * SP-01 spike-only R8 keep rule (never used by apps/wayvro-mobile).
 *
 * The manifest meta-data `org.unimodules.core.AppLoader#react-native-headless` names
 * `expo.modules.adapters.react.apploader.RNHeadlessAppLoader`, which expo-modules-core loads by reflection when a
 * process starts without an activity (expo-task-manager delivering a location batch to a headless JS task). No consumer
 * keep rule covers it, so the R8-minified release build removed the class and every headless start crashed with
 * ClassNotFoundException (2026-10-16 emulator run, docs/phase3/evidence/laptop/SP01_EMULATOR_SUPPLEMENT.md defect 4).
 * The rule is appended to the prebuild-generated android/app/proguard-rules.pro (idempotent).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// expo/config-plugins has no ESM exports map: Node needs the file path (a CommonJS re-export of @expo/config-plugins).
import configPlugins from 'expo/config-plugins.js';

const { withDangerousMod } = configPlugins;

export const HEADLESS_KEEP_RULE = '-keep class expo.modules.adapters.react.apploader.RNHeadlessAppLoader { *; }';

/** Returns `rules` with the keep rule appended once. */
export function withHeadlessKeepRule(rules) {
  if (rules.split(/\r?\n/).some((line) => line.trim() === HEADLESS_KEEP_RULE)) return rules;
  const base = rules.endsWith('\n') || rules === '' ? rules : `${rules}\n`;
  return `${base}\n# SP-01 spike: headless JS app loader is loaded by reflection (spike-proguard.mjs)\n${HEADLESS_KEEP_RULE}\n`;
}

export default function withSpikeProguard(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const file = join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      writeFileSync(file, withHeadlessKeepRule(readFileSync(file, 'utf8')));
      return cfg;
    },
  ]);
}
