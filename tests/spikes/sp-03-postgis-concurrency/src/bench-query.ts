// SP-03 candidate-lookup benchmark: synthetic Lahore driver presence, nearest-eligible-driver query through raw pg,
// Drizzle and Kysely, at concurrency 1 and 16. Usage: tsx src/bench-query.ts [drivers=10000] [queries=2000]
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Kysely, PostgresDialect, sql as ksql } from 'kysely';
import pg from 'pg';
import { newPool, percentiles, prng } from './db.js';

const DRIVERS = Number(process.argv[2] ?? 10000);
const QUERIES = Number(process.argv[3] ?? 2000);
const RADIUS_M = 3000;
const LIMIT = 10;
const CONTAINER = 'wayvro-spike-sp03-postgis-1';

// Lahore hotspots (approximate public-landmark coordinates) used only to cluster synthetic drivers.
const HOTSPOTS: Array<[number, number]> = [
  [31.5204, 74.3587], // Mall Road / Lahore centre
  [31.5161, 74.3426], // Gulberg
  [31.4697, 74.4078], // DHA
  [31.4697, 74.2728], // Johar Town
  [31.4836, 74.3239], // Model Town
  [31.5216, 74.4036], // Airport road
];
const BBOX = { minLat: 31.35, maxLat: 31.65, minLon: 74.15, maxLon: 74.5 };

async function seed(pool: pg.Pool): Promise<void> {
  await pool.query('truncate assignments, offers, ride_requests, driver_presence restart identity cascade');
  // Deterministic generation in SQL: 70 % clustered around hotspots (~2 km gaussian), 30 % uniform in the bbox.
  await pool.query(`select setseed(0.42)`);
  await pool.query(
    `with hs(i, lat, lon) as (select * from unnest($1::int[], $2::float8[], $3::float8[])),
     gen as (
       select g as driver_id, random() as r1, random() as r2, random() as r3, random() as r4, random() as r5,
              (floor(random() * 6))::int as h
       from generate_series(1, $4::int) g)
     insert into driver_presence(driver_id, geog, online, last_seen_at, vehicle_class, restricted, busy)
     select driver_id,
       case when r1 < 0.7 then
         ST_SetSRID(ST_MakePoint(hs.lon + 0.021 * sqrt(-2 * ln(greatest(r2, 1e-9))) * cos(2 * pi() * r3),
                                 hs.lat + 0.018 * sqrt(-2 * ln(greatest(r2, 1e-9))) * sin(2 * pi() * r3)), 4326)::geography
       else ST_SetSRID(ST_MakePoint($5::float8 + r2 * ($6::float8 - $5::float8), $7::float8 + r3 * ($8::float8 - $7::float8)), 4326)::geography end,
       r4 < 0.65,
       now() - make_interval(secs => case when r4 < 0.65 then r5 * 60 else 300 + r5 * 3600 end),
       case when r5 < 0.6 then 1 when r5 < 0.9 then 2 else 3 end,
       r1 > 0.98,
       r2 < 0.15
     from gen join hs on hs.i = gen.h`,
    [
      HOTSPOTS.map((_, i) => i),
      HOTSPOTS.map((h) => h[0]),
      HOTSPOTS.map((h) => h[1]),
      DRIVERS,
      BBOX.minLon,
      BBOX.maxLon,
      BBOX.minLat,
      BBOX.maxLat,
    ],
  );
  await pool.query('vacuum analyze driver_presence');
}

const QUERY_SQL = `select driver_id, ST_Distance(geog, $1::geography) as meters
from driver_presence
where online and not restricted and not busy and vehicle_class = $2
  and last_seen_at > now() - interval '30 seconds'
  and ST_DWithin(geog, $1::geography, $3)
order by geog <-> $1::geography
limit $4`;

function pickups(n: number): Array<{ wkt: string; cls: number }> {
  const rnd = prng(20261009);
  return Array.from({ length: n }, () => {
    const lat = BBOX.minLat + 0.05 + rnd() * (BBOX.maxLat - BBOX.minLat - 0.1);
    const lon = BBOX.minLon + 0.05 + rnd() * (BBOX.maxLon - BBOX.minLon - 0.1);
    const r = rnd();
    return { wkt: `SRID=4326;POINT(${lon.toFixed(6)} ${lat.toFixed(6)})`, cls: r < 0.6 ? 1 : r < 0.9 ? 2 : 3 };
  });
}

type Runner = (p: { wkt: string; cls: number }) => Promise<number>;

let seededAt = 0;

/** Shift every last_seen_at forward by the time elapsed since seeding so freshness never decays mid-benchmark. */
async function restampFreshness(pool: pg.Pool): Promise<void> {
  const elapsedS = (Date.now() - seededAt) / 1000;
  await pool.query('update driver_presence set last_seen_at = last_seen_at + make_interval(secs => $1)', [elapsedS]);
  seededAt = Date.now();
  await pool.query('vacuum analyze driver_presence');
}

