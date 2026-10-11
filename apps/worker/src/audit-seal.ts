/**
 * Audit sealing (Q39 tamper evidence; docs/phase2/PHASE2_DOMAIN_AND_DATA_MODEL.md §3.6).
 *
 * `audit.seal` appends a seal over the next batch of audit events: a SHA-256 Merkle root of the rows plus a hash chain
 * to the previous seal. Only rows older than the configured lag are sealed, so transactions still in flight (bounded by
 * statement/idle timeouts) are not skipped; a row that commits later inside an already sealed range is detected by
 * verification as an unsealed row below the watermark.
 * `audit.verify-seals` recomputes every seal and the chain and reports mismatches as security alerts.
 *
 * Scope: this detects modification by anyone who cannot also rewrite the seals. A database superuser (or the table
 * owner) can rewrite rows AND recompute seals; protection against that requires external anchoring of seal hashes
 * (gate EG-05) — explicitly NOT provided by an in-database seal.
 */
import { createHash } from 'node:crypto';
import type { Logger } from '@wayvro/observability';
import { withTransaction, type JobDefinition } from '@wayvro/server-runtime';
import type pg from 'pg';

export const AUDIT_SEAL_JOB = 'audit.seal';
export const AUDIT_VERIFY_JOB = 'audit.verify-seals';
const ALGORITHM = 'sha256-merkle-v1';

interface AuditRow {
  seq: string;
  id: string;
  occurred_at: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  object_type: string;
  object_id: string | null;
  outcome: string;
  reason_code: string | null;
  request_id: string | null;
}

const ROW_COLUMNS = `seq, id, to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at, actor_type, actor_id, action,
                     object_type, object_id, outcome, reason_code, request_id`;

function leaf(row: AuditRow): Buffer {
  const canonical = JSON.stringify([
    row.seq,
    row.id,
    row.occurred_at,
    row.actor_type,
    row.actor_id,
    row.action,
    row.object_type,
    row.object_id,
    row.outcome,
    row.reason_code,
    row.request_id,
  ]);
  return createHash('sha256')
    .update(Buffer.from([0x00]))
    .update(canonical, 'utf8')
    .digest();
}

/**
 * Binary Merkle root; an odd node is carried up unchanged. Leaf/node prefixes (0x00/0x01) separate the domains.
 * @internal exported for property tests.
 */
export function merkleRoot(leaves: readonly Buffer[]): Buffer {
  if (leaves.length === 0) throw new Error('cannot seal an empty batch');
  let level = [...leaves];
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];
      if (!left) continue;
      next.push(
        right
          ? createHash('sha256')
              .update(Buffer.from([0x01]))
              .update(left)
              .update(right)
              .digest()
          : left,
      );
    }
    level = next;
  }
  return level[0] ?? Buffer.alloc(32);
}

function sealHash(prev: Buffer | null, root: Buffer, firstSeq: bigint, lastSeq: bigint, count: number): Buffer {
  const meta = Buffer.alloc(20);
  meta.writeBigInt64BE(firstSeq, 0);
  meta.writeBigInt64BE(lastSeq, 8);
  meta.writeUInt32BE(count, 16);
  return createHash('sha256')
    .update('wayvro-audit-seal-v1')
    .update(prev ?? Buffer.alloc(32))
    .update(root)
    .update(meta)
    .digest();
}

interface SealResult {
  readonly sealNo: string;
  readonly firstSeq: string;
  readonly lastSeq: string;
  readonly leafCount: number;
}

/**
 * Seals the next batch (one sealer at a time per database via an advisory lock). Returns null when nothing is due.
 * @internal exported for integration tests; production runs it through the audit.seal job.
 */
export async function sealNextBatch(pool: pg.Pool, options: { lagSeconds: number; maxRows: number }): Promise<SealResult | null> {
  return withTransaction(pool, async (tx) => {
    const lock = await tx.query<{ ok: boolean }>(`select pg_try_advisory_xact_lock(hashtext('wayvro.audit.seal')) ok`);
    if (lock.rows[0]?.ok !== true) return null;
    const last = await tx.query<{ last_seq: string; seal_hash: Buffer }>(`select last_seq, seal_hash from audit.audit_seals order by seal_no desc limit 1`);
    const prev = last.rows[0];
    const rows = await tx.query<AuditRow>(
      `select ${ROW_COLUMNS} from audit.audit_events where seq > $1 and occurred_at < now() - ($2::int * interval '1 second') order by seq limit $3`,
      [prev?.last_seq ?? '0', options.lagSeconds, options.maxRows],
    );
    const first = rows.rows[0];
    const final = rows.rows.at(-1);
    if (!first || !final) return null;
    const root = merkleRoot(rows.rows.map(leaf));
    const hash = sealHash(prev?.seal_hash ?? null, root, BigInt(first.seq), BigInt(final.seq), rows.rows.length);
    const inserted = await tx.query<{ seal_no: string }>(
      `insert into audit.audit_seals (first_seq, last_seq, leaf_count, merkle_root, prev_seal_hash, seal_hash, algorithm) values ($1, $2, $3, $4, $5, $6, $7) returning seal_no`,
      [first.seq, final.seq, rows.rows.length, root, prev?.seal_hash ?? null, hash, ALGORITHM],
    );
    return { sealNo: inserted.rows[0]?.seal_no ?? '', firstSeq: first.seq, lastSeq: final.seq, leafCount: rows.rows.length };
  });
}

