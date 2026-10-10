// SP-03 assignment-concurrency harness. For every (strategy, scenario) pair it opens 100 dedicated connections,
// waits on a barrier, fires 100 simultaneous accept attempts and then verifies the database invariants.
// Usage: tsx src/concurrency.ts [rounds=20] [attempts=100]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';
import { DATABASE_URL, newPool, percentiles } from './db.js';
import { assignments, driverPresence, offers, rideRequests } from './schema.js';

const ROUNDS = Number(process.argv[2] ?? 20);
const ATTEMPTS = Number(process.argv[3] ?? 100);

type Outcome = 'won' | 'conflict' | 'serialization_failure' | 'unique_violation' | 'deadlock' | 'lock_not_available' | 'error';
type Attempt = { rideId: number; driverId: number; offerId: number };
type Ctx = { db: NodePgDatabase; kdb: Kysely<KDB> };

interface KDB {
  ride_requests: { id: Generated<number>; status: string; version: number };
  offers: { id: Generated<number>; ride_id: number; driver_id: number; status: string; expires_at: Date; responded_at: Date | null };
  assignments: { id: Generated<number>; ride_id: number; driver_id: number; offer_id: number | null; status: string };
  driver_presence: { driver_id: number; busy: boolean };
}

class Conflict extends Error {}

function classify(e: unknown): Outcome {
  if (e instanceof Conflict) return 'conflict';
  const code = (e as { code?: string }).code;
  if (code === '40001') return 'serialization_failure';
  if (code === '23505') return 'unique_violation';
  if (code === '40P01') return 'deadlock';
  if (code === '55P03') return 'lock_not_available';
  return 'error';
}

// ---------------------------------------------------------------------------------------------------------------
// Strategies. Lock order is always ride -> driver to avoid deadlocks between scenarios.
// ---------------------------------------------------------------------------------------------------------------