async function measure(label: string, run: Runner, concurrency: number, points: Array<{ wkt: string; cls: number }>) {
  await restampFreshness(pool);
  for (const p of points.slice(0, 100)) await run(p); // warm-up (plan cache, buffers)
  const samples: number[] = [];
  let next = 0;
  let found = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < points.length) {
        const p = points[next++];
        if (!p) break;
        const s = performance.now();
        const candidates = await run(p); // read-after-await: avoids the lost-update race of `found += await ...`
        found += candidates;
        samples.push(performance.now() - s);
      }
    }),
  );
  const wall = performance.now() - t0;
  const stats = percentiles(samples);
  const qps = Math.round((points.length / wall) * 1000);
  console.log(`${label.padEnd(28)} c=${String(concurrency).padStart(2)} p50=${stats.p50}ms p95=${stats.p95}ms p99=${stats.p99}ms max=${stats.max}ms qps=${qps} avgCandidates=${(found / points.length).toFixed(2)}`);
  return { label, concurrency, ...stats, qps, avgCandidates: found / points.length };
}

/** Samples `docker stats` for the spike container while `fn` runs. */
async function withDockerStats<T>(fn: () => Promise<T>): Promise<{ result: T; cpuPct: number[]; mem: string[] }> {
  const cpuPct: number[] = [];
  const mem: string[] = [];
  const proc = spawn('docker', ['stats', CONTAINER, '--format', '{{.CPUPerc}}|{{.MemUsage}}']);
  proc.stdout.on('data', (b: Buffer) => {
    for (const line of b.toString().split('\n')) {
      const m = /([\d.]+)%\|(.+)/.exec(line);
      if (m?.[1] && m[2]) {
        cpuPct.push(Number(m[1]));
        mem.push(m[2].trim());
      }
    }
  });
  try {
    return { result: await fn(), cpuPct, mem };
  } finally {
    proc.kill();
  }
}

const pool = newPool(20);
await migrate(drizzle(pool), { migrationsFolder: resolve('drizzle') });
const tSeed = performance.now();
await seed(pool);
const seedMs = performance.now() - tSeed;
seededAt = Date.now();
const dist = (
  await pool.query<{ online: string; eligible: string; total: string }>(
    `select count(*) total, count(*) filter (where online) online,
            count(*) filter (where online and not restricted and not busy and last_seen_at > now() - interval '30 seconds') eligible
     from driver_presence`,
  )
).rows[0];
console.log(`seeded ${DRIVERS} drivers in ${seedMs.toFixed(0)} ms`, dist);

const points = pickups(QUERIES);
const plan = (
  await pool.query<{ 'QUERY PLAN': string }>(`explain (analyze, buffers, costs off) ${QUERY_SQL}`, [points[0]?.wkt, 1, RADIUS_M, LIMIT])
).rows.map((r) => r['QUERY PLAN']);

const db = drizzle(pool);
const kdb = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: newPool(20) }) });

const raw: Runner = async (p) => (await pool.query(QUERY_SQL, [p.wkt, p.cls, RADIUS_M, LIMIT])).rowCount ?? 0;
const viaDrizzle: Runner = async (p) =>
  (
    await db.execute(dsql`select driver_id, ST_Distance(geog, ${p.wkt}::geography) as meters
      from driver_presence
      where online and not restricted and not busy and vehicle_class = ${p.cls}
        and last_seen_at > now() - interval '30 seconds'
        and ST_DWithin(geog, ${p.wkt}::geography, ${RADIUS_M})
      order by geog <-> ${p.wkt}::geography limit ${LIMIT}`)
  ).rowCount ?? 0;
const viaKysely: Runner = async (p) =>
  (
    await ksql<{ driver_id: string; meters: number }>`select driver_id, ST_Distance(geog, ${p.wkt}::geography) as meters
      from driver_presence
      where online and not restricted and not busy and vehicle_class = ${p.cls}
        and last_seen_at > now() - interval '30 seconds'
        and ST_DWithin(geog, ${p.wkt}::geography, ${RADIUS_M})
      order by geog <-> ${p.wkt}::geography limit ${LIMIT}`.execute(kdb)
  ).rows.length;

const runs: Array<Awaited<ReturnType<typeof measure>>> = [];
const { result, cpuPct, mem } = await withDockerStats(async () => {
  for (const c of [1, 4, 8, 16]) {
    runs.push(await measure('raw pg', raw, c, points));
    runs.push(await measure('drizzle-orm sql``', viaDrizzle, c, points));
    runs.push(await measure('kysely sql``', viaKysely, c, points));
  }
  return runs;
});
let dbStats = '';
try {
  dbStats = execFileSync('docker', ['stats', '--no-stream', CONTAINER, '--format', '{{.CPUPerc}} {{.MemUsage}}']).toString().trim();
} catch (e) {
  dbStats = `docker stats unavailable: ${(e as Error).message}`;
}

mkdirSync('results', { recursive: true });
const out = {
  at: new Date().toISOString(),
  drivers: DRIVERS,
  queries: QUERIES,
  radiusM: RADIUS_M,
  limit: LIMIT,
  seedMs: Math.round(seedMs),
  distribution: dist,
  runs: result,
  dbCpuPctDuringRun: cpuPct.length ? { samples: cpuPct.length, max: Math.max(...cpuPct), mean: cpuPct.reduce((a, b) => a + b, 0) / cpuPct.length } : null,
  dbMemDuringRun: mem.at(-1) ?? null,
  dbStatsAfter: dbStats,
  explainAnalyze: plan,
};
writeFileSync(`results/bench-${DRIVERS}.json`, JSON.stringify(out, null, 2) + '\n');
console.log(plan.join('\n'));
console.log('db cpu % during run', out.dbCpuPctDuringRun, 'mem', out.dbMemDuringRun);
await kdb.destroy();
await pool.end();
