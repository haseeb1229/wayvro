/*
 * Shared helpers of the local load harness and the FAULT-GEO soak (DEV-ONLY, Node built-ins only): CLI flags, a seeded
 * PRNG, timed HTTP calls, percentiles, synthetic request inputs inside the synthetic Lahore catalog, and report output
 * to build-logs/load/ (git-ignored).
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ROOT } from './stack.mjs';

export const REPORT_LABEL = 'LOCAL NON-STAGING — does not satisfy staging/production budgets';
export const OUT_DIR = join(ROOT, 'build-logs', 'load');

/** `--name value` / `--flag` parser; unknown flags are refused so a typo never silently runs the defaults. */
export function parseFlags(argv, spec) {
  const out = { ...spec };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]?.replace(/^--/, '');
    if (key === undefined || !(key in spec) || !argv[i]?.startsWith('--')) throw new Error(`unknown argument ${String(argv[i])}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    out[key] = value;
  }
  return out;
}

export const positiveInt = (name, v, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`--${name} must be an integer 1..${String(max)}`);
  return n;
};

/** mulberry32: small deterministic PRNG so a soak run is reproducible from its printed seed. */
export function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    weighted: (entries) => {
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of entries) {
        r -= w;
        if (r < 0) return v;
      }
      return entries[entries.length - 1][0];
    },
  };
}

/** One timed request; never throws for HTTP statuses. A transport failure is reported as status 0. */
export async function timed(baseUrl, { method = 'GET', path, body, token, headers = {}, timeoutMs = 15_000 }) {
  const started = performance.now();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const ms = performance.now() - started;
    let json = null;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, ms, text, json };
  } catch (e) {
    return { status: 0, ms: performance.now() - started, text: '', json: null, transportError: e instanceof Error ? e.name : 'Error' };
  }
}

/** Nearest-rank percentile of an ascending array (ms, 1 decimal). */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return Math.round(sorted[rank - 1] * 10) / 10;
}

export function latencySummary(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return { p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s.length ? Math.round(s[s.length - 1] * 10) / 10 : null };
}

/**
 * Synthetic quote points inside the synthetic service area, away from the exclusion, pickup-restricted and airport
 * rectangles (packages/test-support SYNTHETIC_CATALOG). `k` → a distinct 4-decimal pickup (the route-cache key
 * precision), so k ≠ k' never shares a route-cache entry; 490,000 distinct pickups.
 */
export function quotePair(k) {
  const i = k % 700;
  const j = Math.floor(k / 700) % 700;
  const pickup = { lat: Number((31.42 + i * 0.0001).toFixed(4)), lng: Number((74.22 + j * 0.0001).toFixed(4)) };
  const dropoff = { lat: Number((31.49 - i * 0.0001).toFixed(4)), lng: Number((74.44 - j * 0.0001).toFixed(4)) };
  return { cityCode: 'LHR', pickup, dropoff };
}

/** Synthetic search texts the MOCK gazetteer understands (public landmark names / Roman-Urdu spellings). */
export const SEARCH_TEXTS = [
  'liberty',
  'badshahi masjid',
  'minar e pakistan',
  'data sahib',
  'anarkali',
  'airport',
  'railway station',
  'emporium',
  'packages',
  'model town',
  'gaddafi',
  'kalma chowk',
  'mall road',
];

export const APP_HEADERS = { 'x-wayvro-platform': 'ANDROID', 'x-wayvro-app-version': '0.0.0', 'x-wayvro-app-build': '1' };

export function writeReport(basename, json, markdown) {
  mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = join(OUT_DIR, `${basename}.json`);
  const mdPath = join(OUT_DIR, `${basename}.md`);
  writeFileSync(jsonPath, JSON.stringify(json, null, 2) + '\n');
  writeFileSync(mdPath, markdown);
  return { jsonPath, mdPath };
}

export const stamp = () =>
  new Date()
    .toISOString()
    .replaceAll(':', '')
    .replace(/\.\d+Z$/, 'Z');
