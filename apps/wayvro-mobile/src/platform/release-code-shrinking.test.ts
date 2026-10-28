import { describe, expect, it } from 'vitest';
import { addKeepNamesRule, KEEP_NAMES_RULE, MINIFY_PROPERTY, RESOURCE_SHRINK_PROPERTY, setShrinkingProperties } from '../../plugins/release-code-shrinking.mjs';

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

  it('adds -dontobfuscate to proguard-rules.pro exactly once and keeps the existing rules', () => {
    const template = '# react-native-reanimated\n-keep class com.swmansion.reanimated.** { *; }';
    const once = addKeepNamesRule(template);
    expect(once.startsWith(template)).toBe(true);
    expect(once.split('\n').filter((l) => l.trim() === KEEP_NAMES_RULE)).toHaveLength(1);
    expect(addKeepNamesRule(once)).toBe(once);
    expect(addKeepNamesRule('').trim().endsWith(KEEP_NAMES_RULE)).toBe(true);
  });
});
