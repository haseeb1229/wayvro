/**
 * Transport-independent receiver logic (protocol §5.3/§5.4): presence, idempotent point store, synthetic offers,
 * acks, snapshot. server.ts wires it to HTTP + Socket.IO; tests drive it with a fake clock.
 */
import type { UploadBatch } from '../src/shared/payload.ts';
import { Presence, type Transition } from '../src/shared/presence.ts';
import {
  CLIENT_EVENT_TYPES,
  CLIENT_OFFLINE_REASONS,
  SPIKE_PARAMS,
  type ClientEvent,
  type Offer,
  type OfferChannel,
  type OfflineReason,
  type PointsResponse,
  type Snapshot,
} from '../src/shared/protocol.ts';
import { SeqStore } from '../src/shared/seq-store.ts';
import { estimateOffsetMs } from '../src/shared/stats.ts';
import type { Row, SnapshotVia } from './rows.ts';

export type CoreOptions = {
  readonly now: () => number;
  readonly write: (row: Row) => void;
  readonly newOfferId: () => string;
  /** Called whenever the authoritative presence changes or an offer must be pushed (socket path). */
  readonly onPresenceChange?: (snapshot: Snapshot) => void;
  readonly onOffer?: (offer: Offer, runId: string) => boolean;
  readonly tStaleMs?: number;
  readonly tOfflineMs?: number;
};

type PendingOffer = Offer & { readonly runId: string; acked: boolean };

export class ReceiverCore {
  private readonly presence: Presence;
  private readonly seqs = new SeqStore();
  private readonly offers = new Map<string, PendingOffer>();
  private readonly clock = new Map<string, { t0: number; ts: number; t1: number }[]>();
  private readonly offlineAt = new Map<string, number>();
  private nextOfferAtMs: number | null = null;
  private readonly opts: CoreOptions;

  constructor(opts: CoreOptions) {
    this.opts = opts;
    this.presence = new Presence({ tStaleMs: opts.tStaleMs ?? SPIKE_PARAMS.tStaleMs, tOfflineMs: opts.tOfflineMs ?? SPIKE_PARAMS.tOfflineMs });
  }

  private record(transitions: readonly Transition[]): void {
    for (const t of transitions) {
      this.opts.write({ k: 'presence', ms: t.atMs, runId: t.runId, from: t.from, to: t.to, reason: t.reason });
      if (t.to === 'OFFLINE' && t.runId) this.offlineAt.set(t.runId, t.atMs);
    }
    if (transitions.length > 0) this.opts.onPresenceChange?.(this.snapshot('internal'));
  }

  /** Time rules + offer schedule. server.ts calls this every second. */
  tick(): void {
    const now = this.opts.now();
    this.record(this.presence.tick(now));
    const runId = this.presence.runId;
    if (this.presence.state === 'OFFLINE' || runId === null) {
      this.nextOfferAtMs = null;
      return;
    }
    if (this.nextOfferAtMs !== null && now >= this.nextOfferAtMs) {
      const offer: Offer = { offerId: this.opts.newOfferId(), emitMs: now, expiresMs: now + SPIKE_PARAMS.offerValidityMs };
      this.offers.set(offer.offerId, { ...offer, runId, acked: false });
      const pushed = this.opts.onOffer?.(offer, runId) ?? false;
      this.opts.write({ k: 'offer_emit', ms: now, runId, offerId: offer.offerId, expiresMs: offer.expiresMs, socketConnected: pushed });
      this.nextOfferAtMs += SPIKE_PARAMS.offerEveryMs;
    }
  }

  snapshot(via: SnapshotVia | 'internal'): Snapshot {
    const now = this.opts.now();
    this.record(this.presence.tick(now));
    const runId = this.presence.runId;
    if (via !== 'internal') this.opts.write({ k: 'snapshot', ms: now, via, runId });
    const pending =
      this.presence.state === 'OFFLINE'
        ? []
        : [...this.offers.values()]
            .filter((o) => o.runId === runId && !o.acked && o.expiresMs > now)
            .map((o) => ({ offerId: o.offerId, emitMs: o.emitMs, expiresMs: o.expiresMs }));
    return {
      serverTimeMs: now,
      presence: this.presence.state,
      runId,
      offlineReason: this.presence.offlineReason,
      restricted: this.presence.restricted,
      pendingOffers: pending,
    };
  }

  goOnline(runId: string): { ok: true; snapshot: Snapshot } | { ok: false; refusal: 'RESTRICTED'; snapshot: Snapshot } {
    const now = this.opts.now();
    const result = this.presence.goOnline(now, runId);
    if (!result.ok) return { ok: false, refusal: result.refusal, snapshot: this.snapshot('internal') };
    if (result.transitions.some((t) => t.to === 'ONLINE')) this.nextOfferAtMs = now + SPIKE_PARAMS.firstOfferAfterMs;
    this.record(result.transitions);
    return { ok: true, snapshot: this.snapshot('internal') };
  }

  goOffline(runId: string, reason: string): Snapshot {
    const now = this.opts.now();
    const valid = (CLIENT_OFFLINE_REASONS as readonly string[]).includes(reason) ? (reason as OfflineReason) : 'USER_OFFLINE';
    if (this.presence.runId === runId) {
      const t = this.presence.goOffline(now, valid);
      if (t) this.record([t]);
    }
    return this.snapshot('internal');
  }

