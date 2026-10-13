import type { AccountState } from '@wayvro/contracts';
import type { ModeHome } from '../mode/availability';

/**
 * Account-state routing by SERVER truth (P2.3; CLAUDE.md §3/§9). The server's `requiredActions` decide which screen a
 * signed-in user may see; local flags never do. The function is pure so restart, foreground, deep-link and
 * notification restores all converge on the same answer for the same server state. Without a pending action the
 * target is the mode home chosen by the restoration resolver (P3.5: `/ride` or `/drive`, core/mode/start-route.ts).
 */
const ACTION_ROUTES = {
  policies: '/onboarding/policies',
  age: '/onboarding/age',
  requiredAction: '/required-action',
} as const;
export type AccountRoute = (typeof ACTION_ROUTES)[keyof typeof ACTION_ROUTES] | ModeHome;

type RequiredActions = AccountState['requiredActions'];

/** Highest-priority first: restricted-session actions, then policy acceptance, then the age declaration. */
const PRIORITY: readonly RequiredActions[number][] = ['RECOVERY_REVIEW', 'PHONE_STEP_UP', 'ACCEPT_POLICIES', 'AGE_DECLARATION'];

export function primaryRequiredAction(actions: RequiredActions): RequiredActions[number] | null {
  return PRIORITY.find((a) => actions.includes(a)) ?? null;
}

/** The screen for the highest-priority required action (or the mode home); also used by the restoration resolver. */
export function routeForRequiredActions(actions: RequiredActions, modeHome: ModeHome): AccountRoute {
  switch (primaryRequiredAction(actions)) {
    case 'RECOVERY_REVIEW':
    case 'PHONE_STEP_UP':
      return ACTION_ROUTES.requiredAction;
    case 'ACCEPT_POLICIES':
      return ACTION_ROUTES.policies;
    case 'AGE_DECLARATION':
      return ACTION_ROUTES.age;
    case null:
      return modeHome;
  }
}

const ONBOARDING_PATHS: readonly string[] = [ACTION_ROUTES.policies, ACTION_ROUTES.age, ACTION_ROUTES.requiredAction];

const isLegalPath = (pathname: string): boolean => pathname === '/legal' || pathname.startsWith('/legal/');

/**
 * Where a signed-in user on `pathname` must be sent, or null if the path is allowed for this server state.
 *  - A pending action pins the user to its screen; policy texts stay readable while accepting policies or declaring age.
 *  - Restricted-session actions (recovery review, phone step-up) expose nothing else.
 *  - Without pending actions, onboarding screens redirect to the mode home (no stale onboarding after a restart).
 */
export function redirectFor(actions: RequiredActions, pathname: string, modeHome: ModeHome): AccountRoute | null {
  const target = routeForRequiredActions(actions, modeHome);
  if (pathname === target) return null;
  if (target === modeHome) return ONBOARDING_PATHS.includes(pathname) ? target : null;
  if (target !== ACTION_ROUTES.requiredAction && isLegalPath(pathname)) return null;
  return target;
}
