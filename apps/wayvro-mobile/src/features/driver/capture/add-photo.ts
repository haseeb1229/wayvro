import { launchImageLibraryAsync } from 'expo-image-picker';
import { base64Url } from '../../../core/platform/ids';
import { randomBytes } from '../../../core/platform/crypto';
import { adoptCapture, deleteEvidenceFile, type AdoptRefusal, type Adopted } from '../upload/evidence-files';
import type { CaptureSource, EnqueueRefusal, EvidenceKind } from '../upload/upload-queue';
import type { UploadRunner } from '../upload/upload-runner';
import { IMPORT_JPEG_QUALITY, sourceAllowed } from './capture-rules';

/**
 * Hands a fresh capture/import to the upload queue: the file is checked (real type, size) and moved into the private
 * evidence directory, then queued. Anything refused is deleted from the phone at once (Q01).
 */
export interface PhotoTarget {
  readonly applicationId: string;
  readonly documentId: string;
  readonly kind: EvidenceKind;
}

export type AddPhotoResult = { readonly ok: true } | { readonly ok: false; readonly reason: AdoptRefusal | EnqueueRefusal | 'source-not-allowed' };

export async function queueAdopted(
  runner: UploadRunner,
  target: PhotoTarget,
  adopted: Extract<Adopted, { ok: true }>,
  source: CaptureSource,
  challengeId: string | null,
): Promise<AddPhotoResult> {
  if (!sourceAllowed(target.kind, source)) {
    deleteEvidenceFile(adopted.fileName);
    return { ok: false, reason: 'source-not-allowed' };
  }
  const queued = await runner.enqueue({
    id: base64Url(randomBytes(16)),
    ...target,
    source,
    challengeId,
    fileName: adopted.fileName,
    byteSize: adopted.byteSize,
    mime: adopted.mime,
  });
  if (!queued.ok) deleteEvidenceFile(adopted.fileName);
  return queued;
}

/**
 * Controlled import of ONE existing document photo through the system photo picker (Android Photo Picker: no storage or
 * media permission). Images only, no editing, re-encoded by the picker (`quality` < 1) so the result is JPEG or PNG.
 * Never offered for the selfie.
 */
export async function importDocumentPhoto(runner: UploadRunner, target: PhotoTarget): Promise<AddPhotoResult | null> {
  if (!sourceAllowed(target.kind, 'GALLERY_IMPORT')) return { ok: false, reason: 'source-not-allowed' };
  // The queue is restored (and its orphan sweep done) before a new file enters the evidence directory.
  await runner.start();
  const picked = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    allowsEditing: false,
    quality: IMPORT_JPEG_QUALITY,
    exif: false,
    base64: false,
    legacy: false,
  });
  if (picked.canceled) return null;
  const uri = picked.assets[0]?.uri;
  if (uri === undefined) return null;
  const adopted = await adoptCapture(uri, randomBytes);
  if (!adopted.ok) return adopted;
  return queueAdopted(runner, target, adopted, 'GALLERY_IMPORT', null);
}
