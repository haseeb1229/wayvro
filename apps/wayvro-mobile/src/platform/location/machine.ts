/**
 * Rider foreground-location state machine (A07, V05, U05; FA-02 APPROVED scope; docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md
 * §4.1). Pure: the adapters (`status.ts`, `request.ts`) feed it snapshots and fix results; screens render its state.
 *
 *  - The OS dialog appears only after the in-app rationale and only after the rider tapped "Use current location".
 *  - BLOCKED (Android "don't ask again" / iOS denied) never loops the OS dialog: the UI offers Settings instead.
 *  - Revocation found on a foreground re-check discards every in-memory fix silently.
 *  - Status re-checks are ignored while the OS dialog is up (Android pauses the activity around it).
 *  - One fix attempt per tap plus one manual retry.
 */
export type LocationPhase =
  | 'UNKNOWN'
  | 'NOT_DETERMINED'
  | 'RATIONALE'
  | 'REQUESTING'
  | 'GRANTED_PRECISE'
  | 'GRANTED_APPROXIMATE'
  | 'DENIED_CAN_ASK'
  | 'BLOCKED'
  | 'REVOKED'
  | 'SERVICES_OFF'
  | 'FIXING'
  | 'FIX_OK'
  | 'FIX_TIMEOUT'
  | 'FIX_UNAVAILABLE';

type GrantedAccuracy = 'precise' | 'approximate';

/** Platform-neutral permission snapshot (built from the expo-location response by `status.ts`). */
export interface PermissionSnapshot {
  readonly status: 'granted' | 'denied' | 'undetermined';
  readonly canAskAgain: boolean;
  /** Granted accuracy; null when not granted. */
  readonly accuracy: GrantedAccuracy | null;
  readonly servicesEnabled: boolean;
}

/** The fields of expo-location's permission response this module reads (structural; enum values are these strings). */
export interface RawPermissionResponse {
  readonly status: string;
  readonly canAskAgain: boolean;
  readonly android?: { readonly accuracy: string };
  readonly ios?: { readonly accuracy: string };
}

/** Android `coarse` and iOS `reduced` grants are APPROXIMATE; anything that is not `granted`/`undetermined` is denied. */
export function snapshotFromPermission(response: RawPermissionResponse, servicesEnabled: boolean): PermissionSnapshot {
  const granted = response.status === 'granted';
  const approximate = response.android?.accuracy === 'coarse' || response.ios?.accuracy === 'reduced';
  const status = granted ? 'granted' : response.status === 'undetermined' ? 'undetermined' : 'denied';
  return { status, canAskAgain: response.canAskAgain, accuracy: granted ? (approximate ? 'approximate' : 'precise') : null, servicesEnabled };
}

export interface LocationState {
  readonly phase: LocationPhase;
  /** Accuracy of the current grant (kept through FIXING/FIX_*); null when not granted. */
  readonly accuracy: GrantedAccuracy | null;
  /** Where "Not now" on the rationale returns to. */
  readonly returnTo: LocationPhase | null;
  /** The rationale was shown in this session (it is shown again after a denial at most once per session). */
  readonly rationaleShown: boolean;
  /** Fix attempts for the current tap: 1 = first attempt, 2 = the one manual retry. */
  readonly fixAttempts: number;
  readonly lastSnapshot: PermissionSnapshot | null;
}

export type LocationEvent =
  | { readonly type: 'STATUS'; readonly snapshot: PermissionSnapshot }
  | { readonly type: 'TAP_USE_CURRENT' }
  | { readonly type: 'RATIONALE_CONTINUE' }
  | { readonly type: 'RATIONALE_NOT_NOW' }
  | { readonly type: 'REQUEST_RESULT'; readonly snapshot: PermissionSnapshot }
  | { readonly type: 'TAP_USE_PRECISE' }
  | { readonly type: 'RETRY_FIX' }
  | { readonly type: 'FIX_RESULT'; readonly result: 'ok' | 'timeout' | 'unavailable' };

export const INITIAL_LOCATION_STATE: LocationState = {
  phase: 'UNKNOWN',
  accuracy: null,
  returnTo: null,
  rationaleShown: false,
  fixAttempts: 0,
  lastSnapshot: null,
};

/** Maximum fix attempts per tap (one attempt + one manual retry). */
const MAX_FIX_ATTEMPTS = 2;

const GRANTED_PHASES: ReadonlySet<LocationPhase> = new Set(['GRANTED_PRECISE', 'GRANTED_APPROXIMATE', 'FIXING', 'FIX_OK', 'FIX_TIMEOUT', 'FIX_UNAVAILABLE']);

export const isGrantedPhase = (phase: LocationPhase): boolean => GRANTED_PHASES.has(phase);

/** The resting phase a snapshot describes (no rationale, request or fix in progress). */
export function phaseOf(snapshot: PermissionSnapshot): LocationPhase {
  if (!snapshot.servicesEnabled) return 'SERVICES_OFF';
  switch (snapshot.status) {
    case 'granted':
      return snapshot.accuracy === 'approximate' ? 'GRANTED_APPROXIMATE' : 'GRANTED_PRECISE';
    case 'undetermined':
      return snapshot.canAskAgain ? 'NOT_DETERMINED' : 'BLOCKED';
    case 'denied':
      return snapshot.canAskAgain ? 'DENIED_CAN_ASK' : 'BLOCKED';
  }
}

