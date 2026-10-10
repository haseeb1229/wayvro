/** Shared setup for identity-core integration tests: migrated throwaway database and restricted-role pools. */
import { runMigrations } from '@wayvro/db';
import { FieldCipher, KeyedHasher, localKeyRing, type KeyRing } from '@wayvro/field-crypto';
import { createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import pg from 'pg';
import { ENCRYPTED_FIELDS, PhoneLookup, fieldContext } from '../src/index.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;

const SEED = 'synthetic-identity-core-test-seed-000000';

export interface Harness {
  readonly database: TestDatabase;
  readonly owner: pg.Pool;
  readonly api: pg.Pool;
  readonly worker: pg.Pool;
  readonly realtime: pg.Pool;
  close(): Promise<void>;
}

export async function harness(): Promise<Harness> {
  const database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  const logins: RestrictedLogin[] = [];
  const pool = async (role: string, max: number) => {
    const login = await createRestrictedLogin(adminUrl, database.url, role);
    logins.push(login);
    return new pg.Pool({ connectionString: login.url, max });
  };
  const owner = new pg.Pool({ connectionString: database.url, max: 4 });
  const api = await pool('wayvro_api', 6);
  const worker = await pool('wayvro_worker', 6);
  const realtime = await pool('wayvro_realtime', 2);
  return {
    database,
    owner,
    api,
    worker,
    realtime,
    async close() {
      await Promise.all([owner.end(), api.end(), worker.end(), realtime.end()]);
      for (const l of logins) await l.drop();
      await database.drop();
    },
  };
}

export function crypto(spec?: string): { ring: KeyRing; cipher: FieldCipher; hasher: KeyedHasher; lookup: PhoneLookup } {
  const ring = localKeyRing(SEED, spec);
  const hasher = new KeyedHasher(ring);
  return { ring, cipher: new FieldCipher(ring), hasher, lookup: new PhoneLookup(hasher) };
}

let phoneCounter = 0;
/** Obviously synthetic +92 numbers (never sent anywhere: no real provider exists). */
export function syntheticPhone(): `+92${string}` {
  phoneCounter++;
  return `+9230000${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}${String(phoneCounter % 10)}` as `+92${string}`;
}

/** Inserts an account owning `e164` with the given crypto (as the API role, like the sign-in path). */
export async function seedOwner(api: pg.Pool, c: ReturnType<typeof crypto>, e164: string): Promise<{ accountId: string; phoneId: string }> {
  const accountId = globalThis.crypto.randomUUID();
  const phoneId = globalThis.crypto.randomUUID();
  await api.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [accountId]);
  await api.query(
    `insert into identity.account_phones (id, account_id, phone_envelope, phone_last4, status, verified_at) values ($1, $2, $3, $4, 'VERIFIED', now())`,
    [phoneId, accountId, c.cipher.encrypt('contact', e164, fieldContext(ENCRYPTED_FIELDS.accountPhone, phoneId)), e164.slice(-4)],
  );
  await c.lookup.writeCurrentOwner(api, phoneId, e164);
  return { accountId, phoneId };
}
