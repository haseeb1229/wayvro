import {
  ApplicationUpdateRequestSchema,
  DocumentClaimRequestSchema,
  DocumentRenewalRequestSchema,
  VehicleCreateRequestSchema,
  type OWNERSHIP_TYPES,
  type DriverApplication,
  type VEHICLE_BODY_TYPES,
} from '@wayvro/contracts';
import { parseDateParts, toAsciiDigits, type DateParts } from '../../../core/input/digits';
import type { ClaimsUpdate, DocumentClaim, RenewalClaim, VehicleCreate, VehicleUpdate } from '../api/driver-api';
import type { DriverStringKey } from '../i18n/driver-strings';
import type { DocumentFieldHints } from './field-hints';

/**
 * Form adapters for the Driver/Partner application (P2.8; D01/D02 claims, K05 appeals). On-device checks are UX
 * pre-checks mirroring the contract schemas; the server validates everything again and decides. Values are CLAIMS
 * until a human reviewer confirms them. Every request is finally parsed with its contract schema, so a form can never
 * send what the API would refuse for shape reasons.
 */

export type FieldErrors<F extends string> = Partial<Record<F, DriverStringKey>>;
export type FormResult<T, F extends string> =
  { readonly ok: true; readonly request: T } | { readonly ok: false; readonly errors: FieldErrors<F>; readonly nothingToSave?: true };

const CONTROL_OR_BIDI = /[\p{Cc}‪-‮⁦-⁩]/u;
const EARLIEST_DATE = '1900-01-01';
const LATEST_DATE = '2100-12-31';
const isEmptyDate = (d: DateParts): boolean => d.day.trim() === '' && d.month.trim() === '' && d.year.trim() === '';

// ── CNIC ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Formats typed digits (any script) as XXXXX-XXXXXXX-X while the user types; extra characters are dropped. */
export function formatCnicInput(raw: string): string {
  const digits = toAsciiDigits(raw).replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/** On-device FORMAT check only (`#####-#######-#`); it says nothing about whether a CNIC exists or belongs to anyone. @internal exported for unit tests */
export function isCnicFormat(value: string): boolean {
  return /^\d{5}-\d{7}-\d$/.test(value);
}

// ── applicant claims ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ClaimsForm {
  readonly legalName: string;
  readonly cnic: string;
  readonly dateOfBirth: DateParts;
}
type ClaimsField = 'legalName' | 'cnic' | 'dateOfBirth';

