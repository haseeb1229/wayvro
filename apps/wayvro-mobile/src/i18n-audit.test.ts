import { LOCALES } from '@wayvro/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { quoteGroup, quoteOption, SERVER_NOW } from './__mocks__/p3-fixtures';
import { componentFiles, elementsNamed, moduleFiles, parseTsx, relToSrc, SRC, walk } from './__mocks__/source-scan';
import { formatPkr } from './core/i18n/money';
import {
  copyFlags,
  FLAG_RULES,
  FORMAT_DECISIONS,
  ledgerProblems,
  REVIEW_DECLARATION,
  REVIEW_LEDGER,
  reviewStatus,
  ruleIsUsed,
  type CatalogueTexts,
  type ReviewLedger,
} from './core/i18n/review-status';
import { CATALOGUE, interpolate, PENDING_REVIEW_LOCALES, type StringKey, type TranslationParams } from './core/i18n/strings';
import { DRIVER_CATALOGUE, type DriverStringKey } from './features/driver/i18n/driver-strings';
import { cityLabel, documentLabel, productLabel } from './features/driver/ui/labels';
import { fareView } from './features/rider/quote/fare-view';
import { lastQuoteSummary, pricedView, refusalCopy, type QuoteRefusal } from './features/rider/quote/quote-view';
import { suggestionLabel } from './features/rider/search/search-view';

/**
 * P3.9 catalogue audit (P18/A06/K19 copy; docs/phase3/PHASE3_TEST_STRATEGY.md §4.16). Static: no user-facing literal in
 * component files; every screen carries the translation-pending note. Adapters: a +40 % pseudo-locale never truncates.
 * Review status: nothing is REVIEWED without a reviewer record (and nothing is reviewed yet — FA-09 OPEN).
 */
const CATALOGUES: CatalogueTexts = { app: CATALOGUE, driver: DRIVER_CATALOGUE };
const KEYS = { app: Object.keys(CATALOGUE.en), driver: Object.keys(DRIVER_CATALOGUE.en) } as const;
const isCatalogueKey = (value: string): boolean => Object.hasOwn(CATALOGUE.en, value) || Object.hasOwn(DRIVER_CATALOGUE.en, value);

/**
 * Strings that contain letters but are not user-facing copy. Keep this list explicit and short: anything a person reads
 * or hears belongs in the typed catalogues.
 */
const NON_COPY_ALLOWLIST: ReadonlySet<string> = new Set<string>([]);

/** JSX props that carry copy (a string literal there must be a catalogue key). */
const COPY_PROP =
  /^(label|title|text|body|hint|placeholder|message|detail|heading|caption|announcement|error|primary|secondary|urdu|price)$|Label$|Title$|Text$/;
/** Navigation/header options whose string values are shown to the user. */
const COPY_OPTION = /^(title|headerTitle|headerBackTitle|tabBarLabel|tabBarAccessibilityLabel)$/;
const LETTER = /\p{L}/u;

interface Literal {
  readonly line: number;
  readonly text: string;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
  return null;
}

/** Hard-coded user-facing text in a component file (JSX text, copy props, header options, alerts, announcements). */
function copyLiterals(source: ts.SourceFile): Literal[] {
  const found: Literal[] = [];
  const report = (node: ts.Node, text: string): void => {
    const trimmed = text.trim();
    if (!LETTER.test(trimmed) || isCatalogueKey(trimmed) || NON_COPY_ALLOWLIST.has(trimmed)) return;
    found.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: trimmed });
  };
  walk(source, (n) => {
    if (ts.isJsxText(n)) report(n, n.text);
    else if (ts.isJsxExpression(n) && n.expression !== undefined && !ts.isJsxAttribute(n.parent)) {
      const text = literalText(n.expression);
      if (text !== null) report(n, text);
    } else if (ts.isJsxAttribute(n) && COPY_PROP.test(n.name.getText()) && n.initializer !== undefined) {
      const value = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
      const text = value === undefined ? null : literalText(value);
      if (text !== null) report(n, text);
    } else if (ts.isPropertyAssignment(n) && COPY_OPTION.test(n.name.getText())) {
      const text = literalText(n.initializer);
      if (text !== null) report(n, text);
    } else if (ts.isCallExpression(n) && /(^|\.)(alert|announceForAccessibility)$/.test(n.expression.getText())) {
      for (const arg of n.arguments) {
        const text = literalText(arg);
        if (text !== null) report(arg, text);
      }
    }
  });
  return found;
}

