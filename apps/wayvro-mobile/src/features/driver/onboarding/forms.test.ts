import { describe, expect, it } from 'vitest';
import { application, DRIVER_IDS } from '../../../__mocks__/driver-fixtures';
import type { DocumentFieldHints } from './field-hints';

const ALL: DocumentFieldHints = { number: true, licenceClass: true, issuedOn: true, expiresOn: true };
const NUMBER_ONLY: DocumentFieldHints = { number: true, licenceClass: false, issuedOn: true, expiresOn: false };
const EXPIRY_ONLY: DocumentFieldHints = { number: false, licenceClass: false, issuedOn: true, expiresOn: true };
const NONE: DocumentFieldHints = { number: false, licenceClass: false, issuedOn: false, expiresOn: false };
import {
  buildClaimsUpdate,
  buildDocumentClaim,
  buildRenewalClaim,
  buildVehicleCreate,
  buildVehicleUpdate,
  claimsComplete,
  emptyDate,
  emptyDocumentForm,
  emptyVehicleForm,
  formatCnicInput,
  isCnicFormat,
  vehicleFormFrom,
} from './forms';

const TODAY = '2026-10-11';
/** Synthetic, structurally valid CNIC-format strings only (not real identity numbers). */
const SYNTHETIC_CNIC = '00000-0000000-0';

describe('CNIC on-device format check', () => {
  it('formats typed digits (any script) as XXXXX-XXXXXXX-X', () => {
    expect(formatCnicInput('0000000000000')).toBe(SYNTHETIC_CNIC);
    expect(formatCnicInput('۰۰۰۰۰۰۰۰۰۰۰۰۰')).toBe(SYNTHETIC_CNIC);
    expect(formatCnicInput('00000 00')).toBe('00000-00');
    expect(formatCnicInput('000000000000099')).toBe(SYNTHETIC_CNIC);
    expect(isCnicFormat(SYNTHETIC_CNIC)).toBe(true);
    expect(isCnicFormat('0000000000000')).toBe(false);
    expect(isCnicFormat('00000-000000-0')).toBe(false);
  });
});

describe('applicant claims', () => {
  const app = application({ version: 7 });

  it('sends only filled fields with the expected version', () => {
    expect(buildClaimsUpdate(app, { legalName: '  Test Applicant ', cnic: '', dateOfBirth: emptyDate }, TODAY)).toEqual({
      ok: true,
      request: { expectedVersion: 7, legalName: 'Test Applicant' },
    });
    expect(buildClaimsUpdate(app, { legalName: '', cnic: '0000000000000', dateOfBirth: { day: '1', month: '2', year: '1990' } }, TODAY)).toEqual({
      ok: true,
      request: { expectedVersion: 7, cnic: SYNTHETIC_CNIC, dateOfBirth: '1990-02-01' },
    });
  });

  it('refuses invalid values with field errors and reports "nothing to save"', () => {
    expect(buildClaimsUpdate(app, { legalName: 'A', cnic: '123', dateOfBirth: { day: '31', month: '02', year: '1990' } }, TODAY)).toEqual({
      ok: false,
      errors: { legalName: 'details.legalNameInvalid', cnic: 'details.cnicInvalid', dateOfBirth: 'details.dobInvalid' },
    });
    expect(buildClaimsUpdate(app, { legalName: 'evil‮name', cnic: '', dateOfBirth: emptyDate }, TODAY)).toMatchObject({ ok: false });
    expect(buildClaimsUpdate(app, { legalName: '', cnic: '', dateOfBirth: { day: '1', month: '1', year: '2027' } }, TODAY)).toMatchObject({ ok: false });
    expect(buildClaimsUpdate(app, { legalName: ' ', cnic: '', dateOfBirth: emptyDate }, TODAY)).toEqual({ ok: false, errors: {}, nothingToSave: true });
  });

  it('knows from the masked server view whether the step is complete', () => {
    expect(claimsComplete(application())).toBe(true);
    expect(claimsComplete(application({ claims: { legalNameProvided: true, cnicLast4: null, dateOfBirthProvided: true } }))).toBe(false);
  });
});

