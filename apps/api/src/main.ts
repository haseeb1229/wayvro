// Process composition root: validate config -> telemetry -> providers -> dependencies -> HTTP server.
import { createDatabase } from '@wayvro/db';
import { createLogger, startTelemetry } from '@wayvro/observability';
import { bindProviders, defaultProviderBindings } from '@wayvro/provider-interfaces';
import { databaseCheck, redisCheck } from '@wayvro/server-runtime';
import { createApp } from './app.js';
import { loadApiConfig } from './config.js';

const config = loadApiConfig(process.env);
const telemetry = startTelemetry({
  service: 'api',
  version: config.WAYVRO_BUILD_VERSION,
  env: config.WAYVRO_ENV,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const log = createLogger({ service: 'api', env: config.WAYVRO_ENV, level: config.LOG_LEVEL });
// Refuses mock providers outside local/test (GR-05); Phase 1 API endpoints use no provider yet.
const providers = bindProviders(config.WAYVRO_ENV, defaultProviderBindings(config.WAYVRO_ENV));
const db = createDatabase(config.DATABASE_URL, { maxConnections: 10, applicationName: 'wayvro-api' });
const redis = redisCheck(config.REDIS_URL);

const app = await createApp({
  info: { service: 'api', version: config.WAYVRO_BUILD_VERSION },
  readinessChecks: [databaseCheck(db), redis],
  log,
  trustProxy: config.TRUST_PROXY,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'api shutting down');
  await app.close();
  redis.close();
  await db.close();
  await telemetry.shutdown();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen(config.PORT, config.HOST);
log.info({ host: config.HOST, port: config.PORT, providersBound: providers.bound, telemetryExporting: telemetry.exporting }, 'api listening');
