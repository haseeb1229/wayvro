import {
  CaptureChallengeDeclineSchema,
  CaptureChallengeSchema,
  DocumentClaimedSchema,
  DocumentRenewalSchema,
  DriverApplicationSchema,
  DriverComplianceSchema,
  EvidenceListSchema,
  EvidenceUploadSlotSchema,
  EvidenceUploadStatusSchema,
  RequirementChecklistSchema,
  VehicleCreatedSchema,
  type DriverApplication,
  type DriverCompliance,
  type EvidenceUploadStatus,
} from '@wayvro/contracts';
import type { z } from 'zod';
import type { ApiSpec } from '../../../core/api/wayvro-client';

/**
 * Driver/Partner onboarding, evidence, compliance and appeal endpoints (P2.8) on the shared authenticated transport.
 * Every response is validated with its contract schema; every mutation runs under a named intent whose idempotency key
 * is persisted until the outcome is known (core/api/idempotency-intents). The app never sends a role, mode or status:
 * the server derives what the account may do.
 */

export interface SessionTransport {
  read<T>(spec: ApiSpec<T>): Promise<T>;
  mutate<T>(intent: string, spec: ApiSpec<T>): Promise<T>;
}

export type RequirementChecklist = z.infer<typeof RequirementChecklistSchema>;
export type EvidenceList = z.infer<typeof EvidenceListSchema>;
export type EvidenceUploadSlot = z.infer<typeof EvidenceUploadSlotSchema>;
export type CaptureChallenge = z.infer<typeof CaptureChallengeSchema>;
export type CaptureChallengeDecline = z.infer<typeof CaptureChallengeDeclineSchema>;
export type DocumentRenewal = z.infer<typeof DocumentRenewalSchema>;
export type VehicleCreated = z.infer<typeof VehicleCreatedSchema>;

/** Request bodies (contract request schemas; the client builds them in the form adapters). */
export interface ClaimsUpdate {
  readonly expectedVersion: number;
  readonly legalName?: string;
  readonly cnic?: string;
  readonly dateOfBirth?: string;
}
export interface VehicleCreate {
  readonly plate: string;
  readonly make: string;
  readonly model: string;
  readonly modelYear: number;
  readonly colour: string;
  readonly serviceCategory: 'CAR';
  readonly ownershipType: DriverApplication['vehicles'][number]['ownershipType'];
  readonly registrationNumber?: string;
}
export interface VehicleUpdate {
  readonly expectedVersion: number;
  readonly make?: string;
  readonly model?: string;
  readonly modelYear?: number;
  readonly colour?: string;
  readonly ownershipType?: VehicleCreate['ownershipType'];
}
export interface DocumentClaim {
  readonly documentType: string;
  readonly vehicleId?: string;
  /** Only for a per-district document type (required there; the server refuses it for any other type). */
  readonly districtCode?: string;
  readonly number?: string;
  readonly licenceClass?: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
}
export interface RenewalClaim {
  readonly number?: string;
  readonly licenceClass?: string;
  readonly issuedOn?: string;
  readonly expiresOn: string;
}
export interface EvidenceSlotRequest {
  readonly documentId: string;
  readonly kind: EvidenceUploadStatus['kind'];
  readonly captureSource: EvidenceUploadStatus['captureSource'];
  readonly byteSize: number;
  readonly mime: 'image/jpeg' | 'image/png';
  readonly challengeId?: string;
}

const seg = encodeURIComponent;
const APP = (id: string) => `/v1/driver-onboarding/applications/${seg(id)}`;

/** Lahore cars only in V1 (the only enabled city/category; BIKE and RICKSHAW are not offered). */
const LAUNCH_CITY = 'LHR';
const LAUNCH_CATEGORY = 'CAR';

