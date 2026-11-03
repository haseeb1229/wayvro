#!/usr/bin/env node
/*
 * Wayvro Android RELEASE-PURITY gate (SP-08 §3.2 E1, ADR-052; SP-02 §6.2 / F-P3-07; PHASE3_TEST_STRATEGY §4.12).
 * Node >= 18, no npm dependencies. Proves that the gated release AAB carries nothing of the SP-08 E2E variant or of
 * the instrumented driver-module evaluation build, and no development launcher:
 *   1. merged base manifest (bundletool): no android:usesCleartextTraffic="true", no android:networkSecurityConfig;
 *   2. no E2E network-security resource (res/xml/wayvro_e2e_network_security*) in any module;
 *   3. embedded app config (base/assets/app.config): no `e2eLoopbackPort`, no `devLocalApi: true`, and a configured
 *      `baseUrl` (if any) is https and not a loopback/emulator/private-LAN host;
 *   4. JS bundle (base/assets/index.android.bundle, Hermes bytecode): no module-evaluation probe (`__wayvroPerfEval`,
 *      `WayvroPerf eval`) — the instrumented transform of apps/wayvro-mobile/build-tools/perf-eval-transformer.cjs;
 *   5. dex: no expo-dev-launcher / expo-dev-menu implementation classes (the dev-client launcher), only what a release
 *      variant links.
 *
 * Usage: node infra/ci/android/check-release-purity.mjs --aab app-release.aab --bundletool bundletool-all.jar [--report out.json]
 *        node infra/ci/android/check-release-purity.mjs --self-test   (positive + negative controls on fixtures)
 * Exit code 0 = PASS, 1 = FAIL, 2 = usage/tooling error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readZip } from './lib/zip.mjs';

const E2E_RESOURCE = /(^|\/)res\/xml\/wayvro_e2e_network_security/;
const E2E_RESOURCE_NAME = 'wayvro_e2e_network_security';
const PROBE_MARKERS = ['__wayvroPerfEval', 'WayvroPerf eval'];
// Type descriptors of the dev-client launcher / dev menu implementation (present in debug variants only).
const DEV_LAUNCHER_DESCRIPTORS = ['Lexpo/modules/devlauncher/launcher/', 'Lexpo/modules/devmenu/DevMenuManager'];
const LOOPBACK_OR_LAN_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i;

/**
 * Pure check. `input` = { manifest: string, entryNames: string[], appConfig: string | null, bundle: Buffer | null,
 * dex: Buffer[] }. Returns the list of problems (empty = PASS).
 */
export function checkPurity(input) {
  const problems = [];
  if (/android:usesCleartextTraffic\s*=\s*"true"/.test(input.manifest)) problems.push('MANIFEST: android:usesCleartextTraffic="true"');
  if (/android:networkSecurityConfig\s*=/.test(input.manifest)) problems.push('MANIFEST: android:networkSecurityConfig is set (E2E loopback config?)');
  for (const name of input.entryNames) if (E2E_RESOURCE.test(name)) problems.push(`RESOURCE: E2E network security config ${name}`);
  // Resource file paths can be shortened; the resource table still names every resource.
  if ((input.resourceTables ?? []).some((t) => t.includes(Buffer.from(E2E_RESOURCE_NAME, 'utf8'))))
    problems.push(`RESOURCE: resource table names ${E2E_RESOURCE_NAME}`);

  if (input.appConfig === null) problems.push('APP-CONFIG: base/assets/app.config not found (cannot prove the API origin)');
  else {
    let api = {};
    try {
      const parsed = JSON.parse(input.appConfig);
      api = parsed?.extra?.wayvroApi ?? {};
    } catch {
      problems.push('APP-CONFIG: base/assets/app.config is not valid JSON');
    }
    if (Object.hasOwn(api, 'e2eLoopbackPort')) problems.push('APP-CONFIG: E2E marker extra.wayvroApi.e2eLoopbackPort present');
    if (api.devLocalApi === true) problems.push('APP-CONFIG: extra.wayvroApi.devLocalApi is true in a release artefact');
    if (typeof api.baseUrl === 'string' && api.baseUrl !== '') {
      const m = /^([a-z]+):\/\/([^/:]+|\[[^\]]+\])/i.exec(api.baseUrl);
      if (!m || m[1].toLowerCase() !== 'https') problems.push(`APP-CONFIG: API origin is not https (${api.baseUrl})`);
      else if (LOOPBACK_OR_LAN_HOST.test(m[2])) problems.push(`APP-CONFIG: API origin is a loopback/LAN host (${m[2]})`);
    }
  }

  if (input.bundle === null) problems.push('BUNDLE: base/assets/index.android.bundle not found');
  else
    for (const marker of PROBE_MARKERS)
      if (input.bundle.includes(Buffer.from(marker, 'utf8'))) problems.push(`BUNDLE: instrumentation probe "${marker}" present`);

  if (input.dex.length === 0) problems.push('DEX: no classes*.dex found');
  for (const descriptor of DEV_LAUNCHER_DESCRIPTORS)
    if (input.dex.some((d) => d.includes(Buffer.from(descriptor, 'utf8')))) problems.push(`DEX: development launcher class ${descriptor}* linked`);
  return problems;
}

