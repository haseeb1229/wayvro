import { describe, expect, it } from 'vitest';
import { FLAG_REGISTRY, validateFlagRegistry, type FlagDefinition } from './flags.js';

const valid: FlagDefinition = {
  key: 'rider.example-capability',
  owner: 'founder',
  purpose: 'test fixture only',
  requirementIds: ['B16'],
  enforcement: 'server',
  defaults: { local: true, test: true, staging: false, production: false },
  expiresOn: '2027-01-31',
};

describe('validateFlagRegistry', () => {
  it('accepts a complete, unexpired flag', () => {
    expect(validateFlagRegistry([valid], '2026-10-09')).toEqual([]);
  });

  it('rejects expired, duplicate, ownerless, untraced and badly named flags', () => {
    const problems = validateFlagRegistry(
      [
        valid,
        { ...valid },
        { ...valid, key: 'BadKey', owner: ' ', requirementIds: [] },
        { ...valid, key: 'driver.old-thing', expiresOn: '2026-01-01' },
        { ...valid, key: 'ops.bad-date', expiresOn: 'next year' },
      ],
      '2026-10-09',
    );
    expect(problems.join('\n')).toMatch(/duplicate key/);
    expect(problems.join('\n')).toMatch(/BadKey.*key must match/);
    expect(problems.join('\n')).toMatch(/owner is required/);
    expect(problems.join('\n')).toMatch(/requirement ID/);
    expect(problems.join('\n')).toMatch(/expired on 2026-01-01/);
    expect(problems.join('\n')).toMatch(/expiresOn must be YYYY-MM-DD/);
  });

  it('requires an approver before a flag defaults ON in production', () => {
    const on = { ...valid, defaults: { ...valid.defaults, production: true } };
    expect(validateFlagRegistry([on], '2026-10-09')).toEqual([expect.stringMatching(/productionApprovedBy/)]);
    expect(validateFlagRegistry([{ ...on, productionApprovedBy: 'founder 2026-10-09' }], '2026-10-09')).toEqual([]);
  });

  it('the shipped registry is valid today', () => {
    expect(validateFlagRegistry(FLAG_REGISTRY, new Date().toISOString().slice(0, 10))).toEqual([]);
  });
});

describe('registered flags (P2.5+)', () => {
  it('the registry is valid today and driver onboarding is OFF outside local/test', async () => {
    const { FLAG_REGISTRY: registry, isFlagEnabled: enabled, validateFlagRegistry: validate } = await import('./flags.js');
    expect(validate(registry, '2026-10-11')).toEqual([]);
    expect(enabled('driver.onboarding', 'local')).toBe(true);
    expect(enabled('driver.onboarding', 'test')).toBe(true);
    expect(enabled('driver.onboarding', 'staging')).toBe(false);
    expect(enabled('driver.onboarding', 'production')).toBe(false);
    expect(enabled('nope.unknown', 'local')).toBe(false);
  });
});
