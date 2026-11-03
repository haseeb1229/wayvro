#!/usr/bin/env node
/*
 * Wayvro Android release-manifest permission gate (GR-10 / Q49 / CLAUDE.md §9). Node >= 18, no npm dependencies.
 * Dumps the merged base manifest of an AAB with bundletool and compares every <uses-permission*> against
 * infra/ci/android/permission-allowlist.json. Any unlisted or explicitly forbidden permission fails.
 *
 * Usage: node infra/ci/android/check-permissions.mjs --aab app-release.aab --bundletool bundletool-all.jar [--report out.json]
 *
 * Optional `--policy <json>` replaces the default allowlist file with another one of the same shape. It exists ONLY for
 * disposable spike artefacts (tests/spikes/sp-01-background-location/spike-permission-allowlist.json); the release AAB
 * of the one Wayvro app is always checked with the default file (scripts/android-build.mjs and CI never pass it).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '') ?? ''] = argv[i + 1];
if (!args.aab || !args.bundletool) {
  console.error('usage: --aab <file> --bundletool <jar> [--report <json>]');
  process.exit(2);
}

const policyPath = args.policy ?? join(dirname(fileURLToPath(import.meta.url)), 'permission-allowlist.json');
if (args.policy) console.log(`policy: ${args.policy}`);
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const dump = (xpath) =>
  execFileSync('java', ['-jar', args.bundletool, 'dump', 'manifest', `--bundle=${args.aab}`, ...(xpath ? [`--xpath=${xpath}`] : [])], {
    encoding: 'utf8',
  });

const manifest = dump();
const applicationId = /<manifest[^>]*\spackage="([^"]+)"/.exec(manifest)?.[1];
if (!applicationId) {
  console.error('could not read package name from manifest');
  process.exit(2);
}
const declared = [...manifest.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*android:name="([^"]+)"/g)].map((m) => m[1]).sort();
const sub = (n) => n.replace('${applicationId}', applicationId);
const allowed = new Map(policy.allowed.map((p) => [sub(p.name), p.justification]));
const forbidden = new Map(policy.forbidden.map((p) => [sub(p.name), p.reason]));

const problems = [];
for (const p of declared) {
  if (forbidden.has(p)) problems.push(`FORBIDDEN ${p}: ${forbidden.get(p)}`);
  else if (!allowed.has(p)) problems.push(`UNLISTED ${p}: add to permission-allowlist.json with justification or remove it`);
}
const debuggable = /android:debuggable="true"/.test(manifest);
if (debuggable) problems.push('release manifest is debuggable');

const report = { applicationId, declared, debuggable, result: problems.length ? 'FAIL' : 'PASS', problems };
if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 2) + '\n');
console.log(`package: ${applicationId}`);
console.log(`declared permissions (${declared.length}):\n  ${declared.join('\n  ') || '(none)'}`);
console.log(`PERMISSION CHECK: ${report.result}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length ? 1 : 0);
