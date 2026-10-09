#!/usr/bin/env node
/*
 * Android build for the ONE Wayvro app (ADR-036, Q49). Used identically by local Windows builds and Linux CI.
 *
 *   node scripts/android-build.mjs debug     dev-client debug APK  (ABIs arm64-v8a + x86_64 for devices/emulators)
 *   node scripts/android-build.mjs release   release AAB (ABIs arm64-v8a + armeabi-v7a) + 16 KB + permission gates
 *
 * JDK 17 is mandatory regardless of the machine default (CLAUDE.md §9): the script uses WAYVRO_JDK17_HOME if set,
 * otherwise JAVA_HOME, and refuses to run unless that JDK reports major version 17.
 * Release-only inputs: BUNDLETOOL_JAR (path to bundletool-all-<version>.jar). ANDROID_HOME must point to the SDK.
 * The release AAB is signed with the generated DEBUG keystore: it proves the build, it is NOT an upload artefact.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'wayvro-mobile');
const ANDROID = join(APP, 'android');
const REPORTS = join(APP, 'build-reports');
const WINDOWS = process.platform === 'win32';
const MODE = process.argv[2];
const ABIS = { debug: 'arm64-v8a,x86_64', release: 'arm64-v8a,armeabi-v7a' };

function fail(message) {
  console.error(`android-build: ${message}`);
  process.exit(1);
}
if (MODE !== 'debug' && MODE !== 'release') fail('usage: node scripts/android-build.mjs <debug|release>');

const javaHome = process.env.WAYVRO_JDK17_HOME ?? process.env.JAVA_HOME;
if (!javaHome) fail('set WAYVRO_JDK17_HOME (or JAVA_HOME) to a JDK 17 installation');
const javaBin = join(javaHome, 'bin', WINDOWS ? 'java.exe' : 'java');
const versionOutput = spawnSync(javaBin, ['-version'], { encoding: 'utf8' }).stderr ?? '';
const major = /version "(\d+)/.exec(versionOutput)?.[1];
if (major !== '17') fail(`JDK 17 required for Gradle/Android builds, but ${javaBin} reports: ${versionOutput.split('\n')[0] ?? 'nothing'}`);
const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!androidHome || !existsSync(androidHome)) fail('set ANDROID_HOME to the Android SDK');

const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome, CI: '1', PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH ?? ''}` };
const run = (cmd, args, cwd) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  // Windows .cmd/.bat wrappers (npx, gradlew.bat) need cmd.exe; invoke it explicitly instead of `shell: true` (DEP0190).
  // All arguments here are constants defined in this script.
  const r = WINDOWS
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', cmd, ...args], { cwd, env, stdio: 'inherit' })
    : spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (r.status !== 0) fail(`${cmd} exited with ${String(r.status)}`);
};

console.log(`android-build: mode=${MODE} jdk=${versionOutput.split('\n')[0]?.trim() ?? ''} sdk=${androidHome} abis=${ABIS[MODE]}`);
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], APP);
const task = MODE === 'debug' ? 'assembleDebug' : 'bundleRelease';
run(join(ANDROID, WINDOWS ? 'gradlew.bat' : 'gradlew'), ['--no-daemon', task, `-PreactNativeArchitectures=${ABIS[MODE]}`], ANDROID);

if (MODE === 'release') {
  const aab = join(ANDROID, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  if (!existsSync(aab)) fail(`release bundle not found at ${aab}`);
  const bundletool = process.env.BUNDLETOOL_JAR;
  if (!bundletool || !existsSync(bundletool)) fail('set BUNDLETOOL_JAR to bundletool-all-<version>.jar for the release gates');
  const buildTools = join(androidHome, 'build-tools');
  const latest = readdirSync(buildTools)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .pop();
  const zipalign = latest ? join(buildTools, latest, WINDOWS ? 'zipalign.exe' : 'zipalign') : undefined;
  mkdirSync(REPORTS, { recursive: true });
  const gate = (script, extra) => {
    console.log(`\n$ node ${script}`);
    execFileSync(process.execPath, [join(ROOT, 'infra', 'ci', 'android', script), '--aab', aab, '--bundletool', bundletool, ...extra], {
      env,
      stdio: 'inherit',
    });
  };
  gate('check-16kb.mjs', [
    '--expect-abis',
    ABIS.release,
    ...(zipalign && existsSync(zipalign) ? ['--zipalign', zipalign] : []),
    '--report',
    join(REPORTS, '16kb-report.json'),
  ]);
  gate('check-permissions.mjs', ['--report', join(REPORTS, 'permissions-report.json')]);
  console.log(`\nandroid-build: release AAB ${aab} passed the 16 KB and permission gates`);
} else {
  console.log(`\nandroid-build: debug APK at ${join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')}`);
}
