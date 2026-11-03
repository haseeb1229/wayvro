import type { UiLocale } from './strings';

/**
 * Native-review status of the app's copy (P18/A06/K19; FA-09, docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md §6).
 * Machine-readable and consumed by the catalogue tests and the reviewer export (`scripts/i18n/`).
 *
 * - English is the SOURCE text. Urdu (`ur`) and Roman Urdu (`ur-Latn`) are AI-drafted and PENDING_NATIVE_REVIEW until a
 *   native reviewer returns the exported sheet with their name/initials, the date and the declaration below.
 * - A string becomes REVIEWED only through an entry in `REVIEW_LEDGER.reviewed` that points at a reviewer record AND
 *   repeats the exact reviewed text: if the catalogue text changes afterwards, the string is pending again. The import
 *   script never writes this ledger; a developer adds the record after applying the reviewer's corrections.
 * - AI-generated or AI-corrected copy never counts as reviewed. Nothing is REVIEWED yet (FA-09 OPEN).
 * - Safety, legal, price and permission strings are tagged (`copyFlags`) so the reviewer and the Phase-3 exit gate can
 *   see which ones block P18/A06/K19 until reviewed.
 */
export type CopyCatalogue = 'app' | 'driver';
export type CopyFlag = 'SAFETY' | 'LEGAL' | 'PRICE' | 'PERMISSION';
export type CopyReviewStatus = 'SOURCE' | 'PENDING_NATIVE_REVIEW' | 'REVIEWED';
export type ReviewedLocale = Exclude<UiLocale, 'en'>;
const REVIEWED_LOCALES: readonly ReviewedLocale[] = ['ur', 'ur-Latn'];

/** The sentence a native reviewer signs (FA-09 §6). */
export const REVIEW_DECLARATION = 'I reviewed this personally and did not rely only on machine translation.';

export interface ReviewerRecord {
  readonly id: string;
  /** The reviewer's name or initials, as written on the returned sheet. */
  readonly reviewer: string;
  /** Review date, YYYY-MM-DD. */
  readonly date: string;
  readonly declaration: string;
  readonly locales: readonly ReviewedLocale[];
  /** Fingerprint of the exported package the reviewer worked on (`exportId` of the export manifest). */
  readonly exportId: string;
}

export interface ReviewedEntry {
  readonly recordId: string;
  /** The exact text the reviewer approved; the catalogue must still contain it. */
  readonly text: string;
}

export interface ReviewLedger {
  readonly records: readonly ReviewerRecord[];
  /** `catalogue:key` → locale → reviewed entry. */
  readonly reviewed: Readonly<Record<string, Partial<Record<ReviewedLocale, ReviewedEntry>>>>;
}

/** No string has been natively reviewed yet (FA-09 OPEN, 2026-10-13). */
export const REVIEW_LEDGER: ReviewLedger = { records: [], reviewed: {} };

interface FlagRule {
  readonly catalogue: CopyCatalogue;
  /** A key prefix ("fare.") or an exact key ("common.placeholderNotice"). */
  readonly match: string;
  readonly flags: readonly CopyFlag[];
}

/**
 * Which copy is safety-, legal-, price- or permission-relevant (reviewed with priority; blocks exit until reviewed).
 * @internal exported for the flag-rule tests; code uses copyFlags().
 */
