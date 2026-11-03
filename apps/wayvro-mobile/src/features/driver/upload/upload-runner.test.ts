import type { EvidenceUploadStatus } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { DRIVER_IDS, evidence } from '../../../__mocks__/driver-fixtures';
import { MemoryStore } from '../../../__mocks__/memory-store';
import { ApiError } from '../../../core/api/errors';
import { STORAGE_KEYS } from '../../../core/session/key-value-store';
import type { EvidenceSlotRequest, EvidenceUploadSlot } from '../api/driver-api';
import { secureQueuePersistence } from './queue-store';
import type { NewUpload, UploadItem } from './upload-queue';
import { failureEvent, UploadRunner, type PutOutcome, type UploadApiPort, type UploadFilePort } from './upload-runner';

const NOW = 1_000_000;

function harness(options: { put?: () => PutOutcome; complete?: () => Promise<EvidenceUploadStatus>; files?: string[]; discard?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const timers: { fn: () => void; at: number }[] = [];
  const files = new Set(options.files ?? []);
  let now = NOW;
  let slot = 0;
  const api: UploadApiPort = {
    requestSlot: (localId: string, applicationId: string, request: EvidenceSlotRequest): Promise<EvidenceUploadSlot> => {
      slot += 1;
      calls.push(`slot:${localId}:${applicationId}:${request.kind}:${request.captureSource}:${String(request.byteSize)}:${request.challengeId ?? '-'}`);
      return Promise.resolve({
        uploadId: slot === 1 ? DRIVER_IDS.upload1 : DRIVER_IDS.upload2,
        upload: {
          url: 'https://storage.example.test/q/synthetic',
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(request.byteSize) },
          expiresAt: new Date(now + 300_000).toISOString(),
        },
        slotExpiresAt: new Date(now + 300_000).toISOString(),
      });
    },
    complete: (uploadId) => {
      calls.push(`complete:${uploadId}`);
      return options.complete ? options.complete() : Promise.resolve(evidence(uploadId, DRIVER_IDS.cnicDoc, 'CNIC_FRONT', 'PROCESSING'));
    },
    evidence: (applicationId) => {
      calls.push(`list:${applicationId}`);
      return Promise.resolve({ items: [evidence(DRIVER_IDS.upload1, DRIVER_IDS.cnicDoc, 'CNIC_FRONT', 'ACCEPTED')] });
    },
    discard: (uploadId) => {
      calls.push(`discard:${uploadId}`);
      return options.discard ? options.discard() : Promise.resolve();
    },
  };
  const filePort: UploadFilePort = {
    put: (fileName, url, headers) => {
      calls.push(`put:${fileName}:${url}:${headers['Content-Length'] ?? ''}:${'Authorization' in headers ? 'auth' : 'noauth'}`);
      return Promise.resolve(options.put ? options.put() : 'ok');
    },
    delete: (fileName) => {
      calls.push(`delete:${fileName}`);
      files.delete(fileName);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...files]),
    wipe: () => {
      calls.push('wipe-files');
      files.clear();
      return Promise.resolve();
    },
  };
  const store = new MemoryStore();
  const runner = new UploadRunner({
    api,
    files: filePort,
    persistence: secureQueuePersistence(store),
    clock: {
      now: () => now,
      serverNow: () => now,
      random: () => 0,
      setTimer: (fn, ms) => {
        const timer = { fn, at: now + ms };
        timers.push(timer);
        return () => {
          timers.splice(timers.indexOf(timer), 1);
        };
      },
    },
  });
  /** Lets the runner's promise chain settle. */
  const settle = async () => {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  };
  /** Advances the fake clock and fires due timers. */
  const advance = async (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
    await settle();
  };
  return { runner, calls, files, store, settle, advance, timers };
}

const upload = (overrides: Partial<NewUpload> = {}): NewUpload => ({
  id: 'local_item_000001',
  applicationId: DRIVER_IDS.application,
  documentId: DRIVER_IDS.cnicDoc,
  kind: 'CNIC_FRONT',
  source: 'IN_APP_CAMERA',
  challengeId: null,
  fileName: 'synthetic_file_01.jpg',
  byteSize: 1234,
  mime: 'image/jpeg',
  ...overrides,
});

