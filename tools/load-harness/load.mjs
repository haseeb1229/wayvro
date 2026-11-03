#!/usr/bin/env node
/*
 * Local load harness (DEV-ONLY; E07/Q26; docs/phase3/PHASE3_TEST_STRATEGY.md §4.20, budgets PB-20..PB-24 of
 * docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md). Node built-ins only. Starts its own throwaway stack (stack.mjs), then runs
 * each scenario at each concurrency level with a fixed request count:
 *
 *   quote-miss   POST /v1/quotes, a distinct pickup/drop pair per request (route-cache MISS, one MOCK routing call)
 *   quote-hit    POST /v1/quotes, one repeated pair (one excluded warm-up request per level, then route-cache HIT)
 *   autocomplete GET /v1/geo/autocomplete (synthetic gazetteer texts, rotating coarse bias cells)
 *   reverse      GET /v1/geo/reverse (distinct 4-decimal points near synthetic landmarks)
 *   app-config   GET /v1/app/config (public)
 *
 * Every 2xx body is validated against the published contract schema (a schema failure counts as an error). Cache
 * status comes from the response metadata (`route.source.cacheStatus` / `source.cacheStatus`). The MOCK doubles carry
 * a configured synthetic latency per SKU (DEFAULT_LATENCY_MS, overridable) — representative values, not measured
 * provider data. Results are LOCAL, NON-STAGING: they never satisfy the staging-class budgets.
 *
 *   node tools/load-harness/load.mjs [--requests 200] [--concurrency 1,4,16] [--accounts 4]
 *        [--scenarios quote-miss,quote-hit,autocomplete,reverse,app-config] [--latency ROUTE=250,AUTOCOMPLETE=120,...]
 *        [--port 4131] [--name local]
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { APP_HEADERS, OUT_DIR, REPORT_LABEL, SEARCH_TEXTS, latencySummary, parseFlags, positiveInt, quotePair, stamp, timed, writeReport } from './lib.mjs';
import { DEFAULT_LATENCY_MS, LOCAL_LIMITS, fileUrl, latencyEnv, say, startLocalStack } from './stack.mjs';

const TAG = 'load-harness';
const flags = parseFlags(process.argv.slice(2), {
  requests: '200',
  concurrency: '1,4,16',
  accounts: '4',
  scenarios: 'quote-miss,quote-hit,autocomplete,reverse,app-config',
  latency: latencyEnv(DEFAULT_LATENCY_MS),
  port: process.env.WAYVRO_LOAD_API_PORT ?? '4131',
  name: 'local',
});
const REQUESTS = positiveInt('requests', flags.requests, 100_000);
const ACCOUNTS = positiveInt('accounts', flags.accounts, 50);
const LEVELS = flags.concurrency.split(',').map((c) => positiveInt('concurrency', c, 256));
const LATENCY = Object.fromEntries(
  flags.latency.split(',').map((e) => {
    const [sku, ms] = e.split('=');
    return [sku, Number(ms)];
  }),
);

const { API_ROUTES } = await import(fileUrl('packages/contracts/dist/index.js'));
const { SYNTHETIC_GAZETTEER } = await import(fileUrl('packages/provider-test-doubles/dist/index.js'));
const route = (method, path) => {
  const r = API_ROUTES.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`no published contract for ${method} ${path}`);
  return r;
};

let pairCounter = 0;
let pointCounter = 0;
let searchCounter = 0;
const SCENARIOS = {
  'quote-miss': {
    budget: 'PB-20 (p95 ≤ 800 ms, p99 ≤ 1,500 ms; staging-class)',
    sku: 'ROUTE',
    contract: route('POST', '/v1/quotes'),
    refusalReason: 'ROUTING_UNAVAILABLE',
    request: (token) => ({ method: 'POST', path: '/v1/quotes', body: quotePair(pairCounter++), token, headers: APP_HEADERS }),
    cache: (json) => json?.route?.source?.cacheStatus ?? null,
  },
  'quote-hit': {
    budget: 'PB-21 (p95 ≤ 250 ms; staging-class)',
    sku: 'ROUTE',
    contract: route('POST', '/v1/quotes'),
    refusalReason: 'ROUTING_UNAVAILABLE',
    warmup: true,
    request: (token, level) => ({ method: 'POST', path: '/v1/quotes', body: quotePair(480_000 + level), token, headers: APP_HEADERS }),
    cache: (json) => json?.route?.source?.cacheStatus ?? null,
  },
  autocomplete: {
    budget: 'PB-22 (p95 ≤ 450 ms; staging-class)',
    sku: 'AUTOCOMPLETE',
    contract: route('GET', '/v1/geo/autocomplete'),
    // 13 texts × 8 coarse bias cells = 104 cache keys over the whole run: the first use of a key is a MISS (one MOCK
    // call), repeats are HITs — a deliberate typing-like mix; the ratio is reported as observed.
    request: (token) => {
      const k = searchCounter++;
      const cell = Math.floor(k / SEARCH_TEXTS.length) % 8;
      const q = new URLSearchParams({
        cityCode: 'LHR',
        q: SEARCH_TEXTS[k % SEARCH_TEXTS.length],
        locale: 'en',
        session: randomUUID(),
        biasLat: (31.45 + (cell % 4) * 0.03).toFixed(2),
        biasLng: (74.25 + Math.floor(cell / 4) * 0.05).toFixed(2),
      });
      return { method: 'GET', path: `/v1/geo/autocomplete?${q.toString()}`, token, headers: APP_HEADERS };
    },
    cache: (json) => json?.source?.cacheStatus ?? null,
  },
  reverse: {
    budget: 'PB-23 (p95 ≤ 500 ms; staging-class)',
    sku: 'REVERSE_GEOCODE',
    contract: route('GET', '/v1/geo/reverse'),
    request: (token) => {
      const k = pointCounter++;
      const p = SYNTHETIC_GAZETTEER[k % SYNTHETIC_GAZETTEER.length].point;
      const off = Math.floor(k / SYNTHETIC_GAZETTEER.length);
      const lat = (p.lat + ((off % 60) - 30) * 0.0001).toFixed(4);
      const lng = (p.lng + (Math.floor(off / 60) % 60) * 0.0001).toFixed(4);
      return {
        method: 'GET',
        path: `/v1/geo/reverse?${new URLSearchParams({ cityCode: 'LHR', lat, lng, locale: 'en' }).toString()}`,
        token,
        headers: APP_HEADERS,
      };
    },
    cache: (json) => json?.source?.cacheStatus ?? null,
  },
  'app-config': {
    budget: 'PB-24 (p95 ≤ 100 ms; staging-class)',
    sku: null,
    contract: route('GET', '/v1/app/config'),
    request: () => ({ method: 'GET', path: '/v1/app/config', headers: APP_HEADERS }),
    cache: () => null,
  },
};
const selected = flags.scenarios.split(',');
for (const s of selected) if (!(s in SCENARIOS)) throw new Error(`unknown scenario ${s}`);

async function runLevel(baseUrl, tokens, name, level) {
  const sc = SCENARIOS[name];
  if (sc.warmup) await timed(baseUrl, sc.request(tokens[0], level, -1));
  const samples = [];
  const all = [];
  const statuses = {};
  const cache = {};
  let schemaFailures = 0;
  let refusals = 0;
  let next = 0;
  const started = performance.now();
  const worker = async (w) => {
    for (;;) {
      const i = next++;
      if (i >= REQUESTS) return;
      const r = await timed(baseUrl, sc.request(tokens[(w + i) % tokens.length], level, i));
      all.push(r.ms);
      const key = r.status === 0 ? `transport:${r.transportError}` : String(r.status);
      statuses[key] = (statuses[key] ?? 0) + 1;
      if (r.status >= 200 && r.status < 300) {
        const schema = sc.contract.responses[r.status];
        if (!schema || !schema.safeParse(r.json).success) schemaFailures++;
        else samples.push(r.ms);
        const c = sc.cache(r.json);
        if (c !== null) cache[c] = (cache[c] ?? 0) + 1;
      } else if (r.status === 503 && sc.refusalReason && r.json?.error?.details?.reasonCodes?.includes(sc.refusalReason)) {
        // PB-20/FA-07: a refusal at the routing timeout / quote deadline is counted separately, never hidden in the
        // percentile and never counted as success
        refusals++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(level, REQUESTS) }, (_, w) => worker(w)));
  const seconds = (performance.now() - started) / 1000;
  const errors = REQUESTS - samples.length - refusals;
  const cached = Object.values(cache).reduce((a, b) => a + b, 0);
  return {
    scenario: name,
    concurrency: level,
    requests: REQUESTS,
    durationSeconds: Math.round(seconds * 100) / 100,
    throughputRps: Math.round((REQUESTS / seconds) * 10) / 10,
    latencyMs: latencySummary(samples),
    latencyMsAllResponses: latencySummary(all),
    statusCounts: statuses,
    schemaFailures,
    refusals,
    refusalRate: Math.round((refusals / REQUESTS) * 10000) / 10000,
    errorRate: Math.round((errors / REQUESTS) * 10000) / 10000,
    cacheStatus: cache,
    cacheHitRatio: cached > 0 ? Math.round(((cache.HIT ?? 0) / cached) * 10000) / 10000 : null,
    cacheHitRatioSource: sc.sku === null ? 'n/a (no geo cache)' : 'response metadata (source.cacheStatus) of 2xx responses',
    injectedProviderLatencyMs: sc.sku === null ? null : (LATENCY[sc.sku] ?? 0),
    budgetReference: sc.budget,
  };
}

const startedAt = new Date().toISOString();
const BASENAME = `load-${stamp()}`;
const LOG_FILE = join(OUT_DIR, `${BASENAME}-api.log`);
say(TAG, `starting throwaway stack (port ${flags.port}, ${String(ACCOUNTS)} synthetic accounts, latency ${flags.latency})`);
const stack = await startLocalStack({
  tag: TAG,
  name: flags.name,
  port: flags.port,
  latency: LATENCY,
  geoControl: false,
  accounts: ACCOUNTS,
  logFile: LOG_FILE,
});
const results = [];
try {
  for (const name of selected) {
    for (const level of LEVELS) {
      const r = await runLevel(stack.baseUrl, stack.tokens, name, level);
      results.push(r);
      say(
        TAG,
        `${name} c=${String(level)} n=${String(r.requests)}: p50 ${String(r.latencyMs.p50)} p95 ${String(r.latencyMs.p95)} p99 ${String(r.latencyMs.p99)} ms, errors ${String(r.errorRate * 100)} %, deadline refusals ${String(r.refusals)}, cache ${JSON.stringify(r.cacheStatus)}`,
      );
    }
  }
} finally {
  await stack.stop();
}

const report = {
  label: REPORT_LABEL,
  kind: 'load',
  startedAt,
  finishedAt: new Date().toISOString(),
  host: { node: process.version, platform: process.platform, arch: process.arch },
  stack: {
    database: `${stack.database} (throwaway, dropped)`,
    runner: 'apps/api/dist-dev/dev/main.local.js (MOCK geo doubles, straight-line router)',
    accounts: ACCOUNTS,
    injectedProviderLatencyMs: LATENCY,
    injectedLatencyNote: 'configured representative synthetic values, not measured provider latencies (SP-04 open)',
    localLimits: LOCAL_LIMITS,
  },
  requestsPerScenarioLevel: REQUESTS,
  results,
};
const pct = (x) => `${(x * 100).toFixed(2)} %`;
const row = (r) => {
  const statuses = Object.entries(r.statusCounts)
    .map(([s, c]) => `${s}×${String(c)}`)
    .join(', ');
  const cells = [
    r.scenario,
    r.concurrency,
    r.requests,
    r.latencyMs.p50,
    r.latencyMs.p95,
    r.latencyMs.p99,
    r.latencyMs.max,
    r.throughputRps,
    pct(r.errorRate),
    pct(r.refusalRate),
    statuses,
    r.cacheHitRatio === null ? 'n/a' : `${(r.cacheHitRatio * 100).toFixed(1)} %`,
    r.injectedProviderLatencyMs ?? 'n/a',
  ];
  return `| ${cells.map(String).join(' | ')} |`;
};
const md = [
  `# Wayvro local load report — ${REPORT_LABEL}`,
  '',
  `Started ${startedAt}; Node ${process.version} on ${process.platform}/${process.arch}. Throwaway database ${stack.database}; API local runner with MOCK geo doubles.`,
  `Injected synthetic provider latency (ms): ${JSON.stringify(LATENCY)} — configured representative values, not measured provider data.`,
  `Local-stack limits raised through env only: ${Object.entries(LOCAL_LIMITS)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')}.`,
  '',
  '| scenario | concurrency | requests | p50 ms | p95 ms | p99 ms | max ms | req/s | error rate | deadline refusals | statuses | cache-hit ratio | injected latency ms |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...results.map(row),
  '',
  'Percentiles: successful (2xx, contract-valid) responses only; quote refusals at the routing timeout / quote deadline (503 ROUTING_UNAVAILABLE) are counted separately as "deadline refusals" (PB-20/FA-07), never as success and never inside the percentile; `latencyMsAllResponses` in the JSON covers every response.',
  'Cache-hit ratio: observed from the response metadata (`route.source.cacheStatus` for quotes, `source.cacheStatus` for geo reads) over 2xx responses. Budget references (PB-20..PB-24) are staging-class: these local numbers do not satisfy them.',
  '',
].join('\n');
const out = writeReport(BASENAME, report, md);
say(TAG, `report ${out.mdPath} / ${out.jsonPath}`);
const failed = results.filter((r) => r.errorRate > 0);
if (failed.length > 0) {
  say(TAG, `FAIL: errors in ${failed.map((r) => `${r.scenario}@${String(r.concurrency)}`).join(', ')}`);
  process.exitCode = 1;
}
