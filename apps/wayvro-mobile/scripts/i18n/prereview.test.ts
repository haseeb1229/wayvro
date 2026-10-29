import { describe, expect, it } from 'vitest';
import { copyFlags, FORMAT_DECISIONS, REVIEW_LEDGER, reviewStatus, type ReviewLedger } from '../../src/core/i18n/review-status';
import { CATALOGUE } from '../../src/core/i18n/strings';
import { DRIVER_CATALOGUE } from '../../src/features/driver/i18n/driver-strings';
import {
  findingsCsv,
  glossary,
  placeholderList,
  PRIORITY_COLUMNS,
  priorityGroup,
  prioritySheet,
  prereview,
  rtlRunIssues,
  UNTRANSLATED_KEYS,
  type Finding,
  type TermDefinition,
} from './prereview';
import { buildPackage, parseCsv, type CatalogueSet, type ReviewPackage } from './review-package';

const EMPTY: ReviewLedger = { records: [], reviewed: {} };

function pkgOf(catalogues: CatalogueSet, ledger: ReviewLedger = EMPTY): ReviewPackage {
  return buildPackage({
    catalogues,
    flags: copyFlags,
    status: (catalogue, key, locale, text) => reviewStatus(ledger, catalogue, key, locale, text),
    usage: () => [],
    aliases: [],
    formatDecisions: FORMAT_DECISIONS,
  });
}

/** Synthetic catalogue: one clean row and one row per defect class. */
const synthetic: CatalogueSet = {
  app: {
    en: {
      'common.retry': 'Please try again shortly.',
      'rider.quote.from': 'From: {place}',
      'fare.taxIncluded': 'Includes {rate}% tax: {amount}.',
      'otp.body': 'We sent a 6-digit code to {destination}.',
      'phone.hint': 'Format: 03XX XXXXXXX or +92 3XX XXXXXXX',
      'security.event.SIGN_IN_OIDC': 'Signed in with Google',
      'rider.search.empty': 'No places found. Try another name.',
      'policies.title': 'Terms and Privacy Notice',
      'rider.location.title': 'Use your location?',
      'mode.rider': 'Rider',
      'home.riderNote': 'You can keep riding as a rider.',
      'common.saving': 'Saving…',
    },
    ur: {
      'common.retry': 'براہ کرم جلد دوبارہ کوشش کریں۔',
      'rider.quote.from': 'کہاں سے: {plac}',
      'fare.taxIncluded': '{rate}% ٹیکس شامل: {amount}۔',
      'otp.body': 'ہم نے {destination} پر 5 ہندسوں کا کوڈ بھیجا ہے.',
      'phone.hint': 'طریقہ: 03XX XXXXXXX یا +92 3XX XXXXXXX',
      'security.event.SIGN_IN_OIDC': 'Google کے ذریعے سائن اِن',
      'rider.search.empty': 'کوئی جگہ نہیں ملی، دوسرا نام لکھیں, please',
      'policies.title': 'Terms and Privacy Notice',
      'rider.location.title': 'اپنا مقام استعمال کریں؟',
      'mode.rider': 'رائیڈر',
      'home.riderNote': 'آپ بطور سوار سواری جاری رکھ سکتے ہیں۔',
      'common.saving': '',
    },
    'ur-Latn': {
      'common.retry': 'Thori dair baad dobara try karein.',
      'rider.quote.from': 'Kahan se: {place}',
      'fare.taxIncluded': '{rate}% tax shamil: {amount}.',
      'otp.body': 'Hum ne {destination} par 6 hindson ka code bheja hai۔',
      'phone.hint': 'Tareeqa: 03XX XXXXXXX ya +92 3XX XXXXXXX',
      'security.event.SIGN_IN_OIDC': 'Google se sign in',
      'rider.search.empty': 'Koi jagah nahin mili. Please try another name.',
      'policies.title': 'Terms aur Privacy Notice',
      'rider.location.title': 'Apni location istemal karein?',
      'mode.rider': 'Rider',
      'home.riderNote': 'Aap bataur sawar sawari jari rakh sakte hain...',
      'common.saving': 'Mehfooz ho raha hai, aur bhi zyada lamba matn…',
    },
  },
  driver: {
    en: { 'drive.location.title': 'Location' },
    ur: { 'drive.location.title': 'مقام', 'drive.location.extra': 'اضافی' },
    'ur-Latn': { 'drive.location.title': 'Location' },
  },
};

