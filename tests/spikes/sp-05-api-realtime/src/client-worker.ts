// SPIKE-ONLY client worker process: owns a slice of simulated clients so the load generator itself is not the
// bottleneck (real clients are separate phones). Controlled by load.ts over IPC.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Client, GATEWAY_PORTS } from './client.js';
import { ENTITY_COUNT } from './shared.js';

const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
let clients: Client[] = [];

type Cmd = { cmd: 'start'; ids: number[] } | { cmd: 'status'; since: number } | { cmd: 'report' } | { cmd: 'stop' };

process.on('message', (m: Cmd) => {
  if (m.cmd === 'start') {
    clients = m.ids.map((i) => new Client(i, 1 + (i % ENTITY_COUNT), GATEWAY_PORTS[i % GATEWAY_PORTS.length] ?? 4101));
    void (async () => {
      for (let i = 0; i < clients.length; i += 50) {
        clients.slice(i, i + 50).forEach((c) => c.connect());
        await new Promise((r) => setTimeout(r, 25));
      }
    })();
    process.send?.({ type: 'started' });
  } else if (m.cmd === 'status') {
    process.send?.({
      type: 'status',
      connectedOnce: clients.filter((c) => c.connectedOnce).length,
      connected: clients.filter((c) => c.socket?.connected).length,
      unrecoveredSince: clients.filter((c) => c.recoveries.some((r) => r.disconnectAt >= m.since && r.reconciledAt === undefined)).length,
      attachedPerPort: Object.fromEntries(GATEWAY_PORTS.map((p) => [p, clients.filter((c) => c.gateway === p).length])),
    });
  } else if (m.cmd === 'report') {
    process.send?.({
      type: 'report',
      clients: clients.map((c) => ({
        entityId: c.entityId,
        lastVersion: c.lastVersion,
        initialReadyMs: c.initialReadyMs,
        recoveries: c.recoveries,
        deliveries: c.deliveries,
        gapFetches: c.gapFetches,
        staleOrDuplicate: c.staleOrDuplicate,
        failedConnects: c.failedConnects,
        connected: c.socket?.connected === true,
      })),
      loopDelayMs: { p50: loopDelay.percentile(50) / 1e6, p99: loopDelay.percentile(99) / 1e6, max: loopDelay.max / 1e6 },
    });
  } else {
    clients.forEach((c) => c.close());
    process.exit(0);
  }
});