const rest = (state: LocationState, snapshot: PermissionSnapshot): LocationState => {
  const phase = phaseOf(snapshot);
  return { ...state, phase, accuracy: isGrantedPhase(phase) ? snapshot.accuracy : null, fixAttempts: 0, lastSnapshot: snapshot };
};

const startFix = (state: LocationState, attempts: number): LocationState => ({ ...state, phase: 'FIXING', fixAttempts: attempts });

function onStatus(state: LocationState, snapshot: PermissionSnapshot): LocationState {
  // The OS dialog pauses the activity; its foreground re-check must not cancel the request in progress.
  if (state.phase === 'REQUESTING' || state.phase === 'RATIONALE') return { ...state, lastSnapshot: snapshot };
  const next = phaseOf(snapshot);
  if (isGrantedPhase(state.phase)) {
    if (next === 'SERVICES_OFF') return rest(state, snapshot);
    if (!isGrantedPhase(next)) return { ...state, phase: 'REVOKED', accuracy: null, fixAttempts: 0, lastSnapshot: snapshot };
    // Precision downgraded in Settings: earlier precise fixes are discarded (Android may also restart the process).
    if (snapshot.accuracy !== state.accuracy) return rest(state, snapshot);
    return { ...state, lastSnapshot: snapshot };
  }
  return rest(state, snapshot);
}

function onTap(state: LocationState): LocationState {
  switch (state.phase) {
    case 'NOT_DETERMINED':
      return { ...state, phase: 'RATIONALE', returnTo: state.phase };
    case 'DENIED_CAN_ASK':
      return state.rationaleShown ? { ...state, phase: 'REQUESTING' } : { ...state, phase: 'RATIONALE', returnTo: state.phase };
    case 'REVOKED': {
      const canAsk = state.lastSnapshot?.canAskAgain ?? false;
      if (!canAsk) return { ...state, phase: 'BLOCKED' };
      return state.rationaleShown ? { ...state, phase: 'REQUESTING' } : { ...state, phase: 'RATIONALE', returnTo: 'DENIED_CAN_ASK' };
    }
    case 'GRANTED_PRECISE':
    case 'GRANTED_APPROXIMATE':
    case 'FIX_OK':
    case 'FIX_TIMEOUT':
    case 'FIX_UNAVAILABLE':
      return startFix(state, 1);
    case 'UNKNOWN':
    case 'RATIONALE':
    case 'REQUESTING':
    case 'FIXING':
    case 'BLOCKED':
    case 'SERVICES_OFF':
      return state;
  }
}

export function locationReducer(state: LocationState, event: LocationEvent): LocationState {
  switch (event.type) {
    case 'STATUS':
      return onStatus(state, event.snapshot);
    case 'TAP_USE_CURRENT':
      return onTap(state);
    case 'RATIONALE_CONTINUE':
      return state.phase === 'RATIONALE' ? { ...state, phase: 'REQUESTING', rationaleShown: true } : state;
    case 'RATIONALE_NOT_NOW':
      return state.phase === 'RATIONALE' ? { ...state, phase: state.returnTo ?? 'NOT_DETERMINED', returnTo: null, rationaleShown: true } : state;
    case 'REQUEST_RESULT': {
      if (state.phase !== 'REQUESTING') return state;
      const next = rest(state, event.snapshot);
      // The rider asked for the current location: a grant goes straight to the fix.
      return isGrantedPhase(next.phase) ? startFix(next, 1) : next;
    }
    case 'TAP_USE_PRECISE':
      return isGrantedPhase(state.phase) && state.accuracy === 'approximate' && state.phase !== 'FIXING' ? { ...state, phase: 'REQUESTING' } : state;
    case 'RETRY_FIX':
      return (state.phase === 'FIX_TIMEOUT' || state.phase === 'FIX_UNAVAILABLE') && state.fixAttempts < MAX_FIX_ATTEMPTS
        ? startFix(state, state.fixAttempts + 1)
        : state;
    case 'FIX_RESULT': {
      // A watch update (pin screen) may also deliver a fix while a grant is resting.
      const accepts = state.phase === 'FIXING' || (event.result === 'ok' && isGrantedPhase(state.phase));
      if (!accepts) return state;
      const phase = event.result === 'ok' ? 'FIX_OK' : event.result === 'timeout' ? 'FIX_TIMEOUT' : 'FIX_UNAVAILABLE';
      return { ...state, phase };
    }
  }
}

/** A manual retry is still available after a failed fix. */
export const canRetryFix = (state: LocationState): boolean =>
  (state.phase === 'FIX_TIMEOUT' || state.phase === 'FIX_UNAVAILABLE') && state.fixAttempts < MAX_FIX_ATTEMPTS;

/**
 * Whether a fix may be offered as the pickup ("Is this your pickup?" — the rider still confirms). An APPROXIMATE fix
 * never is: it only biases search (2 decimals) and centres the pin view.
 */
export const fixUsableAsPickup = (state: LocationState): boolean => state.phase === 'FIX_OK' && state.accuracy === 'precise';