describe('P3.9 catalogue audit: no hard-coded user-facing copy', () => {
  it('the scanner catches literal JSX text, copy props, header titles, alerts and announcements (negative controls)', () => {
    const sample = parseTsx(
      'sample.tsx',
      [
        'const a = <Text>Book a ride</Text>;',
        'const b = <Button label="Continue" onPress={go} />;',
        "const c = <Banner text={'Offline'} />;",
        "const d = <Stack.Screen options={{ title: 'Prices' }} />;",
        "Alert.alert('Delete?');",
        "AccessibilityInfo.announceForAccessibility('Updated');",
        'const e = <Text>{`Hello ${name}`}</Text>;',
        "const ok1 = <Text style={s.x}>{t('common.retry')}</Text>;",
        'const ok2 = <InfoSection title="explain.whyTitle" body="explain.whyBody" />;',
        'const ok3 = <Text>✓ · ›</Text>;',
        'const ok4 = <View testID="ride-quote" accessibilityRole="button" />;',
      ].join('\n'),
    );
    expect(copyLiterals(sample).map((l) => l.text)).toEqual(['Book a ride', 'Continue', 'Offline', 'Prices', 'Delete?', 'Updated', 'Hello']);
  });

  // Parses every scanned source file with the TypeScript compiler: slower than vitest's 5 s default when the whole suite
  // runs in parallel (same assertions; the bound only stops a hung scan).
  it('rider, driver, account, release-control and shared component files take every user-facing string from the catalogues', { timeout: 30_000 }, () => {
    const files = componentFiles('features', 'core', 'app');
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap((file) => copyLiterals(parseTsx(file)).map((l) => `${relToSrc(file)}:${String(l.line)} "${l.text}"`));
    expect(offenders).toEqual([]);
  });

  it('every screen renders through Screen (which ends with the translation-pending note) or renders the note itself', () => {
    const screens = componentFiles('features', 'core').filter((f) => /Screen\.tsx$|AppPolicyGate\.tsx$/.test(f));
    expect(screens.length).toBeGreaterThan(30);
    for (const file of screens) {
      const source = parseTsx(file);
      expect(elementsNamed(source, 'Screen').length, relToSrc(file)).toBeGreaterThan(0);
      // A full-bleed view (the camera) cannot use Screen: it must render the note itself.
      const fullBleed = readFileSync(file, 'utf8').includes('<CameraView');
      if (fullBleed) expect(elementsNamed(source, 'TranslationPendingNote').length, relToSrc(file)).toBeGreaterThan(0);
    }
    // Both Screen layouts (scrolling and fixed) end with the note.
    const screen = findFunction(parseTsx(join(SRC, 'core/ui/primitives.tsx')), 'Screen');
    expect(screen.getText().match(/<TranslationPendingNote \/>/g)?.length).toBe(2);
  });

  it('both catalogues keep identical keys and {placeholders} in en / ur / ur-Latn', () => {
    const placeholders = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
    for (const [name, catalogue] of Object.entries(CATALOGUES)) {
      const keys = Object.keys(catalogue.en).sort();
      for (const locale of LOCALES) {
        expect(Object.keys(catalogue[locale]).sort(), `${name}/${locale}`).toEqual(keys);
        for (const key of keys) expect(placeholders(catalogue[locale][key] ?? ''), `${name}/${locale}:${key}`).toEqual(placeholders(catalogue.en[key] ?? ''));
      }
    }
  });
});

function findFunction(source: ts.SourceFile, name: string): ts.FunctionDeclaration {
  let found: ts.FunctionDeclaration | undefined;
  walk(source, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.getText() === name) found = n;
  });
  if (found === undefined) throw new Error(`no function ${name}`);
  return found;
}

