/**
 * Which receiver snapshot may act on the client's current session (role model §6: the server is authoritative — but
 * only a snapshot that describes THIS run's server state).
 *
 * Found in the 2026-10-16 LOCAL_EMULATOR_SUPPLEMENTARY run (API 35, TC-18 → go online again): a snapshot fetched
 * before the receiver accepted the new run's go-online (server still OFFLINE/RESTRICTED for the previous run) arrived
 * after the engine had created the new session, and `applySnapshot` treated it as "server says OFFLINE" — the new run
 * was stopped client-side while the receiver had just marked it ONLINE (then STALE and TRACKING_LOST 2 min later).
 *
 * Rule: until the receiver has accepted this run's go-online, and for any snapshot generated (server clock) before that
 * acceptance, the snapshot describes an earlier run and is ignored for stop/offer decisions. A snapshot generated at or
 * after acceptance stops the session when it says OFFLINE or names another run.
 */
import type { Snapshot } from './protocol.ts';

export type SessionView = { readonly runId: string; readonly confirmedServerMs: number | null };
export type SnapshotDecision = 'apply' | 'stop' | 'ignore-stale';

export function decideSnapshot(session: SessionView | null, snap: Pick<Snapshot, 'serverTimeMs' | 'presence' | 'runId'>): SnapshotDecision {
  if (!session) return 'apply';
  if (session.confirmedServerMs === null || snap.serverTimeMs < session.confirmedServerMs) return 'ignore-stale';
  if (snap.presence === 'OFFLINE' || snap.runId !== session.runId) return 'stop';
  return 'apply';
}