export const FLAG_RULES: readonly FlagRule[] = [
  // app catalogue — legal
  { catalogue: 'app', match: 'common.placeholderNotice', flags: ['LEGAL'] },
  { catalogue: 'app', match: 'phone.legalNote', flags: ['LEGAL'] },
  { catalogue: 'app', match: 'policies.', flags: ['LEGAL'] },
  { catalogue: 'app', match: 'legal.', flags: ['LEGAL'] },
  { catalogue: 'app', match: 'age.', flags: ['LEGAL'] },
  { catalogue: 'app', match: 'deletion.', flags: ['LEGAL'] },
  { catalogue: 'app', match: 'appeal.', flags: ['LEGAL', 'SAFETY'] },
  { catalogue: 'app', match: 'app.blocked.', flags: ['LEGAL'] },
  { catalogue: 'app', match: 'geo.attribution.', flags: ['LEGAL'] },
  // app catalogue — account safety and security
  { catalogue: 'app', match: 'restriction.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'required.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'security.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'accountSecurity.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'stepUp.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'phoneChange.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'phoneNotice.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'lostPhone.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'review.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'otp.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'error.stepUp', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'error.restricted', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'error.sessionExpired', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'app.update.reason.', flags: ['SAFETY'] },
  { catalogue: 'app', match: 'lite.hint', flags: ['SAFETY'] },
  // app catalogue — prices and their explanation
  { catalogue: 'app', match: 'fare.', flags: ['PRICE'] },
  { catalogue: 'app', match: 'money.', flags: ['PRICE'] },
  { catalogue: 'app', match: 'rider.quote.', flags: ['PRICE'] },
  { catalogue: 'app', match: 'rider.unavailable.', flags: ['PRICE'] },
  { catalogue: 'app', match: 'rider.area.', flags: ['PRICE'] },
  { catalogue: 'app', match: 'rider.hours.', flags: ['PRICE'] },
  { catalogue: 'app', match: 'rider.degraded.', flags: ['PRICE'] },
  { catalogue: 'app', match: 'rider.last.', flags: ['PRICE'] },
  { catalogue: 'app', match: 'confidence.', flags: ['PRICE'] },
  { catalogue: 'app', match: 'lite.refreshPrices', flags: ['PRICE'] },
  { catalogue: 'app', match: 'error.serviceArea', flags: ['PRICE'] },
  // app catalogue — permissions
  { catalogue: 'app', match: 'rider.location.', flags: ['PERMISSION'] },
  // Driver/Partner catalogue
  { catalogue: 'driver', match: 'explain.', flags: ['LEGAL'] },
  { catalogue: 'driver', match: 'driver.placeholderSet', flags: ['LEGAL'] },
  { catalogue: 'driver', match: 'driver.riderUnaffected', flags: ['SAFETY'] },
  { catalogue: 'driver', match: 'doc.', flags: ['LEGAL'] },
  { catalogue: 'driver', match: 'claim.', flags: ['LEGAL'] },
  { catalogue: 'driver', match: 'appeal.', flags: ['LEGAL', 'SAFETY'] },
  { catalogue: 'driver', match: 'renewalAppeal.', flags: ['LEGAL', 'SAFETY'] },
  { catalogue: 'driver', match: 'driverRestriction.', flags: ['SAFETY'] },
  { catalogue: 'driver', match: 'blocker.', flags: ['SAFETY'] },
  { catalogue: 'driver', match: 'reason.', flags: ['SAFETY'] },
  { catalogue: 'driver', match: 'challenge.', flags: ['SAFETY'] },
  { catalogue: 'driver', match: 'drive.health.', flags: ['SAFETY'] },
  { catalogue: 'driver', match: 'capture.', flags: ['PERMISSION', 'SAFETY'] },
  { catalogue: 'driver', match: 'drive.location.', flags: ['PERMISSION'] },
];

const ruleMatches = (rule: FlagRule, catalogue: CopyCatalogue, key: string): boolean =>
  rule.catalogue === catalogue && (rule.match.endsWith('.') ? key.startsWith(rule.match) : key === rule.match);

/** Review-priority flags of one key (sorted, no duplicates; empty for ordinary copy). */
export function copyFlags(catalogue: CopyCatalogue, key: string): readonly CopyFlag[] {
  const flags = new Set<CopyFlag>();
  for (const rule of FLAG_RULES) if (ruleMatches(rule, catalogue, key)) for (const flag of rule.flags) flags.add(flag);
  return [...flags].sort();
}

/** @internal exported for the flag-rule tests (every rule must match at least one key). */
export function ruleIsUsed(rule: FlagRule, keys: Readonly<Record<CopyCatalogue, readonly string[]>>): boolean {
  return keys[rule.catalogue].some((key) => ruleMatches(rule, rule.catalogue, key));
}

