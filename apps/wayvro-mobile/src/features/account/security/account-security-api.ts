import {
  AccountRecoveryReceiptSchema,
  CurrentDeletionRequestSchema,
  CurrentPhoneChangeSchema,
  CurrentRecoveryReviewSchema,
  DeletionRequestSchema,
  OtpChallengeSchema,
  PhoneChangeSchema,
  PhoneChangeStartedSchema,
  RecoveryReviewOutcomeSchema,
  StepUpSchema,
  type DeletionRequest,
  type Locale,
  type OtpChallenge,
  type PhoneChange,
} from '@wayvro/contracts';
import type { z } from 'zod';
import type { WayvroClient } from '../../../core/api/wayvro-client';

/**
 * P2.9 account-security endpoints (step-up, phone change, "this wasn't me", lost-phone recovery, dormant-number review,
 * deletion) on the shared authenticated transport. Every response is validated with its contract schema; every
 * mutation has its own intent, so a retry after a refusal (e.g. "step-up required") always uses a NEW idempotency key.
 */
export type StepUp = z.infer<typeof StepUpSchema>;
export type PhoneChangeStarted = z.infer<typeof PhoneChangeStartedSchema>;
export type RecoveryReview = NonNullable<z.infer<typeof CurrentRecoveryReviewSchema>['review']>;
export type RecoveryReviewOutcome = z.infer<typeof RecoveryReviewOutcomeSchema>;
export type RecoveryProof = 'LINKED_OIDC' | 'DRIVER_KYC';

const seg = encodeURIComponent;

export function createAccountSecurityApi(t: WayvroClient['session']) {
  return {
    // ── step-up: a fresh code on the CURRENT phone ───────────────────────────────────────────────────────────
    startStepUp: (): Promise<OtpChallenge> => t.mutate('step-up', { method: 'POST', path: '/v1/account/step-ups', schema: OtpChallengeSchema }),

    verifyStepUp: (challengeId: string, code: string): Promise<StepUp> =>
      t.mutate(`step-up-verify:${challengeId}`, {
        method: 'POST',
        path: `/v1/account/step-ups/${seg(challengeId)}/verifications`,
        body: { code },
        schema: StepUpSchema,
      }),

    // ── phone change ─────────────────────────────────────────────────────────────────────────────────────────
    startPhoneChange: (newPhone: string, locale: Locale): Promise<PhoneChangeStarted> =>
      t.mutate('phone-change', { method: 'POST', path: '/v1/account/phone-changes', body: { newPhone, locale }, schema: PhoneChangeStartedSchema }),

    verifyPhoneChange: (id: string, challengeId: string, code: string): Promise<PhoneChange> =>
      t.mutate(`phone-change-verify:${id}`, {
        method: 'POST',
        path: `/v1/account/phone-changes/${seg(id)}/verifications`,
        body: { challengeId, code },
        schema: PhoneChangeSchema,
      }),

    currentPhoneChange: (): Promise<PhoneChange | null> =>
      t.read({ method: 'GET', path: '/v1/account/phone-changes/current', schema: CurrentPhoneChangeSchema }).then((r) => r.phoneChange),

    cancelPhoneChange: (id: string): Promise<PhoneChange> =>
      t.mutate(`phone-change-cancel:${id}`, { method: 'POST', path: `/v1/account/phone-changes/${seg(id)}/cancellation`, schema: PhoneChangeSchema }),

    // ── lost-phone recovery (always RECEIVED) ────────────────────────────────────────────────────────────────
    requestRecovery: (previousPhone: string, proof: RecoveryProof): Promise<'RECEIVED'> =>
      t
        .mutate('account-recovery', { method: 'POST', path: '/v1/account-recoveries', body: { proof, previousPhone }, schema: AccountRecoveryReceiptSchema })
        .then((r) => r.status),

    // ── dormant-number review (restricted session) ───────────────────────────────────────────────────────────
    currentRecoveryReview: (): Promise<RecoveryReview | null> =>
      t.read({ method: 'GET', path: '/v1/account/recovery-reviews/current', schema: CurrentRecoveryReviewSchema }).then((r) => r.review),

    chooseRecoveryReview: (id: string, choice: 'I_AM_NEW' | 'THIS_IS_MY_ACCOUNT'): Promise<RecoveryReviewOutcome> =>
      t.mutate(`recovery-review-choice:${id}`, {
        method: 'POST',
        path: `/v1/account/recovery-reviews/${seg(id)}/choices`,
        body: { choice },
        schema: RecoveryReviewOutcomeSchema,
      }),

    // ── deletion ─────────────────────────────────────────────────────────────────────────────────────────────
    requestDeletion: (): Promise<DeletionRequest> =>
      t.mutate('deletion-request', { method: 'POST', path: '/v1/account/deletion-requests', schema: DeletionRequestSchema }),

    currentDeletion: (): Promise<DeletionRequest | null> =>
      t.read({ method: 'GET', path: '/v1/account/deletion-requests/current', schema: CurrentDeletionRequestSchema }).then((r) => r.deletionRequest),

    cancelDeletion: (id: string): Promise<DeletionRequest> =>
      t.mutate(`deletion-cancel:${id}`, { method: 'POST', path: `/v1/account/deletion-requests/${seg(id)}/cancellation`, schema: DeletionRequestSchema }),
  };
}

export type AccountSecurityApi = ReturnType<typeof createAccountSecurityApi>;