/** Collects the purity inputs from an AAB (bundletool for the merged manifest, ZIP reads for everything else). */
export function purityInputsFromAab(aab, bundletool) {
  const manifest = execFileSync('java', ['-jar', bundletool, 'dump', 'manifest', `--bundle=${aab}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const entries = readZip(readFileSync(aab));
  const find = (name) => entries.find((e) => e.name === name);
  const appConfig = find('base/assets/app.config');
  const bundle = find('base/assets/index.android.bundle');
  return {
    manifest,
    entryNames: entries.map((e) => e.name),
    resourceTables: entries.filter((e) => /^[^/]+\/resources\.pb$/.test(e.name)).map((e) => e.read()),
    appConfig: appConfig ? appConfig.read().toString('utf8') : null,
    bundle: bundle ? bundle.read() : null,
    dex: entries.filter((e) => /^[^/]+\/dex\/classes\d*\.dex$/.test(e.name)).map((e) => e.read()),
  };
}

function selfTest() {
  const manifest = (app = '') =>
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.wayvro.app"><application android:name=".MainApplication" android:allowBackup="false"${app}/></manifest>`;
  const config = (api) => JSON.stringify({ name: 'Wayvro', extra: { wayvroApi: api } });
  const clean = {
    manifest: manifest(),
    entryNames: ['base/manifest/AndroidManifest.xml', 'base/res/xml/file_paths.xml'],
    appConfig: config({ devLocalApi: false }),
    bundle: Buffer.from('hermes-bytecode reportFullyDrawn WayvroFullyDrawn'),
    dex: [Buffer.from('Lexpo/modules/devlauncher/DevLauncherPackageDelegate; Lexpo/modules/kotlin/Module;')],
  };
  const cases = [
    { name: 'clean release shape', input: clean, pass: true },
    { name: 'https origin configured', input: { ...clean, appConfig: config({ baseUrl: 'https://api.example.test', devLocalApi: false }) }, pass: true },
    { name: 'usesCleartextTraffic=true', input: { ...clean, manifest: manifest(' android:usesCleartextTraffic="true"') }, pass: false },
    {
      name: 'network security config attribute',
      input: { ...clean, manifest: manifest(' android:networkSecurityConfig="@xml/wayvro_e2e_network_security"') },
      pass: false,
    },
    {
      name: 'E2E network security resource',
      input: { ...clean, entryNames: [...clean.entryNames, 'base/res/xml/wayvro_e2e_network_security.xml'] },
      pass: false,
    },
    {
      name: 'E2E resource under a shortened path',
      input: { ...clean, resourceTables: [Buffer.from('xml wayvro_e2e_network_security res/D-.xml')] },
      pass: false,
    },
    { name: 'E2E loopback port in app config', input: { ...clean, appConfig: config({ devLocalApi: false, e2eLoopbackPort: 4120 }) }, pass: false },
    { name: 'dev-local fallback enabled', input: { ...clean, appConfig: config({ devLocalApi: true }) }, pass: false },
    { name: 'plain http origin', input: { ...clean, appConfig: config({ baseUrl: 'http://api.example.test' }) }, pass: false },
    { name: 'emulator loopback origin over https', input: { ...clean, appConfig: config({ baseUrl: 'https://10.0.2.2:4120' }) }, pass: false },
    { name: 'missing app config', input: { ...clean, appConfig: null }, pass: false },
    { name: 'instrumentation probe in bundle', input: { ...clean, bundle: Buffer.from('x globalThis.__wayvroPerfEval=1 y') }, pass: false },
    { name: 'probe log line in bundle', input: { ...clean, bundle: Buffer.from('"WayvroPerf eval n="') }, pass: false },
    {
      name: 'dev launcher implementation linked',
      input: { ...clean, dex: [Buffer.from('Lexpo/modules/devlauncher/launcher/DevLauncherController;')] },
      pass: false,
    },
    { name: 'dev menu manager linked', input: { ...clean, dex: [Buffer.from('Lexpo/modules/devmenu/DevMenuManager;')] }, pass: false },
  ];
  let failed = 0;
  for (const c of cases) {
    const problems = checkPurity(c.input);
    const ok = (problems.length === 0) === c.pass;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${problems.length === 0 ? 'no problems' : problems.join(' | ')}`);
  }
  console.log(`RELEASE-PURITY GATE SELF-TEST: ${failed === 0 ? 'PASS' : 'FAIL'} (${String(cases.length)} cases)`);
  return failed === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--self-test') process.exit(selfTest() ? 0 : 1);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '') ?? ''] = argv[i + 1];
  if (!args.aab || !args.bundletool) {
    console.error('usage: --aab <file> --bundletool <jar> [--report <json>] | --self-test');
    process.exit(2);
  }
  const input = purityInputsFromAab(args.aab, args.bundletool);
  const problems = checkPurity(input);
  const report = {
    aab: args.aab,
    checked: {
      manifest: true,
      entries: input.entryNames.length,
      appConfigBytes: input.appConfig?.length ?? null,
      bundleBytes: input.bundle?.length ?? null,
      dexFiles: input.dex.length,
    },
    result: problems.length ? 'FAIL' : 'PASS',
    problems,
  };
  if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 2) + '\n');
  console.log(`entries: ${String(input.entryNames.length)}; dex files: ${String(input.dex.length)}; bundle bytes: ${String(input.bundle?.length ?? 0)}`);
  console.log(`RELEASE-PURITY CHECK: ${report.result}`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(problems.length ? 1 : 0);
}
