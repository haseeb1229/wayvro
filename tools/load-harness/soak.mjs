#!/usr/bin/env node
/*
 * FAULT-GEO soak (DEV-ONLY; docs/phase3/PHASE3_TEST_STRATEGY.md §4.7 FG-01..08 and §5 full tier "FAULT-GEO soak
 * (randomised fault mix for 10 min)"). Node built-ins only. Starts its own throwaway stack (stack.mjs) with the runtime
 * geo fault-control route of the local runner (/__local/geo-control, local runner only), then — sequentially, so every
 * provider call is attributable to exactly one request — picks a scenario (quote / autocomplete / reverse) and a MOCK
 * fault mode per request from a seeded PRNG, applies the fault, sends the request and checks invariants continuously:
 *
 *   I1  no 500 / unexpected 5xx / transport failure: only 2xx, documented 4xx (route contract) or 503 with the
 *       documented reason (quotes: WAYVRO_E_DEPENDENCY_UNAVAILABLE + ROUTING_UNAVAILABLE; geo reads:
 *       GEO_PROVIDER_UNAVAILABLE | GEO_BUDGET_EXHAUSTED); every error body is a valid ErrorEnvelope;
 *   I2  every 2xx body validates against the published contract schema;
 *   I3  a priced quote is consistent (all options PRICED, Σ components = total) and its route is the provider's route:
 *       distance/duration equal the MOCK router's answer for the rounded points, cacheStatus MISS ⇒ exactly one ROUTE
 *       call, HIT ⇒ none and the pair was priced before — never an invented ETA/distance;
 *   I4  a failure-type fault (timeout, 5xx, connect, malformed, quota, echo, rejected input; for quotes also partial
 *       and empty) never yields a fresh (MISS) 2xx; EMPTY/PARTIAL geo reads return only what the provider gave;
 *   I5  no raw provider/adapter error text, stack trace or raw provider place id in any response body; I5b: none of
 *       these, and no search text, in the runner's own info-level log (scanned after the run);
 *   I6  bounded provider calls per request: ROUTE ≤ 1 (no retry); geo reads ≤ 1 + GEO_CONNECT_RETRIES (1), and 2 only
 *       after a connect error; no call on any other SKU;
 *   I7  bounded latency: quote ≤ QUOTE_DEADLINE_MS, geo read ≤ SKU timeout + retry slack, each plus a 1.5 s local
 *       scheduling margin (no unbounded wait, retry storm or ignored deadline).
 *
 * The scenario/fault sequence is reproducible from the printed seed; outcomes also depend on timing (breaker windows,
 * quota cool-downs), so two runs with one seed share the fault plan, not necessarily every outcome.
 *
 *   node tools/load-harness/soak.mjs [--duration 600] [--seed <uint32>] [--accounts 2] [--port 4132] [--name soak]
 *        [--latency ROUTE=250,AUTOCOMPLETE=120,...]
 */
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { APP_HEADERS, OUT_DIR, REPORT_LABEL, SEARCH_TEXTS, parseFlags, positiveInt, prng, quotePair, stamp, timed, writeReport } from './lib.mjs';
import { DEFAULT_LATENCY_MS, LOCAL_LIMITS, fileUrl, latencyEnv, say, startLocalStack } from './stack.mjs';

