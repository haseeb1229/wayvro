/**
 * Evidence pipeline (ADR-041; SEC-FILE end to end, SEC-VAULT, K07 evidence signals) against REAL services: PostgreSQL
 * as LOGIN members of wayvro_vault, SeaweedFS (S3), ClamAV clamd and the isolated sanitiser container. A clean image
 * becomes AVAILABLE as an envelope-encrypted, metadata-free canonical object; EICAR is REJECTED_MALWARE; disguised
 * formats and bombs are rejected; an unavailable scanner or sanitiser leaves the object UPLOADED (retry) — never clean;
 * exact replays on another application raise EVIDENCE_HASH_MATCH signals; the orphan job expires slots and removes
 * unreferenced storage objects (dry run first). Every image and the EICAR string are generated at run time.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { runMigrations } from '@wayvro/db';
import { FieldCipher, localKeyRing, openEvidence } from '@wayvro/field-crypto';
import { createLogger } from '@wayvro/observability';
import { bindProviders } from '@wayvro/provider-interfaces';
import type { ClaimedJob } from '@wayvro/server-runtime';
import { captureLogs, createRestrictedLogin, createTestDatabase, type RestrictedLogin, type TestDatabase } from '@wayvro/test-support';
import { ClamdScanner, DockerSanitiser, S3ObjectStorage } from '@wayvro/vault-adapters';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeWorker } from '../src/composition.js';
import { loadWorkerConfig } from '../src/config.js';
import { EVIDENCE_PROCESS_JOB, evidenceOrphansJob, evidenceProcessJob, type EvidenceJobDeps } from '../src/vault/evidence-jobs.js';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL is required (start infra with `pnpm infra:up`)');
const adminUrl: string = ADMIN_URL;
const run = randomBytes(4).toString('hex');

let database: TestDatabase;
let owner: pg.Pool;
let vault: pg.Pool;
const logins: RestrictedLogin[] = [];
const logs = captureLogs();
const log = createLogger({ service: 'worker', env: 'test', level: 'info', destination: logs.stream });
const cipher = new FieldCipher(localKeyRing('synthetic-worker-evidence-seed-0123456789'));
const storage = new S3ObjectStorage({
  endpoint: process.env['WAYVRO_S3_ENDPOINT'] ?? 'http://127.0.0.1:28333',
  region: 'us-east-1',
  accessKeyId: 'wayvro-local-access',
  secretAccessKey: 'wayvro-local-secret-not-for-production',
  forcePathStyle: true,
  areas: { quarantine: { bucket: 'wayvro-local', prefix: `wk-it-${run}/quarantine/` }, vault: { bucket: 'wayvro-local', prefix: `wk-it-${run}/vault/` } },
  maxUploadUrlSeconds: 300,
  requestTimeoutMs: 10000,
});
const scanner = new ClamdScanner({ host: '127.0.0.1', port: Number(process.env['WAYVRO_CLAMAV_PORT'] ?? '23310'), timeoutMs: 30000 });
const sanitiser = new DockerSanitiser({
  image: process.env['WAYVRO_SANITISER_IMAGE'] ?? 'wayvro-sanitiser:local',
  timeoutMs: 60000,
  memory: '768m',
  cpus: '1',
  maxOutputBytes: 8 * 1024 * 1024,
});
let deps: EvidenceJobDeps;

beforeAll(async () => {
  database = await createTestDatabase(adminUrl);
  await runMigrations(database.url);
  owner = new pg.Pool({ connectionString: database.url, max: 2 });
  const vaultLogin = await createRestrictedLogin(adminUrl, database.url, 'wayvro_vault');
  logins.push(vaultLogin);
  vault = new pg.Pool({ connectionString: vaultLogin.url, max: 3 });
  deps = { vault, storage, scanner, sanitiser, cipher, log };
});
afterAll(async () => {
  await Promise.all([owner.end(), vault.end()]);
  for (const l of logins) await l.drop();
  await database.drop();
});

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();
const noisy = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 30 } } });
const job = (evidenceId: string): ClaimedJob => ({
  id: randomUUID(),
  type: EVIDENCE_PROCESS_JOB,
  payload: { evidenceId },
  sealedPayload: null,
  attempts: 1,
  maxAttempts: 8,
  leaseToken: randomUUID(),
});

async function application(): Promise<{ app: string; doc: string; account: string }> {
  const account = randomUUID();
  const app = randomUUID();
  const doc = randomUUID();
  await owner.query(`insert into identity.accounts (id, status, preferred_locale) values ($1, 'ACTIVE', 'en')`, [account]);
  await owner.query(`insert into compliance.driver_applications (id, account_id, state, city_code) values ($1, $2, 'DOCUMENTS_PENDING', 'LHR')`, [
    app,
    account,
  ]);
  await owner.query(
    `insert into compliance.compliance_documents (id, document_type_code, subject, driver_application_id, status) values ($1, 'CNIC', 'DRIVER', $2, 'SUBMITTED')`,
    [doc, app],
  );
  return { app, doc, account };
}
/** An UPLOADED evidence object whose quarantine object holds `bytes` (as the API leaves it after completion). */
async function uploaded(a: { app: string; doc: string; account: string }, bytes: Buffer): Promise<{ id: string; quarantineKey: string }> {
  const id = randomUUID();
  const quarantineKey = `q/${randomBytes(16).toString('hex')}`;
  await storage.putObject({ area: 'quarantine', key: quarantineKey, body: bytes, contentType: 'image/jpeg' });
  await vault.query(
    `insert into vault.evidence_objects (id, owner_account_id, driver_application_id, compliance_document_id, kind, capture_source, declared_mime,
                                         declared_byte_size, status, quarantine_key, slot_expires_at, uploaded_at, source_byte_size)
     values ($1, $2, $3, $4, 'CNIC_FRONT', 'GALLERY_IMPORT', 'image/jpeg', $5, 'UPLOADED', $6, now() + interval '10 minutes', now(), $5)`,
    [id, a.account, a.app, a.doc, bytes.length, quarantineKey],
  );
  return { id, quarantineKey };
}
const row = async (id: string) =>
  (
    await owner.query<{
      status: string;
      rejection_reason: string | null;
      vault_key: string | null;
      wrapped_dek: Buffer | null;
      canonical_sha256: Buffer | null;
      pixel_width: number | null;
    }>(`select status, rejection_reason, vault_key, wrapped_dek, canonical_sha256, pixel_width from vault.evidence_objects where id = $1`, [id])
  ).rows[0];

