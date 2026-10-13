import { createHash } from 'node:crypto';
import type { CopyCatalogue, CopyFlag, CopyReviewStatus, ReviewedEntry, ReviewedLocale, ReviewerRecord } from '../../src/core/i18n/review-status';
import type { UiLocale } from '../../src/core/i18n/strings';

/**
 * Native-review package (FA-09; docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md §6) — DEVELOPMENT TOOL, never part of the
 * app bundle. Pure functions: rows from the typed catalogues, CSV/JSON rendering, CSV parsing and validation of a
 * returned sheet. `export.ts` and `import-review.ts` do the file I/O. Nothing here marks any string as reviewed.
 */

/** Layout budget given to the reviewer: the English length + 40 % (UX doc §14 text-expansion tolerance). */
const EXPANSION = 1.4;

export interface CatalogueSet {
  readonly app: Readonly<Record<UiLocale, Readonly<Record<string, string>>>>;
  readonly driver: Readonly<Record<UiLocale, Readonly<Record<string, string>>>>;
}

interface ReviewRow {
  readonly catalogue: CopyCatalogue;
  readonly key: string;
  /** Source files that show this key (relative to src/). */
  readonly screens: readonly string[];
  readonly context: string;
  readonly flags: readonly CopyFlag[];
  readonly maxLength: number;
  readonly placeholders: readonly string[];
  readonly en: string;
  readonly ur: string;
  readonly urLatn: string;
  readonly urStatus: CopyReviewStatus;
  readonly urLatnStatus: CopyReviewStatus;
}

export interface AliasRow {
  readonly locale: string;
  readonly alias: string;
  readonly canonicalQuery: string;
  readonly place: string;
  readonly status: 'PROPOSED';
}

export interface ReviewPackage {
  /** sha-256 of the rows and aliases (stable: the same catalogues always give the same id). */
  readonly exportId: string;
  readonly rows: readonly ReviewRow[];
  readonly aliases: readonly AliasRow[];
  readonly formatDecisions: readonly { readonly id: string; readonly current: string; readonly alternative: string; readonly status: CopyReviewStatus }[];
}

