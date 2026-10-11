/** Test helpers over the migration journal: total count and "schema state after the first N migrations". */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { MIGRATIONS_FOLDER } from '../src/index.js';

interface JournalEntry {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: JournalEntry[] };

/** Every migration tag in order. */
export const MIGRATION_TAGS: readonly string[] = journal.entries.map((e) => e.tag);
export const TOTAL_MIGRATIONS = MIGRATION_TAGS.length;

/** Applies exactly the first `n` migrations (a previous supported schema state) to `url`. */
export async function migrateFirst(url: string, n: number): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), 'wayvro-prev-'));
  mkdirSync(join(folder, 'meta'));
  const entries = journal.entries.slice(0, n);
  for (const e of entries) copyFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await migrate(drizzle(c), { migrationsFolder: folder });
  } finally {
    await c.end();
  }
}
