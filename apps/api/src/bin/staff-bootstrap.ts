#!/usr/bin/env node
// Staff bootstrap CLI (founder with infrastructure access; see src/staff/bootstrap.ts). Prints each single-use
// invitation token ONCE for out-of-band delivery; nothing is stored except its SHA-256.
//
//   staff-bootstrap --admin "Display Name <work@example.org>" [--admin "Second Admin <second@example.org>"]
import { createDatabase } from '@wayvro/db';
import { createLogger } from '@wayvro/observability';
import { loadApiConfig } from '../config.js';
import { BootstrapRefusedError, bootstrapStaffAdmins, type BootstrapAdmin } from '../staff/bootstrap.js';

const ADMIN = /^(.{1,80}) <([^<>\s@]{1,64}@[^<>\s@]{1,190})>$/;

function parseAdmins(argv: readonly string[]): BootstrapAdmin[] {
  const admins: BootstrapAdmin[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--admin') continue;
    const m = ADMIN.exec(argv[i + 1] ?? '');
    if (!m?.[1] || !m[2]) throw new BootstrapRefusedError('expected --admin "Display Name <work@example.org>"');
    admins.push({ displayName: m[1].trim(), workEmail: m[2] });
  }
  return admins;
}

const config = loadApiConfig(process.env);
const log = createLogger({ service: 'api', env: config.WAYVRO_ENV, level: config.LOG_LEVEL });
const db = createDatabase(config.DATABASE_URL, { maxConnections: 1, applicationName: 'wayvro-staff-bootstrap' });
try {
  const issued = await bootstrapStaffAdmins(db.pool, parseAdmins(process.argv.slice(2)), config.STAFF_INVITATION_TTL_SECONDS, log);
  for (const i of issued) console.log(`${i.workEmail}\t${i.invitationToken}\texpires ${i.expiresAt.toISOString()}`);
} catch (e) {
  if (!(e instanceof BootstrapRefusedError)) throw e;
  console.error(`refused: ${e.message}`);
  process.exitCode = 2;
} finally {
  await db.close();
}