// ── +40 % text expansion (pseudo-locale) on the label / spoken-label adapters ─────────────────────────────────────
const OPEN = '⟦';
const CLOSE = '⟧';
/** English source + 40 % padding, wrapped in markers; placeholders are kept so values still interpolate. */
const pseudo = (text: string): string => `${OPEN}${text}${'~'.repeat(Math.ceil(text.length * 0.4))}${CLOSE}`;
const pseudoTr = (key: StringKey, params?: TranslationParams): string => interpolate('en', pseudo(CATALOGUE.en[key]), params);
const pseudoDt = (key: DriverStringKey, params?: TranslationParams): string => interpolate('en', pseudo(DRIVER_CATALOGUE.en[key]), params);

/** Every marker pair is complete (nothing was cut) and properly nested. */
function intact(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === OPEN) depth += 1;
    if (ch === CLOSE) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0 && text.includes(OPEN);
}

const REFUSALS: readonly QuoteRefusal[] = [
  { kind: 'service-area', reason: 'ZONE_NOT_SERVED', nextOpenAt: null, failedEnd: 'pickup' },
  { kind: 'service-area', reason: 'ZONE_NOT_SERVED', nextOpenAt: null, failedEnd: null },
  { kind: 'service-area', reason: 'OUTSIDE_SERVICE_HOURS', nextOpenAt: '2026-10-14T01:00:00.000Z', failedEnd: null },
  { kind: 'service-area', reason: 'PICKUP_RESTRICTED', nextOpenAt: null, failedEnd: null },
  { kind: 'service-area', reason: 'ROUTE_TOO_LONG', nextOpenAt: null, failedEnd: null },
  { kind: 'service-area', reason: 'NO_ACTIVE_RATE_CARD', nextOpenAt: null, failedEnd: null },
  { kind: 'routing-unavailable' },
  { kind: 'rate-limited', seconds: 30 },
  { kind: 'rate-limited', seconds: null },
  { kind: 'offline' },
  { kind: 'disabled', reason: 'ACCOUNT_RESTRICTED' },
  { kind: 'disabled', reason: 'FEATURE_DISABLED' },
  { kind: 'place-invalid', reason: 'SAME_POINT' },
  { kind: 'not-found' },
  { kind: 'error' },
];

describe('P3.9 text expansion: label adapters tolerate +40 % (pseudo-locale)', () => {
  const draft = {
    pickup: {
      primary: 'Liberty Market',
      secondary: 'Gulberg III',
      point: { lat: 31.51, lng: 74.34 },
      placeRef: null,
      source: 'search' as const,
      inServiceArea: true,
    },
    dropoff: { primary: null, secondary: null, point: { lat: 31.59, lng: 74.31 }, placeRef: null, source: 'current-location' as const, inServiceArea: true },
  };

  it('the pseudo transform pads by at least 40 % and keeps placeholders', () => {
    expect(pseudo('Total')).toBe('⟦Total~~⟧');
    expect(pseudoTr('rider.quote.seats', { count: 4 })).toBe('⟦4 seats~~~~~~⟧');
    for (const key of KEYS.app) expect(pseudo(CATALOGUE.en[key as StringKey]).length).toBeGreaterThanOrEqual(CATALOGUE.en[key as StringKey].length * 1.4);
  });

  it('quote options, route summary and unavailable rows: every label and spoken label keeps every expanded segment whole', () => {
    const view = pricedView(pseudoTr, 'en', quoteGroup(), draft, SERVER_NOW);
    // (route.from is the server's place text "Liberty Market", not catalogue copy.)
    expect(view.route.from).toBe('Liberty Market');
    const texts = [
      view.route.to,
      view.route.summary,
      view.route.confidence,
      ...view.options.flatMap((o) => [o.title, o.spoken, ...o.lines]),
      ...view.unavailable.flatMap((u) => [u.title, u.reason]),
    ].filter((s): s is string => s !== null);
    expect(texts.length).toBeGreaterThan(8);
    for (const text of texts) expect(intact(text), text).toBe(true);
    // The spoken label of an option carries the whole product name, seats, luggage and price sentences.
    const spoken = view.options[0]?.spoken ?? '';
    expect(spoken.split(OPEN).length - 1).toBeGreaterThanOrEqual(4);
  });

  it('fare breakdown rows, total, notes and reference keep every expanded segment whole (spoken rows too)', () => {
    const view = fareView(pseudoTr, quoteOption({ taxIncluded: { rateBp: 1600, amount: { currency: 'PKR', minor: '8828' } } }), SERVER_NOW);
    const texts = [view.title, ...view.rows.flatMap((r) => [r.label, r.spoken]), view.total.label, view.total.spoken, ...view.notes, view.reference];
    for (const text of texts) expect(intact(text), text).toBe(true);
  });

  it('every refusal title/body and the last-price summary keep every expanded segment whole', () => {
    for (const refusal of REFUSALS) {
      const copy = refusalCopy(pseudoTr, refusal);
      expect(intact(copy.title), `${refusal.kind} title`).toBe(true);
      expect(intact(copy.body), `${refusal.kind} body`).toBe(true);
    }
    const summary = lastQuoteSummary(pseudoTr, quoteGroup(), SERVER_NOW);
    expect(summary.kind === 'priced' && intact(summary.line)).toBe(true);
  });

  it('Driver/Partner product, document and city labels and search suggestion labels are never shortened', () => {
    expect(intact(productLabel(pseudoTr, 'ECONOMY'))).toBe(true);
    expect(intact(documentLabel(pseudoDt, 'DRIVING_LICENCE'))).toBe(true);
    expect(intact(cityLabel(pseudoDt, 'LHR'))).toBe(true);
    const long = `${'Gulberg '.repeat(12)}Block`;
    expect(suggestionLabel(long, long)).toBe(`${long}, ${long}`);
  });
});

