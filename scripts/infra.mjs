#!/usr/bin/env node
/*
 * Wayvro local infrastructure control (ADR-037). Only ever touches the Docker Compose project `wayvro` defined in
 * infra/docker/compose.yaml. Never runs `docker system prune`, `docker volume prune` or any command that could affect
 * another project's containers or volumes (CLAUDE.md §15).
 *
 *   node scripts/infra.mjs up       start (or keep) the services and wait until healthy
 *   node scripts/infra.mjs down     stop and remove the containers; named volumes (your local data) are kept
 *   node scripts/infra.mjs status   show service state and the wayvro_* volumes
 *   node scripts/infra.mjs reset --confirm-wayvro-reset
 *                                   delete ONLY the wayvro_* volumes declared in compose.yaml (disposable synthetic data)
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'infra', 'docker', 'compose.yaml');
const PROJECT = 'wayvro';
const OWNED_VOLUMES = ['wayvro_pg_data', 'wayvro_valkey_data', 'wayvro_s3_data'];

function run(args, { allowFail = false } = {}) {
  const r = spawnSync('docker', args, { stdio: 'inherit' });
  if (r.status !== 0 && !allowFail) {
    console.error(`docker ${args.join(' ')} failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return r.status;
}
const compose = (...args) => run(['compose', '-f', COMPOSE_FILE, '-p', PROJECT, ...args]);

const [cmd, flag] = process.argv.slice(2);
switch (cmd) {
  case 'up':
    compose('up', '-d', '--wait');
    compose('ps');
    break;
  case 'down':
    compose('down');
    break;
  case 'status':
    compose('ps', '-a');
    run(['volume', 'ls', '--filter', `label=com.docker.compose.project=${PROJECT}`]);
    break;
  case 'reset': {
    if (flag !== '--confirm-wayvro-reset') {
      console.error(`reset deletes the local Wayvro data volumes (${OWNED_VOLUMES.join(', ')}).\nRe-run with --confirm-wayvro-reset to proceed.`);
      process.exit(2);
    }
    compose('down');
    for (const volume of OWNED_VOLUMES) {
      // Verify ownership before deleting: the volume must carry this compose project's label.
      const inspect = spawnSync('docker', ['volume', 'inspect', '--format', '{{ index .Labels "com.docker.compose.project" }}', volume], { encoding: 'utf8' });
      if (inspect.status !== 0) {
        console.log(`volume ${volume} does not exist; nothing to remove`);
        continue;
      }
      const owner = inspect.stdout.trim();
      if (owner !== PROJECT) {
        console.error(`refusing to remove ${volume}: owned by compose project "${owner}", not "${PROJECT}"`);
        process.exit(1);
      }
      run(['volume', 'rm', volume]);
    }
    console.log('wayvro local data removed; run `pnpm infra:up` then `pnpm db:migrate` to recreate it');
    break;
  }
  default:
    console.error('usage: node scripts/infra.mjs <up|down|status|reset --confirm-wayvro-reset>');
    process.exit(2);
}
