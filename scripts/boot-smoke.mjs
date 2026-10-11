#!/usr/bin/env node
/*
 * Boot smoke test for every deployable skeleton (CLAUDE.md §8: CI must exercise real deployables, not only packages).
 * Prerequisites: `pnpm infra:up`, `pnpm db:migrate`, `pnpm build`, `pnpm build:local`. Node built-ins only.
 * The API is started through its local runner (apps/api/dist-dev, ADR-045), which binds the dev-only test doubles; the
 * production composition roots are exercised by the refusal checks here and by scripts/artifact-isolation.mjs.
 *
 * Starts api, worker, realtime, web-public and web-ops from their build output, then verifies health contracts,
 * security headers, the realtime fail-closed handshake and the production-configuration refusal, and finally stops
 * every process it started. Exit code 0 only if every check passed.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// web-ops port; overridable only for a developer machine where 3310 is taken by an unrelated process (CI uses 3310).
const OPS_PORT = process.env.WAYVRO_OPS_PORT ?? '3310';
const BASE_ENV = {
  ...process.env,
  WAYVRO_ENV: 'local',
  LOG_LEVEL: 'warn',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://wayvro:wayvro-local-only@127.0.0.1:25432/wayvro',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:26379',
  WAYVRO_LOCAL_KEY_SEED: process.env.WAYVRO_LOCAL_KEY_SEED ?? 'wayvro-local-synthetic-key-seed-not-for-production',
  NODE_ENV: 'production',
};
// Resolve Next.js the way Node would from each app (works with the hoisted workspace layout).
const NEXT_BIN = (app) => createRequire(join(ROOT, 'apps', app, 'package.json')).resolve('next/dist/bin/next');
const SERVICES = [
  { name: 'api', cmd: [join(ROOT, 'apps/api/dist-dev/dev/main.local.js')], env: { PORT: '4000' }, health: 'http://127.0.0.1:4000/v1/health/ready' },
  { name: 'realtime', cmd: [join(ROOT, 'apps/realtime/dist/main.js')], env: { PORT: '4001' }, health: 'http://127.0.0.1:4001/v1/health/ready' },
  { name: 'worker', cmd: [join(ROOT, 'apps/worker/dist/main.js')], env: { HEALTH_PORT: '4002' }, health: 'http://127.0.0.1:4002/v1/health/ready' },
  {
    name: 'web-public',
    cmd: [NEXT_BIN('web-public'), 'start', '--port', '3210', '--hostname', '127.0.0.1'],
    cwd: 'apps/web-public',
    env: {},
    health: 'http://127.0.0.1:3210/health',
  },
  {
    name: 'web-ops',
    cmd: [NEXT_BIN('web-ops'), 'start', '--port', OPS_PORT, '--hostname', '127.0.0.1'],
    cwd: 'apps/web-ops',
    env: {},
    health: `http://127.0.0.1:${OPS_PORT}/health`,
  },
];

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
// Short-lived processes started by the refusal checks (killed in `finally`, never awaited as services).
const probes = [];

function start(svc) {
  const child = spawn(process.execPath, svc.cmd, { cwd: join(ROOT, svc.cwd ?? '.'), env: { ...BASE_ENV, ...svc.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  procs.push({ svc, child, output: () => output });
  return child;
}

async function waitFor(url, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status === 200) return r;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  return null;
}

/** Engine.IO v4 / Socket.IO v5 handshake over a raw WebSocket; resolves with the CONNECT reply packet. */
function socketIoConnect(url, auth) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      resolve('timeout');
    }, 10000);
    ws.addEventListener('message', (m) => {
      const data = String(m.data);
      if (data.startsWith('0'))
        ws.send(`40${JSON.stringify(auth)}`); // engine.io OPEN -> socket.io CONNECT
      else if (data.startsWith('4')) {
        clearTimeout(timer);
        ws.close();
        resolve(data);
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve('error');
    });
  });
}

/** True when something already accepts TCP connections on the port (another project, a stale run, ...). */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

// Refuse to run if any port is taken: a smoke test must never pass by talking to someone else's server.
const PORTS = [4000, 4001, 4002, 3210, Number(OPS_PORT), 4098, 4099];

/** Runs a deployable once and collects its exit code and output (refusal checks). */
function runOnce(script, env) {
  return new Promise((resolve) => {
    // `undefined` removes a variable entirely (an empty string would fail schema validation before the check under test).
    const merged = Object.fromEntries(Object.entries({ ...BASE_ENV, ...env }).filter(([, v]) => v !== undefined));
    const child = spawn(process.execPath, [join(ROOT, script)], { env: merged, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (out += b));
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}
// Synthetic remote endpoints (`.invalid` never resolves) and a production-shaped staff WebAuthn relying party, so each
// refusal below is reached for the reason under test rather than an earlier configuration error.
const REMOTE_TLS = {
  DATABASE_URL: 'postgres://u:unused@db.invalid.example/w?sslmode=verify-full',
  REDIS_URL: 'rediss://cache.invalid.example:6380',
  STAFF_WEBAUTHN_RP_ID: 'ops.wayvro.invalid',
  STAFF_WEBAUTHN_ORIGINS: 'https://ops.wayvro.invalid',
};
const json = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'idempotency-key': `boot-smoke-${Math.random().toString(36).slice(2)}-${Date.now()}` },
  body: JSON.stringify(body),
});
const busy = [];
for (const port of PORTS) if (await portInUse(port)) busy.push(port);
if (busy.length) {
  console.error(`BOOT SMOKE: BLOCKED — ports already in use by another process: ${busy.join(', ')}`);
  process.exit(2);
}

