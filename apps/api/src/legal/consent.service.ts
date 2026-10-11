/**
 * Consent, policy acceptance and age declarations (A04, R09, K14 consent infrastructure, A15 signup mechanism;
 * data model §7). Evidence rows are append-only and bound by foreign keys to the exact policy text hash and the age
 * policy's declaration mode. Server time decides which version is current.
 *
 * Required actions (computed, never stored):
 *  - ACCEPT_POLICIES — a policy required for ACCOUNT use has no acceptance in force: never accepted, the latest action
 *    is DECLINED/WITHDRAWN, or a MATERIAL change was published after the accepted version. A non-material change is
 *    communicated (change summary) but does not force re-acceptance.
 *  - AGE_DECLARATION — the current age policy's mode is not NONE and the account has no declaration for that version.
 * Under-age outcomes (an AGE_POLICY restriction) are evaluated with the restriction model (P2.5).
 */
import type { AgeDeclarationRecorded, AgeDeclarationRequest, ConsentRecorded, ConsentRequest, ConsentStatusList, PolicyKey } from '@wayvro/contracts';
import type { FieldCipher } from '@wayvro/field-crypto';
import { ENCRYPTED_FIELDS, fieldContext } from '@wayvro/identity-core';
import { currentDocument, policyDocument, publishedDocuments } from '@wayvro/legal-content';
import { currentContext } from '@wayvro/observability';
import { appendAudit, uuidv7, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { Principal } from '../auth/policy.js';
import type { ApiConfig } from '../config.js';
import { failure, success, type IdempotencyStore, type IdempotentResult } from '../platform/idempotency.js';
import { currentAgePolicy } from './age-policy.js';

export type RequiredAction = 'ACCEPT_POLICIES' | 'AGE_DECLARATION';
type ConsentAction = ConsentRequest['action'];

/** Policies whose acceptance is tracked (requiredFor non-empty), with their version history (locale-independent). */
function trackedPolicies(): ReadonlyArray<{
  key: PolicyKey;
  requiredFor: readonly ('ACCOUNT' | 'DRIVER_APPLICATION')[];
  versions: ReadonlyArray<{ version: number; material: boolean }>;
}> {
  const byKey = new Map<PolicyKey, { requiredFor: readonly ('ACCOUNT' | 'DRIVER_APPLICATION')[]; versions: { version: number; material: boolean }[] }>();
  for (const d of publishedDocuments()) {
    if (d.locale !== 'en' || d.requiredFor.length === 0) continue;
    const entry = byKey.get(d.key) ?? { requiredFor: d.requiredFor, versions: [] };
    entry.versions.push({ version: d.version, material: d.materialChange });
    byKey.set(d.key, entry);
  }
  return [...byKey.entries()].map(([key, v]) => ({ key, ...v }));
}

/** Acceptance status of every tracked policy for an account at `now`. */
export async function consentStatuses(q: Queryable, accountId: string, now: Date): Promise<ConsentStatusList['policies']> {
  const latest = await q.query<{ policy_key: PolicyKey; policy_version: number; action: ConsentAction }>(
    `select distinct on (policy_key) policy_key, policy_version, action
       from identity.consent_records where account_id = $1
      order by policy_key, recorded_at desc, id desc`,
    [accountId],
  );
  const byKey = new Map(latest.rows.map((r) => [r.policy_key, r]));
  const out: ConsentStatusList['policies'][number][] = [];
  for (const p of trackedPolicies()) {
    const current = currentDocument(p.key, 'en', now);
    if (!current) continue;
    const last = byKey.get(p.key);
    const acceptedVersion = last?.action === 'ACCEPTED' ? last.policy_version : null;
    const acceptanceRequired = acceptedVersion === null || p.versions.some((v) => v.version > acceptedVersion && v.version <= current.version && v.material);
    out.push({
      policyKey: p.key,
      requiredFor: [...p.requiredFor],
      currentVersion: current.version,
      acceptedVersion,
      lastAction: last?.action ?? null,
      acceptanceRequired,
    });
  }
  return out;
}

/** Required actions of an account (policies + age declaration), evaluated on server time. */
export async function requiredActionsFor(q: Queryable, accountId: string, now: Date = new Date()): Promise<RequiredAction[]> {
  const actions: RequiredAction[] = [];
  const statuses = await consentStatuses(q, accountId, now);
  if (statuses.some((s) => s.requiredFor.includes('ACCOUNT') && s.acceptanceRequired)) actions.push('ACCEPT_POLICIES');
  const age = await currentAgePolicy(q);
  if (age.riderDeclarationMode !== 'NONE') {
    const declared = await q.query(`select 1 from identity.age_declarations where account_id = $1 and policy_version = $2`, [accountId, age.version]);
    if (declared.rowCount === 0) actions.push('AGE_DECLARATION');
  }
  return actions;
}

/** Parses an ISO calendar date that is a plausible past date of birth (not in the future, not before 1900). */
function plausibleDateOfBirth(iso: string, now: Date): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return !Number.isNaN(t) && t <= now.getTime() && t >= Date.parse('1900-01-01T00:00:00Z');
}

export class ConsentService {
  constructor(
    private readonly db: pg.Pool,
    private readonly cipher: FieldCipher,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: ApiConfig,
  ) {}

