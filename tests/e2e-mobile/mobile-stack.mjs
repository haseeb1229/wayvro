#!/usr/bin/env node
/*
 * SP-08 mobile E2E stack (ADR-052; docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md §3.3/§4), following
 * tests/e2e-web/ops-stack.mjs: a throwaway database `wayvro_e2e_mobile` (dropped and recreated on every run, owned by
 * this script only), migrations, two bootstrap STAFF_ADMINs (makers/approvers of the seeded release-control rows), the
 * synthetic catalog and its synthetic rate cards (60 s quote TTL), the API local runner
 * (ADR-045: dist-dev, recording OTP sink, synthetic geo doubles with the local-only `/__local/geo-control` fault route)
 * on its own port, the synthetic landmark aliases (one ur-Latn alias approved by a seeded staff admin), then accounts
 * A–G + APPLICANT + R through the public sign-in/consent endpoints (tests/e2e-mobile/seed-accounts.mjs). Writes build-logs/e2e-mobile/stack.json for
 * tests/e2e-mobile/run-flows.mjs and keeps the API running until SIGINT/SIGTERM.
 *
 * Prerequisites: compose infrastructure up (`pnpm infra:up`), `pnpm build`, `pnpm build:local`. Synthetic data only.
 * Environment (all optional): DATABASE_URL (admin URL of the local PostgreSQL), REDIS_URL, WAYVRO_E2E_API_PORT (4120),
 * WAYVRO_E2E_MOBILE_DB (wayvro_e2e_<name>, so parallel checkouts never drop each other's database).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedAccounts } from './seed-accounts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'build-logs', 'e2e-mobile');
const requireFromDb = createRequire(join(ROOT, 'packages/db/package.json'));
const pg = requireFromDb('pg');
const fileUrl = (path) => new URL(`file://${join(ROOT, path).replaceAll('\\', '/')}`).href;
const say = (line) => process.stdout.write(`mobile-stack: ${line}\n`);

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://wayvro:wayvro-local-only@127.0.0.1:25432/wayvro';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:26379';
const API_PORT = process.env.WAYVRO_E2E_API_PORT ?? '4120';
const DB = process.env.WAYVRO_E2E_MOBILE_DB ?? 'wayvro_e2e_mobile';
if (!/^wayvro_e2e_[a-z0-9_]{1,40}$/.test(DB)) throw new Error('WAYVRO_E2E_MOBILE_DB must match wayvro_e2e_<name>');
if (!/^[1-9][0-9]{3,4}$/.test(API_PORT)) throw new Error('WAYVRO_E2E_API_PORT must be a port number');
/** SP-08 §4: a short quote TTL so expiry is testable — the database minimum (rate card CHECK 60–1800 s). */
const QUOTE_TTL_SECONDS = '60';
const started = Date.now();
const dbUrl = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB}`;
  return u.toString();
})();

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`drop database if exists ${DB} with (force)`);
await admin.query(`create database ${DB}`);
await admin.end();

const { runMigrations } = await import(fileUrl('packages/db/dist/index.js'));
await runMigrations(dbUrl);
const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
const { bootstrapStaffAdmins } = await import(fileUrl('apps/api/dist/staff/bootstrap.js'));
const silent = { info() {}, warn() {}, error() {} };
const staff = await bootstrapStaffAdmins(
  pool,
  [
    { displayName: 'E2E Mobile Admin One', workEmail: 'e2e.mobile.one@example.org' },
    { displayName: 'E2E Mobile Admin Two', workEmail: 'e2e.mobile.two@example.org' },
  ],
  3600,
  silent,
);

// Synthetic catalog (P3.1) and synthetic pricing (P3.3: placeholder tax policy + ACTIVE ECONOMY/COMFORT rate cards)
// through the one dev-only seed module (refuses non-local environments and non-loopback hosts).
const { seedSyntheticCatalog } = await import(fileUrl('packages/test-support/dist/index.js'));
const catalog = await seedSyntheticCatalog({
  env: 'local',
  databaseUrl: dbUrl,
  quoteTtlSeconds: Number(QUOTE_TTL_SECONDS),
  // all-day hours: quote flows must not depend on the runner's wall clock (a CI run at 23:56 PKT was refused as
  // outside hours — correct server behaviour, wrong test precondition)
  allDayServiceHours: true,
  log: (line) => say(`catalog: ${line}`),
});
// Quote flows run only when the seed really produced ACTIVE rate cards; otherwise they are NOT RUN with the reason, never PASS.
const activeCards = (await pool.query(`select count(*)::int n from pricing.rate_cards where status = 'ACTIVE' and is_synthetic`)).rows[0]?.n ?? 0;
const pricing =
  activeCards > 0
    ? { seeded: true, quoteTtlSeconds: Number(QUOTE_TTL_SECONDS), activeRateCards: activeCards }
    : { seeded: false, reason: 'the synthetic seed produced no ACTIVE rate card' };
say(`pricing: ${pricing.seeded ? `seeded (${String(activeCards)} ACTIVE synthetic rate cards)` : pricing.reason}`);

// SRCH-03 (A06): the synthetic landmark aliases are seeded PROPOSED by an inert OFFBOARDED proposer; ONE Roman-Urdu
// alias is then approved by a seeded STAFF_ADMIN (approver ≠ creator — the database maker-checker CHECK and guard
// trigger enforce it; nothing is bypassed). Its sibling spelling stays PROPOSED as the flow's negative control.
// Done before the API starts, so its 60 s alias cache never holds a pre-approval state.
const { seedSyntheticLandmarkAliases } = await import(fileUrl('packages/test-support/dist/index.js'));
await seedSyntheticLandmarkAliases({ env: 'local', databaseUrl: dbUrl, log: (line) => say(`aliases: ${line}`) });
const ACTIVE_ALIAS = 'badshai masjid';
const approved = await pool.query(
  `update geo.landmark_aliases set status = 'ACTIVE', approved_by_staff_id = $1 where city_code = 'LHR' and locale = 'ur-Latn' and alias_normalised = $2 and status = 'PROPOSED'`,
  [staff[1].staffId, ACTIVE_ALIAS],
);
if (approved.rowCount !== 1) throw new Error(`mobile-stack: the synthetic alias '${ACTIVE_ALIAS}' was not approved`);
say(`aliases: '${ACTIVE_ALIAS}' (ur-Latn) ACTIVE (approved by a seeded staff admin; every other synthetic alias stays PROPOSED)`);

// Vault pool of the API runner: a LOGIN member of wayvro_vault (local only; reused across runs, never an owner).
const VAULT_PASSWORD = 'e2e-local-only';
await pool.query(
  `do $$ begin if not exists (select 1 from pg_roles where rolname = 'wayvro_e2e_vault') then create role wayvro_e2e_vault login password '${VAULT_PASSWORD}' in role wayvro_vault; end if; end $$`,
);
const vaultUrl = (() => {
  const u = new URL(dbUrl);
  u.username = 'wayvro_e2e_vault';
  u.password = VAULT_PASSWORD;
  return u.toString();
})();
const KEY_SEED = process.env.WAYVRO_LOCAL_KEY_SEED ?? 'wayvro-local-synthetic-key-seed-not-for-production';
const RUN = Date.now().toString(36);
const S3_PREFIX = `e2e-mobile-${RUN}/`;
const S3 = {
  S3_ENDPOINT: process.env.WAYVRO_S3_ENDPOINT ?? 'http://127.0.0.1:28333',
  S3_ACCESS_KEY_ID: 'wayvro-local-access',
  S3_SECRET_ACCESS_KEY: 'wayvro-local-secret-not-for-production',
  S3_FORCE_PATH_STYLE: 'true',
  S3_QUARANTINE_BUCKET: 'wayvro-local',
  S3_QUARANTINE_PREFIX: `${S3_PREFIX}quarantine/`,
  S3_VAULT_BUCKET: 'wayvro-local',
  S3_VAULT_PREFIX: `${S3_PREFIX}vault/`,
};

const api = spawn(process.execPath, [join(ROOT, 'apps/api/dist-dev/dev/main.local.js')], {
  env: {
    ...process.env,
    WAYVRO_ENV: 'local',
    LOG_LEVEL: 'warn',
    NODE_ENV: 'production',
    DATABASE_URL: dbUrl,
    DATABASE_VAULT_URL: vaultUrl,
    REDIS_URL,
    WAYVRO_LOCAL_KEY_SEED: KEY_SEED,
    PORT: API_PORT,
    RATE_LIMIT_KEY_PREFIX: `wv:e2e-mobile:${RUN}:`,
    // Release controls take effect within 1 s (policy/switch hooks of run-flows.mjs), app config is not cached.
    RUNTIME_SWITCH_CACHE_SECONDS: '1',
    APP_CONFIG_CACHE_SECONDS: '0',
    // Every flow signs in from one host IP and a few synthetic numbers: local-runner throttles sized for a test run.
    OTP_PHONE_SENDS_PER_HOUR: '200',
    OTP_PHONE_SENDS_PER_DAY: '500',
    OTP_INSTALLATION_SENDS_PER_DAY: '500',
    OTP_IP_PREFIX_SENDS_PER_HOUR_SOFT: '5000',
    OTP_IP_PREFIX_SENDS_PER_HOUR_HARD: '10000',
    OTP_PREFIX_ELEVATED_SENDS_PER_MINUTE: '1000',
    OTP_PREFIX_MONITOR_MIN_SENDS: '100000',
    EVIDENCE_SLOTS_PER_10_MIN: '100',
    QUOTE_TTL_SECONDS,
    // n-15 (SP-08 #17) must reach the account quote limit from a UI loop; no other flow creates more than 2 quotes in
    // any minute of a lane (pr-10, pr-11, n-08 and n-09 are separated by sign-ins), so 3/min only affects n-15.
    QUOTES_PER_MINUTE_ACCOUNT: '3',
    // SP-08 #16 routing-unavailable and SRCH-02 provider failure: the local-runner-only fault control of the synthetic
    // geo doubles (`/__local/geo-control`, apps/api/dev/geo-control.ts), set and cleared by run-flows.mjs hooks.
    WAYVRO_LOCAL_GEO_CONTROL: '1',
    ...S3,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const stop = (code) => {
  api.kill();
  void pool.end().finally(() => process.exit(code));
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
api.on('exit', (code) => {
  if (code !== null && code !== 0) {
    process.stderr.write(`mobile-stack: API local runner exited with ${String(code)}\n`);
    process.exit(1);
  }
});

const baseUrl = `http://127.0.0.1:${API_PORT}`;
let ready = false;
for (let i = 0; i < 120 && !ready; i++) {
  ready = await fetch(`${baseUrl}/v1/health/ready`).then(
    (r) => r.ok,
    () => false,
  );
  if (!ready) await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  process.stderr.write('mobile-stack: the API local runner did not become ready\n');
  api.kill();
  await pool.end();
  process.exit(1);
}

const accounts = await seedAccounts({ root: ROOT, pool, baseUrl, keySeed: KEY_SEED });
mkdirSync(OUT_DIR, { recursive: true });
const stack = {
  createdAt: new Date().toISOString(),
  setupSeconds: Math.round((Date.now() - started) / 1000),
  apiPort: Number(API_PORT),
  apiBaseUrl: baseUrl,
  databaseUrl: dbUrl,
  staffIds: staff.map((s) => s.staffId),
  catalog: { zoneSetId: catalog.zoneSetId, zoneSetVersion: catalog.zoneSetVersion },
  pricing,
  aliases: { active: [ACTIVE_ALIAS] },
  accounts,
};
writeFileSync(join(OUT_DIR, 'stack.json'), JSON.stringify(stack, null, 2) + '\n');
say(`ready on ${baseUrl} in ${String(stack.setupSeconds)} s; accounts ${Object.keys(accounts).join(', ')}; stack file build-logs/e2e-mobile/stack.json`);
