/*
 * INSTRUMENTED BUILD ONLY (SP-02 §6.2, F-P3-07, PB-06): Metro Babel-transformer wrapper used by metro.config.cjs when
 * WAYVRO_PERF_INSTRUMENT=1 (set by `node scripts/android-build.mjs e2e`; refused by `release`). Never part of a release
 * bundle: the release-purity gate and ART-ISO scan the release artefact for the probe symbol below.
 *
 * Every app source module under src/ (tests excluded) gets one statement prepended before Expo's own transform:
 *   - a process-wide evaluation counter (`n` = app modules evaluated, `d` = Driver/Partner feature modules evaluated);
 *   - one log line `WayvroPerf eval n=<n> d=<d> driver=<0|1> <module path>` (logcat tag ReactNativeJS).
 * Evaluation, not download, is what Metro's single Hermes bundle can defer (`import()`), so the logcat lines before
 * Android's `Fully drawn` line (reportFullyDrawn, SP-02 §6.1) give the PB-06 count: driver modules evaluated before
 * Rider home was interactive (budget 0) and the total app modules evaluated (informational).
 */
'use strict';
const path = require('node:path');

const upstreamPath = process.env.WAYVRO_PERF_UPSTREAM_TRANSFORMER;
const appRoot = process.env.WAYVRO_PERF_APP_ROOT;
if (!upstreamPath || !appRoot) throw new Error('perf-eval-transformer: load it only through metro.config.cjs with WAYVRO_PERF_INSTRUMENT=1');
const upstream = require(upstreamPath);

const SOURCE_FILE = /^src\/.+\.(ts|tsx)$/;
const TEST_FILE = /\.test\.tsx?$|^src\/__mocks__\//;
const DRIVER_FILE = /^src\/features\/driver\//;

/** The prepended statement; `__wayvroPerfEval` is the probe symbol the release gates look for. */
function probe(relPath) {
  const driver = DRIVER_FILE.test(relPath);
  const label = JSON.stringify(` driver=${driver ? '1' : '0'} ${relPath}`);
  return (
    'var __wayvroPerfCounter=(globalThis.__wayvroPerfEval=globalThis.__wayvroPerfEval||{n:0,d:0});' +
    `__wayvroPerfCounter.n++;${driver ? '__wayvroPerfCounter.d++;' : ''}` +
    `console.log("WayvroPerf eval n="+__wayvroPerfCounter.n+" d="+__wayvroPerfCounter.d+${label});\n`
  );
}

function transform(args) {
  const projectRoot = args.options && typeof args.options.projectRoot === 'string' ? args.options.projectRoot : appRoot;
  const relPath = path.relative(appRoot, path.resolve(projectRoot, args.filename)).split(path.sep).join('/');
  if (!SOURCE_FILE.test(relPath) || TEST_FILE.test(relPath)) return upstream.transform(args);
  return upstream.transform({ ...args, src: probe(relPath) + args.src });
}

module.exports = {
  transform,
  getCacheKey: (options) => `wayvro-perf-instrumented:${typeof upstream.getCacheKey === 'function' ? upstream.getCacheKey(options) : ''}`,
};
