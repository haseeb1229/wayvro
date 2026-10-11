import type { ServerClock } from '../../../core/api/http';
import type { KeyValueStore } from '../../../core/session/key-value-store';
import type { DriverApi } from '../api/driver-api';
import { evidenceFilePort } from './evidence-files';
import { secureQueuePersistence } from './queue-store';
import { UploadRunner } from './upload-runner';

/**
 * One upload runner per signed-in session, created the first time a Driver/Partner screen needs it (never at app
 * start). Sign-out/expiry wipes it through `wipeEvidence`, which the composition root loads lazily on wipe.
 */
let runner: UploadRunner | null = null;

export function runnerFor(api: DriverApi, store: KeyValueStore, clock: ServerClock): UploadRunner {
  runner ??= new UploadRunner({
    api: {
      requestSlot: (localId, applicationId, request) => api.requestEvidenceSlot(localId, applicationId, request),
      complete: (uploadId) => api.completeEvidenceUpload(uploadId),
      evidence: (applicationId) => api.evidence(applicationId),
      discard: (uploadId) => api.discardEvidenceUpload(uploadId),
    },
    files: evidenceFilePort,
    persistence: secureQueuePersistence(store),
    clock: {
      now: () => Date.now(),
      serverNow: () => Date.now() + clock.offsetMs,
      random: Math.random,
      setTimer: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => {
          clearTimeout(handle);
        };
      },
    },
  });
  return runner;
}

/**
 * Sign-out / session-expiry wipe (Q01): stops the runner, aborts a transfer, deletes every local evidence file and the
 * queue metadata. Works even when the Driver/Partner flow was never opened in this process.
 */
export async function wipeEvidence(store: KeyValueStore): Promise<void> {
  const active = runner;
  runner = null;
  if (active) await active.wipeAll();
  else {
    await evidenceFilePort.wipe();
    await secureQueuePersistence(store).clear();
  }
}
