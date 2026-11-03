/**
 * `pnpm --filter @wayvro/wayvro-mobile i18n:prereview [-- --out <folder>]` — AUTOMATED PRE-REVIEW pack for FA-09
 * (DEVELOPMENT TOOL). Runs the mechanical checks of `prereview.ts` over the CURRENT catalogues and writes a hand-off
 * folder (default `<repo>/evidence-local/fa09-prereview-pack/`, git-ignored):
 *   README.md                          what the pack is, counts per check, glossary, reviewer instructions
 *   reviewer-priority-sheet.csv        every string, SAFETY → LEGAL → PRICE → PERMISSION → GENERAL, with the findings and
 *                                       a separate machine suggestion column (NOT REVIEWED)
 *   prereview-findings.csv             one row per finding
 *   glossary.csv / glossary.md         repeated terms: en → ur → ur-Latn as written today, counts, consistency
 *   wayvro-strings-review.csv          the official review sheet (same content as `i18n:export`; the one to return)
 *   wayvro-search-aliases-review.csv   the alias review sheet (same content as `i18n:export`)
 *   prereview-summary.json             counts and the export id
 * It never marks anything reviewed, never writes REVIEW_LEDGER and never changes a status. Reproducible: the same
 * catalogues give byte-identical files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CATALOGUE } from '../../src/core/i18n/strings';
import { DRIVER_CATALOGUE } from '../../src/features/driver/i18n/driver-strings';
import { APP_ROOT, currentPackage } from './current';
import {
  CHECKS,
  countsMarkdown,
  findingsCsv,
  glossaryCsv,
  glossaryMarkdown,
  PRIORITY,
  PRIORITY_COLUMNS,
  prioritySheet,
  prereview,
  priorityGroup,
  type PrereviewResult,
} from './prereview';
import { aliasesCsv, csvDocument, stringsCsv, type ReviewPackage } from './review-package';

const REPO_ROOT = join(APP_ROOT, '..', '..');
const DEFAULT_OUT = join(REPO_ROOT, 'evidence-local', 'fa09-prereview-pack');

function readmeOf(pkg: ReviewPackage, result: PrereviewResult): string {
  const groups = PRIORITY.map((g) => `${g} ${String(pkg.rows.filter((r) => priorityGroup(r.flags) === g).length)}`).join(', ');
  const errors = CHECKS.reduce((n, c) => n + result.counts.byCheck[c].ERROR, 0);
  return [
    '# FA-09 automated pre-review pack',
    '',
    '**AUTOMATED PRE-REVIEW — NOT NATIVE REVIEW.** FA-09 stays HUMAN_REVIEW_REQUIRED. ' +
      `${String(result.counts.reviewed)} of ${String(result.counts.rows)} strings are REVIEWED. Every Urdu and Roman-Urdu string is ` +
      'PENDING_NATIVE_REVIEW. Nothing in this pack is a translation decision; the machine suggestions are NOT REVIEWED.',
    '',
    `- Export id: \`${pkg.exportId}\``,
    `- Strings: ${String(pkg.rows.length)} (app ${String(pkg.rows.filter((r) => r.catalogue === 'app').length)}, driver ${String(pkg.rows.filter((r) => r.catalogue === 'driver').length)})`,
    `- Priority groups (highest flag of each row): ${groups}`,
    `- Findings: ${String(result.findings.length)} on ${String(result.counts.rowsWithFindings)} strings; ERROR findings: ${String(errors)}`,
    `- Pending format decisions: ${pkg.formatDecisions.map((d) => `${d.id} (now: ${d.current}; alternative: ${d.alternative})`).join('; ')}`,
    '',
    '## Files',
    '',
    '| File | Use |',
    '|---|---|',
    '| `wayvro-strings-review.csv` | **The sheet to fill in and return** (same as `i18n:export`; instructions in `apps/wayvro-mobile/scripts/i18n/README.md` §2). |',
    '| `wayvro-search-aliases-review.csv` | The search-alias sheet to fill in and return. |',
    '| `reviewer-priority-sheet.csv` | Reading order: SAFETY → LEGAL → PRICE → PERMISSION → GENERAL, rows with findings first. Do not return this file; write decisions in the review sheet. |',
    '| `prereview-findings.csv` | One line per automated finding. |',
    '| `glossary.csv`, `glossary.md` | Repeated terms as written today, with counts. |',
    '',
    '## Reviewer instructions',
    '',
    '1. Work through `reviewer-priority-sheet.csv` from the top (rank 1). Find the same `catalogue` + `key` in',
    '   `wayvro-strings-review.csv` and write your decision there (OK / CHANGE / QUESTION).',
    '2. The columns `check_codes` and `check_details` are automatic hints. They can be wrong. They never replace reading',
    '   the English and both translations yourself.',
    '3. The column `claude_suggestion_NOT_REVIEWED` was written by a machine. Do not copy it without your own judgement.',
    '4. Decide the glossary terms marked **NO** once (one word per meaning), then apply the same word everywhere.',
    '5. Check the bidi findings on the screenshots (see the emulator accessibility supplement) before changing text.',
    '6. Return the review sheets with your name or initials, the date and the declaration (README §2, item 9).',
    '',
    '## Counts per check',
    '',
    countsMarkdown(result),
    '## Glossary',
    '',
    glossaryMarkdown(result),
  ].join('\n');
}

function readArgs(): { out: string } {
  const args = process.argv.slice(2);
  const { values } = parseArgs({
    args: args[0] === '--' ? args.slice(1) : args,
    options: { out: { type: 'string', default: DEFAULT_OUT } },
    allowPositionals: false,
  });
  return { out: resolve(APP_ROOT, values.out) };
}

const { out } = readArgs();
const pkg = await currentPackage();
const result = prereview(pkg, { app: CATALOGUE, driver: DRIVER_CATALOGUE });
const files: Readonly<Record<string, string>> = {
  'README.md': readmeOf(pkg, result),
  'reviewer-priority-sheet.csv': csvDocument(PRIORITY_COLUMNS, prioritySheet(pkg, result)),
  'prereview-findings.csv': findingsCsv(pkg, result),
  'glossary.csv': glossaryCsv(result),
  'glossary.md': glossaryMarkdown(result),
  'wayvro-strings-review.csv': stringsCsv(pkg),
  'wayvro-search-aliases-review.csv': aliasesCsv(pkg),
  'prereview-summary.json': `${JSON.stringify({ exportId: pkg.exportId, markedReviewed: false, counts: result.counts, glossary: result.glossary }, null, 2)}\n`,
};
mkdirSync(out, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(join(out, name), content, 'utf8');
process.stdout.write(`i18n:prereview: wrote ${Object.keys(files).length.toString()} files to ${relative(REPO_ROOT, out) || out}\n`);
process.stdout.write(`export id ${pkg.exportId}; strings ${String(result.counts.rows)}; REVIEWED ${String(result.counts.reviewed)}\n`);
for (const c of CHECKS) {
  const s = result.counts.byCheck[c];
  process.stdout.write(`  ${c}: ERROR ${String(s.ERROR)}, WARN ${String(s.WARN)}, INFO ${String(s.INFO)}\n`);
}
process.stdout.write(
  `glossary: ${String(result.glossary.length)} terms, ${String(result.glossary.filter((g) => !g.consistent).length)} with more than one rendering\n`,
);
process.stdout.write('i18n:prereview: AUTOMATED PRE-REVIEW — NOT NATIVE REVIEW; nothing is marked reviewed.\n');
