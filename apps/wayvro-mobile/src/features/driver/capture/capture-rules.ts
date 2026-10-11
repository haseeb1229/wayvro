import type { CaptureSource, EvidenceKind, EvidenceMime } from '../upload/upload-queue';
import type { DriverStringKey } from '../i18n/driver-strings';

/**
 * Capture-source rules (K02/K03; KYC doc §2). The SELFIE is taken with the in-app FRONT camera only — there is never an
 * import option for it. Document photos may come from the in-app camera (back camera) or from a controlled import
 * through the system photo picker (images only, one at a time). These are client integrity aids mirrored from the
 * server, which enforces the same rules; nothing here proves anything about a person or a document.
 */
export interface CaptureOptions {
  readonly camera: 'front' | 'back';
  readonly allowImport: boolean;
  /** Framing guide drawn over the preview (a static outline; no face or document detection). */
  readonly guide: 'card' | 'page' | 'face';
}

export function captureOptionsFor(kind: EvidenceKind): CaptureOptions {
  switch (kind) {
    case 'SELFIE_FOR_MANUAL_REVIEW':
      return { camera: 'front', allowImport: false, guide: 'face' };
    case 'CNIC_FRONT':
    case 'CNIC_BACK':
    case 'LICENCE_FRONT':
    case 'LICENCE_BACK':
      return { camera: 'back', allowImport: true, guide: 'card' };
    case 'DOCUMENT_PAGE':
      return { camera: 'back', allowImport: true, guide: 'page' };
  }
}

export function sourceAllowed(kind: EvidenceKind, source: CaptureSource): boolean {
  if (source === 'IN_APP_CAMERA') return true;
  return captureOptionsFor(kind).allowImport && source === 'GALLERY_IMPORT';
}

/** Camera JPEG quality: keeps a full-resolution document photo well under the 10 MB limit on typical phones. */
export const CAMERA_JPEG_QUALITY = 0.7;
/** Picker re-encode quality (< 1 makes the system picker re-encode to JPEG/PNG instead of copying the original). */
export const IMPORT_JPEG_QUALITY = 0.8;

// ── camera permission (just in time; adapters only) ──────────────────────────────────────────────────────────────

export type CameraAccess = 'checking' | 'undetermined' | 'granted' | 'denied' | 'blocked';

/** The subset of Expo's PermissionResponse the adapter needs. */
export interface PermissionSnapshot {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
}

export function cameraAccessFrom(response: PermissionSnapshot | null, asked: boolean): CameraAccess {
  if (response === null) return 'checking';
  if (response.granted) return 'granted';
  if (!response.canAskAgain) return 'blocked';
  return asked ? 'denied' : 'undetermined';
}

export interface DeniedOptions {
  /** Ask again in-app (Android allows it until the user chooses "don't ask again"). */
  readonly askAgain: boolean;
  /** The OS no longer shows the prompt: the user can only enable the camera in system settings. */
  readonly openSettings: boolean;
  /** Documents: choose an existing photo through the system picker instead (no permission needed). */
  readonly importInstead: boolean;
  /** Selfie: explain the in-person alternative (never a dead end). */
  readonly inPersonInstead: boolean;
}

export function deniedOptions(kind: EvidenceKind, access: CameraAccess): DeniedOptions | null {
  if (access !== 'denied' && access !== 'blocked') return null;
  const { allowImport } = captureOptionsFor(kind);
  return { askAgain: access === 'denied', openSettings: access === 'blocked', importInstead: allowImport, inPersonInstead: !allowImport };
}

// ── file type ────────────────────────────────────────────────────────────────────────────────────────────────────

/** JPEG and PNG only (contract), decided from the file's first bytes — never from a file name or a picker's claim. */
export function sniffImageMime(head: Uint8Array): EvidenceMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= png.length && png.every((b, i) => head[i] === b)) return 'image/png';
  return null;
}

// ── refusal copy ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Why a photo was not added (on-device checks or queue rules) → user-safe copy. */
export function photoRefusalKey(
  reason:
    'unsupported' | 'too-large' | 'empty' | 'unreadable' | 'selfie-camera-only' | 'challenge-selfie-only' | 'queue-full' | 'invalid' | 'source-not-allowed',
): DriverStringKey {
  switch (reason) {
    case 'unsupported':
    case 'too-large':
    case 'empty':
    case 'unreadable':
    case 'queue-full':
    case 'selfie-camera-only':
      return `evidence.local.${reason}`;
    case 'source-not-allowed':
      return 'evidence.local.selfie-camera-only';
    case 'challenge-selfie-only':
    case 'invalid':
      return 'evidence.local.rejected';
  }
}
