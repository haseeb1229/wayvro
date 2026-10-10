// LOCAL RUNNER (ADR-045) — development/test only. Lives outside `src/`, is compiled by tsconfig.dev.json into
// `dist-dev/` and is never part of a deployable artefact (package "files" ships `dist/` only; CI artifact-isolation
// check). It composes the same API as `src/main.ts` but binds the recording/in-memory test doubles.
import { isNonProductionLike } from '@wayvro/config';
import { createLogger } from '@wayvro/observability';
import { bindProviders } from '@wayvro/provider-interfaces';
import { createTestDoubleBindings } from '@wayvro/provider-test-doubles';
import { composeApi } from '../src/composition.js';
import { loadApiConfig } from '../src/config.js';

const config = loadApiConfig(process.env);
if (!isNonProductionLike(config.WAYVRO_ENV)) {
  throw new Error(`the local runner only runs with WAYVRO_ENV=local|test (got ${config.WAYVRO_ENV})`);
}
const log = createLogger({ service: 'api', env: config.WAYVRO_ENV, level: config.LOG_LEVEL });
const providers = bindProviders(config.WAYVRO_ENV, createTestDoubleBindings());
const runtime = await composeApi(config, log, { providers });

async function shutdown(): Promise<void> {
  await runtime.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await runtime.app.listen(config.PORT, config.HOST);
log.info({ host: config.HOST, port: config.PORT, runner: 'local', providersBound: providers.bound }, 'api (local runner) listening');
