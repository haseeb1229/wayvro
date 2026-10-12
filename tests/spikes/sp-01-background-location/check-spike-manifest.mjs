#!/usr/bin/env node
/*
 * SP-01 compliance check (protocol TC-21, R8). Node >= 18, no dependencies.
 *
 * Artefact mode (evidence):
 *   node tests/spikes/sp-01-background-location/check-spike-manifest.mjs --aab <spike .aab> --bundletool <jar> [--report out.json]
 *   1. runs infra/ci/android/check-permissions.mjs with --policy spike-permission-allowlist.json (fails on
 *      USE_FULL_SCREEN_INTENT, RECEIVE_BOOT_COMPLETED and every unlisted permission);
 *   2. checks the merged manifest: package dev.wayvro.spike.sp01, not debuggable, every foreground service is type
 *      `location` and at least one exists, no boot/package-replaced/push receivers, no URL scheme.
 *
 * Source mode (pre-build sanity only, NOT evidence — library manifests are merged later by Gradle):
 *   node tests/spikes/sp-01-background-location/check-spike-manifest.mjs --manifest android/app/src/main/AndroidManifest.xml
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PACKAGE = 'dev.wayvro.spike.sp01';
const POLICY = join(HERE, 'spike-permission-allowlist.json');
const FORBIDDEN_ACTIONS = [
  'android.intent.action.BOOT_COMPLETED',
  'android.intent.action.LOCKED_BOOT_COMPLETED',
  'android.intent.action.QUICKBOOT_POWERON',
  'android.intent.action.MY_PACKAGE_REPLACED',
  'com.google.firebase.MESSAGING_EVENT',
  'com.google.android.c2dm.intent.RECEIVE',
];

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '') ?? ''] = argv[i + 1];
const artefactMode = Boolean(args.aab && args.bundletool);
if (!artefactMode && !args.manifest) {
  console.error('usage: --aab <file> --bundletool <jar> [--report <json>]   |   --manifest <AndroidManifest.xml>');
  process.exit(2);
}

const problems = [];
let manifest;
let permissionResult = 'NOT RUN';
if (artefactMode) {
  const perm = spawnSync(
    process.execPath,
    [join(ROOT, 'infra', 'ci', 'android', 'check-permissions.mjs'), '--aab', args.aab, '--bundletool', args.bundletool, '--policy', POLICY],
    { encoding: 'utf8' },
  );
  process.stdout.write(perm.stdout ?? '');
  process.stderr.write(perm.stderr ?? '');
  permissionResult = perm.status === 0 ? 'PASS' : 'FAIL';
  if (perm.status !== 0) problems.push('spike permission policy check failed (see above)');
  manifest = execFileSync('java', ['-jar', args.bundletool, 'dump', 'manifest', `--bundle=${args.aab}`], { encoding: 'utf8' });
  const pkg = /<manifest[^>]*\spackage="([^"]+)"/.exec(manifest)?.[1];
  if (pkg !== PACKAGE) problems.push(`package is ${pkg ?? '(none)'}, expected ${PACKAGE}`);
  if (/android:debuggable="true"/.test(manifest)) problems.push('artefact is debuggable');
} else {
  manifest = readFileSync(args.manifest, 'utf8');
  // Source mode: compute the declared set the way the merger will see this file (tools:node="remove" lines drop out).
  const declared = [...manifest.matchAll(/<uses-permission(?:-sdk-23)?\b([^>]*)>/g)]
    .filter((m) => !/tools:node="remove"/.test(m[1]))
    .map((m) => /android:name="([^"]+)"/.exec(m[1])?.[1])
    .filter(Boolean)
    .sort();
  const policy = JSON.parse(readFileSync(POLICY, 'utf8'));
  const sub = (n) => n.replace('${applicationId}', PACKAGE);
  const allowed = new Set(policy.allowed.map((p) => sub(p.name)));
  const forbidden = new Set(policy.forbidden.map((p) => sub(p.name)));
  for (const p of declared) {
    if (forbidden.has(p)) problems.push(`FORBIDDEN ${p}`);
    else if (!allowed.has(p)) problems.push(`UNLISTED ${p}`);
  }
  permissionResult = problems.length ? 'FAIL' : 'PASS (source manifest only)';
  console.log(`declared permissions in source manifest (${declared.length}):\n  ${declared.join('\n  ')}`);
}

if (/android\.permission\.USE_FULL_SCREEN_INTENT"(?![^>]*tools:node="remove")/.test(manifest)) problems.push('USE_FULL_SCREEN_INTENT present');
for (const action of FORBIDDEN_ACTIONS) if (manifest.includes(`"${action}"`)) problems.push(`forbidden receiver action ${action}`);
const fgsTypes = [...manifest.matchAll(/android:foregroundServiceType="([^"]+)"/g)].map((m) => m[1]);
for (const t of fgsTypes)
  if (t !== 'location' && t !== '8' && t !== '0x8' && t !== '0x00000008') problems.push(`foreground service type ${t} (only location is allowed)`);
if (artefactMode && fgsTypes.length === 0) problems.push('no foreground service of type location found (expo-location LocationTaskService missing?)');
const schemes = [...manifest.matchAll(/android:scheme="([^"]+)"/g)].map((m) => m[1]).filter((s) => s !== 'https');
if (schemes.length) problems.push(`URL scheme(s) declared: ${schemes.join(', ')}`);
const exported = [...manifest.matchAll(/<(activity|service|receiver|provider)\b[^>]*android:exported="true"[^>]*>/g)].map(
  (m) => `${m[1]} ${/android:name="([^"]+)"/.exec(m[0])?.[1] ?? '?'}`,
);

const result = problems.length ? 'FAIL' : 'PASS';
const report = {
  mode: artefactMode ? 'artefact' : 'source-manifest (not evidence)',
  package: PACKAGE,
  permissionCheck: permissionResult,
  foregroundServiceTypes: fgsTypes,
  exportedComponents: exported,
  result,
  problems,
};
if (args.report) writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
console.log(`foreground service types: ${fgsTypes.join(', ') || '(none in this manifest)'}`);
console.log(`exported components (informational): ${exported.join('; ') || '(none)'}`);
console.log(`SP-01 MANIFEST CHECK (${report.mode}): ${result}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length ? 1 : 0);
