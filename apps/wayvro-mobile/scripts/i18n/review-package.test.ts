import { describe, expect, it } from 'vitest';
import { copyFlags, ledgerProblems, REVIEW_DECLARATION, reviewStatus, type ReviewLedger } from '../../src/core/i18n/review-status';
import { CATALOGUE } from '../../src/core/i18n/strings';
import { DRIVER_CATALOGUE } from '../../src/features/driver/i18n/driver-strings';
import {
  aliasesCsv,
  buildPackage,
  contextOf,
  csvRecords,
  intakeFrom,
  keyUsage,
  packageId,
  parseCsv,
  STRING_COLUMNS,
  stringsCsv,
  type CatalogueSet,
  type ReviewPackage,
} from './review-package';

const EMPTY: ReviewLedger = { records: [], reviewed: {} };
const tiny: CatalogueSet = {
  app: {
    en: { 'fare.total': 'Total', 'rider.quote.from': 'From: {place}', 'common.retry': 'Try again, "now"' },
    ur: { 'fare.total': 'کل', 'rider.quote.from': 'کہاں سے: {place}', 'common.retry': 'دوبارہ کوشش کریں' },
    'ur-Latn': { 'fare.total': 'Kul', 'rider.quote.from': 'Kahan se: {place}', 'common.retry': 'Dobara koshish karein' },
  },
  driver: { en: { 'drive.location.title': 'Location' }, ur: { 'drive.location.title': 'لوکیشن' }, 'ur-Latn': { 'drive.location.title': 'Location' } },
};

function pkgOf(catalogues: CatalogueSet): ReviewPackage {
  return buildPackage({
    catalogues,
    flags: copyFlags,
    status: (catalogue, key, locale, text) => reviewStatus(EMPTY, catalogue, key, locale, text),
    usage: keyUsage([
      { file: 'features/rider/quote/FareScreen.tsx', code: "t('fare.total')" },
      { file: 'features/rider/quote/quote-view.ts', code: 'tr(`rider.quote.${x}`)' },
    ]),
    aliases: [
      { locale: 'ur-Latn', alias: 'libarti market', canonicalQuery: 'liberty market', place: 'syn-lhr-001', status: 'PROPOSED' },
      { locale: 'en', alias: 'liberty mkt', canonicalQuery: 'liberty market', place: 'syn-lhr-001', status: 'PROPOSED' },
    ],
    formatDecisions: [{ id: 'pkr.grouping', current: 'Rs 1,250', alternative: 'Rs 1,25,000', status: 'PENDING_NATIVE_REVIEW' }],
  });
}

/** A returned strings sheet: the export with some reviewer columns filled in. */
function returned(pkg: ReviewPackage, fill: Readonly<Record<string, readonly [string, string, string]>>, extra: readonly string[][] = []): string {
  const [header, ...rows] = parseCsv(stringsCsv(pkg));
  const at = (name: string): number => (header ?? []).indexOf(name);
  const out = rows.map((cells) => {
    const id = `${cells[at('catalogue')] ?? ''}:${cells[at('key')] ?? ''}`;
    const f = fill[id];
    if (f === undefined) return cells;
    const next = [...cells];
    next[at('review_status')] = f[0];
    next[at('ur_corrected')] = f[1];
    next[at('ur_latn_corrected')] = f[2];
    return next;
  });
  const quote = (c: string): string => `"${c.replace(/"/g, '""')}"`;
  return [header ?? [], ...out, ...extra].map((r) => r.map(quote).join(',')).join('\n');
}

const base = (pkg: ReviewPackage, strings: string) => ({
  reviewer: 'A. Reviewer',
  date: '2026-10-20',
  declaration: REVIEW_DECLARATION,
  requiredDeclaration: REVIEW_DECLARATION,
  exported: pkg,
  current: pkg,
  sheets: { strings, aliases: null },
});

