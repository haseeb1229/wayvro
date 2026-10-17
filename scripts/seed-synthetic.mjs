#!/usr/bin/env node
/*
 * Synthetic catalog seed for LOCAL development (Phase 3, P3.1; docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md §7).
 *
 *   pnpm seed:synthetic        (after `pnpm db:migrate` and `pnpm --filter @wayvro/test-support build`)
 *
 * Writes the synthetic Lahore zone set, eligibility rules, city-product states and PROPOSED synthetic landmark search
 * aliases (P3.9, A06; activation only through the staff maker-checker flow) through the dev-only
 * @wayvro/test-support module, which refuses unless WAYVRO_ENV is local/test, the DATABASE_URL host is a loopback host
 * and no non-synthetic configuration exists. Never run against staging/production; never a migration.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const entry = join(root, 'packages', 'test-support', 'dist', 'index.js');
if (!existsSync(entry)) {
  console.error('seed:synthetic: build @wayvro/test-support first (pnpm --filter @wayvro/test-support build)');
  process.exit(1);
}
const { seedSyntheticCatalog, seedSyntheticLandmarkAliases } = await import(pathToFileURL(entry).href);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('seed:synthetic: DATABASE_URL is required (copy .env.example to .env)');
  process.exit(1);
}
const result = await seedSyntheticCatalog({ env: process.env.WAYVRO_ENV, databaseUrl, log: (line) => console.log(`seed:synthetic: ${line}`) });
console.log(`seed:synthetic: done — zone set ${result.zoneSetId} v${String(result.zoneSetVersion)} (${result.createdZoneSet ? 'created' : 'already present'})`);
// A06: synthetic Roman-Urdu/English/Urdu spelling aliases, PROPOSED only (staff maker-checker activates them).
const aliases = await seedSyntheticLandmarkAliases({ env: process.env.WAYVRO_ENV, databaseUrl, log: (line) => console.log(`seed:synthetic: ${line}`) });
console.log(`seed:synthetic: done — landmark aliases ${String(aliases.inserted)} new / ${String(aliases.total)} synthetic (PROPOSED)`);
