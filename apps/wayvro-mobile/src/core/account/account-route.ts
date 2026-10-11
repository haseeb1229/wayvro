import type { AccountState } from '@wayvro/contracts';

/**
 * Account-state routing by SERVER truth (P2.3; CLAUDE.md §3/§9). The server's `requiredActions` decide which screen a
 * signed-in user may see; local flags never do. The function is pure so restart, foreground, deep-link and
 * notification restores all converge on the same answer for the same server state.
 */
const ACCOUNT_ROUTES = {
  home: '/home',
  policies: '/onboarding/policies',
  age: '/onboarding/age',
  requiredAction: '/required-action',
} as const;
export type AccountRoute = (typeof ACCOUNT_ROUTES)[keyof typeof ACCOUNT_ROUTES];

type RequiredActions = AccountState['requiredActions'];

/** Highest-priority first: restricted-session actions, then policy acceptance, then the age declaration. */
const PRIORITY: readonly RequiredActions[number][] = ['RECOVERY_REVIEW', 'PHONE_STEP_UP', 'ACCEPT_POLICIES', 'AGE_DECLARATION'];

export function primaryRequiredAction(actions: RequiredActions): RequiredActions[number] | null {
  return PRIORITY.find((a) => actions.includes(a)) ?? null;
}

/** @internal exported for unit tests; screens use redirectFor. */
export function routeForRequiredActions(actions: RequiredActions): AccountRoute {
  switch (primaryRequiredAction(actions)) {
    case 'RECOVERY_REVIEW':
    case 'PHONE_STEP_UP':
      return ACCOUNT_ROUTES.requiredAction;
    case 'ACCEPT_POLICIES':
      return ACCOUNT_ROUTES.policies;
    case 'AGE_DECLARATION':
      return ACCOUNT_ROUTES.age;
    case null:
      return ACCOUNT_ROUTES.home;
  }
}

const ONBOARDING_PATHS: readonly string[] = [ACCOUNT_ROUTES.policies, ACCOUNT_ROUTES.age, ACCOUNT_ROUTES.requiredAction];

const isLegalPath = (pathname: string): boolean => pathname === '/legal' || pathname.startsWith('/legal/');

/**
 * Where a signed-in user on `pathname` must be sent, or null if the path is allowed for this server state.
 *  - A pending action pins the user to its screen; policy texts stay readable while accepting policies or declaring age.
 *  - Restricted-session actions (recovery review, phone step-up) expose nothing else.
 *  - Without pending actions, onboarding screens redirect home (no stale onboarding after a restart).
 */
export function redirectFor(actions: RequiredActions, pathname: string): AccountRoute | null {
  const target = routeForRequiredActions(actions);
  if (pathname === target) return null;
  if (target === ACCOUNT_ROUTES.home) return ONBOARDING_PATHS.includes(pathname) ? target : null;
  if (target !== ACCOUNT_ROUTES.requiredAction && isLegalPath(pathname)) return null;
  return target;
}