describe('FA-09 review package (export)', () => {
  it('is reproducible: rows sorted by catalogue and key, stable export id, +40 % layout budget, placeholders, flags, status', () => {
    const a = pkgOf(tiny);
    expect(pkgOf(tiny)).toEqual(a);
    expect(a.exportId).toMatch(/^[0-9a-f]{64}$/);
    expect(a.exportId).toBe(packageId(JSON.parse(JSON.stringify(a)) as ReviewPackage));
    expect(a.rows.map((r) => `${r.catalogue}:${r.key}`)).toEqual(['app:common.retry', 'app:fare.total', 'app:rider.quote.from', 'driver:drive.location.title']);
    const total = a.rows.find((r) => r.key === 'fare.total');
    expect(total).toMatchObject({
      maxLength: 7,
      placeholders: [],
      flags: ['PRICE'],
      screens: ['features/rider/quote/FareScreen.tsx'],
      urStatus: 'PENDING_NATIVE_REVIEW',
    });
    expect(a.rows.find((r) => r.key === 'rider.quote.from')).toMatchObject({ placeholders: ['place'], screens: ['features/rider/quote/quote-view.ts'] });
    expect(a.rows.find((r) => r.key === 'drive.location.title')?.flags).toEqual(['PERMISSION']);
    expect(pkgOf({ ...tiny, app: { ...tiny.app, ur: { ...tiny.app.ur, 'fare.total': 'کُل' } } }).exportId).not.toBe(a.exportId);
    expect(a.aliases.map((x) => x.alias)).toEqual(['liberty mkt', 'libarti market']);
  });

  it('names the screen context of every real key (most specific namespace wins)', () => {
    expect(contextOf('app', 'rider.quote.title')).toBe('Rider: price options (/ride/quote)');
    expect(contextOf('driver', 'drive.eligibility.title')).toBe('Driver: eligibility per service (/drive/eligibility)');
    expect(contextOf('app', 'appName')).toBe('General');
    const general = [
      ...Object.keys(CATALOGUE.en).filter((k) => contextOf('app', k) === 'General'),
      ...Object.keys(DRIVER_CATALOGUE.en).filter((k) => contextOf('driver', k) === 'General'),
    ];
    expect(general).toEqual(['appName']);
  });

  it('CSV round-trips commas, quotes, Urdu script and the BOM; the reviewer columns start empty', () => {
    const pkg = pkgOf(tiny);
    const records = csvRecords(stringsCsv(pkg), STRING_COLUMNS);
    expect(records).toHaveLength(4);
    const retry = records.find((r) => r['key'] === 'common.retry');
    expect(retry?.['en']).toBe('Try again, "now"');
    expect(retry?.['ur']).toBe('دوبارہ کوشش کریں');
    expect(retry?.['review_status']).toBe('');
    expect(parseCsv('a,"b\nc",d\r\n\r\n1,2,3')).toEqual([
      ['a', 'b\nc', 'd'],
      ['1', '2', '3'],
    ]);
    expect(() => parseCsv('"open')).toThrow(/unterminated/);
    expect(() => csvRecords('a,b\n1,2', STRING_COLUMNS)).toThrow(/missing column/);
    expect(parseCsv(aliasesCsv(pkg))[1]?.slice(1, 4)).toEqual(['en', 'liberty mkt', 'liberty market']);
  });
});

