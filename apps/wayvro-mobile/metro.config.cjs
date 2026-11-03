/*
 * Metro configuration of the ONE Wayvro app: Expo's default configuration, unchanged for every development and release
 * build. It changes ONLY when WAYVRO_PERF_INSTRUMENT=1, which `node scripts/android-build.mjs e2e` sets and `release`
 * mode refuses (SP-02 §6.2, F-P3-07, PB-06): the instrumented build wraps Expo's Babel transformer with
 * build-tools/perf-eval-transformer.cjs, which prepends a module-evaluation counter to every app source module and a
 * `WayvroPerf` log line to every Driver/Partner feature module. The extra transformer key below is part of Metro's
 * transform cache key, so instrumented and release transforms never share cache entries; the release-purity gate and
 * ART-ISO prove that the release bundle carries no probe.
 */
'use strict';
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.env.WAYVRO_PERF_INSTRUMENT === '1') {
  const upstream = config.transformer.babelTransformerPath;
  if (typeof upstream !== 'string' || upstream === '') throw new Error('metro.config: Expo default babelTransformerPath is missing');
  // Read by the wrapper inside Metro's transform workers (they inherit this process's environment).
  process.env.WAYVRO_PERF_UPSTREAM_TRANSFORMER = upstream;
  process.env.WAYVRO_PERF_APP_ROOT = __dirname;
  config.transformer = {
    ...config.transformer,
    babelTransformerPath: path.join(__dirname, 'build-tools', 'perf-eval-transformer.cjs'),
    wayvroPerfInstrumented: true,
  };
}

module.exports = config;
