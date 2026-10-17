#!/usr/bin/env node
/*
 * Merges the per-lane run-flows.mjs summaries of a full-matrix run (.github/workflows/mobile-full.yml) into one
 * per-flow × per-lane table with PASS / FAIL / FLAKY / BLOCKED / SKIPPED / NOT RUN / NOT TESTABLE counts (SP-08 §8).
 * A lane without a summary.json is reported BLOCKED (it never reached the flows) — never dropped.
 *
 * Usage: node tests/e2e-mobile/summarise.mjs <dir containing one sub-directory per lane> <expected lane,lane,...> [out.md]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, expected, outFile] = process.argv.slice(2);
if (!dir || !expected) {
  process.stderr.write('usage: summarise.mjs <dir> <lane,lane,...> [out.md]\n');
  process.exit(2);
}
const find = (root) => {
  const found = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) found.push(...find(p));
    else if (e.name === 'summary.json') found.push(p);
  }
  return found;
};
const lanes = new Map();
if (existsSync(dir))
  for (const file of find(dir)) {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    if (s.lane) lanes.set(s.lane, s);
  }
const laneNames = expected.split(',');
const flowIds = [...new Set([...lanes.values()].flatMap((s) => (s.flows ?? []).map((f) => f.id)))];
const totals = {};
const lines = [
  '# SP-08 full matrix (manual workflow_dispatch) — EMULATOR evidence only',
  '',
  `| Flow | ${laneNames.join(' | ')} |`,
  `|---|${laneNames.map(() => '---').join('|')}|`,
];
for (const id of flowIds) {
  const cells = laneNames.map((lane) => {
    const s = lanes.get(lane);
    const status = s ? (s.flows.find((f) => f.id === id)?.status ?? 'NOT RUN') : 'BLOCKED';
    totals[status] = (totals[status] ?? 0) + 1;
    return status;
  });
  lines.push(`| ${id} | ${cells.join(' | ')} |`);
}
lines.push('', '| Lane | Result | Maestro phase (s) | Counts |', '|---|---|---|---|');
let failed = false;
for (const lane of laneNames) {
  const s = lanes.get(lane);
  if (!s || s.result !== 'PASS') failed = true;
  lines.push(
    `| ${lane} | ${s ? s.result : 'BLOCKED (no summary)'} | ${s ? String(s.maestroPhaseSeconds) : '-'} | ${
      s
        ? Object.entries(s.counts)
            .map(([k, v]) => `${k} ${String(v)}`)
            .join(', ')
        : '-'
    } |`,
  );
}
lines.push(
  '',
  `Totals: ${Object.entries(totals)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(' · ')}`,
  '',
);
const md = lines.join('\n');
if (outFile) writeFileSync(outFile, md);
process.stdout.write(md);
process.exit(failed ? 1 : 0);