// ── review status ────────────────────────────────────────────────────────────────────────────────────────────────
describe('P3.9 native-review status (FA-09)', () => {
  it('the committed ledger is consistent and marks NOTHING as reviewed (FA-09 OPEN; AI-drafted copy is never reviewed)', () => {
    expect(ledgerProblems(REVIEW_LEDGER, CATALOGUES)).toEqual([]);
    expect(REVIEW_LEDGER.records).toEqual([]);
    expect(Object.keys(REVIEW_LEDGER.reviewed)).toEqual([]);
    for (const catalogue of ['app', 'driver'] as const)
      for (const key of KEYS[catalogue]) {
        expect(reviewStatus(REVIEW_LEDGER, catalogue, key, 'en', CATALOGUES[catalogue].en[key] ?? '')).toBe('SOURCE');
        for (const locale of ['ur', 'ur-Latn'] as const)
          expect(reviewStatus(REVIEW_LEDGER, catalogue, key, locale, CATALOGUES[catalogue][locale][key] ?? ''), `${catalogue}:${key}`).toBe(
            'PENDING_NATIVE_REVIEW',
          );
      }
    // While anything is pending, the Urdu and Roman-Urdu UI keeps the pending note.
    expect([...PENDING_REVIEW_LOCALES].sort()).toEqual(['ur', 'ur-Latn']);
  });

  it('fails a REVIEWED entry without a reviewer record, with an incomplete record, or with text changed after review (negative controls)', () => {
    const text = CATALOGUE.ur['fare.total'];
    const record = { id: 'R1', reviewer: 'Test Reviewer', date: '2026-10-20', declaration: REVIEW_DECLARATION, locales: ['ur' as const], exportId: 'abc' };
    const valid: ReviewLedger = { records: [record], reviewed: { 'app:fare.total': { ur: { recordId: 'R1', text } } } };
    expect(ledgerProblems(valid, CATALOGUES)).toEqual([]);
    expect(reviewStatus(valid, 'app', 'fare.total', 'ur', text)).toBe('REVIEWED');
    expect(reviewStatus(valid, 'app', 'fare.total', 'ur', `${text}!`)).toBe('PENDING_NATIVE_REVIEW');

    const noRecord: ReviewLedger = { records: [], reviewed: valid.reviewed };
    expect(ledgerProblems(noRecord, CATALOGUES)).toEqual(['app:fare.total (ur): marked REVIEWED without a reviewer record']);
    expect(reviewStatus(noRecord, 'app', 'fare.total', 'ur', text)).toBe('PENDING_NATIVE_REVIEW');

    const anonymous: ReviewLedger = { ...valid, records: [{ ...record, reviewer: ' ', declaration: 'ok' }] };
    expect(ledgerProblems(anonymous, CATALOGUES)).toEqual(['record R1: reviewer name or initials missing', 'record R1: declaration missing or altered']);
    expect(reviewStatus(anonymous, 'app', 'fare.total', 'ur', text)).toBe('PENDING_NATIVE_REVIEW');

    const stale: ReviewLedger = { ...valid, reviewed: { 'app:fare.total': { ur: { recordId: 'R1', text: 'old' } } } };
    expect(ledgerProblems(stale, CATALOGUES)).toEqual(['app:fare.total (ur): catalogue text changed after review']);
    const wrongLocale: ReviewLedger = { ...valid, reviewed: { 'app:fare.total': { 'ur-Latn': { recordId: 'R1', text: CATALOGUE['ur-Latn']['fare.total'] } } } };
    expect(ledgerProblems(wrongLocale, CATALOGUES)).toEqual(['app:fare.total (ur-Latn): reviewer record R1 does not cover ur-Latn']);
    const unknown: ReviewLedger = { ...valid, reviewed: { 'app:no.such': { ur: { recordId: 'R1', text } } } };
    expect(ledgerProblems(unknown, CATALOGUES)).toEqual(['app:no.such (ur): no such key']);
  });

  it('safety, legal, price-explanation and permission copy is tagged; every tag rule is in use', () => {
    for (const rule of FLAG_RULES) expect(ruleIsUsed(rule, KEYS), `${rule.catalogue}:${rule.match}`).toBe(true);
    for (const key of KEYS.app.filter((k) => k.startsWith('fare.') || k.startsWith('rider.quote.'))) expect(copyFlags('app', key)).toContain('PRICE');
    for (const key of KEYS.app.filter((k) => k.startsWith('policies.') || k.startsWith('deletion.'))) expect(copyFlags('app', key)).toContain('LEGAL');
    for (const key of KEYS.app.filter((k) => k.startsWith('rider.location.'))) expect(copyFlags('app', key)).toContain('PERMISSION');
    expect(copyFlags('app', 'restriction.class.SAFETY')).toEqual(['SAFETY']);
    expect(copyFlags('app', 'appeal.body')).toEqual(['LEGAL', 'SAFETY']);
    expect(copyFlags('driver', 'capture.selfieNote')).toEqual(['PERMISSION', 'SAFETY']);
    expect(copyFlags('driver', 'explain.retentionBody')).toEqual(['LEGAL']);
    expect(copyFlags('app', 'common.retry')).toEqual([]);
    const flagged = KEYS.app.filter((k) => copyFlags('app', k).length > 0).length + KEYS.driver.filter((k) => copyFlags('driver', k).length > 0).length;
    expect(flagged).toBeGreaterThan(200);
  });

  it('PKR display has ONE formatter for every locale; its open format choices are recorded as pending native review', () => {
    expect(FORMAT_DECISIONS.map((d) => d.id)).toEqual(['pkr.grouping', 'pkr.digits', 'pkr.symbol', 'pkr.paisa']);
    for (const decision of FORMAT_DECISIONS) expect(decision.status).toBe('PENDING_NATIVE_REVIEW');
    // formatPkr takes no locale: Urdu, Roman Urdu and English show the same Western-digit amount.
    expect(formatPkr.length).toBe(1);
    expect(formatPkr({ currency: 'PKR', minor: '12500000' })).toBe('Rs 125,000');
    // No other production module formats rupees or uses Intl currency/number formatting.
    const production = [...componentFiles('features', 'core', 'app'), ...moduleFiles('features', 'core', 'platform')];
    expect(production.length).toBeGreaterThan(100);
    for (const file of production.filter((f) => relToSrc(f) !== 'core/i18n/money.ts'))
      expect(/['"`]Rs[ .]|style:\s*['"]currency['"]|NumberFormat/.test(readFileSync(file, 'utf8')), relToSrc(file)).toBe(false);
  });
});