describe('evidence.process (scan → isolated sanitise → encrypt → vault)', () => {
  it('a clean image becomes AVAILABLE: canonical, metadata-free, envelope-encrypted; quarantine emptied', async () => {
    const a = await application();
    const tagged = await noisy(1600, 1200)
      .withExif({ IFD0: { Make: 'SyntheticCam' } })
      .jpeg()
      .toBuffer();
    const e = await uploaded(a, tagged);
    await evidenceProcessJob(deps).handler(job(e.id));
    const r = await row(e.id);
    expect(r).toMatchObject({ status: 'AVAILABLE', rejection_reason: null, pixel_width: 1600 });
    expect(await storage.headObject({ area: 'quarantine', key: e.quarantineKey })).toBeNull();
    const sealed = await storage.getObject({ area: 'vault', key: r?.vault_key ?? '' });
    expect(sealed).not.toBeNull();
    expect(Buffer.from(sealed ?? []).includes('SyntheticCam')).toBe(false);
    const image = openEvidence(cipher, e.id, { wrappedDek: r?.wrapped_dek ?? Buffer.alloc(0), content: Buffer.from(sealed ?? []) });
    expect(sha256(image).equals(r?.canonical_sha256 ?? Buffer.alloc(0))).toBe(true);
    const meta = await sharp(image).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 1600, height: 1200 });
    expect(meta.exif ?? meta.icc ?? meta.xmp).toBeUndefined();
    // idempotent: a second run (duplicate delivery) changes nothing
    await evidenceProcessJob(deps).handler(job(e.id));
    expect((await row(e.id))?.vault_key).toBe(r?.vault_key);
  });

  it('EICAR → REJECTED_MALWARE; disguised PDF → REJECTED_FORMAT; bomb → REJECTED_LIMITS; quarantine always emptied', async () => {
    const a = await application();
    const eicar = Buffer.from(`X5O!P%@AP[4${String.fromCharCode(92)}PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`, 'latin1');
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 0, g: 0, b: 0 } }, limitInputPixels: false })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const cases: Array<[Buffer, string, string]> = [
      [eicar, 'REJECTED_MALWARE', 'MALWARE'],
      [Buffer.from('%PDF-1.7 synthetic'), 'REJECTED_FORMAT', 'UNSUPPORTED_FORMAT'],
      [bomb, 'REJECTED_LIMITS', 'LIMITS'],
    ];
    for (const [bytes, status, reason] of cases) {
      const e = await uploaded(a, bytes);
      await evidenceProcessJob(deps).handler(job(e.id));
      expect(await row(e.id), reason).toMatchObject({ status, rejection_reason: reason, vault_key: null });
      expect(await storage.headObject({ area: 'quarantine', key: e.quarantineKey })).toBeNull();
    }
    const audits = await owner.query<{ reason_code: string }>(`select reason_code from audit.audit_events where action = 'EVIDENCE_REJECTED' order by seq`);
    expect(audits.rows.map((x) => x.reason_code)).toEqual(expect.arrayContaining(['MALWARE', 'UNSUPPORTED_FORMAT', 'LIMITS']));
  });

  it('an unavailable scanner or sanitiser throws (retry) and leaves the object UPLOADED — never clean', async () => {
    const a = await application();
    const e = await uploaded(a, await noisy(64, 64).jpeg().toBuffer());
    const deadScanner = new ClamdScanner({ host: '127.0.0.1', port: 1, timeoutMs: 1000 });
    await expect(evidenceProcessJob({ ...deps, scanner: deadScanner }).handler(job(e.id))).rejects.toThrow();
    const missing = new DockerSanitiser({ image: 'wayvro-sanitiser:missing-image', timeoutMs: 30000, memory: '768m', cpus: '1', maxOutputBytes: 1024 });
    await expect(evidenceProcessJob({ ...deps, sanitiser: missing }).handler(job(e.id))).rejects.toThrow();
    expect((await row(e.id))?.status).toBe('UPLOADED');
    expect(await storage.headObject({ area: 'quarantine', key: e.quarantineKey })).not.toBeNull();
  });

  it('an exact replay on another application raises EVIDENCE_HASH_MATCH; the same application does not', async () => {
    const image = await noisy(320, 240).jpeg().toBuffer();
    const first = await application();
    const second = await application();
    const e1 = await uploaded(first, image);
    await evidenceProcessJob(deps).handler(job(e1.id));
    const e1b = await uploaded(first, image);
    await evidenceProcessJob(deps).handler(job(e1b.id));
    expect((await owner.query(`select 1 from compliance.duplicate_signals where subject_evidence_id = $1`, [e1b.id])).rowCount).toBe(0);
    const e2 = await uploaded(second, image);
    await evidenceProcessJob(deps).handler(job(e2.id));
    const signals = await owner.query<{ matched_application_id: string }>(
      `select matched_application_id from compliance.duplicate_signals where signal = 'EVIDENCE_HASH_MATCH' and subject_evidence_id = $1 and status = 'OPEN'`,
      [e2.id],
    );
    expect(signals.rows.map((x) => x.matched_application_id)).toEqual([first.app, first.app]);
  });

  it('a discarded upload is not processed', async () => {
    const a = await application();
    const e = await uploaded(a, await noisy(64, 64).jpeg().toBuffer());
    await owner.query(`update vault.evidence_objects set status = 'DISCARDED' where id = $1`, [e.id]);
    await evidenceProcessJob(deps).handler(job(e.id));
    expect(await row(e.id)).toMatchObject({ status: 'DISCARDED', vault_key: null });
  });
});

