import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROOT_STACK_SCREEN_OPTIONS } from './root-stack';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

describe('PB-07: root-level state redirects are not animated', () => {
  it('the root stack options disable the screen transition', () => {
    expect(ROOT_STACK_SCREEN_OPTIONS).toEqual({ animation: 'none' });
  });

  it('the root layout applies them and the mode stacks do not (user navigation keeps its animations)', () => {
    expect(readFileSync(join(APP, '_layout.tsx'), 'utf8')).toMatch(/<Stack screenOptions=\{ROOT_STACK_SCREEN_OPTIONS\}>/);
    for (const nested of ['(session)/_layout.tsx', '(session)/ride/_layout.tsx']) {
      expect(readFileSync(join(APP, nested), 'utf8')).not.toContain('ROOT_STACK_SCREEN_OPTIONS');
    }
  });
});
