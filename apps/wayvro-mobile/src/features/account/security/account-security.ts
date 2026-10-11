import type { DELETION_BLOCKERS, DeletionRequest, PhoneChange } from '@wayvro/contracts';
import { toApiError } from '../../../core/api/errors';
import type { StringKey } from '../../../core/i18n/strings';
import { errorView, type UiErrorView } from '../../../core/ui/view-state';
import { checkPhone } from '../phone/phone-entry';
import type { RecoveryProof, RecoveryReview } from './account-security-api';

/**
 * P2.9 account-security flow logic (pure; screens render these models). The server decides every outcome: these
 * functions only choose what to show next and never reveal more than the server said. Refusals that could hint that
 * another account or number exists are always shown with the same generic copy.
 */

// ── step-up guarded actions ──────────────────────────────────────────────────────────────────────────────────────

/** @internal exported for unit tests */
export function isStepUpRequired(error: unknown): boolean {
  return toApiError(error).code === 'WAYVRO_E_STEP_UP_REQUIRED';
}

/**
 * A sensitive action (phone change, deletion, sign out all other devices) that the server may refuse with "step-up
 * required". The user then confirms with a code on the current phone, and the action is retried ONCE — only after the
 * user confirms again, with a new idempotency key (the refused intent was settled). A second refusal is final.
 */
export type GuardedPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly retry: boolean }
  | { readonly kind: 'step-up' }
  | { readonly kind: 'confirm-retry' }
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly error: unknown; readonly afterStepUp: boolean };

export type GuardedEvent =
  | { readonly type: 'start' }
  | { readonly type: 'succeeded' }
  | { readonly type: 'failed'; readonly error: unknown }
  | { readonly type: 'stepped-up' }
  | { readonly type: 'confirm' }
  | { readonly type: 'cancel' };

export function reduceGuarded(phase: GuardedPhase, event: GuardedEvent): GuardedPhase {
  switch (event.type) {
    case 'start':
      return phase.kind === 'running' ? phase : { kind: 'running', retry: false };
    case 'succeeded':
      return phase.kind === 'running' ? { kind: 'done' } : phase;
    case 'failed':
      if (phase.kind !== 'running') return phase;
      if (isStepUpRequired(event.error) && !phase.retry) return { kind: 'step-up' };
      return { kind: 'failed', error: event.error, afterStepUp: phase.retry };
    case 'stepped-up':
      return phase.kind === 'step-up' ? { kind: 'confirm-retry' } : phase;
    case 'confirm':
      return phase.kind === 'confirm-retry' ? { kind: 'running', retry: true } : phase;
    case 'cancel':
      return phase.kind === 'running' ? phase : { kind: 'idle' };
  }
}

/** Copy for a refused step-up code request (the code delivery service may be down). */
export function stepUpSendError(error: unknown): UiErrorView {
  const apiError = toApiError(error);
  if (apiError.code === 'WAYVRO_E_DEPENDENCY_UNAVAILABLE') return { kind: 'unavailable', messageKey: 'phone.otpUnavailable', action: 'retry' };
  return errorView(apiError);
}

/** Copy for a failed guarded action: a second step-up refusal is explained, anything else uses the shared views. */
export function guardedErrorView(phase: Extract<GuardedPhase, { kind: 'failed' }>): UiErrorView {
  if (isStepUpRequired(phase.error)) return { kind: 'step-up-required', messageKey: 'stepUp.failedAgain', action: 'none' };
  return errorView(phase.error);
}

// ── phone change ─────────────────────────────────────────────────────────────────────────────────────────────────

/** On-device format check only (Pakistani mobile, +92); the server normalises and decides. */
export function buildPhoneChange(raw: string): { readonly ok: true; readonly newPhone: string } | { readonly ok: false; readonly errorKey: 'phone.invalid' } {
  const check = checkPhone(raw);
  return check.ok ? { ok: true, newPhone: check.phone } : { ok: false, errorKey: 'phone.invalid' };
}

export type PhoneChangeRefusal =
  | { readonly kind: 'step-up' }
  /** New-device cooldown: `availableAt` is the server time from which a change is allowed (null if not given). */
  | { readonly kind: 'cooldown'; readonly availableAt: string | null }
  | { readonly kind: 'message'; readonly view: UiErrorView };

/**
 * Maps a refused phone-change request or verification. Every 409 other than the new-device cooldown is GENERIC: the
 * copy never suggests that the number is in use or belongs to someone.
 */
export function phoneChangeRefusal(error: unknown, deviceNowMs: number, serverOffsetMs: number): PhoneChangeRefusal {
  const apiError = toApiError(error);
  if (apiError.code === 'WAYVRO_E_STEP_UP_REQUIRED') return { kind: 'step-up' };
  if (apiError.kind === 'conflict' && apiError.detail.reasonCodes.includes('NEW_DEVICE_COOLDOWN')) {
    const seconds = apiError.detail.retryAfterSeconds;
    return { kind: 'cooldown', availableAt: seconds === null ? null : new Date(deviceNowMs + serverOffsetMs + seconds * 1000).toISOString() };
  }
  if (apiError.kind === 'conflict') return { kind: 'message', view: { kind: 'conflict', messageKey: 'phoneChange.generic', action: 'none' } };
  if (apiError.code === 'WAYVRO_E_VALIDATION') return { kind: 'message', view: { kind: 'validation', messageKey: 'phone.invalid', action: 'none' } };
  if (apiError.code === 'WAYVRO_E_DEPENDENCY_UNAVAILABLE')
    return { kind: 'message', view: { kind: 'unavailable', messageKey: 'phone.otpUnavailable', action: 'retry' } };
  return { kind: 'message', view: errorView(apiError) };
}

