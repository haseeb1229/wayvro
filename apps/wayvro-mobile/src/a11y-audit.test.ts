import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { componentFiles, elementsNamed, jsxAttribute, parseTsx, referencedStyles, relToSrc, styleProperty, styleSheet, walk } from './__mocks__/source-scan';
import { MIN_TOUCH_TARGET } from './core/ui/tokens';

/**
 * P3.9 static accessibility audit (A08; UX doc §15; docs/phase3/PHASE3_TEST_STRATEGY.md §4.15 A11Y-PRIM). These checks
 * prove presence and structure only — not real usability. The TalkBack walkthrough on a physical device (FA-14) and
 * VoiceOver (FA-13) are manual and reported NOT RUN until done.
 */
const FILES = componentFiles('features', 'core', 'app');
const SOURCES = FILES.map((file) => ({ file, rel: relToSrc(file), source: parseTsx(file) }));
const INTERACTIVE = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'Switch'] as const;

/** Statically evaluates a minHeight/height/width expression: a number, MIN_TOUCH_TARGET or MIN_TOUCH_TARGET ± n. */
function dp(expr: ts.Expression | undefined): number | null {
  if (expr === undefined) return null;
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (ts.isIdentifier(expr) && expr.text === 'MIN_TOUCH_TARGET') return MIN_TOUCH_TARGET;
  if (ts.isBinaryExpression(expr)) {
    const left = dp(expr.left);
    const right = dp(expr.right);
    if (left === null || right === null) return null;
    if (expr.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
    if (expr.operatorToken.kind === ts.SyntaxKind.MinusToken) return left - right;
    if (expr.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
  }
  return null;
}

describe('P3.9 accessibility audit (static)', () => {
  it('every interactive element declares an accessibility role and label (no unlabeled touch targets)', () => {
    let checked = 0;
    for (const { rel, source } of SOURCES)
      for (const name of INTERACTIVE)
        for (const el of elementsNamed(source, name)) {
          checked += 1;
          expect(jsxAttribute(el, 'accessibilityRole'), `${rel} <${name}> role`).toBeDefined();
          expect(jsxAttribute(el, 'accessibilityLabel'), `${rel} <${name}> label`).toBeDefined();
        }
    expect(checked).toBeGreaterThanOrEqual(8);
    for (const { rel, source } of SOURCES)
      for (const el of elementsNamed(source, 'TextInput')) expect(jsxAttribute(el, 'accessibilityLabel'), `${rel} <TextInput> label`).toBeDefined();
  });

  it('every touch target is at least 48 dp high (MIN_TOUCH_TARGET) through its own style', () => {
    let checked = 0;
    for (const { rel, source } of SOURCES) {
      const sheet = styleSheet(source);
      for (const name of [...INTERACTIVE, 'TextInput'])
        for (const el of elementsNamed(source, name)) {
          const style = jsxAttribute(el, 'style');
          const names = style === undefined ? [] : referencedStyles(style);
          const heights = names.map((n) => {
            const s = sheet.get(n);
            return s === undefined ? null : (dp(styleProperty(s, 'minHeight')) ?? dp(styleProperty(s, 'height')));
          });
          checked += 1;
          expect(
            heights.some((h) => h !== null && h >= MIN_TOUCH_TARGET),
            `${rel} <${name}> styles ${names.join(',')}`,
          ).toBe(true);
        }
    }
    expect(checked).toBeGreaterThanOrEqual(9);
  });

  it('dynamic type: no text is clipped or prevented from scaling, and no text container has a fixed height', () => {
    const DECORATIVE_FIXED_HEIGHT = new Set(['core/ui/components.tsx:skeleton', 'core/ui/primitives.tsx:box', 'core/ui/primitives.tsx:radio']);
    for (const { rel, source } of SOURCES) {
      const code = source.getFullText();
      expect(/\bnumberOfLines\b|\badjustsFontSizeToFit\b|\bmaxFontSizeMultiplier\b|allowFontScaling=\{false\}/.test(code), rel).toBe(false);
      for (const [name, style] of styleSheet(source))
        if (styleProperty(style, 'height') !== undefined && dp(styleProperty(style, 'height')) !== null)
          expect(DECORATIVE_FIXED_HEIGHT.has(`${rel}:${name}`), `${rel}:${name} has a fixed height`).toBe(true);
    }
  });

  it('reduced motion: nothing animates for meaning (no Animated / LayoutAnimation; skeletons are static)', () => {
    for (const { rel, source } of SOURCES)
      walk(source, (n) => {
        if (!ts.isImportDeclaration(n) || n.moduleSpecifier.getText() !== "'react-native'") return;
        const named = n.importClause?.namedBindings;
        const imported = named !== undefined && ts.isNamedImports(named) ? named.elements.map((e) => e.name.getText()) : [];
        for (const banned of ['Animated', 'LayoutAnimation', 'Easing']) expect(imported.includes(banned), `${rel} imports ${banned}`).toBe(false);
      });
    // The camera shutter animation is off (no motion needed to understand that a photo was taken).
    expect(readFileSync(FILES.find((f) => relToSrc(f) === 'features/driver/screens/CaptureScreen.tsx') ?? '', 'utf8')).toMatch(/animateShutter=\{false\}/);
  });

  it('decorative glyphs are hidden from screen readers; meaning is always in text', () => {
    for (const { rel, source } of SOURCES)
      walk(source, (n) => {
        if (!ts.isJsxElement(n)) return;
        const open = n.openingElement;
        if (open.tagName.getText() !== 'Text') return;
        const style = jsxAttribute(open, 'style');
        const glyphStyle = style !== undefined && referencedStyles(style).some((s) => s === 'glyph' || s === 'chevron');
        if (glyphStyle)
          expect(
            jsxAttribute(open, 'importantForAccessibility'),
            `${rel}:${String(source.getLineAndCharacterOfPosition(n.getStart()).line + 1)}`,
          ).toBeDefined();
      });
  });

  it('live regions: blocking policy states and quote expiry are assertive; the search count, stale and status text are polite', () => {
    const code = (rel: string): string => readFileSync(FILES.find((f) => relToSrc(f) === rel) ?? '', 'utf8');
    expect(code('core/release/AppPolicyGate.tsx').match(/announce="blocking"/g)?.length).toBe(2);
    expect(code('features/rider/quote/FareScreen.tsx')).toMatch(/announce="expiry"/);
    // On the quote list the countdown announces the expiry once; the banner does not repeat it.
    expect(code('features/rider/quote/QuoteScreen.tsx')).toMatch(/announce="announced-elsewhere"/);
    expect(code('features/rider/search/SearchScreen.tsx')).toMatch(/announce="search-results"/);
    expect(code('core/ui/components.tsx')).toMatch(/accessibilityLiveRegion=\{livePoliteness\('stale'\)\}/);
    // Assertive announcements come only from the a11y adapter (never hard-coded per screen).
    for (const { rel, source } of SOURCES) expect(/accessibilityLiveRegion="assertive"/.test(source.getFullText()), rel).toBe(false);
  });

  it('maps: every map task has a text alternative (pin by search, text route summary, text pickup/drop-off)', () => {
    const code = (rel: string): string => readFileSync(FILES.find((f) => relToSrc(f) === rel) ?? '', 'utf8');
    expect(code('features/rider/pin/PinScreen.tsx')).toMatch(/rider\.pin\.searchInstead/);
    expect(code('features/rider/quote/QuoteScreen.tsx')).toMatch(/view\.route\.summary/);
    expect(code('features/rider/quote/QuoteScreen.tsx')).toMatch(/rider\.quote\.from/);
  });

  it('RTL: amounts are left-to-right runs and address lines take their direction from their own text', () => {
    const components = readFileSync(FILES.find((f) => relToSrc(f) === 'core/ui/components.tsx') ?? '', 'utf8');
    expect(components.match(/styles\.price, styles\.ltr/g)?.length).toBe(2);
    expect(components).toMatch(/styles\.tabular, styles\.ltr/);
    expect(components.match(/dir\.content\(props\.(primary|secondary)\)/g)?.length).toBe(2);
  });
});
