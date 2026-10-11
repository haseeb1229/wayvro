// Realtime gateway composition root: config -> release-artefact policy -> telemetry -> session authenticator ->
// Socket.IO with Redis fan-out. Connections are authenticated against the authoritative session table (SEC-RT).
import { createDatabase } from '@wayvro/db';
import { createLogger, startTelemetry } from '@wayvro/observability';
import { databaseCheck, enforceArtifactPolicy, redisCheck } from '@wayvro/server-runtime';
import { createRealtimeApp } from './app.js';
import { SessionAuthenticator } from './auth.js';
import { loadRealtimeConfig } from './config.js';

const config = loadRealtimeConfig(process.env);
enforceArtifactPolicy(new URL('./build-info.json', import.meta.url), config.WAYVRO_ENV);
const telemetry = startTelemetry({
  service: 'realtime',
  version: config.WAYVRO_BUILD_VERSION,
  env: config.WAYVRO_ENV,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const log = createLogger({ service: 'realtime', env: config.WAYVRO_ENV, level: config.LOG_LEVEL });
// The realtime LOGIN role is a member of wayvro_realtime: column-level SELECT on sessions/accounts only.
const db = createDatabase(config.DATABASE_URL, { maxConnections: 5, applicationName: 'wayvro-realtime' });
const redis = redisCheck(config.REDIS_URL);

const app = await createRealtimeApp({
  info: { service: 'realtime', version: config.WAYVRO_BUILD_VERSION },
  authenticator: new SessionAuthenticator(db.pool),
  readinessChecks: [databaseCheck(db), redis],
  log,
  redisUrl: config.REDIS_URL,
  revalidateIntervalMs: config.REALTIME_SESSION_REVALIDATE_MS,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'realtime shutting down');
  await app.close();
  redis.close();
  await db.close();
  await telemetry.shutdown();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen(config.PORT, config.HOST);
log.info({ host: config.HOST, port: config.PORT, authenticator: 'session', telemetryExporting: telemetry.exporting }, 'realtime listening');
