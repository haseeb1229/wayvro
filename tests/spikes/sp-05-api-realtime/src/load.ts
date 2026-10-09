// SP-05 orchestrator: seeds authoritative state, starts 1 API + 2 gateway processes, forks W client-worker processes
// holding N authenticated Socket.IO clients, streams versioned updates, SIGKILLs each gateway in turn while updates
// continue, and verifies that every client recovers authoritative state through the snapshot API.
// Usage: node dist/load.js [clients=2000] [ratePerSecond=100] [workers=4]
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { io } from 'socket.io-client';
import { GATEWAY_PORTS, type Recovery } from './client.js';
import { API_PORT, DATABASE_URL, ENTITY_COUNT } from './shared.js';

const CLIENTS = Number(process.argv[2] ?? 2000);
const RATE = Number(process.argv[3] ?? 100);
const WORKERS = Number(process.argv[4] ?? 4);
const API = `http://127.0.0.1:${API_PORT}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m: string): void => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

function pct(samples: number[]): { n: number; p50: number; p95: number; p99: number; max: number } {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? Number.NaN;
  return { n: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1] ?? Number.NaN };
}

// ---------------------------------------------------------------- server processes
const procs = new Map<string, ChildProcess>();
function startProc(name: string, script: string, args: string[] = []): void {
  const p = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr?.on('data', (b: Buffer) => process.stderr.write(`[${name}] ${b.toString()}`));
  procs.set(name, p);
}
async function health(url: string): Promise<{ rssMb: number } | null> {
  try {
    const r = await fetch(`${url}/health`);
    return r.ok ? ((await r.json()) as { rssMb: number }) : null;
  } catch {
    return null;
  }
}
async function waitHealthy(url: string, timeoutMs = 20000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await health(url)) return;
    await sleep(200);
  }
  throw new Error(`${url} not healthy within ${timeoutMs} ms`);
}
const gwName = (port: number): string => `gateway-${port}`;
const gwUrl = (port: number): string => `http://127.0.0.1:${port}`;
const gatewayRss = async (): Promise<Array<number | null>> => Promise.all(GATEWAY_PORTS.map(async (p) => (await health(gwUrl(p)))?.rssMb ?? null));

// ---------------------------------------------------------------- client workers (IPC)
type Status = { connectedOnce: number; connected: number; unrecoveredSince: number; attachedPerPort: Record<string, number> };
type ClientReport = {
  entityId: number;
  lastVersion: number;
  initialReadyMs?: number;
  recoveries: Recovery[];
  deliveries: Array<[number, number]>;
  gapFetches: number;
  staleOrDuplicate: number;
  failedConnects: number;
  connected: boolean;
};
type Report = { clients: ClientReport[]; loopDelayMs: { p50: number; p99: number; max: number } };

const workers = Array.from({ length: WORKERS }, () => fork('dist/client-worker.js', [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
function ask<T>(w: ChildProcess, msg: object, type: string): Promise<T> {
  return new Promise((resolve) => {
    const onMsg = (m: { type: string }): void => {
      if (m.type !== type) return;
      w.off('message', onMsg);
      resolve(m as T);
    };
    w.on('message', onMsg);
    w.send(msg);
  });
}
async function status(since = Number.MAX_SAFE_INTEGER): Promise<Status> {
  const all = await Promise.all(workers.map((w) => ask<Status>(w, { cmd: 'status', since }, 'status')));
  const attached: Record<string, number> = {};
  for (const s of all) for (const [p, n] of Object.entries(s.attachedPerPort)) attached[p] = (attached[p] ?? 0) + n;
  return {
    connectedOnce: all.reduce((a, s) => a + s.connectedOnce, 0),
    connected: all.reduce((a, s) => a + s.connected, 0),
    unrecoveredSince: all.reduce((a, s) => a + s.unrecoveredSince, 0),
    attachedPerPort: attached,
  };
}

// ---------------------------------------------------------------- run
async function setTicker(ratePerSecond: number): Promise<void> {
  await fetch(`${API}/v1/spike/ticker`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ratePerSecond }) });
}