const TAG = 'fault-geo-soak';
const flags = parseFlags(process.argv.slice(2), {
  duration: '600',
  seed: String(randomInt(1, 2 ** 31)),
  accounts: '2',
  port: process.env.WAYVRO_SOAK_API_PORT ?? '4132',
  name: 'soak',
  latency: latencyEnv(DEFAULT_LATENCY_MS),
});
const DURATION_S = positiveInt('duration', flags.duration, 86_400);
const SEED = positiveInt('seed', flags.seed, 2 ** 32 - 1);
const ACCOUNTS = positiveInt('accounts', flags.accounts, 20);
const LATENCY = Object.fromEntries(
  flags.latency.split(',').map((e) => {
    const [sku, ms] = e.split('=');
    return [sku, Number(ms)];
  }),
);
// API defaults (apps/api/src/config.ts) — timeouts, deadline and retries stay unchanged for the soak.
// Soak-only stack env: the breaker's OPEN period at its configured minimum (default 30 s) so that, with a ~50 % failure
// mix, more requests reach the faulted MOCK provider instead of an open breaker; trip thresholds stay at their defaults.
const SOAK_ENV = { GEO_BREAKER_OPEN_SECONDS: '5' };
const POLICY = { QUOTE_DEADLINE_MS: 3000, GEO_AUTOCOMPLETE_TIMEOUT_MS: 1500, GEO_REVERSE_TIMEOUT_MS: 2000, GEO_RETRY_SLACK_MS: 500, GEO_CONNECT_RETRIES: 1 };
const LATENCY_MARGIN_MS = 1500;
const SKUS = ['AUTOCOMPLETE', 'GEOCODE', 'REVERSE_GEOCODE', 'PLACE_RESOLVE', 'ROUTE'];
/** FG-01..08 fault mix (weights). NONE keeps a healthy share so the breaker also closes again during the run. */
const FAULTS = [
  ['NONE', 40],
  ['TIMEOUT', 7], // FG-01
  ['UPSTREAM_5XX', 9], // FG-02
  ['CONNECT_ERROR', 9], // FG-02
  ['MALFORMED', 9], // FG-03
  ['SLOW_DRIP', 7], // FG-04
  ['QUOTA', 5], // FG-05
  ['PARTIAL', 9], // FG-06
  ['EMPTY', 9], // FG-07
  ['ECHO_QUERY', 4], // FG-08
  ['REJECTED_INPUT', 2],
];
const FAILURE_FAULTS = new Set(['TIMEOUT', 'UPSTREAM_5XX', 'CONNECT_ERROR', 'MALFORMED', 'QUOTA', 'ECHO_QUERY', 'REJECTED_INPUT']);
const RAW_TEXT_MARKERS = [
  'upstream rejected',
  'geo provider call refused',
  'routing unavailable:',
  'GeoProviderError',
  'ProviderRefused',
  'RoutingUnavailableError',
  'AbortError',
  'deadline exceeded',
  'adapter rejected',
  '    at ',
  'syn-lhr-',
];

const { API_ROUTES, ErrorEnvelopeSchema } = await import(fileUrl('packages/contracts/dist/index.js'));
const { SYNTHETIC_GAZETTEER, straightLineRoute } = await import(fileUrl('packages/provider-test-doubles/dist/index.js'));
const contract = (method, path) => API_ROUTES.find((x) => x.method === method && x.path === path);
const SCENARIOS = {
  quote: { sku: 'ROUTE', contract: contract('POST', '/v1/quotes'), maxMs: POLICY.QUOTE_DEADLINE_MS, reasons: ['ROUTING_UNAVAILABLE'] },
  autocomplete: {
    sku: 'AUTOCOMPLETE',
    contract: contract('GET', '/v1/geo/autocomplete'),
    maxMs: POLICY.GEO_AUTOCOMPLETE_TIMEOUT_MS + POLICY.GEO_RETRY_SLACK_MS,
    reasons: ['GEO_PROVIDER_UNAVAILABLE', 'GEO_BUDGET_EXHAUSTED'],
  },
  reverse: {
    sku: 'REVERSE_GEOCODE',
    contract: contract('GET', '/v1/geo/reverse'),
    maxMs: POLICY.GEO_REVERSE_TIMEOUT_MS + POLICY.GEO_RETRY_SLACK_MS,
    reasons: ['GEO_PROVIDER_UNAVAILABLE', 'GEO_BUDGET_EXHAUSTED'],
  },
};

const rng = prng(SEED);
let pairCounter = 0;
const pricedPairs = new Set();

