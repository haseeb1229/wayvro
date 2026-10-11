import { EVIDENCE_MAX_BYTES } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { DRIVER_IDS } from '../../../__mocks__/driver-fixtures';
import {
  MAX_ATTEMPTS,
  MAX_POLLS,
  MAX_QUEUE_ITEMS,
  createUploadItem,
  nextUploadAction,
  pollDelayMs,
  reduceUpload,
  retryDelayMs,
  type NewUpload,
  type UploadEvent,
  type UploadItem,
} from './upload-queue';

const NOW = 1_000_000;
const random = () => 0.5;

const input = (overrides: Partial<NewUpload> = {}): NewUpload => ({
  id: 'local_item_000001',
  applicationId: DRIVER_IDS.application,
  documentId: DRIVER_IDS.cnicDoc,
  kind: 'CNIC_FRONT',
  source: 'IN_APP_CAMERA',
  challengeId: null,
  fileName: 'synthetic_file_01.jpg',
  byteSize: 200_000,
  mime: 'image/jpeg',
  ...overrides,
});

function created(overrides: Partial<NewUpload> = {}): UploadItem {
  const result = createUploadItem(input(overrides), []);
  if (!result.ok) throw new Error(result.reason);
  return result.item;
}

const run = (item: UploadItem, ...events: UploadEvent[]): UploadItem => events.reduce((acc, e) => reduceUpload(acc, e, NOW, random), item);

