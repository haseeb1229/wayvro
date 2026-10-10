// Logic behind `pnpm db:migrate`: validate configuration and migration headers, then apply pending migrations.
import { databaseEnvSchema, loadConfig, serviceEnvSchema } from '@wayvro/config';
import { migrationHeaderProblems, runMigrations } from './migrate.js';

export async function migrateFromEnvironment(env: Readonly<Record<string, string | undefined>>): Promise<string> {
  const config = loadConfig(serviceEnvSchema.extend(databaseEnvSchema.shape), env);
  const problems = migrationHeaderProblems();
  if (problems.length > 0) throw new Error(`refusing to migrate: undocumented migrations\n - ${problems.join('\n - ')}`);
  const result = await runMigrations(config.DATABASE_URL);
  return `migrations: ${String(result.appliedAfter - result.appliedBefore)} applied, ${String(result.appliedAfter)} total (WAYVRO_ENV=${config.WAYVRO_ENV})`;
}
