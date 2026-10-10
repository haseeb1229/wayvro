/**
 * Versioned deterministic phone lookups (data model §8.3). Lookup values are HMAC-SHA-256(phone_lookup key[v], E.164)
 * stored with their key version in `identity.phone_lookup_index`, one row per live version, so current-owner uniqueness
 * is enforced by the database within every version.
 *
 * Rotation without a destructive cut-over (platform.key_rotations, target PHONE_LOOKUP_TARGET):
 *   dual-write — every write inserts rows for all live (non-retired) versions;
 *   BACKFILL   — dual-read: lookups match any live version while the backfill job adds new-version rows;
 *   READ_SWITCHED / RETIRE_PENDING — reads use the ACTIVE version only;
 *   contract   — old-version rows are deleted, then the old key is RETIRED.
 */
import type { KeyedHasher } from '@wayvro/field-crypto';
import type { Queryable } from '@wayvro/server-runtime';
import { PHONE_LOOKUP_TARGET } from './fields.js';

export class PhoneLookup {
  constructor(private readonly hasher: KeyedHasher) {}

  /** Lookup digests to match on reads, according to the open rotation's phase. */
  async readDigests(q: Queryable, e164: string): Promise<ReadonlyArray<{ version: number; digest: Buffer }>> {
    const live = this.hasher.live('phone_lookup', e164);
    const open = await q.query<{ phase: string }>(`select phase from platform.key_rotations where target = $1 and phase not in ('DONE', 'ABANDONED')`, [
      PHONE_LOOKUP_TARGET,
    ]);
    const dualRead = open.rows[0]?.phase === 'BACKFILL';
    return dualRead ? live : live.slice(0, 1);
  }

  /** The account that currently owns this verified phone, if any. */
  async currentOwner(q: Queryable, e164: string): Promise<{ accountId: string; accountPhoneId: string } | null> {
    const digests = await this.readDigests(q, e164);
    const r = await q.query<{ account_id: string; account_phone_id: string }>(
      `select p.account_id, l.account_phone_id
         from identity.phone_lookup_index l
         join identity.account_phones p on p.id = l.account_phone_id
        where l.is_current_owner
          and p.status = 'VERIFIED'
          and (l.lookup_key_version, l.lookup_hash) in (select * from unnest($1::smallint[], $2::bytea[]))
        limit 1`,
      [digests.map((d) => d.version), digests.map((d) => d.digest)],
    );
    const row = r.rows[0];
    return row ? { accountId: row.account_id, accountPhoneId: row.account_phone_id } : null;
  }

  /**
   * Inserts current-owner rows for every live version (dual-write). A concurrent owner for the same phone makes the
   * partial unique index raise 23505, which the caller turns into "sign in to the winner's account".
   */
  async writeCurrentOwner(q: Queryable, accountPhoneId: string, e164: string): Promise<void> {
    const digests = this.hasher.live('phone_lookup', e164);
    await q.query(
      `insert into identity.phone_lookup_index (account_phone_id, lookup_key_version, lookup_hash, is_current_owner)
       select $1, v, h, true from unnest($2::smallint[], $3::bytea[]) as t(v, h)`,
      [accountPhoneId, digests.map((d) => d.version), digests.map((d) => d.digest)],
    );
  }

  /** Digest under the ACTIVE version (challenge rows, rate-limit keys). */
  activeDigest(e164: string): { version: number; digest: Buffer } {
    return this.hasher.active('phone_lookup', e164);
  }
}
