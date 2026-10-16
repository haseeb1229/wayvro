import { hasRtlLetters } from '../../src/core/i18n/bidi';
import type { CopyFlag } from '../../src/core/i18n/review-status';
import { csvDocument, type CatalogueSet, type ReviewPackage } from './review-package';

/**
 * AUTOMATED PRE-REVIEW of the Urdu (`ur`) and Roman-Urdu (`ur-Latn`) copy (FA-09) — DEVELOPMENT TOOL, never part of the
 * app bundle. Pure functions over the review package (`review-package.ts`) and the typed catalogues: mechanical checks
 * that point a native reviewer at likely problems first. It is NOT a native review: nothing here marks a string
 * REVIEWED, writes the review ledger or changes a status, and every suggestion it makes is labelled NOT REVIEWED.
 * `prereview-export.ts` does the file I/O.
 *
 * Checks (stable codes; severity ERROR = breaks the app or the review tooling, WARN = likely wrong, INFO = confirm):
 * - MISSING        a translation that is missing, empty, an extra key, or the key name itself;
 * - PLACEHOLDER    `{placeholders}` that differ from English (as a multiset) or malformed braces;
 * - UNTRANSLATED   English left in a translation (allow-list below for brand/product names, codes and input masks);
 * - BIDI           typed bidi controls (the app builds isolation marks in code, `bidi.ts`), Urdu sentences whose first
 *                  strong letter is Latin, and literal left-to-right runs that a simplified UAX #9 resolution splits or
 *                  re-orders inside a right-to-left sentence (placeholders are isolated at runtime by `interpolate`);
 * - PUNCTUATION    end punctuation that does not follow English (Urdu "۔" "؟", Roman Urdu "." "?"), ASCII punctuation
 *                  in Urdu, Urdu punctuation in Roman Urdu, "..." instead of "…";
 * - NUMBER         digits that differ from English, Urdu (Arabic-Indic) digits vs the pending `pkr.digits` decision;
 * - CURRENCY       currency words/symbols vs English, and rows that show a PKR amount (pending `pkr.*` decisions);
 * - LENGTH         text longer than the documented layout budget (English + 40 %, UX doc §14 / `max_length`);
 * - TERMINOLOGY    a repeated ride-hailing term rendered differently from the majority rendering (glossary below).
 */

type Severity = 'ERROR' | 'WARN' | 'INFO';
export type CheckId = 'MISSING' | 'PLACEHOLDER' | 'UNTRANSLATED' | 'BIDI' | 'PUNCTUATION' | 'NUMBER' | 'CURRENCY' | 'LENGTH' | 'TERMINOLOGY';
export const CHECKS: readonly CheckId[] = ['MISSING', 'PLACEHOLDER', 'UNTRANSLATED', 'BIDI', 'PUNCTUATION', 'NUMBER', 'CURRENCY', 'LENGTH', 'TERMINOLOGY'];
type TargetLocale = 'ur' | 'ur-Latn';
const TARGETS: readonly TargetLocale[] = ['ur', 'ur-Latn'];

/** @internal exported for unit tests */
export interface Finding {
  readonly check: CheckId;
  /** Stable machine code, e.g. PLACEHOLDER_MISMATCH. */
  readonly code: string;
  readonly severity: Severity;
  readonly catalogue: 'app' | 'driver';
  readonly key: string;
  readonly locale: TargetLocale;
  readonly detail: string;
  /** A pointer for the reviewer. Machine-generated and NOT REVIEWED; never applied automatically. */
  readonly suggestion: string;
}

type Row = ReviewPackage['rows'][number];
const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { ERROR: 0, WARN: 1, INFO: 2 };

// ── text helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
const PLACEHOLDER = /\{(\w+)\}/g;
const withoutPlaceholders = (text: string): string => text.replace(PLACEHOLDER, ' ');
/** Placeholders as a sorted multiset (a repeated `{x}` counts twice). @internal exported for unit tests */
export const placeholderList = (text: string): string[] => [...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '').sort();
const lengthOf = (text: string): number => Array.from(text).length;
/** Text inside straight or typographic quotes: quoted OS labels and typed examples (checked separately). */
const QUOTED = /'[^']*'|"[^"]*"|“[^”]*”|‘[^’]*’/g;

/** A right-to-left LETTER (the Urdu full stop "۔" and question mark "؟" are in the Arabic block but are not letters). */
const isRtlLetter = (ch: string): boolean => /\p{L}/u.test(ch) && hasRtlLetters(ch);
const hasRtlLetter = (text: string): boolean => Array.from(text).some(isRtlLetter);