describe('FA-09 returned review (import): refuses bad sheets and never marks anything reviewed', () => {
  const pkg = pkgOf(tiny);

  it('refuses without a reviewer name, a valid date or the exact declaration', () => {
    const sheet = returned(pkg, {});
    expect(() => intakeFrom({ ...base(pkg, sheet), reviewer: ' ' })).toThrow(/--reviewer/);
    expect(() => intakeFrom({ ...base(pkg, sheet), date: '20/10/2026' })).toThrow(/--date/);
    expect(() => intakeFrom({ ...base(pkg, sheet), declaration: 'I checked it.' })).toThrow(/declaration/);
  });

  it("accepts only the export's keys, from this export, once each, with valid decisions and placeholders", () => {
    const foreign = ['x'.repeat(64), 'app', 'common.cancel', '', '', '', '0', '', 'Cancel', 'منسوخ', 'Cancel', '', '', 'OK', '', '', ''];
    expect(() => intakeFrom(base(pkg, returned(pkg, {}, [[pkg.exportId, ...foreign.slice(1)]])))).toThrow(/not a key of this export/);
    expect(() => intakeFrom(base(pkg, returned(pkg, {}, [foreign])))).toThrow(/another export/);
    const dup = parseCsv(stringsCsv(pkg))[1] ?? [];
    expect(() => intakeFrom(base(pkg, returned(pkg, {}, [dup])))).toThrow(/appears twice/);
    expect(() => intakeFrom(base(pkg, returned(pkg, { 'app:fare.total': ['MAYBE', '', ''] })))).toThrow(/OK, CHANGE or QUESTION/);
    expect(() => intakeFrom(base(pkg, returned(pkg, { 'app:fare.total': ['CHANGE', '', ''] })))).toThrow(/no corrected text/);
    expect(() => intakeFrom(base(pkg, returned(pkg, { 'app:rider.quote.from': ['CHANGE', 'کہاں سے', ''] })))).toThrow(/placeholders/);
  });

  it('records decisions, flags stale rows, proposes a ledger only for OK/CHANGE, and marks nothing reviewed', () => {
    const sheet = returned(pkg, {
      'app:fare.total': ['ok', '', ''],
      'app:rider.quote.from': ['CHANGE', 'کہاں سے: {place}', 'Kahan se chalein: {place}'],
      'app:common.retry': ['QUESTION', '', ''],
    });
    const changed = pkgOf({ ...tiny, driver: { ...tiny.driver, ur: { 'drive.location.title': 'مقام' } } });
    // A row the reviewer left blank is not a decision, even if its text changed since the export.
    const intake = intakeFrom({ ...base(pkg, sheet), current: changed });
    expect(intake.markedReviewed).toBe(false);
    expect(intake.strings.map((s) => [s.key, s.decision])).toEqual([
      ['common.retry', 'QUESTION'],
      ['fare.total', 'OK'],
      ['rider.quote.from', 'CHANGE'],
    ]);
    expect(intake.stale).toEqual([]);
    expect(Object.keys(intake.proposedLedger.reviewed).sort()).toEqual(['app:fare.total', 'app:rider.quote.from']);
    expect(intake.proposedLedger.reviewed['app:rider.quote.from']?.['ur-Latn']?.text).toBe('Kahan se chalein: {place}');
    expect(intake.proposedLedger.record).toMatchObject({
      reviewer: 'A. Reviewer',
      date: '2026-10-20',
      declaration: REVIEW_DECLARATION,
      exportId: pkg.exportId,
    });

    const staleIntake = intakeFrom({ ...base(pkg, returned(pkg, { 'driver:drive.location.title': ['OK', '', ''] })), current: changed });
    expect(staleIntake.stale).toEqual(['driver:drive.location.title']);
    expect(staleIntake.strings).toEqual([]);
  });

  it('a proposed ledger is valid only after the corrections are applied to the catalogue (the developer step)', () => {
    const intake = intakeFrom(base(pkg, returned(pkg, { 'app:fare.total': ['CHANGE', 'کُل رقم', ''] })));
    const ledger: ReviewLedger = { records: [intake.proposedLedger.record], reviewed: intake.proposedLedger.reviewed };
    expect(ledgerProblems(ledger, tiny)).toEqual(['app:fare.total (ur): catalogue text changed after review']);
    const applied: CatalogueSet = { ...tiny, app: { ...tiny.app, ur: { ...tiny.app.ur, 'fare.total': 'کُل رقم' } } };
    expect(ledgerProblems(ledger, applied)).toEqual([]);
    expect(reviewStatus(ledger, 'app', 'fare.total', 'ur', 'کُل رقم')).toBe('REVIEWED');
  });

  it('alias sheet: only exported aliases; CHANGE needs a corrected alias', () => {
    const [header, ...rows] = parseCsv(aliasesCsv(pkg));
    const at = (n: string): number => (header ?? []).indexOf(n);
    const sheet = (status: string, corrected: string, alias?: string): string =>
      [
        header ?? [],
        ...rows.map((r, i) => {
          const next = [...r];
          if (i === 0) {
            next[at('review_status')] = status;
            next[at('alias_corrected')] = corrected;
            if (alias !== undefined) next[at('alias')] = alias;
          }
          return next;
        }),
      ]
        .map((r) => r.join(','))
        .join('\n');
    const withAliases = (aliases: string) => ({ ...base(pkg, returned(pkg, {})), sheets: { strings: returned(pkg, {}), aliases } });
    expect(intakeFrom(withAliases(sheet('CHANGE', 'liberty mkt.'))).aliases).toEqual([
      { locale: 'en', alias: 'liberty mkt', decision: 'CHANGE', corrected: 'liberty mkt.', note: '' },
    ]);
    expect(() => intakeFrom(withAliases(sheet('CHANGE', '')))).toThrow(/no corrected alias/);
    expect(() => intakeFrom(withAliases(sheet('OK', '', 'gulberg')))).toThrow(/not in this export/);
  });
});
