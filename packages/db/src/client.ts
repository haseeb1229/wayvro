/**
 * SERVER-ONLY database foundation (ADR-004: drizzle-orm over node-postgres; PostGIS/locking paths use explicit SQL).
 * Mobile/web clients must never import this package (enforced by eslint-plugin-boundaries and dependency-cruiser).
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export interface Database {
  readonly pool: pg.Pool;
  readonly db: NodePgDatabase;
  /** Cheap liveness probe used by readiness checks; bounded by `timeoutMs`. */
  ping(timeoutMs: number): Promise<boolean>;
  close(): Promise<void>;
}

export function createDatabase(url: string, options: { maxConnections: number; applicationName: string }): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.maxConnections,
    application_name: options.applicationName,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  return {
    pool,
    db: drizzle(pool),
    async ping(timeoutMs) {
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('database ping timed out'));
          }, timeoutMs);
        });
        await Promise.race([pool.query('select 1'), timeout]);
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    close: () => pool.end(),
  };
}