/** Review status of one string as it is in the catalogue now. */
export function reviewStatus(ledger: ReviewLedger, catalogue: CopyCatalogue, key: string, locale: UiLocale, currentText: string): CopyReviewStatus {
  if (locale === 'en') return 'SOURCE';
  const entry = ledger.reviewed[`${catalogue}:${key}`]?.[locale];
  if (entry === undefined || entry.text !== currentText) return 'PENDING_NATIVE_REVIEW';
  const record = ledger.records.find((r) => r.id === entry.recordId);
  return record !== undefined && recordProblems(record).length === 0 && record.locales.includes(locale) ? 'REVIEWED' : 'PENDING_NATIVE_REVIEW';
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function recordProblems(record: ReviewerRecord): string[] {
  const problems: string[] = [];
  if (record.reviewer.trim().length < 2) problems.push(`record ${record.id}: reviewer name or initials missing`);
  if (!DATE.test(record.date)) problems.push(`record ${record.id}: date must be YYYY-MM-DD`);
  if (record.declaration !== REVIEW_DECLARATION) problems.push(`record ${record.id}: declaration missing or altered`);
  if (record.locales.length === 0) problems.push(`record ${record.id}: no reviewed locale`);
  if (record.exportId.trim() === '') problems.push(`record ${record.id}: export fingerprint missing`);
  return problems;
}

/** @internal the catalogue texts the ledger test checks against */
export type CatalogueTexts = Readonly<Record<CopyCatalogue, Readonly<Record<UiLocale, Readonly<Record<string, string>>>>>>;

/**
 * Everything wrong with a ledger: a REVIEWED entry without a (valid) reviewer record, a record that does not cover the
 * entry's locale, an unknown key, or reviewed text that no longer matches the catalogue. Empty means consistent.
 * @internal exported for the ledger tests (they run on every change, so an invalid REVIEWED mark fails CI).
 */
export function ledgerProblems(ledger: ReviewLedger, catalogues: CatalogueTexts): string[] {
  const problems = ledger.records.flatMap(recordProblems);
  const ids = new Set<string>();
  for (const record of ledger.records) {
    if (ids.has(record.id)) problems.push(`record ${record.id}: duplicate id`);
    ids.add(record.id);
  }
  for (const [qualified, locales] of Object.entries(ledger.reviewed)) {
    const separator = qualified.indexOf(':');
    const catalogue = qualified.slice(0, separator);
    const key = qualified.slice(separator + 1);
    if (catalogue !== 'app' && catalogue !== 'driver') {
      problems.push(`${qualified}: unknown catalogue`);
      continue;
    }
    for (const locale of REVIEWED_LOCALES) {
      const entry = locales[locale];
      if (entry === undefined) continue;
      const current = catalogues[catalogue][locale][key];
      if (current === undefined) problems.push(`${qualified} (${locale}): no such key`);
      else if (current !== entry.text) problems.push(`${qualified} (${locale}): catalogue text changed after review`);
      const record = ledger.records.find((r) => r.id === entry.recordId);
      if (record === undefined) problems.push(`${qualified} (${locale}): marked REVIEWED without a reviewer record`);
      else if (!record.locales.includes(locale)) problems.push(`${qualified} (${locale}): reviewer record ${record.id} does not cover ${locale}`);
    }
  }
  return problems;
}

/**
 * Display-format decisions that need the native reviewer (UX doc §14, §17). The single PKR formatter (`money.ts`) is
 * used for every locale; these choices stay PENDING until FA-09 confirms or changes them.
 */
export const FORMAT_DECISIONS: readonly { readonly id: string; readonly current: string; readonly alternative: string; readonly status: CopyReviewStatus }[] = [
  {
    id: 'pkr.grouping',
    current: 'Thousands grouping in every locale: Rs 1,250 / Rs 125,000',
    alternative: 'Lakh grouping: Rs 1,25,000',
    status: 'PENDING_NATIVE_REVIEW',
  },
  {
    id: 'pkr.digits',
    current: 'Western digits (0-9) in every locale, including Urdu',
    alternative: 'Urdu (Extended Arabic-Indic) digits in Urdu',
    status: 'PENDING_NATIVE_REVIEW',
  },
  { id: 'pkr.symbol', current: '"Rs" before the amount in every locale', alternative: '"روپے" after the amount in Urdu', status: 'PENDING_NATIVE_REVIEW' },
  { id: 'pkr.paisa', current: 'Paisa shown only when non-zero: Rs 640, Rs 640.50', alternative: 'Always whole rupees', status: 'PENDING_NATIVE_REVIEW' },
];
