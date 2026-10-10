/**
 * Migration runner (GR-04, CLAUDE.md §6). Migrations are reviewed SQL files in `packages/db/migrations`, applied in
 * order by the drizzle migrator, idempotently (already-applied files are skipped). Every file carries the header that
 * `MIGRATION_HEADER_FIELDS` lists. PostGIS columns/indexes are always hand-written SQL (drizzle-kit defects, ADR-004).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const MIGRATION_HEADER_FIELDS = ['wayvro-migration', 'compatibility', 'data-impact', 'rollback', 'verification'] as const;

export interface MigrationResult {
  readonly appliedBefore: number;
  readonly appliedAfter: number;
}

/** Applies pending migrations on a dedicated connection with bounded lock/statement timeouts. */
export async function runMigrations(
  databaseUrl: string,
  options: { lockTimeout: string; statementTimeout: string } = { lockTimeout: '5s', statementTimeout: '120s' },
): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString: databaseUrl, application_name: 'wayvro-migrate' });
  await client.connect();
  try {
    await client.query(`select set_config('lock_timeout', $1, false), set_config('statement_timeout', $2, false)`, [
      options.lockTimeout,
      options.statementTimeout,
    ]);
    const count = async (): Promise<number> => {
      const r = await client.query<{ n: string }>(
        `select count(*) n from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`,
      );
      if (r.rows[0]?.n === '0') return 0;
      return Number((await client.query<{ n: string }>('select count(*) n from drizzle.__drizzle_migrations')).rows[0]?.n ?? 0);
    };
    const appliedBefore = await count();
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    return { appliedBefore, appliedAfter: await count() };
  } finally {
    await client.end();
  }
}

/** Returns the header problems of every SQL migration (empty when all files are documented). */
export function migrationHeaderProblems(folder: string = MIGRATIONS_FOLDER): string[] {
  const problems: string[] = [];
  for (const file of readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const header = readFileSync(join(folder, file), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('-- '));
    for (const field of MIGRATION_HEADER_FIELDS) {
      if (!header.some((l) => l.startsWith(`-- ${field}:`))) problems.push(`${file}: missing "-- ${field}:" header`);
    }
  }
  return problems;
}
