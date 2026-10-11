#!/usr/bin/env node
// Operator CLI for non-destructive key rotation (data model §8.2/§8.3). Key STATES are changed in the key provider
// (locally: WAYVRO_LOCAL_KEY_SPEC); this command starts/advances the data migration and prints progress. Every step is
// idempotent and resumable; the rotation job itself runs in the worker.
//
//   key-rotation status
//   key-rotation start-field <schema.table.column>
//   key-rotation start-lookup
//   key-rotation contract-lookup <rotationId>   (after observing READ_SWITCHED)
//   key-rotation complete <rotationId>          (after the old key is RETIRED in the provider; verifies zero old rows)
//   key-rotation abandon <rotationId>           (field: before DONE; lookup: BACKFILL only — partial new rows deleted)
import { createDatabase } from '@wayvro/db';
import { abandonRotation, completeRotation, contractLookupRotation, startFieldRotation, startLookupRotation } from '@wayvro/identity-core';
import { createLogger } from '@wayvro/observability';
import { bindProviders } from '@wayvro/provider-interfaces';
import { composeWorker } from '../composition.js';
import { loadWorkerConfig } from '../config.js';

const config = loadWorkerConfig(process.env);
const log = createLogger({ service: 'worker', env: config.WAYVRO_ENV, level: config.LOG_LEVEL });
const db = createDatabase(config.DATABASE_URL, { maxConnections: 2, applicationName: 'wayvro-key-rotation' });
const { rotation } = composeWorker(config, db.pool, log, bindProviders(config.WAYVRO_ENV, {}));
const [command, arg] = process.argv.slice(2);

try {
  switch (command) {
    case 'status': {
      const r = await db.pool.query(
        `select id, kind, target, key_class, from_version, to_version, phase, processed_count, rewritten_count, skipped_concurrent_count, conflict_count, updated_at
           from platform.key_rotations order by started_at desc limit 20`,
      );
      console.log(JSON.stringify(r.rows, null, 2));
      break;
    }
    case 'start-field':
      console.log(`rotation started: ${await startFieldRotation(rotation, arg ?? '')}`);
      break;
    case 'start-lookup':
      console.log(`rotation started: ${await startLookupRotation(rotation)}`);
      break;
    case 'contract-lookup':
      console.log(`old-version lookup rows deleted: ${String(await contractLookupRotation(rotation, arg ?? ''))}`);
      break;
    case 'complete':
      await completeRotation(rotation, arg ?? '');
      console.log('rotation complete');
      break;
    case 'abandon':
      console.log(`rotation abandoned; new-version lookup rows deleted: ${String(await abandonRotation(rotation, arg ?? ''))}`);
      break;
    default:
      console.error('usage: key-rotation <status | start-field <field> | start-lookup | contract-lookup <id> | complete <id> | abandon <id>>');
      process.exitCode = 2;
  }
} finally {
  await db.close();
}