describe('vehicle', () => {
  const form = {
    plate: ' test-001 ',
    make: 'Synthetic',
    model: 'Sedan',
    year: '2020',
    colour: 'White',
    ownershipType: 'FAMILY_OWNED' as const,
    registrationNumber: '',
  };

  it('builds a CAR vehicle request and validates the year range', () => {
    expect(buildVehicleCreate(form, TODAY)).toEqual({
      ok: true,
      request: {
        plate: 'TEST-001',
        make: 'Synthetic',
        model: 'Sedan',
        modelYear: 2020,
        colour: 'White',
        serviceCategory: 'CAR',
        ownershipType: 'FAMILY_OWNED',
      },
    });
    expect(buildVehicleCreate({ ...form, year: '1949' }, TODAY)).toMatchObject({ ok: false, errors: { year: 'vehicle.invalid.year' } });
    expect(buildVehicleCreate({ ...form, year: '2028' }, TODAY)).toMatchObject({ ok: false });
    expect(buildVehicleCreate(emptyVehicleForm, TODAY)).toMatchObject({ ok: false, errors: { plate: 'vehicle.invalid.plate', make: 'vehicle.invalid.make' } });
  });

  it('updates only changed fields with the vehicle version (the plate never changes)', () => {
    const vehicle = application().vehicles[0];
    if (!vehicle) throw new Error('fixture');
    expect(buildVehicleUpdate(vehicle, vehicleFormFrom(vehicle), TODAY)).toEqual({ ok: false, errors: {}, nothingToSave: true });
    expect(buildVehicleUpdate(vehicle, { ...vehicleFormFrom(vehicle), colour: 'Silver', plate: 'OTHER' }, TODAY)).toEqual({
      ok: true,
      request: { expectedVersion: 1, colour: 'Silver' },
    });
  });
});

describe('document claims and renewals', () => {
  it('claims only the fields the type has, with the vehicle for vehicle documents', () => {
    const form = { ...emptyDocumentForm, number: ' AB-123 ', licenceClass: 'ltv', expiresOn: { day: '1', month: '1', year: '2030' } };
    expect(buildDocumentClaim('DRIVING_LICENCE', ALL, form, null, TODAY)).toEqual({
      ok: true,
      request: { documentType: 'DRIVING_LICENCE', number: 'AB-123', licenceClass: 'LTV', expiresOn: '2030-01-01' },
    });
    expect(buildDocumentClaim('VEHICLE_REGISTRATION', NUMBER_ONLY, form, DRIVER_IDS.vehicle, TODAY)).toEqual({
      ok: true,
      request: { documentType: 'VEHICLE_REGISTRATION', vehicleId: DRIVER_IDS.vehicle, number: 'AB-123' },
    });
    expect(buildDocumentClaim('SELFIE', NONE, form, null, TODAY)).toEqual({ ok: true, request: { documentType: 'SELFIE' } });
  });

  it('refuses past expiry dates and malformed values', () => {
    const past = { ...emptyDocumentForm, expiresOn: { day: '1', month: '1', year: '2020' } };
    expect(buildDocumentClaim('CNIC', EXPIRY_ONLY, past, null, TODAY)).toEqual({ ok: false, errors: { expiresOn: 'claim.expiryInvalid' } });
    expect(buildDocumentClaim('DRIVING_LICENCE', ALL, { ...emptyDocumentForm, licenceClass: 'L T V' }, null, TODAY)).toMatchObject({
      ok: false,
      errors: { licenceClass: 'claim.licenceClassInvalid' },
    });
  });

  it('a renewal always needs the new expiry date', () => {
    expect(buildRenewalClaim(ALL, emptyDocumentForm, TODAY)).toEqual({ ok: false, errors: { expiresOn: 'claim.expiryRequired' } });
    expect(buildRenewalClaim(EXPIRY_ONLY, { ...emptyDocumentForm, number: 'IGNORED', expiresOn: { day: '31', month: '12', year: '2027' } }, TODAY)).toEqual({
      ok: true,
      request: { expiresOn: '2027-12-31' },
    });
  });
});
