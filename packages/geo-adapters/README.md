# @wayvro/geo-adapters (SERVER-ONLY, CANDIDATES — NOT BOUND)

Candidate implementations of the vendor-neutral geo ports in `packages/provider-interfaces/src/geo-ports.ts`
(Phase 3 P3.2; requirement IDs E06, B02/B03, I11, U04; ADR-006 **OPEN-SPIKE**). Each adapter = the port methods + a
`licences: GeoAdapterLicence[]` declaration; every method takes an `AbortSignal` (the gateway owns timeouts).

**No composition root binds any of these adapters in this checkpoint.** There is no provider freeze (ADR-006 is decided
only at P3.7 on SP-04 evidence), no provider account and no key. Until then the API's geo SKUs stay unbound and
staging/production refuse honestly (503, never invented values). Today the only consumers are the unit tests, the
founder-run live smoke (`test:live`) and the dev-only SP-04 harness (`tools/geo-bench`).

## Candidate bundles (licence-coherent, CON-P3-16)

| Bundle | SKU | Adapter | Upstream |
|---|---|---|---|
| S1 Google | AUTOCOMPLETE | `GooglePlacesAutocompleteAdapter` | Places API (New) Autocomplete, session token, minimal field mask |
| | GEOCODE / PLACE_RESOLVE | `GoogleGeocodingAdapter` | Geocoding API v3 (forward, `components=country:PK`) / Place Details (New), Essentials field mask (no `displayName`) |
| | REVERSE_GEOCODE | `GoogleReverseGeocodingAdapter` | Geocoding API v3 `latlng` (5 dp) |
| | ROUTE | `GoogleRoutesAdapter` | Routes API computeRoutes, DRIVE, TRAFFIC_UNAWARE by default |
| S2 Mapbox | AUTOCOMPLETE | `MapboxSearchBoxAutocompleteAdapter` | Search Box `/suggest` (session token) |
| | GEOCODE / PLACE_RESOLVE | `MapboxGeocodingAdapter` | Geocoding v6 `/forward` `permanent=false` / Search Box `/retrieve` |
| | REVERSE_GEOCODE | `MapboxReverseGeocodingAdapter` | Geocoding v6 `/reverse` `permanent=false` |
| | ROUTE | `MapboxDirectionsAdapter` | Directions v5 `mapbox/driving` |
| S3 open (self-hosted only) | AUTOCOMPLETE | `PhotonAutocompleteAdapter` | Photon `/api` (Pakistan bbox) |
| | GEOCODE / PLACE_RESOLVE | `PhotonGeocodingAdapter` | Photon `/api` / Nominatim `/lookup` of the OSM reference |
| | REVERSE_GEOCODE | `PhotonReverseGeocodingAdapter`, `NominatimReverseGeocodingAdapter` | Photon `/reverse` / Nominatim `/reverse` jsonv2 |
| | ROUTE | `OsrmRoutingAdapter`, `ValhallaRoutingAdapter` | OSRM `/route/v1/driving` / Valhalla `/route?json=` |

`createGoogleBundle`, `createMapboxBundle` and `createOpenStackComponents` assemble a bundle from validated
configuration with one opaque provider key (e.g. `geo-a`); the vendor mapping lives only in configuration/ADR-006.
S2 may be evaluated, but **cannot be frozen for pilot/production while FA-19** (written Mapbox Commercial Application
License clarification) is open. The public Nominatim, Photon, OSRM and OSM tile servers are refused by the config
loader.

## Licence declarations (terms-derived maxima; the gateway applies min(declared, configured))

| Bundle | AUTOCOMPLETE | GEOCODE / PLACE_RESOLVE / REVERSE | ROUTE | Renderer | Geometry storable | Attribution |
|---|---|---|---|---|---|---|
| S1 | TTL 0 | ≤ 30 days, shared temporary cache (lat/lng rule) — **P3.7 terms item:** confirm the cached address components are covered, else cache the point only | TTL 0 until the Routes caching terms are read | `google` | no | `GOOGLE_MAPS` |
| S2 | 0 | 0 (temporary geocoding / Search Box temporary use) | 0 (NF) | `mapbox` | no | `MAPBOX` |
| S3 | 24 h | 7 days | 10 min | `any` | yes (ODbL data) | `OSM_ODBL` |

`microUsdPerCall` comes from the planning-time price tables (read 2026-10-12, first list tier) and is marked ESTIMATE
in `src/licences.ts`; it is used only for usage metering/budgets, never for user-facing prices. Where a price could be
billed per session (Google autocomplete, Mapbox Search Box) the declaration is the conservative upper bound.

