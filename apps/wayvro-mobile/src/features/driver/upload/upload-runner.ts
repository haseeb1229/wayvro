import type { EvidenceUploadStatus } from '@wayvro/contracts';
import { ApiError } from '../../../core/api/errors';
import type { EvidenceList, EvidenceSlotRequest, EvidenceUploadSlot } from '../api/driver-api';
import {
  createUploadItem,
  nextUploadAction,
  reduceUpload,
  type EnqueueRefusal,
  type NewUpload,
  type UploadAction,
  type UploadEvent,
  type UploadItem,
} from './upload-queue';

/**
 * Runs the upload queue (P2.8): executes the next action of each item through injected ports, one network step at a
 * time, persists metadata after every transition and wakes itself for backoff/poll timers. It runs only while the
 * app's JS runtime is alive and only once the Driver/Partner flow has been opened (no background worker, no work at
 * app start for riders). Transfers go straight to the presigned storage URL with exactly the signed headers.
 */

/** @internal exported for unit tests */
export interface UploadApiPort {
  requestSlot(localId: string, applicationId: string, request: EvidenceSlotRequest): Promise<EvidenceUploadSlot>;
  complete(uploadId: string): Promise<EvidenceUploadStatus>;
  evidence(applicationId: string): Promise<EvidenceList>;
  discard(uploadId: string): Promise<void>;
}

export type PutOutcome = 'ok' | 'refused' | 'failed' | 'missing';

/** Local evidence files (the app's private cache directory). */
export interface UploadFilePort {
  put(fileName: string, url: string, headers: Readonly<Record<string, string>>, signal: AbortSignal): Promise<PutOutcome>;
  delete(fileName: string): Promise<void>;
  list(): Promise<readonly string[]>;
  wipe(): Promise<void>;
}

export interface QueuePersistence {
  load(): Promise<readonly UploadItem[]>;
  save(items: readonly UploadItem[]): Promise<void>;
  clear(): Promise<void>;
}

interface RunnerClock {
  /** Device clock (backoff timers). */
  now(): number;
  /** Device clock corrected by the server's Date header offset (presigned-URL expiry only). */
  serverNow(): number;
  random(): number;
  /** Schedules `fn` after `ms`; returns a cancel function. */
  setTimer(fn: () => void, ms: number): () => void;
}

export interface UploadRunnerDeps {
  readonly api: UploadApiPort;
  readonly files: UploadFilePort;
  readonly persistence: QueuePersistence;
  readonly clock: RunnerClock;
}

interface SignedUpload {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: number;
}

/** A URL this close to its expiry is not used (the PUT would be refused mid-transfer). */
const URL_SAFETY_MS = 15_000;

export type RemoveOutcome = 'removed' | 'offline' | 'failed';

export class UploadRunner {
  private items: readonly UploadItem[] = [];
  private readonly urls = new Map<string, SignedUpload>();
  private readonly listeners = new Set<() => void>();
  private started: Promise<void> | null = null;
  private pumping = false;
  private pumpAgain = false;
  private cancelTimer: (() => void) | null = null;
  private inflight: AbortController | null = null;
  private stopped = false;
  private writes: Promise<unknown> = Promise.resolve();
  /** Files handed to enqueue while the queue is still being restored: never treated as orphans. */
  private readonly reserved = new Set<string>();

  constructor(private readonly deps: UploadRunnerDeps) {}

  getSnapshot = (): readonly UploadItem[] => this.items;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Restores the persisted queue once, resumes interrupted items, removes orphaned files and starts working. */
  start(): Promise<void> {
    this.started ??= this.restore().catch((error: unknown) => {
      this.started = null;
      throw error;
    });
    return this.started;
  }

  private async restore(): Promise<void> {
    const loaded = await this.deps.persistence.load();
    const now = this.deps.clock.now();
    this.items = loaded.map((item) => reduceUpload(item, { type: 'resume' }, now, () => this.deps.clock.random()));
    // Files left behind by a crash between capture and enqueue (or by a failed delete) are removed (Q01).
    const referenced = new Set(this.items.filter((i) => !i.fileDeleted).map((i) => i.fileName));
    for (const name of await this.deps.files.list()) if (!referenced.has(name) && !this.reserved.has(name)) await this.deps.files.delete(name);
    await this.persist();
    this.notify();
    this.pump();
  }

