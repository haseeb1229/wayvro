import { describe, expect, it } from 'vitest';
import { primaryRequiredAction, redirectFor, routeForRequiredActions } from './account-route';

describe('required-action router (server truth)', () => {
  it('routes by priority: restricted-session actions, then policies, then age', () => {
    expect(routeForRequiredActions([])).toBe('/home');
    expect(routeForRequiredActions(['AGE_DECLARATION'])).toBe('/onboarding/age');
    expect(routeForRequiredActions(['AGE_DECLARATION', 'ACCEPT_POLICIES'])).toBe('/onboarding/policies');
    expect(routeForRequiredActions(['ACCEPT_POLICIES', 'PHONE_STEP_UP'])).toBe('/required-action');
    expect(routeForRequiredActions(['RECOVERY_REVIEW', 'ACCEPT_POLICIES'])).toBe('/required-action');
    expect(primaryRequiredAction(['PHONE_STEP_UP', 'RECOVERY_REVIEW'])).toBe('RECOVERY_REVIEW');
    expect(primaryRequiredAction([])).toBeNull();
  });

  it('pins a pending action to its screen, wherever the user (or a deep link / restored stack) is', () => {
    for (const path of ['/home', '/profile', '/sessions', '/security', '/onboarding/age'])
      expect(redirectFor(['ACCEPT_POLICIES'], path)).toBe('/onboarding/policies');
    expect(redirectFor(['ACCEPT_POLICIES'], '/onboarding/policies')).toBeNull();
    expect(redirectFor(['AGE_DECLARATION'], '/home')).toBe('/onboarding/age');
  });

  it('keeps policy texts readable while accepting policies or declaring age', () => {
    expect(redirectFor(['ACCEPT_POLICIES'], '/legal/TERMS/1')).toBeNull();
    expect(redirectFor(['AGE_DECLARATION'], '/legal')).toBeNull();
  });

  it('exposes nothing else during restricted-session actions', () => {
    expect(redirectFor(['RECOVERY_REVIEW'], '/legal/TERMS/1')).toBe('/required-action');
    expect(redirectFor(['PHONE_STEP_UP'], '/sessions')).toBe('/required-action');
    expect(redirectFor(['PHONE_STEP_UP'], '/required-action')).toBeNull();
  });

  it('sends a user without pending actions away from stale onboarding screens, and allows everything else', () => {
    expect(redirectFor([], '/onboarding/policies')).toBe('/home');
    expect(redirectFor([], '/onboarding/age')).toBe('/home');
    expect(redirectFor([], '/required-action')).toBe('/home');
    for (const path of ['/home', '/profile', '/sessions', '/security', '/legal', '/legal/PRIVACY/2']) expect(redirectFor([], path)).toBeNull();
  });
});
