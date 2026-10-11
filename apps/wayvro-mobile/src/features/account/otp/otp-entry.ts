import type { OtpChallenge } from '@wayvro/contracts';
import { toApiError } from '../../../core/api/errors';
import { errorView, type UiErrorView } from '../../../core/ui/view-state';
import { toAsciiDigits } from '../phone/phone-entry';

/**
 * OTP entry (A02/A03 UI). Countdowns use the server's timestamps corrected by the server-clock offset observed on API
 * responses; they are UX hints only — the server enforces expiry, resend cooldown, attempts and lockout.
 */
const OTP_LENGTH = 6;

export function sanitizeCode(input: string): string {
  return toAsciiDigits(input).replace(/\D/g, '').slice(0, OTP_LENGTH);
}

/** Whole seconds until `iso` on the server clock (never negative). @internal exported for unit tests */
export function secondsUntil(iso: string, deviceNowMs: number, serverOffsetMs: number): number {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - (deviceNowMs + serverOffsetMs)) / 1000));
}

export interface OtpModelInput {
  readonly code: string;
  readonly challenge: Pick<OtpChallenge, 'expiresAt' | 'resendAvailableAt'>;
  readonly deviceNowMs: number;
  readonly serverOffsetMs: number;
  readonly submitting: boolean;
  readonly resending: boolean;
  readonly locked: boolean;
  readonly attempted: boolean;
}

export interface OtpModel {
  readonly canSubmit: boolean;
  /** The typed code is complete and may be sent. */
  readonly complete: boolean;
  readonly codeErrorKey: 'otp.invalidFormat' | null;
  readonly resendInSeconds: number;
  readonly canResend: boolean;
  /** The current code can no longer be used (expired or locked): entry is disabled until a new code is requested. */
  readonly blocked: 'expired' | 'locked' | null;
}

export function otpModel(input: OtpModelInput): OtpModel {
  const complete = input.code.length === OTP_LENGTH;
  const expired = secondsUntil(input.challenge.expiresAt, input.deviceNowMs, input.serverOffsetMs) === 0;
  const blocked = input.locked ? 'locked' : expired ? 'expired' : null;
  const resendInSeconds = secondsUntil(input.challenge.resendAvailableAt, input.deviceNowMs, input.serverOffsetMs);
  const busy = input.submitting || input.resending;
  return {
    // An incomplete code is explained on submit (codeErrorKey) rather than silently disabling the button.
    canSubmit: input.code.length > 0 && blocked === null && !busy,
    complete,
    codeErrorKey: input.attempted && !complete ? 'otp.invalidFormat' : null,
    resendInSeconds,
    canResend: resendInSeconds === 0 && !busy,
    blocked,
  };
}

export interface OtpErrorOutcome {
  readonly view: UiErrorView;
  /** The challenge is locked: further codes are refused until a new code is requested. */
  readonly lock: boolean;
  /** The challenge cannot be continued: send the user back to phone entry. */
  readonly restart: boolean;
  /** Clear the typed code (it was wrong or expired). */
  readonly clearCode: boolean;
}

export function otpVerifyError(error: unknown): OtpErrorOutcome {
  const apiError = toApiError(error);
  if (apiError.code === 'WAYVRO_E_OTP_LOCKED')
    return { view: { kind: 'validation', messageKey: 'otp.locked', action: 'none' }, lock: true, restart: false, clearCode: true };
  if (apiError.code === 'WAYVRO_E_OTP_INVALID_OR_EXPIRED') {
    return { view: { kind: 'validation', messageKey: 'otp.invalidOrExpired', action: 'none' }, lock: false, restart: false, clearCode: true };
  }
  return { view: errorView(apiError), lock: false, restart: false, clearCode: false };
}

export function otpResendError(error: unknown): OtpErrorOutcome {
  const apiError = toApiError(error);
  // The challenge is unknown/expired/consumed on the server: a new sign-in attempt is needed.
  if (apiError.detail.status === 401 || apiError.code === 'WAYVRO_E_OTP_INVALID_OR_EXPIRED' || apiError.code === 'WAYVRO_E_NOT_FOUND') {
    return { view: { kind: 'validation', messageKey: 'otp.restart', action: 'none' }, lock: false, restart: true, clearCode: true };
  }
  if (apiError.code === 'WAYVRO_E_DEPENDENCY_UNAVAILABLE') {
    return { view: { kind: 'unavailable', messageKey: 'phone.otpUnavailable', action: 'retry' }, lock: false, restart: false, clearCode: false };
  }
  return { view: errorView(apiError), lock: false, restart: false, clearCode: false };
}
