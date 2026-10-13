/**
 * Fix parameters and precision rules (docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md §4.4/§4.5). Pure so the timing
 * rules are unit-tested without a device. Coordinates live in memory only: nothing here persists or logs them.
 */

/** One-shot fix ("Use current location"). Balanced accuracy; the last known position is reused only if fresh and tight. @internal exported for unit tests */
export const ONE_SHOT_FIX = { lastKnownMaxAgeMs: 30_000, lastKnownMaxAccuracyM: 100, timeoutMs: 10_000 } as const;

/** Scoped watch: only while `/ride/pin` is focused and the app is active; stopped on blur/background/sign-out/revocation. */
export const PIN_WATCH = { timeIntervalMs: 5_000, distanceIntervalM: 10 } as const;

export interface DeviceFix {
  readonly lat: number;
  readonly lng: number;
  /** Radius of uncertainty in metres; null when the platform does not report one. */
  readonly accuracyM: number | null;
  /** Device timestamp of the fix (ms). */
  readonly timestamp: number;
}

export type FixOutcome = { readonly kind: 'ok'; readonly fix: DeviceFix } | { readonly kind: 'timeout' } | { readonly kind: 'unavailable' };

/** The last known position is accepted only when it is at most 30 s old and at most 100 m uncertain. @internal exported for unit tests */
export function acceptLastKnown(fix: DeviceFix | null, now: number): boolean {
  if (fix === null || fix.accuracyM === null) return false;
  const age = now - fix.timestamp;
  return age >= 0 && age <= ONE_SHOT_FIX.lastKnownMaxAgeMs && fix.accuracyM <= ONE_SHOT_FIX.lastKnownMaxAccuracyM;
}

export interface OneShotDeps {
  readonly lastKnown: () => Promise<DeviceFix | null>;
  /** Balanced-accuracy current position; may never settle on some devices — the app-side timeout bounds it. */
  readonly current: () => Promise<DeviceFix>;
  readonly now: () => number;
  /** Resolves after `ms` (injected so tests use a fake clock). */
  readonly delay: (ms: number) => Promise<void>;
}

/** One attempt: a fresh last-known fix, else the current position raced against the 10 s app-side timeout. */
export async function oneShotFix(deps: OneShotDeps): Promise<FixOutcome> {
  let last: DeviceFix | null;
  try {
    last = await deps.lastKnown();
  } catch {
    last = null;
  }
  if (acceptLastKnown(last, deps.now()) && last !== null) return { kind: 'ok', fix: last };
  const timeout = deps.delay(ONE_SHOT_FIX.timeoutMs).then((): FixOutcome => ({ kind: 'timeout' }));
  const current = deps.current().then(
    (fix): FixOutcome => ({ kind: 'ok', fix }),
    (): FixOutcome => ({ kind: 'unavailable' }),
  );
  return Promise.race([current, timeout]);
}

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Autocomplete bias: 2 decimals (≈1.1 km cell), rounded on the device before sending. */
export const biasPoint = (fix: Pick<DeviceFix, 'lat' | 'lng'>): { readonly lat: number; readonly lng: number } => ({
  lat: round(fix.lat, 2),
  lng: round(fix.lng, 2),
});

/** Pickup / drop-off / reverse geocode: 5 decimals (≈1 m). */
export const pointPrecision = (fix: Pick<DeviceFix, 'lat' | 'lng'>): { readonly lat: number; readonly lng: number } => ({
  lat: round(fix.lat, 5),
  lng: round(fix.lng, 5),
});
