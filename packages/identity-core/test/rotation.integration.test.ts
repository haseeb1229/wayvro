/**
 * PROP-CRYPTO (database part): field-key re-encryption and lookup-key rotation are resumable after a crash at any
 * batch, preserve concurrent user writes, never fall back to plaintext, dual-read finds records under either version,
 * and current-owner uniqueness holds within every version during the backfill. Executed as the worker role.
 */
import { randomBytes } from 'node:crypto';
import { createLogger } from '@wayvro/observability';
import { captureLogs } from '@wayvro/test-support';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ENCRYPTED_FIELDS,
  KeyRotationError,
  completeRotation,
  contractLookupRotation,
  fieldContext,
  keyRotationJob,
  runRotationStep,
  startFieldRotation,
  startLookupRotation,
  type RotationDeps,
} from '../src/index.js';
import { crypto, harness, seedOwner, syntheticPhone, type Harness } from './helpers.js';
import { JobRunner } from '@wayvro/server-runtime';

const logs = captureLogs();
const log = createLogger({ service: 'worker', env: 'test', level: 'info', destination: logs.stream });
// Every test rotates keys of the whole table, so each gets its own throwaway database.
let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const deps = (spec: string, batchSize = 3): RotationDeps => {
  const c = crypto(spec);
  return { db: h.worker, ring: c.ring, cipher: c.cipher, hasher: c.hasher, log, batchSize };
};
const rotation = async (id: string) =>
  (
    await h.owner.query<{ phase: string; processed_count: string; rewritten_count: string; skipped_concurrent_count: string; conflict_count: string }>(
      `select * from platform.key_rotations where id = $1`,
      [id],
    )
  ).rows[0];
const keyIdOf = (envelope: Buffer) => envelope.subarray(3, 3 + (envelope[2] ?? 0)).toString('ascii');

