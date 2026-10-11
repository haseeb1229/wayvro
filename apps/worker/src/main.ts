// Worker composition root: config -> release-artefact policy -> telemetry -> real providers -> job runner + scheduler.
// Binds real adapters only; test doubles are never imported here (ADR-045).
import { createDatabase } from '@wayvro/db';
import { createLogger, startTelemetry } from '@wayvro/observability';
import { bindProviders } from '@wayvro/provider-interfaces';
import { createHealthServer, databaseCheck, enforceArtifactPolicy, redisCheck } from '@wayvro/server-runtime';
import { ClamdScanner, DockerSanitiser, objectStorageFromSettings } from '@wayvro/vault-adapters';
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
// Evidence pipeline adapters (ADR-041), each bound only when configured. The Docker sanitiser runner is refused outside
// local/test by configuration; production hosting of the isolated sanitiser, storage and scanner is P2.A4 (EG-05).
const storage = objectStorageFromSettings(config);
const scanner = config.CLAMD_HOST ? new ClamdScanner({ host: config.CLAMD_HOST, port: config.CLAMD_PORT, timeoutMs: config.CLAMD_TIMEOUT_MS }) : undefined;
const sanitiser =
  config.SANITISER_RUNNER === 'docker'
    ? new DockerSanitiser({ image: config.SANITISER_IMAGE, timeoutMs: config.SANITISER_TIMEOUT_MS, memory: '768m', cpus: '1', maxOutputBytes: 8 * 1024 * 1024 })
    : undefined;
const providers = bindProviders(config.WAYVRO_ENV, {
  ...(storage ? { objectStorage: storage } : {}),
  ...(scanner ? { malwareScanner: scanner } : {}),
  ...(sanitiser ? { imageSanitiser: sanitiser } : {}),
});
const vaultDb = config.DATABASE_VAULT_URL ? createDatabase(config.DATABASE_VAULT_URL, { maxConnections: 3, applicationName: 'wayvro-worker-vault' }) : null;
const { runner, scheduler } = composeWorker(config, db.pool, log, providers, vaultDb?.pool ?? null);
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
  await vaultDb?.close();
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