export function createDriverApi(t: SessionTransport) {
  return {
    // ── application ───────────────────────────────────────────────────────────────────────────────────────────
    currentApplication: (): Promise<DriverApplication> =>
      t.read({ method: 'GET', path: '/v1/driver-onboarding/applications/current', schema: DriverApplicationSchema }),

    createApplication: (): Promise<DriverApplication> =>
      t.mutate('driver-application-create', {
        method: 'POST',
        path: '/v1/driver-onboarding/applications',
        body: { cityCode: LAUNCH_CITY, serviceCategories: [LAUNCH_CATEGORY] },
        schema: DriverApplicationSchema,
      }),

    updateClaims: (applicationId: string, update: ClaimsUpdate): Promise<DriverApplication> =>
      t.mutate(`driver-claims:${applicationId}`, { method: 'POST', path: `${APP(applicationId)}/claims`, body: update, schema: DriverApplicationSchema }),

    confirmConsent: (applicationId: string): Promise<DriverApplication> =>
      t.mutate(`driver-consent:${applicationId}`, { method: 'POST', path: `${APP(applicationId)}/consent`, body: {}, schema: DriverApplicationSchema }),

    requirements: (applicationId: string): Promise<RequirementChecklist> =>
      t.read({ method: 'GET', path: `${APP(applicationId)}/requirements`, schema: RequirementChecklistSchema }),

    addVehicle: (applicationId: string, vehicle: VehicleCreate): Promise<VehicleCreated> =>
      t.mutate(`driver-vehicle-add:${applicationId}`, { method: 'POST', path: `${APP(applicationId)}/vehicles`, body: vehicle, schema: VehicleCreatedSchema }),

    updateVehicle: (applicationId: string, vehicleId: string, update: VehicleUpdate): Promise<DriverApplication> =>
      t.mutate(`driver-vehicle-update:${vehicleId}`, {
        method: 'POST',
        path: `${APP(applicationId)}/vehicles/${seg(vehicleId)}`,
        body: update,
        schema: DriverApplicationSchema,
      }),

    claimDocument: (applicationId: string, claim: DocumentClaim): Promise<string> =>
      t
        .mutate(`driver-document:${applicationId}:${claim.documentType}`, {
          method: 'POST',
          path: `${APP(applicationId)}/documents`,
          body: claim,
          schema: DocumentClaimedSchema,
        })
        .then((r) => r.documentId),

    withdraw: (applicationId: string): Promise<DriverApplication> =>
      t.mutate(`driver-withdraw:${applicationId}`, { method: 'POST', path: `${APP(applicationId)}/withdrawal`, body: {}, schema: DriverApplicationSchema }),

    submit: (applicationId: string, expectedVersion: number): Promise<DriverApplication> =>
      t.mutate(`driver-submit:${applicationId}`, {
        method: 'POST',
        path: `${APP(applicationId)}/submission`,
        body: { expectedVersion },
        schema: DriverApplicationSchema,
      }),

    // ── evidence ──────────────────────────────────────────────────────────────────────────────────────────────
    /** `localId` is the queue item: a lost answer replays the same slot instead of issuing a second one. */
    requestEvidenceSlot: (localId: string, applicationId: string, request: EvidenceSlotRequest): Promise<EvidenceUploadSlot> =>
      t.mutate(`evidence-slot:${localId}`, { method: 'POST', path: `${APP(applicationId)}/evidence-uploads`, body: request, schema: EvidenceUploadSlotSchema }),

    completeEvidenceUpload: (uploadId: string): Promise<EvidenceUploadStatus> =>
      t.mutate(`evidence-complete:${uploadId}`, {
        method: 'POST',
        path: `/v1/driver-onboarding/evidence-uploads/${seg(uploadId)}/completion`,
        schema: EvidenceUploadStatusSchema,
      }),

    discardEvidenceUpload: (uploadId: string): Promise<void> =>
      t.mutate(`evidence-discard:${uploadId}`, { method: 'DELETE', path: `/v1/driver-onboarding/evidence-uploads/${seg(uploadId)}`, schema: null }),

    evidence: (applicationId: string): Promise<EvidenceList> => t.read({ method: 'GET', path: `${APP(applicationId)}/evidence`, schema: EvidenceListSchema }),

    createCaptureChallenge: (applicationId: string): Promise<CaptureChallenge> =>
      t.mutate(`capture-challenge:${applicationId}`, { method: 'POST', path: `${APP(applicationId)}/capture-challenges`, schema: CaptureChallengeSchema }),

    declineCaptureChallenge: (applicationId: string, challengeId: string, choice: 'REPLACE' | 'NONE_ACCESSIBLE'): Promise<CaptureChallengeDecline> =>
      t.mutate(`capture-challenge-decline:${challengeId}`, {
        method: 'POST',
        path: `${APP(applicationId)}/capture-challenges/${seg(challengeId)}/declines`,
        body: { choice },
        schema: CaptureChallengeDeclineSchema,
      }),

    // ── verified driver ───────────────────────────────────────────────────────────────────────────────────────
    compliance: (): Promise<DriverCompliance> => t.read({ method: 'GET', path: '/v1/driver/compliance', schema: DriverComplianceSchema }),

    startRenewal: (documentId: string, claim: RenewalClaim): Promise<DocumentRenewal> =>
      t.mutate(`renewal-start:${documentId}`, {
        method: 'POST',
        path: `/v1/driver/documents/${seg(documentId)}/renewals`,
        body: claim,
        schema: DocumentRenewalSchema,
      }),

    /** `renewalDocumentId` is the renewal's own document (DocumentRenewal.renewalDocumentId). */
    submitRenewal: (renewalDocumentId: string): Promise<DocumentRenewal> =>
      t.mutate(`renewal-submit:${renewalDocumentId}`, {
        method: 'POST',
        path: `/v1/driver/documents/${seg(renewalDocumentId)}/renewal-submission`,
        body: {},
        schema: DocumentRenewalSchema,
      }),
  };
}

export type DriverApi = ReturnType<typeof createDriverApi>;
