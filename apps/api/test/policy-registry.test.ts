import { describe, expect, it } from 'vitest';
import { productionPolicyProblems } from '../src/legal/policy-registry.js';

describe('BOOT-NEG: production refuses placeholder policy texts and a placeholder age policy (CL-P2-09)', () => {
  const now = new Date('2026-10-12T00:00:00Z');
  it('local/test/staging may run placeholders', () => {
    for (const env of ['local', 'test', 'staging'] as const) expect(productionPolicyProblems(env, 'PLACEHOLDER_NOT_FOR_PRODUCTION', now)).toEqual([]);
  });
  it('production lists every placeholder text (both locales) and the placeholder age policy', () => {
    const problems = productionPolicyProblems('production', 'PLACEHOLDER_NOT_FOR_PRODUCTION', now);
    expect(problems).toContain('TERMS@1/en: placeholder text is not counsel-approved (EG-02)');
    expect(problems).toContain('PRIVACY@1/ur: placeholder text is not counsel-approved (EG-02)');
    expect(problems).toContain('age-eligibility policy: placeholder is not counsel-approved (EG-23)');
    expect(problems).toHaveLength(15);
    expect(productionPolicyProblems('production', 'APPROVED', now)).toHaveLength(14);
  });
  it('a policy with no effective version is also a production problem', () => {
    expect(productionPolicyProblems('production', 'APPROVED', new Date('2026-01-01T00:00:00Z'))).toContain('TERMS/en: no effective version');
  });
});
