#!/usr/bin/env node
/*
 * Wayvro Android download-size + Hermes-bundle gate (PB-04 / PB-05; FA-07 APPROVED pre-measurement budgets;
 * PHASE3_TEST_STRATEGY §4.12; PHASE3_PERFORMANCE_BUDGETS §3.1). Node >= 18, no npm dependencies.
 *
 *   - Play download size per ABI = bundletool `get-size total --dimensions=ABI`, MAX column (1 MB = 1,000,000 B,
 *     ADR-043). FAIL when arm64-v8a > 30.0 MB or armeabi-v7a > 29.0 MB, or when either ABI row is missing.
 *   - Hermes JS bundle = uncompressed size of base/assets/index.android.bundle in the AAB. FAIL when > 4.5 MB.
 * Budgets are fixed (never tuned to a measurement); a change > +1.5 MB against the ADR-043 baseline is reported for the
 * PR's written justification but does not fail by itself.
 *
 * Usage: node infra/ci/android/check-size.mjs --aab app-release.aab --bundletool bundletool-all.jar [--report size-report.json]
 *        node infra/ci/android/check-size.mjs --self-test
 * Exit code 0 = PASS, 1 = FAIL, 2 = usage/tooling error.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './lib/zip.mjs';

const MB = 1_000_000;
export const BUDGETS = { abiMax: { 'arm64-v8a': 30.0 * MB, 'armeabi-v7a': 29.0 * MB }, hermesBundle: 4.5 * MB, justifyDelta: 1.5 * MB };
// ADR-043 P2.8 build-time baseline (get-size MAX; JS bundle) — reference for the +1.5 MB justification note only.
const BASELINE = { abiMax: { 'arm64-v8a': 25_651_727, 'armeabi-v7a': 24_909_619 }, hermesBundle: 3_321_764, source: 'ADR-043 P2.8 (2026-10-11)' };

/** Parses `bundletool get-size total --dimensions=ABI` CSV output into { abi: { min, max } }. */
export function parseGetSize(csv) {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const header = (lines.shift() ?? '').split(',');
  const iAbi = header.indexOf('ABI');
  const iMin = header.indexOf('MIN');
  const iMax = header.indexOf('MAX');
  if (iAbi < 0 || iMin < 0 || iMax < 0) throw new Error(`unexpected get-size header: ${header.join(',')}`);
  const out = {};
  for (const line of lines) {
    const cols = line.split(',');
    out[cols[iAbi]] = { min: Number(cols[iMin]), max: Number(cols[iMax]) };
  }
  return out;
}

/** Pure evaluation of measured sizes against the fixed budgets. */
export function evaluateSizes(perAbi, hermesBundleBytes) {
  const problems = [];
  const notes = [];
  const abis = {};
  for (const [abi, budget] of Object.entries(BUDGETS.abiMax)) {
    const row = perAbi[abi];
    if (!row || !Number.isFinite(row.max)) {
      problems.push(`${abi}: no get-size row (ABI missing from the bundle)`);
      continue;
    }
    const delta = row.max - BASELINE.abiMax[abi];
    abis[abi] = {
      minBytes: row.min,
      maxBytes: row.max,
      budgetBytes: budget,
      baselineMaxBytes: BASELINE.abiMax[abi],
      deltaVsBaselineBytes: delta,
      result: row.max > budget ? 'FAIL' : 'PASS',
    };
    if (row.max > budget) problems.push(`${abi}: download MAX ${row.max} B > budget ${budget} B`);
    if (delta > BUDGETS.justifyDelta) notes.push(`${abi}: +${delta} B vs ${BASELINE.source} baseline (> 1.5 MB: the PR needs a written justification)`);
  }
  const hermes = { bytes: hermesBundleBytes, budgetBytes: BUDGETS.hermesBundle, baselineBytes: BASELINE.hermesBundle, result: 'FAIL' };
  if (!Number.isFinite(hermesBundleBytes)) problems.push('Hermes bundle base/assets/index.android.bundle not found');
  else {
    hermes.result = hermesBundleBytes > BUDGETS.hermesBundle ? 'FAIL' : 'PASS';
    if (hermesBundleBytes > BUDGETS.hermesBundle) problems.push(`Hermes bundle ${hermesBundleBytes} B > budget ${BUDGETS.hermesBundle} B`);
    if (hermesBundleBytes - BASELINE.hermesBundle > BUDGETS.justifyDelta)
      notes.push(`Hermes bundle +${hermesBundleBytes - BASELINE.hermesBundle} B vs baseline (> 1.5 MB)`);
  }
  return { abis, hermesBundle: hermes, problems, notes };
}