const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/u;
const toWesternDigits = (text: string): string =>
  text.replace(/[٠-٩۰-۹]/gu, (d) => {
    const code = d.codePointAt(0) ?? 0;
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
const digitGroups = (text: string): string[] => (toWesternDigits(withoutPlaceholders(text)).match(/[0-9]+/g) ?? []).sort();

// ── allow-lists (intentional English / Latin in Urdu script copy) ────────────────────────────────────────────────
/** Brand, product, platform and file-format names, units and codes kept in Latin script on purpose. */
const LATIN_ALLOWED_TOKENS: ReadonlySet<string> = new Set([
  'Wayvro',
  'Google',
  'Apple',
  'Android',
  'iPhone',
  'iOS',
  'OpenStreetMap',
  'JPEG',
  'PNG',
  'MB',
  'LTV',
  'OTP',
  'PKR',
  'Rs',
  'SMS',
  'CNIC',
  'DD',
  'MM',
  'YYYY',
]);
/** Input masks shown as examples: 03XX, XXXXXXX, 3XX, XXXXX-XXXXXXX-X. */
const INPUT_MASK = /^[0-9]*X+(?:-[0-9]*X+)*$/;
/** @internal exported for unit tests. Keys whose text is intentionally not translated (with the reason shown to the reviewer). */
export const UNTRANSLATED_KEYS: Readonly<Record<string, string>> = {
  'app:appName': 'brand name',
  'app:language.en': 'language name written in its own language (endonym)',
  'app:language.ur': 'language name written in its own language (endonym)',
  'app:language.urLatn': 'language name of the Roman-Urdu option',
  'app:geo.attribution.OSM_ODBL': 'map-data licence attribution kept verbatim (confirm with the reviewer and counsel)',
};
/** English function words that are not also Roman-Urdu words ("is", "to", "in", "on", "no" are; they are excluded). */
const ENGLISH_ONLY_WORDS: ReadonlySet<string> = new Set(
  'the and your you please with for this that are will was were has have been of from can cannot should would could we our by it not an or when what which only into before after while again yet than there here its be'.split(
    ' ',
  ),
);

// ── simplified UAX #9 for literal runs inside a right-to-left (Urdu) sentence ────────────────────────────────────
type BidiClass = 'L' | 'R' | 'AL' | 'EN' | 'AN' | 'ES' | 'ET' | 'CS' | 'WS' | 'ON';
const PLACEHOLDER_MARK = String.fromCodePoint(0xe000);
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

function bidiClass(ch: string): BidiClass {
  const code = ch.codePointAt(0) ?? 0;
  if (ch === PLACEHOLDER_MARK) return 'ON'; // an isolated placeholder is a neutral from outside (UAX #9 X5c, BD13)
  if (code >= 0x30 && code <= 0x39) return 'EN';
  if (code >= 0x06f0 && code <= 0x06f9) return 'EN';
  if ((code >= 0x0660 && code <= 0x0669) || code === 0x066b || code === 0x066c) return 'AN';
  if (code === 0x060c) return 'CS';
  if (hasRtlLetters(ch)) return code >= 0x0600 ? 'AL' : 'R';
  if (/\p{L}/u.test(ch)) return 'L';
  if (ch === '+' || ch === '-') return 'ES';
  if (/[#$%°¢£¤¥₨]/u.test(ch)) return 'ET';
  if (/[,.:/]/u.test(ch) || ch === NO_BREAK_SPACE) return 'CS';
  if (/\s/u.test(ch)) return 'WS';
  return 'ON';
}

/** Resolved embedding level (1 = right-to-left, 2 = left-to-right run) of each character of a right-to-left paragraph. */
function rtlLevels(chars: readonly string[]): number[] {
  const original = chars.map(bidiClass);
  const types: BidiClass[] = [...original];
  // W2: European digits after Arabic letters become Arabic numbers; W3: AL → R.
  let lastStrong: BidiClass = 'R';
  for (let i = 0; i < types.length; i += 1) {
    const t = types[i];
    if (t === 'L' || t === 'R' || t === 'AL') lastStrong = t;
    else if (t === 'EN' && lastStrong === 'AL') types[i] = 'AN';
  }
  for (let i = 0; i < types.length; i += 1) if (types[i] === 'AL') types[i] = 'R';
  // W4: a single separator between two numbers of the same kind joins them.
  for (let i = 1; i < types.length - 1; i += 1) {
    const [before, here, after] = [types[i - 1], types[i], types[i + 1]];
    if (here === 'ES' && before === 'EN' && after === 'EN') types[i] = 'EN';
    else if (here === 'CS' && before === after && (before === 'EN' || before === 'AN')) types[i] = before;
  }
  // W5: terminators next to European digits; W6: remaining separators/terminators are neutral.
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] !== 'ET') continue;
    let j = i;
    while (j < types.length && types[j] === 'ET') j += 1;
    const touchesEn = types[i - 1] === 'EN' || types[j] === 'EN';
    for (let k = i; k < j; k += 1) types[k] = touchesEn ? 'EN' : 'ON';
    i = j - 1;
  }
  for (let i = 0; i < types.length; i += 1) if (types[i] === 'ES' || types[i] === 'ET' || types[i] === 'CS') types[i] = 'ON';
  // W7: European digits after Latin letters are Latin.
  lastStrong = 'R';
  for (let i = 0; i < types.length; i += 1) {
    const t = types[i];
    if (t === 'L' || t === 'R') lastStrong = t;
    else if (t === 'EN' && lastStrong === 'L') types[i] = 'L';
  }
  // N1/N2: neutrals between two of the same direction take it (numbers count as R); otherwise the paragraph's (R).
  const direction = (t: BidiClass | undefined): 'L' | 'R' => (t === 'L' ? 'L' : 'R');
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] !== 'ON' && types[i] !== 'WS') continue;
    let j = i;
    while (j < types.length && (types[j] === 'ON' || types[j] === 'WS')) j += 1;
    const resolved = direction(types[i - 1]) === direction(types[j]) ? direction(types[i - 1]) : 'R';
    for (let k = i; k < j; k += 1) types[k] = resolved;
    i = j - 1;
  }
  // I2 at an odd (RTL) level: L, EN and AN go up one level.
  return types.map((t) => (t === 'R' ? 1 : 2));
}