describe('evidence.orphans (dry run first)', () => {
  it('expires stale slots; reports, then deletes, storage objects without a live row', async () => {
    const a = await application();
    const slot = randomUUID();
    await vault.query(
      `insert into vault.evidence_objects (id, owner_account_id, driver_application_id, compliance_document_id, kind, capture_source, declared_mime,
                                           declared_byte_size, status, quarantine_key, slot_expires_at, created_at)
       values ($1, $2, $3, $4, 'CNIC_BACK', 'IN_APP_CAMERA', 'image/jpeg', 10, 'SLOT_ISSUED', $5, now() - interval '1 hour', now() - interval '2 hours')`,
      [slot, a.account, a.app, a.doc, `q/${randomBytes(16).toString('hex')}`],
    );
    const strayQuarantine = `q/${randomBytes(16).toString('hex')}`;
    const strayVault = `v/${randomBytes(16).toString('hex')}`;
    await storage.putObject({ area: 'quarantine', key: strayQuarantine, body: Buffer.from('stray'), contentType: 'image/jpeg' });
    await storage.putObject({ area: 'vault', key: strayVault, body: Buffer.from('stray'), contentType: 'application/octet-stream' });
    await evidenceOrphansJob({ vault, storage, log, dryRun: true, batch: 500, quarantineAgeMs: 0, vaultAgeMs: 0 }).handler(job(randomUUID()));
    expect((await owner.query<{ status: string }>(`select status from vault.evidence_objects where id = $1`, [slot])).rows[0]?.status).toBe('EXPIRED');
    expect(await storage.headObject({ area: 'vault', key: strayVault })).not.toBeNull();
    expect(logs.text()).toContain('dry run: nothing deleted');
    await evidenceOrphansJob({ vault, storage, log, dryRun: false, batch: 500, quarantineAgeMs: 0, vaultAgeMs: 0 }).handler(job(randomUUID()));
    expect(await storage.headObject({ area: 'quarantine', key: strayQuarantine })).toBeNull();
    expect(await storage.headObject({ area: 'vault', key: strayVault })).toBeNull();
    // AVAILABLE evidence survives reconciliation
    const live = await (async () => {
      const e = await uploaded(a, await noisy(64, 64).jpeg().toBuffer());
      await evidenceProcessJob(deps).handler(job(e.id));
      return (await row(e.id))?.vault_key ?? '';
    })();
    await evidenceOrphansJob({ vault, storage, log, dryRun: false, batch: 500, quarantineAgeMs: 0, vaultAgeMs: 0 }).handler(job(randomUUID()));
    expect(await storage.headObject({ area: 'vault', key: live })).not.toBeNull();
  });
});

