/** Transaction helper for explicit-SQL repositories (ADR-004: concurrency-sensitive statements are explicit SQL). */
import type pg from 'pg';

/** Anything that can run a parameterised query: a pool or a client inside a transaction. */
export type Queryable = Pick<pg.PoolClient, 'query'>;

/** Runs `fn` in one READ COMMITTED transaction; rolls back on any error and always releases the client. */
export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** PostgreSQL SQLSTATE of a driver error, if any (e.g. 23505 unique_violation). */
export function sqlState(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}