describe('field-key rotation (contact v1 -> v2)', () => {
  it('re-encrypts every envelope, resumes after a crash, preserves a concurrent user write, then completes', async () => {
    const v1 = crypto('contact.v1=ACTIVE,phone_lookup.v1=ACTIVE');
    const phones = Array.from({ length: 10 }, () => syntheticPhone());
    const seeded = [];
    for (const p of phones) seeded.push(await seedOwner(h.api, v1, p));

    const rotating = deps('contact.v1=DECRYPT_ONLY,contact.v2=ACTIVE,phone_lookup.v1=ACTIVE');
    // Precondition errors: no DECRYPT_ONLY version, unknown target.
    await expect(startFieldRotation(deps('contact.v1=ACTIVE,phone_lookup.v1=ACTIVE'), ENCRYPTED_FIELDS.accountPhone.field)).rejects.toThrow(KeyRotationError);
    await expect(startFieldRotation(rotating, 'identity.nope.nope')).rejects.toThrow(/unknown field/);
    const id = await startFieldRotation(rotating, ENCRYPTED_FIELDS.accountPhone.field);
    await expect(startFieldRotation(rotating, ENCRYPTED_FIELDS.accountPhone.field)).rejects.toThrow(/already open/);

    // Batch 1 commits; then a "crash": a batch whose transaction aborts must leave cursor/counters untouched.
    expect(await runRotationStep(rotating, id)).toBe('continue');
    const afterFirst = await rotation(id);
    const brokenRing = { ...rotating, cipher: crypto('contact.v2=ACTIVE,phone_lookup.v1=ACTIVE').cipher };
    await expect(runRotationStep(brokenRing, id)).rejects.toThrow(/UNKNOWN_KEY|decryption/);
    expect(await rotation(id)).toEqual(afterFirst);

    // A user write commits on another connection exactly between the engine's read of a row and its CAS on that row:
    // the engine's statement is intercepted and the user write is awaited first (deterministic interleaving).
    // The engine walks rows in id order, so the highest id is guaranteed not to have been processed by batch 1.
    const target = [...seeded].sort((a, b) => a.phoneId.localeCompare(b.phoneId)).at(-1);
    if (!target) throw new Error('seed');
    const userValue = rotating.cipher.encrypt('contact', '+923009999999', fieldContext(ENCRYPTED_FIELDS.accountPhone, target.phoneId));
    let interleaved = false;
    const interceptingPool = {
      connect: async () => {
        const client = await h.worker.connect();
        return new Proxy(client, {
          get(t, p, r) {
            if (p !== 'query') return Reflect.get(t, p, r) as unknown;
            return async (text: string, params?: unknown[]) => {
              if (!interleaved && text.startsWith('update identity.account_phones set phone_envelope') && params?.[1] === target.phoneId) {
                interleaved = true;
                await h.owner.query(`update identity.account_phones set phone_envelope = $1 where id = $2`, [userValue, target.phoneId]);
              }
              return t.query(text, params);
            };
          },
        });
      },
    } as unknown as RotationDeps['db'];
    const intercepted = { ...rotating, db: interceptingPool };
    let outcome = await runRotationStep(intercepted, id);
    while (outcome === 'continue') outcome = await runRotationStep(intercepted, id);
    expect(interleaved).toBe(true);
    expect(Number((await rotation(id))?.skipped_concurrent_count)).toBe(1);
    expect(outcome).toBe('switched');
    const done = await rotation(id);
    expect(done?.phase).toBe('RETIRE_PENDING');
    expect(Number(done?.processed_count)).toBeGreaterThanOrEqual(10);

    const rows = await h.owner.query<{ id: string; phone_envelope: Buffer }>(`select id, phone_envelope from identity.account_phones`);
    for (const r of rows.rows) expect(keyIdOf(r.phone_envelope)).toBe('contact.v2');
    // The concurrent user value survived (never overwritten by the re-encryption).
    const kept = rows.rows.find((r) => r.id === target.phoneId);
    expect(rotating.cipher.decryptString('contact', kept?.phone_envelope ?? Buffer.alloc(0), fieldContext(ENCRYPTED_FIELDS.accountPhone, target.phoneId))).toBe(
      '+923009999999',
    );
    // Every other value decrypts to its original plaintext under v2 only.
    const v2only = crypto('contact.v1=RETIRED,contact.v2=ACTIVE,phone_lookup.v1=ACTIVE');
    for (let i = 0; i < seeded.length; i++) {
      const s = seeded[i];
      if (!s || s.phoneId === target.phoneId) continue;
      const env = rows.rows.find((r) => r.id === s.phoneId)?.phone_envelope ?? Buffer.alloc(0);
      expect(v2only.cipher.decryptString('contact', env, fieldContext(ENCRYPTED_FIELDS.accountPhone, s.phoneId))).toBe(phones[i]);
    }

    // complete needs the old key RETIRED first, then re-verifies.
    await expect(completeRotation(rotating, id)).rejects.toThrow(/must be RETIRED/);
    await completeRotation({ ...rotating, ring: v2only.ring, cipher: v2only.cipher }, id);
    expect((await rotation(id))?.phase).toBe('DONE');
    await expect(completeRotation(rotating, id)).rejects.toThrow(/RETIRE_PENDING/);
    expect(await runRotationStep(rotating, id)).toBe('idle');
  });

  it('runs as a resumable job through the job runner', async () => {
    const id = await startFieldRotation(deps('contact.v2=DECRYPT_ONLY,contact.v3=ACTIVE,phone_lookup.v1=ACTIVE'), ENCRYPTED_FIELDS.challengePhone.field);
    const d = deps('contact.v2=DECRYPT_ONLY,contact.v3=ACTIVE,phone_lookup.v1=ACTIVE', 2);
    const runner = new JobRunner(h.worker, [keyRotationJob(d, 1)], { workerId: 'rot', leaseMs: 30000, batchSize: 5, log });
    for (let i = 0; i < 10 && (await rotation(id))?.phase === 'BACKFILL'; i++) await runner.runOnce();
    expect((await rotation(id))?.phase).toBe('RETIRE_PENDING');
  });
});

