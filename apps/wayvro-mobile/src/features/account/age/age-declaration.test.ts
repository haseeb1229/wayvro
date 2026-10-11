import type { AgeEligibilityPolicy } from '@wayvro/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../core/api/errors';
import { ageDeclarationError, ageFormModel, buildAgeDeclaration, parseDob } from './age-declaration';

const policy = (over: Partial<AgeEligibilityPolicy>): AgeEligibilityPolicy => ({
  version: 3,
  status: 'PLACEHOLDER_NOT_FOR_PRODUCTION',
  riderDeclarationMode: 'AFFIRM_MINIMUM_AGE',
  riderMinimumAge: null,
  effectiveAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const TODAY = '2026-10-11';
const noDob = { day: '', month: '', year: '' };

describe('age declaration', () => {
  it('follows the server mode; without a server threshold the statement has no number', () => {
    expect(ageFormModel(policy({}))).toEqual({
      mode: 'AFFIRM_MINIMUM_AGE',
      policyVersion: 3,
      placeholder: true,
      statementKey: 'age.affirmGeneric',
      statementParams: undefined,
    });
    expect(ageFormModel(policy({ riderMinimumAge: 30 }))).toMatchObject({ statementKey: 'age.affirmWithAge', statementParams: { minimumAge: 30 } });
    expect(ageFormModel(policy({ riderDeclarationMode: 'DATE_OF_BIRTH_REQUIRED', status: 'APPROVED' }))).toEqual({
      mode: 'DATE_OF_BIRTH_REQUIRED',
      policyVersion: 3,
      placeholder: false,
    });
    expect(ageFormModel(policy({ riderDeclarationMode: 'NONE' })).mode).toBe('NONE');
  });

  it('AFFIRM mode sends only {policyVersion, affirmed: true} and NEVER a date of birth', () => {
    const form = ageFormModel(policy({}));
    const built = buildAgeDeclaration(form, { affirmed: true, dob: { day: '01', month: '02', year: '1990' } }, TODAY);
    expect(built).toEqual({ ok: true, request: { policyVersion: 3, affirmed: true } });
    expect(buildAgeDeclaration(form, { affirmed: false, dob: noDob }, TODAY)).toEqual({ ok: false, errorKey: 'age.mustAffirm' });
  });

  it('DOB mode sends only {policyVersion, dateOfBirth} for a valid past date', () => {
    const form = ageFormModel(policy({ riderDeclarationMode: 'DATE_OF_BIRTH_REQUIRED' }));
    expect(buildAgeDeclaration(form, { affirmed: true, dob: { day: '5', month: '7', year: '1999' } }, TODAY)).toEqual({
      ok: true,
      request: { policyVersion: 3, dateOfBirth: '1999-07-05' },
    });
    expect(buildAgeDeclaration(form, { affirmed: false, dob: noDob }, TODAY)).toEqual({ ok: false, errorKey: 'age.dobInvalid' });
  });

  it('NONE mode submits nothing', () => {
    expect(buildAgeDeclaration(ageFormModel(policy({ riderDeclarationMode: 'NONE' })), { affirmed: true, dob: noDob }, TODAY)).toEqual({
      ok: false,
      errorKey: 'age.notRequired',
    });
  });

  it('validates real calendar dates between 1900 and today', () => {
    expect(parseDob({ day: '29', month: '02', year: '2000' }, TODAY)).toBe('2000-02-29');
    expect(parseDob({ day: '29', month: '02', year: '2001' }, TODAY)).toBeNull();
    expect(parseDob({ day: '31', month: '04', year: '1990' }, TODAY)).toBeNull();
    expect(parseDob({ day: '12', month: '10', year: '2026' }, TODAY)).toBeNull();
    expect(parseDob({ day: '01', month: '01', year: '1899' }, TODAY)).toBeNull();
    expect(parseDob({ day: '۰۵', month: '۰۷', year: '۱۹۹۹' }, TODAY)).toBe('1999-07-05');
    expect(parseDob({ day: 'a', month: '1', year: '1990' }, TODAY)).toBeNull();
  });

  it('maps errors: a changed policy refetches; a refused DOB is explained', () => {
    expect(ageDeclarationError(new ApiError('conflict', { code: 'WAYVRO_E_CONFLICT' }), 'AFFIRM_MINIMUM_AGE')).toMatchObject({
      refetch: true,
      view: { messageKey: 'age.changed' },
    });
    expect(ageDeclarationError(new ApiError('validation', { code: 'WAYVRO_E_VALIDATION' }), 'DATE_OF_BIRTH_REQUIRED')).toMatchObject({
      refetch: false,
      view: { messageKey: 'age.dobInvalid' },
    });
    expect(ageDeclarationError(new ApiError('validation', { code: 'WAYVRO_E_VALIDATION' }), 'AFFIRM_MINIMUM_AGE')).toMatchObject({ refetch: true });
    expect(ageDeclarationError(new ApiError('offline'), 'AFFIRM_MINIMUM_AGE')).toMatchObject({ refetch: false, view: { messageKey: 'error.offline' } });
  });
});
