/**
 * `pnpm --filter @wayvro/wayvro-mobile i18n:export` — writes the FA-09 native-review package (DEVELOPMENT TOOL):
 *   i18n-review/wayvro-strings-review.csv        every app + Driver/Partner string: key, context, screens, flags,
 *                                                 max length, placeholders, en, ur, ur-Latn, status + empty reviewer columns
 *   i18n-review/wayvro-search-aliases-review.csv the synthetic Roman-Urdu/English/Urdu search aliases (PROPOSED)
 *   i18n-review/wayvro-i18n-review.json          the same package as JSON (kept to validate the returned sheet)
 * Reproducible: the same catalogues give byte-identical files and the same export id. The folder is git-ignored.
 * See scripts/i18n/README.md for the founder and reviewer instructions.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ALIASES_CSV, APP_ROOT, currentPackage, OUT_DIR, PACKAGE_FILE, STRINGS_CSV } from './current';
import { aliasesCsv, stringsCsv, type ReviewPackage } from './review-package';

function summary(pkg: ReviewPackage): string {
  const count = (predicate: (r: ReviewPackage['rows'][number]) => boolean): number => pkg.rows.filter(predicate).length;
  const lines = [
    `export id ${pkg.exportId}`,
    `strings: ${String(pkg.rows.length)} (app ${String(count((r) => r.catalogue === 'app'))}, driver ${String(count((r) => r.catalogue === 'driver'))})`,
    `  en: ${String(pkg.rows.length)} SOURCE`,
    `  ur: ${String(count((r) => r.urStatus === 'PENDING_NATIVE_REVIEW'))} PENDING_NATIVE_REVIEW, ${String(count((r) => r.urStatus === 'REVIEWED'))} REVIEWED`,
    `  ur-Latn: ${String(count((r) => r.urLatnStatus === 'PENDING_NATIVE_REVIEW'))} PENDING_NATIVE_REVIEW, ${String(count((r) => r.urLatnStatus === 'REVIEWED'))} REVIEWED`,
    `flags: ${(['SAFETY', 'LEGAL', 'PRICE', 'PERMISSION'] as const).map((f) => `${f} ${String(count((r) => r.flags.includes(f)))}`).join(', ')}; unflagged ${String(count((r) => r.flags.length === 0))}`,
    `with placeholders: ${String(count((r) => r.placeholders.length > 0))}; no source usage found: ${String(count((r) => r.screens.length === 0))}`,
    `search aliases: ${String(pkg.aliases.length)} (${['en', 'ur', 'ur-Latn'].map((l) => `${l} ${String(pkg.aliases.filter((a) => a.locale === l).length)}`).join(', ')}), all PROPOSED`,
    `format decisions pending native review: ${pkg.formatDecisions.map((d) => d.id).join(', ')}`,
  ];
  return `${lines.join('\n')}\n`;
}

const pkg = await currentPackage();
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(STRINGS_CSV, stringsCsv(pkg), 'utf8');
writeFileSync(ALIASES_CSV, aliasesCsv(pkg), 'utf8');
writeFileSync(PACKAGE_FILE, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
process.stdout.write(`i18n:export: wrote ${[STRINGS_CSV, ALIASES_CSV, PACKAGE_FILE].map((f) => relative(APP_ROOT, f)).join(', ')}\n${summary(pkg)}`);
process.stdout.write('i18n:export: nothing is marked reviewed; send both CSV files to the native reviewer (scripts/i18n/README.md).\n');