const codesFor = (findings: readonly Finding[], key: string, locale: 'ur' | 'ur-Latn'): string[] =>
  findings
    .filter((f) => f.key === key && f.locale === locale)
    .map((f) => f.code)
    .sort();

describe('FA-09 automated pre-review checks (never a native review)', () => {
  const pkg = pkgOf(synthetic);
  const result = prereview(pkg, synthetic);
  const f = result.findings;

  it('a clean row has no finding', () => {
    expect(codesFor(f, 'common.retry', 'ur')).toEqual([]);
    expect(codesFor(f, 'common.retry', 'ur-Latn')).toEqual([]);
  });

  it('MISSING: empty text and a key without English source are ERRORs', () => {
    expect(codesFor(f, 'common.saving', 'ur')).toEqual(['EMPTY_TEXT']);
    expect(f.find((x) => x.code === 'EXTRA_KEY')).toMatchObject({ catalogue: 'driver', key: 'drive.location.extra', locale: 'ur', severity: 'ERROR' });
  });

  it('PLACEHOLDER: a renamed placeholder is an ERROR; placeholders are compared as a multiset', () => {
    expect(codesFor(f, 'rider.quote.from', 'ur')).toEqual(['PLACEHOLDER_MISMATCH']);
    expect(placeholderList('{a} and {a} {b}')).toEqual(['a', 'a', 'b']);
  });

  it('NUMBER and PUNCTUATION: a changed digit, ASCII full stop in Urdu, Urdu full stop in Roman Urdu, "..."', () => {
    expect(codesFor(f, 'otp.body', 'ur')).toEqual(['ASCII_PUNCTUATION_IN_URDU', 'DIGITS_DIFFER', 'END_PUNCTUATION_MISMATCH']);
    expect(codesFor(f, 'otp.body', 'ur-Latn')).toEqual(['END_PUNCTUATION_MISMATCH', 'URDU_PUNCTUATION_IN_ROMAN_URDU']);
    expect(codesFor(f, 'home.riderNote', 'ur-Latn')).toContain('ASCII_ELLIPSIS');
  });

  it('UNTRANSLATED: English left in Urdu or Roman Urdu; allow-listed names and input masks are not flagged', () => {
    expect(codesFor(f, 'policies.title', 'ur')).toEqual(['LATIN_WORD_IN_URDU', 'SAME_AS_ENGLISH']);
    expect(codesFor(f, 'rider.search.empty', 'ur')).toEqual(['ASCII_PUNCTUATION_IN_URDU', 'END_PUNCTUATION_MISMATCH', 'LATIN_WORD_IN_URDU']);
    expect(f.find((x) => x.key === 'rider.search.empty' && x.code === 'LATIN_WORD_IN_URDU')?.detail).toMatch(/please/);
    expect(codesFor(f, 'rider.search.empty', 'ur-Latn')).toEqual(['ENGLISH_WORDS_IN_ROMAN_URDU']);
    expect(codesFor(f, 'phone.hint', 'ur')).not.toContain('LATIN_WORD_IN_URDU');
    expect(codesFor(f, 'drive.location.title', 'ur-Latn')).toEqual(['SAME_AS_ENGLISH']);
    expect(f.find((x) => x.key === 'drive.location.title' && x.locale === 'ur-Latn')?.severity).toBe('INFO');
  });

  it('BIDI: a Latin first word in an Urdu sentence and a phone mask that splits in a right-to-left line', () => {
    expect(codesFor(f, 'security.event.SIGN_IN_OIDC', 'ur')).toEqual(['BIDI_FIRST_STRONG_LATIN']);
    expect(codesFor(f, 'phone.hint', 'ur')).toEqual(['BIDI_LTR_RUN_REORDERED']);
  });

  it('BIDI: a bidi control typed into catalogue text is an ERROR (isolation is added by interpolate at runtime)', () => {
    const fsi = String.fromCodePoint(0x2068);
    const typed: CatalogueSet = {
      app: {
        en: { 'common.retry': 'Please try again shortly.' },
        ur: { 'common.retry': `${fsi}براہ کرم جلد دوبارہ کوشش کریں۔` },
        'ur-Latn': { 'common.retry': 'Thori dair baad dobara try karein.' },
      },
      driver: { en: {}, ur: {}, 'ur-Latn': {} },
    };
    const found = prereview(pkgOf(typed), typed).findings.filter((x) => x.code === 'BIDI_CONTROL_IN_TEXT');
    expect(found.map((x) => [x.locale, x.severity])).toEqual([['ur', 'ERROR']]);
  });

  it('CURRENCY: an {amount} row records the pending PKR format decisions (INFO, both locales)', () => {
    expect(codesFor(f, 'fare.taxIncluded', 'ur')).toEqual(['PKR_FORMAT_PENDING']);
    expect(codesFor(f, 'fare.taxIncluded', 'ur-Latn')).toEqual(['PKR_FORMAT_PENDING']);
  });

  it('LENGTH: text over the documented English + 40 % budget', () => {
    expect(codesFor(f, 'common.saving', 'ur-Latn')).toEqual(['OVER_BUDGET_SHORT_LABEL']);
  });

  it('TERMINOLOGY: the glossary counts renderings and flags the minority one', () => {
    const terms: TermDefinition[] = [
      {
        id: 'rider',
        en: 'rider',
        pattern: /\briders?\b/i,
        ur: [
          ['رائیڈر', /رائیڈر/u],
          ['سوار', /سوار(?!ی)/u],
        ],
        urLatn: [
          ['Rider', /\brider/i],
          ['sawar', /\bsawar(?!i)/i],
        ],
      },
    ];
    const extra: CatalogueSet = {
      ...synthetic,
      app: {
        en: { ...synthetic.app.en, 'mode.switchToRider': 'Switch to Rider mode' },
        ur: { ...synthetic.app.ur, 'mode.switchToRider': 'رائیڈر موڈ پر جائیں' },
        'ur-Latn': { ...synthetic.app['ur-Latn'], 'mode.switchToRider': 'Rider mode par jayein' },
      },
    };
    const extraPkg = pkgOf(extra);
    expect(glossary(extraPkg.rows, terms)).toEqual([
      {
        id: 'rider',
        en: 'rider',
        rows: 3,
        ur: [
          { rendering: 'رائیڈر', count: 2 },
          { rendering: 'سوار', count: 1 },
        ],
        urLatn: [
          { rendering: 'Rider', count: 2 },
          { rendering: 'sawar', count: 1 },
        ],
        urUnmatched: 0,
        urLatnUnmatched: 0,
        consistent: false,
      },
    ]);
    const minority = prereview(extraPkg, extra, terms).findings.filter((x) => x.code === 'TERM_MINORITY_RENDERING');
    expect(minority.map((x) => `${x.key}:${x.locale}`)).toEqual(['home.riderNote:ur', 'home.riderNote:ur-Latn']);
  });

  it('literal runs in a right-to-left sentence: split or moved signs are issues; one clean run is not', () => {
    expect(rtlRunIssues('یا +92 3XX XXXXXXX').issues).toEqual([{ run: '+92 3XX XXXXXXX', visual: '3XX XXXXXXX 92+' }]);
    expect(rtlRunIssues('زیادہ سے زیادہ 10 MB۔').issues).toEqual([{ run: '10 MB', visual: 'MB 10' }]);
    expect(rtlRunIssues("جیسے 'Liberty Market' یا 'Gulberg 3'۔").issues).toEqual([]);
    expect(rtlRunIssues('طریقہ: XXXXX-XXXXXXX-X').issues).toEqual([]);
    expect(rtlRunIssues('سال (YYYY)').issues).toEqual([]);
    expect(rtlRunIssues('ہم نے {destination} پر 6 ہندسوں کا کوڈ بھیجا ہے۔')).toEqual({ literalRuns: 1, issues: [] });
    expect(rtlRunIssues('© OpenStreetMap contributors').issues).toEqual([{ run: '© OpenStreetMap contributors', visual: 'OpenStreetMap contributors ©' }]);
  });

  it('priority sheet: SAFETY → LEGAL → PRICE → PERMISSION → GENERAL, statuses copied, suggestion column separate', () => {
    expect(priorityGroup(['LEGAL', 'SAFETY'])).toBe('SAFETY');
    expect(priorityGroup([])).toBe('GENERAL');
    const sheet = prioritySheet(pkg, result);
    const at = (name: (typeof PRIORITY_COLUMNS)[number]): number => PRIORITY_COLUMNS.indexOf(name);
    expect(sheet).toHaveLength(pkg.rows.length);
    const groups = sheet.map((r) => r[at('priority_group')]);
    expect(groups).toEqual(
      [...groups].sort(
        (a, b) =>
          ['SAFETY', 'LEGAL', 'PRICE', 'PERMISSION', 'GENERAL'].indexOf(a ?? '') - ['SAFETY', 'LEGAL', 'PRICE', 'PERMISSION', 'GENERAL'].indexOf(b ?? ''),
      ),
    );
    expect(groups[0]).toBe('SAFETY');
    expect(sheet.map((r) => r[at('priority_rank')])).toEqual(sheet.map((_, i) => String(i + 1)));
    for (const r of sheet) {
      expect(r[at('ur_status')]).toBe('PENDING_NATIVE_REVIEW');
      expect(r[at('ur_latn_status')]).toBe('PENDING_NATIVE_REVIEW');
    }
    expect(PRIORITY_COLUMNS.at(-1)).toBe('claude_suggestion_NOT_REVIEWED');
    expect(PRIORITY_COLUMNS).not.toContain('review_status');
    expect(parseCsv(findingsCsv(pkg, result))[0]?.at(-1)).toBe('claude_suggestion_NOT_REVIEWED');
  });

  it('is deterministic and never marks anything reviewed', () => {
    expect(prereview(pkgOf(synthetic), synthetic)).toEqual(result);
    expect(result.counts.reviewed).toBe(0);
    expect(result.counts.byCheck.MISSING.ERROR).toBe(2);
  });
});