describe('lookup-key rotation (phone_lookup v1 -> v2)', () => {
  it('dual-writes, dual-reads during backfill, switches reads, contracts, and keeps per-version uniqueness', async () => {
    const before = crypto('contact.v2=ACTIVE,phone_lookup.v1=ACTIVE');
    const existing = syntheticPhone();
    const owner = await seedOwner(h.api, before, existing);

    const spec = 'contact.v2=ACTIVE,phone_lookup.v1=DECRYPT_ONLY,phone_lookup.v2=ACTIVE';
    const during = crypto(spec);
    const d = deps(spec, 2);
    const id = await startLookupRotation(d);
    // A phone created during the rotation is dual-written under v1 and v2 immediately.
    const fresh = syntheticPhone();
    const freshOwner = await seedOwner(h.api, during, fresh);
    const versions = await h.owner.query<{ v: number }>(`select lookup_key_version v from identity.phone_lookup_index where account_phone_id = $1 order by 1`, [
      freshOwner.phoneId,
    ]);
    expect(versions.rows.map((r) => r.v)).toEqual([1, 2]);
    // Dual-read: the not-yet-backfilled phone is still found (via v1).
    expect(await during.lookup.currentOwner(h.api, existing)).toMatchObject({ accountId: owner.accountId });

    let outcome = await runRotationStep(d, id);
    while (outcome === 'continue') outcome = await runRotationStep(d, id);
    expect(outcome).toBe('switched');
    expect((await rotation(id))?.phase).toBe('READ_SWITCHED');
    // Reads now use v2 only and still find every owner; uniqueness holds within v2.
    expect(await during.lookup.currentOwner(h.api, existing)).toMatchObject({ accountId: owner.accountId });
    await expect(seedOwner(h.api, during, existing)).rejects.toMatchObject({ code: '23505' });

    expect(await contractLookupRotation(d, id)).toBeGreaterThan(0);
    expect((await h.owner.query(`select 1 from identity.phone_lookup_index where lookup_key_version = 1`)).rowCount).toBe(0);
    await expect(contractLookupRotation(d, id)).rejects.toThrow(/READ_SWITCHED/);
    const retired = crypto('contact.v2=ACTIVE,phone_lookup.v1=RETIRED,phone_lookup.v2=ACTIVE');
    expect(await retired.lookup.currentOwner(h.api, fresh)).toMatchObject({ accountId: freshOwner.accountId });
    await completeRotation({ ...d, ring: retired.ring }, id);
    expect((await rotation(id))?.phase).toBe('DONE');
  });

  it('a current-owner collision in the new version is a counted, logged data conflict that blocks the switch', async () => {
    const spec = 'contact.v2=ACTIVE,phone_lookup.v2=DECRYPT_ONLY,phone_lookup.v3=ACTIVE';
    const c = crypto(spec);
    const phone = syntheticPhone();
    const a = await seedOwner(h.api, crypto('contact.v2=ACTIVE,phone_lookup.v2=ACTIVE'), phone);
    // Inject an inconsistent pre-existing v3 row that claims the same phone for another account's phone record.
    const other = await seedOwner(h.api, crypto('contact.v2=ACTIVE,phone_lookup.v2=ACTIVE'), syntheticPhone());
    await h.owner.query(
      `insert into identity.phone_lookup_index (account_phone_id, lookup_key_version, lookup_hash, is_current_owner) values ($1, 3, $2, true)`,
      [other.phoneId, c.hasher.at('phone_lookup', 3, phone)],
    );
    const d = deps(spec, 50);
    const id = await startLookupRotation(d);
    let outcome = await runRotationStep(d, id);
    while (outcome === 'continue') outcome = await runRotationStep(d, id);
    expect(outcome).toBe('blocked');
    const row = await rotation(id);
    expect(row?.phase).toBe('BACKFILL');
    expect(Number(row?.conflict_count)).toBe(1);
    expect(logs.text()).toContain('lookup rotation data conflict');
    expect(logs.text()).not.toContain(phone);
    expect(a.accountId).not.toBe(other.accountId);
    await h.owner.query(`update platform.key_rotations set phase = 'ABANDONED', completed_at = now() where id = $1`, [id]);
  });

  it('never accepts a tampered envelope during re-encryption (fails closed, no plaintext fallback)', async () => {
    const spec = 'contact.v2=DECRYPT_ONLY,contact.v4=ACTIVE,phone_lookup.v3=ACTIVE';
    const before = crypto('contact.v2=ACTIVE,phone_lookup.v3=ACTIVE');
    const s = await seedOwner(h.api, before, syntheticPhone());
    const bad = Buffer.from(before.cipher.encrypt('contact', 'x', fieldContext(ENCRYPTED_FIELDS.accountPhone, s.phoneId)));
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 0xff;
    await h.owner.query(`update identity.account_phones set phone_envelope = $1 where id = $2`, [bad, s.phoneId]);
    const d = deps(spec, 500);
    const id = await startFieldRotation(d, ENCRYPTED_FIELDS.accountPhone.field);
    await expect(runRotationStep(d, id)).rejects.toThrow(/AUTHENTICATION_FAILED/);
    expect((await rotation(id))?.processed_count).toBe('0');
    await h.owner.query(`update identity.account_phones set phone_envelope = $1 where id = $2`, [randomBytes(48), s.phoneId]);
    await h.owner.query(`update platform.key_rotations set phase = 'ABANDONED', completed_at = now() where id = $1`, [id]);
  });
});
