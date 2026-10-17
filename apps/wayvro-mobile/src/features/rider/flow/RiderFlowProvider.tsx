import type { QuoteGroup } from '@wayvro/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { isBlocking } from '../../../core/release/client-policy';
import { useServices } from '../../../core/services/ServicesProvider';
import type { DeviceFix } from '../../../platform/location/fix-policy';
import type { LocationEvent, LocationState, PermissionSnapshot } from '../../../platform/location/machine';
import { currentFix, requestForegroundLocation } from '../../../platform/location/request';
import { readLocationStatus } from '../../../platform/location/status';
import { createRiderApi, type RiderApi } from '../api/rider-api';
import { addRecent, type DraftAction, type DraftPlace, type RiderDraft } from './draft';
import { flowReducer, INITIAL_FLOW } from './flow-state';

/**
 * In-memory state of the rider graph (`/ride/*`), provided by its layout: the trip draft, session recents, the
 * foreground-location state machine with its adapters, the device fix / search bias and the current quote group.
 * Nothing here is persisted (only the quote-group id goes to the mode controller), so sign-out — which unmounts the
 * graph — and process death drop it. A blocking app-policy state discards the draft immediately (UX doc §9).
 */
interface RiderFlow {
  readonly api: RiderApi;
  readonly draft: RiderDraft;
  readonly dispatchDraft: (action: DraftAction) => void;
  readonly recents: readonly DraftPlace[];
  readonly rememberRecent: (place: DraftPlace) => void;
  readonly location: LocationState;
  readonly dispatchLocation: (event: LocationEvent) => void;
  readonly fix: DeviceFix | null;
  readonly bias: { readonly lat: number; readonly lng: number } | null;
  /** Pin-screen watch updates. */
  readonly receiveFix: (fix: DeviceFix) => void;
  readonly group: QuoteGroup | null;
  readonly setGroup: (group: QuoteGroup | null) => void;
}

const RiderFlowContext = createContext<RiderFlow | null>(null);

export function useRiderFlow(): RiderFlow {
  const value = useContext(RiderFlowContext);
  if (!value) throw new Error('useRiderFlow outside RiderFlowProvider');
  return value;
}

/** Fallback when the status read after a failed OS request also fails: treated as "not granted, may ask again". */
const UNREADABLE = { status: 'denied', canAskAgain: true, accuracy: null, servicesEnabled: true } as const;

export function RiderFlowProvider({ children }: { readonly children: ReactNode }) {
  const { client, policy } = useServices();
  const api = useMemo(() => createRiderApi(client.session), [client]);
  const [state, dispatch] = useReducer(flowReducer, INITIAL_FLOW);
  const [recents, setRecents] = useState<readonly DraftPlace[]>([]);
  const [group, setGroup] = useState<QuoteGroup | null>(null);
  const dispatchLocation = useCallback((event: LocationEvent) => {
    dispatch({ type: 'LOCATION', event });
  }, []);

  // Read-only status on mount and on every return to the foreground (revocation detection; never a prompt).
  useEffect(() => {
    let active = true;
    const read = (): void => {
      readLocationStatus().then(
        (snapshot) => {
          if (active) dispatchLocation({ type: 'STATUS', snapshot });
        },
        () => {
          // An unreadable status leaves the machine where it is; search and the pin screen keep working.
        },
      );
    };
    read();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') read();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [dispatchLocation]);

  // Mid-flow HARD_UPDATE / MAINTENANCE: the draft is discarded (subscription callback, not a render-time reset).
  useEffect(
    () =>
      policy.subscribe(() => {
        if (isBlocking(policy.getState().view)) {
          dispatch({ type: 'RESET' });
          setGroup(null);
        }
      }),
    [policy],
  );

  // The OS request runs only in REQUESTING, which the machine enters only after the rationale and a rider tap.
  const phase = state.location.phase;
  useEffect(() => {
    if (phase !== 'REQUESTING') return undefined;
    let active = true;
    const settle = (snapshot: PermissionSnapshot): void => {
      if (active) dispatchLocation({ type: 'REQUEST_RESULT', snapshot });
    };
    requestForegroundLocation().then(settle, () => {
      readLocationStatus().then(settle, () => {
        settle(UNREADABLE);
      });
    });
    return () => {
      active = false;
    };
  }, [phase, dispatchLocation]);

  const fixAttempts = state.location.fixAttempts;
  useEffect(() => {
    if (phase !== 'FIXING') return undefined;
    let active = true;
    currentFix().then(
      (outcome) => {
        if (!active) return;
        if (outcome.kind === 'ok') dispatch({ type: 'FIX_RECEIVED', fix: outcome.fix });
        else dispatchLocation({ type: 'FIX_RESULT', result: outcome.kind });
      },
      () => {
        if (active) dispatchLocation({ type: 'FIX_RESULT', result: 'unavailable' });
      },
    );
    return () => {
      active = false;
    };
  }, [phase, fixAttempts, dispatchLocation]);

  const rememberRecent = useCallback((place: DraftPlace) => {
    setRecents((current) => addRecent(current, place));
  }, []);
  const receiveFix = useCallback((fix: DeviceFix) => {
    dispatch({ type: 'FIX_RECEIVED', fix });
  }, []);

  const value = useMemo<RiderFlow>(
    () => ({
      api,
      draft: state.draft,
      dispatchDraft: dispatch,
      recents,
      rememberRecent,
      location: state.location,
      dispatchLocation,
      fix: state.fix,
      bias: state.bias,
      receiveFix,
      group,
      setGroup,
    }),
    [api, state, recents, rememberRecent, dispatchLocation, receiveFix, group],
  );
  return <RiderFlowContext.Provider value={value}>{children}</RiderFlowContext.Provider>;
}
