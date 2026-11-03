import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { copyFlags, FORMAT_DECISIONS, REVIEW_LEDGER, reviewStatus } from '../../src/core/i18n/review-status';
import { CATALOGUE } from '../../src/core/i18n/strings';
import { DRIVER_CATALOGUE } from '../../src/features/driver/i18n/driver-strings';
import { buildPackage, keyUsage, type ReviewPackage } from './review-package';

/**
 * Builds the review package from the CURRENT typed catalogues, source tree and synthetic alias seed. DEVELOPMENT TOOL.
 * The alias list is read from the dev/test-only synthetic seed data (packages/test-support), never from a database.
 */
export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Git-ignored output folder (see .gitignore). */
export const OUT_DIR = join(APP_ROOT, 'i18n-review');
export const PACKAGE_FILE = join(OUT_DIR, 'wayvro-i18n-review.json');
export const STRINGS_CSV = join(OUT_DIR, 'wayvro-strings-review.csv');
export const ALIASES_CSV = join(OUT_DIR, 'wayvro-search-aliases-review.csv');
export const RETURNED_DIR = join(OUT_DIR, 'returned');

const ALIAS_DATA = join(APP_ROOT, '..', '..', 'packages', 'test-support', 'src', 'synthetic-landmark-aliases.ts');
const AliasDataSchema = z.object({
  SYNTHETIC_LANDMARK_ALIASES: z.array(z.object({ locale: z.enum(['en', 'ur', 'ur-Latn']), alias: z.string(), canonical: z.string(), placeId: z.string() })),
});

function sourceFiles(): { file: string; code: string }[] {
  const src = join(APP_ROOT, 'src');
  return readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith('__mocks__'))
    .filter((f) => !/i18n[\\/](strings|driver-strings|review-status)\.ts$/.test(f))
    .map((f) => ({ file: relative(src, join(src, f)).split(sep).join('/'), code: readFileSync(join(src, f), 'utf8') }));
}

export async function currentPackage(): Promise<ReviewPackage> {
  const aliasModule = AliasDataSchema.parse(await import(pathToFileURL(ALIAS_DATA).href));
  return buildPackage({
    catalogues: { app: CATALOGUE, driver: DRIVER_CATALOGUE },
    flags: copyFlags,
    status: (catalogue, key, locale, text) => reviewStatus(REVIEW_LEDGER, catalogue, key, locale, text),
    usage: keyUsage(sourceFiles()),
    aliases: aliasModule.SYNTHETIC_LANDMARK_ALIASES.map((a) => ({
      locale: a.locale,
      alias: a.alias,
      canonicalQuery: a.canonical,
      place: a.placeId,
      status: 'PROPOSED' as const,
    })),
    formatDecisions: FORMAT_DECISIONS,
  });
}
