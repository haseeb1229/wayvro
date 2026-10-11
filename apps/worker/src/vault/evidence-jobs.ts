/**
 * Evidence pipeline jobs (ADR-041; KYC doc §4). They run with the `wayvro_vault` pool; the job table itself is claimed
 * with the worker pool by the JobRunner (lease-fenced, ADR-042).
 *
 * `evidence.process`: quarantine bytes → size check → SHA-256 → malware scan → isolated decode/re-encode → SHA-256 of
 * the canonical bytes → per-object DEK envelope → vault object → row AVAILABLE (CAS on UPLOADED) + exact-replay
 * EVIDENCE_HASH_MATCH signals → quarantine object deleted. A scanner/sanitiser that cannot answer THROWS (retry with
 * backoff; never clean). A refusal is terminal: REJECTED_MALWARE / REJECTED_FORMAT / REJECTED_LIMITS. Nothing is logged
 * except ids, codes and sizes (an object may be identity evidence).
 *
 * `evidence.orphans` (scheduled): expired slots → EXPIRED; quarantine objects older than 24 h without a live slot, and
 * vault objects without a row, are deleted — or only counted while EVIDENCE_ORPHAN_DRY_RUN is on.
 */
import { createHash, randomBytes } from 'node:crypto';
import { EVIDENCE_CONTENT_ENVELOPE_VERSION, sealEvidence, type FieldCipher } from '@wayvro/field-crypto';
import type { Logger } from '@wayvro/observability';
import type { ImageSanitiserPort, MalwareScannerPort, ObjectStoragePort, SanitiserRejection } from '@wayvro/provider-interfaces';
import { appendAudit, uuidv7, withTransaction, type JobDefinition } from '@wayvro/server-runtime';
import type pg from 'pg';

/** @internal exported for the pipeline integration test (the API enqueues the same job type) */
export const EVIDENCE_PROCESS_JOB = 'evidence.process';
export const EVIDENCE_ORPHANS_JOB = 'evidence.orphans';
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const sha256 = (b: Uint8Array): Buffer => createHash('sha256').update(b).digest();

export interface EvidenceJobDeps {
  readonly vault: pg.Pool;
  readonly storage: ObjectStoragePort;
  readonly scanner: MalwareScannerPort;
  readonly sanitiser: ImageSanitiserPort;
  readonly cipher: FieldCipher;
  readonly log: Logger;
}

interface Row {
  id: string;
  status: string;
  driver_application_id: string;
  quarantine_key: string;
  declared_byte_size: number;
}

type Rejection = {
  status: 'REJECTED_FORMAT' | 'REJECTED_MALWARE' | 'REJECTED_LIMITS';
  reason: 'UNSUPPORTED_FORMAT' | 'UNREADABLE' | 'TOO_LARGE' | 'LIMITS' | 'MALWARE';
};
const SANITISER_REJECTIONS: Readonly<Record<SanitiserRejection, Rejection>> = {
  UNSUPPORTED_FORMAT: { status: 'REJECTED_FORMAT', reason: 'UNSUPPORTED_FORMAT' },
  UNREADABLE: { status: 'REJECTED_FORMAT', reason: 'UNREADABLE' },
  LIMITS: { status: 'REJECTED_LIMITS', reason: 'LIMITS' },
};

