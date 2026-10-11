/**
 * PROP-SM and PROP-ELIG (pure): the application machine accepts only its listed transitions, nothing automated reaches
 * VERIFIED and terminals are absorbing; the eligibility evaluator reports every blocker, any blocker means ineligible,
 * an ACCOUNT restriction always blocks, driver-side restrictions (incl. RISK_HOLD) never block rider use, live expiry
 * beats a stored VALID status, and placeholders only block production-like environments.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { APPLICATION_STATES, TERMINAL_APPLICATION_STATES, allTransitions, canTransition, type ApplicationState } from '../src/compliance/application-state.js';
import {
  REASON_CLASSES,
  RESTRICTION_SCOPES,
  ageOn,
  blocksRiderUse,
  evaluateEarningEligibility,
  inForce,
  type EligibilityInput,
  type RestrictionFact,
} from '../src/compliance/eligibility.js';

const ACTORS = ['APPLICANT', 'SYSTEM', 'REVIEWER'] as const;

describe('PROP-SM application state machine', () => {
  it('only a REVIEWER can reach VERIFIED (no automated edge, K04/K05)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...APPLICATION_STATES), fc.constantFrom(...ACTORS), (from, actor) => {
        if (canTransition(from, 'VERIFIED', actor)) expect(actor).toBe('REVIEWER');
      }),
    );
    expect(allTransitions().filter(([, to]) => to === 'VERIFIED')).toEqual([['MANUAL_REVIEW', 'VERIFIED', 'REVIEWER']]);
  });

  it('terminal states are absorbing and unlisted transitions are refused', () => {
    fc.assert(
      fc.property(fc.constantFrom(...APPLICATION_STATES), fc.constantFrom(...APPLICATION_STATES), fc.constantFrom(...ACTORS), (from, to, actor) => {
        const listed = allTransitions().some(([f, t, a]) => f === from && t === to && a === actor);
        expect(canTransition(from, to, actor)).toBe(listed);
        if (TERMINAL_APPLICATION_STATES.has(from)) expect(canTransition(from, to, actor)).toBe(false);
      }),
    );
  });

  it('every non-terminal state can still reach a terminal state', () => {
    for (const s of APPLICATION_STATES) {
      if (TERMINAL_APPLICATION_STATES.has(s)) continue;
      const seen = new Set<ApplicationState>([s]);
      const queue = [s];
      while (queue.length) {
        const cur = queue.shift() as ApplicationState;
        for (const [f, t] of allTransitions()) {
          if (f === cur && !seen.has(t)) {
            seen.add(t);
            queue.push(t);
          }
        }
      }
      expect(
        [...seen].some((x) => TERMINAL_APPLICATION_STATES.has(x)),
        s,
      ).toBe(true);
    }
  });
});

const NOW = new Date('2026-10-11T12:00:00Z');
const restriction = (over: Partial<RestrictionFact> = {}): RestrictionFact => ({
  scope: 'ACCOUNT',
  reasonClass: 'FRAUD',
  status: 'ACTIVE',
  effectiveFrom: new Date('2026-10-01T00:00:00Z'),
  effectiveUntil: null,
  driverProfileId: null,
  vehicleId: null,
  serviceCapabilityId: null,
  cityCode: null,
  serviceCategory: null,
  ...over,
});
const eligibleInput = (): EligibilityInput => ({
  now: NOW,
  productionLike: false,
  accountActive: true,
  restrictions: [],
  profile: { id: 'p1', state: 'ACTIVE_ELIGIBLE' },
  vehicle: { id: 'v1', ownershipType: 'REGISTERED_OWNER' },
  cityCode: 'LHR',
  serviceCategory: 'CAR',
  serviceCategoryEnabled: true,
  capability: { id: 'c1', status: 'GRANTED' },
  requirementSet: {
    isPlaceholder: true,
    items: [
      { type: 'CNIC', mandatory: true, appliesToOwnershipTypes: [], licenceClassesAllowed: [], subject: 'DRIVER' },
      { type: 'DRIVING_LICENCE', mandatory: true, appliesToOwnershipTypes: [], licenceClassesAllowed: ['LTV'], subject: 'DRIVER' },
      { type: 'VEHICLE_REGISTRATION', mandatory: true, appliesToOwnershipTypes: [], licenceClassesAllowed: [], subject: 'VEHICLE' },
      { type: 'AUTHORISED_USE_LETTER', mandatory: true, appliesToOwnershipTypes: ['FAMILY_OWNED'], licenceClassesAllowed: [], subject: 'DRIVER_VEHICLE' },
      { type: 'ROUTE_PERMIT', mandatory: false, appliesToOwnershipTypes: [], licenceClassesAllowed: [], subject: 'VEHICLE' },
    ],
  },
  documents: [
    { type: 'CNIC', status: 'VALID', expiresOn: '2030-01-01', licenceClass: null, vehicleId: null },
    { type: 'DRIVING_LICENCE', status: 'VALID', expiresOn: '2028-01-01', licenceClass: 'LTV', vehicleId: null },
    { type: 'VEHICLE_REGISTRATION', status: 'VALID', expiresOn: null, licenceClass: null, vehicleId: 'v1' },
  ],
  agePolicy: { status: 'PLACEHOLDER_NOT_FOR_PRODUCTION', driverMinimumAge: null },
  driverDateOfBirth: '1990-05-05',
});

const restrictionArb = fc.record({
  scope: fc.constantFrom(...RESTRICTION_SCOPES),
  reasonClass: fc.constantFrom(...REASON_CLASSES),
  status: fc.constantFrom('ACTIVE' as const, 'LIFT_PENDING_APPROVAL' as const, 'LIFTED' as const, 'EXPIRED' as const),
  effectiveFrom: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31'), noInvalidDate: true }),
  effectiveUntil: fc.option(fc.date({ min: new Date('2026-01-01'), max: new Date('2027-12-31'), noInvalidDate: true }), { nil: null }),
  driverProfileId: fc.constantFrom('p1', 'p2', null),
  vehicleId: fc.constantFrom('v1', 'v2', null),
  serviceCapabilityId: fc.constantFrom('c1', 'c2', null),
  cityCode: fc.constantFrom('LHR', null),
  serviceCategory: fc.constantFrom('CAR', 'BIKE', null),
});

describe('PROP-ELIG earning eligibility', () => {
  it('a complete, unrestricted driver is eligible (local placeholders do not block outside production)', () => {
    expect(evaluateEarningEligibility(eligibleInput())).toEqual({ eligible: true, blockers: [] });
  });

  it('any blocker means ineligible; an in-force ACCOUNT restriction always blocks; driver scopes never block rider use', () => {
    fc.assert(
      fc.property(fc.array(restrictionArb, { maxLength: 5 }), (restrictions) => {
        const result = evaluateEarningEligibility({ ...eligibleInput(), restrictions });
        expect(result.eligible).toBe(result.blockers.length === 0);
        const accountInForce = restrictions.some((r) => r.scope === 'ACCOUNT' && inForce(r, NOW));
        if (accountInForce) expect(result.blockers.map((b) => b.code)).toContain('ACCOUNT_RESTRICTED');
        for (const r of restrictions) if (r.scope !== 'ACCOUNT') expect(blocksRiderUse(r, NOW)).toBe(false);
      }),
    );
  });

  it('RISK_HOLD on the driver role blocks earning, not rider use, and ends with its expiry', () => {
    const hold = restriction({ scope: 'DRIVER_ROLE', reasonClass: 'RISK_HOLD', driverProfileId: 'p1', effectiveUntil: new Date('2026-10-12T00:00:00Z') });
    expect(evaluateEarningEligibility({ ...eligibleInput(), restrictions: [hold] }).blockers).toEqual([{ code: 'DRIVER_ROLE_RESTRICTED' }]);
    expect(blocksRiderUse(hold, NOW)).toBe(false);
    expect(evaluateEarningEligibility({ ...eligibleInput(), now: new Date('2026-10-12T00:00:01Z'), restrictions: [hold] }).eligible).toBe(true);
  });

  it('a VEHICLE restriction blocks only that vehicle', () => {
    const r = restriction({ scope: 'VEHICLE', reasonClass: 'COMPLIANCE', vehicleId: 'v1' });
    expect(evaluateEarningEligibility({ ...eligibleInput(), restrictions: [r] }).blockers).toEqual([{ code: 'VEHICLE_RESTRICTED' }]);
    expect(evaluateEarningEligibility({ ...eligibleInput(), restrictions: [{ ...r, vehicleId: 'v2' }] }).eligible).toBe(true);
  });

  it('live expiry beats a stored VALID status; missing, invalid and wrong-class documents block with their type', () => {
    const input = eligibleInput();
    const expired = { ...input, documents: input.documents.map((d) => (d.type === 'CNIC' ? { ...d, expiresOn: '2026-10-11' } : d)) };
    expect(evaluateEarningEligibility(expired).blockers).toEqual([{ code: 'DOCUMENT_EXPIRED', documentType: 'CNIC' }]);
    const missing = { ...input, documents: input.documents.filter((d) => d.type !== 'VEHICLE_REGISTRATION') };
    expect(evaluateEarningEligibility(missing).blockers).toEqual([{ code: 'DOCUMENT_MISSING', documentType: 'VEHICLE_REGISTRATION' }]);
    const pending = { ...input, documents: input.documents.map((d) => (d.type === 'CNIC' ? { ...d, status: 'UNDER_REVIEW' as const } : d)) };
    expect(evaluateEarningEligibility(pending).blockers).toEqual([{ code: 'DOCUMENT_NOT_VALID', documentType: 'CNIC' }]);
    const wrongClass = { ...input, documents: input.documents.map((d) => (d.type === 'DRIVING_LICENCE' ? { ...d, licenceClass: 'MOTORCYCLE' } : d)) };
    expect(evaluateEarningEligibility(wrongClass).blockers).toEqual([{ code: 'LICENCE_CLASS_NOT_ALLOWED', documentType: 'DRIVING_LICENCE' }]);
    // the authorised-use letter applies only to the listed ownership types
    const family = { ...input, vehicle: { id: 'v1', ownershipType: 'FAMILY_OWNED' } };
    expect(evaluateEarningEligibility(family).blockers).toEqual([{ code: 'DOCUMENT_MISSING', documentType: 'AUTHORISED_USE_LETTER' }]);
    // a vehicle document of another vehicle does not count
    const otherVehicle = { ...input, documents: input.documents.map((d) => (d.type === 'VEHICLE_REGISTRATION' ? { ...d, vehicleId: 'v2' } : d)) };
    expect(evaluateEarningEligibility(otherVehicle).blockers).toEqual([{ code: 'DOCUMENT_MISSING', documentType: 'VEHICLE_REGISTRATION' }]);
  });

  it('placeholders block production-like environments; disabled categories, missing profile/capability and under-age block', () => {
    expect(evaluateEarningEligibility({ ...eligibleInput(), productionLike: true }).blockers.map((b) => b.code)).toEqual([
      'REQUIREMENT_SET_PLACEHOLDER',
      'AGE_POLICY_PLACEHOLDER',
    ]);
    const blocked = evaluateEarningEligibility({
      ...eligibleInput(),
      profile: null,
      capability: null,
      serviceCategoryEnabled: false,
      requirementSet: null,
      vehicle: null,
      accountActive: false,
      agePolicy: { status: 'APPROVED', driverMinimumAge: 50 },
    });
    expect(blocked.blockers.map((b) => b.code)).toEqual([
      'ACCOUNT_NOT_ACTIVE',
      'NO_DRIVER_PROFILE',
      'NO_VEHICLE',
      'SERVICE_CATEGORY_DISABLED_LEGAL_GATE',
      'CAPABILITY_NOT_GRANTED',
      'NO_ACTIVE_REQUIREMENT_SET',
      'DRIVER_AGE_BELOW_MINIMUM',
    ]);
    expect(evaluateEarningEligibility({ ...eligibleInput(), profile: { id: 'p1', state: 'REVERIFY_DUE' } }).blockers).toEqual([
      { code: 'PROFILE_REVERIFICATION_DUE' },
    ]);
    expect(
      evaluateEarningEligibility({
        ...eligibleInput(),
        capability: { id: 'c1', status: 'GRANTED' },
        restrictions: [restriction({ scope: 'SERVICE_CAPABILITY', serviceCapabilityId: 'c1', reasonClass: 'QUALITY' })],
      }).blockers,
    ).toEqual([{ code: 'CAPABILITY_RESTRICTED' }]);
    expect(
      evaluateEarningEligibility({
        ...eligibleInput(),
        restrictions: [restriction({ scope: 'CITY_CATEGORY', driverProfileId: 'p1', cityCode: 'LHR', serviceCategory: 'CAR', reasonClass: 'COMPLIANCE' })],
      }).blockers,
    ).toEqual([{ code: 'CITY_CATEGORY_RESTRICTED' }]);
  });

  it('age is computed on calendar days (birthday edge)', () => {
    expect(ageOn('2000-10-11', new Date('2026-10-11T00:00:00Z'))).toBe(26);
    expect(ageOn('2000-10-12', new Date('2026-10-11T23:59:59Z'))).toBe(25);
    expect(ageOn('2000-11-01', new Date('2026-10-11T00:00:00Z'))).toBe(25);
  });
});