describe('FA-09 pre-review of the real catalogues (mechanical regression guard)', () => {
  const catalogues: CatalogueSet = { app: CATALOGUE, driver: DRIVER_CATALOGUE };
  const pkg = pkgOf(catalogues, REVIEW_LEDGER);
  const result = prereview(pkg, catalogues);

  it('has no ERROR: no missing or extra key, no placeholder mismatch or malformed brace, no typed bidi control', () => {
    expect(result.findings.filter((x) => x.severity === 'ERROR').map((x) => `${x.catalogue}:${x.key} ${x.locale} ${x.code}`)).toEqual([]);
  });

  it('copies the ledger status unchanged (the pre-review is not a review)', () => {
    const sheet = prioritySheet(pkg, result);
    const at = (name: (typeof PRIORITY_COLUMNS)[number]): number => PRIORITY_COLUMNS.indexOf(name);
    const status = new Map(pkg.rows.map((r) => [`${r.catalogue}:${r.key}`, `${r.urStatus}|${r.urLatnStatus}`]));
    for (const r of sheet)
      expect(`${r[at('ur_status')] ?? ''}|${r[at('ur_latn_status')] ?? ''}`).toBe(status.get(`${r[at('catalogue')] ?? ''}:${r[at('key')] ?? ''}`));
  });

  it('every intentionally untranslated key exists', () => {
    for (const qualified of Object.keys(UNTRANSLATED_KEYS)) {
      const [catalogue, key] = qualified.split(':') as ['app' | 'driver', string];
      expect(Object.hasOwn(catalogues[catalogue].en, key), qualified).toBe(true);
    }
  });
});