export function evidenceProcessJob(deps: EvidenceJobDeps): JobDefinition {
  const reject = async (row: Row, rejection: Rejection, sourceSha: Buffer | null): Promise<void> => {
    await withTransaction(deps.vault, async (tx) => {
      const r = await tx.query(
        `update vault.evidence_objects set status = $2, rejection_reason = $3, processed_at = now(), source_sha256 = coalesce($4, source_sha256), version = version + 1
          where id = $1 and status = 'UPLOADED'`,
        [row.id, rejection.status, rejection.reason, sourceSha],
      );
      if (r.rowCount === 1) {
        await appendAudit(tx, {
          actor: { type: 'SYSTEM' },
          action: 'EVIDENCE_REJECTED',
          objectType: 'vault.evidence_object',
          objectId: row.id,
          outcome: 'FAILURE',
          reasonCode: rejection.reason,
        });
      }
    });
    await deps.storage.deleteObject({ area: 'quarantine', key: row.quarantine_key });
    if (rejection.reason === 'MALWARE')
      deps.log.warn({ signal: 'EVIDENCE_MALWARE_REJECTED', evidenceId: row.id }, 'evidence rejected by the malware scanner (trust & safety signal)');
  };

  return {
    type: EVIDENCE_PROCESS_JOB,
    async handler(job) {
      const evidenceId = (job.payload as { evidenceId?: unknown }).evidenceId;
      if (typeof evidenceId !== 'string') throw new Error('evidence.process payload without evidenceId');
      const row = (
        await deps.vault.query<Row>(`select id, status, driver_application_id, quarantine_key, declared_byte_size from vault.evidence_objects where id = $1`, [
          evidenceId,
        ])
      ).rows[0];
      if (!row || row.status !== 'UPLOADED') return; // idempotent: already processed, discarded or unknown
      const bytes = await deps.storage.getObject({ area: 'quarantine', key: row.quarantine_key });
      if (bytes === null) return reject(row, { status: 'REJECTED_FORMAT', reason: 'UNREADABLE' }, null);
      if (bytes.byteLength > Math.min(row.declared_byte_size, MAX_SOURCE_BYTES)) return reject(row, { status: 'REJECTED_LIMITS', reason: 'TOO_LARGE' }, null);
      const sourceSha = sha256(bytes);
      const verdict = await deps.scanner.scan(bytes);
      if (verdict.verdict === 'FOUND') return reject(row, { status: 'REJECTED_MALWARE', reason: 'MALWARE' }, sourceSha);
      const result = await deps.sanitiser.sanitise(bytes);
      if (result.outcome === 'REJECTED') return reject(row, SANITISER_REJECTIONS[result.reason], sourceSha);

      const canonicalSha = sha256(result.bytes);
      const sealed = sealEvidence(deps.cipher, row.id, result.bytes);
      const vaultKey = `v/${randomBytes(16).toString('hex')}`;
      await deps.storage.putObject({ area: 'vault', key: vaultKey, body: sealed.content, contentType: 'application/octet-stream' });
      const committed = await withTransaction(deps.vault, async (tx) => {
        const r = await tx.query(
          `update vault.evidence_objects
              set status = 'AVAILABLE', vault_key = $2, wrapped_dek = $3, content_envelope_version = $4, source_sha256 = $5, canonical_sha256 = $6,
                  canonical_format = $7, canonical_byte_size = $8, pixel_width = $9, pixel_height = $10, processed_at = now(), version = version + 1
            where id = $1 and status = 'UPLOADED'`,
          [
            row.id,
            vaultKey,
            sealed.wrappedDek,
            EVIDENCE_CONTENT_ENVELOPE_VERSION,
            sourceSha,
            canonicalSha,
            result.format,
            result.bytes.byteLength,
            result.width,
            result.height,
          ],
        );
        if (r.rowCount !== 1) return false;
        // Exact replay of the same image on ANOTHER application: a signal for human review, never a rejection (AB-04).
        const matches = await tx.query<{ id: string; driver_application_id: string }>(
          `select id, driver_application_id from vault.evidence_objects
            where id <> $1 and driver_application_id <> $2 and status = 'AVAILABLE' and (source_sha256 = $3 or canonical_sha256 = $4) limit 20`,
          [row.id, row.driver_application_id, sourceSha, canonicalSha],
        );
        for (const m of matches.rows) {
          await tx.query(
            `insert into compliance.duplicate_signals (id, signal, subject_application_id, subject_evidence_id, matched_application_id, matched_evidence_id, status)
             values ($1, 'EVIDENCE_HASH_MATCH', $2, $3, $4, $5, 'OPEN') on conflict do nothing`,
            [uuidv7(), row.driver_application_id, row.id, m.driver_application_id, m.id],
          );
        }
        await appendAudit(tx, {
          actor: { type: 'SYSTEM' },
          action: 'EVIDENCE_ACCEPTED',
          objectType: 'vault.evidence_object',
          objectId: row.id,
          outcome: 'SUCCESS',
          reasonCode: matches.rowCount ? 'DUPLICATE_SIGNAL_RAISED' : result.format,
        });
        return true;
      });
      // discarded meanwhile: the sealed copy must not outlive its row
      if (!committed) await deps.storage.deleteObject({ area: 'vault', key: vaultKey });
      await deps.storage.deleteObject({ area: 'quarantine', key: row.quarantine_key });
    },
  };
}

