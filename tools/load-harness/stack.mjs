/*
 * Throwaway local stack for the load harness and the FAULT-GEO soak (DEV-ONLY; docs/phase3/PHASE3_TEST_STRATEGY.md
 * §4.7/§4.20/§5 full tier), following tests/e2e-mobile/mobile-stack.mjs: a throwaway database `wayvro_load_<name>`
 * (dropped and recreated on every run, dropped again at the end, owned by this harness only — never the shared `wayvro`
 * database), migrations, the synthetic catalog and its synthetic rate cards (all-day service hours), the API local
 * runner (ADR-045: dist-dev, recording OTP sink, MOCK geo doubles with configured synthetic latency and, for the soak,
 * the runtime geo fault-control route) on its own port, and synthetic rider accounts signed in through the public OTP
 * endpoints (the code is read from the local-runner-only OTP inbox). Synthetic data only; no provider key or account.
 *
 * Prerequisites: compose infrastructure up (`pnpm infra:up`), `pnpm build`, `pnpm build:local`.
 */
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptPolicies, signUp, syntheticPhone } from '../../tests/e2e-mobile/seed-accounts.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fileUrl = (path) => new URL(`file://${join(ROOT, path).replaceAll('\\', '/')}`).href;
const pg = createRequire(join(ROOT, 'packages/db/package.json'))('pg');

/** Representative synthetic provider latencies (ms) — configured values, NOT measured provider data (SP-04 is open). */
export const DEFAULT_LATENCY_MS = { ROUTE: 250, AUTOCOMPLETE: 120, GEOCODE: 150, PLACE_RESOLVE: 150, REVERSE_GEOCODE: 150 };

/**
 * Local-stack-only limits (env of the API local runner): the API's own per-account/IP-prefix limits are raised so the
 * harness measures latency rather than its own throttling, and the local geo call allowance covers a full-tier run.
 * Every value is recorded in the report; production/staging limits are unchanged (they come from deployment config).
 */
export const LOCAL_LIMITS = {
  QUOTES_PER_MINUTE_ACCOUNT: '10000',
  QUOTES_PER_DAY_ACCOUNT: '100000',
  QUOTES_PER_MINUTE_IP_PREFIX: '100000',
  GEO_AUTOCOMPLETE_PER_MINUTE_ACCOUNT: '10000',
  GEO_RESOLVE_PER_MINUTE_ACCOUNT: '10000',
  GEO_REVERSE_PER_MINUTE_ACCOUNT: '10000',
  // all harness traffic comes from one loopback prefix: the per-IP-prefix geo ceilings (closure correction) are raised too
  GEO_AUTOCOMPLETE_PER_MINUTE_IP_PREFIX: '100000',
  GEO_RESOLVE_PER_MINUTE_IP_PREFIX: '100000',
  GEO_REVERSE_PER_MINUTE_IP_PREFIX: '100000',
  GEO_LOCAL_DAILY_CALLS_PER_SKU: '1000000',
  APP_CONFIG_PER_MINUTE_IP_PREFIX: '100000',
  // sign-in of a few synthetic accounts from one loopback address
  OTP_PHONE_SENDS_PER_HOUR: '200',
  OTP_INSTALLATION_SENDS_PER_DAY: '500',
  OTP_IP_PREFIX_SENDS_PER_HOUR_SOFT: '5000',
  OTP_IP_PREFIX_SENDS_PER_HOUR_HARD: '10000',
  OTP_PREFIX_ELEVATED_SENDS_PER_MINUTE: '1000',
  OTP_PREFIX_MONITOR_MIN_SENDS: '100000',
  // a full-tier run (load + 10-min soak) must not outlive its access tokens
  SESSION_ACCESS_TTL_SECONDS: '3600',
};

export const say = (tag, line) => process.stdout.write(`${tag}: ${line}\n`);

/** `ROUTE=250,AUTOCOMPLETE=120` (same syntax as the runner's WAYVRO_LOCAL_GEO_LATENCY_MS). */
export const latencyEnv = (latency) =>
  Object.entries(latency)
    .map(([sku, ms]) => `${sku}=${String(ms)}`)
    .join(',');

/**
 * Starts the stack. `name` → database `wayvro_load_<name>`; `geoControl` mounts /__local/geo-control (soak only);
 * the runner's stdout/stderr (structured JSON logs at `logLevel`) go to `logFile` so callers can scan them.
 * Returns { baseUrl, tokens, stop, database }.
 */
