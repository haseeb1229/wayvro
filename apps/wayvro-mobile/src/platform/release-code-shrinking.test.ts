import { describe, expect, it } from 'vitest';
import {
  ABSENT_BY_DESIGN_RULES,
  addReleaseRules,
  KEEP_NAMES_RULE,
  MINIFY_PROPERTY,
  RESOURCE_SHRINK_PROPERTY,
  setShrinkingProperties,
} from '../../plugins/release-code-shrinking.mjs';

const ruleLines = (text: string): string[] => text.split('\n').map((l) => l.trim());

describe('PB-07 release code shrinking (R8, class names kept)', () => {
  it('turns release minify on and keeps resource shrinking off, replacing any earlier value', () => {
    const out = setShrinkingProperties([
      { type: 'comment', value: 'template' },
      { type: 'property', key: MINIFY_PROPERTY, value: 'false' },
      { type: 'property', key: 'hermesEnabled', value: 'true' },
    ]);
    const props = Object.fromEntries(out.filter((p) => p.type === 'property').map((p) => [p.key, p.value]));
    expect(props).toEqual({ hermesEnabled: 'true', [MINIFY_PROPERTY]: 'true', [RESOURCE_SHRINK_PROPERTY]: 'false' });
    expect(out.filter((p) => p.type === 'property' && p.key === MINIFY_PROPERTY)).toHaveLength(1);
    // Idempotent across prebuild passes.
    expect(setShrinkingProperties(out)).toEqual(out);
  });

  it('adds -dontobfuscate and the absent-by-design ML Kit rules once each, keeping the existing rules', () => {
    const template = '# react-native-reanimated\n-keep class com.swmansion.reanimated.** { *; }';
    const once = addReleaseRules(template);
    expect(once.startsWith(template)).toBe(true);
    for (const rule of [KEEP_NAMES_RULE, ...ABSENT_BY_DESIGN_RULES]) expect(ruleLines(once).filter((l) => l === rule)).toHaveLength(1);
    expect(addReleaseRules(once)).toBe(once);
    expect(ruleLines(addReleaseRules(''))).toContain(KEEP_NAMES_RULE);
  });

  it('only silences the ML Kit vision packages that the disabled barcode scanner would bring', () => {
    for (const rule of ABSENT_BY_DESIGN_RULES) expect(rule).toMatch(/^-dontwarn com\.google\.mlkit\.vision\.[a-z]+\.\*\*$/);
  });
});
