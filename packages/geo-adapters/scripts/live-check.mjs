#!/usr/bin/env node
/*
 * Live smoke check of the candidate geo adapters against REAL providers (founder-run only; never in CI).
 *
 *   pnpm --filter @wayvro/geo-adapters test:live
 *
 * Runs only the bundles whose keys/URLs are present in the environment (GEO_GOOGLE_API_KEY, GEO_MAPBOX_ACCESS_TOKEN,
 * GEO_PHOTON_URL, GEO_NOMINATIM_URL, GEO_OSRM_URL, GEO_VALHALLA_URL). With none present it prints NOT RUN and exits 0:
 * NOT RUN is NOT a pass. One call per SKU per bundle (≈ 5 billable calls for S1/S2; inside the free tiers).
 * Output is outcome, latency and result count only: no provider content, no coordinates, no key. Any FAIL ⇒ exit 1.
 * Inputs are two well-known PUBLIC Lahore landmarks (3-decimal coordinates), never field data.
 */
import { randomUUID } from 'node:crypto';
import {
  GeoAdapterError,
  createGoogleBundle,
  createMapboxBundle,
  createOpenStackComponents,
  readGoogleGeoConfig,
  readMapboxGeoConfig,
  readOpenStackGeoConfig,
} from '../dist/index.js';

const out = (line) => process.stdout.write(`${line}\n`);
const ORIGIN = { lat: 31.593, lng: 74.31 }; // Minar-e-Pakistan (public monument), 3 dp
const DESTINATION = { lat: 31.522, lng: 74.404 }; // Allama Iqbal International Airport (public), 3 dp
const QUERY = 'Minar-e-Pakistan Lahore';
const TIMEOUT_MS = 8000;

let configs;
try {
  configs = { google: readGoogleGeoConfig(process.env), mapbox: readMapboxGeoConfig(process.env), open: readOpenStackGeoConfig(process.env) };
} catch (error) {
  out(`GEO-ADAPTERS LIVE: FAIL — configuration error: ${error instanceof Error ? error.message : 'unknown'}`);
  process.exit(1);
}

const results = [];
async function check(label, run) {
  const started = performance.now();
  try {
    const detail = await run(AbortSignal.timeout(TIMEOUT_MS));
    const ms = Math.round(performance.now() - started);
    results.push('PASS');
    out(`PASS  ${label} (${ms} ms${detail ? `, ${detail}` : ''})`);
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    results.push('FAIL');
    out(`FAIL  ${label} (${ms} ms, ${error instanceof GeoAdapterError ? error.code : 'unexpected error'})`);
  }
}

function notRun(label, reason) {
  results.push('NOT RUN');
  out(`NOT RUN  ${label} — ${reason}`);
}

async function bundleChecks(name, bundle) {
  const session = randomUUID();
  let firstId = null;
  await check(`${name} AUTOCOMPLETE`, async (signal) => {
    const list = await bundle.placesAutocomplete.suggest(
      { text: QUERY, locale: 'en', biasCell: { lat: 31.52, lng: 74.35 }, countryCode: 'PK', searchSessionId: session },
      signal,
    );
    firstId = list[0]?.providerPlaceId ?? null;
    return `${list.length} results`;
  });
  if (firstId === null) notRun(`${name} PLACE_RESOLVE`, 'autocomplete returned no candidate to resolve');
  else
    await check(
      `${name} PLACE_RESOLVE`,
      async (signal) => (await bundle.geocoding.resolve({ providerPlaceId: firstId, searchSessionId: session, locale: 'en' }, signal), 'resolved'),
    );
  await check(
    `${name} GEOCODE`,
    async (signal) => `${(await bundle.geocoding.geocode({ text: QUERY, locale: 'en', countryCode: 'PK' }, signal)).length} results`,
  );
  await check(`${name} REVERSE_GEOCODE`, async (signal) =>
    (await bundle.reverseGeocoding.reverse({ point: ORIGIN, locale: 'en' }, signal)) === null ? 'no address' : 'address',
  );
  await check(`${name} ROUTE`, async (signal) => {
    const r = await bundle.routing.route({ origin: ORIGIN, destination: DESTINATION, profile: 'CAR', departAt: new Date() }, signal);
    return `distance and duration present, ${r.geometry.length} vertices`;
  });
}

out('GEO-ADAPTERS LIVE CHECK (real providers; founder keys from the environment)');
if (configs.google === null) notRun('S1 Google', 'GEO_GOOGLE_API_KEY not set');
else await bundleChecks('S1 Google', createGoogleBundle(configs.google, { providerKey: 'geo-live-s1' }));
if (configs.mapbox === null) notRun('S2 Mapbox', 'GEO_MAPBOX_ACCESS_TOKEN not set');
else await bundleChecks('S2 Mapbox', createMapboxBundle(configs.mapbox, { providerKey: 'geo-live-s2' }));

const s3 = createOpenStackComponents(configs.open, { providerKey: 'geo-live-s3' });
const session = randomUUID();
if (s3.photonAutocomplete === null) notRun('S3 Photon AUTOCOMPLETE/REVERSE', 'GEO_PHOTON_URL not set');
else {
  await check(
    'S3 Photon AUTOCOMPLETE',
    async (signal) =>
      `${(await s3.photonAutocomplete.suggest({ text: QUERY, locale: 'en', biasCell: null, countryCode: 'PK', searchSessionId: session }, signal)).length} results`,
  );
  await check('S3 Photon REVERSE_GEOCODE', async (signal) =>
    (await s3.photonReverse.reverse({ point: ORIGIN, locale: 'en' }, signal)) === null ? 'no address' : 'address',
  );
}
if (s3.photonGeocoding === null) notRun('S3 Photon GEOCODE/PLACE_RESOLVE', 'needs GEO_PHOTON_URL and GEO_NOMINATIM_URL');
else
  await check(
    'S3 Photon GEOCODE',
    async (signal) => `${(await s3.photonGeocoding.geocode({ text: QUERY, locale: 'en', countryCode: 'PK' }, signal)).length} results`,
  );
if (s3.nominatimReverse === null) notRun('S3 Nominatim REVERSE_GEOCODE', 'GEO_NOMINATIM_URL not set');
else
  await check('S3 Nominatim REVERSE_GEOCODE', async (signal) =>
    (await s3.nominatimReverse.reverse({ point: ORIGIN, locale: 'en' }, signal)) === null ? 'no address' : 'address',
  );
for (const [label, adapter, variable] of [
  ['S3 OSRM ROUTE', s3.osrm, 'GEO_OSRM_URL'],
  ['S3 Valhalla ROUTE', s3.valhalla, 'GEO_VALHALLA_URL'],
]) {
  if (adapter === null) notRun(label, `${variable} not set`);
  else
    await check(
      label,
      async (signal) =>
        `${(await adapter.route({ origin: ORIGIN, destination: DESTINATION, profile: 'CAR', departAt: new Date() }, signal)).geometry.length} vertices`,
    );
}

const count = (s) => results.filter((r) => r === s).length;
const summary = `PASS ${count('PASS')} · FAIL ${count('FAIL')} · NOT RUN ${count('NOT RUN')}`;
if (count('PASS') + count('FAIL') === 0) {
  out(`GEO-ADAPTERS LIVE: NOT RUN — no provider key or self-hosted URL in the environment (${summary}). This is NOT a pass.`);
  process.exit(0);
}
out(`GEO-ADAPTERS LIVE: ${count('FAIL') > 0 ? 'FAIL' : 'PASS (configured providers only)'} — ${summary}`);
process.exit(count('FAIL') > 0 ? 1 : 0);
