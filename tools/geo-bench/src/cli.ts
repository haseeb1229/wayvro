#!/usr/bin/env node
/**
 * SP-04 geo benchmark harness CLI (DEV-ONLY; tools/geo-bench/README.md has the founder instructions).
 *
 *   geo-bench validate --csv <working.csv>
 *   geo-bench run      --csv <working.csv> [--gpx-dir <dir>] [--repeats 3] [--concurrency 2]
 *                      [--case-list-version LHR-SP04-CASES-v1] [--already-used <bucket>=<n>,...] [--out <dir>]
 *   geo-bench score    --run <run dir> --csv <working.csv> [--ratings <filled blind sheet>] [--review <filled review>]
 *                      [--scoring-inputs <json>] [--gpx-dir <dir>] [--peak-sessions LHR-SP04-S4] [--report-out <dir>]
 *
 * Keys/URLs come ONLY from the environment (never printed). Raw responses, the run record and review sheets are written
 * under tools/geo-bench/.local/ (git-ignored) or another non-tracked location; only `score` output is aggregated.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type BudgetBucket, BudgetGuard, FREE_ALLOWANCE_PER_MONTH } from './budget.js';
import { type ValidationResult, validateCapture } from './cases.js';
import { type BundleId, componentsFromEnv } from './components.js';
import { type GpxTrack, legTruths, parseGpx } from './gpx.js';
import { LOCAL_ROOT, assertPrivateLocation, recordingFetch } from './local.js';
import { computeMetrics } from './metrics.js';
import { assertAggregateSafe, buildReport, renderMarkdown } from './report.js';
import { type RunRecord, planUsage, planViolations, runBenchmark } from './runner.js';
import { scoreBundles, scoringInputsSchema } from './score.js';
import { type ReviewEntry, blindSheet, readRatings, readReview, reviewSheet, routeHints } from './sheets.js';

const out = (line = '') => process.stdout.write(`${line}\n`);
const fail = (message: string): never => {
  process.stderr.write(`geo-bench: ${message}\n`);
  process.exit(1);
};

function loadCases(csvPath: string): ValidationResult {
  assertPrivateLocation(csvPath, 'the working CSV');
  const result = validateCapture(readFileSync(csvPath, 'utf8'));
  const where = (f: { row: number; caseId: string; field: string }) => (f.row === 0 ? 'sheet' : `row ${f.row} ${f.caseId} ${f.field}`);
  for (const w of result.warnings) out(`WARN  ${where(w)}: ${w.message}`);
  for (const e of result.errors) out(`ERROR ${where(e)}: ${e.message}`);
  out(`cases: ${result.points.length} POINT, ${result.routes.length} ROUTE; ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
  return result;
}

function loadTracks(cases: ValidationResult, gpxDir: string | undefined): Map<string, GpxTrack> {
  const tracks = new Map<string, GpxTrack>();
  if (gpxDir === undefined) return tracks;
  assertPrivateLocation(gpxDir, 'the GPX folder');
  for (const leg of cases.routes) {
    if (leg.gpxFileRef === null) continue;
    if (basename(leg.gpxFileRef) !== leg.gpxFileRef || leg.gpxFileRef.includes('..')) fail(`${leg.id}: gpx_file_ref must be a plain file name`);
    const file = join(gpxDir, leg.gpxFileRef);
    if (!existsSync(file)) {
      out(`WARN  ${leg.id}: GPX file not found in --gpx-dir; the odometer is used as D_true`);
      continue;
    }
    tracks.set(leg.id, parseGpx(readFileSync(file, 'utf8')));
  }
  return tracks;
}

function parseAlreadyUsed(value: string | undefined): Partial<Record<BudgetBucket, number>> {
  const used: Partial<Record<BudgetBucket, number>> = {};
  if (value === undefined || value.trim() === '') return used;
  for (const pair of value.split(',')) {
    const [bucket = '', n = ''] = pair.split('=');
    if (!(bucket in FREE_ALLOWANCE_PER_MONTH) || !/^\d+$/.test(n))
      fail(`--already-used: expected <bucket>=<integer>, buckets: ${Object.keys(FREE_ALLOWANCE_PER_MONTH).join(', ')}`);
    used[bucket as BudgetBucket] = Number(n);
  }
  return used;
}

function positiveInt(value: string | undefined, fallback: number, name: string, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) fail(`${name} must be an integer between 1 and ${max}`);
  return Number(value);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      csv: { type: 'string' },
      run: { type: 'string' },
      out: { type: 'string' },
      'gpx-dir': { type: 'string' },
      repeats: { type: 'string' },
      concurrency: { type: 'string' },
      'case-list-version': { type: 'string' },
      'already-used': { type: 'string' },
      ratings: { type: 'string' },
      review: { type: 'string' },
      'scoring-inputs': { type: 'string' },
      'peak-sessions': { type: 'string' },
      'report-out': { type: 'string' },
    },
    strict: true,
  });
  const csv = values.csv ?? fail('--csv <working CSV> is required');

  if (command === 'validate') {
    const cases = loadCases(csv);
    process.exit(cases.errors.length > 0 ? 1 : 0);
  }

  if (command === 'run') {
    const cases = loadCases(csv);
    if (cases.errors.length > 0) fail('fix the capture-sheet errors first (no provider was called)');
    const runDir = resolve(values.out ?? join(LOCAL_ROOT, 'runs', new Date().toISOString().replace(/[:.]/g, '-')));
    assertPrivateLocation(runDir, 'the run folder');
    mkdirSync(join(runDir, 'raw'), { recursive: true });
    mkdirSync(LOCAL_ROOT, { recursive: true });
    const components = componentsFromEnv(process.env, (bundle: BundleId) => recordingFetch(join(runDir, 'raw'), bundle.toLowerCase()));
    if (components.length === 0) {
      out('NOT RUN — no GEO_* key or self-hosted URL in the environment; nothing was called. This is NOT a pass.');
      return;
    }
    out(`enabled components: ${components.map((c) => c.id).join(', ')}`);
    const repeats = positiveInt(values.repeats, 3, '--repeats', 10);
    const guard = new BudgetGuard(join(LOCAL_ROOT, 'usage-ledger.json'), new Date(), parseAlreadyUsed(values['already-used']));
    const plan = planUsage(cases.points, cases.routes, components, repeats);
    writeFileSync(join(runDir, 'plan.json'), `${JSON.stringify(Object.fromEntries(plan), null, 2)}\n`);
    const violations = planViolations(plan, guard);
    if (violations.length > 0) {
      for (const v of violations) out(`REFUSED ${v.bucket}: planned ≤ ${v.planned} + used ${v.used} > stop at ${v.stopAt} (80 % of the free allowance)`);
      fail('budget hard stop: the planned run would exceed the free allowance minus 20 % — no provider was called');
    }
    const run = await runBenchmark(cases.points, cases.routes, components, {
      caseListVersion: values['case-list-version'] ?? 'LHR-SP04-CASES-v1',
      repeats,
      concurrency: positiveInt(values.concurrency, 2, '--concurrency', 8),
      guard,
    });
    guard.save();
    writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
    const blind = blindSheet(run);
    writeFileSync(join(runDir, 'blind-rating-sheet.csv'), blind.csv);
    writeFileSync(join(runDir, 'blind-key.json'), `${JSON.stringify(blind.key, null, 2)}\n`);
    const truths = legTruths(cases.routes, loadTracks(cases, values['gpx-dir']));
    writeFileSync(join(runDir, 'route-review.csv'), reviewSheet(run, cases, routeHints(run, cases, truths)));
    out(
      `run ${run.status}${run.stoppedBucket === null ? '' : ` (hard stop at ${run.stoppedBucket})`}: ${run.calls.length} provider calls; local outputs in ${runDir}`,
    );
    out('next: rate blind-rating-sheet.csv (usefulness 0–3) and classify route-review.csv, then run `score`.');
    if (run.status !== 'COMPLETE') process.exit(2);
    return;
  }

  if (command === 'score') {
    const runDir = resolve(values.run ?? fail('--run <run folder> is required'));
    assertPrivateLocation(runDir, 'the run folder');
    const cases = loadCases(csv);
    if (cases.errors.length > 0) fail('the capture sheet has errors');
    const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as RunRecord;
    const key = JSON.parse(readFileSync(join(runDir, 'blind-key.json'), 'utf8')) as Record<string, string>;
    const ratings = values.ratings === undefined ? new Map<string, number>() : readRatings(readFileSync(values.ratings, 'utf8'), key);
    const review = values.review === undefined ? new Map<string, ReviewEntry>() : readReview(readFileSync(values.review, 'utf8'));
    const inputs =
      values['scoring-inputs'] === undefined ? null : scoringInputsSchema.parse(JSON.parse(readFileSync(values['scoring-inputs'], 'utf8')) as unknown);
    const truths = legTruths(cases.routes, loadTracks(cases, values['gpx-dir']));
    const peakSessions = new Set((values['peak-sessions'] ?? 'LHR-SP04-S4').split(',').map((s) => s.trim()));
    const { components, evidence } = computeMetrics({ cases, run, ratings, review, truths, peakSessions });
    const { results, incomplete } = scoreBundles(components, inputs, run.status === 'COMPLETE');
    const report = buildReport({ run, cases, components, evidence, bundles: results, incompleteBundles: incomplete });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const md = renderMarkdown(report);
    assertAggregateSafe(json, cases.freeTextValues);
    assertAggregateSafe(md, cases.freeTextValues);
    const reportDir = resolve(values['report-out'] ?? join(runDir, 'aggregate'));
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'sp04-aggregate.json'), json);
    writeFileSync(join(reportDir, 'sp04-aggregate.md'), md);
    for (const b of results)
      out(
        `${b.bundle} ${Object.values(b.configuration).join(' + ')}: score ${b.score.total.toFixed(1)} (missing weight ${b.score.missingWeight}) → ${b.eligibility}`,
      );
    for (const i of incomplete) out(`${i.bundle}: NOT SCORED (missing ${i.missing.join(', ')})`);
    out(`aggregated report (safe to review for commit): ${reportDir}`);
    return;
  }

  fail('usage: geo-bench <validate|run|score> --csv <working CSV> [options] (see tools/geo-bench/README.md)');
}

// Any failure ends the process with a non-zero exit and a message (configuration/key errors never contain values).
await main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : 'unexpected failure');
});