/** Where a key is shown, by namespace (most specific prefix wins). */
const CONTEXT: readonly (readonly [CopyCatalogue, string, string])[] = [
  ['app', 'common.', 'Shared: buttons and notices used on many screens'],
  ['app', 'error.', 'Shared: error messages'],
  ['app', 'config.', 'Start-up: build not connected to a service'],
  ['app', 'startup.', 'Start-up screen'],
  ['app', 'language.', 'Language choice'],
  ['app', 'phone.', 'Sign-in: phone number entry'],
  ['app', 'otp.', 'Sign-in: SMS code entry'],
  ['app', 'policies.', 'Policy acceptance (Terms, Privacy Notice, Driver/Partner policies)'],
  ['app', 'legal.', 'Legal and policies list'],
  ['app', 'age.', 'Age declaration'],
  ['app', 'required.', 'Required account step'],
  ['app', 'home.', 'Account home'],
  ['app', 'restriction.', 'Account restriction notices'],
  ['app', 'profile.', 'Profile editing'],
  ['app', 'sessions.', 'Signed-in devices'],
  ['app', 'security.', 'Security activity list'],
  ['app', 'accountSecurity.', 'Phone number and account settings'],
  ['app', 'stepUp.', 'Confirm-it-is-you code step'],
  ['app', 'phoneChange.', 'Change phone number'],
  ['app', 'phoneNotice.', 'Phone number change in progress notice'],
  ['app', 'lostPhone.', 'Lost old number request'],
  ['app', 'review.', 'Is-this-your-account check'],
  ['app', 'deletion.', 'Account deletion'],
  ['app', 'appeal.', 'Restriction appeal'],
  ['app', 'app.update.', 'Release control: update required (blocking)'],
  ['app', 'app.blocked.', 'Release control: blocking screen escape links'],
  ['app', 'app.maintenance.', 'Release control: planned maintenance (blocking)'],
  ['app', 'app.softUpdate.', 'Release control: optional update banner'],
  ['app', 'mode.', 'Rider / Driver-Partner mode switch'],
  ['app', 'lite.', 'Lite mode (low data)'],
  ['app', 'money.', 'Spoken prices (screen reader only)'],
  ['app', 'geo.', 'Map data attribution'],
  ['app', 'product.', 'Service names on price options'],
  ['app', 'luggage.', 'Luggage size on price options'],
  ['app', 'confidence.', 'Route confidence badge on prices'],
  ['app', 'rider.home.', 'Rider home (/ride)'],
  ['app', 'rider.chip.', 'Rider home: Driver/Partner application chip'],
  ['app', 'rider.offline.', 'Rider: offline notices'],
  ['app', 'rider.degraded.', 'Rider: service degraded notices'],
  ['app', 'rider.disabled.', 'Rider: price checks unavailable'],
  ['app', 'rider.last.', 'Rider home: last price check card'],
  ['app', 'rider.location.', 'Rider: location permission explanation and states'],
  ['app', 'rider.pin.', 'Rider: set pickup point (/ride/pin)'],
  ['app', 'rider.place.', 'Rider: place needs choosing again'],
  ['app', 'rider.search.', 'Rider: where-to search (/ride/search)'],
  ['app', 'rider.quote.', 'Rider: price options (/ride/quote)'],
  ['app', 'rider.unavailable.', 'Rider: unavailable service row on price options'],
  ['app', 'rider.area.', 'Rider: outside service area'],
  ['app', 'rider.hours.', 'Rider: outside service hours'],
  ['app', 'fare.', 'Rider: fare details (/ride/fare)'],
  ['driver', 'driver.', 'Driver/Partner: shared'],
  ['driver', 'explain.', 'Driver/Partner: before you apply (what is collected, why, who decides)'],
  ['driver', 'overview.', 'Driver/Partner: application overview'],
  ['driver', 'details.', 'Driver/Partner: personal details form'],
  ['driver', 'vehicle.', 'Driver/Partner: vehicle form'],
  ['driver', 'docs.', 'Driver/Partner: documents list'],
  ['driver', 'doc.', 'Driver/Partner: document names'],
  ['driver', 'claim.', 'Driver/Partner: document details form'],
  ['driver', 'capture.', 'Driver/Partner: camera and selfie capture'],
  ['driver', 'challenge.', 'Driver/Partner: optional selfie action'],
  ['driver', 'evidence.', 'Driver/Partner: photo upload states'],
  ['driver', 'status.', 'Driver/Partner: application status'],
  ['driver', 'reason.', 'Driver/Partner: reviewer reasons'],
  ['driver', 'appeal.', 'Driver/Partner: appeal a decision'],
  ['driver', 'compliance.', 'Driver/Partner: status and documents (compliance)'],
  ['driver', 'blocker.', 'Driver/Partner: what blocks earning'],
  ['driver', 'driverRestriction.', 'Driver/Partner: restrictions'],
  ['driver', 'renewal.', 'Driver/Partner: document renewal'],
  ['driver', 'renewalAppeal.', 'Driver/Partner: renewal appeal'],
  ['driver', 'renewalStatus.', 'Driver/Partner: renewal status'],
  ['driver', 'docStatus.', 'Driver/Partner: document status'],
  ['driver', 'profileState.', 'Driver/Partner: profile state'],
  ['driver', 'category.', 'Driver/Partner: vehicle category names'],
  ['driver', 'city.', 'City names'],
  ['driver', 'date.', 'Date entry fields'],
  ['driver', 'drive.row.', 'Driver home: readiness rows (/drive)'],
  ['driver', 'drive.mark.', 'Driver home: readiness marks'],
  ['driver', 'drive.eligibility.', 'Driver: eligibility per service (/drive/eligibility)'],
  ['driver', 'drive.health.', 'Driver: restrictions and health (/drive/health)'],
  ['driver', 'drive.location.', 'Driver: location explanation (/drive/location)'],
  ['driver', 'drive.', 'Driver home (/drive)'],
];

/** @internal exported for unit tests */
export function contextOf(catalogue: CopyCatalogue, key: string): string {
  let best: string | null = null;
  let bestLength = -1;
  for (const [c, prefix, text] of CONTEXT)
    if (c === catalogue && key.startsWith(prefix) && prefix.length > bestLength) {
      best = text;
      bestLength = prefix.length;
    }
  return best ?? 'General';
}

const placeholdersOf = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''))].sort();

/**
 * Which source files show a key: literal uses (`'rider.quote.title'`) plus template-built keys
 * (`` `rider.unavailable.${code}` `` covers every `rider.unavailable.*` key).
 */