describe('upload runner', () => {
  it('uploads with exactly the signed headers (no Authorization), confirms, deletes the local file, polls and prunes', async () => {
    const h = harness({ files: ['synthetic_file_01.jpg'] });
    expect(await h.runner.enqueue(upload())).toEqual({ ok: true });
    await h.settle();
    expect(h.calls.slice(0, 4)).toEqual([
      `slot:local_item_000001:${DRIVER_IDS.application}:CNIC_FRONT:IN_APP_CAMERA:1234:-`,
      'put:synthetic_file_01.jpg:https://storage.example.test/q/synthetic:1234:noauth',
      `complete:${DRIVER_IDS.upload1}`,
      'delete:synthetic_file_01.jpg',
    ]);
    expect(h.files.size).toBe(0);
    await h.advance(2_000);
    expect(h.calls).toContain(`list:${DRIVER_IDS.application}`);
    expect(h.runner.getSnapshot()).toEqual([]);
    expect(h.store.data.has(STORAGE_KEYS.evidenceQueue)).toBe(false);
  });

  it('persists metadata only (no URL, no bytes) while in flight', async () => {
    const h = harness({ files: ['synthetic_file_01.jpg'], complete: () => Promise.reject(new ApiError('offline', { transient: true })) });
    await h.runner.enqueue(upload());
    await h.settle();
    const stored = h.store.data.get(STORAGE_KEYS.evidenceQueue) ?? '';
    expect(stored).toContain('synthetic_file_01.jpg');
    expect(stored).not.toContain('storage.example.test');
    expect(stored).not.toMatch(/Content-Length/);
  });

  it('retries a failed transfer with backoff and fails after the bound; the user can retry', async () => {
    const h = harness({ files: ['synthetic_file_01.jpg'], put: () => 'failed' });
    await h.runner.enqueue(upload());
    await h.settle();
    for (let i = 0; i < 6; i += 1) await h.advance(60_000);
    const [item] = h.runner.getSnapshot();
    expect(item).toMatchObject({ state: 'failed', failure: 'offline' });
    expect(h.calls.filter((c) => c.startsWith('put:')).length).toBe(5);
    // The slot was issued, so a retry first asks the server whether the bytes arrived (completion).
    await h.runner.retry(item?.id ?? '');
    await h.settle();
    expect(h.calls.at(-1)).toBe('delete:synthetic_file_01.jpg');
    expect(h.calls).toContain(`complete:${DRIVER_IDS.upload1}`);
  });

  it('a refused PUT (expired signature) gets a new slot and discards the stale one', async () => {
    let puts = 0;
    const h = harness({ files: ['synthetic_file_01.jpg'], put: () => (++puts === 1 ? 'refused' : 'ok') });
    await h.runner.enqueue(upload());
    await h.settle();
    await h.advance(60_000);
    expect(h.calls).toContain(`discard:${DRIVER_IDS.upload1}`);
    expect(h.calls).toContain(`complete:${DRIVER_IDS.upload2}`);
  });

  it('resumes after a restart: an item that had a slot checks completion first, and orphan files are swept', async () => {
    const first = harness({ files: ['synthetic_file_01.jpg'], put: () => 'failed' });
    await first.runner.enqueue(upload());
    await first.settle();
    const persisted = first.store.data.get(STORAGE_KEYS.evidenceQueue);
    expect(persisted).toBeDefined();

    const second = harness({ files: ['synthetic_file_01.jpg', 'orphan_file_00001.jpg'] });
    second.store.data.set(STORAGE_KEYS.evidenceQueue, persisted ?? '');
    await second.runner.start();
    await second.settle();
    expect(second.calls[0]).toBe('delete:orphan_file_00001.jpg');
    expect(second.calls).toContain(`complete:${DRIVER_IDS.upload1}`);
    expect(second.calls.some((c) => c.startsWith('slot:'))).toBe(false);
  });

  it('corrupt persisted metadata is dropped and every unreferenced file deleted (fail closed)', async () => {
    const h = harness({ files: ['synthetic_file_01.jpg'] });
    h.store.data.set(STORAGE_KEYS.evidenceQueue, '{"v":1,"items":[{"id":"x"}]}');
    await h.runner.start();
    expect(h.runner.getSnapshot()).toEqual([]);
    expect(h.files.size).toBe(0);
  });

  it('discard removes the server copy first, then the local file; offline keeps the item', async () => {
    const offline = harness({
      files: ['synthetic_file_01.jpg'],
      complete: () => Promise.reject(new ApiError('offline', { transient: true })),
      discard: () => Promise.reject(new ApiError('offline', { transient: true })),
    });
    await offline.runner.enqueue(upload());
    await offline.settle();
    expect(await offline.runner.remove('local_item_000001')).toBe('offline');
    expect(offline.runner.getSnapshot()).toHaveLength(1);
    expect(offline.files.has('synthetic_file_01.jpg')).toBe(true);

    const ok = harness({ files: ['synthetic_file_01.jpg'], complete: () => Promise.reject(new ApiError('offline', { transient: true })) });
    await ok.runner.enqueue(upload());
    await ok.settle();
    expect(await ok.runner.remove('local_item_000001')).toBe('removed');
    expect(ok.calls).toContain(`discard:${DRIVER_IDS.upload1}`);
    expect(ok.files.size).toBe(0);
    expect(ok.runner.getSnapshot()).toEqual([]);
  });

  it('abandoning an application deletes its files and items; sign-out wipe deletes everything and stops', async () => {
    const h = harness({ files: ['synthetic_file_01.jpg', 'synthetic_file_02.jpg'], put: () => 'failed' });
    await h.runner.enqueue(upload());
    await h.runner.enqueue(upload({ id: 'local_item_000002', fileName: 'synthetic_file_02.jpg', applicationId: DRIVER_IDS.profile }));
    await h.settle();
    await h.runner.abandonApplication(DRIVER_IDS.application);
    expect(h.runner.getSnapshot().map((i: UploadItem) => i.id)).toEqual(['local_item_000002']);
    expect(h.files.has('synthetic_file_01.jpg')).toBe(false);
    await h.runner.wipeAll();
    expect(h.calls).toContain('wipe-files');
    expect(h.runner.getSnapshot()).toEqual([]);
    expect(h.store.data.has(STORAGE_KEYS.evidenceQueue)).toBe(false);
    expect(h.timers).toHaveLength(0);
  });

  it('refuses invalid uploads without touching the network', async () => {
    const h = harness();
    expect(await h.runner.enqueue(upload({ kind: 'SELFIE_FOR_MANUAL_REVIEW', source: 'GALLERY_IMPORT' }))).toEqual({ ok: false, reason: 'selfie-camera-only' });
    expect(await h.runner.enqueue(upload({ byteSize: 11 * 1024 * 1024 }))).toEqual({ ok: false, reason: 'too-large' });
    expect(h.calls).toEqual([]);
  });

  it('maps API failures: unknown outcomes retry, definitive refusals fail', () => {
    expect(failureEvent(new ApiError('offline'))).toEqual({ type: 'transient-error', reason: 'offline' });
    expect(failureEvent(new ApiError('unavailable'))).toEqual({ type: 'transient-error', reason: 'unavailable' });
    expect(failureEvent(new ApiError('rate-limited', { retryAfterSeconds: 30 }))).toEqual({
      type: 'transient-error',
      reason: 'rate-limited',
      retryAfterMs: 30_000,
    });
    expect(failureEvent(new ApiError('conflict'))).toEqual({ type: 'definitive-error', reason: 'conflict' });
    expect(failureEvent(new ApiError('validation'))).toEqual({ type: 'definitive-error', reason: 'unknown' });
    expect(failureEvent(new Error('boom'))).toEqual({ type: 'definitive-error', reason: 'unknown' });
    // P3.5 (cross-mode regression): planned maintenance waits like an outage; a required update or a quote-only
    // refusal is definitive (the app-policy gate handles the update).
    expect(failureEvent(new ApiError('maintenance', { status: 503 }))).toEqual({ type: 'transient-error', reason: 'unavailable' });
    expect(failureEvent(new ApiError('update-required', { status: 426 }))).toEqual({ type: 'definitive-error', reason: 'unknown' });
    expect(failureEvent(new ApiError('service-area', { status: 422 }))).toEqual({ type: 'definitive-error', reason: 'unknown' });
  });
});
