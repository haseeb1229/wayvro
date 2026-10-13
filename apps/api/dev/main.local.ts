// LOCAL RUNNER (ADR-045) — development/test only. Lives outside `src/`, is compiled by tsconfig.dev.json into
// `dist-dev/` and is never part of a deployable artefact (package "files" ships `dist/` only; CI artifact-isolation
// check). It composes the same API as `src/main.ts` but binds the recording/in-memory test doubles, runs the
// `otp.deliver` job in-process against the recording sink and exposes the local OTP inbox route.
import { isNonProductionLike } from '@wayvro/config';
import { otpDeliveryJob } from '@wayvro/identity-core';
import { createLogger } from '@wayvro/observability';
import { bindProviders } from '@wayvro/provider-interfaces';
import { createGeoTestDoubles, createTestDoubleBindings } from '@wayvro/provider-test-doubles';
import { objectStorageFromSettings } from '@wayvro/vault-adapters';
import { JobRunner } from '@wayvro/server-runtime';
import { composeApi } from '../src/composition.js';
import { loadApiConfig } from '../src/config.js';
import { localOtpInbox } from './otp-inbox.js';

const config = loadApiConfig(process.env);
if (!isNonProductionLike(config.WAYVRO_ENV)) {
  throw new Error(`the local runner only runs with WAYVRO_ENV=local|test (got ${config.WAYVRO_ENV})`);
}
const log = createLogger({ service: 'api', env: config.WAYVRO_ENV, level: config.LOG_LEVEL });
const doubles = createTestDoubleBindings();
// Evidence uploads need a reachable store: the REAL S3 adapter against the local SeaweedFS when configured (ADR-041);
// the in-memory double otherwise (its upload URLs are not reachable, so evidence then works only in unit tests).
const storage = objectStorageFromSettings(config, config.EVIDENCE_UPLOAD_URL_SECONDS);
// Synthetic geo doubles (P3.2): fixed Lahore gazetteer and a straight-line router — local/test only, MOCK-branded.
const geo = createGeoTestDoubles();
const providers = bindProviders(config.WAYVRO_ENV, {
  ...doubles,
  placesAutocomplete: geo.placesAutocomplete,
  geocoding: geo.geocoding,
  reverseGeocoding: geo.reverseGeocoding,
  routing: geo.routing,
  ...(storage ? { objectStorage: storage } : {}),
});
const runtime = await composeApi(config, log, { providers, extraControllers: [localOtpInbox(doubles.otpDelivery)] });
const delivery = new JobRunner(runtime.db.pool, [otpDeliveryJob({ db: runtime.db.pool, cipher: runtime.cipher, port: doubles.otpDelivery })], {
  workerId: `api-local-runner-${String(process.pid)}`,
  leaseMs: 30000,
  batchSize: 10,
  log,
});
delivery.start(200);

async function shutdown(): Promise<void> {
  await delivery.stop();
  await runtime.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await runtime.app.listen(config.PORT, config.HOST);
log.info({ host: config.HOST, port: config.PORT, runner: 'local', providersBound: providers.bound }, 'api (local runner) listening');
