/**
 * Rows the receiver appends (JSON Lines) to its data file OUTSIDE the repository (protocol §5.4/§15). Every `ms` is
 * receiver (server) time. No row contains a coordinate, a device identifier, an IP address or the run token.
 */
import type { AppStateLabel } from '../src/shared/payload.ts';
import type { OfferChannel, PresenceState } from '../src/shared/protocol.ts';

export type PointOutcome = 'stored' | 'duplicate' | 'rejected_after_offline';

export type Row =
  | { k: 'session'; ms: number; event: 'start' | 'stop'; params?: Record<string, number | string> }
  | {
      k: 'point';
      ms: number;
      runId: string;
      seq: number;
      fixTimeMs: number;
      accuracyBucketM: number | null;
      deltaMBucket: number | null;
      mocked: boolean;
      appState: AppStateLabel;
      fgsActive: boolean;
      batteryPct: number | null;
      powerSave: boolean | null;
      outcome: PointOutcome;
    }
  | { k: 'clock'; ms: number; runId: string; t0: number; ts: number; t1: number }
  | { k: 'stats'; ms: number; runId: string; bufferDepth: number; bufferDrops: number; fixesTotal: number }
  | { k: 'presence'; ms: number; runId: string | null; from: PresenceState; to: PresenceState; reason: string }
  | { k: 'offer_emit'; ms: number; runId: string; offerId: string; expiresMs: number; socketConnected: boolean }
  | { k: 'offer_ack'; ms: number; runId: string; offerId: string; channel: OfferChannel; clientRecvDeviceMs: number; first: boolean }
  | { k: 'snapshot'; ms: number; via: SnapshotVia; runId: string | null }
  | { k: 'socket'; ms: number; event: 'connect' | 'disconnect'; runId: string | null; detail?: string }
  | { k: 'host'; ms: number; action: string; label?: string }
  | { k: 'client_event'; ms: number; type: string; deviceMs: number; code?: string; runId?: string }
  | { k: 'gateway'; ms: number; event: 'down' | 'up' };

export const SNAPSHOT_VIA = ['start', 'reconnect', 'poll', 'foreground', 'resume'] as const;
export type SnapshotVia = (typeof SNAPSHOT_VIA)[number];
