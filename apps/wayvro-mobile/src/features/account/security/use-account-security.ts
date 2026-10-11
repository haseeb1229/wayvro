import { useCallback, useMemo, useRef, useState } from 'react';
import { useServices } from '../../../core/services/ServicesProvider';
import { createAccountSecurityApi, type AccountSecurityApi } from './account-security-api';
import { reduceGuarded, type GuardedEvent, type GuardedPhase } from './account-security';

/** Query keys of the P2.9 account-security reads (cleared with the whole cache on sign-out). */
export const SECURITY_KEYS = {
  phoneChange: ['account', 'phone-change'] as const,
  deletion: ['account', 'deletion'] as const,
  recoveryReview: ['account', 'recovery-review'] as const,
};

export function useAccountSecurityApi(): AccountSecurityApi {
  const { client } = useServices();
  return useMemo(() => createAccountSecurityApi(client.session), [client]);
}

export interface GuardedAction {
  readonly phase: GuardedPhase;
  readonly start: () => void;
  /** Called by the step-up panel once the code was verified. */
  readonly steppedUp: () => void;
  /** The user confirms the retry after the step-up (a new request with a new idempotency key). */
  readonly confirm: () => void;
  readonly cancel: () => void;
}

/**
 * Runs a sensitive action under the step-up rule (see `reduceGuarded`): a "step-up required" refusal opens the code
 * confirmation; the action is retried once, only when the user confirms.
 */
export function useGuardedAction<T>(run: () => Promise<T>, onSuccess: (result: T) => void, onFailure?: (error: unknown) => void): GuardedAction {
  const [phase, setPhase] = useState<GuardedPhase>({ kind: 'idle' });
  const inFlight = useRef(false);
  const dispatch = useCallback((event: GuardedEvent) => {
    setPhase((current) => reduceGuarded(current, event));
  }, []);
  const execute = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    run().then(
      (result) => {
        inFlight.current = false;
        dispatch({ type: 'succeeded' });
        onSuccess(result);
      },
      (error: unknown) => {
        inFlight.current = false;
        dispatch({ type: 'failed', error });
        onFailure?.(error);
      },
    );
  }, [run, onSuccess, onFailure, dispatch]);
  return {
    phase,
    start: () => {
      if (inFlight.current) return;
      dispatch({ type: 'start' });
      execute();
    },
    steppedUp: () => {
      dispatch({ type: 'stepped-up' });
    },
    confirm: () => {
      if (inFlight.current || phase.kind !== 'confirm-retry') return;
      dispatch({ type: 'confirm' });
      execute();
    },
    cancel: () => {
      dispatch({ type: 'cancel' });
    },
  };
}
