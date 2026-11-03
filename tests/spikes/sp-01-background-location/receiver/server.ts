/**
 * SP-01 receiver (protocol §5.4). DISPOSABLE spike tooling, run by the Claude Code session on the founder's laptop.
 *
 *   node receiver/server.ts --host <private LAN IPv4> --data <file OUTSIDE the repo> [--port 8787] [--token <t>]
 *
 * HTTP API      http://<host>:<port>       GET /time, GET /snapshot, POST /presence, POST /points, POST /events,
 *                                          POST /offers/ack, GET /delay (TC-10 helper)
 * Gateway       http://<host>:<port+1>     Socket.IO 4.8.3 (the primary offer path; restartable)
 * Admin         http://127.0.0.1:<port+2>  loopback only; driven by receiver/admin.ts
 *
 * The token is a per-run shared value of the `spike-local-only` kind (tests/spikes/README.md): it keeps other LAN
 * devices from writing into the run; it is not a secret and is never written to the data file.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Server as IoServer } from 'socket.io';
import { parseUploadBatch } from '../src/shared/payload.ts';
import { OFFER_ID_PATTERN, RUN_ID_PATTERN, SPIKE_PARAMS, type ClientEvent, type OfferChannel, type Snapshot } from '../src/shared/protocol.ts';
import { ReceiverCore } from './core.ts';
import { assertDataPathOutsideRepo, isPrivateOrLoopbackIPv4 } from './paths.ts';
import { SNAPSHOT_VIA, type Row, type SnapshotVia } from './rows.ts';

const { values } = parseArgs({
  options: {
    host: { type: 'string' },
    port: { type: 'string', default: '8787' },
    data: { type: 'string' },
    token: { type: 'string' },
  },
});

function fail(message: string): never {
  console.error(`sp01-receiver: ${message}`);
  process.exit(2);
}

const host = values.host ?? fail('--host <private LAN IPv4> is required (never 0.0.0.0 or a public address)');
if (!isPrivateOrLoopbackIPv4(host)) fail(`--host ${host} is not a private (10/8, 172.16/12, 192.168/16) or loopback IPv4 address`);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65_000) fail('--port must be an integer in 1024..65000');
const dataPath = values.data ?? fail('--data <path outside the repository> is required');
try {
  assertDataPathOutsideRepo(dataPath, dirname(fileURLToPath(import.meta.url)));
} catch (e) {
  fail((e as Error).message);
}
const token = values.token ?? `spike-local-only-${randomBytes(4).toString('hex')}`;
if (!/^spike-local-only-[a-z0-9]{4,32}$/.test(token)) fail('--token must look like spike-local-only-<4..32 lowercase letters/digits>');
const tokenBuf = Buffer.from(token);

const out = createWriteStream(dataPath, { flags: 'a' });
const write = (row: Row): void => {
  out.write(`${JSON.stringify(row)}\n`);
};

let io: IoServer | null = null;
let gatewayHttp: HttpServer | null = null;

function emitPresence(snapshot: Snapshot): void {
  io?.emit('presence', snapshot);
}

const core = new ReceiverCore({
  now: () => Date.now(),
  write,
  newOfferId: () => `of-${randomBytes(6).toString('hex')}`,
  onPresenceChange: emitPresence,
  onOffer: (offer) => {
    if (!io || io.of('/').sockets.size === 0) return false;
    io.emit('offer', offer);
    return true;
  },
});

const authorised = (value: string | undefined): boolean => {
  if (!value) return false;
  const b = Buffer.from(value);
  return b.length === tokenBuf.length && timingSafeEqual(b, tokenBuf);
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(json);
}

async function readJson(req: IncomingMessage, limit = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new Error('BODY_TOO_LARGE');
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://receiver.local');
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!authorised(bearer)) return send(res, 401, { code: 'UNAUTHORISED' });
  const route = `${req.method ?? ''} ${url.pathname}`;
  switch (route) {
    case 'GET /time':
      return send(res, 200, { serverTimeMs: Date.now() });
    case 'GET /snapshot': {
      const viaParam = url.searchParams.get('via') ?? 'start';
      const via: SnapshotVia = (SNAPSHOT_VIA as readonly string[]).includes(viaParam) ? (viaParam as SnapshotVia) : 'start';
      return send(res, 200, core.snapshot(via));
    }
    case 'POST /presence': {
      const body = await readJson(req);
      if (!isObj(body) || typeof body['runId'] !== 'string' || !RUN_ID_PATTERN.test(body['runId'])) return send(res, 400, { code: 'PAYLOAD_INVALID' });
      if (body['action'] === 'online') {
        const r = core.goOnline(body['runId']);
        return r.ok ? send(res, 200, r.snapshot) : send(res, 409, { code: r.refusal, snapshot: r.snapshot });
      }
      if (body['action'] === 'offline') return send(res, 200, core.goOffline(body['runId'], String(body['reason'] ?? 'USER_OFFLINE')));
      return send(res, 400, { code: 'PAYLOAD_INVALID' });
    }
    case 'POST /points': {
      const parsed = parseUploadBatch(await readJson(req));
      if (!parsed.ok) {
        write({ k: 'host', ms: Date.now(), action: 'payload-rejected', label: parsed.code });
        return send(res, 400, { code: parsed.code, field: parsed.detail });
      }
      return send(res, 200, core.points(parsed.value));
    }
    case 'POST /events': {
      const body = await readJson(req);
      if (!isObj(body) || !Array.isArray(body['events']) || body['events'].length > 100) return send(res, 400, { code: 'PAYLOAD_INVALID' });
      return send(res, 200, { accepted: core.events(body['events'] as ClientEvent[]), serverTimeMs: Date.now() });
    }
    case 'POST /offers/ack': {
      const body = await readJson(req);
      if (!isObj(body) || !Array.isArray(body['acks']) || body['acks'].length > 50) return send(res, 400, { code: 'PAYLOAD_INVALID' });
      let accepted = 0;
      for (const a of body['acks'] as unknown[]) {
        if (!isObj(a) || typeof a['offerId'] !== 'string' || !OFFER_ID_PATTERN.test(a['offerId'])) continue;
        const channel = a['channel'] === 'poll' || a['channel'] === 'snapshot' || a['channel'] === 'socket' ? (a['channel'] as OfferChannel) : null;
        if (!channel || typeof a['clientRecvDeviceMs'] !== 'number') continue;
        if (core.ack(a['offerId'], channel, a['clientRecvDeviceMs'])) accepted += 1;
      }
      return send(res, 200, { accepted });
    }
    case 'GET /delay': {
      // TC-10 helper: answers after `ms` so the app can attempt a go-online from the background without a JS timer.
      const ms = Math.min(60_000, Math.max(0, Number(url.searchParams.get('ms') ?? '30000') || 0));
      setTimeout(() => send(res, 200, { serverTimeMs: Date.now(), delayedMs: ms }), ms);
      return;
    }
    default:
      return send(res, 404, { code: 'NOT_FOUND' });
  }
}

const api = createServer((req, res) => {
  handleApi(req, res).catch((e: unknown) => {
    const code = e instanceof Error && e.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : e instanceof SyntaxError ? 'PAYLOAD_INVALID' : 'INTERNAL';
    if (code === 'INTERNAL') console.error('sp01-receiver: request failed', e);
    if (!res.headersSent) send(res, code === 'INTERNAL' ? 500 : 400, { code });
  });
});

function startGateway(): void {
  gatewayHttp = createServer();
  io = new IoServer(gatewayHttp, { transports: ['websocket'], serveClient: false });
  io.use((socket, next) => {
    const t = (socket.handshake.auth as Record<string, unknown>)['token'];
    if (typeof t === 'string' && authorised(t)) next();
    else next(new Error('UNAUTHORISED'));
  });
  io.on('connection', (socket) => {
    const q = socket.handshake.auth as Record<string, unknown>;
    const runId = typeof q['runId'] === 'string' && RUN_ID_PATTERN.test(q['runId']) ? q['runId'] : null;
    write({ k: 'socket', ms: Date.now(), event: 'connect', runId });
    socket.emit('presence', core.snapshot('internal'));
    socket.on('hb', (msg: unknown) => {
      if (isObj(msg) && typeof msg['runId'] === 'string') core.heartbeat(msg['runId']);
    });
    socket.on('offer_ack', (msg: unknown) => {
      if (isObj(msg) && typeof msg['offerId'] === 'string' && typeof msg['clientRecvDeviceMs'] === 'number')
        core.ack(msg['offerId'], 'socket', msg['clientRecvDeviceMs']);
    });
    socket.on('disconnect', (reason) => {
      write({ k: 'socket', ms: Date.now(), event: 'disconnect', runId, detail: String(reason).slice(0, 40) });
    });
  });
  gatewayHttp.listen(port + 1, host);
  write({ k: 'gateway', ms: Date.now(), event: 'up' });
}

function restartGateway(downMs: number): void {
  write({ k: 'host', ms: Date.now(), action: 'restart-gateway', label: String(downMs) });
  const old = io;
  io = null;
  write({ k: 'gateway', ms: Date.now(), event: 'down' });
  // io.close() disconnects every socket and closes the gateway's own HTTP server (not the API server).
  old?.close();
  gatewayHttp = null;
  setTimeout(startGateway, downMs);
}

const admin = createServer((req, res) => {
  (async () => {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!authorised(bearer)) return send(res, 401, { code: 'UNAUTHORISED' });
    if (req.method !== 'POST' || req.url !== '/admin') return send(res, 404, { code: 'NOT_FOUND' });
    const body = await readJson(req, 4096);
    if (!isObj(body) || typeof body['cmd'] !== 'string') return send(res, 400, { code: 'PAYLOAD_INVALID' });
    const label = typeof body['label'] === 'string' && /^[a-z0-9-]{1,40}$/.test(body['label']) ? body['label'] : undefined;
    switch (body['cmd']) {
      case 'restrict':
        core.restrict();
        break;
      case 'unrestrict':
        core.unrestrict();
        break;
      case 'force-offline':
        core.forceOffline();
        break;
      case 'restart-gateway':
        restartGateway(Math.min(60_000, Math.max(500, Number(body['downMs'] ?? 3000) || 3000)));
        break;
      case 'mark':
        if (!label) return send(res, 400, { code: 'LABEL_REQUIRED', hint: 'lowercase letters, digits and dashes only' });
        write({ k: 'host', ms: Date.now(), action: 'mark', label });
        break;
      case 'status':
        break;
      case 'stop':
        send(res, 200, { stopping: true });
        shutdown();
        return;
      default:
        return send(res, 400, { code: 'UNKNOWN_COMMAND' });
    }
    return send(res, 200, { serverTimeMs: Date.now(), gateway: io ? 'up' : 'down', ...core.status() });
  })().catch(() => {
    if (!res.headersSent) send(res, 400, { code: 'PAYLOAD_INVALID' });
  });
});

const ticker = setInterval(() => core.tick(), 1000);
let summaryCount = 0;
const summary = setInterval(() => {
  summaryCount += 1;
  const s = core.status();
  console.log(
    `[${new Date().toISOString()}] presence=${String(s['presence'])} reason=${String(s['offlineReason'])} stored=${String(s['storedPointsThisRun'])} pendingOffers=${String(s['pendingOffers'])} sockets=${String(io?.of('/').sockets.size ?? 0)}`,
  );
}, 60_000);

let stopped = false;
function shutdown(): void {
  if (stopped) return;
  stopped = true;
  clearInterval(ticker);
  clearInterval(summary);
  write({ k: 'session', ms: Date.now(), event: 'stop', params: { summaries: summaryCount } });
  io?.close();
  api.close();
  admin.close();
  out.end(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

api.listen(port, host, () => {
  startGateway();
  admin.listen(port + 2, '127.0.0.1');
  const engineOpts = io ? (io.engine as unknown as { opts: { pingInterval: number; pingTimeout: number } }).opts : { pingInterval: -1, pingTimeout: -1 };
  write({
    k: 'session',
    ms: Date.now(),
    event: 'start',
    params: {
      tStaleMs: SPIKE_PARAMS.tStaleMs,
      tOfflineMs: SPIKE_PARAMS.tOfflineMs,
      offerEveryMs: SPIKE_PARAMS.offerEveryMs,
      firstOfferAfterMs: SPIKE_PARAMS.firstOfferAfterMs,
      offerValidityMs: SPIKE_PARAMS.offerValidityMs,
      socketPingIntervalMs: engineOpts.pingInterval,
      socketPingTimeoutMs: engineOpts.pingTimeout,
    },
  });
  console.log('SP-01 receiver (DISPOSABLE spike tooling; synthetic data; no coordinates are accepted)');
  console.log(`  API      http://${host}:${String(port)}`);
  console.log(`  gateway  http://${host}:${String(port + 1)} (Socket.IO, ping ${String(engineOpts.pingInterval)}/${String(engineOpts.pingTimeout)} ms)`);
  console.log(`  admin    http://127.0.0.1:${String(port + 2)} (loopback only)`);
  console.log(`  token    ${token}   (spike-local-only, not a secret)`);
  console.log(`  data     ${dataPath} (outside the repository; delete after aggregation)`);
});
