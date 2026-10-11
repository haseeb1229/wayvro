/**
 * Evidence vault — staff side (H02, W07, K11; KYC doc §7; staff matrix row `vault.evidence.view`). Viewing needs the
 * permission, a fresh step-up (route policy), a reason from the closed catalogue, the application's city in the
 * viewer's scope and no conflict with the viewer's own consumer account. It yields a ONE-TIME, 60-second token bound to
 * the staff session; the content route consumes it, decrypts the sanitised object, verifies its SHA-256 and streams it
 * with no-store/inline headers. Every issue, view, replay and integrity failure is written to the append-only access log.
 * There is no bulk download, export or list-with-content route (closure correction §10).
 *
 * REAL evidence (staging/production) additionally requires the `ops.kyc-real-evidence` flag (OFF until EG-05/EG-10/
 * EG-17) and two registered authenticators. Case-claim scoping (evidence only on a claimed review case, or break-glass)
 * arrives with review cases in P2.7.
 */
import { createHash, randomUUID } from 'node:crypto';
import { isFlagEnabled, isNonProductionLike, type WayvroEnv } from '@wayvro/config';
import { openEvidence, type FieldCipher } from '@wayvro/field-crypto';
import { WayvroError, type Logger } from '@wayvro/observability';
import type { ObjectStoragePort } from '@wayvro/provider-interfaces';
import { appendAudit, uuidv7, withTransaction, type Queryable } from '@wayvro/server-runtime';
import type pg from 'pg';
import { citiesFor, hasRole, type StaffPrincipal } from '../staff/staff-session.js';

const VIEW_SECONDS = 60;
const sha256 = (b: Uint8Array | string): Buffer => createHash('sha256').update(b).digest();

