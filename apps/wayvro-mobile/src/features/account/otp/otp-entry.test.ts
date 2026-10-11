import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../core/api/errors';
import { otpModel, otpResendError, otpVerifyError, sanitizeCode, secondsUntil, type OtpModelInput } from './otp-entry';

const NOW = Date.parse('2026-10-11T10:00:00.000Z');
const base: OtpModelInput = {
  code: '123456',
  challenge: { expiresAt: '2026-10-11T10:05:00.000Z', resendAvailableAt: '2026-10-11T10:00:45.000Z' },
  deviceNowMs: NOW,
  serverOffsetMs: 0,
  submitting: false,
  resending: false,
  locked: false,
  attempted: false,
};

describe('otp entry', () => {
  it('keeps only up to 6 ASCII digits (Urdu-keyboard digits converted)', () => {
    expect(sanitizeCode('12 34-56 78')).toBe('123456');
    expect(sanitizeCode('۱۲۳')).toBe('123');
  });

  it('counts down on the server clock (device offset applied), never below zero', () => {
    expect(secondsUntil('2026-10-11T10:00:45.000Z', NOW, 0)).toBe(45);
    expect(secondsUntil('2026-10-11T10:00:45.000Z', NOW, 30_000)).toBe(15);
    expect(secondsUntil('2026-10-11T09:00:00.000Z', NOW, 0)).toBe(0);
    expect(secondsUntil('garbage', NOW, 0)).toBe(0);
  });

  it('enables resend only after resendAvailableAt', () => {
    expect(otpModel(base)).toMatchObject({ resendInSeconds: 45, canResend: false, canSubmit: true, complete: true, blocked: null });
    expect(otpModel({ ...base, deviceNowMs: NOW + 46_000 })).toMatchObject({ resendInSeconds: 0, canResend: true });
    expect(otpModel({ ...base, deviceNowMs: NOW + 46_000, resending: true }).canResend).toBe(false);
  });

  it('explains an incomplete code on submit and blocks entry when expired or locked', () => {
    expect(otpModel({ ...base, code: '123', attempted: true })).toMatchObject({ codeErrorKey: 'otp.invalidFormat', complete: false });
    expect(otpModel({ ...base, code: '' }).canSubmit).toBe(false);
    expect(otpModel({ ...base, deviceNowMs: NOW + 301_000 })).toMatchObject({ blocked: 'expired', canSubmit: false });
    expect(otpModel({ ...base, locked: true })).toMatchObject({ blocked: 'locked', canSubmit: false });
    expect(otpModel({ ...base, submitting: true }).canSubmit).toBe(false);
  });

  it('maps verify errors: invalid/expired clears the code, locked blocks until a new code', () => {
    expect(otpVerifyError(new ApiError('validation', { code: 'WAYVRO_E_OTP_INVALID_OR_EXPIRED', status: 401 }))).toMatchObject({
      view: { messageKey: 'otp.invalidOrExpired' },
      clearCode: true,
      lock: false,
    });
    expect(otpVerifyError(new ApiError('validation', { code: 'WAYVRO_E_OTP_LOCKED' }))).toMatchObject({ view: { messageKey: 'otp.locked' }, lock: true });
    expect(otpVerifyError(new ApiError('rate-limited', { retryAfterSeconds: 9 })).view).toMatchObject({ messageKey: 'error.rateLimited' });
    expect(otpVerifyError(new ApiError('offline')).clearCode).toBe(false);
  });

  it('restarts the flow when the server no longer knows the challenge on resend', () => {
    expect(otpResendError(new ApiError('session-expired', { status: 401 }))).toMatchObject({ restart: true, view: { messageKey: 'otp.restart' } });
    expect(otpResendError(new ApiError('unavailable', { code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE' }))).toMatchObject({
      restart: false,
      view: { messageKey: 'phone.otpUnavailable' },
    });
    expect(otpResendError(new ApiError('rate-limited', { retryAfterSeconds: 20 })).restart).toBe(false);
  });
});