const db = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
// The postgis image restarts Postgres once after its init scripts; wait for the final server.
for (let i = 0; ; i++) {
  try {
    await db.query('select 1');
    break;
  } catch (e) {
    if (i >= 30) throw e;
    await sleep(500);
  }
}
await db.query('drop table if exists spike_entities');
await db.query(`create table spike_entities (id int primary key, version int not null, state text not null, updated_at timestamptz not null default now())`);
await db.query(`insert into spike_entities(id, version, state) select g, 0, 'S0' from generate_series(1, $1::int) g`, [ENTITY_COUNT]);

startProc('api', 'dist/api.js');
for (const p of GATEWAY_PORTS) startProc(gwName(p), 'dist/gateway.js', [String(p)]);
await waitHealthy(API);
for (const p of GATEWAY_PORTS) await waitHealthy(gwUrl(p));
const rssBefore = await gatewayRss();
log(`api + ${GATEWAY_PORTS.length} gateways healthy; gateway RSS MB ${rssBefore.join('/')}; ${WORKERS} client worker processes`);

// Negative check: an unauthenticated handshake must be rejected.
const unauth = await new Promise<string>((resolve) => {
  const s = io(gwUrl(GATEWAY_PORTS[0] ?? 4101), { transports: ['websocket'], reconnection: false, auth: { token: 'forged.token' } });
  s.on('connect', () => {
    s.close();
    resolve('ACCEPTED (FAIL)');
  });
  s.on('connect_error', (e) => {
    s.close();
    resolve(`rejected: ${e.message}`);
  });
});
log(`forged-token handshake: ${unauth}`);

const connectStart = Date.now();
workers.forEach((w, wi) => w.send({ cmd: 'start', ids: Array.from({ length: CLIENTS }, (_, i) => i).filter((i) => i % WORKERS === wi) }));
let st = await status();
while (st.connectedOnce < CLIENTS && Date.now() - connectStart < 60000) {
  await sleep(200);
  st = await status();
}
const connectWallMs = Date.now() - connectStart;
const rssConnected = await gatewayRss();
log(`${st.connectedOnce}/${CLIENTS} clients connected + initial snapshot in ${connectWallMs} ms; gateway RSS MB ${rssConnected.join('/')}`);

await setTicker(RATE);
const steadyFrom = Date.now();
log(`ticker ${RATE} updates/s (fan-out ≈ ${((RATE * CLIENTS) / ENTITY_COUNT).toFixed(0)} deliveries/s)`);
await sleep(20000);
const steadyTo = Date.now();

const kills: Array<{ port: number; killedAt: number; affected: number; unrecoveredAfter30s: number }> = [];
for (const port of GATEWAY_PORTS) {
  const affected = (await status()).attachedPerPort[String(port)] ?? 0;
  const killedAt = Date.now();
  procs.get(gwName(port))?.kill('SIGKILL');
  log(`SIGKILL gateway ${port} (${affected} clients attached) while updates continue`);
  await sleep(500);
  let pending = (await status(killedAt)).unrecoveredSince;
  while (pending > 0 && Date.now() - killedAt < 30000) {
    await sleep(200);
    pending = (await status(killedAt)).unrecoveredSince;
  }
  kills.push({ port, killedAt, affected, unrecoveredAfter30s: pending });
  log(`after kill of ${port}: ${pending} clients still unrecovered`);
  startProc(gwName(port), 'dist/gateway.js', [String(port)]);
  await waitHealthy(gwUrl(port));
  log(`gateway ${port} restarted`);
  await sleep(3000);
}

