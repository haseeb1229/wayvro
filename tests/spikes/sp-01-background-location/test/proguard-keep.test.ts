/**
 * R8 keep rule for the headless JS app loader (plugins/spike-proguard.mjs). Regression for the 2026-10-16 emulator run:
 * the minified release build removed RNHeadlessAppLoader and every headless start crashed (ClassNotFoundException).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
// @ts-expect-error -- plain ESM config plugin without type declarations
import { HEADLESS_KEEP_RULE, withHeadlessKeepRule } from '../plugins/spike-proguard.mjs';

describe('spike R8 keep rule', () => {
  it('appends the RNHeadlessAppLoader keep rule exactly once', () => {
    const once = withHeadlessKeepRule('# template rules\n-keep class com.facebook.react.** { *; }\n');
    assert.ok(once.includes(HEADLESS_KEEP_RULE));
    assert.equal(withHeadlessKeepRule(once), once);
    assert.equal(once.split(HEADLESS_KEEP_RULE).length, 2);
  });

  it('is registered in app.json after the manifest plugin', () => {
    const plugins = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo.plugins as unknown[];
    assert.ok(plugins.includes('./plugins/spike-proguard.mjs'));
  });
});