describe('evidence.process edge cases', () => {
  it('a malformed payload throws; an unknown id is a no-op; a missing or oversized quarantine object is rejected', async () => {
    await expect(evidenceProcessJob(deps).handler({ ...job(randomUUID()), payload: {} })).rejects.toThrow(/evidenceId/);
    await evidenceProcessJob(deps).handler(job(randomUUID()));
    const a = await application();
    const gone = await uploaded(a, await noisy(32, 32).jpeg().toBuffer());
    await storage.deleteObject({ area: 'quarantine', key: gone.quarantineKey });
    await evidenceProcessJob(deps).handler(job(gone.id));
    expect(await row(gone.id)).toMatchObject({ status: 'REJECTED_FORMAT', rejection_reason: 'UNREADABLE' });
    const big = await uploaded(a, await noisy(32, 32).jpeg().toBuffer());
    await storage.putObject({ area: 'quarantine', key: big.quarantineKey, body: randomBytes(5000), contentType: 'image/jpeg' });
    await owner.query(`update vault.evidence_objects set declared_byte_size = 100 where id = $1`, [big.id]);
    await evidenceProcessJob(deps).handler(job(big.id));
    expect(await row(big.id)).toMatchObject({ status: 'REJECTED_LIMITS', rejection_reason: 'TOO_LARGE' });
  });

  it('a discard that lands while scanning or sanitising wins: no state change, no sealed copy left behind', async () => {
    const a = await application();
    const duringScan = await uploaded(a, await noisy(48, 48).jpeg().toBuffer());
    const discardingScanner = {
      scan: async () => {
        await owner.query(`update vault.evidence_objects set status = 'DISCARDED' where id = $1`, [duringScan.id]);
        return { verdict: 'FOUND' as const, signature: 'Synthetic.Test' };
      },
    };
    await evidenceProcessJob({ ...deps, scanner: discardingScanner }).handler(job(duringScan.id));
    expect(await row(duringScan.id)).toMatchObject({ status: 'DISCARDED', rejection_reason: null });
    const duringSanitise = await uploaded(a, await noisy(48, 48).jpeg().toBuffer());
    const before = new Set((await storage.listObjects({ area: 'vault', prefix: 'v/', limit: 1000 })).map((o) => o.key));
    const discardingSanitiser = {
      sanitise: async (bytes: Uint8Array) => {
        const result = await sanitiser.sanitise(bytes);
        await owner.query(`update vault.evidence_objects set status = 'DISCARDED' where id = $1`, [duringSanitise.id]);
        return result;
      },
    };
    await evidenceProcessJob({ ...deps, sanitiser: discardingSanitiser }).handler(job(duringSanitise.id));
    expect(await row(duringSanitise.id)).toMatchObject({ status: 'DISCARDED', vault_key: null });
    const after = (await storage.listObjects({ area: 'vault', prefix: 'v/', limit: 1000 })).map((o) => o.key).filter((k) => !before.has(k));
    expect(after).toEqual([]);
  });
});

