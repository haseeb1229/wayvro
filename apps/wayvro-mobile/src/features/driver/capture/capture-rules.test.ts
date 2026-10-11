import { CAPTURE_SOURCE_VALUES, EVIDENCE_KIND_VALUES } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { DRIVER_CATALOGUE } from '../i18n/driver-strings';
import { cameraAccessFrom, captureOptionsFor, deniedOptions, photoRefusalKey, sniffImageMime, sourceAllowed } from './capture-rules';

describe('capture-source rules', () => {
  it('the selfie is front-camera only and can never be imported', () => {
    expect(captureOptionsFor('SELFIE_FOR_MANUAL_REVIEW')).toEqual({ camera: 'front', allowImport: false, guide: 'face' });
    expect(sourceAllowed('SELFIE_FOR_MANUAL_REVIEW', 'IN_APP_CAMERA')).toBe(true);
    expect(sourceAllowed('SELFIE_FOR_MANUAL_REVIEW', 'GALLERY_IMPORT')).toBe(false);
    expect(sourceAllowed('SELFIE_FOR_MANUAL_REVIEW', 'FILE_IMPORT')).toBe(false);
  });

  it('documents use the back camera or a controlled import through the system photo picker', () => {
    for (const kind of EVIDENCE_KIND_VALUES.filter((k) => k !== 'SELFIE_FOR_MANUAL_REVIEW')) {
      expect(captureOptionsFor(kind)).toMatchObject({ camera: 'back', allowImport: true });
      expect(sourceAllowed(kind, 'IN_APP_CAMERA')).toBe(true);
      expect(sourceAllowed(kind, 'GALLERY_IMPORT')).toBe(true);
      // Only the system photo picker is offered: no file-browser import.
      expect(sourceAllowed(kind, 'FILE_IMPORT')).toBe(false);
    }
    expect(captureOptionsFor('CNIC_FRONT').guide).toBe('card');
    expect(captureOptionsFor('DOCUMENT_PAGE').guide).toBe('page');
    expect(CAPTURE_SOURCE_VALUES).toContain('GALLERY_IMPORT');
  });
});

describe('camera permission adapters (just in time, never a dead end)', () => {
  it('maps the OS permission state', () => {
    expect(cameraAccessFrom(null, false)).toBe('checking');
    expect(cameraAccessFrom({ granted: true, canAskAgain: true }, false)).toBe('granted');
    expect(cameraAccessFrom({ granted: false, canAskAgain: true }, false)).toBe('undetermined');
    expect(cameraAccessFrom({ granted: false, canAskAgain: true }, true)).toBe('denied');
    expect(cameraAccessFrom({ granted: false, canAskAgain: false }, true)).toBe('blocked');
  });

  it('a denied document capture offers asking again or the photo picker; blocked offers settings or the picker', () => {
    expect(deniedOptions('CNIC_FRONT', 'denied')).toEqual({ askAgain: true, openSettings: false, importInstead: true, inPersonInstead: false });
    expect(deniedOptions('DOCUMENT_PAGE', 'blocked')).toEqual({ askAgain: false, openSettings: true, importInstead: true, inPersonInstead: false });
  });

  it('a denied selfie never offers an import, but explains the in-person route', () => {
    expect(deniedOptions('SELFIE_FOR_MANUAL_REVIEW', 'denied')).toEqual({ askAgain: true, openSettings: false, importInstead: false, inPersonInstead: true });
    expect(deniedOptions('SELFIE_FOR_MANUAL_REVIEW', 'blocked')).toEqual({ askAgain: false, openSettings: true, importInstead: false, inPersonInstead: true });
  });

  it('no alternatives are needed while the camera is available or being checked', () => {
    for (const access of ['checking', 'undetermined', 'granted'] as const) expect(deniedOptions('CNIC_FRONT', access)).toBeNull();
  });
});

describe('file type and refusal copy', () => {
  it('accepts only JPEG and PNG by their first bytes', () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull(); // GIF
    expect(sniffImageMime(new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBeNull(); // HEIC
    expect(sniffImageMime(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // PDF
    expect(sniffImageMime(new Uint8Array([]))).toBeNull();
  });

  it('every refusal has copy', () => {
    const reasons = [
      'unsupported',
      'too-large',
      'empty',
      'unreadable',
      'selfie-camera-only',
      'challenge-selfie-only',
      'queue-full',
      'invalid',
      'source-not-allowed',
    ] as const;
    for (const reason of reasons) expect(DRIVER_CATALOGUE.en[photoRefusalKey(reason)]).toBeTruthy();
  });
});