  async enqueue(input: NewUpload): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: EnqueueRefusal }> {
    this.reserved.add(input.fileName);
    try {
      await this.start();
    } finally {
      this.reserved.delete(input.fileName);
    }
    const created = createUploadItem(input, this.items);
    if (!created.ok) return created;
    this.items = [...this.items, created.item];
    await this.persist();
    this.notify();
    this.pump();
    return { ok: true };
  }

  /** User "try again" on a failed item (or "check again" on a long-running check). */
  async retry(id: string): Promise<void> {
    await this.start();
    this.apply(id, { type: 'retry' });
    this.apply(id, { type: 'poll-again' });
    await this.persist();
    this.pump();
  }

  /**
   * User discard: the server copy (if a slot was issued) is discarded first, then the local file and the item. If the
   * server cannot be reached the item is kept, so a photo is never silently left on the server.
   */
  async remove(id: string): Promise<RemoveOutcome> {
    await this.start();
    const item = this.items.find((i) => i.id === id);
    if (!item) return 'removed';
    for (const uploadId of [item.uploadId, item.staleUploadId]) {
      if (uploadId === null) continue;
      try {
        await this.deps.api.discard(uploadId);
      } catch (error) {
        // Not found / not editable any more: nothing left to discard on the server for this item.
        if (!(error instanceof ApiError && error.kind === 'conflict')) return error instanceof ApiError && error.detail.transient ? 'offline' : 'failed';
      }
    }
    await this.dropItems([item]);
    return 'removed';
  }

  /** The application can no longer take evidence (withdrawn, expired, decided): its items and files are removed. */
  async abandonApplication(applicationId: string): Promise<void> {
    await this.start();
    const gone = this.items.filter((i) => i.applicationId === applicationId);
    if (gone.length > 0) await this.dropItems(gone);
  }

  /** Sign-out / session expiry: stop, abort any transfer, delete every local evidence file and the queue metadata. */
  async wipeAll(): Promise<void> {
    this.stopped = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.inflight?.abort();
    this.urls.clear();
    this.items = [];
    this.notify();
    await this.deps.files.wipe();
    await this.serial(() => this.deps.persistence.clear());
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────────────────────

  private async dropItems(gone: readonly UploadItem[]): Promise<void> {
    const ids = new Set(gone.map((i) => i.id));
    this.items = this.items.filter((i) => !ids.has(i.id));
    for (const item of gone) {
      this.urls.delete(item.id);
      if (!item.fileDeleted) await this.deps.files.delete(item.fileName);
    }
    await this.persist();
    this.notify();
  }

  private apply(id: string, event: UploadEvent): void {
    const now = this.deps.clock.now();
    this.items = this.items.map((i) => (i.id === id ? reduceUpload(i, event, now, () => this.deps.clock.random()) : i));
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writes.then(task, task);
    this.writes = run.catch(() => undefined);
    return run;
  }

  private persist(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const snapshot = this.items;
    return this.serial(() => this.deps.persistence.save(snapshot));
  }

  private hasUrl(id: string): boolean {
    const signed = this.urls.get(id);
    return signed !== undefined && signed.expiresAt - URL_SAFETY_MS > this.deps.clock.serverNow();
  }

  /** Starts (or re-runs) the work loop; concurrent calls coalesce. */
  pump(): void {
    if (this.stopped) return;
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    void this.loop().finally(() => {
      this.pumping = false;
      if (this.pumpAgain && !this.stopped) {
        this.pumpAgain = false;
        this.pump();
      }
    });
  }

  private async loop(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const now = this.deps.clock.now();
      let next: { readonly item: UploadItem; readonly action: UploadAction } | null = null;
      let wakeAt: number | null = null;
      for (const item of this.items) {
        const action = nextUploadAction(item, now, this.hasUrl(item.id));
        if (action.type === 'wait') wakeAt = wakeAt === null ? action.until : Math.min(wakeAt, action.until);
        else if (action.type !== 'idle') {
          next = { item, action };
          break;
        }
      }
      if (next === null) {
        this.schedule(wakeAt);
        return;
      }
      await this.execute(next.item, next.action);
      await this.persist();
      this.notify();
    }
  }

  private schedule(wakeAt: number | null): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (wakeAt === null || this.stopped) return;
    this.cancelTimer = this.deps.clock.setTimer(
      () => {
        this.cancelTimer = null;
        this.pump();
      },
      Math.max(0, wakeAt - this.deps.clock.now()),
    );
  }

  private async execute(item: UploadItem, action: UploadAction): Promise<void> {
    const { api, files } = this.deps;
    switch (action.type) {
      case 'delete-file':
        // A failed delete is not retried in a loop: the item is marked and the next start's orphan sweep removes the file.
        await files.delete(item.fileName).catch(() => undefined);
        this.apply(item.id, { type: 'file-deleted' });
        return;
      case 'prune':
        this.items = this.items.filter((i) => i.id !== item.id);
        this.urls.delete(item.id);
        return;
      case 'discard-stale':
        // Best effort: an unused slot also expires on the server by itself.
        await api.discard(action.uploadId).catch(() => undefined);
        this.apply(item.id, { type: 'stale-discarded' });
        return;
      case 'request-slot':
        try {
          const slot = await api.requestSlot(item.id, item.applicationId, {
            documentId: item.documentId,
            kind: item.kind,
            captureSource: item.source,
            byteSize: item.byteSize,
            mime: item.mime,
            ...(item.challengeId === null ? {} : { challengeId: item.challengeId }),
          });
          this.urls.set(item.id, { url: slot.upload.url, headers: slot.upload.headers, expiresAt: Date.parse(slot.upload.expiresAt) });
          this.apply(item.id, { type: 'slot-issued', uploadId: slot.uploadId });
        } catch (error) {
          this.apply(item.id, failureEvent(error));
        }
        return;
      case 'put': {
        const signed = this.urls.get(item.id);
        if (!signed) return;
        this.apply(item.id, { type: 'put-started' });
        await this.persist();
        this.notify();
        const controller = new AbortController();
        this.inflight = controller;
        let outcome: PutOutcome;
        try {
          outcome = await files.put(item.fileName, signed.url, signed.headers, controller.signal);
        } finally {
          this.inflight = null;
        }
        if (this.stopped) return;
        if (outcome === 'ok') this.apply(item.id, { type: 'put-succeeded' });
        else if (outcome === 'refused') {
          this.urls.delete(item.id);
          this.apply(item.id, { type: 'put-refused' });
        } else if (outcome === 'missing') this.apply(item.id, { type: 'definitive-error', reason: 'file-missing' });
        else this.apply(item.id, { type: 'transient-error', reason: 'offline' });
        return;
      }
      case 'complete':
        try {
          const status = await api.complete(action.uploadId);
          this.apply(item.id, { type: 'server-status', status: status.status, rejection: status.rejectionReason });
        } catch (error) {
          this.apply(item.id, notReceived(error) ? { type: 'not-received' } : failureEvent(error));
        }
        return;
      case 'poll':
        try {
          const list = await api.evidence(item.applicationId);
          const found = list.items.find((e) => e.uploadId === action.uploadId);
          this.apply(
            item.id,
            found ? { type: 'server-status', status: found.status, rejection: found.rejectionReason } : { type: 'definitive-error', reason: 'unknown' },
          );
        } catch (error) {
          this.apply(item.id, failureEvent(error));
        }
        return;
      case 'wait':
      case 'idle':
        return;
    }
  }
}

