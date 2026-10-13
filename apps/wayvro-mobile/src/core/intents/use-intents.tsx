import type { AccountState } from '@wayvro/contracts';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { useAccountState } from '../account/use-account-state';
import { currentHome } from '../mode/use-mode';
import { isBlocking } from '../release/client-policy';
import { useAppPolicy } from '../release/AppPolicyGate';
import { useServices } from '../services/ServicesProvider';
import { systemIntents } from './deferred';
import { navigationSteps, resolveIntent, type Intent } from './intent';

/**
 * Applies the router's decision: land on the mode home first (unless already there), then push the target, so back
 * always reaches a home of the right mode. A deferred intent is held again in memory; a refused one shows a notice.
 */
function useApplyIntent(): (intent: Intent, account: AccountState, blocked: boolean) => void {
  const router = useRouter();
  const pathname = usePathname();
  const { modes } = useServices();
  return useCallback(
    (intent: Intent, account: AccountState, blocked: boolean) => {
      const path = pathname;
      const resolution = resolveIntent(intent, {
        appPolicy: blocked ? 'blocked' : 'ok',
        session: { status: 'signed-in', account },
        mode: path.startsWith('/drive') ? 'DRIVER' : 'RIDER',
      });
      switch (resolution.kind) {
        case 'route':
          for (const step of navigationSteps(resolution, currentHome(path))) {
            if (step.op === 'replace') router.replace(step.href);
            else router.push(step.target.params === undefined ? step.target.pathname : { pathname: step.target.pathname, params: step.target.params });
          }
          if (resolution.switched && resolution.mode === 'DRIVER') modes.setNotice('OPENED_DRIVER_AREA');
          return;
        case 'defer':
          systemIntents.hold(intent, Date.now());
          return;
        case 'refuse':
          modes.setNotice('LINK_UNAVAILABLE');
          return;
      }
    },
    [router, modes, pathname],
  );
}

/**
 * Replays a system-delivered intent (held by `+native-intent`) once the account gate has opened: fresh server state,
 * no pending required action, app policy not blocking. Rendered inside AccountGate.
 */
export function PendingIntentRunner({ account }: { readonly account: AccountState }) {
  const policy = useAppPolicy();
  const blocked = isBlocking(policy.view);
  const apply = useApplyIntent();
  useEffect(() => {
    const intent = systemIntents.take(Date.now());
    if (intent !== null) apply(intent, account, blocked);
  }, [account, blocked, apply]);
  return null;
}

/** In-app links and banners ("Continue with your last price check", "Document renewal due") go through the same router. */
export function useIntentNavigation(): (intent: Intent) => void {
  const account = useAccountState();
  const policy = useAppPolicy();
  const apply = useApplyIntent();
  const data = account.data;
  const blocked = isBlocking(policy.view);
  return useCallback(
    (intent: Intent) => {
      if (data === undefined) return;
      apply(intent, data, blocked);
    },
    [data, blocked, apply],
  );
}
