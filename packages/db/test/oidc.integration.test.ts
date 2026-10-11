/**
 * Migration 0008_oidc against real PostgreSQL: nonce bindings (sign-in ⇒ installation, link/recovery ⇒ session), one
 * LINKED owner per (provider, subject) and one LINKED identity per (account, provider), subject erasure only once
 * unlinked, OIDC session assurance with the phone step-up flag, the OIDC-proof recovery kind, and GRANTS executed as
 * LOGIN members of the restricted roles. Synthetic data only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required for integration tests (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;
const pgCode = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

let database: TestDatabase;
let owner: pg.Pool;
let api: pg.Pool;
let worker: pg.Pool;
const logins: RestrictedLogin[] = [];
beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 3 });
  for (const [group, assign] of [
    ['wayvro_api', (p: pg.Pool) => (api = p)],
    ['wayvro_worker', (p: pg.Pool) => (worker = p)],
  ] as const) {
    const login = await createRestrictedLogin(adminUrl, database.url, group);
    logins.push(login);
    assign(new pg.Pool({ connectionString: login.url, max: 2 }));
  }
});
afterAll(async () => {
  await Promise.all([owner.end(), api.end(), worker.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

async function account(): Promise<{ id: string; session: string }> {
  const id = randomUUID();
  const deviceId = randomUUID();
  const session = randomUUID();
  await owner.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [id]);
  await owner.query(
    `insert into identity.account_devices (id, account_id, installation_hash, platform, app_version, first_verified_at, last_seen_at, trust_state) values ($1, $2, $3, 'ANDROID', '1.0.0', now(), now(), 'NEW')`,
    [deviceId, id, randomBytes(32)],
  );
  await owner.query(
    `insert into identity.sessions (id, account_id, device_id, status, assurance, access_token_hash, access_expires_at, idle_expires_at, absolute_expires_at, app_version)
     values ($1, $2, $3, 'ACTIVE', 'OTP', $4, now() + interval '15 minutes', now() + interval '1 day', now() + interval '2 days', '1.0.0')`,
    [session, id, deviceId, randomBytes(32)],
  );
  return { id, session };
}
const identity = (accountId: string, provider: string, subject: string) =>
  owner.query(`insert into identity.oidc_identities (id, account_id, provider, subject, status) values ($1, $2, $3, $4, 'LINKED') returning id`, [
    randomUUID(),
    accountId,
    provider,
    subject,
  ]);

describe('0008 constraints', () => {
  it('nonces: sign-in nonces bind an installation, link/recovery nonces a session; hashes are unique', async () => {
    const a = await account();
    const nonce = (purpose: string, inst: Buffer | null, session: string | null, hash = randomBytes(32)) =>
      owner.query(
        `insert into identity.oidc_nonces (id, nonce_sha256, purpose, installation_hash, session_id, expires_at) values ($1, $2, $3, $4, $5, now() + interval '5 minutes')`,
        [randomUUID(), hash, purpose, inst, session],
      );
    expect(await pgCode(nonce('SIGN_IN', null, null))).toBe('23514');
    expect(await pgCode(nonce('SIGN_IN', randomBytes(32), a.session))).toBe('23514');
    expect(await pgCode(nonce('LINK', randomBytes(32), a.session))).toBe('23514');
    expect(await pgCode(nonce('RECOVERY', null, null))).toBe('23514');
    const hash = randomBytes(32);
    await nonce('SIGN_IN', randomBytes(32), null, hash);
    expect(await pgCode(nonce('LINK', null, a.session, hash))).toBe('23505');
  });

  it('identities: one LINKED owner per subject and one per (account, provider); subject erased only once unlinked', async () => {
    const a = await account();
    const b = await account();
    const sub = `sub-${randomUUID()}`;
    const linked = ((await identity(a.id, 'GOOGLE', sub)).rows[0] as { id: string }).id;
    expect(await pgCode(identity(b.id, 'GOOGLE', sub))).toBe('23505');
    expect(await pgCode(identity(a.id, 'GOOGLE', `sub-${randomUUID()}`))).toBe('23505');
    await identity(a.id, 'APPLE', sub); // same opaque value under another provider is a different identity
    expect(await pgCode(owner.query(`update identity.oidc_identities set subject = null where id = $1`, [linked]))).toBe('23514');
    expect(await pgCode(owner.query(`update identity.oidc_identities set status = 'UNLINKED' where id = $1`, [linked]))).toBe('23514');
    await owner.query(`update identity.oidc_identities set status = 'UNLINKED', unlinked_at = now(), subject = null where id = $1`, [linked]);
    await identity(b.id, 'GOOGLE', sub); // the subject is free again
  });

  it('sessions: OIDC assurance with the phone step-up flag; the flag never on an OTP session', async () => {
    const a = await account();
    expect(await pgCode(owner.query(`update identity.sessions set phone_step_up_required = true where id = $1`, [a.session]))).toBe('23514');
    await owner.query(`update identity.sessions set assurance = 'OIDC', phone_step_up_required = true where id = $1`, [a.session]);
    expect(await pgCode(owner.query(`update identity.sessions set assurance = 'MAGIC' where id = $1`, [a.session]))).toBe('23514');
  });

  it('the OIDC-proof recovery names its identity and starts in the cooldown', async () => {
    const a = await account();
    const caller = await account();
    const proof = ((await identity(a.id, 'GOOGLE', `sub-${randomUUID()}`)).rows[0] as { id: string }).id;
    const request = (status: string, proofId: string | null) =>
      owner.query(
        `insert into identity.phone_change_requests (id, account_id, kind, new_phone_envelope, new_phone_last4, new_phone_lookup_version, new_phone_lookup_hash, status,
                                                     requested_by_account_id, proof_oidc_identity_id, cooldown_until, expires_at)
         values ($1, $2, 'RECOVERY_OIDC_PROOF', $3, '1234', 1, $4, $5, $6, $7, now() + interval '72 hours', now() + interval '30 days')`,
        [randomUUID(), a.id, randomBytes(40), randomBytes(32), status, caller.id, proofId],
      );
    expect(await pgCode(request('COOLDOWN', null))).toBe('23514');
    expect(await pgCode(request('MANUAL_REVIEW', proof))).toBe('23514');
    await request('COOLDOWN', proof);
  });
});

describe('0008 grants', () => {
  it('the worker purges nonces and unlinks/erases identities, nothing else; the API cannot delete either', async () => {
    const a = await account();
    await identity(a.id, 'GOOGLE', `sub-${randomUUID()}`);
    await worker.query(`delete from identity.oidc_nonces where id in (select id from identity.oidc_nonces where created_at < now() - interval '1 day')`);
    await worker.query(
      `update identity.oidc_identities set status = 'UNLINKED', unlinked_at = coalesce(unlinked_at, now()), subject = null, version = version + 1 where account_id = $1`,
      [a.id],
    );
    expect(await pgCode(worker.query(`select subject from identity.oidc_identities`))).toBe('42501');
    expect(await pgCode(worker.query(`select nonce_sha256 from identity.oidc_nonces`))).toBe('42501');
    expect(
      await pgCode(
        worker.query(`insert into identity.oidc_identities (id, account_id, provider, subject, status) values ($1, $2, 'GOOGLE', 'x', 'LINKED')`, [
          randomUUID(),
          a.id,
        ]),
      ),
    ).toBe('42501');
    expect(await pgCode(api.query(`delete from identity.oidc_identities`))).toBe('42501');
    expect(await pgCode(api.query(`delete from identity.oidc_nonces`))).toBe('42501');
  });
});