interface VerificationReport {
  readonly sealsVerified: number;
  readonly failures: ReadonlyArray<{
    readonly sealNo: string;
    readonly reason: 'ROOT_MISMATCH' | 'LEAF_COUNT_MISMATCH' | 'CHAIN_BROKEN' | 'SEAL_HASH_MISMATCH';
  }>;
  readonly unsealedBelowWatermark: number;
}

/**
 * Recomputes every seal and the chain.
 * @internal exported for integration tests; production runs it through the audit.verify-seals job.
 */
export async function verifySeals(pool: pg.Pool): Promise<VerificationReport> {
  const seals = await pool.query<{
    seal_no: string;
    first_seq: string;
    last_seq: string;
    leaf_count: number;
    merkle_root: Buffer;
    prev_seal_hash: Buffer | null;
    seal_hash: Buffer;
  }>(`select seal_no, first_seq, last_seq, leaf_count, merkle_root, prev_seal_hash, seal_hash from audit.audit_seals order by seal_no`);
  const failures: Array<VerificationReport['failures'][number]> = [];
  let prev: Buffer | null = null;
  for (const s of seals.rows) {
    const rows = await pool.query<AuditRow>(`select ${ROW_COLUMNS} from audit.audit_events where seq between $1 and $2 order by seq`, [
      s.first_seq,
      s.last_seq,
    ]);
    if (rows.rows.length !== s.leaf_count) failures.push({ sealNo: s.seal_no, reason: 'LEAF_COUNT_MISMATCH' });
    else if (!merkleRoot(rows.rows.map(leaf)).equals(s.merkle_root)) failures.push({ sealNo: s.seal_no, reason: 'ROOT_MISMATCH' });
    if ((prev === null) !== (s.prev_seal_hash === null) || (prev && s.prev_seal_hash && !prev.equals(s.prev_seal_hash)))
      failures.push({ sealNo: s.seal_no, reason: 'CHAIN_BROKEN' });
    if (!sealHash(s.prev_seal_hash, s.merkle_root, BigInt(s.first_seq), BigInt(s.last_seq), s.leaf_count).equals(s.seal_hash)) {
      failures.push({ sealNo: s.seal_no, reason: 'SEAL_HASH_MISMATCH' });
    }
    prev = s.seal_hash;
  }
  const unsealed = await pool.query<{ n: string }>(
    `select count(*) n from audit.audit_events e
      where e.seq <= coalesce((select max(last_seq) from audit.audit_seals), 0)
        and not exists (select 1 from audit.audit_seals s where e.seq between s.first_seq and s.last_seq)`,
  );
  return { sealsVerified: seals.rows.length, failures, unsealedBelowWatermark: Number(unsealed.rows[0]?.n ?? 0) };
}

export function auditJobs(pool: pg.Pool, log: Logger, options: { lagSeconds: number; maxRows: number }): JobDefinition[] {
  return [
    {
      type: AUDIT_SEAL_JOB,
      async handler() {
        // Drain the backlog in bounded batches within one job run.
        for (let i = 0; i < 20; i++) {
          const sealed = await sealNextBatch(pool, options);
          if (!sealed) return;
          log.info({ sealNo: sealed.sealNo, leafCount: sealed.leafCount }, 'audit batch sealed');
        }
      },
    },
    {
      type: AUDIT_VERIFY_JOB,
      async handler() {
        const report = await verifySeals(pool);
        // Visible to the AUDITOR viewer (Q39) through audit.seal_status(); append-only like the seals themselves.
        const firstBad = report.failures.reduce<string | null>((min, f) => (min === null || BigInt(f.sealNo) < BigInt(min) ? f.sealNo : min), null);
        await pool.query(`insert into audit.seal_verifications (seals_checked, ok, first_bad_seal_no, unsealed_below_watermark) values ($1, $2, $3, $4)`, [
          report.sealsVerified,
          report.failures.length === 0 && report.unsealedBelowWatermark === 0,
          firstBad,
          report.unsealedBelowWatermark,
        ]);
        if (report.failures.length > 0 || report.unsealedBelowWatermark > 0) {
          log.error(
            { signal: 'AUDIT_SEAL_VERIFICATION_FAILED', failures: report.failures, unsealedBelowWatermark: report.unsealedBelowWatermark },
            'security alert: audit seal verification failed',
          );
        } else {
          log.info({ sealsVerified: report.sealsVerified }, 'audit seals verified');
        }
      },
    },
  ];
}
