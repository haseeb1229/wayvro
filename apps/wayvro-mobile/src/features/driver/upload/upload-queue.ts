import { CAPTURE_SOURCE_VALUES, EVIDENCE_KIND_VALUES, EVIDENCE_MAX_BYTES } from '@wayvro/contracts';
import { z } from 'zod';

/**
 * Evidence upload queue — PURE state machine (P2.8; K02/K03 capture, Q01 cleanup). One item is one photo for one
 * evidence kind of one claimed document:
 *
 *   queued → slot → uploading → completing → processing → accepted | rejected
 *                                                       ↘ failed (definitive, or bounded retries exhausted)
 *
 * The server is the source of truth for the outcome (ACCEPTED/REJECTED come only from its answers); this module only
 * decides the next step, bounded retry/backoff and when the local file may be deleted. The presigned upload URL is
 * NEVER part of an item (it lives in memory only), so after an app restart an item that had a slot first asks the
 * server whether the bytes arrived (completion) and otherwise starts over with a new slot. Items hold metadata only —
 * never image bytes.
 */

export type EvidenceKind = (typeof EVIDENCE_KIND_VALUES)[number];
export type CaptureSource = (typeof CAPTURE_SOURCE_VALUES)[number];
const EVIDENCE_MIMES = ['image/jpeg', 'image/png'] as const;
export type EvidenceMime = (typeof EVIDENCE_MIMES)[number];

const UPLOAD_STATES = ['queued', 'slot', 'uploading', 'completing', 'processing', 'accepted', 'rejected', 'failed'] as const;
type UploadState = (typeof UPLOAD_STATES)[number];
const REJECTION_REASONS = ['TOO_LARGE', 'UNSUPPORTED_FORMAT', 'UNREADABLE', 'SECURITY_CHECK_FAILED'] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
const FAILURE_REASONS = ['offline', 'rate-limited', 'slot-expired', 'conflict', 'file-missing', 'unavailable', 'unknown'] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/** Server-side evidence status (EvidenceUploadStatus.status). */
type ServerEvidenceStatus = 'AWAITING_UPLOAD' | 'PROCESSING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'DISCARDED';

export const UploadItemSchema = z.object({
  id: z.string().min(8).max(64),
  applicationId: z.uuid(),
  documentId: z.uuid(),
  kind: z.enum(EVIDENCE_KIND_VALUES),
  source: z.enum(CAPTURE_SOURCE_VALUES),
  challengeId: z.uuid().nullable(),
  /** File name inside the app's private evidence cache directory (not a full path). */
  fileName: z.string().regex(/^[A-Za-z0-9_-]{8,64}\.(jpg|png)$/),
  byteSize: z.number().int().min(1).max(EVIDENCE_MAX_BYTES),
  mime: z.enum(EVIDENCE_MIMES),
  state: z.enum(UPLOAD_STATES),
  uploadId: z.uuid().nullable(),
  /** A slot that was issued but whose upload never arrived: discarded (best effort) before a new slot is requested. */
  staleUploadId: z.uuid().nullable(),
  /** Consecutive failed attempts at the current step. */
  attempts: z.number().int().min(0),
  /** Device-clock time (ms) before which the next attempt must not start (backoff only; never a server deadline). */
  retryAt: z.number().nullable(),
  polls: z.number().int().min(0),
  rejection: z.enum(REJECTION_REASONS).nullable(),
  failure: z.enum(FAILURE_REASONS).nullable(),
  fileDeleted: z.boolean(),
});
export type UploadItem = z.infer<typeof UploadItemSchema>;

/** Bounds (CLAUDE.md §13: no retry storms). @internal exported for unit tests */
export const MAX_ATTEMPTS = 5;
/** @internal exported for unit tests */
export const MAX_POLLS = 12;
/** @internal exported for unit tests */
export const MAX_QUEUE_ITEMS = 10;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;
const POLL_BASE_MS = 2_000;
const POLL_MAX_MS = 30_000;

/** Exponential backoff with full jitter (attempt is 1-based). @internal exported for unit tests */
export function retryDelayMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.max(500, Math.floor(random() * ceiling));
}

/** Processing poll interval (poll is 1-based): 2 s, 4 s, 8 s … capped at 30 s. @internal exported for unit tests */
export function pollDelayMs(poll: number): number {
  return Math.min(POLL_MAX_MS, POLL_BASE_MS * 2 ** Math.max(0, poll - 1));
}

// ── creating items ───────────────────────────────────────────────────────────────────────────────────────────────

