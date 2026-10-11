/**
 * Worker composition (ADR-042). The production root binds real adapters only; with no OTP adapter (EG-01) the
 * `otp.deliver` handler is simply not registered, so OTP jobs are never claimed by a fake. Local development delivers
 * OTPs in the API local runner instead (ADR-045).
 *
 * Database role: the worker's LOGIN role is a member of `wayvro_worker` (jobs, rotation, purge) and
 * `wayvro_audit_sealer` (read audit events, append seals) — never the owner/migrator.
 */
import { FieldCipher, KeyedHasher, loadKeyRing } from '@wayvro/field-crypto';
import { PhoneLookup, keyRotationJob, otpDeliveryJob, type RotationDeps } from '@wayvro/identity-core';
import type { Logger } from '@wayvro/observability';
import type { ProviderRegistry } from '@wayvro/provider-interfaces';
import { JobRunner, type JobDefinition } from '@wayvro/server-runtime';
import type pg from 'pg';
import { AUDIT_SEAL_JOB, AUDIT_VERIFY_JOB, auditJobs } from './audit-seal.js';
import type { WorkerConfig } from './config.js';
import { DELETION_PROCESSING_JOB, RECOVERY_COMPLETION_JOB, deletionProcessingJob, recoveryCompletionJob } from './identity/account-jobs.js';
import { MAINTENANCE_PURGE_JOB, maintenanceJob } from './maintenance.js';
import { RecurringScheduler } from './scheduler.js';
import { accountStateHintConsumer, type HintPublisher } from './outbox/account-state-hint.js';
import { LocalDispatcher, PgOutboxSource, PgProcessedEventStore } from './outbox/pg-outbox.js';
import { OutboxRelay } from './outbox/relay.js';
import { DOCUMENT_EXPIRY_JOB, applicationIntakeJob, documentExpiryJob } from './review/review-jobs.js';
import { EVIDENCE_ORPHANS_JOB, evidenceOrphansJob, evidenceProcessJob } from './vault/evidence-jobs.js';

export interface WorkerRuntime {
  readonly runner: JobRunner;
  readonly scheduler: RecurringScheduler;
  /** Transactional-outbox relay with its first consumer (account-state hints); null without a hint publisher. */
  readonly relay: OutboxRelay | null;
  readonly rotation: RotationDeps;
}

/**
 * `vaultPool` authenticates as a member of `wayvro_vault` (evidence jobs only). Evidence processing is registered only
 * when the vault pool, object storage, the malware scanner and the isolated sanitiser are ALL bound; otherwise uploads
 * stay UPLOADED (never clean) until they are.
 */
export function composeWorker(
  config: WorkerConfig,
  pool: pg.Pool,
  log: Logger,
  providers: ProviderRegistry,
  vaultPool: pg.Pool | null = null,
  hints: HintPublisher | null = null,
): WorkerRuntime {
  // Staging/production refuse until a KMS-backed key provider exists (EG-05).
  const ring = loadKeyRing(config.WAYVRO_ENV, config);
  const cipher = new FieldCipher(ring);
  const rotation: RotationDeps = { db: pool, ring, cipher, hasher: new KeyedHasher(ring), log, batchSize: config.KEY_ROTATION_BATCH_SIZE };
  const definitions: JobDefinition[] = [
    ...auditJobs(pool, log, { lagSeconds: config.AUDIT_SEAL_LAG_SECONDS, maxRows: config.AUDIT_SEAL_BATCH_SIZE }),
    maintenanceJob(pool, log, {
      otpChallengeDays: config.OTP_CHALLENGE_RETENTION_DAYS,
      succeededJobDays: config.SUCCEEDED_JOB_RETENTION_DAYS,
      applicationDraftExpiryDays: config.APPLICATION_DRAFT_EXPIRY_DAYS,
      batchSize: 5000,
    }),
    keyRotationJob(rotation),
    applicationIntakeJob(pool),
    documentExpiryJob(pool, log),
    recoveryCompletionJob({ pool, cipher, lookup: new PhoneLookup(rotation.hasher), log }),
  ];
  if (providers.has('otpDelivery')) definitions.push(otpDeliveryJob({ db: pool, cipher, port: providers.get('otpDelivery') }));
  const recurring = [
    { type: AUDIT_SEAL_JOB, everySeconds: 60 },
    { type: AUDIT_VERIFY_JOB, everySeconds: 3600 },
    { type: MAINTENANCE_PURGE_JOB, everySeconds: 600 },
    { type: DOCUMENT_EXPIRY_JOB, everySeconds: 86_400 },
    { type: RECOVERY_COMPLETION_JOB, everySeconds: 600 },
  ];
  if (vaultPool && providers.has('objectStorage')) {
    const storage = providers.get('objectStorage');
    if (providers.has('malwareScanner') && providers.has('imageSanitiser')) {
      definitions.push(
        evidenceProcessJob({ vault: vaultPool, storage, scanner: providers.get('malwareScanner'), sanitiser: providers.get('imageSanitiser'), cipher, log }),
      );
    }
    definitions.push(evidenceOrphansJob({ vault: vaultPool, storage, log, dryRun: config.EVIDENCE_ORPHAN_DRY_RUN, batch: 500 }));
    recurring.push({ type: EVIDENCE_ORPHANS_JOB, everySeconds: 86_400 });
    // account deletion erases evidence, so it runs only where the vault and its storage are bound
    definitions.push(deletionProcessingJob({ pool, vault: vaultPool, storage, log }));
    recurring.push({ type: DELETION_PROCESSING_JOB, everySeconds: 3600 });
  }
  const runner = new JobRunner(pool, definitions, { workerId: `worker-${String(process.pid)}`, leaseMs: config.JOB_LEASE_MS, batchSize: 10, log });
  const scheduler = new RecurringScheduler(pool, recurring);
  const relay = hints
    ? new OutboxRelay(new PgOutboxSource(pool), new LocalDispatcher([accountStateHintConsumer(new PgProcessedEventStore(pool), hints)]), {
        batchSize: 100,
        maxAttempts: 10,
      })
    : null;
  return { runner, scheduler, rotation, relay };
}
