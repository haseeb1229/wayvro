/**
 * `pnpm --filter @wayvro/wayvro-mobile i18n:import-review -- --reviewer "<name or initials>" --date YYYY-MM-DD
 *    --declaration "<the exact sentence>" --strings <returned strings CSV> [--aliases <returned aliases CSV>]`
 *
 * Reads a sheet returned by the native reviewer (FA-09) and writes an INTAKE file to the git-ignored
 * i18n-review/returned/ folder: the reviewer's decisions and corrections, rows that went stale, and a ledger fragment.
 * DEVELOPMENT TOOL. It refuses to run without a reviewer name, a date and the reviewer's declaration, accepts only the
 * keys and aliases of the export the reviewer received, and NEVER marks anything reviewed: a developer applies the
 * corrections to the catalogues and only then adds the reviewer record to REVIEW_LEDGER (scripts/i18n/README.md).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { REVIEW_DECLARATION } from '../../src/core/i18n/review-status';
import { APP_ROOT, currentPackage, PACKAGE_FILE, RETURNED_DIR } from './current';
import { intakeFrom, packageId, type Intake } from './review-package';

const ExportedSchema = z.object({
  exportId: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z.array(
    z.object({ catalogue: z.enum(['app', 'driver']), key: z.string(), en: z.string(), ur: z.string(), urLatn: z.string(), placeholders: z.array(z.string()) }),
  ),
  aliases: z.array(z.object({ locale: z.string(), alias: z.string() })),
});

function refuse(message: string): never {
  process.stderr.write(`i18n:import-review: ${message}\n`);
  process.exit(1);
}

const OPTIONS = {
  reviewer: { type: 'string', default: '' },
  date: { type: 'string', default: '' },
  declaration: { type: 'string', default: '' },
  strings: { type: 'string', default: '' },
  aliases: { type: 'string', default: '' },
} as const;

function readArgs() {
  // `pnpm … i18n:import-review -- --reviewer …` forwards the `--` separator itself; it is not an argument.
  const args = process.argv.slice(2);
  try {
    return parseArgs({ args: args[0] === '--' ? args.slice(1) : args, options: OPTIONS, allowPositionals: false }).values;
  } catch (e) {
    return refuse(`refused: ${e instanceof Error ? e.message : String(e)}`);
  }
}
const values = readArgs();

if (values.reviewer.trim() === '') refuse('refused: --reviewer "<name or initials>" is required (the person who reviewed the sheet)');
if (values.strings === '') refuse('refused: --strings <path to the returned wayvro-strings-review.csv> is required');
if (!existsSync(PACKAGE_FILE)) refuse(`refused: ${relative(APP_ROOT, PACKAGE_FILE)} is missing — it must be the export the reviewer received`);
if (!existsSync(values.strings)) refuse(`refused: ${values.strings} does not exist`);
if (values.aliases !== '' && !existsSync(values.aliases)) refuse(`refused: ${values.aliases} does not exist`);

// The export the reviewer received; its id must still match its content (the file was not edited after export).
const raw = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(PACKAGE_FILE, 'utf8')));
const exported = ExportedSchema.parse(raw);
if (packageId({ rows: raw['rows'], aliases: raw['aliases'], formatDecisions: raw['formatDecisions'] }) !== exported.exportId)
  refuse(`refused: ${relative(APP_ROOT, PACKAGE_FILE)} was modified after the export (its content no longer matches its export id)`);
const current = await currentPackage();
const sheets = { strings: readFileSync(values.strings, 'utf8'), aliases: values.aliases === '' ? null : readFileSync(values.aliases, 'utf8') };

function readIntake(): Intake {
  try {
    return intakeFrom({
      reviewer: values.reviewer,
      date: values.date,
      declaration: values.declaration,
      requiredDeclaration: REVIEW_DECLARATION,
      exported,
      current,
      sheets,
    });
  } catch (e) {
    return refuse(e instanceof Error ? e.message : String(e));
  }
}
const intake = readIntake();

mkdirSync(RETURNED_DIR, { recursive: true });
const out = join(RETURNED_DIR, `intake-${intake.proposedLedger.record.id}.json`);
writeFileSync(out, `${JSON.stringify(intake, null, 2)}\n`, 'utf8');
const by = (d: string): number => intake.strings.filter((s) => s.decision === d).length;
process.stdout.write(
  [
    `i18n:import-review: wrote ${relative(APP_ROOT, out)}`,
    `reviewer ${intake.reviewer}, ${intake.date}, export ${intake.exportId}`,
    `strings: OK ${String(by('OK'))}, CHANGE ${String(by('CHANGE'))}, QUESTION ${String(by('QUESTION'))}; stale (changed after export, not used) ${String(intake.stale.length)}`,
    `aliases: ${String(intake.aliases.length)} decisions`,
    'Nothing was marked reviewed. Next: apply every CHANGE to the catalogues, answer every QUESTION, then add',
    'proposedLedger.record and proposedLedger.reviewed to REVIEW_LEDGER in src/core/i18n/review-status.ts and run the tests.',
    '',
  ].join('\n'),
);
