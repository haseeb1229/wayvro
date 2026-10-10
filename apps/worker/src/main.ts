// Worker composition root: config -> release-artefact policy -> telemetry -> real providers -> job runner + scheduler.
// Binds real adapters only (none exist before activation tracks); test doubles are never imported here (ADR-045).
import { createDatabase } from '@wayvro/db';
import { createLogger, startTelemetry } from '@wayvro/observability';
import { bindProviders } from '@wayvro/provider-interfaces';
import { createHealthServer, databaseCheck, enforceArtifactPolicy, redisCheck } from '@wayvro/server-runtime';
import { composeWorker } from './composition.js';
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
const providers = bindProviders(config.WAYVRO_ENV, {});
const { runner, scheduler } = composeWorker(config, db.pool, log, providers);
const redis = redisCheck(config.REDIS_URL);
const health = createHealthServer({ service: 'worker', version: config.WAYVRO_BUILD_VERSION, checks: [databaseCheck(db), redis] });

// The transactional-outbox relay is not started: no outbox source exists until its first consumer (P2.7, see
// src/outbox/relay.ts); starting it without a source would be a fake success path.
runner.start(config.JOB_POLL_INTERVAL_MS);
const scheduling = setInterval(() => {
  scheduler.tick().catch((e: unknown) => {
    log.error({ err: e }, 'recurring job scheduling failed');
  });
}, 15_000);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'worker shutting down');
  clearInterval(scheduling);
  await runner.stop();
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
  log.info(
    { host: config.HEALTH_HOST, port: config.HEALTH_PORT, jobTypes: runner.types, providersBound: providers.bound, telemetryExporting: telemetry.exporting },
    'worker started',
  );
});