async function accessLog(
  q: Queryable,
  staff: StaffPrincipal,
  entry: {
    evidenceId: string;
    tokenId: string | null;
    event: 'VIEW_TOKEN_ISSUED' | 'CONTENT_STREAMED' | 'TOKEN_REPLAY_REFUSED' | 'INTEGRITY_FAILURE';
    reasonCode: string;
  },
): Promise<void> {
  await q.query(
    `insert into vault.evidence_access_log (id, evidence_object_id, staff_account_id, staff_session_id, view_token_id, event, reason_code, break_glass_grant_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [uuidv7(), entry.evidenceId, staff.staffId, staff.sessionId, entry.tokenId, entry.event, entry.reasonCode, staff.breakGlassId],
  );
}

/** Review-case claims, answered by the review module (every case kind, including document renewals of a verified driver). */
interface CaseClaimPort {
  holdsLiveClaim(staffId: string, applicationId: string): Promise<boolean>;
}

export class EvidenceViewService {
  constructor(
    private readonly vault: pg.Pool,
    private readonly storage: ObjectStoragePort,
    private readonly cipher: FieldCipher,
    private readonly env: WayvroEnv,
    private readonly log: Logger,
    private readonly claims: CaseClaimPort,
  ) {}

  private async deny(staff: StaffPrincipal, evidenceId: string, reasonCode: string): Promise<never> {
    await appendAudit(this.vault, {
      actor: { type: 'STAFF', id: staff.staffId },
      action: 'EVIDENCE_VIEW_DENIED',
      objectType: 'vault.evidence_object',
      objectId: evidenceId,
      outcome: 'DENIED',
      reasonCode,
    });
    throw new WayvroError('WAYVRO_E_FORBIDDEN');
  }

  /**
   * Case scoping (staff matrix row `vault.evidence.view`): a KYC reviewer only on a case they hold (live lease); a KYC
   * senior on any in-scope application; Trust & Safety only where an OPEN duplicate signal involves the application.
   * Break-glass bypasses this (tagged, alerted and reviewed).
   */
  private async caseAllows(staff: StaffPrincipal, applicationId: string): Promise<boolean> {
    if (hasRole(staff, 'KYC_SENIOR_REVIEWER')) return true;
    if (hasRole(staff, 'KYC_REVIEWER') && (await this.claims.holdsLiveClaim(staff.staffId, applicationId))) return true;
    if (hasRole(staff, 'TRUST_SAFETY_AGENT')) {
      const signal = await this.vault.query(
        `select 1 from compliance.duplicate_signals where status = 'OPEN' and (subject_application_id = $1 or matched_application_id = $1)`,
        [applicationId],
      );
      if ((signal.rowCount ?? 0) > 0) return true;
    }
    return false;
  }

  async issue(staff: StaffPrincipal, input: { evidenceId: string; reasonCode: string }): Promise<{ viewToken: string; expiresAt: string; reasonCode: string }> {
    if (!isNonProductionLike(this.env)) {
      // real identity evidence: gated by the flag and the two-authenticator rule (staff matrix §1)
      if (!isFlagEnabled('ops.kyc-real-evidence', this.env)) throw new WayvroError('WAYVRO_E_FEATURE_DISABLED');
      if (staff.activeCredentials < 2) await this.deny(staff, input.evidenceId, 'SECOND_AUTHENTICATOR_REQUIRED');
    }
    const target = (
      await this.vault.query<{ status: string; owner_account_id: string; city_code: string; application_id: string }>(
        `select e.status, e.owner_account_id, a.city_code, a.id application_id from vault.evidence_objects e join compliance.driver_applications a on a.id = e.driver_application_id
          where e.id = $1`,
        [input.evidenceId],
      )
    ).rows[0];
    if (!target) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const cities = citiesFor(staff, 'vault.evidence.view');
    if (cities !== null && !cities.has(target.city_code)) await this.deny(staff, input.evidenceId, 'CITY_SCOPE');
    if (staff.consumerAccountId !== null && staff.consumerAccountId === target.owner_account_id)
      await this.deny(staff, input.evidenceId, 'CONFLICT_OF_INTEREST');
    if (staff.breakGlassId === null && !(await this.caseAllows(staff, target.application_id))) await this.deny(staff, input.evidenceId, 'CASE_NOT_CLAIMED');
    if (target.status !== 'AVAILABLE') throw new WayvroError('WAYVRO_E_CONFLICT');
    const token = randomUUID();
    const tokenId = uuidv7();
    const expiresAt = await withTransaction(this.vault, async (vtx) => {
      const r = await vtx.query<{ expires_at: Date }>(
        `insert into vault.evidence_view_tokens (id, token_sha256, evidence_object_id, staff_account_id, staff_session_id, reason_code, expires_at)
         values ($1, $2, $3, $4, $5, $6, now() + ($7::int * interval '1 second')) returning expires_at`,
        [tokenId, sha256(token), input.evidenceId, staff.staffId, staff.sessionId, input.reasonCode, VIEW_SECONDS],
      );
      await accessLog(vtx, staff, { evidenceId: input.evidenceId, tokenId, event: 'VIEW_TOKEN_ISSUED', reasonCode: input.reasonCode });
      await appendAudit(vtx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: staff.breakGlassId ? 'EVIDENCE_VIEW_ISSUED_BREAK_GLASS' : 'EVIDENCE_VIEW_ISSUED',
        objectType: 'vault.evidence_object',
        objectId: input.evidenceId,
        outcome: 'SUCCESS',
        reasonCode: input.reasonCode,
      });
      const at = r.rows[0]?.expires_at;
      if (!at) throw new Error('view token insert returned no row');
      return at;
    });
    return { viewToken: token, expiresAt: expiresAt.toISOString(), reasonCode: input.reasonCode };
  }

  /** Decrypts a vault object; any authentication or format failure is null (reported as an integrity failure). */
  private open(evidenceId: string, wrappedDek: Buffer, content: Buffer): Buffer | null {
    try {
      return openEvidence(this.cipher, evidenceId, { wrappedDek, content });
    } catch {
      return null;
    }
  }

  /** Consumes the one-time token and returns the decrypted, integrity-checked image. */
  async content(staff: StaffPrincipal, token: string): Promise<{ contentType: 'image/jpeg' | 'image/png'; bytes: Buffer }> {
    const consumed = await withTransaction(this.vault, async (vtx) => {
      const live = (
        await vtx.query<{ id: string; evidence_object_id: string; reason_code: string }>(
          `update vault.evidence_view_tokens set used_at = now()
            where token_sha256 = $1 and staff_session_id = $2 and used_at is null and expires_at > now()
          returning id, evidence_object_id, reason_code`,
          [sha256(token), staff.sessionId],
        )
      ).rows[0];
      if (live) return { kind: 'live' as const, ...live };
      const known = (
        await vtx.query<{ id: string; evidence_object_id: string; reason_code: string }>(
          `select id, evidence_object_id, reason_code from vault.evidence_view_tokens where token_sha256 = $1 and staff_account_id = $2`,
          [sha256(token), staff.staffId],
        )
      ).rows[0];
      if (!known) return { kind: 'unknown' as const };
      await accessLog(vtx, staff, { evidenceId: known.evidence_object_id, tokenId: known.id, event: 'TOKEN_REPLAY_REFUSED', reasonCode: known.reason_code });
      return { kind: 'gone' as const };
    });
    if (consumed.kind === 'unknown') throw new WayvroError('WAYVRO_E_NOT_FOUND');
    if (consumed.kind === 'gone') throw new WayvroError('WAYVRO_E_GONE');
    const evidenceId = consumed.evidence_object_id;
    const row = (
      await this.vault.query<{ vault_key: string; wrapped_dek: Buffer; canonical_sha256: Buffer; canonical_format: 'JPEG' | 'PNG' }>(
        `select vault_key, wrapped_dek, canonical_sha256, canonical_format from vault.evidence_objects where id = $1 and status = 'AVAILABLE'`,
        [evidenceId],
      )
    ).rows[0];
    if (!row) throw new WayvroError('WAYVRO_E_NOT_FOUND');
    const sealed = await this.storage.getObject({ area: 'vault', key: row.vault_key });
    const image = sealed === null ? null : this.open(evidenceId, row.wrapped_dek, Buffer.from(sealed));
    if (image === null || !sha256(image).equals(row.canonical_sha256)) {
      await accessLog(this.vault, staff, { evidenceId, tokenId: consumed.id, event: 'INTEGRITY_FAILURE', reasonCode: consumed.reason_code });
      this.log.error({ signal: 'EVIDENCE_INTEGRITY_FAILURE', evidenceId }, 'security alert: evidence failed decryption or hash verification');
      throw new WayvroError('WAYVRO_E_INTERNAL');
    }
    await withTransaction(this.vault, async (vtx) => {
      await accessLog(vtx, staff, { evidenceId, tokenId: consumed.id, event: 'CONTENT_STREAMED', reasonCode: consumed.reason_code });
      await appendAudit(vtx, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'EVIDENCE_CONTENT_VIEWED',
        objectType: 'vault.evidence_object',
        objectId: evidenceId,
        outcome: 'SUCCESS',
        reasonCode: consumed.reason_code,
      });
    });
    return { contentType: row.canonical_format === 'PNG' ? 'image/png' : 'image/jpeg', bytes: image };
  }

  /** Evidence access log for auditors (ids and codes only; paginated, newest first). */
  async accessLog(query: { evidenceId?: string | undefined; staffId?: string | undefined; cursor?: string | undefined; limit?: number | undefined }) {
    const limit = query.limit ?? 50;
    let before: { at: string; id: string } | null = null;
    if (query.cursor !== undefined) {
      const [at, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
      if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) throw new WayvroError('WAYVRO_E_VALIDATION');
      before = { at, id };
    }
    const r = await this.vault.query<{
      id: string;
      evidence_object_id: string;
      staff_account_id: string;
      event: string;
      reason_code: string;
      break_glass_grant_id: string | null;
      at: Date;
    }>(
      `select id, evidence_object_id, staff_account_id, event, reason_code, break_glass_grant_id, at from vault.evidence_access_log
        where ($1::uuid is null or evidence_object_id = $1) and ($2::uuid is null or staff_account_id = $2)
          and ($3::timestamptz is null or (at, id) < ($3::timestamptz, $4::uuid))
        order by at desc, id desc limit $5`,
      [query.evidenceId ?? null, query.staffId ?? null, before?.at ?? null, before?.id ?? null, limit + 1],
    );
    const rows = r.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map((e) => ({
        id: e.id,
        evidenceId: e.evidence_object_id,
        staffId: e.staff_account_id,
        event: e.event,
        reasonCode: e.reason_code,
        breakGlass: e.break_glass_grant_id !== null,
        at: e.at.toISOString(),
      })),
      nextCursor: r.rows.length > limit && last ? Buffer.from(`${last.at.toISOString()}|${last.id}`).toString('base64url') : null,
    };
  }
}
