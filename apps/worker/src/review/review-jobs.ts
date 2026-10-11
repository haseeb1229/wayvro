/**
 * Review intake and expiry monitoring (K04/K05/D03; data model §4.5, §4.7).
 *
 * `driver-application.intake`: SUBMITTED → AUTO_CHECK_PENDING → MANUAL_REVIEW and a review case for a HUMAN reviewer
 * (INITIAL_APPLICATION, or RESUBMISSION after a NEEDS_INFO). The automatic part only prioritises — open duplicate
 * signals raise the priority — and never decides anything (no automated edge into VERIFIED).
 *
 * `compliance.document-expiry` (daily): VALID documents past their expiry date (server date) become EXPIRED; a verified
 * driver whose MANDATORY document (pinned requirement set) expired moves to the EXPIRED profile state until a renewal
 * is approved. Rider use is never affected.
 */
import type { Logger } from '@wayvro/observability';
import { appendAudit, uuidv7, withTransaction, type JobDefinition } from '@wayvro/server-runtime';
import type pg from 'pg';

/** @internal exported for the intake integration test (the API enqueues the same job type) */
export const APPLICATION_INTAKE_JOB = 'driver-application.intake';
export const DOCUMENT_EXPIRY_JOB = 'compliance.document-expiry';

export function applicationIntakeJob(pool: pg.Pool): JobDefinition {
  return {
    type: APPLICATION_INTAKE_JOB,
    async handler(job) {
      const applicationId = (job.payload as { applicationId?: unknown }).applicationId;
      if (typeof applicationId !== 'string') throw new Error('intake payload without applicationId');
      await withTransaction(pool, async (tx) => {
        const app = (
          await tx.query<{ id: string; state: string; city_code: string }>(
            `select id, state, city_code from compliance.driver_applications where id = $1 for no key update`,
            [applicationId],
          )
        ).rows[0];
        if (app?.state !== 'SUBMITTED') return; // idempotent: already taken in, withdrawn or unknown
        await tx.query(`update compliance.driver_applications set state = 'AUTO_CHECK_PENDING', version = version + 1, updated_at = now() where id = $1`, [
          app.id,
        ]);
        const signals = await tx.query(`select 1 from compliance.duplicate_signals where subject_application_id = $1 and status = 'OPEN'`, [app.id]);
        const earlier = await tx.query(`select 1 from compliance.review_cases where driver_application_id = $1 limit 1`, [app.id]);
        await tx.query(
          `insert into compliance.review_cases (id, kind, driver_application_id, city_code, priority, status) values ($1, $2, $3, $4, $5, 'OPEN')`,
          [uuidv7(), (earlier.rowCount ?? 0) > 0 ? 'RESUBMISSION' : 'INITIAL_APPLICATION', app.id, app.city_code, Math.min(9, 2 * (signals.rowCount ?? 0))],
        );
        await tx.query(`update compliance.driver_applications set state = 'MANUAL_REVIEW', version = version + 1, updated_at = now() where id = $1`, [app.id]);
        await appendAudit(tx, {
          actor: { type: 'SYSTEM' },
          action: 'DRIVER_APPLICATION_QUEUED_FOR_REVIEW',
          objectType: 'compliance.driver_application',
          objectId: app.id,
          outcome: 'SUCCESS',
          reasonCode: (signals.rowCount ?? 0) > 0 ? 'DUPLICATE_SIGNALS_OPEN' : 'NO_SIGNALS',
        });
      });
    },
  };
}

export function documentExpiryJob(pool: pg.Pool, log: Logger): JobDefinition {
  return {
    type: DOCUMENT_EXPIRY_JOB,
    async handler() {
      const expired = await pool.query<{ id: string }>(
        `update compliance.compliance_documents set status = 'EXPIRED', version = version + 1
          where status = 'VALID' and expires_on is not null and expires_on < current_date returning id`,
      );
      const profiles = await pool.query<{ id: string }>(
        `update compliance.driver_profiles p set state = 'EXPIRED', version = version + 1
          where p.state in ('VERIFIED', 'ACTIVE_ELIGIBLE')
            and exists (
              select 1 from compliance.compliance_documents d
                join compliance.driver_applications a on a.id = d.driver_application_id
                join compliance.requirement_set_items i on i.requirement_set_id = a.requirement_set_id and i.document_type_code = d.document_type_code
               where a.id = p.application_id and d.status = 'EXPIRED' and i.mandatory)
          returning p.id`,
      );
      log.info({ job: DOCUMENT_EXPIRY_JOB, documentsExpired: expired.rowCount ?? 0, profilesExpired: profiles.rowCount ?? 0 }, 'document expiry');
    },
  };
}
