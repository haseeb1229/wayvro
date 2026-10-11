/**
 * Evidence vault — applicant side (K02, K11, D02, Q36; KYC doc §4; ADR-041). This module is the ONLY holder of the
 * `wayvro_vault` connection pool; the rest of the API cannot read `vault.*` (database grants, not convention).
 *
 * Slot → the device PUTs the bytes to QUARANTINE with a short-lived, single-object URL whose type and length are signed
 * → completion checks the stored object (HEAD) and enqueues `evidence.process` in the same vault transaction → the
 * worker scans, sanitises in isolation, hashes, encrypts and moves the object to the vault. Declared MIME and
 * `capture_source` never drive a decision. No response contains a storage key except inside the upload URL itself.
 */
import { randomBytes } from 'node:crypto';
import { isFlagEnabled, type WayvroEnv } from '@wayvro/config';
import type { EvidenceUploadStatus } from '@wayvro/contracts';
import { WayvroError } from '@wayvro/observability';
import type { ObjectStoragePort } from '@wayvro/provider-interfaces';
import { appendAudit, enqueueJob, uuidv7, withTransaction, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { EvidenceState, EvidenceSummaryPort, OnboardingService } from '../compliance/onboarding.service.js';
import { failure, success, type IdempotencyStore, type IdempotentResult } from '../platform/idempotency.js';

const EVIDENCE_PROCESS_JOB = 'evidence.process';

export interface EvidencePolicy {
  readonly WAYVRO_ENV: WayvroEnv;
  readonly IDEMPOTENCY_TTL_SECONDS: number;
  readonly EVIDENCE_SLOT_TTL_SECONDS: number;
  readonly EVIDENCE_UPLOAD_URL_SECONDS: number;
  readonly EVIDENCE_MAX_PER_APPLICATION: number;
  readonly EVIDENCE_SLOTS_PER_10_MIN: number;
}

interface Principal {
  readonly accountId: string;
  readonly sessionId: string;
}

type EvidenceStatus = 'SLOT_ISSUED' | 'UPLOADED' | 'AVAILABLE' | 'REJECTED_FORMAT' | 'REJECTED_MALWARE' | 'REJECTED_LIMITS' | 'EXPIRED' | 'DISCARDED';

interface EvidenceRow {
  id: string;
  owner_account_id: string;
  driver_application_id: string;
  compliance_document_id: string;
  kind: EvidenceUploadStatus['kind'];
  capture_source: EvidenceUploadStatus['captureSource'];
  status: EvidenceStatus;
  rejection_reason: 'UNSUPPORTED_FORMAT' | 'UNREADABLE' | 'TOO_LARGE' | 'LIMITS' | 'MALWARE' | null;
  quarantine_key: string;
  vault_key: string | null;
  declared_byte_size: number;
  declared_mime: string;
  slot_expires_at: Date;
  created_at: Date;
}

const COLUMNS = `id, owner_account_id, driver_application_id, compliance_document_id, kind, capture_source, status, rejection_reason, quarantine_key,
  vault_key, declared_byte_size, declared_mime, slot_expires_at, created_at`;
const EDITABLE = new Set(['CONSENTED', 'DOCUMENTS_PENDING', 'NEEDS_INFO']);

/** Internal pipeline state → what the applicant can act on (never the scanner's signature name). */
function publicStatus(row: Pick<EvidenceRow, 'status' | 'rejection_reason'>): Pick<EvidenceUploadStatus, 'status' | 'rejectionReason'> {
  switch (row.status) {
    case 'SLOT_ISSUED':
      return { status: 'AWAITING_UPLOAD', rejectionReason: null };
    case 'UPLOADED':
      return { status: 'PROCESSING', rejectionReason: null };
    case 'AVAILABLE':
      return { status: 'ACCEPTED', rejectionReason: null };
    case 'EXPIRED':
      return { status: 'EXPIRED', rejectionReason: null };
    case 'DISCARDED':
      return { status: 'DISCARDED', rejectionReason: null };
    default: {
      const reasons = {
        UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
        UNREADABLE: 'UNREADABLE',
        TOO_LARGE: 'TOO_LARGE',
        LIMITS: 'TOO_LARGE',
        MALWARE: 'SECURITY_CHECK_FAILED',
      } as const;
      return { status: 'REJECTED', rejectionReason: reasons[row.rejection_reason ?? 'UNREADABLE'] };
    }
  }
}

const view = (row: EvidenceRow): EvidenceUploadStatus => ({
  uploadId: row.id,
  documentId: row.compliance_document_id,
  kind: row.kind,
  captureSource: row.capture_source,
  ...publicStatus(row),
  createdAt: row.created_at.toISOString(),
});

export class EvidenceService {
  constructor(
    private readonly vault: pg.Pool,
    private readonly storage: ObjectStoragePort,
    private readonly onboarding: OnboardingService,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: EvidencePolicy,
  ) {}

  private assertAvailable(): void {
    if (!isFlagEnabled('driver.onboarding', this.policy.WAYVRO_ENV)) throw new WayvroError('WAYVRO_E_FEATURE_DISABLED');
  }

  /** Issues an upload slot (idempotent: a replay returns the same slot and URL). */
  async issueSlot(
    principal: Principal,
    applicationId: string,
    input: {
      documentId: string;
      kind: EvidenceUploadStatus['kind'];
      captureSource: EvidenceUploadStatus['captureSource'];
      byteSize: number;
      mime: string;
      challengeId?: string | undefined;
    },
    key: string,
  ): Promise<IdempotentResult> {
    this.assertAvailable();
    return this.onboarding.gated(principal, 'driver-onboarding.evidence-slot', key, { applicationId, ...input }, async (tx) => {
      // integrity aid (not a security proof): the selfie slot is camera-only; a challenge belongs to a selfie only
      if (input.kind === 'SELFIE_FOR_MANUAL_REVIEW' ? input.captureSource !== 'IN_APP_CAMERA' : input.challengeId !== undefined) {
        return failure('WAYVRO_E_VALIDATION');
      }
      const prepared = await this.onboarding.prepareEvidence(tx, principal.accountId, applicationId, input.documentId, input.kind);
      if (prepared.failure !== null) return failure(prepared.failure);
      const id = uuidv7();
      const quarantineKey = `q/${randomBytes(16).toString('hex')}`;
      const slot = await withTransaction(this.vault, async (vtx) => {
        const counts = (
          await vtx.query<{ per_app: string; recent: string }>(
            `select count(*) filter (where driver_application_id = $1 and status not in ('DISCARDED', 'EXPIRED')) per_app,
                    count(*) filter (where created_at > now() - interval '10 minutes') recent
               from vault.evidence_objects where owner_account_id = $2`,
            [applicationId, principal.accountId],
          )
        ).rows[0];
        if (Number(counts?.per_app ?? 0) >= this.policy.EVIDENCE_MAX_PER_APPLICATION) return { refused: 'WAYVRO_E_CONFLICT' as const };
        if (Number(counts?.recent ?? 0) >= this.policy.EVIDENCE_SLOTS_PER_10_MIN) return { refused: 'WAYVRO_E_RATE_LIMITED' as const };
        const r = await vtx.query<{ slot_expires_at: Date }>(
          `insert into vault.evidence_objects (id, owner_account_id, driver_application_id, compliance_document_id, kind, capture_source, declared_mime,
                                               declared_byte_size, status, quarantine_key, slot_expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'SLOT_ISSUED', $9, now() + ($10::int * interval '1 second')) returning slot_expires_at`,
          [
            id,
            principal.accountId,
            applicationId,
            input.documentId,
            input.kind,
            input.captureSource,
            input.mime,
            input.byteSize,
            quarantineKey,
            this.policy.EVIDENCE_SLOT_TTL_SECONDS,
          ],
        );
        if (input.challengeId !== undefined) {
          const used = await vtx.query(
            `update compliance.capture_challenges set status = 'USED', used_by_evidence_id = $1
              where id = $2 and application_id = $3 and status = 'ISSUED' and expires_at > now()`,
            [id, input.challengeId, applicationId],
          );
          if (used.rowCount !== 1) return { refused: 'WAYVRO_E_CONFLICT' as const };
        }
        const expires = r.rows[0]?.slot_expires_at;
        if (!expires) throw new Error('evidence slot insert returned no row');
        return { refused: null, slotExpiresAt: expires };
      });
      if (slot.refused !== null) return failure(slot.refused);
      const upload = await this.storage.createUploadUrl({
        key: quarantineKey,
        contentType: input.mime,
        contentLength: input.byteSize,
        expiresInSeconds: this.policy.EVIDENCE_UPLOAD_URL_SECONDS,
      });
      await appendAudit(tx, {
        actor: { type: 'ACCOUNT', id: principal.accountId },
        action: 'EVIDENCE_SLOT_ISSUED',
        objectType: 'vault.evidence_object',
        objectId: id,
        outcome: 'SUCCESS',
        reasonCode: input.kind,
      });
      return success(201, {
        uploadId: id,
        upload: { url: upload.url, method: upload.method, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() },
        slotExpiresAt: slot.slotExpiresAt.toISOString(),
      });
    });
  }

  private async ownRow(q: Queryable, accountId: string, uploadId: string, lock: boolean): Promise<EvidenceRow | null> {
    const r = await q.query<EvidenceRow>(`select ${COLUMNS} from vault.evidence_objects where id = $1 and owner_account_id = $2 ${lock ? 'for update' : ''}`, [
      uploadId,
      accountId,
    ]);
    return r.rows[0] ?? null;
  }

  /**
   * Confirms an upload: the stored quarantine object must exist with exactly the declared size (the signed URL already
   * bound type and length). Moves SLOT_ISSUED → UPLOADED and enqueues processing in the same vault transaction.
   */
  async complete(principal: Principal, uploadId: string, key: string): Promise<IdempotentResult> {
    this.assertAvailable();
    return this.idempotency.execute(
      {
        scope: `acct:${principal.accountId}`,
        operation: 'driver-onboarding.evidence-completion',
        key,
        payload: { uploadId },
        ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async () =>
        withTransaction(this.vault, async (vtx) => {
          const row = await this.ownRow(vtx, principal.accountId, uploadId, true);
          if (!row) return failure('WAYVRO_E_NOT_FOUND');
          if (row.status !== 'SLOT_ISSUED')
            return row.status === 'EXPIRED' || row.status === 'DISCARDED' ? failure('WAYVRO_E_CONFLICT') : success(200, view(row));
          if (row.slot_expires_at.getTime() <= Date.now()) {
            await vtx.query(`update vault.evidence_objects set status = 'EXPIRED', version = version + 1 where id = $1`, [uploadId]);
            return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['UPLOAD_SLOT_EXPIRED'] });
          }
          const head = await this.storage.headObject({ area: 'quarantine', key: row.quarantine_key });
          if (head === null) return failure('WAYVRO_E_CONFLICT', { reasonCodes: ['UPLOAD_NOT_RECEIVED'] });
          if (head.size !== row.declared_byte_size) {
            await vtx.query(
              `update vault.evidence_objects set status = 'REJECTED_LIMITS', rejection_reason = 'TOO_LARGE', uploaded_at = now(), processed_at = now(),
                      source_byte_size = $2, version = version + 1 where id = $1`,
              [uploadId, Math.min(Math.max(head.size, 1), 10_485_760)],
            );
          } else {
            await vtx.query(
              `update vault.evidence_objects set status = 'UPLOADED', uploaded_at = now(), source_byte_size = $2, version = version + 1 where id = $1`,
              [uploadId, head.size],
            );
            await enqueueJob(vtx, { type: EVIDENCE_PROCESS_JOB, payload: { evidenceId: uploadId }, maxAttempts: 8 });
          }
          await appendAudit(vtx, {
            actor: { type: 'ACCOUNT', id: principal.accountId },
            action: 'EVIDENCE_UPLOAD_COMPLETED',
            objectType: 'vault.evidence_object',
            objectId: uploadId,
            outcome: head.size === row.declared_byte_size ? 'SUCCESS' : 'FAILURE',
          });
          const fresh = await this.ownRow(vtx, principal.accountId, uploadId, false);
          if (!fresh) throw new Error('evidence vanished');
          return success(200, view(fresh));
        }),
    );
  }

  /** Discards an upload while the application is still editable; stored objects are deleted (the orphan job retries). */
  async discard(principal: Principal, uploadId: string, key: string): Promise<IdempotentResult> {
    this.assertAvailable();
    const result = await this.idempotency.execute(
      {
        scope: `acct:${principal.accountId}`,
        operation: 'driver-onboarding.evidence-discard',
        key,
        payload: { uploadId },
        ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async () =>
        withTransaction(this.vault, async (vtx) => {
          const row = await this.ownRow(vtx, principal.accountId, uploadId, true);
          if (!row) return failure('WAYVRO_E_NOT_FOUND');
          const app = (await vtx.query<{ state: string }>(`select state from compliance.driver_applications where id = $1`, [row.driver_application_id]))
            .rows[0];
          if (!app || !EDITABLE.has(app.state)) return failure('WAYVRO_E_CONFLICT');
          if (row.status !== 'DISCARDED') {
            await vtx.query(`update vault.evidence_objects set status = 'DISCARDED', version = version + 1 where id = $1`, [uploadId]);
            await appendAudit(vtx, {
              actor: { type: 'ACCOUNT', id: principal.accountId },
              action: 'EVIDENCE_DISCARDED',
              objectType: 'vault.evidence_object',
              objectId: uploadId,
              outcome: 'SUCCESS',
            });
          }
          return success(204, null);
        }),
    );
    // Storage keys never leave this module (not even into the idempotency record): re-read them here, after commit.
    if (result.outcome.kind === 'success') {
      const keys = (
        await this.vault.query<{ quarantine_key: string; vault_key: string | null }>(
          `select quarantine_key, vault_key from vault.evidence_objects where id = $1 and owner_account_id = $2 and status = 'DISCARDED'`,
          [uploadId, principal.accountId],
        )
      ).rows[0];
      if (keys) {
        await this.storage.deleteObject({ area: 'quarantine', key: keys.quarantine_key });
        if (keys.vault_key) await this.storage.deleteObject({ area: 'vault', key: keys.vault_key });
      }
    }
    return result;
  }

  async list(principal: Principal, applicationId: string): Promise<{ items: EvidenceUploadStatus[] }> {
    this.assertAvailable();
    const app = await this.vault.query(`select 1 from compliance.driver_applications where id = $1 and account_id = $2`, [applicationId, principal.accountId]);
    if (app.rowCount === 0) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const rows = await this.vault.query<EvidenceRow>(
      `select ${COLUMNS} from vault.evidence_objects where driver_application_id = $1 and owner_account_id = $2 order by created_at, id`,
      [applicationId, principal.accountId],
    );
    return { items: rows.rows.map(view) };
  }
}

/** EvidenceSummaryPort for submission (compliance never reads vault tables): user-safe states only. */
export class EvidenceSummary implements EvidenceSummaryPort {
  constructor(private readonly vault: pg.Pool) {}

  async evidenceStates(applicationId: string): Promise<ReadonlyArray<EvidenceState>> {
    const rows = await this.vault.query<EvidenceRow & { pixel_width: number | null; pixel_height: number | null }>(
      `select ${COLUMNS}, pixel_width, pixel_height from vault.evidence_objects where driver_application_id = $1 order by created_at, id`,
      [applicationId],
    );
    return rows.rows.map((r) => ({
      evidenceId: r.id,
      documentId: r.compliance_document_id,
      kind: r.kind,
      status: publicStatus(r).status,
      captureSource: r.capture_source,
      pixelWidth: r.pixel_width,
      pixelHeight: r.pixel_height,
    }));
  }
}