describe('worker composition with the vault', () => {
  it('registers evidence processing only when storage, scanner AND sanitiser are bound; orphans with storage alone', async () => {
    const config = loadWorkerConfig({
      WAYVRO_ENV: 'test',
      DATABASE_URL: database.url,
      REDIS_URL: 'redis://127.0.0.1:26379',
      WAYVRO_LOCAL_KEY_SEED: 'synthetic-worker-seed-0000000000000000',
    });
    const worker = new pg.Pool({ connectionString: database.url, max: 1 });
    try {
      const all = composeWorker(
        config,
        worker,
        log,
        bindProviders('test', { objectStorage: storage, malwareScanner: scanner, imageSanitiser: sanitiser }),
        vault,
      );
      expect(all.runner.types).toEqual(expect.arrayContaining(['evidence.process', 'evidence.orphans']));
      const storageOnly = composeWorker(config, worker, log, bindProviders('test', { objectStorage: storage }), vault);
      expect(storageOnly.runner.types).toContain('evidence.orphans');
      expect(storageOnly.runner.types).not.toContain('evidence.process');
      const noVault = composeWorker(config, worker, log, bindProviders('test', { objectStorage: storage, malwareScanner: scanner, imageSanitiser: sanitiser }));
      expect(noVault.runner.types.some((t) => t.startsWith('evidence.'))).toBe(false);
    } finally {
      await worker.end();
    }
  });
});

describe('SEC-LOG', () => {
  it('pipeline logs carry ids and codes only — never image bytes, metadata, storage keys or the EICAR payload', () => {
    const text = logs.text();
    for (const leak of ['EICAR-STANDARD', 'SyntheticCam', 'wk-it-']) expect(text, leak).not.toContain(leak);
    expect(text).not.toMatch(/[qv]\/[0-9a-f]{32}/);
  });
});
