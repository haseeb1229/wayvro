/**
 * Versioned deterministic phone lookups (data model §8.3). Lookup values are HMAC-SHA-256(phone_lookup key[v], E.164)
 * stored with their key version in `identity.phone_lookup_index`, so current-owner uniqueness is enforced by the
 * database within every version.
 *
 * Which versions are read and written is decided by the rotation ledger (`platform.key_rotations`, target
 * PHONE_LOOKUP_TARGET), never by the key ring alone — a ring that already holds a newer ACTIVE key before its rotation
 * starts must not hide rows that exist only under the older version:
 *
 *   latest rotation          | write set     | read set
 *   ─────────────────────────┼───────────────┼──────────────
 *   none                     | authoritative | authoritative   (authoritative = oldest live version of the ring)
 *   BACKFILL                 | to + from     | to + from       (dual-write / dual-read)
 *   READ_SWITCHED            | to            | to
 *   RETIRE_PENDING           | to            | to
 *   DONE                     | to            | to
 *   ABANDONED                | from          | from            (abandon deletes the partial `to` rows)
 *
 * In every steady state the single version equals the ring's ACTIVE key. A required version that is not live in the
 * ring fails closed (LookupKeyStateError → 500), never "try every key".
 *
 * Synchronisation with rotation phase changes uses a PostgreSQL transaction-level advisory lock per target (not a
 * process-local lock): every lookup write takes it SHARED before reading the ledger and keeps it until its
 * transaction ends; every transition that changes the write set or deletes rows (start, contract, abandon, complete)
 * takes it EXCLUSIVE first. A writer can therefore never observe BACKFILL, pause, and insert old-version rows after
 * the contract step deleted them — the contract waits for that writer's commit and deletes its rows too.
 */
import { createHash } from 'node:crypto';
import type { KeyedHasher } from '@wayvro/field-crypto';
import type { Queryable } from '@wayvro/server-runtime';
import { PHONE_LOOKUP_TARGET } from './fields.js';

export class LookupKeyStateError extends Error {
  override readonly name = 'LookupKeyStateError';
}

/** Advisory-lock namespace for lookup-rotation fencing ("WAYV"). */
const LOCK_NAMESPACE = 0x57415956;

/** Stable 32-bit lock key of a rotation target (both lock sides derive it the same way). */
function rotationLockKey(target: string): number {
  return createHash('sha256').update(target).digest().readInt32BE(0);
}

/** Takes the target's rotation lock until the end of the caller's transaction (SHARED for writers/readers). */
export async function lockRotationTarget(q: Queryable, target: string, mode: 'SHARED' | 'EXCLUSIVE'): Promise<void> {
  const fn = mode === 'SHARED' ? 'pg_advisory_xact_lock_shared' : 'pg_advisory_xact_lock';
  await q.query(`select ${fn}($1::int, $2::int)`, [LOCK_NAMESPACE, rotationLockKey(target)]);
}

interface LedgerRow {
  phase: string;
  from_version: number;
  to_version: number;
}

export interface LookupDigest {
  readonly version: number;
  readonly digest: Buffer;
}

export interface LookupPlan {
  readonly read: readonly LookupDigest[];
  readonly write: readonly LookupDigest[];
}

export class PhoneLookup {
  constructor(private readonly hasher: KeyedHasher) {}

  /**
   * Read and write version sets for `e164`. Must run inside the caller's transaction when followed by a write: the
   * shared rotation lock is held until that transaction ends.
   */
  async plan(q: Queryable, e164: string): Promise<LookupPlan> {
    await lockRotationTarget(q, PHONE_LOOKUP_TARGET, 'SHARED');
    const r = await q.query<LedgerRow>(
      `select phase, from_version, to_version from platform.key_rotations where target = $1 order by started_at desc, id desc limit 1`,
      [PHONE_LOOKUP_TARGET],
    );
    const at = (version: number): LookupDigest => {
      const digest = this.hasher.at('phone_lookup', version, e164);
      if (!digest) throw new LookupKeyStateError(`phone_lookup.v${String(version)} is required by the rotation ledger but is not live in the key ring`);
      return { version, digest };
    };
    const latest = r.rows[0];
    if (!latest) {
      const oldest = this.hasher.live('phone_lookup', e164).at(-1);
      if (!oldest) throw new LookupKeyStateError('no live phone_lookup key');
      return { read: [oldest], write: [oldest] };
    }
    switch (latest.phase) {
      case 'BACKFILL': {
        const both = [at(latest.to_version), at(latest.from_version)];
        return { read: both, write: both };
      }
      case 'READ_SWITCHED':
      case 'RETIRE_PENDING':
      case 'DONE': {
        const to = [at(latest.to_version)];
        return { read: to, write: to };
      }
      case 'ABANDONED': {
        const from = [at(latest.from_version)];
        return { read: from, write: from };
      }
      default:
        throw new LookupKeyStateError(`unknown rotation phase ${latest.phase}`);
    }
  }

  /** The account that currently owns this verified phone, if any. */
  async currentOwner(q: Queryable, e164: string): Promise<{ accountId: string; accountPhoneId: string } | null> {
    const { read } = await this.plan(q, e164);
    const r = await q.query<{ account_id: string; account_phone_id: string }>(
      `select p.account_id, l.account_phone_id
         from identity.phone_lookup_index l
         join identity.account_phones p on p.id = l.account_phone_id
        where l.is_current_owner
          and p.status = 'VERIFIED'
          and (l.lookup_key_version, l.lookup_hash) in (select * from unnest($1::smallint[], $2::bytea[]))
        limit 1`,
      [read.map((d) => d.version), read.map((d) => d.digest)],
    );
    const row = r.rows[0];
    return row ? { accountId: row.account_id, accountPhoneId: row.account_phone_id } : null;
  }

  /**
   * Inserts current-owner rows for the plan's write set. MUST run inside the caller's transaction (the shared rotation
   * lock taken by `plan` is what fences it against contract/abandon). A concurrent owner for the same phone makes the
   * partial unique index raise 23505, which the caller turns into "sign in to the winner's account".
   */
  async writeCurrentOwner(tx: Queryable, accountPhoneId: string, e164: string): Promise<void> {
    const { write } = await this.plan(tx, e164);
    await tx.query(
      `insert into identity.phone_lookup_index (account_phone_id, lookup_key_version, lookup_hash, is_current_owner)
       select $1, v, h, true from unnest($2::smallint[], $3::bytea[]) as t(v, h)`,
      [accountPhoneId, write.map((d) => d.version), write.map((d) => d.digest)],
    );
  }

  /** Digest under the ACTIVE version (challenge rows, rate-limit keys — never ownership decisions). */
  activeDigest(e164: string): LookupDigest {
    return this.hasher.active('phone_lookup', e164);
  }
}
