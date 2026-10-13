/**
 * Vehicle eligibility rules (H10/CL-07; docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md §4) — pure, server-only,
 * authoritative (Phase-2 precedent: authoritative eligibility logic never lives in a client-importable package).
 *
 * Result per (vehicle, product): ELIGIBLE | NOT_ELIGIBLE(reasons) | UNKNOWN(missingAttributes). Any failing criterion
 * makes the vehicle NOT_ELIGIBLE (even when other attributes are unknown); UNKNOWN only when nothing fails but a
 * required attribute was never claimed (seats/body type/AC are optional applicant claims, DM-OPEN-02). Only ELIGIBLE
 * counts for dispatch (Phase 4); UNKNOWN is never eligible. Vehicle age uses the current year in Asia/Karachi from
 * SERVER time. No ACTIVE rule ⇒ NOT_ELIGIBLE(NO_ACTIVE_RULE) — fail closed.
 */
import type { VEHICLE_BODY_TYPES } from '@wayvro/contracts';
import { KARACHI_UTC_OFFSET_MS } from './service-hours.js';

export type BodyType = (typeof VEHICLE_BODY_TYPES)[number];

export interface EligibilityRuleFacts {
  readonly id: string;
  readonly version: number;
  /** The product's vehicle class (catalog.service_products.vehicle_class). */
  readonly vehicleClass: string;
  readonly minModelYear: number | null;
  readonly maxVehicleAgeYears: number | null;
  readonly minSeats: number | null;
  readonly acRequired: boolean;
  /** Empty = any body type. */
  readonly allowedBodyTypes: readonly BodyType[];
}

export interface VehicleFacts {
  readonly serviceCategory: string;
  readonly modelYear: number;
  readonly seats: number | null;
  readonly bodyType: BodyType | null;
  readonly airConditioned: boolean | null;
}

/** @public part of the eligibility result consumed by the driver readiness view (P3.8) */
export type EligibilityReason =
  'NO_ACTIVE_RULE' | 'VEHICLE_CLASS_MISMATCH' | 'MODEL_YEAR_TOO_OLD' | 'VEHICLE_TOO_OLD' | 'SEATS_BELOW_MINIMUM' | 'AC_REQUIRED' | 'BODY_TYPE_NOT_ALLOWED';
/** @public part of the eligibility result consumed by the driver readiness view (P3.8) */
export type MissingAttribute = 'seats' | 'bodyType' | 'airConditioned';

export type EligibilityResult =
  | { readonly kind: 'ELIGIBLE'; readonly ruleId: string; readonly ruleVersion: number }
  | { readonly kind: 'NOT_ELIGIBLE'; readonly reasons: readonly EligibilityReason[]; readonly ruleId: string | null; readonly ruleVersion: number | null }
  | { readonly kind: 'UNKNOWN'; readonly missingAttributes: readonly MissingAttribute[]; readonly ruleId: string; readonly ruleVersion: number };

/** Calendar year in Asia/Karachi (UTC+05:00, no DST) of a server instant. */
const karachiYear = (at: Date): number => new Date(at.getTime() + KARACHI_UTC_OFFSET_MS).getUTCFullYear();

export function evaluateVehicleEligibility(rule: EligibilityRuleFacts | null, vehicle: VehicleFacts, at: Date): EligibilityResult {
  if (!rule) return { kind: 'NOT_ELIGIBLE', reasons: ['NO_ACTIVE_RULE'], ruleId: null, ruleVersion: null };
  const reasons: EligibilityReason[] = [];
  const missing: MissingAttribute[] = [];
  if (vehicle.serviceCategory !== rule.vehicleClass) reasons.push('VEHICLE_CLASS_MISMATCH');
  if (rule.minModelYear !== null && vehicle.modelYear < rule.minModelYear) reasons.push('MODEL_YEAR_TOO_OLD');
  if (rule.maxVehicleAgeYears !== null && karachiYear(at) - vehicle.modelYear > rule.maxVehicleAgeYears) reasons.push('VEHICLE_TOO_OLD');
  if (rule.minSeats !== null) {
    if (vehicle.seats === null) missing.push('seats');
    else if (vehicle.seats < rule.minSeats) reasons.push('SEATS_BELOW_MINIMUM');
  }
  if (rule.acRequired) {
    if (vehicle.airConditioned === null) missing.push('airConditioned');
    else if (!vehicle.airConditioned) reasons.push('AC_REQUIRED');
  }
  if (rule.allowedBodyTypes.length > 0) {
    if (vehicle.bodyType === null) missing.push('bodyType');
    else if (!rule.allowedBodyTypes.includes(vehicle.bodyType)) reasons.push('BODY_TYPE_NOT_ALLOWED');
  }
  if (reasons.length > 0) return { kind: 'NOT_ELIGIBLE', reasons, ruleId: rule.id, ruleVersion: rule.version };
  if (missing.length > 0) return { kind: 'UNKNOWN', missingAttributes: missing, ruleId: rule.id, ruleVersion: rule.version };
  return { kind: 'ELIGIBLE', ruleId: rule.id, ruleVersion: rule.version };
}
