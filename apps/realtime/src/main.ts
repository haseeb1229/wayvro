// Realtime gateway composition root: config -> telemetry -> fail-closed authenticator -> Socket.IO with Redis fan-out.
import { createLogger, startTelemetry } from '@wayvro/observability';
import { redisCheck } from '@wayvro/server-runtime';
import { createRealtimeApp } from './app.js';
import { DenyAllAuthenticator } from './auth.js';
import { loadRealtimeConfig } from './config.js';

const config = loadRealtimeConfig(process.env);
const telemetry = startTelemetry({
  service: 'realtime',
  version: config.WAYVRO_BUILD_VERSION,
  env: config.WAYVRO_ENV,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const log = createLogger({ service: 'realtime', env: config.WAYVRO_ENV, level: config.LOG_LEVEL });
const redis = redisCheck(config.REDIS_URL);

const app = await createRealtimeApp({
  info: { service: 'realtime', version: config.WAYVRO_BUILD_VERSION },
  // Phase 1: no identity system exists, so every connection is refused (fail closed) until Phase 2 binds sessions.
  authenticator: new DenyAllAuthenticator(),
  readinessChecks: [redis],
  log,
  redisUrl: config.REDIS_URL,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'realtime shutting down');
  await app.close();
  redis.close();
  await telemetry.shutdown();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen(config.PORT, config.HOST);
log.info({ host: config.HOST, port: config.PORT, authenticator: 'deny-all', telemetryExporting: telemetry.exporting }, 'realtime listening');
