/**
 * SP-01 wire vocabulary shared by the spike app and the receiver. Spike reason codes only — they are NOT the Phase-4
 * presence contract (ADR-029/ADR-033 decide that with the SP-01 evidence).
 */

export const SPIKE_PARAMS = {
  /** Protocol §5.3 standard profile. */
  standard: { intervalMs: 5_000, distanceM: 0, accuracy: 'high' },
  /** Protocol §5.3 economy profile (battery comparison on one device only). */
  economy: { intervalMs: 10_000, distanceM: 10, accuracy: 'balanced' },
  uploadEveryMs: 10_000,
  uploadEveryPoints: 5,
  bufferCapacity: 720,
  socketDownBeforePollMs: 10_000,
  pollEveryMs: 15_000,
  offerEveryMs: 120_000,
  firstOfferAfterMs: 60_000,
  offerValidityMs: 20_000,
  tStaleMs: 20_000,
  tOfflineMs: 120_000,
  heartbeatEveryMs: 5_000,
  /** The client only heartbeats while it has a fix younger than this (a live process without location is not "tracking"). */
  heartbeatRequiresFixWithinMs: 15_000,
} as const;

export type LocationProfile = 'standard' | 'economy';

export type PresenceState = 'OFFLINE' | 'ONLINE' | 'STALE';

/** Server-side offline reasons (spike codes). */
export type OfflineReason =
  | 'NEVER_ONLINE'
  | 'USER_OFFLINE'
  | 'SIGNED_OUT'
  | 'TRACKING_LOST'
  | 'RESTRICTED'
  | 'FORCED_OFFLINE'
  | 'PERMISSION_REVOKED'
  | 'PERMISSION_DOWNGRADED'
  | 'PROVIDER_DISABLED'
  | 'START_FAILED'
  | 'FGS_LOST';

export const CLIENT_OFFLINE_REASONS = [
  'USER_OFFLINE',
  'SIGNED_OUT',
  'PERMISSION_REVOKED',
  'PERMISSION_DOWNGRADED',
  'PROVIDER_DISABLED',
  'START_FAILED',
  'FGS_LOST',
] as const satisfies readonly OfflineReason[];
export type ClientOfflineReason = (typeof CLIENT_OFFLINE_REASONS)[number];

/** Go-online refusal codes. */
export type GoOnlineRefusal =
  | 'RESTRICTED'
  | 'PRECISE_LOCATION_REQUIRED'
  | 'FOREGROUND_PERMISSION_DENIED'
  | 'BACKGROUND_PERMISSION_DENIED'
  | 'LOCATION_SERVICES_OFF'
  | 'START_REFUSED_BACKGROUND'
  | 'START_FAILED'
  | 'NETWORK';

/** Client events (counts/types/timestamps only; no position, no device identifiers). */
export const CLIENT_EVENT_TYPES = [
  'GO_ONLINE_REFUSED',
  'FGS_STARTED',
  /** The user confirmed Go offline / Rider switch / Sign out (start of the TC-16/TC-17 stop-time measurement). */
  'OFFLINE_REQUESTED',
  'FGS_STOPPED',
  'PERMISSION_REVOKED',
  'PERMISSION_DOWNGRADED',
  'PROVIDER_DISABLED',
  'LOCATION_TASK_ERROR',
  'START_REFUSED_BACKGROUND',
  'FORCED_OFFLINE_APPLIED',
  'ORPHAN_TASK_STOPPED',
  'STALE_FGS_STOPPED',
  'TRACKING_STOPPED_SHOWN',
  'RESUMED_BY_USER',
  'CRASH_TEST_TRIGGERED',
  'SIGNED_OUT',
] as const;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export type ClientEvent = {
  readonly type: ClientEventType;
  /** Device clock (offset-corrected by the aggregator). */
  readonly deviceMs: number;
  /** Optional short machine code (reason/error code) — never free text from the OS. */
  readonly code?: string;
  readonly runId?: string;
};

export type Offer = { readonly offerId: string; readonly emitMs: number; readonly expiresMs: number };

export type OfferChannel = 'socket' | 'poll' | 'snapshot';

export type Snapshot = {
  readonly serverTimeMs: number;
  readonly presence: PresenceState;
  readonly runId: string | null;
  readonly offlineReason: OfflineReason | null;
  readonly restricted: boolean;
  readonly pendingOffers: readonly Offer[];
};

export type PointsResponse = {
  readonly serverTimeMs: number;
  readonly stored: number;
  readonly duplicates: number;
  readonly rejectedAfterOffline: number;
  readonly presence: PresenceState;
  readonly offlineReason: OfflineReason | null;
};

/** Run ids: 16 random hex chars from the device (not derived from any device identifier). */
export const RUN_ID_PATTERN = /^[a-z0-9-]{8,64}$/;
export const OFFER_ID_PATTERN = /^of-[a-z0-9-]{4,40}$/;