function plan() {
  const scenario = rng.weighted([
    ['quote', 50],
    ['autocomplete', 25],
    ['reverse', 25],
  ]);
  const mode = rng.weighted(FAULTS);
  const fault = { sku: SCENARIOS[scenario].sku, mode };
  if (mode === 'SLOW_DRIP') fault.delayMs = rng.int(50, 4000);
  if (mode === 'QUOTA') fault.retryAfterSeconds = rng.int(1, 3);
  let request;
  if (scenario === 'quote') {
    request = { method: 'POST', path: '/v1/quotes', body: quotePair(pairCounter++), headers: APP_HEADERS };
  } else if (scenario === 'autocomplete') {
    // random coarse bias cell → mostly distinct cache keys, so the fault reaches the provider
    const q = new URLSearchParams({
      cityCode: 'LHR',
      q: rng.pick(SEARCH_TEXTS),
      locale: 'en',
      session: randomUUID(),
      biasLat: (31.41 + rng.int(0, 23) * 0.01).toFixed(2),
      biasLng: (74.21 + rng.int(0, 28) * 0.01).toFixed(2),
    });
    request = { method: 'GET', path: `/v1/geo/autocomplete?${q.toString()}`, headers: APP_HEADERS };
  } else {
    // ≤ ~1.3 km from a synthetic place: inside the MOCK reverse coder's 1.5 km radius, so value-shaping faults apply
    const p = rng.pick(SYNTHETIC_GAZETTEER).point;
    const lat = (p.lat + rng.int(-90, 90) * 0.0001).toFixed(4);
    const lng = (p.lng + rng.int(-90, 90) * 0.0001).toFixed(4);
    request = { method: 'GET', path: `/v1/geo/reverse?${new URLSearchParams({ cityCode: 'LHR', lat, lng, locale: 'en' }).toString()}`, headers: APP_HEADERS };
  }
  return { scenario, fault, request };
}

async function calls(baseUrl) {
  const r = await timed(baseUrl, { path: '/__local/geo-control' });
  if (r.status !== 200) throw new Error(`geo-control read failed with ${String(r.status)}`);
  return r.json.calls;
}

