// SPIKE-ONLY simulated mobile client: authenticated Socket.IO subscription + authoritative snapshot reconciliation.
import { io, type Socket } from 'socket.io-client';
import { API_PORT, signToken, type EntityEvent, type Snapshot } from './shared.js';

export const GATEWAY_PORTS = [4101, 4102];
const API = `http://127.0.0.1:${API_PORT}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type Recovery = { disconnectAt: number; reconnectedAt?: number; reconciledAt?: number };

export class Client {
  socket: Socket | undefined;
  lastVersion = -1;
  gateway: number;
  connectedOnce = false;
  initialReadyMs: number | undefined;
  readonly startedAt = Date.now();
  readonly recoveries: Recovery[] = [];
  /** [receivedAtEpochMs, deliveryLatencyMs] */
  readonly deliveries: Array<[number, number]> = [];
  gapFetches = 0;
  staleOrDuplicate = 0;
  failedConnects = 0;
  private readonly token: string;

  constructor(
    readonly id: number,
    readonly entityId: number,
    gateway: number,
  ) {
    this.gateway = gateway;
    this.token = signToken({ sub: `synthetic-${id}`, entityId, exp: Date.now() + 3_600_000 });
  }

  connect(): void {
    const s = io(`http://127.0.0.1:${this.gateway}`, { transports: ['websocket'], reconnection: false, auth: { token: this.token }, timeout: 5000, forceNew: true });
    this.socket = s;
    s.on('connect', () => {
      const rec = this.recoveries.at(-1);
      if (rec && rec.reconnectedAt === undefined) rec.reconnectedAt = Date.now();
      void this.reconcile();
    });
    s.on('entity.updated', (e: EntityEvent) => {
      const now = Date.now();
      this.deliveries.push([now, now - e.emittedAt]);
      if (e.version <= this.lastVersion) this.staleOrDuplicate++;
      else if (e.version === this.lastVersion + 1 && this.lastVersion >= 0) this.lastVersion = e.version;
      else {
        this.gapFetches++;
        void this.reconcile();
      }
    });
    s.on('connect_error', () => {
      this.failedConnects++;
      this.retry();
    });
    s.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return;
      this.recoveries.push({ disconnectAt: Date.now() });
      this.retry();
    });
  }

  /** Simulates a load balancer: fail over to the other gateway with jittered backoff. */
  private retry(): void {
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.gateway = GATEWAY_PORTS.find((p) => p !== this.gateway) ?? this.gateway;
    setTimeout(() => this.connect(), 100 + Math.random() * 400);
  }

  /** Authoritative recovery: the snapshot API, never the socket stream, defines current state. */
  async reconcile(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await fetch(`${API}/v1/spike/entities/${this.entityId}/snapshot`, { headers: { authorization: `Bearer ${this.token}` } });
        if (!r.ok) throw new Error(`snapshot ${r.status}`);
        const snap = (await r.json()) as Snapshot;
        if (snap.version > this.lastVersion) this.lastVersion = snap.version;
        if (!this.connectedOnce) {
          this.connectedOnce = true;
          this.initialReadyMs = Date.now() - this.startedAt;
        }
        const rec = this.recoveries.at(-1);
        if (rec && rec.reconnectedAt !== undefined && rec.reconciledAt === undefined) rec.reconciledAt = Date.now();
        return;
      } catch {
        await sleep(100 * 2 ** attempt);
      }
    }
  }

  close(): void {
    this.socket?.removeAllListeners();
    this.socket?.close();
  }
}