/** Requests that are still open and can be cancelled ("This wasn't me"). */
const OPEN_PHONE_CHANGE: ReadonlySet<PhoneChange['status']> = new Set(['CURRENT_PHONE_VERIFIED', 'MANUAL_REVIEW', 'COOLDOWN']);

export interface PhoneChangeNotice {
  readonly id: string;
  readonly maskedNewPhone: string;
  readonly kindKey: Extract<StringKey, 'phoneNotice.change' | 'phoneNotice.recovery'>;
  /** COOLDOWN: the change takes effect at this time unless cancelled. */
  readonly cooldownUntil: string | null;
  readonly inReview: boolean;
}

export function phoneChangeNotice(change: PhoneChange | null): PhoneChangeNotice | null {
  if (change === null || !OPEN_PHONE_CHANGE.has(change.status)) return null;
  return {
    id: change.id,
    maskedNewPhone: change.maskedNewPhone,
    kindKey: change.kind === 'SELF_SERVICE' ? 'phoneNotice.change' : 'phoneNotice.recovery',
    cooldownUntil: change.status === 'COOLDOWN' ? change.cooldownUntil : null,
    inReview: change.status === 'MANUAL_REVIEW',
  };
}

// ── lost-phone recovery ──────────────────────────────────────────────────────────────────────────────────────────

/** Proofs offered in this version: Driver/Partner documents only (linked sign-in accounts arrive later). */
export const AVAILABLE_PROOFS: ReadonlySet<RecoveryProof> = new Set<RecoveryProof>(['DRIVER_KYC']);

export function buildRecoveryRequest(
  previousPhoneRaw: string,
  proof: RecoveryProof,
):
  | { readonly ok: true; readonly previousPhone: string; readonly proof: RecoveryProof }
  | { readonly ok: false; readonly errorKey: 'phone.invalid' | 'lostPhone.proofUnavailable' } {
  if (!AVAILABLE_PROOFS.has(proof)) return { ok: false, errorKey: 'lostPhone.proofUnavailable' };
  const check = checkPhone(previousPhoneRaw);
  return check.ok ? { ok: true, previousPhone: check.phone, proof } : { ok: false, errorKey: 'phone.invalid' };
}

// ── dormant-number review ────────────────────────────────────────────────────────────────────────────────────────

export type ReviewView =
  | { readonly kind: 'none' }
  | { readonly kind: 'choose'; readonly id: string; readonly canStartNew: boolean; readonly canClaim: boolean }
  | { readonly kind: 'in-review'; readonly id: string; readonly canStartNew: boolean }
  | { readonly kind: 'resolved' }
  | { readonly kind: 'denied'; readonly id: string; readonly canStartNew: boolean };

/** Only the choices the SERVER lists are offered (THIS_IS_MY_ACCOUNT only where strong proof exists). */
export function reviewView(review: RecoveryReview | null): ReviewView {
  if (review === null) return { kind: 'none' };
  const canStartNew = review.choices.includes('I_AM_NEW');
  switch (review.status) {
    case 'PENDING':
      return { kind: 'choose', id: review.id, canStartNew, canClaim: review.choices.includes('THIS_IS_MY_ACCOUNT') };
    case 'IN_REVIEW':
      return { kind: 'in-review', id: review.id, canStartNew };
    case 'RESOLVED_OWNER':
    case 'RESOLVED_NEW_ACCOUNT':
      return { kind: 'resolved' };
    case 'DENIED':
      return { kind: 'denied', id: review.id, canStartNew };
  }
}

// ── deletion ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface RetainedItem {
  readonly category: string;
  readonly basis: string;
}

export type DeletionView =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'open';
      readonly id: string;
      readonly statusKey: `deletion.status.${DeletionRequest['status']}` & StringKey;
      readonly graceUntil: string | null;
      readonly blockerKeys: readonly (`deletion.blocker.${(typeof DELETION_BLOCKERS)[number]}` & StringKey)[];
      readonly retained: readonly RetainedItem[];
      readonly canCancel: boolean;
    };

/** Server codes shown as words ("PAYMENT_RECORDS" → "payment records"). @internal exported for unit tests */
export function humaniseCode(code: string): string {
  return code.replace(/_/g, ' ').toLowerCase();
}

const CANCELLABLE: ReadonlySet<DeletionRequest['status']> = new Set(['GRACE', 'BLOCKED']);

export function deletionView(request: DeletionRequest | null): DeletionView {
  if (request === null || request.status === 'CANCELLED') return { kind: 'none' };
  return {
    kind: 'open',
    id: request.id,
    statusKey: `deletion.status.${request.status}`,
    graceUntil: request.graceUntil,
    blockerKeys: request.blockers.map((b) => `deletion.blocker.${b}` as const),
    retained: request.retained.map((r) => ({ category: humaniseCode(r.dataCategory), basis: humaniseCode(r.basisRef) })),
    canCancel: CANCELLABLE.has(request.status),
  };
}