/** Completion refused because the bytes never arrived or the slot expired: a new slot is needed (not a failure). */
function notReceived(error: unknown): boolean {
  return (
    error instanceof ApiError && error.kind === 'conflict' && error.detail.reasonCodes.some((c) => c === 'UPLOAD_NOT_RECEIVED' || c === 'UPLOAD_SLOT_EXPIRED')
  );
}

/**
 * @internal exported for unit tests: API failure → queue event (bounded retry for unknown outcomes only). P3.5: planned
 * maintenance waits and retries like any other outage (bounded); a required update (the app-policy gate blocks the app)
 * or a quote-only refusal is definitive.
 */
export function failureEvent(error: unknown): UploadEvent {
  if (!(error instanceof ApiError)) return { type: 'definitive-error', reason: 'unknown' };
  switch (error.kind) {
    case 'offline':
      return { type: 'transient-error', reason: 'offline' };
    case 'unavailable':
    case 'maintenance':
      return { type: 'transient-error', reason: 'unavailable' };
    case 'rate-limited':
      return { type: 'transient-error', reason: 'rate-limited', retryAfterMs: (error.detail.retryAfterSeconds ?? 0) * 1000 };
    case 'conflict':
      return { type: 'definitive-error', reason: 'conflict' };
    case 'session-expired':
    case 'validation':
    case 'step-up-required':
    case 'required-action':
    case 'restricted':
    case 'feature-disabled':
    case 'update-required':
    case 'service-area':
    case 'unknown':
      return { type: 'definitive-error', reason: 'unknown' };
  }
}