const MIRROR: Readonly<Record<string, string>> = { '(': ')', ')': '(', '[': ']', ']': '[', '<': '>', '>': '<', '«': '»', '»': '«' };
const PAIRED_PUNCTUATION = /[()[\]<>«»'"“”‘’]/u;

/** @internal exported for unit tests */
export interface LtrRunIssue {
  /** The literal run as written (logical order). */
  readonly run: string;
  /** Estimated left-to-right display order on screen (simplified UAX #9). */
  readonly visual: string;
}

/**
 * Literal left-to-right runs (Latin letters or digits between Urdu letters) of an Urdu sentence that the bidi algorithm
 * splits into several pieces or that carry a sign/symbol which moves to the other side. A run that stays one
 * left-to-right piece (with only brackets/quotes around it) is not an issue. Placeholders are runtime-isolated.
 * @internal exported for unit tests
 */
export function rtlRunIssues(text: string): { readonly literalRuns: number; readonly issues: readonly LtrRunIssue[] } {
  const chars = Array.from(text.replace(PLACEHOLDER, PLACEHOLDER_MARK));
  const sentenceIsRtl = hasRtlLetter(text);
  const levels = rtlLevels(chars);
  const classes = chars.map(bidiClass);
  const issues: LtrRunIssue[] = [];
  let literalRuns = 0;
  let i = 0;
  while (i < chars.length) {
    if (classes[i] === 'AL' || classes[i] === 'R') {
      i += 1;
      continue;
    }
    let j = i;
    while (j < chars.length && classes[j] !== 'AL' && classes[j] !== 'R') j += 1;
    // Trim surrounding white space and placeholders ("۔" and "؟" are AL, so they never belong to a run). A run that
    // contains a placeholder is not analysed: the inserted value is isolated, and the literal parts are neutrals around it.
    let start = i;
    let end = j;
    while (start < end && (classes[start] === 'WS' || chars[start] === PLACEHOLDER_MARK)) start += 1;
    while (end > start && (classes[end - 1] === 'WS' || chars[end - 1] === PLACEHOLDER_MARK)) end -= 1;
    const segment = chars.slice(start, end);
    const segmentLevels = levels.slice(start, end);
    const first = segmentLevels.indexOf(2);
    const last = segmentLevels.lastIndexOf(2);
    if (segment.some((ch) => /[\p{L}\p{N}]/u.test(ch)) && !segment.includes(PLACEHOLDER_MARK) && first >= 0) {
      literalRuns += 1;
      let ltrPieces = 0;
      let movedSymbol = false;
      for (let k = 0; k < segment.length; k += 1) {
        if (segmentLevels[k] === 2 && (k === 0 || segmentLevels[k - 1] !== 2)) ltrPieces += 1;
        const ch = segment[k] ?? '';
        if (segmentLevels[k] !== 1 || /\s/u.test(ch) || PAIRED_PUNCTUATION.test(ch)) continue;
        const inside = k > first && k < last;
        // Outside the run, punctuation such as ": " belongs to the Urdu sentence; a sign or symbol touching the run
        // ("+92", "50%") moves to the other side. In Latin-only text every symbol at the edge moves.
        const touching = k === first - 1 || k === last + 1;
        const signLike = /[+\-#$%°¢£¤¥₨©®™]/u.test(ch);
        if (inside || (touching && signLike) || !sentenceIsRtl) movedSymbol = true;
      }
      if (ltrPieces > 1 || movedSymbol) issues.push({ run: segment.join(''), visual: visualOrder(segment, segmentLevels) });
    }
    i = j;
  }
  return { literalRuns, issues };
}

/** Left-to-right display order of a run at level 1 containing level-2 pieces (L2 reordering + mirroring). */
function visualOrder(segment: readonly string[], levels: readonly number[]): string {
  const pieces: string[] = [];
  let k = 0;
  while (k < segment.length) {
    let m = k;
    while (m < segment.length && levels[m] === levels[k]) m += 1;
    const piece = segment.slice(k, m);
    pieces.push(
      levels[k] === 2
        ? piece.join('')
        : [...piece]
            .reverse()
            .map((ch) => MIRROR[ch] ?? ch)
            .join(''),
    );
    k = m;
  }
  return pieces.reverse().join('');
}

/** First strong letter of a text, skipping placeholders (they are first-strong isolates at runtime). */
function firstStrongIsLatin(text: string): boolean {
  for (const ch of withoutPlaceholders(text)) {
    if (isRtlLetter(ch)) return false;
    if (/\p{L}/u.test(ch)) return true;
  }
  return false;
}

/** Bidi controls: ALM, LRM, RLM, LRE…RLO, LRI…PDI (built from code points; never typed as invisible characters). */
const BIDI_CONTROL = new RegExp(
  `[${[0x061c, 0x200e, 0x200f].map((c) => String.fromCodePoint(c)).join('')}${String.fromCodePoint(0x202a)}-${String.fromCodePoint(0x202e)}${String.fromCodePoint(0x2066)}-${String.fromCodePoint(0x2069)}]`,
  'u',
);

// ── terminology ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface TermDefinition {
  readonly id: string;
  readonly en: string;
  readonly pattern: RegExp;
  /** Renderings as currently written in the catalogues: label → pattern. */
  readonly ur: readonly (readonly [string, RegExp])[];
  readonly urLatn: readonly (readonly [string, RegExp])[];
}

/**
 * Repeated ride-hailing and account terms. The renderings are the ones found in the catalogues today (AI-drafted,
 * PENDING native review) — listed to measure consistency, not as approved terminology.
 */
const TERMS: readonly TermDefinition[] = [
  { id: 'fare', en: 'fare', pattern: /\bfares?\b/i, ur: [['کرایہ/کرایے', /کرای[ہے]/u]], urLatn: [['kiraya/kiraye', /\bkiray[ae]\b/i]] },
  { id: 'price', en: 'price', pattern: /\bprices?\b/i, ur: [['قیمت', /قیمت/u]], urLatn: [['qeemat', /\bqeemat/i]] },
  { id: 'pickup', en: 'pickup', pattern: /\bpick-?ups?\b/i, ur: [['پک اپ', /پک اپ/u]], urLatn: [['pickup', /\bpick-?up/i]] },
  { id: 'dropoff', en: 'drop-off', pattern: /\bdrop-?offs?\b/i, ur: [['ڈراپ آف', /ڈراپ آف/u]], urLatn: [['drop-off', /\bdrop-?off/i]] },
  { id: 'destination', en: 'destination', pattern: /\bdestinations?\b/i, ur: [['منزل', /منزل/u]], urLatn: [['manzil', /\bmanzil/i]] },
  { id: 'ride', en: 'ride', pattern: /\brides?\b/i, ur: [['سواری', /سواری/u]], urLatn: [['sawari', /\bsawari/i]] },
  { id: 'trip', en: 'trip', pattern: /\btrips?\b/i, ur: [['سفر', /سفر/u]], urLatn: [['safar', /\bsafar/i]] },
  {
    id: 'rider',
    en: 'rider',
    pattern: /\briders?\b/i,
    ur: [
      ['رائیڈر', /رائیڈر/u],
      ['سوار', /سوار(?!ی)/u],
    ],
    urLatn: [
      ['Rider', /\briders?\b/i],
      ['sawar', /\bsawar(?!i)/i],
    ],
  },
  {
    id: 'driverPartner',
    en: 'Driver/Partner',
    pattern: /Driver\/Partner/,
    ur: [['ڈرائیور/پارٹنر', /ڈرائیور\/پارٹنر/u]],
    urLatn: [['Driver/Partner', /Driver\/Partner/i]],
  },
  { id: 'driver', en: 'driver (alone)', pattern: /\bdrivers?\b(?!\/)/i, ur: [['ڈرائیور', /ڈرائیور(?!\/)/u]], urLatn: [['driver', /\bdrivers?\b(?!\/)/i]] },
  {
    id: 'location',
    en: 'location',
    pattern: /\blocation\b/i,
    ur: [
      ['مقام', /مقام/u],
      ['لوکیشن', /لوکیشن/u],
    ],
    urLatn: [
      ['location', /\blocation/i],
      ['maqam', /\bmaqam/i],
    ],
  },
  { id: 'service', en: 'service', pattern: /\bservices?\b/i, ur: [['سروس', /سروس/u]], urLatn: [['service', /\bservice/i]] },
  { id: 'account', en: 'account', pattern: /\baccounts?\b/i, ur: [['اکاؤنٹ', /اکاؤنٹ/u]], urLatn: [['account', /\baccount/i]] },
  {
    id: 'signIn',
    en: 'sign in',
    pattern: /\bsign(?:ed|ing)?[ -]in\b/i,
    ur: [
      ['سائن اِن', /سائن اِن/u],
      ['سائن ان', /سائن ان/u],
    ],
    urLatn: [['sign in', /\bsign[ -]in\b/i]],
  },
  { id: 'code', en: 'code', pattern: /\bcodes?\b/i, ur: [['کوڈ', /کوڈ/u]], urLatn: [['code', /\bcode/i]] },
  { id: 'phone', en: 'phone', pattern: /\bphones?\b/i, ur: [['فون', /فون/u]], urLatn: [['phone', /\bphone/i]] },
  {
    id: 'vehicle',
    en: 'vehicle',
    pattern: /\bvehicles?\b/i,
    ur: [['گاڑی', /گاڑی|گاڑیاں|گاڑیوں/u]],
    urLatn: [
      ['gari', /\bgari/i],
      ['gaari', /\bgaari/i],
    ],
  },
  {
    id: 'document',
    en: 'document',
    pattern: /\bdocuments?\b/i,
    ur: [['دستاویز', /دستاویز/u]],
    urLatn: [
      ['dastavez', /\bdastavez/i],
      ['dastawez', /\bdastawez/i],
      ['Documents (English word)', /\bdocuments?\b/i],
    ],
  },
  { id: 'licence', en: 'licence', pattern: /\blicen[cs]es?\b/i, ur: [['لائسنس', /لائسنس/u]], urLatn: [['licence', /\blicen[cs]e/i]] },
  { id: 'appeal', en: 'appeal', pattern: /\bappeal/i, ur: [['اپیل', /اپیل/u]], urLatn: [['appeal', /\bappeal/i]] },
  { id: 'restriction', en: 'restriction', pattern: /\brestrict/i, ur: [['پابندی', /پابندی|پابندیاں|پابندیوں/u]], urLatn: [['pabandi', /\bpabandi/i]] },
  { id: 'review', en: 'review', pattern: /\breview/i, ur: [['جائزہ/جائزے', /جائز[ہے]/u]], urLatn: [['jaiza/jaize', /\bjaiz[ae]/i]] },
  { id: 'approved', en: 'approve', pattern: /\bapprov/i, ur: [['منظور', /منظور/u]], urLatn: [['manzoor', /\bmanzoor/i]] },
  { id: 'application', en: 'application', pattern: /\bapplication/i, ur: [['درخواست', /درخواست/u]], urLatn: [['darkhwast', /\bdarkhwast/i]] },
  { id: 'photo', en: 'photo', pattern: /\bphotos?\b/i, ur: [['تصویر/تصاویر', /تصویر|تصاویر/u]], urLatn: [['tasveer/tasaveer', /\btasa?veer/i]] },
  { id: 'selfie', en: 'selfie', pattern: /\bselfies?\b/i, ur: [['سیلفی', /سیلفی/u]], urLatn: [['selfie', /\bselfie/i]] },
  { id: 'earn', en: 'earn', pattern: /\bearn/i, ur: [['کمائی/کمائیں', /کما/u]], urLatn: [['kamai/kamayein', /\bkama/i]] },
  { id: 'online', en: 'online', pattern: /\bonline\b/i, ur: [['آن لائن', /آن لائن/u]], urLatn: [['online', /\bonline/i]] },
  { id: 'offline', en: 'offline', pattern: /\boffline\b/i, ur: [['آف لائن', /آف لائن/u]], urLatn: [['offline', /\boffline/i]] },
  { id: 'map', en: 'map', pattern: /\bmaps?\b/i, ur: [['نقشہ/نقشے', /نقش/u]], urLatn: [['naqsha/naqshe', /\bnaqsh/i]] },
  { id: 'mode', en: 'mode', pattern: /\bmode\b/i, ur: [['موڈ', /موڈ/u]], urLatn: [['mode', /\bmode/i]] },
  { id: 'booking', en: 'book / booking', pattern: /\bbook(?:ing)?\b/i, ur: [['بک/بکنگ', /بک/u]], urLatn: [['book/booking', /\bbook/i]] },
  {
    id: 'wayvro',
    en: 'Wayvro (brand)',
    pattern: /Wayvro/,
    ur: [
      ['وے ورو', /وے ورو/u],
      ['Wayvro', /Wayvro/],
    ],
    urLatn: [['Wayvro', /Wayvro/]],
  },
];

/** @internal exported for unit tests */
export interface GlossaryEntry {
  readonly id: string;
  readonly en: string;
  /** Rows whose English contains the term. */
  readonly rows: number;
  readonly ur: readonly { readonly rendering: string; readonly count: number }[];
  readonly urLatn: readonly { readonly rendering: string; readonly count: number }[];
  /** Rows where none of the listed renderings appears (a paraphrase, an inflection not listed, or a missing term). */
  readonly urUnmatched: number;
  readonly urLatnUnmatched: number;
  readonly consistent: boolean;
}

interface TermUse {
  readonly row: Row;
  readonly ur: readonly string[];
  readonly urLatn: readonly string[];
}

function termUses(term: TermDefinition, rows: readonly Row[]): TermUse[] {
  const uses = (text: string, variants: TermDefinition['ur']): string[] =>
    variants.filter(([, re]) => re.test(withoutPlaceholders(text))).map(([label]) => label);
  return rows
    .filter((r) => term.pattern.test(withoutPlaceholders(r.en)))
    .map((row) => ({ row, ur: uses(row.ur, term.ur), urLatn: uses(row.urLatn, term.urLatn) }));
}

const tally = (labels: readonly string[], lists: readonly (readonly string[])[]): { rendering: string; count: number }[] =>
  labels
    .map((rendering) => ({ rendering, count: lists.filter((l) => l.includes(rendering)).length }))
    .filter((v) => v.count > 0)
    .sort((a, b) => b.count - a.count || a.rendering.localeCompare(b.rendering));

/** @internal exported for unit tests. The glossary: every term's renderings with counts. */
export function glossary(rows: readonly Row[], terms: readonly TermDefinition[] = TERMS): GlossaryEntry[] {
  return terms.map((term) => {
    const uses = termUses(term, rows);
    const ur = tally(
      term.ur.map(([l]) => l),
      uses.map((u) => u.ur),
    );
    const urLatn = tally(
      term.urLatn.map(([l]) => l),
      uses.map((u) => u.urLatn),
    );
    return {
      id: term.id,
      en: term.en,
      rows: uses.length,
      ur,
      urLatn,
      urUnmatched: uses.filter((u) => u.ur.length === 0).length,
      urLatnUnmatched: uses.filter((u) => u.urLatn.length === 0).length,
      consistent: ur.length <= 1 && urLatn.length <= 1,
    };
  });
}

function terminologyFindings(rows: readonly Row[], terms: readonly TermDefinition[]): Finding[] {
  const findings: Finding[] = [];
  for (const term of terms) {
    const uses = termUses(term, rows);
    for (const locale of TARGETS) {
      const lists = uses.map((u) => (locale === 'ur' ? u.ur : u.urLatn));
      const counts = tally(
        (locale === 'ur' ? term.ur : term.urLatn).map(([l]) => l),
        lists,
      );
      const majority = counts[0];
      if (majority === undefined || counts.length < 2) continue;
      const summary = counts.map((c) => `${c.rendering} ×${String(c.count)}`).join(', ');
      uses.forEach((use, index) => {
        const used = lists[index] ?? [];
        if (used.length === 0 || used.includes(majority.rendering)) return;
        findings.push({
          check: 'TERMINOLOGY',
          code: 'TERM_MINORITY_RENDERING',
          severity: 'WARN',
          catalogue: use.row.catalogue,
          key: use.row.key,
          locale,
          detail: `"${term.en}" is written ${used.join(' + ')} here; across the copy: ${summary}.`,
          suggestion: `Decide one rendering of "${term.en}" (most rows use ${majority.rendering}) or confirm the difference is intended here.`,
        });
      });
    }
  }
  return findings;
}

// ── per-row checks ───────────────────────────────────────────────────────────────────────────────────────────────
const END_PUNCTUATION: Readonly<Record<string, Readonly<Record<TargetLocale, string>>>> = {
  '.': { ur: '۔', 'ur-Latn': '.' },
  '?': { ur: '؟', 'ur-Latn': '?' },
  '!': { ur: '!', 'ur-Latn': '!' },
  '…': { ur: '…', 'ur-Latn': '…' },
  ':': { ur: ':', 'ur-Latn': ':' },
};
const lastChar = (text: string): string => Array.from(text.trimEnd()).pop() ?? '';
const endsWithPlaceholder = (text: string): boolean => /\}$/.test(text.trimEnd());

