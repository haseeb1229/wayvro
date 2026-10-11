import { toApiError } from '../../../core/api/errors';
import { toAsciiDigits } from '../../../core/input/digits';
import { errorView, type UiErrorView } from '../../../core/ui/view-state';

/**
 * Phone entry (A02 UI). The client check is a UX pre-check only, mirroring the server's Pakistani-mobile syntax rules
 * (+92 / 0092 / 92 / 0 prefixes, NSN 3XXXXXXXXX); the server normalises and is authoritative. Arabic-Indic and
 * Extended Arabic-Indic (Urdu keyboard) digits are converted to ASCII before sending.
 */
const MAX_INPUT_LENGTH = 40;

/** Removes the separators people type (spaces, dashes, dots, brackets). @internal exported for unit tests */
export function cleanPhoneInput(raw: string): string {
  return toAsciiDigits(raw).replace(/[\s\-().]/g, '');
}

export type PhoneCheck = { readonly ok: true; readonly phone: string } | { readonly ok: false; readonly reason: 'empty' | 'format' };

export function checkPhone(raw: string): PhoneCheck {
  if (raw.length > MAX_INPUT_LENGTH) return { ok: false, reason: 'format' };
  const s = cleanPhoneInput(raw);
  if (s === '') return { ok: false, reason: 'empty' };
  if (!/^\+?\d+$/.test(s)) return { ok: false, reason: 'format' };
  let nsn = s;
  if (nsn.startsWith('+')) {
    if (!nsn.startsWith('+92')) return { ok: false, reason: 'format' };
    nsn = nsn.slice(3);
  } else if (nsn.startsWith('00')) {
    if (!nsn.startsWith('0092')) return { ok: false, reason: 'format' };
    nsn = nsn.slice(4);
  } else if (nsn.startsWith('92') && nsn.length === 12) {
    nsn = nsn.slice(2);
  }
  if (nsn.startsWith('0')) nsn = nsn.slice(1);
  return /^3\d{9}$/.test(nsn) ? { ok: true, phone: s } : { ok: false, reason: 'format' };
}

export interface PhoneFormModel {
  /** Disabled while empty or sending; an invalid number is explained on submit instead of silently disabling. */
  readonly canSubmit: boolean;
  /** Shown after a submit attempt, or as soon as a long-enough value cannot be a Pakistani mobile number. */
  readonly inputErrorKey: 'phone.invalid' | null;
}

export function phoneFormModel(raw: string, submitting: boolean, attempted: boolean): PhoneFormModel {
  const check = checkPhone(raw);
  const showError = !check.ok && (attempted || (check.reason === 'format' && cleanPhoneInput(raw).length >= 11));
  return { canSubmit: !submitting && cleanPhoneInput(raw) !== '', inputErrorKey: showError ? 'phone.invalid' : null };
}

/** Error copy for a failed code request: syntax refusals and OTP-delivery outages get specific, honest wording. */
export function phoneRequestError(error: unknown): UiErrorView {
  const apiError = toApiError(error);
  if (apiError.code === 'WAYVRO_E_VALIDATION') return { kind: 'validation', messageKey: 'phone.invalid', action: 'none' };
  if (apiError.code === 'WAYVRO_E_DEPENDENCY_UNAVAILABLE') return { kind: 'unavailable', messageKey: 'phone.otpUnavailable', action: 'retry' };
  return errorView(apiError);
}
