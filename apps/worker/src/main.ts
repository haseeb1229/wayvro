// Worker composition root: config -> telemetry -> dependencies -> health server -> (relay when a source exists).
import { createDatabase } from '@wayvro/db';
import { createLogger, startTelemetry } from '@wayvro/observability';
import { createHealthServer, databaseCheck, enforceArtifactPolicy, redisCheck } from '@wayvro/server-runtime';
import { loadWorkerConfig } from './config.js';

const config = loadWorkerConfig(process.env);
enforceArtifactPolicy(new URL('./build-info.json', import.meta.url), config.WAYVRO_ENV);
const telemetry = startTelemetry({
  service: 'worker',
  version: config.WAYVRO_BUILD_VERSION,
  env: config.WAYVRO_ENV,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const log = createLogger({ service: 'worker', env: config.WAYVRO_ENV, level: config.LOG_LEVEL });
const db = createDatabase(config.DATABASE_URL, { maxConnections: 5, applicationName: 'wayvro-worker' });
const redis = redisCheck(config.REDIS_URL);
const health = createHealthServer({ service: 'worker', version: config.WAYVRO_BUILD_VERSION, checks: [databaseCheck(db), redis] });

// No OutboxSource is bound in Phase 1: the outbox table ships with the first event-producing context (see
// src/outbox/relay.ts). Starting a relay without a source would be a fake success path, so it is not started.
log.info({ relay: 'not-started', reason: 'no outbox source bound until the outbox table migration' }, 'outbox relay status');

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'worker shutting down');
  await new Promise<void>((resolve) => {
    health.close(() => {
      resolve();
    });
  });
  redis.close();
  await db.close();
  await telemetry.shutdown();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

health.listen(config.HEALTH_PORT, config.HEALTH_HOST, () => {
  log.info({ host: config.HEALTH_HOST, port: config.HEALTH_PORT, telemetryExporting: telemetry.exporting }, 'worker started');
});
