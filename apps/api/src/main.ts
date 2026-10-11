// Production composition root: config -> release-artefact policy -> telemetry -> real providers -> HTTP server.
// Binds real adapters only (none exist before activation tracks P2.A*); test doubles are never imported here (ADR-045).
import { createLogger, startTelemetry } from '@wayvro/observability';
import { bindProviders } from '@wayvro/provider-interfaces';
import { enforceArtifactPolicy } from '@wayvro/server-runtime';
import { objectStorageFromSettings } from '@wayvro/vault-adapters';
import { composeApi } from './composition.js';
import { loadApiConfig } from './config.js';

const config = loadApiConfig(process.env);
const build = enforceArtifactPolicy(new URL('./build-info.json', import.meta.url), config.WAYVRO_ENV);
const telemetry = startTelemetry({
  service: 'api',
  version: config.WAYVRO_BUILD_VERSION,
  env: config.WAYVRO_ENV,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const log = createLogger({ service: 'api', env: config.WAYVRO_ENV, level: config.LOG_LEVEL });
// Real adapters only. Object storage (ADR-041) is bound when configured; production storage/KMS is EG-05, and
// staging/production cannot boot without a KMS key provider anyway. No OTP adapter (EG-01) or push adapter (Phase 4)
// exists: those features answer 503 WAYVRO_E_DEPENDENCY_UNAVAILABLE. The guard still refuses branded doubles.
const storage = objectStorageFromSettings(config, config.EVIDENCE_UPLOAD_URL_SECONDS);
const providers = bindProviders(config.WAYVRO_ENV, storage ? { objectStorage: storage } : {});
const runtime = await composeApi(config, log, { providers });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'api shutting down');
  await runtime.close();
  await telemetry.shutdown();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await runtime.app.listen(config.PORT, config.HOST);
log.info(
  {
    host: config.HOST,
    port: config.PORT,
    artifact: build ? 'release' : 'development',
    providersBound: providers.bound,
    telemetryExporting: telemetry.exporting,
  },
  'api listening',
);