## Behaviour guarantees (tested with hand-written synthetic fixtures)

- Every payload is validated with zod (bounded strings/arrays) and mapped to Wayvro types; unknown fields are dropped.
- Malformed or oversized (> 1 MiB by default) payloads, non-success statuses, 401/403, 429/quota statuses, timeouts
  (AbortSignal), network failures and routes without a positive distance or a duration THROW `GeoAdapterError` with a
  stable `code`; nothing is defaulted and no place is fabricated. "No result" is `[]` / `null`.
- `GeoAdapterError` **is** the canonical `GeoProviderError` of `@wayvro/provider-interfaces` (fix 2026-10-17): its
  detailed `code` is translated once, at construction, into the canonical `kind` the API gateway classifies on
  (`toGeoProviderFailure` in `src/errors.ts`: TIMEOUT/ABORTED ⇒ TIMEOUT, NETWORK before a status ⇒ CONNECT and after
  ⇒ UPSTREAM, AUTH ⇒ AUTH, QUOTA ⇒ QUOTA, CLIENT_ERROR/INVALID_INPUT ⇒ REJECTED_INPUT, SERVER_ERROR/PROVIDER_STATUS
  ⇒ UPSTREAM, MALFORMED/OVERSIZED/INCOMPLETE_ROUTE ⇒ MALFORMED, NO_ROUTE/NOT_FOUND ⇒ NO_RESULT). On QUOTA the
  `Retry-After` header (delta-seconds or HTTP-date against the injected server clock `now`) is carried as
  `retryAfterSeconds`, bounded to 1–3600 s. Google Places (New) / Routes 4xx bodies are classified by the documented
  `ErrorInfo.reason` (e.g. HTTP 400 `API_KEY_INVALID` ⇒ AUTH). The breaker/cool-down policy is the gateway's, from
  `kind`; `countsAsProviderFailure` only serves the SP-04 harness's error accounting.
- Errors never contain the provider body, the request URL (some vendors take the key as a query parameter), the query
  or a `cause`. Redirects are refused so a key never follows one.
- The provider receives only query text, the gateway's coarse 2-decimal bias cell, points (reverse: 5 dp), session
  tokens and the credential — never an account, phone or installation id (privacy test across all adapters).
- Results outside the Pakistan bbox are dropped from lists and make single answers (resolve, reverse, route geometry)
  a `MALFORMED_RESPONSE`. Provider strings are cleaned (control and bidi-override characters removed, length-capped)
  and are plain text. `society` is never inferred; `nameUrdu` only when the provider returned Arabic script for an
  Urdu request.

Request/response shapes, session semantics and the conservative readings are documented per adapter in
[SOURCES.md](./SOURCES.md).

## Configuration (environment only; never committed, logged or printed)

| Variable | Meaning |
|---|---|
| `GEO_GOOGLE_API_KEY` | S1 server key (evaluation project only, FA-06; restrict by API and server IP, console quotas ≈ free tier) |
| `GEO_GOOGLE_ROUTES_TRAFFIC_AWARE` | `true` ⇒ TRAFFIC_AWARE routing (higher-priced tier); default `false` |
| `GEO_MAPBOX_ACCESS_TOKEN` | S2 server token |
| `GEO_PHOTON_URL`, `GEO_NOMINATIM_URL`, `GEO_OSRM_URL`, `GEO_VALHALLA_URL` | S3 self-hosted base URLs: https, or http only to loopback / RFC 1918 addresses |

Keys are wrapped in `SecretValue` (redacted in `String()`, JSON and `util.inspect`); loader errors name the variable,
never its value.

## Scripts

| Command | What it proves |
|---|---|
| `pnpm --filter @wayvro/geo-adapters typecheck` / `build` | strict compile |
| `pnpm --filter @wayvro/geo-adapters test` (`test:coverage`) | parsing/normalisation, failure mapping, request shapes, licence sanity, request privacy — **synthetic fixtures only; mocked HTTP does not prove a real integration** |
| `pnpm --filter @wayvro/geo-adapters test:live` | founder-run smoke against REAL providers for whichever keys/URLs are set (one call per SKU, public landmark inputs, outcome/latency/count output only). With nothing set it prints `NOT RUN … This is NOT a pass.` and exits 0. Never run in CI. |

## Boundaries

Server-only: `@wayvro/geo-adapters` is in `SERVER_ONLY_WORKSPACE` (dependency-cruiser) and `SERVER_ONLY_PACKAGES`
(ESLint); dependency-cruiser `geo-adapters-composition-only` forbids imports from `apps/api/src/**` except
`composition.ts` / `main.ts`, and from `apps/worker/src/**`.
