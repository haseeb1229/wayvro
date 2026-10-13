#!/usr/bin/env node
/*
 * Wayvro SDK-INV gate (U04; PHASE3_SDK_PRIVACY_INVENTORY §1 rules 2–3 and §8; PHASE3_TEST_STRATEGY §4.11). Node >= 18,
 * no npm dependencies. Every runtime dependency of apps/wayvro-mobile/package.json and every native module the Android
 * build autolinks (Expo modules AND React Native community packages, direct or transitive — resolved with the same
 * expo-modules-autolinking CLI the Gradle build uses) must have a row in infra/ci/android/sdk-inventory.json, the
 * machine-readable companion of docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md, with:
 *   - status APPROVED or APPROVED-EXISTING (PROPOSED / CANDIDATE / CONDITIONAL / DEV-ONLY / EXCLUDED fail), and
 *   - exactly the resolved version (drift needs an inventory change in the same PR — the reviewer sees both).
 * Rows that no longer match any dependency or module are reported as STALE (warning; the inventory is regenerated at
 * P3.7 and P3.10, where stale rows are removed).
 *
 * Usage: node infra/ci/android/check-sdk-inventory.mjs [--report out.json]
 *        node infra/ci/android/check-sdk-inventory.mjs --self-test
 * Exit code 0 = PASS, 1 = FAIL, 2 = usage/tooling error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const APP = join(ROOT, 'apps', 'wayvro-mobile');
const RELEASE_STATUSES = new Set(['APPROVED', 'APPROVED-EXISTING']);

/**
 * Pure evaluation. `subjects` = [{ name, version, kinds: Set<'runtime-dependency'|'autolinked-expo'|'autolinked-rn'> }].
 * Returns { problems, stale, rows }.
 */
export function evaluateInventory(subjects, inventory) {
  const problems = [];
  const rows = [];
  for (const s of subjects) {
    const row = inventory.packages[s.name];
    const kinds = [...s.kinds].sort();
    if (!row) {
      problems.push(`UNLISTED ${s.name}@${s.version} (${kinds.join(', ')}): no inventory row`);
      rows.push({ ...s, kinds, result: 'FAIL' });
      continue;
    }
    const issues = [];
    if (!RELEASE_STATUSES.has(row.status)) issues.push(`status ${String(row.status)} is not approved for a release build`);
    if (row.version !== s.version) issues.push(`version ${s.version} != inventory ${String(row.version)}`);
    for (const p of issues) problems.push(`${s.name}: ${p}`);
    rows.push({ ...s, kinds, status: row.status, inventoryVersion: row.version, result: issues.length ? 'FAIL' : 'PASS' });
  }
  const seen = new Set(subjects.map((s) => s.name));
  const stale = Object.keys(inventory.packages).filter((name) => !seen.has(name));
  return { problems, stale, rows };
}

/** Runtime dependencies of the app + Android autolinking resolution (Expo modules and RN community packages). */
function resolveSubjects() {
  const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
  const appRequire = createRequire(join(APP, 'package.json'));
  const versionOf = (name) => {
    const spec = pkg.dependencies?.[name] ?? '';
    if (spec.startsWith('workspace:')) return 'workspace';
    return JSON.parse(readFileSync(appRequire.resolve(`${name}/package.json`), 'utf8')).version;
  };
  const subjects = new Map();
  const add = (name, version, kind) => {
    const s = subjects.get(name) ?? { name, version, kinds: new Set() };
    s.kinds.add(kind);
    subjects.set(name, s);
  };
  for (const name of Object.keys(pkg.dependencies ?? {})) add(name, versionOf(name), 'runtime-dependency');
  const cli = join(dirname(appRequire.resolve('expo-modules-autolinking/package.json')), 'bin', 'expo-modules-autolinking.js');
  const run = (args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: APP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  for (const m of run(['resolve', '-p', 'android', '--json']).modules)
    add(m.packageName, m.packageVersion === '' ? 'local' : m.packageVersion, 'autolinked-expo');
  for (const [name, dep] of Object.entries(run(['react-native-config', '-p', 'android', '--json']).dependencies)) {
    if (!dep.platforms?.android) continue;
    add(name, JSON.parse(readFileSync(join(dep.root, 'package.json'), 'utf8')).version, 'autolinked-rn');
  }
  return [...subjects.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function selfTest() {
  const inventory = {
    packages: {
      expo: { version: '57.0.27', status: 'APPROVED-EXISTING' },
      'expo-location': { version: '57.0.20', status: 'APPROVED' },
      '@rnmapbox/maps': { version: '10.3.7', status: 'CANDIDATE' },
      'gone-package': { version: '1.0.0', status: 'APPROVED' },
    },
  };
  const s = (name, version, kind = 'runtime-dependency') => ({ name, version, kinds: new Set([kind]) });
  const cases = [
    { name: 'approved set', subjects: [s('expo', '57.0.27'), s('expo-location', '57.0.20', 'autolinked-expo')], pass: true },
    { name: 'unlisted transitive native module', subjects: [s('expo', '57.0.27'), s('react-native-sneaky-analytics', '1.0.0', 'autolinked-rn')], pass: false },
    { name: 'version drift', subjects: [s('expo', '57.0.28')], pass: false },
    { name: 'candidate (not approved) SDK present', subjects: [s('@rnmapbox/maps', '10.3.7')], pass: false },
  ];
  let failed = 0;
  for (const c of cases) {
    const { problems } = evaluateInventory(c.subjects, inventory);
    const ok = (problems.length === 0) === c.pass;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${problems.length === 0 ? 'no problems' : problems.join(' | ')}`);
  }
  const { stale } = evaluateInventory([s('expo', '57.0.27')], inventory);
  const staleOk = stale.includes('gone-package');
  if (!staleOk) failed += 1;
  console.log(`${staleOk ? 'ok  ' : 'FAIL'} stale row reported: ${stale.join(', ')}`);
  console.log(`SDK-INV GATE SELF-TEST: ${failed === 0 ? 'PASS' : 'FAIL'} (${String(cases.length + 1)} cases)`);
  return failed === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--self-test') process.exit(selfTest() ? 0 : 1);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '') ?? ''] = argv[i + 1];
  const inventory = JSON.parse(readFileSync(join(HERE, 'sdk-inventory.json'), 'utf8'));
  const subjects = resolveSubjects();
  const { problems, stale, rows } = evaluateInventory(subjects, inventory);
  const report = { inventory: 'infra/ci/android/sdk-inventory.json', subjects: rows.length, rows, stale, result: problems.length ? 'FAIL' : 'PASS', problems };
  if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 2) + '\n');
  console.log(`runtime dependencies + autolinked native modules checked: ${String(rows.length)}`);
  for (const r of rows) console.log(`  ${r.result === 'PASS' ? 'ok  ' : 'FAIL'} ${r.name}@${r.version} [${r.kinds.join(', ')}] ${r.status ?? 'UNLISTED'}`);
  for (const name of stale) console.log(`  warning: STALE inventory row ${name} (no matching dependency/module; remove at the next regeneration)`);
  console.log(`SDK-INV CHECK: ${report.result}`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(problems.length ? 1 : 0);
}