  restrict(): void {
    const now = this.opts.now();
    const before = this.presence.state;
    const t = this.presence.restrict(now);
    this.opts.write({ k: 'host', ms: now, action: 'restrict' });
    if (t) this.record([t]);
    else if (before === 'OFFLINE') this.opts.onPresenceChange?.(this.snapshot('internal'));
  }

  unrestrict(): void {
    this.presence.unrestrict();
    this.opts.write({ k: 'host', ms: this.opts.now(), action: 'unrestrict' });
    this.opts.onPresenceChange?.(this.snapshot('internal'));
  }

  forceOffline(): void {
    const now = this.opts.now();
    this.opts.write({ k: 'host', ms: now, action: 'force-offline' });
    const t = this.presence.goOffline(now, 'FORCED_OFFLINE');
    if (t) this.record([t]);
  }

  heartbeat(runId: string): void {
    const t = this.presence.liveness(this.opts.now(), runId);
    if (t) this.record([t]);
  }

  private offsetFor(runId: string): number {
    return estimateOffsetMs(this.clock.get(runId) ?? []) ?? 0;
  }

  points(batch: UploadBatch): PointsResponse {
    const now = this.opts.now();
    this.record(this.presence.tick(now));
    const { runId } = batch;
    const samples = [...(this.clock.get(runId) ?? []), ...batch.clock].slice(-50);
    this.clock.set(runId, samples);
    for (const c of batch.clock) this.opts.write({ k: 'clock', ms: now, runId, t0: c.t0, ts: c.ts, t1: c.t1 });
    this.opts.write({ k: 'stats', ms: now, runId, ...batch.stats });
    const offset = this.offsetFor(runId);
    const isCurrentLive = this.presence.runId === runId && this.presence.state !== 'OFFLINE';
    const offAt = this.offlineAt.get(runId);
    let stored = 0;
    let duplicates = 0;
    let rejected = 0;
    let newestFresh = Number.NEGATIVE_INFINITY;
    for (const p of batch.points) {
      const corrected = p.fixTimeMs + offset;
      // Points are accepted while the run is live, or — after the server took the run OFFLINE — only if they were
      // fixed before that moment (buffered during an outage). Nothing fixed after a forced OFFLINE is accepted (TC-19).
      const acceptable = isCurrentLive || (offAt !== undefined && corrected <= offAt);
      let outcome: 'stored' | 'duplicate' | 'rejected_after_offline';
      if (!acceptable) outcome = 'rejected_after_offline';
      else outcome = this.seqs.add(runId, p.seq);
      if (outcome === 'stored') {
        stored += 1;
        newestFresh = Math.max(newestFresh, corrected);
      } else if (outcome === 'duplicate') duplicates += 1;
      else rejected += 1;
      this.opts.write({ k: 'point', ms: now, ...p, outcome });
    }
    // Liveness only from a FRESH fix: a replay of old buffered points must not make a dead tracker look alive.
    if (stored > 0 && now - newestFresh <= SPIKE_PARAMS.tStaleMs) this.heartbeat(runId);
    const snap = this.snapshot('internal');
    return {
      serverTimeMs: now,
      stored,
      duplicates,
      rejectedAfterOffline: rejected,
      presence: snap.runId === runId ? snap.presence : 'OFFLINE',
      offlineReason: snap.runId === runId ? snap.offlineReason : 'USER_OFFLINE',
    };
  }

  ack(offerId: string, channel: OfferChannel, clientRecvDeviceMs: number): boolean {
    const o = this.offers.get(offerId);
    if (!o) return false;
    const first = !o.acked;
    o.acked = true;
    this.opts.write({ k: 'offer_ack', ms: this.opts.now(), runId: o.runId, offerId, channel, clientRecvDeviceMs, first });
    return true;
  }

  events(events: readonly ClientEvent[]): number {
    const now = this.opts.now();
    let accepted = 0;
    for (const e of events) {
      if (!(CLIENT_EVENT_TYPES as readonly string[]).includes(e.type) || !Number.isFinite(e.deviceMs)) continue;
      const code = typeof e.code === 'string' && /^[A-Za-z0-9_:.-]{1,64}$/.test(e.code) ? e.code : undefined;
      const runId = typeof e.runId === 'string' && /^[a-z0-9-]{8,64}$/.test(e.runId) ? e.runId : undefined;
      this.opts.write({ k: 'client_event', ms: now, type: e.type, deviceMs: e.deviceMs, ...(code ? { code } : {}), ...(runId ? { runId } : {}) });
      accepted += 1;
    }
    return accepted;
  }

  status(): Record<string, string | number | boolean | null> {
    const s = this.snapshot('internal');
    return {
      presence: s.presence,
      offlineReason: s.offlineReason,
      runId: s.runId,
      restricted: s.restricted,
      storedPointsThisRun: s.runId ? this.seqs.count(s.runId) : 0,
      pendingOffers: s.pendingOffers.length,
      nextOfferInS: this.nextOfferAtMs === null ? null : Math.max(0, Math.round((this.nextOfferAtMs - this.opts.now()) / 1000)),
    };
  }
}