/**
 * The catalogue placeholder that carries a `money.ts`-formatted PKR amount (affected by the pending pkr.* decisions).
 * Most prices are formatted by the view adapters directly, outside the catalogue; those are checked on screenshots.
 */
const AMOUNT_PLACEHOLDER = 'amount';
/** Screen-reader price wording (`money.spoken*`). */
const SPOKEN_PRICE_PREFIX = 'money.spoken';
const CURRENCY_WORD: Readonly<Record<TargetLocale | 'en', RegExp>> = {
  en: /\bRs\b|PKR|rupees?|paisa/i,
  ur: /\bRs\b|PKR|روپ|پیس/u,
  'ur-Latn': /\bRs\b|PKR|rupe|rupay|paisa|paise/i,
};

function rowFindings(row: Row, catalogues: CatalogueSet): Finding[] {
  const out: Finding[] = [];
  const add = (check: CheckId, code: string, severity: Severity, locale: TargetLocale, detail: string, suggestion: string): void => {
    out.push({ check, code, severity, catalogue: row.catalogue, key: row.key, locale, detail, suggestion });
  };
  const qualified = `${row.catalogue}:${row.key}`;
  const allowedUntranslated = UNTRANSLATED_KEYS[qualified];
  const enPlaceholders = placeholderList(row.en);
  const enDigits = digitGroups(row.en);
  const enEnd = endsWithPlaceholder(row.en) ? '' : lastChar(row.en);

  for (const locale of TARGETS) {
    const text = locale === 'ur' ? row.ur : row.urLatn;
    const present = Object.hasOwn(catalogues[row.catalogue][locale], row.key);
    // MISSING
    if (!present) {
      add('MISSING', 'MISSING_KEY', 'ERROR', locale, `No ${locale} text for this key.`, 'Add the translation (it will be PENDING_NATIVE_REVIEW).');
      continue;
    }
    if (text.trim() === '') {
      add('MISSING', 'EMPTY_TEXT', 'ERROR', locale, `The ${locale} text is empty.`, 'Add the translation (it will be PENDING_NATIVE_REVIEW).');
      continue;
    }
    if (text.trim() === row.key) add('MISSING', 'KEY_AS_TEXT', 'ERROR', locale, 'The text is the key name.', 'Replace with a real translation.');

    // PLACEHOLDER
    const ph = placeholderList(text);
    if (ph.join(' ') !== enPlaceholders.join(' '))
      add(
        'PLACEHOLDER',
        'PLACEHOLDER_MISMATCH',
        'ERROR',
        locale,
        `Placeholders {${ph.join('} {')}} differ from English {${enPlaceholders.join('} {')}}.`,
        'Use exactly the English placeholders; the app fills them in.',
      );
    if (/[{}]/.test(text.replace(PLACEHOLDER, '')))
      add('PLACEHOLDER', 'PLACEHOLDER_MALFORMED', 'ERROR', locale, 'A brace that is not part of a {name} placeholder.', 'Fix the braces: {name} only.');

    // BIDI (controls in any locale; the app adds isolation marks in code)
    if (BIDI_CONTROL.test(text))
      add(
        'BIDI',
        'BIDI_CONTROL_IN_TEXT',
        'ERROR',
        locale,
        'A typed bidi control character is in the catalogue text.',
        'Remove it; values are isolated by interpolate() (bidi.ts).',
      );

    const unquoted = withoutPlaceholders(text).replace(QUOTED, ' ');
    if (locale === 'ur') {
      // UNTRANSLATED (Urdu script copy)
      if (allowedUntranslated === undefined) {
        if (text === row.en && /\p{L}/u.test(withoutPlaceholders(row.en)))
          add(
            'UNTRANSLATED',
            'SAME_AS_ENGLISH',
            'WARN',
            locale,
            'The Urdu text is identical to English.',
            'Translate, or add to the allow-list with a reason.',
          );
        else if (!hasRtlLetter(text) && /\p{L}/u.test(withoutPlaceholders(row.en)))
          add('UNTRANSLATED', 'NO_URDU_SCRIPT', 'WARN', locale, 'The Urdu text has no Urdu-script letters.', 'Translate into Urdu script.');
        const latin = [...new Set(unquoted.match(/[0-9]*[A-Za-z][A-Za-z0-9-]*/g) ?? [])].filter((w) => !LATIN_ALLOWED_TOKENS.has(w) && !INPUT_MASK.test(w));
        if (latin.length > 0)
          add(
            'UNTRANSLATED',
            'LATIN_WORD_IN_URDU',
            'WARN',
            locale,
            `Latin-script word(s) not on the allow-list: ${latin.join(', ')}.`,
            'Translate, or confirm it is a name that stays in English.',
          );
        for (const quoted of withoutPlaceholders(text).match(QUOTED) ?? [])
          if (/[A-Za-z]/.test(quoted))
            add(
              'UNTRANSLATED',
              'QUOTED_LATIN',
              'INFO',
              locale,
              `Quoted Latin text ${quoted} (an example or an on-screen label).`,
              'Confirm it should stay in Latin script.',
            );
      }
      // BIDI (Urdu sentence)
      if (hasRtlLetter(text) && firstStrongIsLatin(text))
        add(
          'BIDI',
          'BIDI_FIRST_STRONG_LATIN',
          'WARN',
          locale,
          'The Urdu sentence starts with a Latin word, so a renderer that takes the paragraph direction from the first letter shows it left-to-right.',
          'Start the sentence with an Urdu word, or check it on the device (see the emulator accessibility supplement).',
        );
      for (const issue of rtlRunIssues(text).issues)
        if (hasRtlLetter(text))
          add(
            'BIDI',
            'BIDI_LTR_RUN_REORDERED',
            'WARN',
            locale,
            `The literal run "${issue.run}" is not isolated; in a right-to-left line it displays (left to right) approximately as "${issue.visual}".`,
            'Check on the device; if wrong, move the value into a {placeholder} (isolated at runtime) or reword.',
          );
        else
          add(
            'BIDI',
            'BIDI_LATIN_ONLY_IN_RTL_UI',
            'INFO',
            locale,
            `Latin-only text; if the component forces right-to-left it displays (left to right) approximately as "${issue.visual}".`,
            'Check that this text is shown with left-to-right direction (contentDirection in bidi.ts) on the device.',
          );
      // PUNCTUATION (Urdu)
      const asciiPunct = [...new Set(unquoted.replace(/[A-Za-z0-9]+(?:[.,:/-][A-Za-z0-9]+)*/g, ' ').match(/[?,;]|\.(?!\.)/g) ?? [])];
      if (asciiPunct.length > 0)
        add(
          'PUNCTUATION',
          'ASCII_PUNCTUATION_IN_URDU',
          'WARN',
          locale,
          `ASCII punctuation ${asciiPunct.join(' ')} in Urdu text.`,
          'Use Urdu punctuation: ۔ ، ؟ ؛',
        );
    } else {
      // UNTRANSLATED (Roman Urdu)
      if (allowedUntranslated === undefined) {
        if (text === row.en && /\p{L}/u.test(withoutPlaceholders(row.en)))
          add(
            'UNTRANSLATED',
            'SAME_AS_ENGLISH',
            'INFO',
            locale,
            'The Roman-Urdu text is identical to English.',
            'Confirm the English loanword(s) are what Roman-Urdu readers use.',
          );
        const words = (unquoted.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => ENGLISH_ONLY_WORDS.has(w));
        if (words.length > 0)
          add(
            'UNTRANSLATED',
            'ENGLISH_WORDS_IN_ROMAN_URDU',
            'WARN',
            locale,
            `English-only word(s): ${[...new Set(words)].join(', ')}.`,
            'Translate the English fragment into Roman Urdu.',
          );
        for (const quoted of withoutPlaceholders(text).match(QUOTED) ?? [])
          if (/\b(the|and|all|time|allow)\b/i.test(quoted))
            add(
              'UNTRANSLATED',
              'QUOTED_LATIN',
              'INFO',
              locale,
              `Quoted English text ${quoted} (an on-screen/OS label).`,
              "Confirm it matches the label the user's device shows.",
            );
      }
      if (hasRtlLetter(text) && /[A-Za-z]/.test(withoutPlaceholders(text)))
        add(
          'BIDI',
          'BIDI_RTL_IN_LTR_TEXT',
          'WARN',
          locale,
          'Urdu-script letters inside a left-to-right sentence without isolation.',
          'Move the Urdu text into a {placeholder} (isolated at runtime).',
        );
      if (/[۔،؟؛]/u.test(text))
        add('PUNCTUATION', 'URDU_PUNCTUATION_IN_ROMAN_URDU', 'WARN', locale, 'Urdu punctuation in Roman-Urdu text.', 'Use Latin punctuation: . , ? ;');
    }

    // PUNCTUATION (both)
    const expectedEnd = END_PUNCTUATION[enEnd]?.[locale];
    const actualEnd = endsWithPlaceholder(text) ? '' : lastChar(text);
    if (expectedEnd !== undefined && actualEnd !== expectedEnd)
      add(
        'PUNCTUATION',
        'END_PUNCTUATION_MISMATCH',
        'WARN',
        locale,
        `English ends with "${enEnd}", this text ends with "${actualEnd}".`,
        `End with "${expectedEnd}".`,
      );
    if (expectedEnd === undefined && Object.values(END_PUNCTUATION).some((e) => e[locale] === actualEnd && actualEnd !== ':' && actualEnd !== '!'))
      add(
        'PUNCTUATION',
        'END_PUNCTUATION_EXTRA',
        'WARN',
        locale,
        `English has no end punctuation, this text ends with "${actualEnd}".`,
        'Follow the English (labels and titles have none).',
      );
    if (text.includes('...')) add('PUNCTUATION', 'ASCII_ELLIPSIS', 'WARN', locale, 'Three dots "..." instead of "…".', 'Use the ellipsis character "…".');

    // NUMBER
    const digits = digitGroups(text);
    if (digits.join(' ') !== enDigits.join(' '))
      add(
        'NUMBER',
        'DIGITS_DIFFER',
        'WARN',
        locale,
        `Numbers [${digits.join(', ')}] differ from English [${enDigits.join(', ')}].`,
        'Check that every number matches the English meaning.',
      );
    if (ARABIC_INDIC_DIGIT.test(text))
      add(
        'NUMBER',
        'URDU_DIGITS',
        'WARN',
        locale,
        'Urdu (Arabic-Indic) digits, but the current decision pkr.digits is Western digits everywhere.',
        'Use Western digits until pkr.digits is decided.',
      );

    // CURRENCY
    if (CURRENCY_WORD.en.test(row.en) !== CURRENCY_WORD[locale].test(text))
      add(
        'CURRENCY',
        'CURRENCY_WORD_DIFFERS',
        'WARN',
        locale,
        'Currency word/symbol present in only one of English and this text.',
        'Keep currency wording parallel to English.',
      );

    // LENGTH (documented budget: English + 40 %)
    const length = lengthOf(text);
    if (length > row.maxLength)
      add(
        'LENGTH',
        row.en.length <= 12 ? 'OVER_BUDGET_SHORT_LABEL' : 'OVER_BUDGET',
        row.en.length <= 12 ? 'INFO' : 'WARN',
        locale,
        `${String(length)} characters; the layout budget is ${String(row.maxLength)} (English ${String(row.en.length)} + 40 %).`,
        row.en.length <= 12
          ? 'Short label: +40 % is only a few characters; check the screen for wrapping.'
          : 'Shorten if the meaning allows, or check the screen for wrapping.',
      );
  }

  // CURRENCY (pending decisions apply to every amount the formatter inserts)
  if (enPlaceholders.includes(AMOUNT_PLACEHOLDER))
    for (const locale of TARGETS)
      add(
        'CURRENCY',
        'PKR_FORMAT_PENDING',
        'INFO',
        locale,
        `{${AMOUNT_PLACEHOLDER}} is filled with the money.ts format "Rs 1,250" (Western digits, thousands grouping, "Rs" before).`,
        'Reviewer: confirm or change the pending decisions pkr.grouping, pkr.digits, pkr.symbol and pkr.paisa.',
      );
  if (row.key.startsWith(SPOKEN_PRICE_PREFIX))
    for (const locale of TARGETS)
      add(
        'CURRENCY',
        'SPOKEN_PRICE_WORDING',
        'INFO',
        locale,
        `Screen-reader price wording "${locale === 'ur' ? row.ur : row.urLatn}", while the visible price is "Rs 1,250".`,
        'Reviewer: confirm the spoken currency words match the decision on pkr.symbol.',
      );
  return out;
}

