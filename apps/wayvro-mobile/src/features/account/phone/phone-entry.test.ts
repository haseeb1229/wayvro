import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../core/api/errors';
import { checkPhone, cleanPhoneInput, phoneFormModel, phoneRequestError } from './phone-entry';

describe('phone entry', () => {
  it('accepts Pakistani mobile numbers in the formats people type', () => {
    for (const input of ['03990000001', '0399 0000001', '+92 399 0000001', '+92-399-0000001', '00923990000001', '923990000001', '+92 (0)399 0000001']) {
      expect(checkPhone(input).ok, input).toBe(true);
    }
  });

  it('converts Urdu-keyboard digits and strips separators before sending', () => {
    expect(cleanPhoneInput('۰۳۹۹ ۰۰۰۰۰۰۱')).toBe('03990000001');
    expect(checkPhone('٠٣٩٩٠٠٠٠٠٠١')).toEqual({ ok: true, phone: '03990000001' });
  });

  it('refuses landlines, foreign numbers, wrong lengths and letters (UX pre-check; the server decides)', () => {
    for (const input of ['0421234567', '+441234567890', '0399000000', '039900000011', '03990000a01', '+92 499 0000001']) {
      expect(checkPhone(input), input).toEqual({ ok: false, reason: 'format' });
    }
    expect(checkPhone('  ')).toEqual({ ok: false, reason: 'empty' });
    expect(checkPhone('0'.repeat(41)).ok).toBe(false);
  });

  it('form model: disabled while empty or sending; explains an invalid number after a submit attempt', () => {
    expect(phoneFormModel('', false, false)).toEqual({ canSubmit: false, inputErrorKey: null });
    expect(phoneFormModel('0399', false, false)).toEqual({ canSubmit: true, inputErrorKey: null });
    expect(phoneFormModel('0399', false, true)).toEqual({ canSubmit: true, inputErrorKey: 'phone.invalid' });
    expect(phoneFormModel('03990000001', true, true)).toEqual({ canSubmit: false, inputErrorKey: null });
    expect(phoneFormModel('04212345678', false, false).inputErrorKey).toBe('phone.invalid');
  });

  it('maps request failures to honest copy', () => {
    expect(phoneRequestError(new ApiError('validation', { code: 'WAYVRO_E_VALIDATION' })).messageKey).toBe('phone.invalid');
    expect(phoneRequestError(new ApiError('unavailable', { code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE', status: 503 })).messageKey).toBe('phone.otpUnavailable');
    expect(phoneRequestError(new ApiError('rate-limited', { retryAfterSeconds: 60 }))).toMatchObject({
      messageKey: 'error.rateLimited',
      params: { seconds: 60 },
    });
    expect(phoneRequestError(new ApiError('offline', { transient: true })).messageKey).toBe('error.offline');
  });
});
