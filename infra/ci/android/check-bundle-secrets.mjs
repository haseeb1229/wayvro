#!/usr/bin/env node
/*
 * Wayvro Android BUNDLE-SECRETS gate (PHASE3_TEST_STRATEGY §4.11; FA-06: provider keys never ship in the app).
 * Node >= 18, no npm dependencies. String scan of the Hermes JS bundle and of every (decompressed) entry of the release
 * AAB — dex, resources, assets, native libraries — for:
 *   - provider credential shapes: Google API keys (`AIza` + 35 key characters) and Mapbox tokens (`pk.`/`sk.`/`tk.` + JWT);
 *   - server-side geo credential/endpoint environment variable names (GEO_GOOGLE_*, GEO_MAPBOX_*, GEO_PHOTON_*, …):
 *     their presence would mean server configuration leaked into the client;
 *   - vendor map tile/style/API hosts, except hosts listed in `allowedVendorHosts` of infra/ci/android/sdk-inventory.json
 *     (tile/style URLs reach the app from GET /v1/app/config; no renderer is chosen yet, so the list is empty).
 * The scan reports the entry and a redacted excerpt (first 6 characters), never the full matched value.
 *
 * Usage: node infra/ci/android/check-bundle-secrets.mjs --aab app-release.aab [--report out.json]
 *        node infra/ci/android/check-bundle-secrets.mjs --self-test   (key-shaped values generated at run time)
 * Exit code 0 = PASS, 1 = FAIL, 2 = usage/tooling error.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './lib/zip.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = [
  { id: 'GOOGLE_API_KEY', re: /AIza[0-9A-Za-z_-]{35}/g },
  { id: 'MAPBOX_TOKEN', re: /\b[pst]k\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/g },
  { id: 'SERVER_GEO_ENV_NAME', re: /\bGEO_(GOOGLE|MAPBOX|PHOTON|NOMINATIM|OSRM|VALHALLA)_[A-Z0-9_]+/g },
];
const VENDOR_HOSTS = [
  'api.mapbox.com',
  'tiles.mapbox.com',
  'events.mapbox.com',
  'maps.googleapis.com',
  'places.googleapis.com',
  'routes.googleapis.com',
  'tile.openstreetmap.org',
  'tiles.openfreemap.org',
  'api.maptiler.com',
  'api.protomaps.com',
  'basemaps.cartocdn.com',
  'demotiles.maplibre.org',
];

const redact = (value) => `${value.slice(0, 6)}… (${String(value.length)} chars)`;

/** Pure scan of named buffers. Returns findings [{ entry, rule, excerpt }]. */
export function scanEntries(entries, allowedVendorHosts) {
  const findings = [];
  const vendor = VENDOR_HOSTS.filter((h) => !allowedVendorHosts.includes(h));
  for (const { name, data } of entries) {
    // latin1 keeps a 1:1 byte→char mapping, so ASCII patterns inside binary files (dex, Hermes bytecode, .so) match.
    const text = data.toString('latin1');
    for (const rule of RULES) for (const m of text.matchAll(rule.re)) findings.push({ entry: name, rule: rule.id, excerpt: redact(m[0]) });
    for (const host of vendor) if (text.includes(host)) findings.push({ entry: name, rule: 'VENDOR_HOST', excerpt: host });
  }
  return findings;
}

const allowedHosts = () => JSON.parse(readFileSync(join(HERE, 'sdk-inventory.json'), 'utf8')).allowedVendorHosts ?? [];

function selfTest() {
  // Key-shaped values are assembled at run time so no credential-shaped literal exists in the repository.
  const googleShaped = ['AI', 'za', 'Sy', 'X'.repeat(33)].join('');
  const mapboxShaped = ['pk', '.eyJ', '1Ijoi', 'c3ludGhldGlj', '.', 'Z'.repeat(22)].join('');
  const envName = ['GEO', 'MAPBOX', 'ACCESS', 'TOKEN'].join('_');
  const clean = [
    { name: 'base/assets/index.android.bundle', data: Buffer.from('hermes WayvroFullyDrawn https://api.example.test/v1/app/config') },
    { name: 'base/dex/classes.dex', data: Buffer.from('Lexpo/modules/location/LocationModule; https://www.googleapis.com/auth/userinfo') },
  ];
  const cases = [
    { name: 'clean artefact', entries: clean, allowed: [], pass: true },
    {
      name: 'Google API key shape in bundle',
      entries: [...clean, { name: 'base/assets/index.android.bundle', data: Buffer.from(`k="${googleShaped}"`) }],
      allowed: [],
      pass: false,
    },
    {
      name: 'Mapbox token shape in resources',
      entries: [...clean, { name: 'base/res/values/strings.xml', data: Buffer.from(mapboxShaped) }],
      allowed: [],
      pass: false,
    },
    {
      name: 'server geo env name in bundle',
      entries: [...clean, { name: 'base/assets/index.android.bundle', data: Buffer.from(`process.env.${envName}`) }],
      allowed: [],
      pass: false,
    },
    {
      name: 'vendor style URL in bundle',
      entries: [...clean, { name: 'base/assets/index.android.bundle', data: Buffer.from('https://api.maptiler.com/maps/streets/style.json') }],
      allowed: [],
      pass: false,
    },
    {
      name: 'vendor host allowed by the inventory',
      entries: [...clean, { name: 'base/assets/index.android.bundle', data: Buffer.from('https://api.maptiler.com/x') }],
      allowed: ['api.maptiler.com'],
      pass: true,
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const findings = scanEntries(c.entries, c.allowed);
    const ok = (findings.length === 0) === c.pass;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${findings.length === 0 ? 'no findings' : findings.map((f) => `${f.rule}@${f.entry}`).join(' | ')}`);
  }
  console.log(`BUNDLE-SECRETS GATE SELF-TEST: ${failed === 0 ? 'PASS' : 'FAIL'} (${String(cases.length)} cases)`);
  return failed === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--self-test') process.exit(selfTest() ? 0 : 1);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '') ?? ''] = argv[i + 1];
  if (!args.aab) {
    console.error('usage: --aab <file> [--report <json>] | --self-test');
    process.exit(2);
  }
  const zip = readZip(readFileSync(args.aab));
  const entries = zip.filter((e) => !e.name.endsWith('/')).map((e) => ({ name: e.name, data: e.read() }));
  const bundle = entries.find((e) => e.name === 'base/assets/index.android.bundle');
  const allowed = allowedHosts();
  const findings = scanEntries(entries, allowed);
  const problems = bundle ? [] : ['Hermes bundle base/assets/index.android.bundle not found in the AAB'];
  const report = {
    aab: args.aab,
    scannedEntries: entries.length,
    scannedBytes: entries.reduce((n, e) => n + e.data.length, 0),
    hermesBundleBytes: bundle?.data.length ?? null,
    allowedVendorHosts: allowed,
    findings,
    result: findings.length || problems.length ? 'FAIL' : 'PASS',
    problems,
  };
  if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 2) + '\n');
  console.log(
    `scanned ${String(report.scannedEntries)} entries (${String(report.scannedBytes)} B decompressed), Hermes bundle ${String(report.hermesBundleBytes)} B`,
  );
  console.log(`BUNDLE-SECRETS CHECK: ${report.result}`);
  for (const f of findings) console.log(`  - ${f.rule} in ${f.entry}: ${f.excerpt}`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(report.result === 'PASS' ? 0 : 1);
}