/** Keys present in a translation but not in English (the typed catalogues forbid this; checked for the raw data). */
function extraKeyFindings(catalogues: CatalogueSet): Finding[] {
  const out: Finding[] = [];
  for (const catalogue of ['app', 'driver'] as const)
    for (const locale of TARGETS)
      for (const key of Object.keys(catalogues[catalogue][locale]).sort())
        if (!Object.hasOwn(catalogues[catalogue].en, key))
          out.push({
            check: 'MISSING',
            code: 'EXTRA_KEY',
            severity: 'ERROR',
            catalogue,
            key,
            locale,
            detail: 'This key has no English source text.',
            suggestion: 'Remove it or add the English source.',
          });
  return out;
}

export interface PrereviewResult {
  readonly exportId: string;
  readonly findings: readonly Finding[];
  readonly glossary: readonly GlossaryEntry[];
  readonly counts: {
    readonly rows: number;
    readonly reviewed: number;
    readonly byCheck: Readonly<Record<CheckId, Readonly<Record<Severity, number>>>>;
    readonly byCode: Readonly<Record<string, number>>;
    readonly rowsWithFindings: number;
  };
}

/** Runs every check. Deterministic: the same package gives the same findings in the same order. */
export function prereview(pkg: ReviewPackage, catalogues: CatalogueSet, terms: readonly TermDefinition[] = TERMS): PrereviewResult {
  const findings = [...extraKeyFindings(catalogues), ...pkg.rows.flatMap((r) => rowFindings(r, catalogues)), ...terminologyFindings(pkg.rows, terms)].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      `${a.catalogue}:${a.key}`.localeCompare(`${b.catalogue}:${b.key}`) ||
      a.locale.localeCompare(b.locale) ||
      a.code.localeCompare(b.code) ||
      a.detail.localeCompare(b.detail),
  );
  const byCheck = Object.fromEntries(CHECKS.map((c) => [c, { ERROR: 0, WARN: 0, INFO: 0 }])) as Record<CheckId, Record<Severity, number>>;
  const byCode: Record<string, number> = {};
  for (const f of findings) {
    byCheck[f.check][f.severity] += 1;
    byCode[f.code] = (byCode[f.code] ?? 0) + 1;
  }
  return {
    exportId: pkg.exportId,
    findings,
    glossary: glossary(pkg.rows, terms),
    counts: {
      rows: pkg.rows.length,
      reviewed: pkg.rows.filter((r) => r.urStatus === 'REVIEWED' || r.urLatnStatus === 'REVIEWED').length,
      byCheck,
      byCode: Object.fromEntries(Object.entries(byCode).sort(([a], [b]) => a.localeCompare(b))),
      rowsWithFindings: new Set(findings.map((f) => `${f.catalogue}:${f.key}`)).size,
    },
  };
}