function selfTest() {
  const csv = (a, b) => `ABI,MIN,MAX\narm64-v8a,${a - 1000},${a}\narmeabi-v7a,${b - 1000},${b}\n`;
  const cases = [
    { name: 'baseline sizes', csv: csv(25_651_727, 24_909_619), hermes: 3_321_764, pass: true },
    { name: 'exactly at budget', csv: csv(30_000_000, 29_000_000), hermes: 4_500_000, pass: true },
    { name: 'arm64-v8a 1 B over budget', csv: csv(30_000_001, 24_909_619), hermes: 3_321_764, pass: false },
    { name: 'armeabi-v7a over budget', csv: csv(25_651_727, 29_000_001), hermes: 3_321_764, pass: false },
    { name: 'Hermes bundle over budget', csv: csv(25_651_727, 24_909_619), hermes: 4_500_001, pass: false },
    { name: 'missing armeabi-v7a row', csv: 'ABI,MIN,MAX\narm64-v8a,1,2\n', hermes: 3_321_764, pass: false },
    { name: 'missing Hermes bundle', csv: csv(25_651_727, 24_909_619), hermes: Number.NaN, pass: false },
  ];
  let failed = 0;
  for (const c of cases) {
    const { problems } = evaluateSizes(parseGetSize(c.csv), c.hermes);
    const ok = (problems.length === 0) === c.pass;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${problems.length === 0 ? 'no problems' : problems.join(' | ')}`);
  }
  console.log(`SIZE GATE SELF-TEST: ${failed === 0 ? 'PASS' : 'FAIL'} (${String(cases.length)} cases)`);
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
  const work = mkdtempSync(join(tmpdir(), 'wayvro-size-'));
  let csv;
  try {
    const apks = join(work, 'size.apks');
    execFileSync('java', ['-jar', args.bundletool, 'build-apks', `--bundle=${args.aab}`, `--output=${apks}`, '--overwrite'], { stdio: 'pipe' });
    csv = execFileSync('java', ['-jar', args.bundletool, 'get-size', 'total', `--apks=${apks}`, '--dimensions=ABI'], { encoding: 'utf8' });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const bundleEntry = readZip(readFileSync(args.aab)).find((e) => e.name === 'base/assets/index.android.bundle');
  const evaluation = evaluateSizes(parseGetSize(csv), bundleEntry ? bundleEntry.size : Number.NaN);
  const report = {
    aab: args.aab,
    aabBytes: readFileSync(args.aab).length,
    unit: '1 MB = 1,000,000 B (ADR-043)',
    method: 'bundletool get-size total --dimensions=ABI (MAX column); Hermes bundle = uncompressed base/assets/index.android.bundle',
    baseline: BASELINE,
    getSizeCsv: csv.trim(),
    ...evaluation,
    result: evaluation.problems.length ? 'FAIL' : 'PASS',
  };
  if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 2) + '\n');
  for (const [abi, r] of Object.entries(evaluation.abis))
    console.log(
      `${abi}: download MAX ${r.maxBytes} B (budget ${r.budgetBytes} B, ${r.deltaVsBaselineBytes >= 0 ? '+' : ''}${r.deltaVsBaselineBytes} B vs baseline) ${r.result}`,
    );
  console.log(`Hermes bundle: ${String(evaluation.hermesBundle.bytes)} B (budget ${BUDGETS.hermesBundle} B) ${evaluation.hermesBundle.result}`);
  for (const n of evaluation.notes) console.log(`  note: ${n}`);
  console.log(`SIZE CHECK: ${report.result}`);
  for (const p of evaluation.problems) console.log(`  - ${p}`);
  process.exit(evaluation.problems.length ? 1 : 0);
}