/** Returns { outcome, violations[] } for one request. */
function evaluate(p, r, delta) {
  const v = [];
  const sc = SCENARIOS[p.scenario];
  const own = delta[sc.sku];
  for (const s of SKUS) if (s !== sc.sku && delta[s] !== 0) v.push(`I6 unexpected ${s} provider call(s): ${String(delta[s])}`);
  const maxCalls = sc.sku === 'ROUTE' ? 1 : 1 + POLICY.GEO_CONNECT_RETRIES;
  if (own > maxCalls) v.push(`I6 ${String(own)} ${sc.sku} calls > max ${String(maxCalls)}`);
  if (own > 1 && p.fault.mode !== 'CONNECT_ERROR') v.push(`I6 retry after ${p.fault.mode} (${String(own)} calls)`);
  if (r.ms > sc.maxMs + LATENCY_MARGIN_MS) v.push(`I7 latency ${String(Math.round(r.ms))} ms > ${String(sc.maxMs + LATENCY_MARGIN_MS)} ms`);
  for (const m of RAW_TEXT_MARKERS) if (r.text.includes(m)) v.push(`I5 response contains "${m.trim()}"`);

  if (r.status === 0) return { outcome: `transport:${r.transportError}`, violations: [...v, 'I1 transport failure'] };
  if (r.status >= 200 && r.status < 300) {
    const schema = sc.contract.responses[r.status];
    if (!schema || !schema.safeParse(r.json).success) v.push(`I2 ${String(r.status)} body fails the contract schema`);
    const cache = p.scenario === 'quote' ? r.json?.route?.source?.cacheStatus : r.json?.source?.cacheStatus;
    if (r.json?.route?.source?.providerKey !== undefined && r.json.route.source.providerKey !== 'geo-mock') v.push('I3 unexpected route provider key');
    if (cache === 'MISS' && own < 1) v.push('I3 MISS without a provider call');
    if (cache === 'HIT' && own !== 0) v.push('I3 HIT with a provider call');
    const failed = FAILURE_FAULTS.has(p.fault.mode) || (p.scenario === 'quote' && (p.fault.mode === 'PARTIAL' || p.fault.mode === 'EMPTY'));
    if (failed && cache === 'MISS') v.push(`I4 fresh 2xx despite ${p.fault.mode}`);
    if (p.scenario === 'quote') {
      const key = JSON.stringify([p.request.body.pickup, p.request.body.dropoff]);
      if (cache === 'HIT' && !pricedPairs.has(key)) v.push('I3 HIT for a pair never priced before');
      const expected = straightLineRoute({ origin: p.request.body.pickup, destination: p.request.body.dropoff, profile: 'CAR', departAt: new Date() });
      if (r.json?.route?.distanceM !== expected.distanceM || r.json?.route?.durationS !== expected.durationS)
        v.push(`I3 route ${String(r.json?.route?.distanceM)} m / ${String(r.json?.route?.durationS)} s is not the provider's route`);
      for (const o of r.json?.options ?? []) {
        if (o.status !== 'PRICED') v.push(`I3 option ${String(o.productCode)} is ${String(o.status)}`);
        const sum = (o.components ?? []).reduce((s, c) => s + BigInt(c.amount.minor), 0n);
        if (sum !== BigInt(o.total?.minor ?? '-1')) v.push(`I3 option ${String(o.productCode)} Σ components ≠ total`);
      }
      if ((r.json?.options ?? []).length === 0) v.push('I3 2xx quote without a priced option');
      pricedPairs.add(key);
    }
    if (cache === 'MISS' && p.fault.mode === 'EMPTY') {
      if (p.scenario === 'autocomplete' && (r.json?.suggestions ?? []).length !== 0) v.push('I4 EMPTY provider answer but suggestions returned');
      if (p.scenario === 'reverse' && r.json?.address !== null) v.push('I4 EMPTY provider answer but an address returned');
    }
    if (cache === 'MISS' && p.fault.mode === 'PARTIAL' && p.scenario === 'autocomplete' && (r.json?.suggestions ?? []).length > 1)
      v.push('I4 PARTIAL provider answer (1 candidate) but more suggestions returned');
    return { outcome: `${String(r.status)} ${String(cache)}`, violations: v };
  }
  const env = ErrorEnvelopeSchema.safeParse(r.json);
  if (!env.success) v.push(`I1 ${String(r.status)} body is not an ErrorEnvelope`);
  const code = env.success ? env.data.error.code : 'UNPARSEABLE';
  const reasons = env.success ? (env.data.error.details?.reasonCodes ?? []) : [];
  if (r.status === 503) {
    if (code !== 'WAYVRO_E_DEPENDENCY_UNAVAILABLE') v.push(`I1 503 with ${code}`);
    if (reasons.length !== 1 || !sc.reasons.includes(reasons[0])) v.push(`I1 503 reason ${JSON.stringify(reasons)}`);
    return { outcome: `503 ${reasons.join('+')}${own === 0 ? ' (no provider call)' : ''}`, violations: v };
  }
  if (r.status >= 500) return { outcome: `${String(r.status)} ${code}`, violations: [...v, `I1 ${String(r.status)} ${code}`] };
  if (!(r.status in sc.contract.responses)) v.push(`I1 undocumented ${String(r.status)}`);
  return { outcome: `${String(r.status)} ${code}${reasons.length ? ` ${reasons.join('+')}` : ''}`, violations: v };
}