/** Sends only the fields the user filled in (the server keeps earlier claims); `expectedVersion` guards concurrency. */
export function buildClaimsUpdate(application: Pick<DriverApplication, 'version'>, form: ClaimsForm, todayIso: string): FormResult<ClaimsUpdate, ClaimsField> {
  const errors: FieldErrors<ClaimsField> = {};
  const name = form.legalName.trim().normalize('NFC');
  const cnic = formatCnicInput(form.cnic);
  let dateOfBirth: string | null = null;
  if (name !== '' && (name.length < 2 || name.length > 120 || CONTROL_OR_BIDI.test(name))) errors.legalName = 'details.legalNameInvalid';
  if (form.cnic.trim() !== '' && !isCnicFormat(cnic)) errors.cnic = 'details.cnicInvalid';
  if (!isEmptyDate(form.dateOfBirth)) {
    dateOfBirth = parseDateParts(form.dateOfBirth, { min: EARLIEST_DATE, max: todayIso });
    if (dateOfBirth === null) errors.dateOfBirth = 'details.dobInvalid';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const request: ClaimsUpdate = {
    expectedVersion: application.version,
    ...(name === '' ? {} : { legalName: name }),
    ...(form.cnic.trim() === '' ? {} : { cnic }),
    ...(dateOfBirth === null ? {} : { dateOfBirth }),
  };
  if (Object.keys(request).length === 1) return { ok: false, errors: {}, nothingToSave: true };
  return ApplicationUpdateRequestSchema.safeParse(request).success ? { ok: true, request } : { ok: false, errors: { legalName: 'details.legalNameInvalid' } };
}

/** Steps of the application that are complete, from the server's (masked) view. */
export function claimsComplete(application: DriverApplication): boolean {
  const { claims } = application;
  return claims.legalNameProvided && claims.cnicLast4 !== null && claims.dateOfBirthProvided;
}

// ── vehicle ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];
type BodyType = (typeof VEHICLE_BODY_TYPES)[number];
/** Body types offered for a car (the only category open for applications); the contract's list also has bike/rickshaw types. */
export const CAR_BODY_TYPES = ['HATCHBACK', 'SEDAN', 'SUV', 'CROSSOVER', 'MPV'] as const satisfies readonly BodyType[];
export type CarBodyType = (typeof CAR_BODY_TYPES)[number];
/** An optional claim choice: 'none' = not specified (nothing is sent). */
export type AirConditioningChoice = 'yes' | 'no' | 'none';

export interface VehicleForm {
  readonly plate: string;
  readonly make: string;
  readonly model: string;
  readonly year: string;
  readonly colour: string;
  readonly ownershipType: OwnershipType;
  readonly registrationNumber: string;
  /** Phase 3 optional claims (DM-OPEN-02): sent only when filled; they help match Comfort-type products (H10). */
  readonly seats: string;
  readonly bodyType: CarBodyType | 'none';
  readonly airConditioned: AirConditioningChoice;
}
export type VehicleField = 'plate' | 'make' | 'model' | 'year' | 'colour' | 'registrationNumber' | 'seats';

export const emptyVehicleForm: VehicleForm = {
  plate: '',
  make: '',
  model: '',
  year: '',
  colour: '',
  ownershipType: 'REGISTERED_OWNER',
  registrationNumber: '',
  seats: '',
  bodyType: 'none',
  airConditioned: 'none',
};

const isCarBodyType = (value: BodyType | null | undefined): value is CarBodyType => (CAR_BODY_TYPES as readonly string[]).includes(value ?? '');

interface VehicleClaims {
  readonly seats?: number;
  readonly bodyType?: CarBodyType;
  readonly airConditioned?: boolean;
}

/** The optional claims the form holds (absent = not specified); `seats` is null when the text is not a valid count. */
function claimsOf(form: VehicleForm): { readonly claims: VehicleClaims; readonly seatsValid: boolean } {
  const seatsText = toAsciiDigits(form.seats).trim();
  const seats = /^\d{1,2}$/.test(seatsText) ? Number(seatsText) : null;
  const seatsValid = seatsText === '' || (seats !== null && seats >= 1 && seats <= 12);
  return {
    seatsValid,
    claims: {
      ...(seatsText === '' || seats === null || !seatsValid ? {} : { seats }),
      ...(form.bodyType === 'none' ? {} : { bodyType: form.bodyType }),
      ...(form.airConditioned === 'none' ? {} : { airConditioned: form.airConditioned === 'yes' }),
    },
  };
}

function vehicleFieldErrors(form: VehicleForm, todayIso: string, plateRequired: boolean): { errors: FieldErrors<VehicleField>; year: number | null } {
  const errors: FieldErrors<VehicleField> = {};
  const within = (v: string, min: number, max: number) => v.trim().length >= min && v.trim().length <= max && !CONTROL_OR_BIDI.test(v);
  if (plateRequired && !within(form.plate, 2, 16)) errors.plate = 'vehicle.invalid.plate';
  if (!within(form.make, 1, 40)) errors.make = 'vehicle.invalid.make';
  if (!within(form.model, 1, 40)) errors.model = 'vehicle.invalid.model';
  if (!within(form.colour, 1, 30)) errors.colour = 'vehicle.invalid.colour';
  if (form.registrationNumber.trim() !== '' && !within(form.registrationNumber, 2, 40)) errors.registrationNumber = 'vehicle.invalid.registration';
  const yearText = toAsciiDigits(form.year).trim();
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
  const latest = Number(todayIso.slice(0, 4)) + 1;
  if (year === null || year < 1950 || year > latest) errors.year = 'vehicle.invalid.year';
  if (!claimsOf(form).seatsValid) errors.seats = 'vehicle.invalid.seats';
  return { errors, year };
}

export function buildVehicleCreate(form: VehicleForm, todayIso: string): FormResult<VehicleCreate, VehicleField> {
  const { errors, year } = vehicleFieldErrors(form, todayIso, true);
  if (Object.keys(errors).length > 0 || year === null) return { ok: false, errors };
  const request: VehicleCreate = {
    plate: form.plate.trim().toUpperCase(),
    make: form.make.trim(),
    model: form.model.trim(),
    modelYear: year,
    colour: form.colour.trim(),
    serviceCategory: 'CAR',
    ownershipType: form.ownershipType,
    ...(form.registrationNumber.trim() === '' ? {} : { registrationNumber: form.registrationNumber.trim() }),
    ...claimsOf(form).claims,
  };
  return VehicleCreateRequestSchema.safeParse(request).success ? { ok: true, request } : { ok: false, errors: { plate: 'vehicle.invalid.plate' } };
}

type VehicleView = DriverApplication['vehicles'][number];

export function vehicleFormFrom(vehicle: VehicleView): VehicleForm {
  return {
    plate: vehicle.plateDisplay,
    make: vehicle.make,
    model: vehicle.model,
    year: String(vehicle.modelYear),
    colour: vehicle.colour,
    ownershipType: vehicle.ownershipType,
    registrationNumber: '',
    seats: vehicle.seats === null || vehicle.seats === undefined ? '' : String(vehicle.seats),
    bodyType: isCarBodyType(vehicle.bodyType) ? vehicle.bodyType : 'none',
    airConditioned: vehicle.airConditioned === true ? 'yes' : vehicle.airConditioned === false ? 'no' : 'none',
  };
}

/** Whether the vehicle already has any optional claim on file (the server keeps claims on update; they cannot be removed). */
export function hasVehicleClaims(vehicle: VehicleView): boolean {
  return (vehicle.seats ?? null) !== null || (vehicle.bodyType ?? null) !== null || (vehicle.airConditioned ?? null) !== null;
}

/**
 * Only changed fields (the plate cannot change), with the vehicle's version for optimistic concurrency. An optional
 * claim is sent only when filled and different from the one on file ("not specified" never clears a claim).
 */
export function buildVehicleUpdate(vehicle: VehicleView, form: VehicleForm, todayIso: string): FormResult<VehicleUpdate, VehicleField> {
  const { errors, year } = vehicleFieldErrors(form, todayIso, false);
  if (Object.keys(errors).length > 0 || year === null) return { ok: false, errors };
  const { claims } = claimsOf(form);
  const request: VehicleUpdate = {
    expectedVersion: vehicle.version,
    ...(form.make.trim() === vehicle.make ? {} : { make: form.make.trim() }),
    ...(form.model.trim() === vehicle.model ? {} : { model: form.model.trim() }),
    ...(year === vehicle.modelYear ? {} : { modelYear: year }),
    ...(form.colour.trim() === vehicle.colour ? {} : { colour: form.colour.trim() }),
    ...(form.ownershipType === vehicle.ownershipType ? {} : { ownershipType: form.ownershipType }),
    ...(claims.seats === undefined || claims.seats === vehicle.seats ? {} : { seats: claims.seats }),
    ...(claims.bodyType === undefined || claims.bodyType === vehicle.bodyType ? {} : { bodyType: claims.bodyType }),
    ...(claims.airConditioned === undefined || claims.airConditioned === vehicle.airConditioned ? {} : { airConditioned: claims.airConditioned }),
  };
  if (Object.keys(request).length === 1) return { ok: false, errors: {}, nothingToSave: true };
  return { ok: true, request };
}

// ── document claims ──────────────────────────────────────────────────────────────────────────────────────────────

export interface DocumentForm {
  readonly number: string;
  readonly licenceClass: string;
  readonly issuedOn: DateParts;
  readonly expiresOn: DateParts;
}
type DocumentField = 'number' | 'licenceClass' | 'issuedOn' | 'expiresOn';

export const emptyDate: DateParts = { day: '', month: '', year: '' };
export const emptyDocumentForm: DocumentForm = { number: '', licenceClass: '', issuedOn: emptyDate, expiresOn: emptyDate };

function documentFields(
  hints: DocumentFieldHints,
  form: DocumentForm,
  todayIso: string,
  expiryRequired: boolean,
): { errors: FieldErrors<DocumentField>; values: { number?: string; licenceClass?: string; issuedOn?: string; expiresOn?: string } } {
  const errors: FieldErrors<DocumentField> = {};
  const values: { number?: string; licenceClass?: string; issuedOn?: string; expiresOn?: string } = {};
  const number = toAsciiDigits(form.number).trim();
  if (hints.number && number !== '') {
    if (number.length < 2 || number.length > 40 || CONTROL_OR_BIDI.test(number)) errors.number = 'claim.numberInvalid';
    else values.number = number;
  }
  const licenceClass = form.licenceClass.trim().toUpperCase();
  if (hints.licenceClass && licenceClass !== '') {
    if (!/^[A-Z0-9-]{1,12}$/.test(licenceClass)) errors.licenceClass = 'claim.licenceClassInvalid';
    else values.licenceClass = licenceClass;
  }
  if (hints.issuedOn && !isEmptyDate(form.issuedOn)) {
    const issued = parseDateParts(form.issuedOn, { min: EARLIEST_DATE, max: todayIso });
    if (issued === null) errors.issuedOn = 'claim.dateInvalid';
    else values.issuedOn = issued;
  }
  if (hints.expiresOn && (expiryRequired || !isEmptyDate(form.expiresOn))) {
    const expires = parseDateParts(form.expiresOn, { min: todayIso, max: LATEST_DATE });
    if (expires === null) errors.expiresOn = isEmptyDate(form.expiresOn) ? 'claim.expiryRequired' : 'claim.expiryInvalid';
    else values.expiresOn = expires;
  }
  return { errors, values };
}

/** A first claim also names the district of a per-district document (R46); a renewal keeps the original district. */
export interface ClaimForm extends DocumentForm {
  /** '' until the user picks one of the server's districts. */
  readonly districtCode: string;
}
export type ClaimField = DocumentField | 'district';

export const emptyClaimForm: ClaimForm = { ...emptyDocumentForm, districtCode: '' };

/**
 * A document claim for one requirement item; vehicle documents name the application's vehicle. `districtCodes` is the
 * server's district list for a per-district item (a district from it is REQUIRED, as on the server) and `null` for any
 * other item, which never carries a district (the server refuses one).
 */
export function buildDocumentClaim(
  documentType: string,
  hints: DocumentFieldHints,
  form: ClaimForm,
  vehicleId: string | null,
  districtCodes: readonly string[] | null,
  todayIso: string,
): FormResult<DocumentClaim, ClaimField> {
  const { errors, values } = documentFields(hints, form, todayIso, false);
  const allErrors: FieldErrors<ClaimField> = { ...errors };
  if (districtCodes !== null && !districtCodes.includes(form.districtCode))
    allErrors.district = districtCodes.length === 0 ? 'claim.noDistrict' : 'claim.districtRequired';
  if (Object.keys(allErrors).length > 0) return { ok: false, errors: allErrors };
  const request: DocumentClaim = {
    documentType,
    ...(vehicleId === null ? {} : { vehicleId }),
    ...(districtCodes === null ? {} : { districtCode: form.districtCode }),
    ...values,
  };
  const parsed = DocumentClaimRequestSchema.safeParse(request);
  if (parsed.success) return { ok: true, request };
  const districtIssue = parsed.error.issues.some((issue) => issue.path[0] === 'districtCode');
  return { ok: false, errors: districtIssue ? { district: 'claim.districtRequired' } : { number: 'claim.numberInvalid' } };
}

/** A renewal always carries the new expiry date (the server requires it). */
export function buildRenewalClaim(hints: DocumentFieldHints, form: DocumentForm, todayIso: string): FormResult<RenewalClaim, DocumentField> {
  const { errors, values } = documentFields({ ...hints, expiresOn: true }, form, todayIso, true);
  if (Object.keys(errors).length > 0 || values.expiresOn === undefined) return { ok: false, errors: { expiresOn: 'claim.expiryRequired', ...errors } };
  const request: RenewalClaim = { ...values, expiresOn: values.expiresOn };
  return DocumentRenewalRequestSchema.safeParse(request).success ? { ok: true, request } : { ok: false, errors: { expiresOn: 'claim.expiryInvalid' } };
}
