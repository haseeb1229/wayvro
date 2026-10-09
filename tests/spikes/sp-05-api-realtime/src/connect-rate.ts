// SP-05 attribution bench: burst-connect N authenticated websocket clients to (a) the NestJS gateway and (b) the plain
// Socket.IO gateway, measuring time-to-all-connected and gateway CPU. Usage: node dist/connect-rate.js [n=1000] [repeats=3]
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import WebSocket from 'ws';
import { signToken } from './shared.js';

const N = Number(process.argv[2] ?? 1000);
const REPEATS = Number(process.argv[3] ?? 3);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(port: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`port ${port} not healthy`);
}

function cpuSeconds(pid: number): number {
  // Windows: query the process CPU time through PowerShell (spike-only measurement helper).
  const out = spawnSyncText('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).CPU`]);
  return Number(out.trim().replace(',', '.'));
}
function spawnSyncText(cmd: string, args: string[]): string {
  return spawnSync(cmd, args, { encoding: 'utf8' }).stdout;
}

async function burst(port: number, kind: 'socket.io' | 'ws'): Promise<{ wallMs: number; p50: number; p95: number; failed: number }> {
  const lat: number[] = [];
  let failed = 0;
  const sockets: Array<Socket | WebSocket> = [];
  const t0 = performance.now();
  await Promise.all(
    Array.from(
      { length: N },
      (_, i) =>
        new Promise<void>((resolve) => {
          const s0 = performance.now();
          const token = signToken({ sub: `synthetic-${i}`, entityId: 1 + (i % 500), exp: Date.now() + 600000 });
          if (kind === 'ws') {
            const w = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
            sockets.push(w);
            w.once('message', () => {
              lat.push(performance.now() - s0);
              resolve();
            });
            w.once('error', () => {
              failed++;
              resolve();
            });
            return;
          }
          const s = io(`http://127.0.0.1:${port}`, {
            transports: ['websocket'],
            reconnection: false,
            forceNew: true,
            timeout: 20000,
            auth: { token },
          });
          sockets.push(s);
          s.on('connect', () => {
            lat.push(performance.now() - s0);
            resolve();
          });
          s.on('connect_error', () => {
            failed++;
            resolve();
          });
        }),
    ),
  );
  const wallMs = performance.now() - t0;
  sockets.forEach((s) => s.close());
  lat.sort((a, b) => a - b);
  await sleep(1500);
  return { wallMs: Math.round(wallMs), p50: Math.round(lat[Math.floor(lat.length * 0.5)] ?? NaN), p95: Math.round(lat[Math.floor(lat.length * 0.95)] ?? NaN), failed };
}

const targets: Array<{ name: string; script: string; port: number; kind: 'socket.io' | 'ws' }> = [
  { name: 'nestjs-12-fastify + platform-socket.io', script: 'dist/gateway.js', port: 4101, kind: 'socket.io' },
  { name: 'plain socket.io (node:http)', script: 'dist/plain-gateway.js', port: 4201, kind: 'socket.io' },
  { name: 'raw ws (fallback floor; no rooms/fan-out)', script: 'dist/raw-ws-gateway.js', port: 4301, kind: 'ws' },
];
const results = [];
for (const t of targets) {
  const proc: ChildProcess = spawn(process.execPath, [t.script, String(t.port)], { stdio: 'ignore' });
  await waitHealthy(t.port);
  for (let r = 0; r < REPEATS; r++) {
    const cpu0 = cpuSeconds(proc.pid ?? 0);
    const b = await burst(t.port, t.kind);
    const cpu = cpuSeconds(proc.pid ?? 0) - cpu0;
    const row = { target: t.name, run: r + 1, n: N, ...b, connectsPerSecond: Math.round((N / b.wallMs) * 1000), gatewayCpuSeconds: Math.round(cpu * 100) / 100 };
    results.push(row);
    console.log(JSON.stringify(row));
  }
  proc.kill('SIGKILL');
  await sleep(500);
}
mkdirSync('results', { recursive: true });
writeFileSync(`results/connect-rate-${N}.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n');