/** Negative control: the checker must flag each planted violation, or the soak refuses to run (no fake green). */
function selfCheck() {
  const zero = Object.fromEntries(SKUS.map((s) => [s, 0]));
  const quote = { scenario: 'quote', fault: { sku: 'ROUTE', mode: 'NONE' }, request: { body: { pickup: { lat: 0, lng: 0 }, dropoff: { lat: 0, lng: 0.01 } } } };
  const priced = { route: { distanceM: 1, durationS: 1, source: { providerKey: 'geo-mock', cacheStatus: 'MISS' } }, options: [] };
  const res = (status, json, ms = 10) => ({ status, ms, json, text: JSON.stringify(json) });
  const cases = [
    ['I1', quote, res(500, { error: { code: 'WAYVRO_E_INTERNAL', message: 'x', requestId: 'r' } }), { ...zero, ROUTE: 1 }],
    ['I4', { ...quote, fault: { sku: 'ROUTE', mode: 'TIMEOUT' } }, res(201, priced), { ...zero, ROUTE: 1 }],
    ['I3', quote, res(201, { ...priced, route: { ...priced.route, source: { providerKey: 'geo-mock', cacheStatus: 'HIT' } } }), zero],
    [
      'I5',
      quote,
      res(503, { error: { code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE', message: 'upstream rejected request for 31.5,74.3', requestId: 'r' } }),
      { ...zero, ROUTE: 1 },
    ],
    [
      'I6',
      quote,
      res(503, { error: { code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE', message: 'x', requestId: 'r', details: { reasonCodes: ['ROUTING_UNAVAILABLE'] } } }),
      { ...zero, ROUTE: 2 },
    ],
    [
      'I7',
      quote,
      res(503, { error: { code: 'WAYVRO_E_DEPENDENCY_UNAVAILABLE', message: 'x', requestId: 'r', details: { reasonCodes: ['ROUTING_UNAVAILABLE'] } } }, 9000),
      { ...zero, ROUTE: 1 },
    ],
  ];
  for (const [id, p, r, delta] of cases) {
    if (!evaluate(p, r, delta).violations.some((v) => v.startsWith(id))) throw new Error(`soak self-check: the ${id} checker missed a planted violation`);
  }
  pricedPairs.clear();
  return cases.length;
}

const startedAt = new Date().toISOString();
const selfChecked = selfCheck();
say(TAG, `invariant checker self-check: ${String(selfChecked)} planted violations detected`);
const BASENAME = `fault-geo-soak-${stamp()}`;
const LOG_FILE = join(OUT_DIR, `${BASENAME}-api.log`);
say(TAG, `seed ${String(SEED)} (re-run with --seed ${String(SEED)}); duration ${String(DURATION_S)} s; latency ${flags.latency}`);
const stack = await startLocalStack({
  tag: TAG,
  name: flags.name,
  port: flags.port,
  latency: LATENCY,
  geoControl: true,
  stackEnv: SOAK_ENV,
  accounts: ACCOUNTS,
  logFile: LOG_FILE,
  logLevel: 'info',
});
const counts = {};
const byFault = {};
const violations = [];
let requests = 0;
const maxLatency = { quote: 0, autocomplete: 0, reverse: 0 };
const until = performance.now() + DURATION_S * 1000;
let lastProgress = performance.now();
try {
  let before = await calls(stack.baseUrl);
  while (performance.now() < until) {
    const p = plan();
    const set = await timed(stack.baseUrl, { method: 'PUT', path: '/__local/geo-control/fault', body: p.fault });
    if (set.status !== 204) throw new Error(`geo-control fault set failed with ${String(set.status)}`);
    const r = await timed(stack.baseUrl, { ...p.request, token: stack.tokens[requests % stack.tokens.length] });
    const after = await calls(stack.baseUrl);
    const delta = Object.fromEntries(SKUS.map((s) => [s, after[s] - before[s]]));
    before = after;
    requests++;
    maxLatency[p.scenario] = Math.max(maxLatency[p.scenario], Math.round(r.ms));
    const { outcome, violations: v } = evaluate(p, r, delta);
    const k = `${p.scenario} · ${outcome}`;
    counts[k] = (counts[k] ?? 0) + 1;
    const f = `${p.scenario} · ${p.fault.mode}`;
    byFault[f] ??= {};
    byFault[f][outcome] = (byFault[f][outcome] ?? 0) + 1;
    for (const msg of v) violations.push({ request: requests, scenario: p.scenario, fault: p.fault, status: r.status, ms: Math.round(r.ms), violation: msg });
    if (performance.now() - lastProgress > 30_000) {
      lastProgress = performance.now();
      say(
        TAG,
        `${String(requests)} requests, ${String(violations.length)} invariant violations, ${String(Math.round((until - performance.now()) / 1000))} s left`,
      );
    }
  }
  await timed(stack.baseUrl, { method: 'DELETE', path: '/__local/geo-control/fault' });
} finally {
  await stack.stop();
}

// I5b (FG-08, LOG-GEO): the runner's own logs (info level, incl. the access log) never carry an adapter's raw error
// text, a stack trace, a raw provider place id or a search text.
const logLines = readFileSync(LOG_FILE, 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');
const logMarkers = [...RAW_TEXT_MARKERS, ...SEARCH_TEXTS];
// breaker / quota cool-down / timeout evidence: the structured signals the gateway emitted during the run
const signals = {};
for (const line of logLines) {
  const s = /"signal":"(GEO_[A-Z_]+|QUOTE_[A-Z_]+)"/.exec(line)?.[1];
  if (s) signals[s] = (signals[s] ?? 0) + 1;
}
for (const [n, line] of logLines.entries()) {
  for (const m of logMarkers)
    if (line.includes(m))
      violations.push({
        request: null,
        scenario: 'api-log',
        fault: { mode: 'n/a' },
        status: null,
        ms: null,
        violation: `I5b log line ${String(n + 1)} contains "${m.trim()}"`,
      });
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const report = {
  label: REPORT_LABEL,
  kind: 'fault-geo-soak',
  seed: SEED,
  durationSeconds: DURATION_S,
  startedAt,
  finishedAt: new Date().toISOString(),
  host: { node: process.version, platform: process.platform, arch: process.arch },
  stack: {
    database: `${stack.database} (throwaway, dropped)`,
    runner: 'apps/api/dist-dev/dev/main.local.js with WAYVRO_LOCAL_GEO_CONTROL=1 (MOCK geo doubles)',
    injectedProviderLatencyMs: LATENCY,
    apiPolicy: POLICY,
    localLimits: LOCAL_LIMITS,
    soakEnv: SOAK_ENV,
  },
  checkerSelfCheck: `${String(selfChecked)} planted violations detected (I1, I3, I4, I5, I6, I7)`,
  faultWeights: Object.fromEntries(FAULTS),
  requests,
  outcomeCounts: sorted(counts),
  outcomesByFault: sorted(byFault),
  maxLatencyMs: maxLatency,
  apiLogScan: { file: LOG_FILE, lines: logLines.length, markers: logMarkers.length },
  apiLogSignals: sorted(signals),
  invariantViolations: violations.length,
  violations: violations.slice(0, 200),
};
const md = [
  `# Wayvro FAULT-GEO soak — ${REPORT_LABEL}`,
  '',
  `Seed **${String(SEED)}** (reproduce the fault plan with \`--seed ${String(SEED)}\`), duration ${String(DURATION_S)} s, ${String(requests)} requests (sequential), started ${startedAt}.`,
  `Injected synthetic provider latency (ms): ${JSON.stringify(LATENCY)}. API policy (defaults): ${JSON.stringify(POLICY)}. Soak-only stack env: ${JSON.stringify(SOAK_ENV)}.`,
  '',
  `**Invariant violations: ${String(violations.length)}**`,
  '',
  '| scenario · outcome | count |',
  '|---|---|',
  ...Object.entries(report.outcomeCounts).map(([k, c]) => `| ${k} | ${String(c)} |`),
  '',
  '| scenario · fault | outcomes |',
  '|---|---|',
  ...Object.entries(report.outcomesByFault).map(
    ([k, o]) =>
      `| ${k} | ${Object.entries(o)
        .map(([x, c]) => `${x}×${String(c)}`)
        .join(', ')} |`,
  ),
  '',
  `Max latency (ms): ${JSON.stringify(maxLatency)}. API log scanned: ${String(logLines.length)} lines (info level) for ${String(logMarkers.length)} raw-text/search-text markers.`,
  `Gateway signals in the API log: ${Object.entries(report.apiLogSignals)
    .map(([s, c]) => `${s}×${String(c)}`)
    .join(', ')}.`,
  '',
  ...(violations.length
    ? ['## Violations (first 50)', '', ...violations.slice(0, 50).map((x) => `- #${String(x.request)} ${x.scenario} ${x.fault.mode}: ${x.violation}`), '']
    : []),
].join('\n');
const out = writeReport(BASENAME, report, md);
say(TAG, `seed ${String(SEED)}: ${String(requests)} requests, ${String(violations.length)} invariant violations; report ${out.mdPath}`);
if (violations.length > 0) process.exitCode = 1;