/** CAS: conditional UPDATEs (ride SEARCHING->ASSIGNED, offer OFFERED->ACCEPTED, driver !busy->busy) + insert. */
async function casRaw(c: pg.PoolClient, a: Attempt): Promise<void> {
  await c.query('begin');
  try {
    const ride = await c.query(`update ride_requests set status='ASSIGNED', version=version+1 where id=$1 and status='SEARCHING' returning id`, [a.rideId]);
    if (ride.rowCount !== 1) throw new Conflict('ride not searching');
    const offer = await c.query(
      `update offers set status='ACCEPTED', responded_at=now() where id=$1 and driver_id=$2 and status='OFFERED' and expires_at > now() returning id`,
      [a.offerId, a.driverId],
    );
    if (offer.rowCount !== 1) throw new Conflict('offer not open');
    const drv = await c.query(`update driver_presence set busy=true where driver_id=$1 and not busy returning driver_id`, [a.driverId]);
    if (drv.rowCount !== 1) throw new Conflict('driver busy');
    await c.query(`insert into assignments(ride_id, driver_id, offer_id, status) values ($1,$2,$3,'ACTIVE')`, [a.rideId, a.driverId, a.offerId]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
}

async function casDrizzle(db: NodePgDatabase, a: Attempt): Promise<void> {
  await db.transaction(async (tx) => {
    const ride = await tx
      .update(rideRequests)
      .set({ status: 'ASSIGNED', version: dsql`${rideRequests.version} + 1` })
      .where(and(eq(rideRequests.id, a.rideId), eq(rideRequests.status, 'SEARCHING')))
      .returning({ id: rideRequests.id });
    if (ride.length !== 1) throw new Conflict('ride not searching');
    const offer = await tx
      .update(offers)
      .set({ status: 'ACCEPTED', respondedAt: dsql`now()` })
      .where(and(eq(offers.id, a.offerId), eq(offers.driverId, a.driverId), eq(offers.status, 'OFFERED'), dsql`${offers.expiresAt} > now()`))
      .returning({ id: offers.id });
    if (offer.length !== 1) throw new Conflict('offer not open');
    const drv = await tx
      .update(driverPresence)
      .set({ busy: true })
      .where(and(eq(driverPresence.driverId, a.driverId), eq(driverPresence.busy, false)))
      .returning({ id: driverPresence.driverId });
    if (drv.length !== 1) throw new Conflict('driver busy');
    await tx.insert(assignments).values({ rideId: a.rideId, driverId: a.driverId, offerId: a.offerId, status: 'ACTIVE' });
  });
}

async function casKysely(kdb: Kysely<KDB>, a: Attempt): Promise<void> {
  await kdb.transaction().execute(async (tx) => {
    const ride = await tx
      .updateTable('ride_requests')
      .set((eb) => ({ status: 'ASSIGNED', version: eb('version', '+', 1) }))
      .where('id', '=', a.rideId)
      .where('status', '=', 'SEARCHING')
      .returning('id')
      .execute();
    if (ride.length !== 1) throw new Conflict('ride not searching');
    const offer = await tx
      .updateTable('offers')
      .set({ status: 'ACCEPTED', responded_at: new Date() })
      .where('id', '=', a.offerId)
      .where('driver_id', '=', a.driverId)
      .where('status', '=', 'OFFERED')
      .where('expires_at', '>', new Date())
      .returning('id')
      .execute();
    if (offer.length !== 1) throw new Conflict('offer not open');
    const drv = await tx.updateTable('driver_presence').set({ busy: true }).where('driver_id', '=', a.driverId).where('busy', '=', false).returning('driver_id').execute();
    if (drv.length !== 1) throw new Conflict('driver busy');
    await tx.insertInto('assignments').values({ ride_id: a.rideId, driver_id: a.driverId, offer_id: a.offerId, status: 'ACTIVE' }).execute();
  });
}

/** Pessimistic: SELECT ... FOR UPDATE (optionally NOWAIT / SKIP LOCKED) then check in application code. */
function lockingRaw(mode: '' | 'skip locked' | 'nowait') {
  return async (c: pg.PoolClient, a: Attempt): Promise<void> => {
    await c.query('begin');
    try {
      const ride = await c.query<{ status: string }>(`select status from ride_requests where id=$1 for update ${mode}`, [a.rideId]);
      if (ride.rows[0]?.status !== 'SEARCHING') throw new Conflict('ride not searching / locked');
      const drv = await c.query<{ busy: boolean }>(`select busy from driver_presence where driver_id=$1 for update ${mode}`, [a.driverId]);
      if (drv.rows[0]?.busy !== false) throw new Conflict('driver busy / locked');
      const offer = await c.query<{ status: string }>(`select status from offers where id=$1 and expires_at > now() for update`, [a.offerId]);
      if (offer.rows[0]?.status !== 'OFFERED') throw new Conflict('offer not open');
      await c.query(`update ride_requests set status='ASSIGNED', version=version+1 where id=$1`, [a.rideId]);
      await c.query(`update offers set status='ACCEPTED', responded_at=now() where id=$1`, [a.offerId]);
      await c.query(`update driver_presence set busy=true where driver_id=$1`, [a.driverId]);
      await c.query(`insert into assignments(ride_id, driver_id, offer_id, status) values ($1,$2,$3,'ACTIVE')`, [a.rideId, a.driverId, a.offerId]);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
  };
}

/** SERIALIZABLE with plain reads + writes; losers surface as 40001 (no retry, so we observe raw behaviour). */
async function serializableRaw(c: pg.PoolClient, a: Attempt): Promise<void> {
  await c.query('begin isolation level serializable');
  try {
    const ride = await c.query<{ status: string }>(`select status from ride_requests where id=$1`, [a.rideId]);
    if (ride.rows[0]?.status !== 'SEARCHING') throw new Conflict('ride not searching');
    const drv = await c.query<{ busy: boolean }>(`select busy from driver_presence where driver_id=$1`, [a.driverId]);
    if (drv.rows[0]?.busy !== false) throw new Conflict('driver busy');
    const offer = await c.query<{ status: string }>(`select status from offers where id=$1 and expires_at > now()`, [a.offerId]);
    if (offer.rows[0]?.status !== 'OFFERED') throw new Conflict('offer not open');
    await c.query(`update ride_requests set status='ASSIGNED', version=version+1 where id=$1`, [a.rideId]);
    await c.query(`update offers set status='ACCEPTED', responded_at=now() where id=$1`, [a.offerId]);
    await c.query(`update driver_presence set busy=true where driver_id=$1`, [a.driverId]);
    await c.query(`insert into assignments(ride_id, driver_id, offer_id, status) values ($1,$2,$3,'ACTIVE')`, [a.rideId, a.driverId, a.offerId]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
}

/** Constraint-only: no status checks at all; relies purely on the partial unique indexes. */
async function uniqueIndexOnlyRaw(c: pg.PoolClient, a: Attempt): Promise<void> {
  const r = await c.query(`insert into assignments(ride_id, driver_id, offer_id, status) values ($1,$2,$3,'ACTIVE') on conflict do nothing returning id`, [
    a.rideId,
    a.driverId,
    a.offerId,
  ]);
  if (r.rowCount !== 1) throw new Conflict('active assignment exists');
}

/**
 * NEGATIVE CONTROL: check-then-act without locks against a table WITHOUT unique indexes. This is deliberately wrong;
 * it must produce duplicates, proving the harness is capable of detecting a broken strategy.
 */
async function naiveUnguarded(c: pg.PoolClient, a: Attempt): Promise<void> {
  const ride = await c.query<{ status: string }>(`select status from ride_requests where id=$1`, [a.rideId]);
  const drv = await c.query<{ busy: boolean }>(`select busy from driver_presence where driver_id=$1`, [a.driverId]);
  if (ride.rows[0]?.status !== 'SEARCHING' || drv.rows[0]?.busy !== false) throw new Conflict('not available');
  await c.query(`select pg_sleep(0.005)`); // widen the race window the way real application latency would
  await c.query(`update ride_requests set status='ASSIGNED' where id=$1`, [a.rideId]);
  await c.query(`update driver_presence set busy=true where driver_id=$1`, [a.driverId]);
  await c.query(`insert into assignments_unguarded(ride_id, driver_id) values ($1,$2)`, [a.rideId, a.driverId]);
}

type Strategy = { name: string; table: 'assignments' | 'assignments_unguarded'; run: (ctx: Ctx, c: pg.PoolClient, a: Attempt) => Promise<void> };
const STRATEGIES: Strategy[] = [
  { name: 'cas-raw', table: 'assignments', run: (_x, c, a) => casRaw(c, a) },
  { name: 'cas-drizzle', table: 'assignments', run: (x, _c, a) => casDrizzle(x.db, a) },
  { name: 'cas-kysely', table: 'assignments', run: (x, _c, a) => casKysely(x.kdb, a) },
  { name: 'for-update-raw', table: 'assignments', run: (_x, c, a) => lockingRaw('')(c, a) },
  { name: 'for-update-nowait-raw', table: 'assignments', run: (_x, c, a) => lockingRaw('nowait')(c, a) },
  { name: 'for-update-skip-locked-raw', table: 'assignments', run: (_x, c, a) => lockingRaw('skip locked')(c, a) },
  { name: 'serializable-raw', table: 'assignments', run: (_x, c, a) => serializableRaw(c, a) },
  { name: 'unique-index-only-raw', table: 'assignments', run: (_x, c, a) => uniqueIndexOnlyRaw(c, a) },
  { name: 'NEGATIVE-CONTROL-naive-unguarded', table: 'assignments_unguarded', run: (_x, c, a) => naiveUnguarded(c, a) },
];

// ---------------------------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------------------------
type Scenario = { name: string; describe: string; setup: (c: pg.PoolClient) => Promise<Attempt[]> };

async function resetTables(c: pg.PoolClient): Promise<void> {
  await c.query('truncate assignments, assignments_unguarded, offers, ride_requests, driver_presence restart identity cascade');
}

async function insertDrivers(c: pg.PoolClient, n: number): Promise<void> {
  await c.query(
    `insert into driver_presence(driver_id, geog, online, last_seen_at, vehicle_class)
     select g, ST_SetSRID(ST_MakePoint(74.35, 31.52), 4326)::geography, true, now(), 1 from generate_series(1, $1::int) g`,
    [n],
  );
}

const SCENARIOS: Scenario[] = [
  {
    name: 'A-one-ride-100-drivers',
    describe: `one ride offered to ${ATTEMPTS} drivers; all accept simultaneously`,
    setup: async (c) => {
      await insertDrivers(c, ATTEMPTS);
      await c.query(`insert into ride_requests(status) values ('SEARCHING')`);
      await c.query(`insert into offers(ride_id, driver_id, status, expires_at) select 1, g, 'OFFERED', now() + interval '60 s' from generate_series(1, $1::int) g`, [ATTEMPTS]);
      return Array.from({ length: ATTEMPTS }, (_, i) => ({ rideId: 1, driverId: i + 1, offerId: i + 1 }));
    },
  },
  {
    name: 'B-one-driver-100-rides',
    describe: `one driver holds offers for ${ATTEMPTS} different rides; accepts all simultaneously`,
    setup: async (c) => {
      await insertDrivers(c, 1);
      await c.query(`insert into ride_requests(status) select 'SEARCHING' from generate_series(1, $1::int)`, [ATTEMPTS]);
      await c.query(`insert into offers(ride_id, driver_id, status, expires_at) select g, 1, 'OFFERED', now() + interval '60 s' from generate_series(1, $1::int) g`, [ATTEMPTS]);
      return Array.from({ length: ATTEMPTS }, (_, i) => ({ rideId: i + 1, driverId: 1, offerId: i + 1 }));
    },
  },
  {
    name: 'C-same-offer-100-retries',
    describe: `one driver re-sends the same accept ${ATTEMPTS} times (retry storm / double tap)`,
    setup: async (c) => {
      await insertDrivers(c, 1);
      await c.query(`insert into ride_requests(status) values ('SEARCHING')`);
      await c.query(`insert into offers(ride_id, driver_id, status, expires_at) values (1, 1, 'OFFERED', now() + interval '60 s')`);
      return Array.from({ length: ATTEMPTS }, () => ({ rideId: 1, driverId: 1, offerId: 1 }));
    },
  },
];

type Verdict = { activePerRideMax: number; activePerDriverMax: number; totalActive: number; ridesAssigned: number; offersAccepted: number; busyDrivers: number };

async function verify(c: pg.PoolClient, table: Strategy['table']): Promise<Verdict> {
  const status = table === 'assignments' ? `where status='ACTIVE'` : '';
  const q = async (s: string): Promise<number> => Number((await c.query<{ n: string }>(s)).rows[0]?.n ?? 0);
  return {
    activePerRideMax: await q(`select coalesce(max(n),0) n from (select count(*) n from ${table} ${status} group by ride_id) x`),
    activePerDriverMax: await q(`select coalesce(max(n),0) n from (select count(*) n from ${table} ${status} group by driver_id) x`),
    totalActive: await q(`select count(*) n from ${table} ${status}`),
    ridesAssigned: await q(`select count(*) n from ride_requests where status='ASSIGNED'`),
    offersAccepted: await q(`select count(*) n from offers where status='ACCEPTED'`),
    busyDrivers: await q(`select count(*) n from driver_presence where busy`),
  };
}

function invariantsHold(v: Verdict, wins: number, strategy: Strategy): boolean {
  const base = v.activePerRideMax === 1 && v.activePerDriverMax === 1 && v.totalActive === 1 && wins === 1;
  // Constraint-only strategy never touches ride/offer/driver rows; only the assignment invariant applies.
  if (strategy.name === 'unique-index-only-raw') return base;
  return base && v.ridesAssigned === 1 && v.offersAccepted === 1 && v.busyDrivers === 1;
}

async function deadlocks(c: pg.PoolClient): Promise<number> {
  return Number((await c.query<{ n: string }>(`select deadlocks n from pg_stat_database where datname = current_database()`)).rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------
const admin = newPool(2);
await migrate(drizzle(admin), { migrationsFolder: resolve('drizzle') });
await admin.query(`create table if not exists assignments_unguarded (id bigserial primary key, ride_id bigint not null, driver_id bigint not null)`);

// 100 dedicated connections for raw strategies; Drizzle/Kysely get their own 100-connection pools.
const rawPool = new pg.Pool({ connectionString: DATABASE_URL, max: ATTEMPTS });
const ormPool = new pg.Pool({ connectionString: DATABASE_URL, max: ATTEMPTS });
const kPool = new pg.Pool({ connectionString: DATABASE_URL, max: ATTEMPTS });
const ctx: Ctx = { db: drizzle(ormPool), kdb: new Kysely<KDB>({ dialect: new PostgresDialect({ pool: kPool }) }) };
async function prewarm(p: pg.Pool): Promise<void> {
  const cs = await Promise.all(Array.from({ length: ATTEMPTS }, () => p.connect()));
  await Promise.all(cs.map((c) => c.query('select 1')));
  cs.forEach((c) => c.release());
}
await Promise.all([prewarm(rawPool), prewarm(ormPool), prewarm(kPool)]);

const results: Array<Record<string, unknown>> = [];
let overallCorrect = true;
const setupClient = await admin.connect();

for (const strategy of STRATEGIES) {
  for (const scenario of SCENARIOS) {
    const outcomes: Record<Outcome, number> = { won: 0, conflict: 0, serialization_failure: 0, unique_violation: 0, deadlock: 0, lock_not_available: 0, error: 0 };
    const latencies: number[] = [];
    const winnerLatencies: number[] = [];
    let roundsCorrect = 0;
    let duplicateRounds = 0;
    const errors = new Set<string>();
    const dl0 = await deadlocks(setupClient);
    for (let round = 0; round < ROUNDS; round++) {
      await resetTables(setupClient);
      const attempts = await scenario.setup(setupClient);
      // Barrier: acquire all connections first, then release every attempt at the same instant.
      const clients = await Promise.all(attempts.map(() => rawPool.connect()));
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      const runs = attempts.map(async (a, i) => {
        await gate;
        const t = performance.now();
        try {
          const client = clients[i];
          if (!client) throw new Error('no client');
          await strategy.run(ctx, client, a);
          const ms = performance.now() - t;
          latencies.push(ms);
          winnerLatencies.push(ms);
          return 'won' as Outcome;
        } catch (e) {
          latencies.push(performance.now() - t);
          const o = classify(e);
          if (o === 'error') errors.add((e as Error).message.slice(0, 120));
          return o;
        }
      });
      open();
      const settled = await Promise.all(runs);
      clients.forEach((c) => c.release());
      for (const o of settled) outcomes[o]++;
      const wins = settled.filter((o) => o === 'won').length;
      const v = await verify(setupClient, strategy.table);
      if (invariantsHold(v, wins, strategy)) roundsCorrect++;
      if (v.totalActive > 1 || v.activePerRideMax > 1 || v.activePerDriverMax > 1) duplicateRounds++;
    }
    const dl = (await deadlocks(setupClient)) - dl0;
    const correct = roundsCorrect === ROUNDS;
    const isNegative = strategy.name.startsWith('NEGATIVE');
    if (!isNegative && !correct) overallCorrect = false;
    const lat = percentiles(latencies);
    const row = {
      strategy: strategy.name,
      scenario: scenario.name,
      describe: scenario.describe,
      rounds: ROUNDS,
      attemptsPerRound: ATTEMPTS,
      roundsWithExactlyOneWinnerAndInvariants: roundsCorrect,
      roundsWithDuplicateAssignment: duplicateRounds,
      verdict: isNegative ? (duplicateRounds > 0 ? 'NEGATIVE CONTROL DETECTED DUPLICATES (harness sensitive)' : 'NEGATIVE CONTROL DID NOT RACE') : correct ? 'PASS' : 'FAIL',
      outcomes,
      deadlocks: dl,
      attemptLatencyMs: lat,
      winnerLatencyMs: percentiles(winnerLatencies),
      unexpectedErrors: [...errors],
    };
    results.push(row);
    console.log(
      `${row.verdict.padEnd(10).slice(0, 10)} ${strategy.name.padEnd(34)} ${scenario.name.padEnd(26)} correct=${roundsCorrect}/${ROUNDS} dupRounds=${duplicateRounds} ` +
        `won=${outcomes.won} conflict=${outcomes.conflict} 40001=${outcomes.serialization_failure} 23505=${outcomes.unique_violation} 55P03=${outcomes.lock_not_available} deadlocks=${dl} err=${outcomes.error} ` +
        `p50=${lat.p50}ms p95=${lat.p95}ms p99=${lat.p99}ms max=${lat.max}ms`,
    );
    if (errors.size) console.log('   unexpected errors:', [...errors]);
  }
}

setupClient.release();
mkdirSync('results', { recursive: true });
writeFileSync('results/concurrency.json', JSON.stringify({ at: new Date().toISOString(), rounds: ROUNDS, attempts: ATTEMPTS, overallCorrect, results }, null, 2) + '\n');
console.log(overallCorrect ? 'CONCURRENCY CORRECTNESS: PASS (all non-negative-control strategies)' : 'CONCURRENCY CORRECTNESS: FAIL');
await ctx.kdb.destroy();
await Promise.all([rawPool.end(), ormPool.end(), admin.end()]);
process.exitCode = overallCorrect ? 0 : 1;