// ── hand-off sheets ──────────────────────────────────────────────────────────────────────────────────────────────
export type PriorityGroup = CopyFlag | 'GENERAL';
export const PRIORITY: readonly PriorityGroup[] = ['SAFETY', 'LEGAL', 'PRICE', 'PERMISSION', 'GENERAL'];

/** The highest-priority group of a row (a row flagged LEGAL and SAFETY is reviewed with the SAFETY rows). */
export function priorityGroup(flags: readonly CopyFlag[]): PriorityGroup {
  return PRIORITY.find((p) => p !== 'GENERAL' && flags.includes(p)) ?? 'GENERAL';
}

/** Columns of the reviewer-priority sheet. The suggestion column is machine-generated and NOT REVIEWED. */
export const PRIORITY_COLUMNS = [
  'priority_rank',
  'priority_group',
  'flags',
  'export_id',
  'catalogue',
  'key',
  'context',
  'max_length',
  'en',
  'ur',
  'ur_length',
  'ur_latn',
  'ur_latn_length',
  'ur_status',
  'ur_latn_status',
  'worst_severity',
  'check_codes',
  'check_details',
  'claude_suggestion_NOT_REVIEWED',
] as const;

const worstSeverity = (findings: readonly Finding[]): Severity | '' =>
  findings.reduce<Severity | ''>((worst, f) => (worst === '' || SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[worst] ? f.severity : worst), '');