try {
  // 1. A production-configured API must refuse local infrastructure and plaintext transport.
  const refusal = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'apps/api/dist/main.js')], {
      env: { ...BASE_ENV, WAYVRO_ENV: 'production', PORT: '4099' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stderr.on('data', (b) => (out += b));
    child.on('exit', (code) => resolve({ code, out }));
  });
  record('production boot refuses local/plaintext infrastructure', refusal.code !== 0 && /must not use a local host/.test(refusal.out), `exit ${refusal.code}`);

  // 1b. BOOT-NEG (fail-closed checklist, docs/phase2/PHASE2_SECURITY_AND_ABUSE_MODEL.md §3).
  for (const app of ['api', 'worker', 'realtime']) {
    const r = await runOnce(`apps/${app}/dist/main.js`, {
      ...REMOTE_TLS,
      WAYVRO_ENV: 'production',
      WAYVRO_LOCAL_KEY_SEED: undefined,
      PORT: '4099',
      HEALTH_PORT: '4099',
    });
    record(
      `${app}: a development build refuses WAYVRO_ENV=production (release artefact required)`,
      r.code !== 0 && /requires a release artefact/.test(r.out),
      `exit ${r.code}`,
    );
  }
  const seeded = await runOnce('apps/api/dist/main.js', { ...REMOTE_TLS, WAYVRO_ENV: 'staging', PORT: '4099' });
  record(
    'staging/production configuration refuses local key material',
    seeded.code !== 0 && /must not use local key material/.test(seeded.out),
    `exit ${seeded.code}`,
  );
  const runnerProd = await runOnce('apps/api/dist-dev/dev/main.local.js', {
    ...REMOTE_TLS,
    WAYVRO_ENV: 'production',
    WAYVRO_LOCAL_KEY_SEED: undefined,
    PORT: '4099',
  });
  record('the local runner refuses non-local environments', runnerProd.code !== 0 && /local runner only runs/.test(runnerProd.out), `exit ${runnerProd.code}`);

  // 1c. The PRODUCTION root (dist/main.js) in local mode binds no test double: OTP answers 503 and no local route exists.
  {
    const child = spawn(process.execPath, [join(ROOT, 'apps/api/dist/main.js')], { env: { ...BASE_ENV, PORT: '4098' }, stdio: ['ignore', 'pipe', 'pipe'] });
    probes.push(child);
    const up = await waitFor('http://127.0.0.1:4098/v1/health/ready', 30000);
    const otp = up
      ? await fetch(
          'http://127.0.0.1:4098/v1/auth/otp-challenges',
          json({ phone: '+923990000001', purpose: 'SIGN_IN', installationId: 'boot-smoke-installation-01', locale: 'en' }),
        )
      : null;
    const inbox = up ? await fetch('http://127.0.0.1:4098/__local/otp-inbox?phone=%2B923990000001') : null;
    record(
      'api production root: no OTP adapter bound -> 503, no local inbox route',
      otp?.status === 503 && (await otp.json()).error.code === 'WAYVRO_E_DEPENDENCY_UNAVAILABLE' && inbox?.status === 404,
      `otp ${otp?.status} inbox ${inbox?.status}`,
    );
    child.kill('SIGTERM');
  }

  // 2. Boot every deployable.
  for (const svc of SERVICES) start(svc);
  for (const { svc, output } of procs) {
    const r = await waitFor(svc.health);
    record(`${svc.name} boots and reports healthy`, r !== null, r ? `${svc.health} -> 200` : `no 200 within 60 s; output: ${output().slice(-400)}`);
  }

  // 3. Contract + security checks.
  const live = await (await fetch('http://127.0.0.1:4000/v1/health/live')).json();
  record('api liveness matches the contract', live.status === 'ok' && live.service === 'api' && !Number.isNaN(Date.parse(live.serverTime)));
  const ready = await (await fetch('http://127.0.0.1:4000/v1/health/ready')).json();
  record(
    'api readiness sees PostgreSQL and Valkey',
    ready.status === 'ready' && ready.checks.database === 'ok' && ready.checks.redis === 'ok',
    JSON.stringify(ready.checks),
  );
  const apiHeaders = (await fetch('http://127.0.0.1:4000/v1/health/live')).headers;
  record(
    'api sends strict CSP and a request id',
    /default-src 'none'/.test(apiHeaders.get('content-security-policy') ?? '') && !!apiHeaders.get('x-request-id'),
  );

  const reply = await socketIoConnect('ws://127.0.0.1:4001/socket.io/?EIO=4&transport=websocket', { token: 'anything' });
  record(
    'realtime refuses unauthenticated connections (fail closed)',
    reply.startsWith('44') && reply.includes('WAYVRO_E_UNAUTHENTICATED'),
    reply.slice(0, 80),
  );

  // 4. End-to-end local sign-in (synthetic +92 399 number; the recording sink of the local runner — never EG-01 evidence).
  {
    const phone = `+92399${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    const installationId = `boot-smoke-${Date.now()}`;
    const otp = await fetch('http://127.0.0.1:4000/v1/auth/otp-challenges', json({ phone, purpose: 'SIGN_IN', installationId, locale: 'en' }));
    const challenge = await otp.json();
    let code;
    for (let i = 0; i < 40 && !code; i++) {
      const inbox = await (await fetch(`http://127.0.0.1:4000/__local/otp-inbox?phone=${encodeURIComponent(phone)}`)).json();
      code = /\b(\d{6})\b/.exec(inbox.messages?.[0]?.message ?? '')?.[1];
      if (!code) await sleep(250);
    }
    record('local runner: OTP issued and delivered to the recording sink', otp.status === 202 && !!code, `otp ${otp.status}`);
    const created = await fetch(
      'http://127.0.0.1:4000/v1/auth/sessions',
      json({ challengeId: challenge.challengeId, code, installationId, device: { platform: 'ANDROID', appVersion: '1.0.0' } }),
    );
    const tokens = await created.json();
    const state = await fetch('http://127.0.0.1:4000/v1/account/state', { headers: { authorization: `Bearer ${tokens.accessToken}` } });
    record(
      'sign-in creates an account session and serves account state',
      created.status === 201 && state.status === 200,
      `session ${created.status} state ${state.status}`,
    );
    const rt = await socketIoConnect('ws://127.0.0.1:4001/socket.io/?EIO=4&transport=websocket', { token: tokens.accessToken });
    record('realtime accepts the live session (P2.1 session authenticator)', rt.startsWith('40'), rt.slice(0, 40));
    const refreshed = await fetch('http://127.0.0.1:4000/v1/auth/token-refreshes', json({ refreshToken: tokens.refreshToken }));
    const next = await refreshed.json();
    const logout = await fetch('http://127.0.0.1:4000/v1/auth/sessions/current', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${next.accessToken}`, 'idempotency-key': `boot-smoke-logout-${Date.now()}` },
    });
    record('refresh rotates and logout revokes', refreshed.status === 200 && logout.status === 204, `refresh ${refreshed.status} logout ${logout.status}`);
    const after = await socketIoConnect('ws://127.0.0.1:4001/socket.io/?EIO=4&transport=websocket', { token: next.accessToken });
    const stateAfter = await fetch('http://127.0.0.1:4000/v1/account/state', { headers: { authorization: `Bearer ${next.accessToken}` } });
    record(
      'a revoked session is refused by realtime and the API',
      after.startsWith('44') && stateAfter.status === 401,
      `${after.slice(0, 30)} / ${stateAfter.status}`,
    );
  }

  const page = await fetch('http://127.0.0.1:3210/');
  const pageHealth = await (await fetch('http://127.0.0.1:3210/health')).json();
  record('web-public answers as service web-public (not another process)', pageHealth.service === 'web-public');
  const opsHealth = await (await fetch(`http://127.0.0.1:${OPS_PORT}/health`)).json();
  record('web-ops answers as service web-ops', opsHealth.service === 'web-ops');
  const csp = page.headers.get('content-security-policy') ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  const html = await page.text();
  record(
    'web-public serves the shell with a per-request nonce CSP',
    page.status === 200 && !!nonce && !/unsafe-inline|unsafe-eval/.test(csp) && html.includes(`nonce="${nonce}"`),
    `nonce ${nonce ? 'present' : 'missing'}`,
  );
  record(
    'web-public sends baseline security headers',
    page.headers.get('x-frame-options') === 'DENY' && page.headers.get('x-content-type-options') === 'nosniff' && !page.headers.get('x-powered-by'),
  );

  const ops = await fetch(`http://127.0.0.1:${OPS_PORT}/`);
  record(
    'web-ops is noindex/no-store',
    (ops.headers.get('x-robots-tag') ?? '').includes('noindex') && (ops.headers.get('cache-control') ?? '').includes('no-store'),
  );
  const robots = await (await fetch(`http://127.0.0.1:${OPS_PORT}/robots.txt`)).text();
  record('web-ops robots.txt disallows everything', /Disallow: \/\s*$/m.test(robots));
} finally {
  for (const child of probes) if (child.exitCode === null) child.kill('SIGKILL');
  for (const { child } of procs) child.kill('SIGTERM');
  await sleep(1500);
  for (const { child } of procs) if (child.exitCode === null) child.kill('SIGKILL');
}

const failed = results.filter((r) => !r.pass);
console.log(`\nBOOT SMOKE: ${failed.length ? 'FAIL' : 'PASS'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
