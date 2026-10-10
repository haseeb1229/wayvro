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
const BASE_ENV = {
  ...process.env,
  WAYVRO_ENV: 'local',
  LOG_LEVEL: 'warn',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://wayvro:wayvro-local-only@127.0.0.1:25432/wayvro',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:26379',
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
    cmd: [NEXT_BIN('web-ops'), 'start', '--port', '3310', '--hostname', '127.0.0.1'],
    cwd: 'apps/web-ops',
    env: {},
    health: 'http://127.0.0.1:3310/health',
  },
];

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

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
const PORTS = [4000, 4001, 4002, 3210, 3310, 4099];
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

  const page = await fetch('http://127.0.0.1:3210/');
  const pageHealth = await (await fetch('http://127.0.0.1:3210/health')).json();
  record('web-public answers as service web-public (not another process)', pageHealth.service === 'web-public');
  const opsHealth = await (await fetch('http://127.0.0.1:3310/health')).json();
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

  const ops = await fetch('http://127.0.0.1:3310/');
  record(
    'web-ops is noindex/no-store',
    (ops.headers.get('x-robots-tag') ?? '').includes('noindex') && (ops.headers.get('cache-control') ?? '').includes('no-store'),
  );
  const robots = await (await fetch('http://127.0.0.1:3310/robots.txt')).text();
  record('web-ops robots.txt disallows everything', /Disallow: \/\s*$/m.test(robots));
} finally {
  for (const { child } of procs) child.kill('SIGTERM');
  await sleep(1500);
  for (const { child } of procs) if (child.exitCode === null) child.kill('SIGKILL');
}

const failed = results.filter((r) => !r.pass);
console.log(`\nBOOT SMOKE: ${failed.length ? 'FAIL' : 'PASS'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
