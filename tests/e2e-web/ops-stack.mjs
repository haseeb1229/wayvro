#!/usr/bin/env node
/*
 * web-ops E2E stack (Playwright webServer): a throwaway database `wayvro_e2e_ops` (recreated on every run; owned by
 * this script only), migrations, a staff bootstrap (two STAFF_ADMIN invitations written to build-logs/ for the specs),
 * the API local runner (ADR-045: dist-dev, recording OTP sink) and the production web-ops build.
 * Prerequisites: `pnpm infra:up`, `pnpm build`, `pnpm build:local`. Synthetic data only.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFromDb = createRequire(join(ROOT, 'packages/db/package.json'));
const pg = requireFromDb('pg');
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://wayvro:wayvro-local-only@127.0.0.1:25432/wayvro';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:26379';
const OPS_PORT = process.env.WAYVRO_E2E_OPS_PORT ?? '3310';
const API_PORT = process.env.WAYVRO_E2E_API_PORT ?? '4100';
const DB = 'wayvro_e2e_ops';
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

const { runMigrations } = await import(new URL(`file://${join(ROOT, 'packages/db/dist/index.js').replaceAll('\\', '/')}`).href);
await runMigrations(dbUrl);
const { bootstrapStaffAdmins } = await import(new URL(`file://${join(ROOT, 'apps/api/dist/staff/bootstrap.js').replaceAll('\\', '/')}`).href);
const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
const silent = { info() {}, warn() {}, error() {} };
const issued = await bootstrapStaffAdmins(
  pool,
  [
    { displayName: 'E2E Admin One', workEmail: 'e2e.admin.one@example.org' },
    { displayName: 'E2E Admin Two', workEmail: 'e2e.admin.two@example.org' },
  ],
  3600,
  silent,
);
await pool.end();
mkdirSync(join(ROOT, 'build-logs'), { recursive: true });
writeFileSync(join(ROOT, 'build-logs', 'e2e-ops.json'), JSON.stringify({ databaseUrl: dbUrl, invitations: issued.map((i) => i.invitationToken) }));

const env = {
  ...process.env,
  WAYVRO_ENV: 'local',
  LOG_LEVEL: 'warn',
  NODE_ENV: 'production',
  DATABASE_URL: dbUrl,
  REDIS_URL,
  WAYVRO_LOCAL_KEY_SEED: process.env.WAYVRO_LOCAL_KEY_SEED ?? 'wayvro-local-synthetic-key-seed-not-for-production',
};
const children = [
  spawn(process.execPath, [join(ROOT, 'apps/api/dist-dev/dev/main.local.js')], {
    env: { ...env, PORT: API_PORT, STAFF_WEBAUTHN_ORIGINS: `http://localhost:${OPS_PORT}`, RATE_LIMIT_KEY_PREFIX: `wv:e2e:${Date.now().toString(36)}:` },
    stdio: 'inherit',
  }),
  spawn(
    process.execPath,
    [createRequire(join(ROOT, 'apps/web-ops/package.json')).resolve('next/dist/bin/next'), 'start', '--port', OPS_PORT, '--hostname', '127.0.0.1'],
    {
      cwd: join(ROOT, 'apps/web-ops'),
      env: { ...env, WAYVRO_API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`, WAYVRO_OPS_PUBLIC_ORIGIN: `http://localhost:${OPS_PORT}` },
      stdio: 'inherit',
    },
  ),
];
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children)
  c.on('exit', (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`e2e stack child exited with ${String(code)}\n`);
      stop();
    }
  });
