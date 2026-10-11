import { EVIDENCE_MAX_BYTES } from '@wayvro/contracts';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { base64Url, type RandomBytes } from '../../../core/platform/ids';
import { sniffImageMime } from '../capture/capture-rules';
import type { EvidenceMime } from './upload-queue';
import type { PutOutcome, UploadFilePort } from './upload-runner';

/**
 * Local evidence files (Q01). Every capture or import is moved into ONE private cache directory of the app
 * (`<cache>/wayvro-evidence`, excluded from backups: `allowBackup` is false and it is a cache directory), under a random
 * name, so cleanup is exact: a file is deleted once the server confirms the upload, on discard, when the application
 * is abandoned, and the whole directory on sign-out/session expiry. Nothing is written to shared storage or the
 * gallery, and no storage permission is used.
 */
const DIRECTORY_NAME = 'wayvro-evidence';
const PUT_TIMEOUT_MS = 120_000;

const evidenceDirectory = (): Directory => new Directory(Paths.cache, DIRECTORY_NAME);

function ensureDirectory(): Directory {
  const dir = evidenceDirectory();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function readHead(file: File): Uint8Array {
  const handle = file.open();
  try {
    return handle.readBytes(12);
  } finally {
    handle.close();
  }
}

function deleteQuietly(file: File): void {
  // Deleting a file that is already gone is not an error for cleanup purposes.
  if (file.exists) file.delete();
}

export type AdoptRefusal = 'unsupported' | 'too-large' | 'empty' | 'unreadable';
export type Adopted =
  | { readonly ok: true; readonly fileName: string; readonly byteSize: number; readonly mime: EvidenceMime }
  | { readonly ok: false; readonly reason: AdoptRefusal };

/**
 * Takes ownership of a fresh capture/import (a file in the app cache written by the camera or the system picker):
 * checks its real type from its first bytes and its size, then moves it into the evidence directory. A refused file is
 * deleted immediately.
 */
export async function adoptCapture(sourceUri: string, random: RandomBytes): Promise<Adopted> {
  const source = new File(sourceUri);
  try {
    if (!source.exists) return { ok: false, reason: 'unreadable' };
    const byteSize = source.size;
    const mime = sniffImageMime(readHead(source));
    const refusal: AdoptRefusal | null = byteSize <= 0 ? 'empty' : byteSize > EVIDENCE_MAX_BYTES ? 'too-large' : mime === null ? 'unsupported' : null;
    if (refusal !== null || mime === null) {
      deleteQuietly(source);
      return { ok: false, reason: refusal ?? 'unsupported' };
    }
    const fileName = `${base64Url(random(18))}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    await source.move(new File(ensureDirectory(), fileName));
    return { ok: true, fileName, byteSize, mime };
  } catch {
    // The capture could not be read or moved: never keep a half-handled copy around.
    if (source.exists) source.delete();
    return { ok: false, reason: 'unreadable' };
  }
}

/** Local URI of an adopted file, for the on-device preview before it is queued. */
export function evidenceFileUri(fileName: string): string {
  return new File(evidenceDirectory(), fileName).uri;
}

/** Deletes one adopted file (e.g. the user retakes the photo before it is queued). */
export function deleteEvidenceFile(fileName: string): void {
  deleteQuietly(new File(evidenceDirectory(), fileName));
}

export const evidenceFilePort: UploadFilePort = {
  /** PUT of the exact bytes with exactly the signed headers; no Authorization or idempotency header (storage, not API). */
  put: async (fileName, url, headers, signal): Promise<PutOutcome> => {
    const file = new File(evidenceDirectory(), fileName);
    if (!file.exists) return 'missing';
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    signal.addEventListener('abort', abort);
    const timer = setTimeout(abort, PUT_TIMEOUT_MS);
    try {
      const result = await file.upload(url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers: { ...headers }, signal: controller.signal });
      if (result.status >= 200 && result.status < 300) return 'ok';
      // 4xx: expired/invalid signature or a size/type mismatch — a new slot is needed. 5xx: retry later.
      return result.status >= 400 && result.status < 500 ? 'refused' : 'failed';
    } catch {
      // Network failure, timeout or abort: the outcome is unknown; completion asks the server before any new slot.
      return 'failed';
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  },
  delete: (fileName) => {
    deleteQuietly(new File(evidenceDirectory(), fileName));
    return Promise.resolve();
  },
  list: () => {
    const dir = evidenceDirectory();
    return Promise.resolve(dir.exists ? dir.list().flatMap((entry) => (entry instanceof File ? [entry.name] : [])) : []);
  },
  wipe: () => {
    const dir = evidenceDirectory();
    if (dir.exists) dir.delete();
    return Promise.resolve();
  },
};
