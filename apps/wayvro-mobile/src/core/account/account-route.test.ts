import { describe, expect, it } from 'vitest';
import type { ModeHome } from '../mode/availability';
import { primaryRequiredAction, redirectFor, routeForRequiredActions } from './account-route';

const HOMES: readonly ModeHome[] = ['/ride', '/drive'];

describe('required-action router (server truth)', () => {
  it('routes by priority: restricted-session actions, then policies, then age; no action ⇒ the resolver’s mode home', () => {
    for (const home of HOMES) {
      expect(routeForRequiredActions([], home)).toBe(home);
      expect(routeForRequiredActions(['AGE_DECLARATION'], home)).toBe('/onboarding/age');
      expect(routeForRequiredActions(['AGE_DECLARATION', 'ACCEPT_POLICIES'], home)).toBe('/onboarding/policies');
      expect(routeForRequiredActions(['ACCEPT_POLICIES', 'PHONE_STEP_UP'], home)).toBe('/required-action');
      expect(routeForRequiredActions(['RECOVERY_REVIEW', 'ACCEPT_POLICIES'], home)).toBe('/required-action');
    }
    expect(primaryRequiredAction(['PHONE_STEP_UP', 'RECOVERY_REVIEW'])).toBe('RECOVERY_REVIEW');
    expect(primaryRequiredAction([])).toBeNull();
  });

  it('pins a pending action to its screen, wherever the user (or a deep link / restored stack) is — including both mode homes', () => {
    for (const home of HOMES) {
      for (const path of ['/home', '/profile', '/sessions', '/security', '/onboarding/age', '/ride', '/ride/quote', '/drive', '/drive/health', '/earn'])
        expect(redirectFor(['ACCEPT_POLICIES'], path, home)).toBe('/onboarding/policies');
      expect(redirectFor(['ACCEPT_POLICIES'], '/onboarding/policies', home)).toBeNull();
      expect(redirectFor(['AGE_DECLARATION'], '/home', home)).toBe('/onboarding/age');
      expect(redirectFor(['AGE_DECLARATION'], '/drive', home)).toBe('/onboarding/age');
    }
  });

  it('keeps policy texts readable while accepting policies or declaring age', () => {
    for (const home of HOMES) {
      expect(redirectFor(['ACCEPT_POLICIES'], '/legal/TERMS/1', home)).toBeNull();
      expect(redirectFor(['AGE_DECLARATION'], '/legal', home)).toBeNull();
    }
  });

  it('exposes nothing else during restricted-session actions', () => {
    for (const home of HOMES) {
      expect(redirectFor(['RECOVERY_REVIEW'], '/legal/TERMS/1', home)).toBe('/required-action');
      expect(redirectFor(['PHONE_STEP_UP'], '/sessions', home)).toBe('/required-action');
      expect(redirectFor(['PHONE_STEP_UP'], '/ride', home)).toBe('/required-action');
      expect(redirectFor(['PHONE_STEP_UP'], '/drive', home)).toBe('/required-action');
      expect(redirectFor(['PHONE_STEP_UP'], '/required-action', home)).toBeNull();
    }
  });

  it('sends a user without pending actions away from stale onboarding screens to the mode home, and allows everything else', () => {
    for (const home of HOMES) {
      expect(redirectFor([], '/onboarding/policies', home)).toBe(home);
      expect(redirectFor([], '/onboarding/age', home)).toBe(home);
      expect(redirectFor([], '/required-action', home)).toBe(home);
      for (const path of ['/home', '/profile', '/sessions', '/security', '/legal', '/legal/PRIVACY/2', '/ride', '/ride/fare', '/drive', '/earn'])
        expect(redirectFor([], path, home)).toBeNull();
    }
  });
});
