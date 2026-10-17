/**
 * Receiver presence state machine for the single synthetic spike driver (protocol §5.3; role model §4 reduced to what
 * SP-01 measures). Server time is authoritative.
 *
 *   OFFLINE --goOnline (not restricted)--> ONLINE
 *   ONLINE  --no liveness for T_stale-->   STALE --liveness--> ONLINE
 *   ONLINE|STALE --no liveness for T_offline--> OFFLINE(TRACKING_LOST)
 *   ONLINE|STALE --goOffline(reason) | forceOffline | restrict--> OFFLINE(reason)
 *
 * Liveness = an upload that stored at least one new point, or a socket heartbeat. Liveness never revives OFFLINE: only
 * an explicit goOnline does (no automatic resume).
 */
import type { OfflineReason, PresenceState } from './protocol.ts';

export type Transition = {
  readonly atMs: number;
  readonly from: PresenceState;
  readonly to: PresenceState;
  readonly reason: OfflineReason | 'LIVENESS_LOST' | 'LIVENESS_RESUMED' | 'GO_ONLINE';
  readonly runId: string | null;
};

export type GoOnlineResult = { ok: true; transitions: Transition[] } | { ok: false; refusal: 'RESTRICTED' };

export class Presence {
  private stateValue: PresenceState = 'OFFLINE';
  private reasonValue: OfflineReason | null = 'NEVER_ONLINE';
  private runIdValue: string | null = null;
  private lastLivenessMs = 0;
  private restrictedValue = false;
  private readonly tStaleMs: number;
  private readonly tOfflineMs: number;

  constructor(opts: { tStaleMs: number; tOfflineMs: number }) {
    if (!(opts.tStaleMs > 0 && opts.tOfflineMs > opts.tStaleMs)) throw new Error('require 0 < T_stale < T_offline');
    this.tStaleMs = opts.tStaleMs;
    this.tOfflineMs = opts.tOfflineMs;
  }

  get state(): PresenceState {
    return this.stateValue;
  }
  get offlineReason(): OfflineReason | null {
    return this.stateValue === 'OFFLINE' ? this.reasonValue : null;
  }
  get runId(): string | null {
    return this.runIdValue;
  }
  get restricted(): boolean {
    return this.restrictedValue;
  }
  get lastLiveness(): number {
    return this.lastLivenessMs;
  }

  private move(nowMs: number, to: PresenceState, reason: Transition['reason']): Transition {
    const t: Transition = { atMs: nowMs, from: this.stateValue, to, reason, runId: this.runIdValue };
    this.stateValue = to;
    if (to === 'OFFLINE') this.reasonValue = reason as OfflineReason;
    return t;
  }

  goOnline(nowMs: number, runId: string): GoOnlineResult {
    if (this.restrictedValue) return { ok: false, refusal: 'RESTRICTED' };
    if (this.stateValue !== 'OFFLINE' && this.runIdValue === runId) {
      // Idempotent repeat of the same go-online.
      this.lastLivenessMs = nowMs;
      return { ok: true, transitions: [] };
    }
    const transitions: Transition[] = [];
    // A new run while the previous one is still online: the previous run is closed first (one active run only).
    if (this.stateValue !== 'OFFLINE') transitions.push(this.move(nowMs, 'OFFLINE', 'USER_OFFLINE'));
    this.runIdValue = runId;
    this.lastLivenessMs = nowMs;
    transitions.push(this.move(nowMs, 'ONLINE', 'GO_ONLINE'));
    return { ok: true, transitions };
  }

  /** Returns a transition when liveness revives STALE; ignored (null) unless ONLINE/STALE for the same run. */
  liveness(nowMs: number, runId: string): Transition | null {
    if (this.stateValue === 'OFFLINE' || runId !== this.runIdValue) return null;
    this.lastLivenessMs = Math.max(this.lastLivenessMs, nowMs);
    if (this.stateValue === 'STALE') return this.move(nowMs, 'ONLINE', 'LIVENESS_RESUMED');
    return null;
  }

  /**
   * Time-driven rules; call at least once per second and before answering any request. Transitions carry the time
   * the server actually decided (the tick time), so measured detection times include the tick granularity.
   */
  tick(nowMs: number): Transition[] {
    const out: Transition[] = [];
    if (this.stateValue === 'OFFLINE') return out;
    const silentMs = nowMs - this.lastLivenessMs;
    if (this.stateValue === 'ONLINE' && silentMs >= this.tStaleMs) out.push(this.move(nowMs, 'STALE', 'LIVENESS_LOST'));
    if (this.stateValue === 'STALE' && silentMs >= this.tOfflineMs) out.push(this.move(nowMs, 'OFFLINE', 'TRACKING_LOST'));
    return out;
  }

  goOffline(nowMs: number, reason: OfflineReason): Transition | null {
    if (this.stateValue === 'OFFLINE') return null;
    return this.move(nowMs, 'OFFLINE', reason);
  }

  restrict(nowMs: number): Transition | null {
    this.restrictedValue = true;
    return this.goOffline(nowMs, 'RESTRICTED');
  }

  unrestrict(): void {
    this.restrictedValue = false;
  }
}