await setTicker(0);
await sleep(3000); // quiesce: let in-flight events and gap fetches settle
const truth = new Map((await db.query<{ id: number; version: number }>('select id, version from spike_entities')).rows.map((r) => [r.id, r.version]));
const reports = await Promise.all(workers.map((w) => ask<Report>(w, { cmd: 'report' }, 'report')));
const clients = reports.flatMap((r) => r.clients);
const mismatched = clients.filter((c) => c.lastVersion !== truth.get(c.entityId));
const recoveries = clients.flatMap((c) => c.recoveries);
const done = recoveries.filter((r) => r.reconciledAt !== undefined && r.reconnectedAt !== undefined);
const windowOf = (i: number, r: Recovery): boolean => {
  const k = kills[i];
  return k !== undefined && r.disconnectAt >= k.killedAt && r.disconnectAt < (kills[i + 1]?.killedAt ?? Infinity);
};
const perKill = kills.map((k, i) => ({
  port: k.port,
  affectedClients: k.affected,
  unrecoveredAfter30s: k.unrecoveredAfter30s,
  recoveryFromKillMs: pct(done.filter((r) => windowOf(i, r)).map((r) => (r.reconciledAt ?? 0) - k.killedAt)),
}));
const advanced = ((await (await fetch(`${API}/health`)).json()) as { advanced: number }).advanced;
const result = {
  at: new Date().toISOString(),
  clients: CLIENTS,
  clientWorkerProcesses: WORKERS,
  entities: ENTITY_COUNT,
  updateRatePerSecond: RATE,
  updatesCommitted: advanced,
  forgedTokenHandshake: unauth,
  connectedInitially: st.connectedOnce,
  initialConnectWallMs: connectWallMs,
  initialConnectPlusSnapshotMs: pct(clients.flatMap((c) => (c.initialReadyMs === undefined ? [] : [c.initialReadyMs]))),
  gatewayRssMb: { before: rssBefore, withClientsConnected: rssConnected },
  steadyStateDeliveryMs: pct(clients.flatMap((c) => c.deliveries.filter(([at]) => at >= steadyFrom && at < steadyTo).map(([, ms]) => ms))),
  allDeliveryMs: pct(clients.flatMap((c) => c.deliveries.map(([, ms]) => ms))),
  kills: perKill,
  recoveriesObserved: recoveries.length,
  recoveriesCompleted: done.length,
  recoveryFromKillMs: pct(kills.flatMap((k, i) => done.filter((r) => windowOf(i, r)).map((r) => (r.reconciledAt ?? 0) - k.killedAt))),
  recoveryFromDisconnectMs: pct(done.map((r) => (r.reconciledAt ?? 0) - r.disconnectAt)),
  recoveryReconnectPhaseMs: pct(done.map((r) => (r.reconnectedAt ?? 0) - r.disconnectAt)),
  recoverySnapshotPhaseMs: pct(done.map((r) => (r.reconciledAt ?? 0) - (r.reconnectedAt ?? 0))),
  clientHarnessEventLoopDelayMs: reports.map((r) => r.loopDelayMs),
  gapSnapshotFetches: clients.reduce((a, c) => a + c.gapFetches, 0),
  staleOrDuplicateEventsIgnored: clients.reduce((a, c) => a + c.staleOrDuplicate, 0),
  failedConnectAttempts: clients.reduce((a, c) => a + c.failedConnects, 0),
  connectedAtEnd: clients.filter((c) => c.connected).length,
  clientsWithStateMismatchVsDatabase: mismatched.length,
  verdict: '',
};
result.verdict =
  unauth.startsWith('rejected') &&
  result.connectedInitially === CLIENTS &&
  result.connectedAtEnd === CLIENTS &&
  mismatched.length === 0 &&
  done.length === recoveries.length &&
  kills.every((k) => k.unrecoveredAfter30s === 0)
    ? 'PASS'
    : 'FAIL';
console.log(JSON.stringify(result, null, 2));
mkdirSync('results', { recursive: true });
writeFileSync(`results/sp05-${CLIENTS}-w${WORKERS}.json`, JSON.stringify(result, null, 2) + '\n');
workers.forEach((w) => w.send({ cmd: 'stop' }));
for (const p of procs.values()) p.kill('SIGKILL');
await db.end();
process.exit(result.verdict === 'PASS' ? 0 : 1);