describe('upload queue — creating items', () => {
  it('accepts JPEG/PNG up to 10 MB and starts queued with no server state', () => {
    expect(created()).toMatchObject({ state: 'queued', uploadId: null, attempts: 0, fileDeleted: false });
    expect(createUploadItem(input({ byteSize: EVIDENCE_MAX_BYTES, mime: 'image/png', fileName: 'synthetic_file_02.png' }), []).ok).toBe(true);
  });

  it('refuses empty or over-size files before anything is sent (size limit)', () => {
    expect(createUploadItem(input({ byteSize: 0 }), [])).toEqual({ ok: false, reason: 'empty' });
    expect(createUploadItem(input({ byteSize: EVIDENCE_MAX_BYTES + 1 }), [])).toEqual({ ok: false, reason: 'too-large' });
  });

  it('selfie only from the in-app camera; a capture challenge only with a selfie', () => {
    expect(createUploadItem(input({ kind: 'SELFIE_FOR_MANUAL_REVIEW', source: 'GALLERY_IMPORT' }), [])).toEqual({ ok: false, reason: 'selfie-camera-only' });
    expect(createUploadItem(input({ kind: 'SELFIE_FOR_MANUAL_REVIEW', source: 'FILE_IMPORT' }), [])).toEqual({ ok: false, reason: 'selfie-camera-only' });
    expect(createUploadItem(input({ challengeId: DRIVER_IDS.challenge }), [])).toEqual({ ok: false, reason: 'challenge-selfie-only' });
    expect(createUploadItem(input({ kind: 'SELFIE_FOR_MANUAL_REVIEW', challengeId: DRIVER_IDS.challenge }), []).ok).toBe(true);
    expect(createUploadItem(input({ source: 'GALLERY_IMPORT' }), []).ok).toBe(true);
  });

  it('bounds the queue and rejects malformed metadata (file names are never paths)', () => {
    const full = Array.from({ length: MAX_QUEUE_ITEMS }, () => created());
    expect(createUploadItem(input(), full)).toEqual({ ok: false, reason: 'queue-full' });
    expect(createUploadItem(input({ fileName: '../../secret.jpg' }), [])).toEqual({ ok: false, reason: 'invalid' });
    expect(createUploadItem(input({ applicationId: 'not-a-uuid' }), [])).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('upload queue — happy path and cleanup', () => {
  it('queued → slot → uploading → completing → processing → accepted, deleting the local file once the server has the bytes', () => {
    let item = created();
    expect(nextUploadAction(item, NOW, false)).toEqual({ type: 'request-slot' });
    item = run(item, { type: 'slot-issued', uploadId: DRIVER_IDS.upload1 });
    expect(item).toMatchObject({ state: 'slot', uploadId: DRIVER_IDS.upload1 });
    expect(nextUploadAction(item, NOW, true)).toEqual({ type: 'put' });
    item = run(item, { type: 'put-started' }, { type: 'put-succeeded' });
    expect(nextUploadAction(item, NOW, false)).toEqual({ type: 'complete', uploadId: DRIVER_IDS.upload1 });
    item = run(item, { type: 'server-status', status: 'PROCESSING', rejection: null });
    expect(item.state).toBe('processing');
    // Q01: cleanup comes first once the server confirmed the upload.
    expect(nextUploadAction(item, NOW, false)).toEqual({ type: 'delete-file' });
    item = run(item, { type: 'file-deleted' });
    expect(nextUploadAction(item, NOW, false)).toEqual({ type: 'wait', until: NOW + pollDelayMs(1) });
    expect(nextUploadAction(item, NOW + pollDelayMs(1), false)).toEqual({ type: 'poll', uploadId: DRIVER_IDS.upload1 });
    item = run(item, { type: 'server-status', status: 'ACCEPTED', rejection: null });
    expect(item.state).toBe('accepted');
    expect(nextUploadAction(item, NOW, false)).toEqual({ type: 'prune' });
  });

  it('a rejection keeps the server reason; the file is deleted and the item pruned', () => {
    let item = run(created(), { type: 'slot-issued', uploadId: DRIVER_IDS.upload1 }, { type: 'put-started' }, { type: 'put-succeeded' });
    item = run(item, { type: 'server-status', status: 'REJECTED', rejection: 'UNREADABLE' });
    expect(item).toMatchObject({ state: 'rejected', rejection: 'UNREADABLE' });
    expect(nextUploadAction(item, NOW, false)).toEqual({ type: 'delete-file' });
    expect(nextUploadAction(run(item, { type: 'file-deleted' }), NOW, false)).toEqual({ type: 'prune' });
  });

  it('processing polls back off and stop after the bound until the user checks again', () => {
    let item = run(
      created(),
      { type: 'slot-issued', uploadId: DRIVER_IDS.upload1 },
      { type: 'put-started' },
      { type: 'put-succeeded' },
      { type: 'file-deleted' },
    );
    for (let i = 0; i < MAX_POLLS; i += 1) item = run(item, { type: 'server-status', status: 'PROCESSING', rejection: null });
    expect(item.polls).toBe(MAX_POLLS);
    expect(nextUploadAction(item, Number.MAX_SAFE_INTEGER, false)).toEqual({ type: 'idle' });
    item = run(item, { type: 'poll-again' });
    expect(nextUploadAction(item, NOW, false)).toEqual({ type: 'poll', uploadId: DRIVER_IDS.upload1 });
    expect(pollDelayMs(1)).toBe(2_000);
    expect(pollDelayMs(20)).toBe(30_000);
  });
});

describe('upload queue — retry, resume and failure', () => {
  it('transient errors retry with bounded, growing backoff and then fail', () => {
    let item = created();
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      item = run(item, { type: 'transient-error', reason: 'offline' });
      expect(item).toMatchObject({ state: 'queued', attempts: attempt, failure: 'offline' });
      expect(nextUploadAction(item, NOW, false).type).toBe('wait');
    }
    item = run(item, { type: 'transient-error', reason: 'offline' });
    expect(item).toMatchObject({ state: 'failed', failure: 'offline' });
    expect(nextUploadAction(item, NOW, false)).toEqual({ type: 'idle' });
    expect(retryDelayMs(1, () => 0.999)).toBeLessThanOrEqual(2_000);
    expect(retryDelayMs(30, () => 0.999)).toBeLessThanOrEqual(60_000);
    expect(retryDelayMs(3, () => 0)).toBeGreaterThanOrEqual(500);
  });

  it('honours Retry-After for rate limits', () => {
    const item = run(created(), { type: 'transient-error', reason: 'rate-limited', retryAfterMs: 45_000 });
    expect(item.retryAt).toBe(NOW + 45_000);
  });

  it('an interrupted PUT returns to the slot step; a refused PUT starts over with a new slot and discards the stale one', () => {
    let item = run(created(), { type: 'slot-issued', uploadId: DRIVER_IDS.upload1 }, { type: 'put-started' });
    expect(run(item, { type: 'transient-error', reason: 'offline' }).state).toBe('slot');
    item = run(item, { type: 'put-refused' });
    expect(item).toMatchObject({ state: 'queued', uploadId: null, staleUploadId: DRIVER_IDS.upload1, attempts: 1 });
    expect(nextUploadAction({ ...item, retryAt: null }, NOW, false)).toEqual({ type: 'discard-stale', uploadId: DRIVER_IDS.upload1 });
    item = run(item, { type: 'stale-discarded' });
    expect(nextUploadAction({ ...item, retryAt: null }, NOW, false)).toEqual({ type: 'request-slot' });
  });

  it('after an app restart, an item with a slot asks the server first (the URL was never stored) and restarts if nothing arrived', () => {
    const uploading = run(created(), { type: 'slot-issued', uploadId: DRIVER_IDS.upload1 }, { type: 'put-started' });
    expect(nextUploadAction(uploading, NOW, false)).toEqual({ type: 'idle' });
    const resumed = run(uploading, { type: 'resume' });
    expect(resumed.state).toBe('completing');
    expect(nextUploadAction(resumed, NOW, false)).toEqual({ type: 'complete', uploadId: DRIVER_IDS.upload1 });
    expect(run(resumed, { type: 'not-received' })).toMatchObject({ state: 'queued', staleUploadId: DRIVER_IDS.upload1 });
    expect(run(resumed, { type: 'server-status', status: 'PROCESSING', rejection: null }).state).toBe('processing');
    // A slot without its in-memory URL also checks first.
    const slot = run(created(), { type: 'slot-issued', uploadId: DRIVER_IDS.upload1 });
    expect(nextUploadAction(slot, NOW, false)).toEqual({ type: 'complete', uploadId: DRIVER_IDS.upload1 });
    expect(run(created(), { type: 'resume' }).state).toBe('queued');
  });

  it('expired or discarded server slots fail; definitive errors fail at once; retry needs the local file', () => {
    const completing = run(created(), { type: 'slot-issued', uploadId: DRIVER_IDS.upload1 }, { type: 'put-started' }, { type: 'put-succeeded' });
    expect(run(completing, { type: 'server-status', status: 'EXPIRED', rejection: null })).toMatchObject({ state: 'failed', failure: 'slot-expired' });
    expect(run(completing, { type: 'server-status', status: 'AWAITING_UPLOAD', rejection: null }).state).toBe('queued');
    const failed = run(created(), { type: 'definitive-error', reason: 'conflict' });
    expect(failed).toMatchObject({ state: 'failed', failure: 'conflict' });
    expect(run(failed, { type: 'retry' })).toMatchObject({ state: 'queued', failure: null, attempts: 0 });
    expect(run(failed, { type: 'file-deleted' }, { type: 'retry' }).state).toBe('failed');
    const failedAfterSlot = run(completing, { type: 'definitive-error', reason: 'unknown' });
    expect(run(failedAfterSlot, { type: 'retry' }).state).toBe('completing');
  });

  it('never repairs impossible transitions', () => {
    const queued = created();
    expect(run(queued, { type: 'put-succeeded' })).toEqual(queued);
    expect(run(queued, { type: 'server-status', status: 'ACCEPTED', rejection: null })).toEqual(queued);
    const accepted = run(
      queued,
      { type: 'slot-issued', uploadId: DRIVER_IDS.upload1 },
      { type: 'put-started' },
      { type: 'put-succeeded' },
      { type: 'server-status', status: 'ACCEPTED', rejection: null },
    );
    expect(run(accepted, { type: 'definitive-error', reason: 'unknown' }).state).toBe('accepted');
    expect(run(accepted, { type: 'transient-error', reason: 'offline' }).state).toBe('accepted');
  });
});