  async status(principal: Principal): Promise<ConsentStatusList> {
    return { policies: await consentStatuses(this.db, principal.accountId, new Date()) };
  }

  async record(principal: Principal, input: ConsentRequest, idempotencyKey: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      {
        scope: `acct:${principal.accountId}`,
        operation: 'account-consents.record',
        key: idempotencyKey,
        payload: input,
        ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const now = new Date();
        const doc = policyDocument(input.policyKey, input.version, input.locale);
        // Only policies that require acceptance take consent actions; disclosures are read, not accepted.
        if (!doc || doc.requiredFor.length === 0) return failure('WAYVRO_E_VALIDATION');
        const current = currentDocument(input.policyKey, input.locale, now);
        // Only the CURRENT version can be acted on, and only with its exact text hash (a stale client must reload).
        if (current?.version !== input.version || doc.contentSha256 !== input.contentSha256) return failure('WAYVRO_E_CONFLICT');
        const id = uuidv7();
        const r = await tx.query<{ recorded_at: Date }>(
          `insert into identity.consent_records (id, account_id, policy_key, policy_version, locale, content_sha256, action, surface, session_id, app_version, request_id)
           select $1, $2, $3, $4, $5, $6, $7, 'MOBILE_APP', s.id, s.app_version, $9 from identity.sessions s where s.id = $8
           returning recorded_at`,
          [
            id,
            principal.accountId,
            input.policyKey,
            input.version,
            input.locale,
            Buffer.from(input.contentSha256, 'hex'),
            input.action,
            principal.sessionId,
            requestIdOrNull(),
          ],
        );
        const recordedAt = r.rows[0]?.recorded_at;
        if (!recordedAt) throw new Error('consent insert returned no row');
        await appendAudit(tx, {
          actor: { type: 'ACCOUNT', id: principal.accountId },
          action: 'CONSENT_RECORDED',
          objectType: 'identity.consent_record',
          objectId: id,
          outcome: 'SUCCESS',
          reasonCode: input.action,
        });
        const body: ConsentRecorded = {
          id,
          policyKey: input.policyKey,
          version: input.version,
          locale: input.locale,
          action: input.action,
          recordedAt: recordedAt.toISOString(),
          requiredActions: await requiredActionsFor(tx, principal.accountId, now),
        };
        return success(201, body);
      },
    );
  }

  async declareAge(principal: Principal, input: AgeDeclarationRequest, idempotencyKey: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      {
        scope: `acct:${principal.accountId}`,
        operation: 'account-age-declarations.record',
        key: idempotencyKey,
        payload: input,
        ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const now = new Date();
        const age = await currentAgePolicy(tx);
        if (input.policyVersion !== age.version) return failure('WAYVRO_E_CONFLICT');
        // The declaration's shape must be exactly what the policy mode requires: a DOB is accepted ONLY in DOB mode.
        const mode = age.riderDeclarationMode;
        if (mode === 'NONE') return failure('WAYVRO_E_VALIDATION');
        if (mode === 'AFFIRM_MINIMUM_AGE' && input.affirmed !== true) return failure('WAYVRO_E_VALIDATION');
        if (mode === 'DATE_OF_BIRTH_REQUIRED' && (input.dateOfBirth === undefined || !plausibleDateOfBirth(input.dateOfBirth, now)))
          return failure('WAYVRO_E_VALIDATION');
        const exists = await tx.query(`select 1 from identity.age_declarations where account_id = $1 and policy_version = $2`, [
          principal.accountId,
          age.version,
        ]);
        if (exists.rowCount !== 0) return failure('WAYVRO_E_CONFLICT');
        const id = uuidv7();
        const dob =
          mode === 'DATE_OF_BIRTH_REQUIRED' && input.dateOfBirth
            ? this.cipher.encrypt('identity_dates', input.dateOfBirth, fieldContext(ENCRYPTED_FIELDS.ageDeclarationDob, id))
            : null;
        const r = await tx.query<{ recorded_at: Date }>(
          `insert into identity.age_declarations (id, account_id, policy_version, declaration_mode, affirmed, dob_envelope, session_id)
           values ($1, $2, $3, $4, $5, $6, $7) returning recorded_at`,
          [id, principal.accountId, age.version, mode, mode === 'AFFIRM_MINIMUM_AGE' ? true : null, dob, principal.sessionId],
        );
        const recordedAt = r.rows[0]?.recorded_at;
        if (!recordedAt) throw new Error('age declaration insert returned no row');
        await appendAudit(tx, {
          actor: { type: 'ACCOUNT', id: principal.accountId },
          action: 'AGE_DECLARATION_RECORDED',
          objectType: 'identity.age_declaration',
          objectId: id,
          outcome: 'SUCCESS',
          reasonCode: mode,
        });
        const body: AgeDeclarationRecorded = {
          id,
          policyVersion: age.version,
          declarationMode: mode,
          recordedAt: recordedAt.toISOString(),
          requiredActions: await requiredActionsFor(tx, principal.accountId, now),
        };
        return success(201, body);
      },
    );
  }
}

function requestIdOrNull(): string | null {
  const id = currentContext()?.requestId;
  return id !== undefined && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}
