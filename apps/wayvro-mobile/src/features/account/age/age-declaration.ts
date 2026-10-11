import type { AgeDeclarationRequest, AgeEligibilityPolicy } from '@wayvro/contracts';
import { toApiError } from '../../../core/api/errors';
import type { StringKey } from '../../../core/i18n/strings';
import { errorView, type UiErrorView } from '../../../core/ui/view-state';
import { toAsciiDigits } from '../phone/phone-entry';

/**
 * Age declaration (A15 UI). The SHAPE of the form follows the server's age-eligibility policy; the app has no age
 * threshold of its own. AFFIRM mode never collects a date of birth; DOB mode collects it only for this request (it is
 * not stored on the device). A threshold is displayed only when the server provides one.
 */

export type AgeForm =
  | { readonly mode: 'NONE'; readonly policyVersion: number; readonly placeholder: boolean }
  | {
      readonly mode: 'AFFIRM_MINIMUM_AGE';
      readonly policyVersion: number;
      readonly placeholder: boolean;
      readonly statementKey: Extract<StringKey, 'age.affirmGeneric' | 'age.affirmWithAge'>;
      readonly statementParams: { readonly minimumAge: number } | undefined;
    }
  | { readonly mode: 'DATE_OF_BIRTH_REQUIRED'; readonly policyVersion: number; readonly placeholder: boolean };

export function ageFormModel(policy: AgeEligibilityPolicy): AgeForm {
  const base = { policyVersion: policy.version, placeholder: policy.status === 'PLACEHOLDER_NOT_FOR_PRODUCTION' };
  switch (policy.riderDeclarationMode) {
    case 'NONE':
      return { mode: 'NONE', ...base };
    case 'DATE_OF_BIRTH_REQUIRED':
      return { mode: 'DATE_OF_BIRTH_REQUIRED', ...base };
    case 'AFFIRM_MINIMUM_AGE':
      return policy.riderMinimumAge === null
        ? { mode: 'AFFIRM_MINIMUM_AGE', ...base, statementKey: 'age.affirmGeneric', statementParams: undefined }
        : { mode: 'AFFIRM_MINIMUM_AGE', ...base, statementKey: 'age.affirmWithAge', statementParams: { minimumAge: policy.riderMinimumAge } };
  }
}

export interface DobInput {
  readonly day: string;
  readonly month: string;
  readonly year: string;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/**
 * A real calendar date between 1900-01-01 and `todayIso` (device date; a UX check only — the server re-validates on
 * its own clock). Returns ISO `YYYY-MM-DD`.
 *
 * @internal exported for unit tests
 */
export function parseDob(input: DobInput, todayIso: string): string | null {
  const [d, m, y] = [input.day, input.month, input.year].map((v) => toAsciiDigits(v).trim());
  if (d === undefined || m === undefined || y === undefined) return null;
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return null;
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const iso = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  if (iso < '1900-01-01' || iso > todayIso) return null;
  return iso;
}

export type AgeSubmission = { readonly ok: true; readonly request: AgeDeclarationRequest } | { readonly ok: false; readonly errorKey: StringKey };

export function buildAgeDeclaration(form: AgeForm, values: { readonly affirmed: boolean; readonly dob: DobInput }, todayIso: string): AgeSubmission {
  switch (form.mode) {
    case 'NONE':
      return { ok: false, errorKey: 'age.notRequired' };
    case 'AFFIRM_MINIMUM_AGE':
      return values.affirmed ? { ok: true, request: { policyVersion: form.policyVersion, affirmed: true } } : { ok: false, errorKey: 'age.mustAffirm' };
    case 'DATE_OF_BIRTH_REQUIRED': {
      const dateOfBirth = parseDob(values.dob, todayIso);
      return dateOfBirth === null ? { ok: false, errorKey: 'age.dobInvalid' } : { ok: true, request: { policyVersion: form.policyVersion, dateOfBirth } };
    }
  }
}

export interface AgeErrorOutcome {
  readonly view: UiErrorView;
  /** The policy changed or a declaration already exists: refetch the policy and the account state. */
  readonly refetch: boolean;
}

export function ageDeclarationError(error: unknown, mode: AgeForm['mode']): AgeErrorOutcome {
  const apiError = toApiError(error);
  const changed: AgeErrorOutcome = { view: { kind: 'conflict', messageKey: 'age.changed', action: 'retry' }, refetch: true };
  if (apiError.code === 'WAYVRO_E_CONFLICT') return changed;
  if (apiError.code === 'WAYVRO_E_VALIDATION') {
    // In DOB mode the server refused the date; otherwise the declaration no longer matches the policy's mode.
    return mode === 'DATE_OF_BIRTH_REQUIRED' ? { view: { kind: 'validation', messageKey: 'age.dobInvalid', action: 'none' }, refetch: false } : changed;
  }
  return { view: errorView(apiError), refetch: false };
}
