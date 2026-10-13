#!/usr/bin/env node
/*
 * Android build for the ONE Wayvro app (ADR-036, Q49, ADR-052). Used identically by local Windows builds and Linux CI.
 *
 *   node scripts/android-build.mjs debug     dev-client debug APK  (ABIs arm64-v8a + x86_64 for devices/emulators)
 *   node scripts/android-build.mjs release   release AAB (ABIs arm64-v8a + armeabi-v7a) + SDK-INV, 16 KB, permission,
 *                                            intent-filter, size, release-purity and bundle-secrets gates
 *   node scripts/android-build.mjs e2e [--abis x86_64[,arm64-v8a]]
 *                                            SP-08 E2E variant (ADR-052): release-mode JS (embedded minified Hermes
 *                                            bundle, no Metro, no dev launcher), the release plugins/permissions,
 *                                            debug-key signed APK; API origin = the emulator loopback 10.0.2.2:<port>
 *                                            (WAYVRO_E2E_API_PORT, default 4120) with cleartext permitted to that host
 *                                            only, and the SP-02 §6.2 instrumented driver-module evaluation probe
 *
 * JDK 17 is mandatory regardless of the machine default (CLAUDE.md §9): the script uses WAYVRO_JDK17_HOME if set,
 * otherwise JAVA_HOME, and refuses to run unless that JDK reports major version 17.
 * Release-only inputs: BUNDLETOOL_JAR (path to bundletool-all-<version>.jar). ANDROID_HOME must point to the SDK.
 * The release AAB and the E2E APK are signed with the generated DEBUG keystore: neither is an upload artefact.
 * `release` refuses to run while an E2E/instrumentation variable is set, and its release-purity gate proves the AAB
 * carries no E2E marker, cleartext permission, loopback origin, instrumentation probe or dev-client launcher.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../infra/ci/android/lib/zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'wayvro-mobile');
const ANDROID = join(APP, 'android');
const REPORTS = join(APP, 'build-reports');
const E2E_REPORTS = join(REPORTS, 'e2e');
const WINDOWS = process.platform === 'win32';
const MODE = process.argv[2];
const ABIS = { debug: 'arm64-v8a,x86_64', release: 'arm64-v8a,armeabi-v7a', e2e: 'x86_64' };
const E2E_ALLOWED_ABIS = new Set(['x86_64', 'arm64-v8a']);
// Variables that turn a build into the E2E / instrumented variant (app.config.ts, metro.config.cjs).
const E2E_VARIABLES = ['WAYVRO_E2E_API_PORT', 'WAYVRO_PERF_INSTRUMENT'];

function fail(message) {
  console.error(`android-build: ${message}`);
  process.exit(1);
}
if (MODE !== 'debug' && MODE !== 'release' && MODE !== 'e2e') fail('usage: node scripts/android-build.mjs <debug|release|e2e> [--abis x86_64[,arm64-v8a]]');

const abiArg = process.argv.indexOf('--abis');
if (abiArg > 0 && MODE !== 'e2e') fail('--abis is only accepted in e2e mode (debug/release ABI sets are fixed by Q49)');
const abis = abiArg > 0 ? (process.argv[abiArg + 1] ?? '') : ABIS[MODE];
if (MODE === 'e2e' && (abis === '' || !abis.split(',').every((a) => E2E_ALLOWED_ABIS.has(a)))) fail('e2e --abis must list x86_64 and/or arm64-v8a');

if (MODE !== 'e2e') {
  const set = E2E_VARIABLES.filter((v) => (process.env[v] ?? '') !== '');
  if (set.length > 0) fail(`${MODE} mode refuses to build while ${set.join(', ')} is set (E2E/instrumented variant markers)`);
}
if (MODE === 'e2e' && (process.env.WAYVRO_API_URL ?? '').trim() !== '') fail('e2e mode refuses WAYVRO_API_URL (the E2E origin is the emulator loopback only)');
const e2ePort = process.env.WAYVRO_E2E_API_PORT ?? '4120';
if (MODE === 'e2e' && !/^[1-9][0-9]{3,4}$/.test(e2ePort)) fail('WAYVRO_E2E_API_PORT must be a port number');

const javaHome = process.env.WAYVRO_JDK17_HOME ?? process.env.JAVA_HOME;
if (!javaHome) fail('set WAYVRO_JDK17_HOME (or JAVA_HOME) to a JDK 17 installation');
const javaBin = join(javaHome, 'bin', WINDOWS ? 'java.exe' : 'java');
const versionOutput = spawnSync(javaBin, ['-version'], { encoding: 'utf8' }).stderr ?? '';
const major = /version "(\d+)/.exec(versionOutput)?.[1];
if (major !== '17') fail(`JDK 17 required for Gradle/Android builds, but ${javaBin} reports: ${versionOutput.split('\n')[0] ?? 'nothing'}`);
const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!androidHome || !existsSync(androidHome)) fail('set ANDROID_HOME to the Android SDK');

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  CI: '1',
  PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
  ...(MODE === 'e2e' ? { WAYVRO_E2E_API_PORT: e2ePort, WAYVRO_PERF_INSTRUMENT: '1' } : {}),
};
const run = (cmd, args, cwd) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  // Windows .cmd/.bat wrappers (npx, gradlew.bat) need cmd.exe; invoke it explicitly instead of `shell: true` (DEP0190).
  // All arguments here are constants defined in this script.
  const r = WINDOWS
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', cmd, ...args], { cwd, env, stdio: 'inherit' })
    : spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (r.status !== 0) fail(`${cmd} exited with ${String(r.status)}`);
};
const buildToolsBinary = (name) => {
  const buildTools = join(androidHome, 'build-tools');
  const latest = readdirSync(buildTools)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .pop();
  const bin = latest ? join(buildTools, latest, WINDOWS ? `${name}.exe` : name) : undefined;
  return bin && existsSync(bin) ? bin : undefined;
};
const gateScript = (script) => join(ROOT, 'infra', 'ci', 'android', script);
const gate = (script, extra) => {
  console.log(`\n$ node ${script} ${extra.join(' ')}`);
  execFileSync(process.execPath, [gateScript(script), ...extra], { env, stdio: 'inherit' });
};

const started = Date.now();
console.log(`android-build: mode=${MODE} jdk=${versionOutput.split('\n')[0]?.trim() ?? ''} sdk=${androidHome} abis=${abis}`);
if (MODE === 'release') {
  mkdirSync(REPORTS, { recursive: true });
  // U04 (fail fast, before Gradle): every runtime dependency and autolinked native module is approved in the inventory.
  gate('check-sdk-inventory.mjs', ['--report', join(REPORTS, 'sdk-inventory-report.json')]);
}
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], APP);
const task = { debug: 'assembleDebug', release: 'bundleRelease', e2e: 'assembleRelease' }[MODE];
run(join(ANDROID, WINDOWS ? 'gradlew.bat' : 'gradlew'), ['--no-daemon', task, `-PreactNativeArchitectures=${abis}`], ANDROID);
const gradleSeconds = Math.round((Date.now() - started) / 1000);

if (MODE === 'release') {
  const aab = join(ANDROID, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  if (!existsSync(aab)) fail(`release bundle not found at ${aab}`);
  const bundletool = process.env.BUNDLETOOL_JAR;
  if (!bundletool || !existsSync(bundletool)) fail('set BUNDLETOOL_JAR to bundletool-all-<version>.jar for the release gates');
  const zipalign = buildToolsBinary('zipalign');
  const aabGate = (script, extra) => gate(script, ['--aab', aab, '--bundletool', bundletool, ...extra]);
  aabGate('check-16kb.mjs', ['--expect-abis', ABIS.release, ...(zipalign ? ['--zipalign', zipalign] : []), '--report', join(REPORTS, '16kb-report.json')]);
  aabGate('check-permissions.mjs', ['--report', join(REPORTS, 'permissions-report.json')]);
  // F-P3-01: no external URL scheme / app link and only allowlisted exported components in the release artefact.
  aabGate('check-intent-filters.mjs', ['--report', join(REPORTS, 'intent-filters-report.json')]);
  // PB-04/PB-05 (FA-07): failing download-size and Hermes-bundle budgets.
  aabGate('check-size.mjs', ['--report', join(REPORTS, 'size-report.json')]);
  // ADR-052 / F-P3-07: no E2E marker, cleartext, loopback origin, instrumentation probe or dev-client launcher.
  aabGate('check-release-purity.mjs', ['--report', join(REPORTS, 'release-purity-report.json')]);
  // FA-06: no provider key shapes, server geo env names or unlisted vendor tile/style hosts in the bundle or the AAB.
  gate('check-bundle-secrets.mjs', ['--aab', aab, '--report', join(REPORTS, 'bundle-secrets-report.json')]);
  // Keep the gated AAB outside android/: a later `prebuild --clean` (e.g. the debug build) deletes that directory.
  copyFileSync(aab, join(REPORTS, 'app-release.aab'));
  console.log(`\nandroid-build: release AAB ${aab} passed every release gate in ${String(Math.round((Date.now() - started) / 1000))} s (copied to ${REPORTS})`);
} else {
  const variant = MODE === 'debug' ? 'debug' : 'release';
  const apk = join(ANDROID, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
  if (!existsSync(apk)) fail(`APK not found at ${apk}`);
  // aapt2 prints the merged binary manifest of the APK.
  const aapt2 = buildToolsBinary('aapt2');
  if (!aapt2) fail(`aapt2 not found under ${join(androidHome, 'build-tools')}`);
  const manifest = execFileSync(aapt2, ['dump', 'xmltree', apk, '--file', 'AndroidManifest.xml'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const devScheme = /android:scheme\(0x[0-9a-f]+\)="exp\+wayvro"/.test(manifest);
  if (MODE === 'debug') {
    // F-P3-01 positive control: the development build must keep the expo-dev-client launch scheme (the release gate
    // proves its absence from the AAB).
    if (!devScheme) fail('development APK lost the expo-dev-client exp+wayvro scheme (dev launcher path)');
    console.log(`\nandroid-build: debug APK at ${apk} (development launch scheme exp+wayvro present)`);
  } else {
    // Positive controls: the artefact IS the E2E variant (so the release-purity gate's markers are the right ones) and
    // it is release-like (no dev-client scheme, no launcher, embedded Hermes bundle).
    const entries = readZip(readFileSync(apk));
    const read = (name) => entries.find((e) => e.name === name)?.read();
    const bundle = read('assets/index.android.bundle');
    const appConfig = read('assets/app.config')?.toString('utf8') ?? '';
    const dex = entries.filter((e) => /^classes\d*\.dex$/.test(e.name)).map((e) => e.read());
    // Release-variant APKs shorten resource file paths (res/xml/<name>.xml → res/<id>.xml): look the name up in the table.
    const resources = execFileSync(aapt2, ['dump', 'resources', apk], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const checks = {
      networkSecurityConfig: /android:networkSecurityConfig\(0x[0-9a-f]+\)=@/.test(manifest),
      e2eNetworkResource: /\bxml\/wayvro_e2e_network_security\b/.test(resources),
      e2eLoopbackPort: JSON.parse(appConfig === '' ? '{}' : appConfig)?.extra?.wayvroApi?.e2eLoopbackPort === Number(e2ePort),
      embeddedHermesBundle: bundle !== undefined && bundle.subarray(0, 8).readBigUInt64LE(0) === 0x1f1903c103bc1fc6n,
      instrumentationProbe: bundle !== undefined && bundle.includes(Buffer.from('__wayvroPerfEval')),
      noDevClientScheme: !devScheme,
      noDevLauncherImplementation: !dex.some((d) => d.includes(Buffer.from('Lexpo/modules/devlauncher/launcher/'))),
      abis: [...new Set(entries.map((e) => /^lib\/([^/]+)\//.exec(e.name)?.[1]).filter(Boolean))].sort().join(','),
    };
    const failed = Object.entries(checks).filter(([k, v]) => k !== 'abis' && v !== true);
    if (checks.abis !== abis.split(',').sort().join(',')) failed.push(['abis', checks.abis]);
    mkdirSync(E2E_REPORTS, { recursive: true });
    const out = join(E2E_REPORTS, 'wayvro-e2e.apk');
    copyFileSync(apk, out);
    const report = {
      variant: 'SP-08 E2E (ADR-052) — NOT a release artefact',
      apk: out,
      apkBytes: readFileSync(apk).length,
      abis,
      apiOrigin: `http://10.0.2.2:${e2ePort}`,
      checks,
      buildSeconds: gradleSeconds,
      result: failed.length ? 'FAIL' : 'PASS',
    };
    writeFileSync(join(E2E_REPORTS, 'e2e-build-report.json'), JSON.stringify(report, null, 2) + '\n');
    for (const [k, v] of Object.entries(checks)) console.log(`  ${k}: ${String(v)}`);
    if (failed.length) fail(`E2E APK self-check failed: ${failed.map(([k]) => k).join(', ')}`);
    console.log(`\nandroid-build: E2E APK ${out} (${String(report.apkBytes)} B, ${abis}, origin ${report.apiOrigin}) built in ${String(gradleSeconds)} s`);
  }
}
