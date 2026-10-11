/**
 * Driver/Partner onboarding in the ONE Wayvro app (V03/V01; D01, D04, K06, K07, R02–R06, R46). Rider use is never
 * affected by an application or its outcome. Applicant identity fields are encrypted CLAIMS until a human reviewer
 * confirms them (P2.7); there is no OCR and no automated decision.
 *
 * Gates (server-side, in order): `driver.onboarding` flag, required account actions (policies, age declaration), no
 * in-force ACCOUNT restriction. One non-terminal application per account (database index). Duplicate-identity checks
 * create SIGNALS (CNIC hash, document number, plate) for human review — never rejections or merges (K07, §1).
 * Evidence upload and submission arrive with the vault (P2.6).
 */
import { randomInt } from 'node:crypto';
import { isFlagEnabled, type WayvroEnv } from '@wayvro/config';
import { CAPTURE_CHALLENGE_CODES, type DriverApplication, type DriverCompliance, type ErrorCode } from '@wayvro/contracts';
import type { FieldCipher, KeyedHasher } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, fieldContext } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { appendAudit, enqueueJob, sqlState, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import { currentAgePolicy } from '../legal/age-policy.js';
import { consentStatuses, requiredActionsFor } from '../legal/consent.service.js';
import { failure, success, type IdempotencyStore, type IdempotentResult, type Outcome } from '../platform/idempotency.js';
import { emitEvent } from '../platform/outbox.js';
import { EDITABLE_APPLICATION_STATES, canTransition, type ApplicationState } from './application-state.js';
import { evaluateEarningEligibility, inForce, type DocumentFact, type RequirementItemFact } from './eligibility.js';
import { canonicalCnic, canonicalDocumentNumber, normalisePlate, plausibleBirthDate } from './normalise.js';
import { accountRestrictionsInForce, accountView, restrictionsForAccount } from './restrictions.js';

export interface OnboardingPolicy {
  readonly WAYVRO_ENV: WayvroEnv;
  readonly IDEMPOTENCY_TTL_SECONDS: number;
  readonly CAPTURE_CHALLENGE_TTL_SECONDS: number;
}

/**
 * What submission needs from the evidence vault (implemented by the vault module, which owns its own database role):
 * user-safe evidence states per application. The compliance module never reads vault tables.
 */
export interface EvidenceState {
  readonly evidenceId: string;
  readonly documentId: string;
  readonly kind: string;
  /** user-safe status (ACCEPTED, PROCESSING, …) */
  readonly status: string;
  readonly captureSource: string;
  readonly pixelWidth: number | null;
  readonly pixelHeight: number | null;
}

export interface EvidenceSummaryPort {
  evidenceStates(applicationId: string): Promise<ReadonlyArray<EvidenceState>>;
}

interface CaptureChallenge {
  readonly challengeId: string;
  readonly challengeCode: string;
  readonly expiresAt: string;
}

interface Principal {
  readonly accountId: string;
  readonly sessionId: string;
}

type AppRow = {
  id: string;
  state: ApplicationState;
  version: number;
  city_code: string;
  cnic_last4: string | null;
  legal_name_envelope: Buffer | null;
  date_of_birth_envelope: Buffer | null;
  created_at: Date;
  submitted_at: Date | null;
};

const DRIVER_POLICY_KEYS = ['DRIVER_PARTNER_AGREEMENT', 'BIOMETRIC_KYC_NOTICE'];

type ProfileState = 'VERIFIED' | 'ACTIVE_ELIGIBLE' | 'EXPIRED' | 'REVERIFY_DUE';

/** Account-state driver section (server truth for client routing; never a capability). */
export async function driverSection(
  q: Queryable,
  accountId: string,
  onboardingAvailable: boolean,
): Promise<{ application: { id: string; state: ApplicationState } | null; profile: { id: string; state: ProfileState } | null; onboardingAvailable: boolean }> {
  const app = await q.query<{ id: string; state: ApplicationState }>(
    `select id, state from compliance.driver_applications where account_id = $1 order by created_at desc, id desc limit 1`,
    [accountId],
  );
  const profile = await q.query<{ id: string; state: ProfileState }>(`select id, state from compliance.driver_profiles where account_id = $1`, [accountId]);
  return { application: app.rows[0] ?? null, profile: profile.rows[0] ?? null, onboardingAvailable };
}

export class OnboardingService {
  constructor(
    private readonly db: pg.Pool,
    private readonly cipher: FieldCipher,
    private readonly hasher: KeyedHasher,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: OnboardingPolicy,
    /** Null when the vault is not configured: submission then answers 503 DEPENDENCY_UNAVAILABLE. */
    private readonly evidence: EvidenceSummaryPort | null = null,
  ) {}

  get available(): boolean {
    return isFlagEnabled('driver.onboarding', this.policy.WAYVRO_ENV);
  }

  /** Flag + required actions + account restriction (each a distinct, actionable error). */
  private async admit(q: Queryable, accountId: string): Promise<void> {
    if (!this.available) throw new WayvroError('WAYVRO_E_FEATURE_DISABLED');
    const actions = await requiredActionsFor(q, accountId);
    if (actions.includes('ACCEPT_POLICIES')) throw new WayvroError('WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED', { details: { requiredActions: actions } });
    if (actions.includes('AGE_DECLARATION')) throw new WayvroError('WAYVRO_E_AGE_DECLARATION_REQUIRED', { details: { requiredActions: actions } });
    const restricted = await accountRestrictionsInForce(q, accountId, new Date());
    if (restricted.length > 0) throw new WayvroError('WAYVRO_E_ACCOUNT_RESTRICTED', { details: { reasonCodes: restricted.map((r) => r.reasonCode) } });
  }

  private run(
    principal: Principal,
    operation: string,
    key: string,
    payload: unknown,
    work: (tx: pg.PoolClient) => Promise<ReturnType<typeof success>>,
  ): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `acct:${principal.accountId}`, operation, key, payload, ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS },
      async (tx) => {
        await this.admit(tx, principal.accountId);
        return work(tx);
      },
    );
  }

  /**
   * `lock` takes FOR NO KEY UPDATE (no path changes the key): it serialises application mutations but, unlike FOR UPDATE,
   * does not block foreign-key KEY SHARE checks — the vault module inserts rows referencing the application on its OWN
   * connection while this transaction is open, and a cross-connection wait would be an undetectable deadlock.
   */
  private async loadApplication(q: Queryable, accountId: string, id: string, lock = false): Promise<AppRow | null> {
    const r = await q.query<AppRow>(
      `select id, state, version, city_code, cnic_last4, legal_name_envelope, date_of_birth_envelope, created_at, submitted_at
         from compliance.driver_applications where id = $1 and account_id = $2 ${lock ? 'for no key update' : ''}`,
      [id, accountId],
    );
    return r.rows[0] ?? null;
  }

  /** Owner-scoped application view; foreign ids are indistinguishable from unknown ones (404). */
  async view(q: Queryable, accountId: string, app: AppRow): Promise<DriverApplication> {
    const categories = await q.query<{ service_category: 'CAR' | 'BIKE' | 'RICKSHAW' }>(
      `select service_category from compliance.application_service_categories where application_id = $1 order by service_category`,
      [app.id],
    );
    const vehicles = await q.query<{
      id: string;
      plate_display: string;
      make: string;
      model: string;
      model_year: number;
      colour: string;
      service_category: 'CAR' | 'BIKE' | 'RICKSHAW';
      ownership_type: DriverApplication['vehicles'][number]['ownershipType'];
      relation: 'OWNER' | 'AUTHORISED_USER';
      version: number;
    }>(
      `select v.id, v.plate_display, v.make, v.model, v.model_year, v.colour, v.service_category, v.ownership_type, va.relation, v.version
         from compliance.vehicle_affiliations va join compliance.vehicles v on v.id = va.vehicle_id
        where va.driver_application_id = $1 and va.status <> 'ENDED' order by va.created_at`,
      [app.id],
    );
    const documents = await q.query<{
      id: string;
      document_type_code: string;
      vehicle_id: string | null;
      district_code: string | null;
      number_last4: string | null;
      licence_class: string | null;
      claimed_expires_on: string | null;
      status: DriverApplication['documents'][number]['status'];
    }>(
      `select id, document_type_code, vehicle_id, district_code, number_last4, licence_class, to_char(claimed_expires_on, 'YYYY-MM-DD') claimed_expires_on, status
         from compliance.compliance_documents where driver_application_id = $1 and status <> 'SUPERSEDED' order by created_at`,
      [app.id],
    );
    const pending = (await consentStatuses(q, accountId, new Date()))
      .filter((s) => DRIVER_POLICY_KEYS.includes(s.policyKey) && s.acceptanceRequired)
      .map((s) => s.policyKey)
      .sort();
    return {
      id: app.id,
      state: app.state,
      version: app.version,
      cityCode: app.city_code,
      serviceCategories: categories.rows.map((c) => c.service_category),
      claims: { legalNameProvided: app.legal_name_envelope !== null, cnicLast4: app.cnic_last4, dateOfBirthProvided: app.date_of_birth_envelope !== null },
      vehicles: vehicles.rows.map((v) => ({
        id: v.id,
        plateDisplay: v.plate_display,
        make: v.make,
        model: v.model,
        modelYear: v.model_year,
        colour: v.colour,
        serviceCategory: v.service_category,
        ownershipType: v.ownership_type,
        relation: v.relation,
        version: v.version,
      })),
      documents: documents.rows.map((d) => ({
        id: d.id,
        documentType: d.document_type_code,
        vehicleId: d.vehicle_id,
        districtCode: d.district_code,
        numberLast4: d.number_last4,
        licenceClass: d.licence_class,
        claimedExpiresOn: d.claimed_expires_on,
        status: d.status,
      })),
      pendingPolicies: pending,
      createdAt: app.created_at.toISOString(),
      submittedAt: app.submitted_at?.toISOString() ?? null,
      review: await this.reviewSection(q, app),
    };
  }

  /** The latest EFFECTIVE human decision (pending second approvals and escalations excluded), in-person flag, open appeal. */
  private async reviewSection(q: Queryable, app: AppRow): Promise<NonNullable<DriverApplication['review']>> {
    const decision = (
      await q.query<{ id: string; decision: 'APPROVE' | 'NEEDS_INFO' | 'REJECT' | 'REQUIRE_IN_PERSON'; reason_codes: string[]; decided_at: Date }>(
        `select d.id, d.decision, d.reason_codes, d.decided_at
           from compliance.review_decisions d join compliance.review_cases c on c.id = d.review_case_id
           left join compliance.review_second_approvals s on s.review_decision_id = d.id
          where c.driver_application_id = $1 and d.decision <> 'ESCALATE' and (not d.requires_second_approval or s.outcome = 'APPROVED')
          order by d.decided_at desc, d.id desc limit 1`,
        [app.id],
      )
    ).rows[0];
    const inPerson = await q.query(
      `select 1 from compliance.review_cases where driver_application_id = $1 and in_person_required and status in ('OPEN', 'CLAIMED', 'ESCALATED')`,
      [app.id],
    );
    const appeal = (
      await q.query<{ id: string }>(
        `select ap.id from profile.appeals ap join compliance.review_decisions d on d.id = ap.review_decision_id join compliance.review_cases c on c.id = d.review_case_id
          where c.driver_application_id = $1 and ap.status in ('SUBMITTED', 'UNDER_REVIEW') limit 1`,
        [app.id],
      )
    ).rows[0];
    return {
      latestDecision: decision
        ? {
            decisionId: decision.id,
            decision: decision.decision,
            reasonCodes: decision.reason_codes,
            decidedAt: decision.decided_at.toISOString(),
            appealable: decision.decision === 'REJECT' && app.state === 'REJECTED',
          }
        : null,
      inPersonRequired: (inPerson.rowCount ?? 0) > 0,
      openAppealId: appeal?.id ?? null,
    };
  }

  private async enabledCategories(q: Queryable, categories: readonly string[]): Promise<boolean> {
    const r = await q.query<{ n: string }>(`select count(*) n from catalog.service_categories where code = any($1::text[]) and status = 'ENABLED'`, [
      [...new Set(categories)],
    ]);
    return Number(r.rows[0]?.n ?? 0) === new Set(categories).size;
  }

  async create(principal: Principal, input: { cityCode: string; serviceCategories: readonly string[] }, key: string): Promise<IdempotentResult> {
    return this.run(principal, 'driver-onboarding.create', key, input, async (tx) => {
      const city = await tx.query(`select 1 from catalog.cities where code = $1 and status = 'ENABLED'`, [input.cityCode]);
      if (city.rowCount === 0 || !(await this.enabledCategories(tx, input.serviceCategories))) return failure('WAYVRO_E_VALIDATION');
      const profile = await tx.query(`select 1 from compliance.driver_profiles where account_id = $1`, [principal.accountId]);
      if (profile.rowCount !== 0) return failure('WAYVRO_E_CONFLICT');
      const id = uuidv7();
      await tx.query('savepoint new_application');
      try {
        await tx.query(`insert into compliance.driver_applications (id, account_id, state, city_code) values ($1, $2, 'DRAFT', $3)`, [
          id,
          principal.accountId,
          input.cityCode,
        ]);
      } catch (e) {
        if (sqlState(e) !== '23505') throw e;
        await tx.query('rollback to savepoint new_application');
        return failure('WAYVRO_E_CONFLICT');
      }
      for (const c of new Set(input.serviceCategories))
        await tx.query(`insert into compliance.application_service_categories (application_id, service_category) values ($1, $2)`, [id, c]);
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'DRIVER_APPLICATION_CREATED',
        objectType: 'compliance.driver_application',
        objectId: id,
        outcome: 'SUCCESS',
      });
      const app = await this.loadApplication(tx, principal.accountId, id);
      if (!app) throw new Error('application vanished');
      return success(201, await this.view(tx, principal.accountId, app));
    });
  }

  async current(principal: Principal): Promise<DriverApplication> {
    if (!this.available) throw new WayvroError('WAYVRO_E_FEATURE_DISABLED');
    const r = await this.db.query<{ id: string }>(
      `select id from compliance.driver_applications where account_id = $1 order by created_at desc, id desc limit 1`,
      [principal.accountId],
    );
    const app = r.rows[0] ? await this.loadApplication(this.db, principal.accountId, r.rows[0].id) : null;
    if (!app) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    return this.view(this.db, principal.accountId, app);
  }

  /** CNIC lookup (ACTIVE key), one row per application; matches on other accounts become CNIC_HASH_MATCH signals. */
  private async indexCnic(tx: pg.PoolClient, accountId: string, applicationId: string, cnic: string): Promise<number> {
    const active = this.hasher.active('cnic_lookup', cnic);
    await tx.query(
      `insert into compliance.cnic_lookup_index (id, subject_application_id, lookup_key_version, lookup_hash) values ($1, $2, $3, $4)
       on conflict (subject_application_id, lookup_key_version) where subject_application_id is not null do update set lookup_hash = excluded.lookup_hash`,
      [uuidv7(), applicationId, active.version, active.digest],
    );
    const live = this.hasher.live('cnic_lookup', cnic);
    const matches = await tx.query<{ subject_application_id: string | null; subject_profile_id: string | null }>(
      `select l.subject_application_id, l.subject_profile_id
         from compliance.cnic_lookup_index l
         left join compliance.driver_applications a on a.id = l.subject_application_id
         left join compliance.driver_profiles p on p.id = l.subject_profile_id
        where (l.lookup_key_version, l.lookup_hash) in (select * from unnest($1::smallint[], $2::bytea[]))
          and coalesce(a.account_id, p.account_id) <> $3`,
      [live.map((d) => d.version), live.map((d) => d.digest), accountId],
    );
    let created = 0;
    for (const m of matches.rows) {
      const r = await tx.query(
        `insert into compliance.duplicate_signals (id, signal, subject_application_id, matched_application_id, matched_profile_id, status)
         values ($1, 'CNIC_HASH_MATCH', $2, $3, $4, 'OPEN') on conflict do nothing`,
        [uuidv7(), applicationId, m.subject_application_id, m.subject_profile_id],
      );
      created += r.rowCount ?? 0;
    }
    return created;
  }

  async updateClaims(
    principal: Principal,
    id: string,
    input: {
      expectedVersion: number;
      legalName?: string | undefined;
      cnic?: string | undefined;
      dateOfBirth?: string | undefined;
      serviceCategories?: readonly string[] | undefined;
    },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(principal, 'driver-onboarding.update-claims', key, { id, ...input }, async (tx) => {
      const app = await this.loadApplication(tx, principal.accountId, id, true);
      if (!app) return failure('WAYVRO_E_NOT_FOUND');
      if (app.version !== input.expectedVersion || !EDITABLE_APPLICATION_STATES.has(app.state)) return failure('WAYVRO_E_CONFLICT');
      const cnic = input.cnic === undefined ? undefined : canonicalCnic(input.cnic);
      if (cnic === null) return failure('WAYVRO_E_VALIDATION');
      if (input.dateOfBirth !== undefined && !plausibleBirthDate(input.dateOfBirth, new Date())) return failure('WAYVRO_E_VALIDATION');
      if (input.serviceCategories && !(await this.enabledCategories(tx, input.serviceCategories))) return failure('WAYVRO_E_VALIDATION');
      const enc = (spec: (typeof ENCRYPTED_FIELDS)[keyof typeof ENCRYPTED_FIELDS], v: string) => this.cipher.encrypt(spec.keyClass, v, fieldContext(spec, id));
      await tx.query(
        `update compliance.driver_applications
            set legal_name_envelope = coalesce($3, legal_name_envelope),
                cnic_envelope = coalesce($4, cnic_envelope), cnic_last4 = coalesce($5, cnic_last4),
                date_of_birth_envelope = coalesce($6, date_of_birth_envelope),
                version = version + 1, updated_at = now()
          where id = $1 and version = $2`,
        [
          id,
          input.expectedVersion,
          input.legalName === undefined ? null : enc(ENCRYPTED_FIELDS.applicationLegalName, input.legalName.normalize('NFC')),
          cnic === undefined ? null : enc(ENCRYPTED_FIELDS.applicationCnic, cnic),
          cnic === undefined ? null : cnic.replaceAll('-', '').slice(-4),
          input.dateOfBirth === undefined ? null : enc(ENCRYPTED_FIELDS.applicationDob, input.dateOfBirth),
        ],
      );
      if (input.serviceCategories) {
        await tx.query(`delete from compliance.application_service_categories where application_id = $1`, [id]);
        for (const c of new Set(input.serviceCategories))
          await tx.query(`insert into compliance.application_service_categories (application_id, service_category) values ($1, $2)`, [id, c]);
      }
      const signals = cnic === undefined ? 0 : await this.indexCnic(tx, principal.accountId, id, cnic);
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'DRIVER_APPLICATION_CLAIMS_UPDATED',
        objectType: 'compliance.driver_application',
        objectId: id,
        outcome: 'SUCCESS',
        ...(signals > 0 ? { reasonCode: 'DUPLICATE_SIGNAL_RAISED' } : {}),
      });
      const fresh = await this.loadApplication(tx, principal.accountId, id);
      if (!fresh) throw new Error('application vanished');
      return success(200, await this.view(tx, principal.accountId, fresh));
    });
  }

  /** DRAFT → CONSENTED once both Driver/Partner policies are accepted (K14 consent before any identity capture). */
  async confirmConsent(principal: Principal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(principal, 'driver-onboarding.consent', key, { id }, async (tx) => {
      const app = await this.loadApplication(tx, principal.accountId, id, true);
      if (!app) return failure('WAYVRO_E_NOT_FOUND');
      if (!canTransition(app.state, 'CONSENTED', 'APPLICANT')) return failure('WAYVRO_E_CONFLICT');
      const pending = (await consentStatuses(tx, principal.accountId, new Date())).filter(
        (s) => DRIVER_POLICY_KEYS.includes(s.policyKey) && s.acceptanceRequired,
      );
      if (pending.length > 0) return failure('WAYVRO_E_POLICY_ACCEPTANCE_REQUIRED', { requiredActions: pending.map((p) => `ACCEPT_${p.policyKey}`) });
      await tx.query(`update compliance.driver_applications set state = 'CONSENTED', version = version + 1, updated_at = now() where id = $1`, [id]);
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'DRIVER_APPLICATION_CONSENTED',
        objectType: 'compliance.driver_application',
        objectId: id,
        outcome: 'SUCCESS',
      });
      const fresh = await this.loadApplication(tx, principal.accountId, id);
      if (!fresh) throw new Error('application vanished');
      return success(200, await this.view(tx, principal.accountId, fresh));
    });
  }

  async withdraw(principal: Principal, id: string, key: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      { scope: `acct:${principal.accountId}`, operation: 'driver-onboarding.withdraw', key, payload: { id }, ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS },
      async (tx) => {
        // Withdrawal stays possible under an account restriction or after a policy change (only the flag gates it).
        if (!this.available) return failure('WAYVRO_E_FEATURE_DISABLED');
        const app = await this.loadApplication(tx, principal.accountId, id, true);
        if (!app) return failure('WAYVRO_E_NOT_FOUND');
        if (!canTransition(app.state, 'WITHDRAWN', 'APPLICANT')) return failure('WAYVRO_E_CONFLICT');
        await tx.query(`update compliance.driver_applications set state = 'WITHDRAWN', version = version + 1, updated_at = now() where id = $1`, [id]);
        await tx.query(`update compliance.vehicle_affiliations set status = 'ENDED' where driver_application_id = $1 and status <> 'ENDED'`, [id]);
        await appendAudit(tx, {
          actor: { type: 'ACCOUNT', id: principal.accountId },
          action: 'DRIVER_APPLICATION_WITHDRAWN',
          objectType: 'compliance.driver_application',
          objectId: id,
          outcome: 'SUCCESS',
        });
        const fresh = await this.loadApplication(tx, principal.accountId, id);
        if (!fresh) throw new Error('application vanished');
        return success(200, await this.view(tx, principal.accountId, fresh));
      },
    );
  }

  async addVehicle(
    principal: Principal,
    id: string,
    input: {
      plate: string;
      make: string;
      model: string;
      modelYear: number;
      colour: string;
      serviceCategory: string;
      ownershipType: string;
      registrationNumber?: string | undefined;
    },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(principal, 'driver-onboarding.add-vehicle', key, { id, ...input }, async (tx) => {
      const app = await this.loadApplication(tx, principal.accountId, id, true);
      if (!app) return failure('WAYVRO_E_NOT_FOUND');
      if (!EDITABLE_APPLICATION_STATES.has(app.state)) return failure('WAYVRO_E_CONFLICT');
      const plate = normalisePlate(input.plate);
      if (plate === null || !(await this.enabledCategories(tx, [input.serviceCategory]))) return failure('WAYVRO_E_VALIDATION');
      // The vehicle row is serialised per plate: a concurrent creator of the same plate converges on one record.
      await tx.query(`select pg_advisory_xact_lock(hashtext('wayvro.vehicle.plate:' || $1))`, [plate]);
      const existing = await tx.query<{ id: string }>(`select id from compliance.vehicles where plate_normalised = $1 and status <> 'RETIRED'`, [plate]);
      let vehicleId = existing.rows[0]?.id;
      let relation: 'OWNER' | 'AUTHORISED_USER' = 'OWNER';
      if (!vehicleId) {
        vehicleId = uuidv7();
        const reg =
          input.registrationNumber === undefined
            ? null
            : this.cipher.encrypt(
                'identity_numbers',
                canonicalDocumentNumber(input.registrationNumber),
                fieldContext(ENCRYPTED_FIELDS.vehicleRegistrationNo, vehicleId),
              );
        await tx.query(
          `insert into compliance.vehicles (id, plate_normalised, plate_display, registration_no_envelope, make, model, model_year, colour, service_category, ownership_type, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE')`,
          [
            vehicleId,
            plate,
            input.plate.trim().toUpperCase(),
            reg,
            input.make,
            input.model,
            input.modelYear,
            input.colour,
            input.serviceCategory,
            input.ownershipType,
          ],
        );
      } else {
        relation = 'AUTHORISED_USER';
        const others = await tx.query<{ account_id: string }>(
          `select distinct coalesce(a.account_id, p.account_id) account_id
             from compliance.vehicle_affiliations va
             left join compliance.driver_applications a on a.id = va.driver_application_id
             left join compliance.driver_profiles p on p.id = va.driver_profile_id
            where va.vehicle_id = $1 and va.status <> 'ENDED'`,
          [vehicleId],
        );
        for (const o of others.rows) {
          if (o.account_id === principal.accountId) continue;
          await tx.query(
            `insert into compliance.duplicate_signals (id, signal, subject_application_id, subject_vehicle_id, matched_account_id, status) values ($1, 'PLATE_ALREADY_AFFILIATED', $2, $3, $4, 'OPEN') on conflict do nothing`,
            [uuidv7(), id, vehicleId, o.account_id],
          );
        }
      }
      await tx.query('savepoint affiliation');
      try {
        await tx.query(
          `insert into compliance.vehicle_affiliations (id, vehicle_id, driver_application_id, relation, status) values ($1, $2, $3, $4, 'PENDING')`,
          [uuidv7(), vehicleId, id, relation],
        );
      } catch (e) {
        if (sqlState(e) !== '23505') throw e;
        await tx.query('rollback to savepoint affiliation');
        return failure('WAYVRO_E_CONFLICT');
      }
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'DRIVER_VEHICLE_ADDED',
        objectType: 'compliance.vehicle',
        objectId: vehicleId,
        outcome: 'SUCCESS',
        reasonCode: relation === 'OWNER' ? 'NEW_VEHICLE' : 'EXISTING_PLATE',
      });
      return success(201, { vehicleId, relation });
    });
  }

  async updateVehicle(
    principal: Principal,
    id: string,
    vehicleId: string,
    input: {
      expectedVersion: number;
      make?: string | undefined;
      model?: string | undefined;
      modelYear?: number | undefined;
      colour?: string | undefined;
      ownershipType?: string | undefined;
    },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(principal, 'driver-onboarding.update-vehicle', key, { id, vehicleId, ...input }, async (tx) => {
      const app = await this.loadApplication(tx, principal.accountId, id, true);
      if (!app) return failure('WAYVRO_E_NOT_FOUND');
      const owned = await tx.query(
        `select 1 from compliance.vehicle_affiliations where vehicle_id = $1 and driver_application_id = $2 and relation = 'OWNER' and status <> 'ENDED'`,
        [vehicleId, id],
      );
      if (owned.rowCount === 0) return failure('WAYVRO_E_NOT_FOUND');
      if (!EDITABLE_APPLICATION_STATES.has(app.state)) return failure('WAYVRO_E_CONFLICT');
      const r = await tx.query(
        `update compliance.vehicles set make = coalesce($3, make), model = coalesce($4, model), model_year = coalesce($5, model_year), colour = coalesce($6, colour),
                ownership_type = coalesce($7, ownership_type), version = version + 1
          where id = $1 and version = $2`,
        [vehicleId, input.expectedVersion, input.make ?? null, input.model ?? null, input.modelYear ?? null, input.colour ?? null, input.ownershipType ?? null],
      );
      if (r.rowCount !== 1) return failure('WAYVRO_E_CONFLICT');
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'DRIVER_VEHICLE_UPDATED',
        objectType: 'compliance.vehicle',
        objectId: vehicleId,
        outcome: 'SUCCESS',
      });
      const fresh = await this.loadApplication(tx, principal.accountId, id);
      if (!fresh) throw new Error('application vanished');
      return success(200, await this.view(tx, principal.accountId, fresh));
    });
  }

  async claimDocument(
    principal: Principal,
    id: string,
    input: {
      documentType: string;
      vehicleId?: string | undefined;
      districtCode?: string | undefined;
      number?: string | undefined;
      licenceClass?: string | undefined;
      issuedOn?: string | undefined;
      expiresOn?: string | undefined;
    },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(principal, 'driver-onboarding.claim-document', key, { id, ...input }, async (tx) => {
      const app = await this.loadApplication(tx, principal.accountId, id, true);
      if (!app) return failure('WAYVRO_E_NOT_FOUND');
      if (!EDITABLE_APPLICATION_STATES.has(app.state)) return failure('WAYVRO_E_CONFLICT');
      const type = (
        await tx.query<{ subject: 'DRIVER' | 'VEHICLE' | 'DRIVER_VEHICLE'; has_number: boolean; has_expiry: boolean; per_district: boolean }>(
          `select subject, has_number, has_expiry, per_district from compliance.document_types where code = $1`,
          [input.documentType],
        )
      ).rows[0];
      if (!type) return failure('WAYVRO_E_VALIDATION');
      const needsVehicle = type.subject !== 'DRIVER';
      if (needsVehicle !== (input.vehicleId !== undefined) || type.per_district !== (input.districtCode !== undefined)) return failure('WAYVRO_E_VALIDATION');
      if ((input.number !== undefined && !type.has_number) || (input.expiresOn !== undefined && !type.has_expiry)) return failure('WAYVRO_E_VALIDATION');
      if (input.vehicleId !== undefined) {
        const aff = await tx.query(`select 1 from compliance.vehicle_affiliations where vehicle_id = $1 and driver_application_id = $2 and status <> 'ENDED'`, [
          input.vehicleId,
          id,
        ]);
        if (aff.rowCount === 0) return failure('WAYVRO_E_NOT_FOUND');
      }
      if (input.districtCode !== undefined) {
        const d = await tx.query(`select 1 from catalog.districts where code = $1 and city_code = $2 and status = 'ENABLED'`, [
          input.districtCode,
          app.city_code,
        ]);
        if (d.rowCount === 0) return failure('WAYVRO_E_VALIDATION');
      }
      const docId = uuidv7();
      const number = input.number === undefined ? null : canonicalDocumentNumber(input.number);
      if (number !== null && number.length < 2) return failure('WAYVRO_E_VALIDATION');
      // A re-claim supersedes the previous claim for the same item (history kept).
      const previous = await tx.query<{ id: string }>(
        `update compliance.compliance_documents set status = 'SUPERSEDED', version = version + 1
          where driver_application_id = $1 and document_type_code = $2 and vehicle_id is not distinct from $3 and district_code is not distinct from $4 and status = 'SUBMITTED'
          returning id`,
        [id, input.documentType, input.vehicleId ?? null, input.districtCode ?? null],
      );
      await tx.query(
        `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, vehicle_id, district_code, number_envelope, number_last4,
                                                     licence_class, claimed_issued_on, claimed_expires_on, status, supersedes_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'SUBMITTED', $12)`,
        [
          docId,
          input.documentType,
          type.subject,
          id,
          input.vehicleId ?? null,
          input.districtCode ?? null,
          number === null ? null : this.cipher.encrypt('identity_numbers', number, fieldContext(ENCRYPTED_FIELDS.documentNumber, docId)),
          number === null ? null : number.slice(-4),
          input.licenceClass ?? null,
          input.issuedOn ?? null,
          input.expiresOn ?? null,
          previous.rows[0]?.id ?? null,
        ],
      );
      const signals = number === null ? 0 : await this.indexDocumentNumber(tx, principal.accountId, docId, input.documentType, number);
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'DRIVER_DOCUMENT_CLAIMED',
        objectType: 'compliance.compliance_document',
        objectId: docId,
        outcome: 'SUCCESS',
        reasonCode: signals > 0 ? 'DUPLICATE_SIGNAL_RAISED' : input.documentType,
      });
      return success(201, { documentId: docId });
    });
  }

  /**
   * Document-number lookup (ACTIVE key) + DOCUMENT_NUMBER_MATCH signals against other accounts' live documents —
   * signals for human review, never rejections (K07). Returns the number of new signals.
   */
  private async indexDocumentNumber(tx: pg.PoolClient, accountId: string, docId: string, documentType: string, number: string): Promise<number> {
    const lookupValue = `${documentType}:${number}`;
    const active = this.hasher.active('document_lookup', lookupValue);
    await tx.query(`insert into compliance.document_number_lookup_index (compliance_document_id, lookup_key_version, lookup_hash) values ($1, $2, $3)`, [
      docId,
      active.version,
      active.digest,
    ]);
    const live = this.hasher.live('document_lookup', lookupValue);
    const matches = await tx.query<{ id: string }>(
      `select d.id from compliance.document_number_lookup_index l
         join compliance.compliance_documents d on d.id = l.compliance_document_id
         left join compliance.driver_applications a on a.id = d.driver_application_id
         left join compliance.driver_profiles p on p.id = d.driver_profile_id
        where (l.lookup_key_version, l.lookup_hash) in (select * from unnest($1::smallint[], $2::bytea[]))
          and d.id <> $3 and coalesce(a.account_id, p.account_id) is distinct from $4 and d.status <> 'SUPERSEDED'`,
      [live.map((d) => d.version), live.map((d) => d.digest), docId, accountId],
    );
    let signals = 0;
    for (const m of matches.rows) {
      const r = await tx.query(
        `insert into compliance.duplicate_signals (id, signal, subject_document_id, matched_document_id, status) values ($1, 'DOCUMENT_NUMBER_MATCH', $2, $3, 'OPEN') on conflict do nothing`,
        [uuidv7(), docId, m.id],
      );
      signals += r.rowCount ?? 0;
    }
    return signals;
  }

  /** The caller's verified driver profile with its application (renewals, compliance view). */
  private async profileOf(q: Queryable, accountId: string): Promise<{ id: string; state: string; application_id: string; city_code: string } | null> {
    const r = await q.query<{ id: string; state: string; application_id: string; city_code: string }>(
      `select p.id, p.state, p.application_id, a.city_code from compliance.driver_profiles p join compliance.driver_applications a on a.id = p.application_id where p.account_id = $1`,
      [accountId],
    );
    return r.rows[0] ?? null;
  }

  private async renewalView(q: Queryable, renewalId: string): Promise<Outcome> {
    const d = (
      await q.query<{
        id: string;
        driver_application_id: string;
        supersedes_id: string;
        document_type_code: string;
        status: string;
        evidence_kinds: string[];
        open_case: boolean;
      }>(
        `select d.id, d.driver_application_id, d.supersedes_id, d.document_type_code, d.status, t.evidence_kinds,
                exists (select 1 from compliance.review_cases c where c.compliance_document_id = d.id and c.status in ('OPEN', 'CLAIMED', 'ESCALATED')) open_case
           from compliance.compliance_documents d join compliance.document_types t on t.code = d.document_type_code where d.id = $1`,
        [renewalId],
      )
    ).rows[0];
    if (!d) throw new Error('renewal vanished');
    const status = d.status === 'VALID' ? 'APPROVED' : d.status === 'REJECTED' ? 'REJECTED' : d.open_case ? 'IN_REVIEW' : 'DRAFT';
    return success(200, {
      renewalDocumentId: d.id,
      applicationId: d.driver_application_id,
      renews: d.supersedes_id,
      documentType: d.document_type_code,
      evidenceKinds: d.evidence_kinds,
      status,
    });
  }

  /**
   * Renewal of a VALID or EXPIRED expiring document of a verified driver (D03/R02–R06): new claims on a new document row
   * that supersedes the old one only when a reviewer approves it; evidence follows through the application's upload
   * slots; one open renewal per document.
   */
  async startRenewal(
    principal: Principal,
    documentId: string,
    input: { number?: string | undefined; licenceClass?: string | undefined; issuedOn?: string | undefined; expiresOn: string },
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(principal, 'driver.document-renewal', key, { documentId, ...input }, async (tx) => {
      const profile = await this.profileOf(tx, principal.accountId);
      if (!profile) return failure('WAYVRO_E_NOT_FOUND');
      const old = (
        await tx.query<{
          id: string;
          document_type_code: string;
          subject: string;
          vehicle_id: string | null;
          district_code: string | null;
          status: string;
          has_expiry: boolean;
          has_number: boolean;
        }>(
          `select d.id, d.document_type_code, d.subject, d.vehicle_id, d.district_code, d.status, t.has_expiry, t.has_number
             from compliance.compliance_documents d join compliance.document_types t on t.code = d.document_type_code
            where d.id = $1 and d.driver_application_id = $2 for no key update of d`,
          [documentId, profile.application_id],
        )
      ).rows[0];
      if (!old) return failure('WAYVRO_E_NOT_FOUND');
      if (!old.has_expiry || (old.status !== 'VALID' && old.status !== 'EXPIRED')) return failure('WAYVRO_E_CONFLICT');
      if (input.number !== undefined && !old.has_number) return failure('WAYVRO_E_VALIDATION');
      if (input.expiresOn <= new Date().toISOString().slice(0, 10)) return failure('WAYVRO_E_VALIDATION');
      const open = await tx.query(`select 1 from compliance.compliance_documents where supersedes_id = $1 and status in ('SUBMITTED', 'UNDER_REVIEW')`, [
        documentId,
      ]);
      if ((open.rowCount ?? 0) > 0) return failure('WAYVRO_E_CONFLICT');
      const id = uuidv7();
      const number = input.number === undefined ? null : canonicalDocumentNumber(input.number);
      if (number !== null && number.length < 2) return failure('WAYVRO_E_VALIDATION');
      await tx.query(
        `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, vehicle_id, district_code, number_envelope, number_last4,
                                                     licence_class, claimed_issued_on, claimed_expires_on, status, supersedes_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'SUBMITTED', $12)`,
        [
          id,
          old.document_type_code,
          old.subject,
          profile.application_id,
          old.vehicle_id,
          old.district_code,
          number === null ? null : this.cipher.encrypt('identity_numbers', number, fieldContext(ENCRYPTED_FIELDS.documentNumber, id)),
          number === null ? null : number.slice(-4),
          input.licenceClass ?? null,
          input.issuedOn ?? null,
          input.expiresOn,
          documentId,
        ],
      );
      if (number !== null) await this.indexDocumentNumber(tx, principal.accountId, id, old.document_type_code, number);
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'DRIVER_DOCUMENT_RENEWAL_STARTED',
        objectType: 'compliance.compliance_document',
        objectId: id,
        outcome: 'SUCCESS',
        reasonCode: old.document_type_code,
      });
      const view = await this.renewalView(tx, id);
      return view.kind === 'success' ? success(201, view.body) : view;
    });
  }

  /** Submits a renewal for human review once every evidence kind of its type is ACCEPTED (DOCUMENT_RENEWAL case). */
  async submitRenewal(principal: Principal, renewalId: string, key: string): Promise<IdempotentResult> {
    const evidence = this.evidence;
    if (evidence === null) throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE');
    return this.run(principal, 'driver.document-renewal-submission', key, { renewalId }, async (tx) => {
      const profile = await this.profileOf(tx, principal.accountId);
      if (!profile) return failure('WAYVRO_E_NOT_FOUND');
      const doc = (
        await tx.query<{ id: string; status: string; supersedes_id: string | null; evidence_kinds: string[] }>(
          `select d.id, d.status, d.supersedes_id, t.evidence_kinds from compliance.compliance_documents d join compliance.document_types t on t.code = d.document_type_code
            where d.id = $1 and d.driver_application_id = $2 for no key update of d`,
          [renewalId, profile.application_id],
        )
      ).rows[0];
      if (!doc?.supersedes_id) return failure('WAYVRO_E_NOT_FOUND');
      if (doc.status !== 'SUBMITTED') return failure('WAYVRO_E_CONFLICT');
      const states = (await evidence.evidenceStates(profile.application_id)).filter((e) => e.documentId === renewalId);
      const missing = doc.evidence_kinds.filter((k) => !states.some((s) => s.kind === k && s.status === 'ACCEPTED')).map((k) => `MISSING_EVIDENCE_${k}`);
      if (states.some((s) => s.status === 'PROCESSING')) missing.push('EVIDENCE_PROCESSING');
      if (missing.length > 0) return failure('WAYVRO_E_CONFLICT', { reasonCodes: missing });
      await tx.query('savepoint renewal_case');
      try {
        await tx.query(
          `insert into compliance.review_cases (id, kind, driver_profile_id, compliance_document_id, city_code, priority, status) values ($1, 'DOCUMENT_RENEWAL', $2, $3, $4, 1, 'OPEN')`,
          [uuidv7(), profile.id, renewalId, profile.city_code],
        );
      } catch (e) {
        if (sqlState(e) !== '23505') throw e;
        await tx.query('rollback to savepoint renewal_case');
        return failure('WAYVRO_E_CONFLICT');
      }
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'DRIVER_DOCUMENT_RENEWAL_SUBMITTED',
        objectType: 'compliance.compliance_document',
        objectId: renewalId,
        outcome: 'SUCCESS',
      });
      return this.renewalView(tx, renewalId);
    });
  }

  /** Requirement checklist of the active set for the application's city and first category. */
  async requirements(principal: Principal, id: string): Promise<unknown> {
    if (!this.available) throw new WayvroError('WAYVRO_E_FEATURE_DISABLED');
    const app = await this.loadApplication(this.db, principal.accountId, id);
    if (!app) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const view = await this.view(this.db, principal.accountId, app);
    const category = view.serviceCategories[0];
    const set = (
      await this.db.query<{ id: string; version: number; is_placeholder: boolean }>(
        `select id, version, is_placeholder from compliance.requirement_sets where city_code = $1 and service_category = $2 and status = 'ACTIVE'`,
        [app.city_code, category ?? ''],
      )
    ).rows[0];
    if (!set) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const items = await this.db.query<{
      document_type_code: string;
      mandatory: boolean;
      subject: 'DRIVER' | 'VEHICLE' | 'DRIVER_VEHICLE';
      per_district: boolean;
      evidence_kinds: string[];
      applies_to_ownership_types: string[];
      licence_classes_allowed: string[];
      has_number: boolean;
      has_expiry: boolean;
    }>(
      `select i.document_type_code, i.mandatory, t.subject, t.per_district, t.evidence_kinds, i.applies_to_ownership_types, i.licence_classes_allowed,
              t.has_number, t.has_expiry
         from compliance.requirement_set_items i join compliance.document_types t on t.code = i.document_type_code
        where i.requirement_set_id = $1 order by i.mandatory desc, i.document_type_code`,
      [set.id],
    );
    const ownership = new Set(view.vehicles.map((v) => v.ownershipType));
    // per-district items take their district only from this server list (enabled districts of the application's city)
    const districts = await this.db.query<{ code: string; name_en: string; name_ur: string }>(
      `select code, name_en, name_ur from catalog.districts where city_code = $1 and status = 'ENABLED' order by code`,
      [app.city_code],
    );
    return {
      requirementSetId: set.id,
      districts: districts.rows.map((d) => ({ code: d.code, nameEn: d.name_en, nameUr: d.name_ur })),
      version: set.version,
      isPlaceholder: set.is_placeholder,
      items: items.rows.map((i) => ({
        documentType: i.document_type_code,
        mandatory: i.mandatory,
        subject: i.subject,
        perDistrict: i.per_district,
        applicable: i.applies_to_ownership_types.length === 0 || i.applies_to_ownership_types.some((o) => ownership.has(o as never)),
        claimed: view.documents.some((d) => d.documentType === i.document_type_code),
        evidenceKinds: i.evidence_kinds,
        licenceClassesAllowed: i.licence_classes_allowed,
        hasNumber: i.has_number,
        hasExpiry: i.has_expiry,
      })),
    };
  }

  /** Live eligibility for every (affiliated vehicle × granted or requested category) of the caller's driver profile. */
  async driverCompliance(principal: Principal): Promise<DriverCompliance> {
    const profile = (
      await this.db.query<{
        id: string;
        state: 'VERIFIED' | 'ACTIVE_ELIGIBLE' | 'EXPIRED' | 'REVERIFY_DUE';
        application_id: string;
        city_code: string;
        dob: Buffer;
      }>(
        `select p.id, p.state, p.application_id, a.city_code, p.verified_date_of_birth_envelope dob
           from compliance.driver_profiles p join compliance.driver_applications a on a.id = p.application_id where p.account_id = $1`,
        [principal.accountId],
      )
    ).rows[0];
    if (!profile) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const now = new Date();
    const restrictions = await restrictionsForAccount(this.db, principal.accountId);
    const vehicles = await this.db.query<{ id: string; ownership_type: string; service_category: string }>(
      `select v.id, v.ownership_type, v.service_category from compliance.vehicle_affiliations va join compliance.vehicles v on v.id = va.vehicle_id
        where (va.driver_profile_id = $1 or va.driver_application_id = $2) and va.status <> 'ENDED'`,
      [profile.id, profile.application_id],
    );
    const docs = await this.db.query<{
      id: string;
      document_type_code: string;
      vehicle_id: string | null;
      district_code: string | null;
      number_last4: string | null;
      licence_class: string | null;
      claimed_expires_on: string | null;
      expires_on: string | null;
      status: DocumentFact['status'];
      supersedes_id: string | null;
      open_case: boolean;
      has_number: boolean;
      has_expiry: boolean;
      evidence_kinds: string[];
      last_decision_id: string | null;
      last_decision: string | null;
      appeal_status: 'SUBMITTED' | 'UNDER_REVIEW' | 'UPHELD' | 'OVERTURNED' | 'WITHDRAWN' | null;
    }>(
      `select d.id, d.document_type_code, d.vehicle_id, d.district_code, d.number_last4, d.licence_class, to_char(d.claimed_expires_on, 'YYYY-MM-DD') claimed_expires_on,
              to_char(d.expires_on, 'YYYY-MM-DD') expires_on, d.status, d.supersedes_id, t.has_number, t.has_expiry, t.evidence_kinds,
              exists (select 1 from compliance.review_cases c where c.compliance_document_id = d.id and c.status in ('OPEN', 'CLAIMED', 'ESCALATED')) open_case,
              ld.id last_decision_id, ld.decision last_decision,
              (select ap.status from profile.appeals ap where ap.review_decision_id = ld.id order by ap.created_at desc limit 1) appeal_status
         from compliance.compliance_documents d join compliance.document_types t on t.code = d.document_type_code
         left join lateral (
           select rd.id, rd.decision from compliance.review_decisions rd join compliance.review_cases rc on rc.id = rd.review_case_id
            where rc.compliance_document_id = d.id order by rd.decided_at desc limit 1) ld on true
        where (d.driver_profile_id = $1 or d.driver_application_id = $2 or d.vehicle_id = any($3::uuid[])) and d.status <> 'SUPERSEDED'
        order by d.created_at`,
      [profile.id, profile.application_id, vehicles.rows.map((v) => v.id)],
    );
    // renewals in progress (or rejected) attach to the document they renew; they are not documents of their own yet
    const isRenewal = (d: (typeof docs.rows)[number]) =>
      d.supersedes_id !== null && (d.status === 'SUBMITTED' || d.status === 'UNDER_REVIEW' || d.status === 'REJECTED');
    const renewals = new Map(docs.rows.filter(isRenewal).map((d) => [d.supersedes_id, d]));
    const current = docs.rows.filter((d) => !isRenewal(d));
    const capabilities = await this.db.query<{ id: string; vehicle_id: string; service_category: string; city_code: string; status: 'GRANTED' | 'REVOKED' }>(
      `select id, vehicle_id, service_category, city_code, status from compliance.service_capabilities where driver_profile_id = $1`,
      [profile.id],
    );
    const age = await currentAgePolicy(this.db);
    const dob = this.cipher.decryptString('identity_dates', profile.dob, fieldContext(ENCRYPTED_FIELDS.profileDob, profile.id));
    const productionLike = this.policy.WAYVRO_ENV === 'production';
    const eligibility: DriverCompliance['eligibility'] = [];
    for (const v of vehicles.rows) {
      const category = v.service_category;
      const catRow = (await this.db.query<{ status: string }>(`select status from catalog.service_categories where code = $1`, [category])).rows[0];
      const set = (
        await this.db.query<{ id: string; is_placeholder: boolean }>(
          `select id, is_placeholder from compliance.requirement_sets where city_code = $1 and service_category = $2 and status = 'ACTIVE'`,
          [profile.city_code, category],
        )
      ).rows[0];
      const items = set
        ? (
            await this.db.query<{
              document_type_code: string;
              mandatory: boolean;
              applies_to_ownership_types: string[];
              licence_classes_allowed: string[];
              subject: RequirementItemFact['subject'];
            }>(
              `select i.document_type_code, i.mandatory, i.applies_to_ownership_types, i.licence_classes_allowed, t.subject
                 from compliance.requirement_set_items i join compliance.document_types t on t.code = i.document_type_code where i.requirement_set_id = $1`,
              [set.id],
            )
          ).rows
        : [];
      const cap =
        capabilities.rows.find(
          (c) => c.vehicle_id === v.id && c.service_category === category && c.city_code === profile.city_code && c.status === 'GRANTED',
        ) ?? null;
      const result = evaluateEarningEligibility({
        now,
        productionLike,
        accountActive: true,
        restrictions,
        profile: { id: profile.id, state: profile.state },
        vehicle: { id: v.id, ownershipType: v.ownership_type },
        cityCode: profile.city_code,
        serviceCategory: category,
        serviceCategoryEnabled: catRow?.status === 'ENABLED',
        capability: cap ? { id: cap.id, status: cap.status } : null,
        requirementSet: set
          ? {
              isPlaceholder: set.is_placeholder,
              items: items.map((i) => ({
                type: i.document_type_code,
                mandatory: i.mandatory,
                appliesToOwnershipTypes: i.applies_to_ownership_types,
                licenceClassesAllowed: i.licence_classes_allowed,
                subject: i.subject,
              })),
            }
          : null,
        documents: current.map((d) => ({
          type: d.document_type_code,
          status: d.status,
          expiresOn: d.expires_on,
          licenceClass: d.licence_class,
          vehicleId: d.vehicle_id,
        })),
        agePolicy: { status: age.status, driverMinimumAge: age.driverMinimumAge },
        driverDateOfBirth: dob,
      });
      eligibility.push({
        vehicleId: v.id,
        cityCode: profile.city_code,
        serviceCategory: category as 'CAR',
        eligible: result.eligible,
        blockers: [...result.blockers],
      });
    }
    const soon = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    return {
      profile: { id: profile.id, state: profile.state },
      eligibility,
      applicationId: profile.application_id,
      documents: current.map((d) => ({
        id: d.id,
        documentType: d.document_type_code,
        vehicleId: d.vehicle_id,
        districtCode: d.district_code,
        numberLast4: d.number_last4,
        licenceClass: d.licence_class,
        claimedExpiresOn: d.claimed_expires_on,
        status: d.status,
        expiresOn: d.expires_on,
        renewalDue: d.status === 'VALID' && d.expires_on !== null && d.expires_on <= soon,
        hasNumber: d.has_number,
        hasExpiry: d.has_expiry,
        renewal: (() => {
          const r = renewals.get(d.id);
          if (!r) return null;
          const status = r.status === 'REJECTED' ? ('REJECTED' as const) : r.open_case ? ('IN_REVIEW' as const) : ('DRAFT' as const);
          // a renewal rejected by a REJECT decision is appealable (Phase-2 closure); NEEDS_INFO means start a new renewal
          const appealable = r.status === 'REJECTED' && r.last_decision === 'REJECT' && r.appeal_status === null;
          return {
            renewalDocumentId: r.id,
            status,
            evidenceKinds: r.evidence_kinds,
            appealableDecisionId: appealable ? r.last_decision_id : null,
            appealStatus: r.appeal_status,
          };
        })(),
      })),
      restrictions: restrictions.filter((r) => inForce(r, now)).map(accountView),
    };
  }

  /** Runs `work` behind the onboarding gates in an idempotent, account-scoped transaction (used by the vault module). */
  gated(principal: Principal, operation: string, key: string, payload: unknown, work: (tx: pg.PoolClient) => Promise<Outcome>): Promise<IdempotentResult> {
    return this.run(principal, operation, key, payload, work);
  }

  /**
   * Evidence-slot preconditions in the caller's transaction (P2.6): the application is the caller's and editable after
   * consent (the first slot moves CONSENTED → DOCUMENTS_PENDING), the document claim belongs to it and its type lists
   * the evidence kind. Returns a failure code, or the application's city.
   */
  async prepareEvidence(
    tx: pg.PoolClient,
    accountId: string,
    applicationId: string,
    documentId: string,
    kind: string,
  ): Promise<{ readonly failure: ErrorCode } | { readonly failure: null; readonly cityCode: string }> {
    const app = await this.loadApplication(tx, accountId, applicationId, true);
    if (!app) return { failure: 'WAYVRO_E_NOT_FOUND' };
    const doc = (
      await tx.query<{ evidence_kinds: string[]; supersedes_id: string | null; open_case: boolean }>(
        `select t.evidence_kinds, d.supersedes_id,
                exists (select 1 from compliance.review_cases c where c.compliance_document_id = d.id and c.status in ('OPEN', 'CLAIMED', 'ESCALATED')) open_case
           from compliance.compliance_documents d join compliance.document_types t on t.code = d.document_type_code
          where d.id = $1 and d.driver_application_id = $2 and d.status = 'SUBMITTED'`,
        [documentId, applicationId],
      )
    ).rows[0];
    // a verified driver uploads evidence only for a renewal that is not yet under review (P2.8)
    const renewal = app.state === 'VERIFIED' && doc !== undefined && doc.supersedes_id !== null && !doc.open_case;
    if (!renewal && (!EDITABLE_APPLICATION_STATES.has(app.state) || app.state === 'DRAFT')) return { failure: 'WAYVRO_E_CONFLICT' };
    if (!doc) return { failure: 'WAYVRO_E_NOT_FOUND' };
    if (!doc.evidence_kinds.includes(kind)) return { failure: 'WAYVRO_E_VALIDATION' };
    if (canTransition(app.state, 'DOCUMENTS_PENDING', 'APPLICANT')) {
      await tx.query(`update compliance.driver_applications set state = 'DOCUMENTS_PENDING', version = version + 1, updated_at = now() where id = $1`, [
        applicationId,
      ]);
    }
    return { failure: null, cityCode: app.city_code };
  }

  /** Whether the owner may still discard evidence of this document: the application is editable, or it is an open renewal. */
  async evidenceEditable(accountId: string, applicationId: string, documentId: string): Promise<boolean> {
    const r = await this.db.query<{ state: ApplicationState; supersedes_id: string | null; status: string; open_case: boolean }>(
      `select a.state, d.supersedes_id, d.status,
              exists (select 1 from compliance.review_cases c where c.compliance_document_id = d.id and c.status in ('OPEN', 'CLAIMED', 'ESCALATED')) open_case
         from compliance.driver_applications a join compliance.compliance_documents d on d.driver_application_id = a.id
        where a.id = $1 and a.account_id = $2 and d.id = $3`,
      [applicationId, accountId, documentId],
    );
    const row = r.rows[0];
    if (!row) return false;
    if (row.state === 'VERIFIED') return row.supersedes_id !== null && row.status === 'SUBMITTED' && !row.open_case;
    return EDITABLE_APPLICATION_STATES.has(row.state) && row.state !== 'DRAFT';
  }

  private async issueChallengeIn(tx: pg.PoolClient, applicationId: string, exclude: ReadonlySet<string>): Promise<CaptureChallenge | null> {
    const candidates = CAPTURE_CHALLENGE_CODES.filter((c) => !exclude.has(c));
    const code = candidates[randomInt(candidates.length || 1)];
    if (code === undefined) return null;
    const id = uuidv7();
    const r = await tx.query<{ expires_at: Date }>(
      `insert into compliance.capture_challenges (id, application_id, challenge_code, status, expires_at)
       values ($1, $2, $3, 'ISSUED', now() + ($4::int * interval '1 second')) returning expires_at`,
      [id, applicationId, code, this.policy.CAPTURE_CHALLENGE_TTL_SECONDS],
    );
    const expiresAt = r.rows[0]?.expires_at;
    if (!expiresAt) throw new Error('capture challenge insert returned no row');
    return { challengeId: id, challengeCode: code, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Optional, accessible selfie capture challenge (KYC doc §2.2): an anti-replay aid for MANUAL review, never liveness
   * and never required. A new request replaces the live challenge.
   */
  async issueCaptureChallenge(principal: Principal, id: string, key: string): Promise<IdempotentResult> {
    return this.run(principal, 'driver-onboarding.capture-challenge', key, { id }, async (tx) => {
      const app = await this.loadApplication(tx, principal.accountId, id, true);
      if (!app) return failure('WAYVRO_E_NOT_FOUND');
      if (!EDITABLE_APPLICATION_STATES.has(app.state) || app.state === 'DRAFT') return failure('WAYVRO_E_CONFLICT');
      const replaced = await tx.query<{ challenge_code: string }>(
        `update compliance.capture_challenges set status = 'REPLACED' where application_id = $1 and status = 'ISSUED' returning challenge_code`,
        [id],
      );
      const challenge = await this.issueChallengeIn(tx, id, new Set(replaced.rows.map((r) => r.challenge_code)));
      if (!challenge) throw new Error('no capture challenge available');
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'CAPTURE_CHALLENGE_ISSUED',
        objectType: 'compliance.capture_challenge',
        objectId: challenge.challengeId,
        outcome: 'SUCCESS',
      });
      return success(201, challenge);
    });
  }

  /**
   * "I can't do this one" → REPLACE with a challenge not yet offered on this application; "None of these work for me"
   * (or no alternative left) → DECLINED_ACCESSIBILITY, shown to the reviewer as neutral information. Never a rejection.
   */
  async declineCaptureChallenge(
    principal: Principal,
    id: string,
    challengeId: string,
    choice: 'REPLACE' | 'NONE_ACCESSIBLE',
    key: string,
  ): Promise<IdempotentResult> {
    return this.run(principal, 'driver-onboarding.capture-challenge-decline', key, { id, challengeId, choice }, async (tx) => {
      const app = await this.loadApplication(tx, principal.accountId, id, true);
      if (!app) return failure('WAYVRO_E_NOT_FOUND');
      const live = await tx.query(`select 1 from compliance.capture_challenges where id = $1 and application_id = $2 and status = 'ISSUED'`, [challengeId, id]);
      if (live.rowCount === 0) return failure('WAYVRO_E_NOT_FOUND');
      if (!EDITABLE_APPLICATION_STATES.has(app.state)) return failure('WAYVRO_E_CONFLICT');
      let replacement: CaptureChallenge | null = null;
      if (choice === 'REPLACE') {
        await tx.query(`update compliance.capture_challenges set status = 'REPLACED' where id = $1`, [challengeId]);
        const offered = await tx.query<{ challenge_code: string }>(`select challenge_code from compliance.capture_challenges where application_id = $1`, [id]);
        replacement = await this.issueChallengeIn(tx, id, new Set(offered.rows.map((r) => r.challenge_code)));
      }
      if (replacement === null) await tx.query(`update compliance.capture_challenges set status = 'DECLINED_ACCESSIBILITY' where id = $1`, [challengeId]);
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'CAPTURE_CHALLENGE_DECLINED',
        objectType: 'compliance.capture_challenge',
        objectId: challengeId,
        outcome: 'SUCCESS',
        reasonCode: replacement ? 'REPLACED' : 'ACCESSIBILITY',
      });
      return success(200, { status: replacement ? 'REPLACED' : 'DECLINED_ACCESSIBILITY', replacement });
    });
  }

  /**
   * DOCUMENTS_PENDING | NEEDS_INFO → SUBMITTED once every mandatory, applicable item of the ACTIVE requirement set has a
   * document claim and ACCEPTED evidence of every kind its type lists; pins the set. Missing items are itemised as
   * reason codes. Review is always human (P2.7); nothing here decides an application.
   */
  async submit(principal: Principal, id: string, expectedVersion: number, key: string): Promise<IdempotentResult> {
    const evidence = this.evidence;
    if (evidence === null) throw new WayvroError('WAYVRO_E_DEPENDENCY_UNAVAILABLE');
    return this.run(principal, 'driver-onboarding.submit', key, { id, expectedVersion }, async (tx) => {
      const app = await this.loadApplication(tx, principal.accountId, id, true);
      if (!app) return failure('WAYVRO_E_NOT_FOUND');
      if (app.version !== expectedVersion || !canTransition(app.state, 'SUBMITTED', 'APPLICANT')) return failure('WAYVRO_E_CONFLICT');
      const view = await this.view(tx, principal.accountId, app);
      const set = (
        await tx.query<{ id: string }>(`select id from compliance.requirement_sets where city_code = $1 and service_category = $2 and status = 'ACTIVE'`, [
          app.city_code,
          view.serviceCategories[0] ?? '',
        ])
      ).rows[0];
      if (!set) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['NO_ACTIVE_REQUIREMENT_SET'] });
      const items = await tx.query<{ document_type_code: string; evidence_kinds: string[]; applies_to_ownership_types: string[] }>(
        `select i.document_type_code, t.evidence_kinds, i.applies_to_ownership_types
           from compliance.requirement_set_items i join compliance.document_types t on t.code = i.document_type_code
          where i.requirement_set_id = $1 and i.mandatory order by i.document_type_code`,
        [set.id],
      );
      const ownership = new Set<string>(view.vehicles.map((v) => v.ownershipType));
      const states = await evidence.evidenceStates(id);
      const missing: string[] = [];
      if (states.some((s) => s.status === 'PROCESSING')) missing.push('EVIDENCE_PROCESSING');
      for (const item of items.rows) {
        if (item.applies_to_ownership_types.length > 0 && !item.applies_to_ownership_types.some((o) => ownership.has(o))) continue;
        const docs = view.documents.filter((d) => d.documentType === item.document_type_code && d.status === 'SUBMITTED').map((d) => d.id);
        if (docs.length === 0) {
          missing.push(`MISSING_DOCUMENT_${item.document_type_code}`);
          continue;
        }
        for (const kind of item.evidence_kinds) {
          if (!states.some((s) => docs.includes(s.documentId) && s.kind === kind && s.status === 'ACCEPTED')) missing.push(`MISSING_EVIDENCE_${kind}`);
        }
      }
      if (missing.length > 0) return failure('WAYVRO_E_CONFLICT', { reasonCodes: [...new Set(missing)] });
      await tx.query(
        `update compliance.driver_applications set state = 'SUBMITTED', requirement_set_id = $2, submitted_at = now(), version = version + 1, updated_at = now() where id = $1`,
        [id, set.id],
      );
      // intake (worker): SUBMITTED → AUTO_CHECK_PENDING → MANUAL_REVIEW + a human review case; nothing decides automatically
      await enqueueJob(tx, { type: 'driver-application.intake', payload: { applicationId: id }, maxAttempts: 8 });
      await emitEvent(tx, {
        type: 'driver.application.submitted.v1',
        aggregateType: 'compliance.driver_application',
        aggregateId: id,
        accountId: principal.accountId,
      });
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'DRIVER_APPLICATION_SUBMITTED',
        objectType: 'compliance.driver_application',
        objectId: id,
        outcome: 'SUCCESS',
      });
      const fresh = await this.loadApplication(tx, principal.accountId, id);
      if (!fresh) throw new Error('application vanished');
      return success(200, await this.view(tx, principal.accountId, fresh));
    });
  }
}
