#!/usr/bin/env node
/*
 * Aggregates the PR-tier shard summaries of one CI run (FA-16 founder decision 2026-10-14; .github/workflows/ci.yml
 * jobs `mobile-e2e-shard` → `mobile-e2e`). GREEN only when:
 *   - the shard assignment in flows/manifest.mjs is valid (every PR-tier flow in exactly one shard);
 *   - every shard 1..n wrote a summary.json for its own shard (a missing shard is BLOCKED, never dropped);
 *   - every PR-tier flow is accounted for exactly once across the shards, in its assigned shard;
 *   - every flow is PASS, or FLAKY outside the INV-07 flows (one automatic retry, SP-08 §6);
 *   - no shard exceeded its Maestro budget.
 * FAIL, BLOCKED, NOT RUN, SKIPPED, NOT TESTABLE, a FLAKY INV-07 flow, a duplicate or a missing flow fails the aggregate.
 *
 * Usage: node tests/e2e-mobile/aggregate-shards.mjs <dir with the downloaded shard artefacts> <n> [out.md]
 *        node tests/e2e-mobile/aggregate-shards.mjs --self-test   (negative controls on synthetic summaries)
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FLOWS, PR_SHARDS, validatePrShards } from './flows/manifest.mjs';

const find = (root) => {
  const found = [];
  if (!existsSync(root)) return found;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) found.push(...find(p));
    else if (e.name === 'summary.json') found.push(p);
  }
  return found;
};

function aggregate(dir, count) {
  const problems = validatePrShards(count);
  const shards = new Map();
  for (const file of find(dir)) {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    if (s.tier !== 'pr' || !s.shard) continue;
    if (shards.has(s.shard.index)) problems.push(`shard ${String(s.shard.index)} reported twice`);
    shards.set(s.shard.index, s);
  }
  const prFlows = FLOWS.filter((f) => f.tiers.includes('pr'));
  const seen = new Map();
  const lines = [
    `# SP-08 PR tier — ${String(count)} shards (EMULATOR evidence only)`,
    '',
    '| Shard | Result | Maestro phase (s) / budget | Counts |',
    '|---|---|---|---|',
  ];
  for (let i = 1; i <= count; i++) {
    const s = shards.get(i);
    if (!s) {
      problems.push(`shard ${String(i)} wrote no summary (BLOCKED)`);
      lines.push(`| ${String(i)} | BLOCKED (no summary) | - | - |`);
      continue;
    }
    if (s.overBudget) problems.push(`shard ${String(i)} exceeded its Maestro budget (${String(s.maestroPhaseSeconds)} s > ${String(s.budgetSeconds)} s)`);
    const expected = new Set(PR_SHARDS[i] ?? []);
    for (const f of s.flows ?? []) {
      if (!expected.has(f.id)) problems.push(`${f.id} ran in shard ${String(i)} but is not assigned to it`);
      seen.set(f.id, [...(seen.get(f.id) ?? []), { shard: i, ...f }]);
    }
    lines.push(
      `| ${String(i)} | ${s.result} | ${String(s.maestroPhaseSeconds)} / ${String(s.budgetSeconds)} | ${Object.entries(s.counts ?? {})
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(', ')} |`,
    );
  }
  lines.push('', '| Flow | Shard | Status | Attempts | Seconds | Notes |', '|---|---|---|---|---|---|');
  const totals = {};
  for (const flow of prFlows) {
    const runs = seen.get(flow.id) ?? [];
    if (runs.length === 0) {
      problems.push(`${flow.id} was not run in any shard`);
      totals.MISSING = (totals.MISSING ?? 0) + 1;
      lines.push(`| ${flow.id} | - | MISSING | - | - | not accounted for |`);
      continue;
    }
    if (runs.length > 1) problems.push(`${flow.id} ran in ${String(runs.length)} shards`);
    for (const r of runs) {
      totals[r.status] = (totals[r.status] ?? 0) + 1;
      const allowed = r.status === 'PASS' || (r.status === 'FLAKY' && !r.inv07);
      if (!allowed) problems.push(`${flow.id}: ${r.status}${r.inv07 && r.status === 'FLAKY' ? ' (INV-07 flows may not be FLAKY)' : ''}`);
      const notes = (r.reason ?? r.problems?.join('; ') ?? (r.firstAttempt ? `first attempt: ${r.firstAttempt.join('; ')}` : '')).replace(/\|/g, '/');
      lines.push(`| ${flow.id} | ${String(r.shard)} | ${r.status} | ${String(r.attempts)} | ${String(r.seconds)} | ${notes} |`);
    }
  }
  const result = problems.length === 0 ? 'PASS' : 'FAIL';
  lines.push(
    '',
    `Flows: ${String(prFlows.length)} expected · ${Object.entries(totals)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(' · ')}`,
    '',
    `**Aggregate: ${result}**`,
    ...(problems.length ? ['', ...problems.map((p) => `- ${p}`)] : []),
    '',
  );
  return { result, problems, md: lines.join('\n') };
}

/** Negative controls: synthetic shard summaries that must FAIL, and one that must PASS. */
function selfTest() {
  const count = Object.keys(PR_SHARDS).length;
  const inv07 = new Set(FLOWS.filter((f) => f.inv07).map((f) => f.id));
  const summary = (i, status = () => 'PASS', extra = {}) => ({
    tier: 'pr',
    lane: `api-35-shard-${String(i)}`,
    shard: { index: i, of: count, flows: PR_SHARDS[i] },
    result: 'PASS',
    maestroPhaseSeconds: 300,
    budgetSeconds: 900,
    overBudget: false,
    counts: {},
    flows: PR_SHARDS[i].map((id) => ({ id, inv07: inv07.has(id), status: status(id), attempts: 1, seconds: 60 })),
    ...extra,
  });
  const cases = [
    { name: 'all shards PASS', expect: 'PASS', shards: (i) => summary(i) },
    {
      name: 'a non-INV-07 flow FLAKY is allowed',
      expect: 'PASS',
      shards: (i) => summary(i, (id) => (id === 'pr-02-restore-rider' ? 'FLAKY' : 'PASS')),
    },
    { name: 'a missing shard', expect: 'FAIL', shards: (i) => (i === 2 ? null : summary(i)) },
    { name: 'a FAIL flow', expect: 'FAIL', shards: (i) => summary(i, (id) => (id === 'pr-10-quote-options' ? 'FAIL' : 'PASS')) },
    { name: 'a BLOCKED flow', expect: 'FAIL', shards: (i) => summary(i, (id) => (id === 'pr-14-signout-wipe' ? 'BLOCKED' : 'PASS')) },
    { name: 'a NOT RUN flow', expect: 'FAIL', shards: (i) => summary(i, (id) => (id === 'pr-11-quote-restore' ? 'NOT RUN' : 'PASS')) },
    {
      name: 'an INV-07 flow FLAKY',
      expect: 'FAIL',
      shards: (i) => summary(i, (id) => (id === 'pr-01-signin-rider-home' ? 'FLAKY' : 'PASS')),
    },
    { name: 'a shard over budget', expect: 'FAIL', shards: (i) => summary(i, undefined, i === 3 ? { overBudget: true, maestroPhaseSeconds: 950 } : {}) },
    {
      name: 'a flow missing from its shard',
      expect: 'FAIL',
      shards: (i) => {
        const s = summary(i);
        return i === 4 ? { ...s, flows: s.flows.slice(1) } : s;
      },
    },
    {
      name: 'a flow run in two shards',
      expect: 'FAIL',
      shards: (i) => {
        const s = summary(i);
        return i === 1 ? { ...s, flows: [...s.flows, { id: 'pr-04-earn-entry-rider-only', inv07: true, status: 'PASS', attempts: 1, seconds: 50 }] } : s;
      },
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const root = mkdtempSync(join(tmpdir(), 'wayvro-aggregate-'));
    try {
      for (let i = 1; i <= count; i++) {
        const s = c.shards(i);
        if (!s) continue;
        mkdirSync(join(root, `shard-${String(i)}`), { recursive: true });
        writeFileSync(join(root, `shard-${String(i)}`, 'summary.json'), JSON.stringify(s));
      }
      const { result, problems } = aggregate(root, count);
      const ok = result === c.expect;
      if (!ok) failed++;
      process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${result}${problems.length ? ` (${problems[0]})` : ''}\n`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  process.stdout.write(`AGGREGATE SELF-TEST: ${failed === 0 ? 'PASS' : 'FAIL'} (${String(cases.length)} cases)\n`);
  return failed === 0;
}

if (process.argv[2] === '--self-test') process.exit(selfTest() ? 0 : 1);
const [dir, countArg, outFile] = process.argv.slice(2);
const count = Number(countArg);
if (!dir || !Number.isInteger(count) || count < 1) {
  process.stderr.write('usage: aggregate-shards.mjs <dir> <n> [out.md] | --self-test\n');
  process.exit(2);
}
const { result, md } = aggregate(dir, count);
if (outFile) writeFileSync(outFile, md);
process.stdout.write(md);
process.exit(result === 'PASS' ? 0 : 1);