export function evidenceOrphansJob(
  deps: Pick<EvidenceJobDeps, 'vault' | 'storage' | 'log'> & {
    readonly dryRun: boolean;
    readonly batch: number;
    /** Minimum ages before a storage object can be an orphan (quarantine 24 h, vault 1 h; tests pass 0). */
    readonly quarantineAgeMs?: number;
    readonly vaultAgeMs?: number;
  },
): JobDefinition {
  return {
    type: EVIDENCE_ORPHANS_JOB,
    async handler() {
      const expired = await deps.vault.query<{ quarantine_key: string }>(
        `update vault.evidence_objects set status = 'EXPIRED', version = version + 1
          where id in (select id from vault.evidence_objects where status = 'SLOT_ISSUED' and slot_expires_at < now() limit $1)
          returning quarantine_key`,
        [deps.batch],
      );
      const doomed: Array<{ area: 'quarantine' | 'vault'; key: string }> = expired.rows.map((r) => ({ area: 'quarantine', key: r.quarantine_key }));
      const dayAgo = Date.now() - (deps.quarantineAgeMs ?? 24 * 3600_000);
      const quarantine = (await deps.storage.listObjects({ area: 'quarantine', prefix: 'q/', limit: deps.batch })).filter(
        (o) => o.lastModified.getTime() < dayAgo,
      );
      if (quarantine.length > 0) {
        const live = await deps.vault.query<{ quarantine_key: string }>(
          `select quarantine_key from vault.evidence_objects where quarantine_key = any($1::text[]) and status in ('SLOT_ISSUED', 'UPLOADED')`,
          [quarantine.map((o) => o.key)],
        );
        const keep = new Set(live.rows.map((r) => r.quarantine_key));
        for (const o of quarantine) if (!keep.has(o.key)) doomed.push({ area: 'quarantine', key: o.key });
      }
      const hourAgo = Date.now() - (deps.vaultAgeMs ?? 3600_000);
      const vaulted = (await deps.storage.listObjects({ area: 'vault', prefix: 'v/', limit: deps.batch })).filter((o) => o.lastModified.getTime() < hourAgo);
      if (vaulted.length > 0) {
        const known = await deps.vault.query<{ vault_key: string }>(
          `select vault_key from vault.evidence_objects where vault_key = any($1::text[]) and status = 'AVAILABLE'`,
          [vaulted.map((o) => o.key)],
        );
        const keep = new Set(known.rows.map((r) => r.vault_key));
        for (const o of vaulted) if (!keep.has(o.key)) doomed.push({ area: 'vault', key: o.key });
      }
      if (!deps.dryRun) for (const d of doomed) await deps.storage.deleteObject(d);
      deps.log.info(
        { job: EVIDENCE_ORPHANS_JOB, dryRun: deps.dryRun, expiredSlots: expired.rowCount ?? 0, orphanObjects: doomed.length - (expired.rowCount ?? 0) },
        deps.dryRun ? 'evidence orphan reconciliation (dry run: nothing deleted)' : 'evidence orphan reconciliation',
      );
    },
  };
}