/**
 * Every row in review order: SAFETY → LEGAL → PRICE → PERMISSION → GENERAL; inside a group rows with an ERROR, then a
 * WARN, then an INFO finding, then clean rows; then by catalogue and key. The status columns are copied from the
 * export (PENDING_NATIVE_REVIEW) and never changed here.
 */
export function prioritySheet(pkg: ReviewPackage, result: PrereviewResult): string[][] {
  const byRow = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const id = `${f.catalogue}:${f.key}`;
    byRow.set(id, [...(byRow.get(id) ?? []), f]);
  }
  const severityRank = (s: Severity | ''): number => (s === '' ? 3 : SEVERITY_ORDER[s]);
  const ordered = pkg.rows
    .map((row) => ({ row, findings: byRow.get(`${row.catalogue}:${row.key}`) ?? [] }))
    .map((r) => ({ ...r, group: priorityGroup(r.row.flags), worst: worstSeverity(r.findings) }))
    .sort(
      (a, b) =>
        PRIORITY.indexOf(a.group) - PRIORITY.indexOf(b.group) ||
        severityRank(a.worst) - severityRank(b.worst) ||
        `${a.row.catalogue}:${a.row.key}`.localeCompare(`${b.row.catalogue}:${b.row.key}`),
    );
  return ordered.map(({ row, findings, group, worst }, index) => [
    String(index + 1),
    group,
    row.flags.join(' '),
    pkg.exportId,
    row.catalogue,
    row.key,
    row.context,
    String(row.maxLength),
    row.en,
    row.ur,
    String(lengthOf(row.ur)),
    row.urLatn,
    String(lengthOf(row.urLatn)),
    row.urStatus,
    row.urLatnStatus,
    worst,
    [...new Set(findings.map((f) => `${f.locale}:${f.code}`))].join(' '),
    findings.map((f) => `[${f.severity} ${f.locale}] ${f.detail}`).join(' | '),
    [...new Set(findings.filter((f) => f.severity !== 'INFO' || f.check === 'CURRENCY').map((f) => `(${f.locale}) ${f.suggestion}`))].join(' | '),
  ]);
}