export interface NewUpload {
  readonly id: string;
  readonly applicationId: string;
  readonly documentId: string;
  readonly kind: EvidenceKind;
  readonly source: CaptureSource;
  readonly challengeId: string | null;
  readonly fileName: string;
  readonly byteSize: number;
  readonly mime: EvidenceMime;
}

export type EnqueueRefusal = 'empty' | 'too-large' | 'selfie-camera-only' | 'challenge-selfie-only' | 'queue-full' | 'invalid';

/**
 * Validates a new upload against the contract rules before anything is sent: JPEG/PNG only, 1 byte … 10 MB, the selfie
 * only from the in-app camera, a capture challenge only with a selfie, and a bounded queue.
 */
export function createUploadItem(
  input: NewUpload,
  queue: readonly UploadItem[],
): { readonly ok: true; readonly item: UploadItem } | { readonly ok: false; readonly reason: EnqueueRefusal } {
  if (input.byteSize <= 0) return { ok: false, reason: 'empty' };
  if (input.byteSize > EVIDENCE_MAX_BYTES) return { ok: false, reason: 'too-large' };
  if (input.kind === 'SELFIE_FOR_MANUAL_REVIEW' && input.source !== 'IN_APP_CAMERA') return { ok: false, reason: 'selfie-camera-only' };
  if (input.kind !== 'SELFIE_FOR_MANUAL_REVIEW' && input.challengeId !== null) return { ok: false, reason: 'challenge-selfie-only' };
  if (queue.filter((i) => !isTerminal(i.state)).length >= MAX_QUEUE_ITEMS) return { ok: false, reason: 'queue-full' };
  const parsed = UploadItemSchema.safeParse({
    ...input,
    state: 'queued',
    uploadId: null,
    staleUploadId: null,
    attempts: 0,
    retryAt: null,
    polls: 0,
    rejection: null,
    failure: null,
    fileDeleted: false,
  });
  return parsed.success ? { ok: true, item: parsed.data } : { ok: false, reason: 'invalid' };
}

const isTerminal = (state: UploadState): state is 'accepted' | 'rejected' => state === 'accepted' || state === 'rejected';

/** The server already holds the bytes: the local copy is no longer needed (Q01). */
const serverHasBytes = (state: UploadState): boolean => state === 'processing' || state === 'accepted' || state === 'rejected';

// ── events ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type UploadEvent =
  | { readonly type: 'slot-issued'; readonly uploadId: string }
  | { readonly type: 'stale-discarded' }
  | { readonly type: 'put-started' }
  | { readonly type: 'put-succeeded' }
  /** The storage service refused the PUT (expired or invalid URL): a new slot is needed. */
  | { readonly type: 'put-refused' }
  | { readonly type: 'server-status'; readonly status: ServerEvidenceStatus; readonly rejection: RejectionReason | null }
  /** Completion answered that the bytes never arrived (or the slot expired): start over with a new slot. */
  | { readonly type: 'not-received' }
  | { readonly type: 'transient-error'; readonly reason: FailureReason; readonly retryAfterMs?: number }
  | { readonly type: 'definitive-error'; readonly reason: FailureReason }
  /** After an app restart: an item that had a slot cannot PUT again (the URL was never stored), so it checks first. */
  | { readonly type: 'resume' }
  | { readonly type: 'retry' }
  | { readonly type: 'poll-again' }
  | { readonly type: 'file-deleted' };

const fail = (item: UploadItem, reason: FailureReason): UploadItem => ({ ...item, state: 'failed', failure: reason, retryAt: null });
const step = (item: UploadItem, state: UploadState): UploadItem => ({ ...item, state, attempts: 0, retryAt: null, failure: null });