export async function startLocalStack({ tag, name, port, latency, geoControl, accounts, logFile, logLevel = 'error', stackEnv = {} }) {
  const DB = `wayvro_load_${name}`;
  if (!/^wayvro_load_[a-z0-9_]{1,40}$/.test(DB)) throw new Error('the stack name must match [a-z0-9_]{1,40}');
  if (!/^[1-9][0-9]{3,4}$/.test(String(port))) throw new Error('the API port must be a port number');
  const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://wayvro:wayvro-local-only@127.0.0.1:25432/wayvro';
  const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:26379';
  const admin = new URL(ADMIN_URL);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(admin.hostname)) throw new Error('the load harness runs against a loopback database only');
  const dbUrl = (() => {
    const u = new URL(ADMIN_URL);
    u.pathname = `/${DB}`;
    return u.toString();
  })();
  const dropDatabase = async () => {
    const c = new pg.Client({ connectionString: ADMIN_URL });
    await c.connect();
    try {
      await c.query(`drop database if exists ${DB} with (force)`);
    } finally {
      await c.end();
    }
  };
  await dropDatabase();
  {
    const c = new pg.Client({ connectionString: ADMIN_URL });
    await c.connect();
    try {
      await c.query(`create database ${DB}`);
    } finally {
      await c.end();
    }
  }
  const { runMigrations } = await import(fileUrl('packages/db/dist/index.js'));
  await runMigrations(dbUrl);
  const { seedSyntheticCatalog } = await import(fileUrl('packages/test-support/dist/index.js'));
  await seedSyntheticCatalog({ env: 'local', databaseUrl: dbUrl, allDayServiceHours: true, log: () => undefined });

  const RUN = Date.now().toString(36);
  const env = {
    WAYVRO_ENV: 'local',
    LOG_LEVEL: logLevel,
    NODE_ENV: 'production',
    DATABASE_URL: dbUrl,
    REDIS_URL,
    WAYVRO_LOCAL_KEY_SEED: process.env.WAYVRO_LOCAL_KEY_SEED ?? 'wayvro-local-synthetic-key-seed-not-for-production',
    PORT: String(port),
    // per-run Valkey namespaces: no cache entry, breaker hint, cool-down or limiter count of another run is reused
    RATE_LIMIT_KEY_PREFIX: `wv:load:${RUN}:rl:`,
    GEO_KEY_PREFIX: `wv:load:${RUN}:geo:`,
    ...LOCAL_LIMITS,
    WAYVRO_LOCAL_GEO_LATENCY_MS: latencyEnv(latency),
    ...(geoControl ? { WAYVRO_LOCAL_GEO_CONTROL: '1' } : {}),
    ...stackEnv,
  };
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(WAYVRO_|DATABASE_|REDIS_|GEO_|QUOTE|OTP_|SESSION_|APP_|RATE_LIMIT|LOG_LEVEL|PORT$)/.test(k)),
  );
  mkdirSync(dirname(logFile), { recursive: true });
  const logFd = openSync(logFile, 'w');
  const api = spawn(process.execPath, [join(ROOT, 'apps/api/dist-dev/dev/main.local.js')], { env: { ...inherited, ...env }, stdio: ['ignore', logFd, logFd] });
  let exited = false;
  api.on('exit', (code) => {
    exited = true;
    if (code !== null && code !== 0) say(tag, `API local runner exited with ${String(code)} (log: ${logFile})`);
  });
  const stop = async () => {
    if (!exited) {
      const done = new Promise((r) => api.once('exit', r));
      api.kill();
      await done;
    }
    closeSync(logFd);
    await dropDatabase();
  };
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  try {
    let ready = false;
    for (let i = 0; i < 120 && !ready && !exited; i++) {
      ready = await fetch(`${baseUrl}/v1/health/ready`).then(
        (r) => r.ok,
        () => false,
      );
      if (!ready) await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error('the API local runner did not become ready');
    const used = new Set();
    const tokens = [];
    for (let i = 0; i < accounts; i++) {
      const token = await signUp(baseUrl, syntheticPhone(used));
      await acceptPolicies(ROOT, baseUrl, token, ['TERMS', 'PRIVACY']);
      tokens.push(token);
    }
    return { baseUrl, tokens, stop, database: DB };
  } catch (e) {
    await stop();
    throw e;
  }
}