const FINDING_COLUMNS = ['severity', 'check', 'code', 'catalogue', 'key', 'locale', 'flags', 'detail', 'claude_suggestion_NOT_REVIEWED'] as const;

export function findingsCsv(pkg: ReviewPackage, result: PrereviewResult): string {
  const flags = new Map(pkg.rows.map((r) => [`${r.catalogue}:${r.key}`, r.flags.join(' ')]));
  return csvDocument(
    FINDING_COLUMNS,
    result.findings.map((f) => [f.severity, f.check, f.code, f.catalogue, f.key, f.locale, flags.get(`${f.catalogue}:${f.key}`) ?? '', f.detail, f.suggestion]),
  );
}

const GLOSSARY_COLUMNS = ['term', 'en', 'rows', 'ur_renderings', 'ur_unmatched', 'ur_latn_renderings', 'ur_latn_unmatched', 'consistent'] as const;

const renderings = (list: GlossaryEntry['ur']): string => list.map((v) => `${v.rendering} ×${String(v.count)}`).join('; ');

export function glossaryCsv(result: PrereviewResult): string {
  return csvDocument(
    GLOSSARY_COLUMNS,
    result.glossary.map((g) => [
      g.id,
      g.en,
      String(g.rows),
      renderings(g.ur),
      String(g.urUnmatched),
      renderings(g.urLatn),
      String(g.urLatnUnmatched),
      g.consistent ? 'yes' : 'NO',
    ]),
  );
}

const mdCell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function glossaryMarkdown(result: PrereviewResult): string {
  const lines = [
    '| Term (en) | Rows | ur (as written, count) | ur unmatched | ur-Latn (as written, count) | ur-Latn unmatched | Consistent |',
    '|---|---:|---|---:|---|---:|---|',
    ...result.glossary.map(
      (g) =>
        `| ${mdCell(g.en)} | ${String(g.rows)} | ${mdCell(renderings(g.ur)) || '—'} | ${String(g.urUnmatched)} | ${mdCell(renderings(g.urLatn)) || '—'} | ${String(g.urLatnUnmatched)} | ${g.consistent ? 'yes' : '**NO**'} |`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/** Count table by check and severity (markdown). */
export function countsMarkdown(result: PrereviewResult): string {
  const lines = [
    '| Check | ERROR | WARN | INFO |',
    '|---|---:|---:|---:|',
    ...CHECKS.map((c) => {
      const s = result.counts.byCheck[c];
      return `| ${c} | ${String(s.ERROR)} | ${String(s.WARN)} | ${String(s.INFO)} |`;
    }),
    '',
    '| Code | Findings |',
    '|---|---:|',
    ...Object.entries(result.counts.byCode).map(([code, n]) => `| ${code} | ${String(n)} |`),
  ];
  return `${lines.join('\n')}\n`;
}