/** Applies one event; impossible transitions leave the item unchanged (they are never "repaired"). */
export function reduceUpload(item: UploadItem, event: UploadEvent, now: number, random: () => number): UploadItem {
  switch (event.type) {
    case 'slot-issued':
      return item.state === 'queued' ? { ...step(item, 'slot'), uploadId: event.uploadId } : item;
    case 'stale-discarded':
      return { ...item, staleUploadId: null };
    case 'put-started':
      return item.state === 'slot' ? { ...item, state: 'uploading' } : item;
    case 'put-succeeded':
      return item.state === 'uploading' ? step(item, 'completing') : item;
    case 'put-refused':
    case 'not-received': {
      if (item.state !== 'uploading' && item.state !== 'completing' && item.state !== 'slot') return item;
      const attempts = item.attempts + 1;
      const restarted: UploadItem = { ...item, state: 'queued', uploadId: null, staleUploadId: item.uploadId, attempts };
      return attempts >= MAX_ATTEMPTS ? fail(restarted, 'slot-expired') : { ...restarted, retryAt: now + retryDelayMs(attempts, random) };
    }
    case 'server-status':
      return applyServerStatus(item, event, now, random);
    case 'transient-error': {
      if (isTerminal(item.state) || item.state === 'failed') return item;
      const attempts = item.attempts + 1;
      // An interrupted PUT is retried from the slot (the same URL while it is valid, otherwise a new slot).
      const state: UploadState = item.state === 'uploading' ? 'slot' : item.state;
      if (attempts >= MAX_ATTEMPTS) return fail({ ...item, state, attempts }, event.reason);
      const delay = Math.max(event.retryAfterMs ?? 0, retryDelayMs(attempts, random));
      return { ...item, state, attempts, failure: event.reason, retryAt: now + delay };
    }
    case 'definitive-error':
      return isTerminal(item.state) ? item : fail(item, event.reason);
    case 'resume':
      return item.state === 'slot' || item.state === 'uploading' ? { ...item, state: 'completing', retryAt: null } : item;
    case 'retry':
      return item.state === 'failed' && !item.fileDeleted ? { ...step(item, item.uploadId === null ? 'queued' : 'completing'), polls: 0 } : item;
    case 'poll-again':
      return item.state === 'processing' ? { ...item, polls: 0, retryAt: null } : item;
    case 'file-deleted':
      return { ...item, fileDeleted: true };
  }
}

/** Server answer (completion or evidence list) for an item that is completing or processing. */
function applyServerStatus(item: UploadItem, event: Extract<UploadEvent, { type: 'server-status' }>, now: number, random: () => number): UploadItem {
  if (item.state !== 'completing' && item.state !== 'processing') return item;
  switch (event.status) {
    case 'ACCEPTED':
      return step(item, 'accepted');
    case 'REJECTED':
      return { ...step(item, 'rejected'), rejection: event.rejection ?? 'UNREADABLE' };
    case 'PROCESSING': {
      const polls = item.state === 'processing' ? item.polls + 1 : 1;
      return { ...item, state: 'processing', attempts: 0, failure: null, polls, retryAt: now + pollDelayMs(polls) };
    }
    case 'AWAITING_UPLOAD':
      return reduceUpload(item, { type: 'not-received' }, now, random);
    case 'EXPIRED':
    case 'DISCARDED':
      return fail(item, 'slot-expired');
  }
}

// ── next step ────────────────────────────────────────────────────────────────────────────────────────────────────

export type UploadAction =
  | { readonly type: 'discard-stale'; readonly uploadId: string }
  | { readonly type: 'request-slot' }
  | { readonly type: 'put' }
  | { readonly type: 'complete'; readonly uploadId: string }
  | { readonly type: 'poll'; readonly uploadId: string }
  | { readonly type: 'delete-file' }
  /** Terminal and cleaned up: the item can leave the local queue (the server's evidence list shows the outcome). */
  | { readonly type: 'prune' }
  | { readonly type: 'wait'; readonly until: number }
  /** Needs the user (failed), or is in flight, or processing polls are exhausted until "check again". */
  | { readonly type: 'idle' };

export function nextUploadAction(item: UploadItem, now: number, hasUploadUrl: boolean): UploadAction {
  const { state } = item;
  // Cleanup first: once the server confirmed the bytes, the local copy is deleted before anything else (Q01).
  if (serverHasBytes(state) && !item.fileDeleted) return { type: 'delete-file' };
  if (isTerminal(state)) return { type: 'prune' };
  if (state === 'failed' || state === 'uploading') return { type: 'idle' };
  if (item.retryAt !== null && item.retryAt > now) return { type: 'wait', until: item.retryAt };
  switch (state) {
    case 'queued':
      return item.staleUploadId === null ? { type: 'request-slot' } : { type: 'discard-stale', uploadId: item.staleUploadId };
    case 'slot':
      // Without the in-memory URL (restart) the item must first check with the server; `resume` moved it already.
      return hasUploadUrl ? { type: 'put' } : item.uploadId === null ? { type: 'idle' } : { type: 'complete', uploadId: item.uploadId };
    case 'completing':
      return item.uploadId === null ? { type: 'idle' } : { type: 'complete', uploadId: item.uploadId };
    case 'processing':
      return item.uploadId === null || item.polls >= MAX_POLLS ? { type: 'idle' } : { type: 'poll', uploadId: item.uploadId };
  }
}
