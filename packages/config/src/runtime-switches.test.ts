import { describe, expect, it } from 'vitest';
import {
  RUNTIME_SWITCH_KEYS,
  RUNTIME_SWITCH_REGISTRY,
  oppositeSwitchState,
  runningSwitchState,
  runtimeSwitchDefinition,
  runtimeSwitchTargetLockKey,
  validateRuntimeSwitchRegistry,
  type RuntimeSwitchDefinition,
} from './runtime-switches.js';

const valid: RuntimeSwitchDefinition = {
  key: 'rider.example-capability',
  owner: 'founder',
  purpose: 'test fixture only',
  requirementIds: ['V10'],
  safeState: 'DISABLED',
  allowedScopes: ['ALL'],
  clientVisible: false,
  securityControl: false,
  defaults: { local: 'ENABLED', test: 'ENABLED', staging: 'ENABLED', production: 'ENABLED' },
};

describe('runtime switch registry (T3-24; checklist item 13)', () => {
  it('the shipped registry is valid and contains no switch able to control a security mechanism', () => {
    expect(validateRuntimeSwitchRegistry()).toEqual([]);
    expect(RUNTIME_SWITCH_REGISTRY.every((s) => !(s.securityControl as boolean))).toBe(true);
    // keys never name a security control (authentication, authorisation, rate limits, budgets, zones, audit)
    for (const key of RUNTIME_SWITCH_KEYS) expect(key).not.toMatch(/auth|rate-limit|budget|zone|audit|otp|step-up|session/);
  });

  it('every switch can only reduce capability: its safe state stops something and is reached in one step', () => {
    for (const s of RUNTIME_SWITCH_REGISTRY) {
      expect(['ENABLED', 'DISABLED']).toContain(s.safeState);
      expect(runningSwitchState(s)).toBe(oppositeSwitchState(s.safeState));
      expect(s.allowedScopes.length).toBeGreaterThan(0);
    }
    // maintenance is the one switch whose stopping state is ENABLED (maintenance in progress)
    expect(runtimeSwitchDefinition('platform.maintenance')?.safeState).toBe('ENABLED');
    expect(runtimeSwitchDefinition('platform.maintenance')?.defaults.production).toBe('DISABLED');
  });

  it('one advisory-lock key per (key, scope, city) target', () => {
    const keys = new Set([
      runtimeSwitchTargetLockKey('rider.quotes', 'ALL', null),
      runtimeSwitchTargetLockKey('rider.quotes', 'RIDER', null),
      runtimeSwitchTargetLockKey('rider.quotes', 'ALL', 'LHR'),
      runtimeSwitchTargetLockKey('platform.geo-routing', 'ALL', null),
    ]);
    expect(keys.size).toBe(4);
  });

  it('unknown keys have no definition (the services refuse them)', () => {
    expect(runtimeSwitchDefinition('platform.no-such-switch')).toBeUndefined();
    expect(runtimeSwitchDefinition('platform.auth')).toBeUndefined();
  });

  it('rejects bad keys, duplicates, untraced or ownerless switches and any security-control switch', () => {
    const problems = validateRuntimeSwitchRegistry([
      valid,
      { ...valid },
      { ...valid, key: 'Bad.Key', owner: ' ', requirementIds: [] },
      { ...valid, key: 'ops.no-scope', allowedScopes: [] },
      { ...valid, key: 'ops.security', securityControl: true as unknown as false },
    ]).join('\n');
    expect(problems).toMatch(/duplicate key/);
    expect(problems).toMatch(/Bad\.Key.*key must match/);
    expect(problems).toMatch(/owner and purpose are required/);
    expect(problems).toMatch(/valid requirement IDs required/);
    expect(problems).toMatch(/at least one scope/);
    expect(problems).toMatch(/never control a security mechanism/);
  });
});