export function keyUsage(sources: readonly { readonly file: string; readonly code: string }[]): (key: string) => string[] {
  const literal = new Map<string, Set<string>>();
  const prefixes = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, k: string, file: string): void => {
    const set = map.get(k) ?? new Set<string>();
    set.add(file);
    map.set(k, set);
  };
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/['"]([a-zA-Z][\w]*(?:\.[\w-]+)+)['"]/g)) add(literal, m[1] ?? '', file);
    for (const m of code.matchAll(/`([a-zA-Z][\w]*(?:\.[\w-]+)*\.)\$\{/g)) add(prefixes, m[1] ?? '', file);
  }
  return (key) => {
    const files = new Set(literal.get(key) ?? []);
    for (const [prefix, set] of prefixes) if (key.startsWith(prefix)) for (const f of set) files.add(f);
    return [...files].sort();
  };
}

/** The export id: sha-256 of the package content (rows, aliases, format decisions) exactly as serialised. */
export function packageId(content: { readonly rows: unknown; readonly aliases: unknown; readonly formatDecisions: unknown }): string {
  const text = JSON.stringify({ rows: content.rows, aliases: content.aliases, formatDecisions: content.formatDecisions });
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function buildPackage(input: {
  readonly catalogues: CatalogueSet;
  readonly flags: (catalogue: CopyCatalogue, key: string) => readonly CopyFlag[];
  readonly status: (catalogue: CopyCatalogue, key: string, locale: UiLocale, text: string) => CopyReviewStatus;
  readonly usage: (key: string) => string[];
  readonly aliases: readonly AliasRow[];
  readonly formatDecisions: ReviewPackage['formatDecisions'];
}): ReviewPackage {
  const rows: ReviewRow[] = [];
  for (const catalogue of ['app', 'driver'] as const) {
    const texts = input.catalogues[catalogue];
    for (const key of Object.keys(texts.en).sort()) {
      const en = texts.en[key] ?? '';
      const ur = texts.ur[key] ?? '';
      const urLatn = texts['ur-Latn'][key] ?? '';
      rows.push({
        catalogue,
        key,
        screens: input.usage(key),
        context: contextOf(catalogue, key),
        flags: input.flags(catalogue, key),
        maxLength: Math.ceil(en.length * EXPANSION),
        placeholders: placeholdersOf(en),
        en,
        ur,
        urLatn,
        urStatus: input.status(catalogue, key, 'ur', ur),
        urLatnStatus: input.status(catalogue, key, 'ur-Latn', urLatn),
      });
    }
  }
  const aliases = [...input.aliases].sort((a, b) => `${a.locale}|${a.alias}`.localeCompare(`${b.locale}|${b.alias}`));
  const exportId = packageId({ rows, aliases, formatDecisions: input.formatDecisions });
  return { exportId, rows, aliases, formatDecisions: input.formatDecisions };
}

// ── CSV (RFC 4180; UTF-8 with BOM so spreadsheet tools keep Urdu script intact) ────────────────────────────────────
const BOM = String.fromCodePoint(0xfeff);

/** Columns the reviewer fills in (left empty in the export). */
const REVIEWER_COLUMNS = ['review_status', 'ur_corrected', 'ur_latn_corrected', 'reviewer_note'] as const;

/** Columns of the strings sheet. @internal exported for unit tests */
export const STRING_COLUMNS = [
  'export_id',
  'catalogue',
  'key',
  'context',
  'screens',
  'flags',
  'max_length',
  'placeholders',
  'en',
  'ur',
  'ur_latn',
  'ur_status',
  'ur_latn_status',
  ...REVIEWER_COLUMNS,
] as const;

const ALIAS_COLUMNS = ['export_id', 'locale', 'alias', 'canonical_query', 'place', 'status', 'review_status', 'alias_corrected', 'reviewer_note'] as const;

const cell = (value: string): string => (/[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value);
const line = (values: readonly string[]): string => values.map(cell).join(',');

export function stringsCsv(pkg: ReviewPackage): string {
  const body = pkg.rows.map((r) =>
    line([
      pkg.exportId,
      r.catalogue,
      r.key,
      r.context,
      r.screens.join(' '),
      r.flags.join(' '),
      String(r.maxLength),
      r.placeholders.join(' '),
      r.en,
      r.ur,
      r.urLatn,
      r.urStatus,
      r.urLatnStatus,
      '',
      '',
      '',
      '',
    ]),
  );
  return `${BOM}${[line(STRING_COLUMNS), ...body].join('\r\n')}\r\n`;
}

export function aliasesCsv(pkg: ReviewPackage): string {
  const body = pkg.aliases.map((a) => line([pkg.exportId, a.locale, a.alias, a.canonicalQuery, a.place, a.status, '', '', '']));
  return `${BOM}${[line(ALIAS_COLUMNS), ...body].join('\r\n')}\r\n`;
}

/** Parses RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF, optional BOM) into rows of cells. @internal exported for unit tests */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charAt(i);
    if (quoted) {
      if (ch === '"' && input.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input.charAt(i + 1) === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('CSV: unterminated quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** CSV rows as objects keyed by header; refuses a sheet whose header lacks a required column. @internal exported for unit tests */
export function csvRecords(text: string, required: readonly string[]): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (header === undefined) throw new Error('CSV: empty sheet');
  const names = header.map((h) => h.trim());
  const missing = required.filter((c) => !names.includes(c));
  if (missing.length > 0) throw new Error(`CSV: missing column(s) ${missing.join(', ')}`);
  return rows.map((cells) => Object.fromEntries(names.map((name, i) => [name, cells[i] ?? ''])));
}

// ── returned sheet → intake (never a REVIEWED mark) ────────────────────────────────────────────────────────────────
type RowDecision = 'OK' | 'CHANGE' | 'QUESTION';

interface StringIntake {
  readonly catalogue: CopyCatalogue;
  readonly key: string;
  readonly decision: RowDecision;
  readonly ur: string | null;
  readonly urLatn: string | null;
  readonly note: string;
}

interface AliasIntake {
  readonly locale: string;
  readonly alias: string;
  readonly decision: RowDecision;
  readonly corrected: string | null;
  readonly note: string;
}

export interface Intake {
  readonly reviewer: string;
  readonly date: string;
  readonly declaration: string;
  readonly exportId: string;
  /** Always false: the import never marks anything reviewed (a developer edits REVIEW_LEDGER after applying changes). */
  readonly markedReviewed: false;
  readonly strings: readonly StringIntake[];
  /** Rows whose catalogue text changed after the export (not usable; re-export and re-review them). */
  readonly stale: readonly string[];
  readonly aliases: readonly AliasIntake[];
  /** A ledger fragment for the developer to paste ONLY after applying every CHANGE (text must then match). */
  readonly proposedLedger: {
    readonly record: ReviewerRecord;
    readonly reviewed: Readonly<Record<string, Partial<Record<ReviewedLocale, ReviewedEntry>>>>;
  };
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DECISIONS: readonly RowDecision[] = ['OK', 'CHANGE', 'QUESTION'];

/** The reviewer's decision for a row: null when left blank (not reviewed); anything but OK/CHANGE/QUESTION refuses. */
function decisionOf(raw: string | undefined, id: string): RowDecision | null {
  const value = (raw ?? '').trim().toUpperCase();
  if (value === '') return null;
  const decision = DECISIONS.find((d) => d === value);
  if (decision === undefined) throw new Error(`refused: ${id} has review_status "${value}" (use OK, CHANGE or QUESTION)`);
  return decision;
}

/** The parts of an export the returned sheet is checked against. */
export interface ExportedPackage {
  readonly exportId: string;
  readonly rows: readonly Pick<ReviewRow, 'catalogue' | 'key' | 'en' | 'ur' | 'urLatn' | 'placeholders'>[];
  readonly aliases: readonly Pick<AliasRow, 'locale' | 'alias'>[];
}

export interface ReturnedSheets {
  readonly strings: string;
  readonly aliases: string | null;
}

/**
 * Validates a returned review against the export it came from and the CURRENT catalogues. Throws (refuses the whole
 * import) on: no reviewer name, a bad date, a missing/altered declaration, a key or alias that is not in the export, a
 * row from another export, duplicate rows, an unknown decision, a CHANGE without corrected text, or corrected text whose
 * {placeholders} differ from English. Rows whose catalogue text changed after the export are listed as stale.
 */
export function intakeFrom(input: {
  readonly reviewer: string;
  readonly date: string;
  readonly declaration: string;
  readonly requiredDeclaration: string;
  readonly exported: ExportedPackage;
  readonly current: ExportedPackage;
  readonly sheets: ReturnedSheets;
}): Intake {
  const reviewer = input.reviewer.trim();
  if (reviewer.length < 2) throw new Error('refused: --reviewer "<name or initials>" is required (the person who reviewed the sheet)');
  if (!DATE.test(input.date)) throw new Error('refused: --date YYYY-MM-DD (the review date written on the sheet) is required');
  if (input.declaration !== input.requiredDeclaration) throw new Error(`refused: the reviewer's declaration must be exactly: "${input.requiredDeclaration}"`);

  const exportedRows = new Map(input.exported.rows.map((r) => [`${r.catalogue}:${r.key}`, r]));
  const currentRows = new Map(input.current.rows.map((r) => [`${r.catalogue}:${r.key}`, r]));
  const strings: StringIntake[] = [];
  const stale: string[] = [];
  const seen = new Set<string>();
  for (const rec of csvRecords(input.sheets.strings, STRING_COLUMNS)) {
    const id = `${rec['catalogue'] ?? ''}:${rec['key'] ?? ''}`;
    if (rec['export_id'] !== input.exported.exportId) throw new Error(`refused: ${id} comes from another export (${rec['export_id'] ?? ''})`);
    const exported = exportedRows.get(id);
    if (exported === undefined) throw new Error(`refused: ${id} is not a key of this export`);
    if (seen.has(id)) throw new Error(`refused: ${id} appears twice`);
    seen.add(id);
    const decision = decisionOf(rec['review_status'], id);
    if (decision === null) continue;
    const ur = (rec['ur_corrected'] ?? '').trim() || null;
    const urLatn = (rec['ur_latn_corrected'] ?? '').trim() || null;
    if (decision === 'CHANGE' && ur === null && urLatn === null) throw new Error(`refused: ${id} is CHANGE but has no corrected text`);
    for (const text of [ur, urLatn])
      if (text !== null && placeholdersOf(text).join(' ') !== exported.placeholders.join(' '))
        throw new Error(`refused: ${id} corrected text must keep exactly the placeholders {${exported.placeholders.join('} {')}}`);
    const now = currentRows.get(id);
    if (now === undefined || now.en !== exported.en || now.ur !== exported.ur || now.urLatn !== exported.urLatn) {
      stale.push(id);
      continue;
    }
    strings.push({ catalogue: exported.catalogue, key: exported.key, decision, ur, urLatn, note: (rec['reviewer_note'] ?? '').trim() });
  }

  const aliases: AliasIntake[] = [];
  if (input.sheets.aliases !== null) {
    const exportedAliases = new Set(input.exported.aliases.map((a) => `${a.locale}|${a.alias}`));
    const seenAliases = new Set<string>();
    for (const rec of csvRecords(input.sheets.aliases, ALIAS_COLUMNS)) {
      const id = `${rec['locale'] ?? ''}|${rec['alias'] ?? ''}`;
      if (rec['export_id'] !== input.exported.exportId) throw new Error(`refused: alias ${id} comes from another export`);
      if (!exportedAliases.has(id)) throw new Error(`refused: alias ${id} is not in this export`);
      if (seenAliases.has(id)) throw new Error(`refused: alias ${id} appears twice`);
      seenAliases.add(id);
      const decision = decisionOf(rec['review_status'], `alias ${id}`);
      if (decision === null) continue;
      const corrected = (rec['alias_corrected'] ?? '').trim() || null;
      if (decision === 'CHANGE' && corrected === null) throw new Error(`refused: alias ${id} is CHANGE but has no corrected alias`);
      aliases.push({ locale: rec['locale'] ?? '', alias: rec['alias'] ?? '', decision, corrected, note: (rec['reviewer_note'] ?? '').trim() });
    }
  }

  const recordId = `FA09-${input.date}-${
    reviewer
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'reviewer'
  }`;
  const reviewed: Record<string, Partial<Record<ReviewedLocale, ReviewedEntry>>> = {};
  for (const s of strings) {
    if (s.decision === 'QUESTION') continue;
    const row = currentRows.get(`${s.catalogue}:${s.key}`);
    if (row === undefined) continue;
    reviewed[`${s.catalogue}:${s.key}`] = {
      ur: { recordId, text: s.ur ?? row.ur },
      'ur-Latn': { recordId, text: s.urLatn ?? row.urLatn },
    };
  }
  return {
    reviewer,
    date: input.date,
    declaration: input.declaration,
    exportId: input.exported.exportId,
    markedReviewed: false,
    strings,
    stale,
    aliases,
    proposedLedger: {
      record: { id: recordId, reviewer, date: input.date, declaration: input.declaration, locales: ['ur', 'ur-Latn'], exportId: input.exported.exportId },
      reviewed,
    },
  };
}
