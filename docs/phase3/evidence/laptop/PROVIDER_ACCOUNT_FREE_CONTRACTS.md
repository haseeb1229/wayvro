# Provider-account-free contract tests — S1 Google and S2 Mapbox geo adapters

**Date:** 2026-10-16 · **Branch:** `phase-3/maps-quotes-unified-ux` · **HEAD at run time:** `ef3cbd0` (new files uncommitted) · **Machine:** founder laptop (Windows 11) · **Package:** `packages/geo-adapters` (`@wayvro/geo-adapters`)

> **Scope banner.** These are ACCOUNT-FREE contract tests. Every provider answer is a hand-written SYNTHETIC fixture
> written from the publicly documented schema (`packages/geo-adapters/test/synthetic-google.ts`,
> `packages/geo-adapters/test/synthetic-mapbox.ts`); no recorded or scraped provider response, no provider account, no
> real key (fake values `test-key-not-real-…`) and no network call is used. They prove **Wayvro-side** behaviour
> (request construction, key handling, parsing, error mapping, timeouts, licence/cost declarations, port boundary)
> against those shapes. They **do NOT prove real-provider conformance**: that needs FA-06 credentials (and, for an
> S2 freeze, FA-19). Nothing here is SP-04 evidence and nothing here changes ADR-006 (OPEN-SPIKE).

## 1. What was added

| File                                                | Kind                                    | Purpose                                                                                                                                                                |
| --------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/geo-adapters/test/synthetic-google.ts`    | SYNTHETIC fixtures                      | Places API (New) autocomplete + Place Details, Geocoding v3 OK / non-OK statuses, Routes computeRoutes, Google API error model (`{error:{code,message,status,details}}`) |
| `packages/geo-adapters/test/synthetic-mapbox.ts`    | SYNTHETIC fixtures                      | Search Box `/suggest` + `/retrieve`, Geocoding v6 FeatureCollection, Directions v5 `Ok`, documented `{message}` / `{code,message}` error bodies                         |
| `packages/geo-adapters/test/contract-harness.ts`    | test helper                             | operation table type, fake credentials and sentinels, leak assertion, HTTP-status → code expectation, malformed bodies, stalling body, keyed-URL connect failure          |
| `packages/geo-adapters/src/google.contract.test.ts` | 102 tests                               | S1 contract suite (5 operations)                                                                                                                                       |
| `packages/geo-adapters/src/mapbox.contract.test.ts` | 91 tests                                | S2 contract suite (5 operations)                                                                                                                                       |
| this document                                       | evidence                                | —                                                                                                                                                                      |

No production source was changed. No existing test was changed, weakened or deleted. No export of the package changed.

## 2. Test reference legend

New tests — `src/google.contract.test.ts` (prefix **G**) and `src/mapbox.contract.test.ts` (prefix **M**). `%s` is
the operation name; parameterised tests run once per operation.

| ID         | Test name (describe › it)                                                                                                         | Cases |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | ----- |
| G-KEY      | request construction and key handling › `%s: the key travels only through its documented channel, exactly once`                  | 5     |
| G-MASK     | › `field masks are explicit and minimal on every Places (New) / Routes call: no wildcard, no Pro-tier displayName`                | 1     |
| G-SESS     | › `autocomplete and Place Details carry the SAME session token (one billing session); geocoding and routes carry none`            | 1     |
| G-SESS-BAD | › `refuses a malformed session token before any provider call (no unbilled-session guesswork)`                                    | 1     |
| G-PARSE    | parsing documented shapes into port types only › autocomplete / Place Details / `%s: viewport, plus code, place id …` / routes     | 5     |
| G-HTTP     | error mapping › `%s: HTTP %i with a Google error-model body ⇒ stable code` (400, 401, 403, 404, 429, 500, 503)                    | 35    |
| G-V3       | › `%s: HTTP 200 status %s ⇒ %s, error_message never read` (geocode + reverse × OVER_QUERY_LIMIT, OVER_DAILY_LIMIT, REQUEST_DENIED, INVALID_REQUEST, UNKNOWN_ERROR) | 10    |
| G-ZERO     | › `reverse ZERO_RESULTS is an honest null, never an invented address`                                                             | 1     |
| G-MALF     | › `%s: HTTP 200 with %s ⇒ MALFORMED_RESPONSE` (truncated JSON, HTML page, schema mismatch)                                        | 15    |
| G-TO       | timeouts › `%s: no response before the caller deadline ⇒ TIMEOUT`                                                                 | 5     |
| G-STALL    | › `%s: headers arrive but the body stalls past the deadline ⇒ TIMEOUT`                                                            | 5     |
| G-ABORT    | › `%s: caller cancellation ⇒ ABORTED (not a breaker failure)`                                                                     | 5     |
| G-NET      | › `%s: a connect failure echoing the keyed URL ⇒ NETWORK, URL not copied`                                                         | 5     |
| G-TTL      | cache-policy and cost-accounting hooks › `declares terms-derived TTLs: predictions and routes (both tiers) TTL 0, coordinates ≤ 30 days` | 1     |
| G-COST     | › `declares the planning-time ESTIMATE price per SKU used by the gateway meter (micro-USD per call)`                              | 1     |
| G-NOCACHE  | › `%s: the adapter holds no cache of its own (TTL is enforced only by the gateway)`                                               | 5     |
| G-NOLOG    | no logging › `success, HTTP error, malformed body and timeout paths write nothing to the console`                                 | 1     |
| M-KEY      | request construction and token handling › `%s: the token travels only as the access_token parameter, exactly once`                | 5     |
| M-SESS     | › `/suggest and /retrieve carry the SAME session_token (one billing session); geocoding and directions carry none`                 | 1     |
| M-SESS-BAD | › `refuses a malformed session token before any provider call`                                                                    | 1     |
| M-PARSE    | parsing documented shapes into port types only › `/suggest` / `/retrieve` / `%s: accuracy ⇒ confidence …` / Directions v5        | 5     |
| M-HTTP     | error mapping › `%s: HTTP %i with a documented {message} body ⇒ stable code` (400, 401, 403, 404, 429, 500, 503)                  | 35    |
| M-422      | › `HTTP 422 (documented for Geocoding v6 and Directions invalid input) ⇒ CLIENT_ERROR, not a breaker failure`                      | 1     |
| M-MALF     | › `%s: HTTP 200 with %s ⇒ MALFORMED_RESPONSE`                                                                                     | 15    |
| M-TO / M-STALL / M-ABORT / M-NET | timeouts, stalled body, cancellation, keyed-URL connect failure (Mapbox twins of G-TO, G-STALL, G-ABORT, G-NET)                                    | 20    |
| M-TTL      | › `declares TTL 0 and no cross-user sharing for every SKU; every Geocoding v6 call is temporary (permanent=false)`                 | 1     |
| M-COST     | › `declares the planning-time ESTIMATE price per SKU used by the gateway meter (session billed on /suggest, /retrieve 0)`          | 1     |
| M-NOCACHE  | › `%s: the adapter holds no cache of its own (TTL is enforced only by the gateway)`                                               | 5     |
| M-NOLOG    | › `success, HTTP error, malformed body and timeout paths write nothing to the console`                                            | 1     |

Pre-existing tests cited (unchanged): `src/google.test.ts`, `src/mapbox.test.ts`, `src/http.test.ts`,
`src/config.test.ts`, `src/licences.test.ts` (names quoted in the table). Gateway tests in `apps/api/test/` are cited
where the policy is enforced in the gateway, not in the adapter.

## 3. Coverage table

Columns: **Req** request construction · **Sess/Mask** session token / field mask · **Key** key handling (channel,
never in errors/logs) · **Parse** response parsing · **Err** error mapping · **TO** timeout/abort · **Cache** cache
policy hook · **Cost** quota/cost accounting · **Bnd** no-provider-leak boundary.

| Operation                                        | Req                                                                                                         | Sess/Mask                                                                                                    | Key                                             | Parse                                                                                       | Err                                                                                                                                                       | TO                                                                  | Cache                                                                    | Cost                                                                     | Bnd                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------- |
| Google autocomplete (Places (New))               | google.test.ts: "sends only query text, region, language, session token and the coarse bias cell"; G-KEY   | same google.test.ts test (exact mask, `sessionToken`); G-MASK; G-SESS; G-SESS-BAD                              | G-KEY; G-HTTP; G-NET; G-NOLOG; config.test.ts: "never renders its value" | G-PARSE; google.test.ts: "treats an empty response as no suggestions and rejects malformed ids" | G-HTTP; G-MALF; google.test.ts: "maps quota and auth failures" (429 RESOURCE_EXHAUSTED / 403)                                                              | G-TO; G-STALL; G-ABORT; http.test.ts: "maps an AbortSignal timeout …" | G-TTL (TTL 0, not shared); G-NOCACHE; licences.test.ts: "S1 Google: …"  | G-COST                                                                   | B1, B2, G-PARSE         |
| Google place details (Place Details (New))       | google.test.ts: "requests the Essentials field mask with the session token (no displayName)"; G-KEY        | same test; G-MASK; G-SESS; G-SESS-BAD                                                                         | G-KEY (header only; key absent from URL)        | G-PARSE; google.test.ts: "refuses unsafe ids … out-of-region to MALFORMED"                 | G-HTTP (404 ⇒ NOT_FOUND, non-breaker); G-MALF                                                                                                             | G-TO; G-STALL; G-ABORT; G-NET                                       | G-TTL (≤ 30 days, shared); G-NOCACHE                                     | G-COST                                                                   | B1, B2, G-PARSE         |
| Google geocode (Geocoding v3 forward)            | google.test.ts: "sends address, country component, region, language and key only"; G-KEY                  | N/A (no session; G-MASK asserts no field mask; G-SESS asserts no session token)                               | G-KEY (`key` param once, never in headers); G-V3 | G-PARSE; google.test.ts: "drops results outside Pakistan and maps confidence"               | google.test.ts: "maps status %s"; G-V3; G-HTTP; G-MALF                                                                                                     | G-TO; G-STALL; G-ABORT; G-NET                                       | G-TTL (≤ 30 days, shared); G-NOCACHE                                     | G-COST                                                                   | B1, B2, G-PARSE         |
| Google reverse geocode (Geocoding v3 `latlng`)   | google.test.ts: "sends the point with 5 decimals and returns the first result"; G-KEY                      | N/A (G-SESS asserts no session token)                                                                         | G-KEY; G-V3                                     | G-PARSE; G-ZERO; google.test.ts: "returns null on ZERO_RESULTS …"                          | G-V3 (new for reverse); G-HTTP; G-MALF                                                                                                                    | G-TO; G-STALL; G-ABORT; G-NET                                       | G-TTL (≤ 30 days, shared); G-NOCACHE                                     | G-COST                                                                   | B1, B2, G-PARSE         |
| Google routes (Routes computeRoutes)             | google.test.ts: "sends a traffic-unaware DRIVE request …"; "adds departureTime only for traffic-aware …"; G-KEY | same test (exact mask); G-MASK                                                                                 | G-KEY (header assertion new)                    | G-PARSE; google.test.ts: "never defaults an incomplete route"                              | G-HTTP (new: 400/401/403/404/429/500/503); G-MALF; google.test.ts: "never defaults an incomplete route" (NO_ROUTE / INCOMPLETE_ROUTE)                     | G-TO; G-STALL; G-ABORT; G-NET                                       | G-TTL (TTL 0 for Essentials AND traffic-aware Pro); G-NOCACHE            | G-COST; google.test.ts (`microUsdPerCall` 5,000 / 10,000)                | B1, B2, G-PARSE         |
| Mapbox autocomplete (Search Box `/suggest`)      | mapbox.test.ts: "sends query, session token, country, limit, language, proximity and token only"; M-KEY    | same test; M-SESS; M-SESS-BAD (N/A field mask: Mapbox has none)                                               | M-KEY (`access_token` once, never in headers/path); M-HTTP; M-NET; M-NOLOG | M-PARSE (category dropped, attribution not leaked)                                          | mapbox.test.ts: "rejects malformed payloads and maps 429/401"; M-HTTP; M-MALF                                                                             | M-TO; M-STALL; M-ABORT; M-NET                                       | M-TTL (TTL 0, not shared); M-NOCACHE; licences.test.ts: "S2 Mapbox: …"   | M-COST (session price on `/suggest`)                                     | B1, B2, M-PARSE         |
| Mapbox place details (Search Box `/retrieve`)    | mapbox.test.ts: "resolves through Search Box retrieve with the same session token"; M-KEY                  | M-SESS (same `session_token` as the preceding `/suggest`); M-SESS-BAD                                         | M-KEY                                           | M-PARSE (no accuracy ⇒ UNKNOWN)                                                             | mapbox.test.ts: "maps retrieve failures without inventing a place"; M-HTTP (404 ⇒ NOT_FOUND); M-MALF                                                     | M-TO; M-STALL; M-ABORT; M-NET                                       | M-TTL; M-NOCACHE                                                         | M-COST (0: billed in the `/suggest` session)                             | B1, B2, M-PARSE         |
| Mapbox geocode (Geocoding v6 `/forward`)         | mapbox.test.ts: "forward-geocodes as temporary (permanent=false) …"; M-KEY                                  | N/A (M-SESS asserts no `session_token`)                                                                      | M-KEY                                           | M-PARSE; mapbox.test.ts: "maps accuracy to confidence"                                      | M-HTTP; M-422; M-MALF                                                                                                                                     | M-TO; M-STALL; M-ABORT; M-NET                                       | M-TTL (TTL 0 + `permanent=false` on every call); M-NOCACHE; gateway: see C1 | M-COST                                                                   | B1, B2, M-PARSE         |
| Mapbox reverse geocode (Geocoding v6 `/reverse`) | mapbox.test.ts: "sends 5-decimal coordinates and returns null for an empty collection"; M-KEY             | N/A (M-SESS)                                                                                                 | M-KEY                                           | M-PARSE; mapbox.test.ts: "maps a feature and refuses an out-of-region answer"               | M-HTTP; M-422; M-MALF                                                                                                                                     | M-TO; M-STALL; M-ABORT; M-NET                                       | M-TTL (TTL 0 + `permanent=false`); M-NOCACHE                             | M-COST                                                                   | B1, B2, M-PARSE         |
| Mapbox directions (Directions v5)                | mapbox.test.ts: "requests mapbox/driving with a simplified GeoJSON overview"; M-KEY                        | N/A (M-SESS)                                                                                                 | M-KEY                                           | M-PARSE (legs, waypoints, uuid dropped); mapbox.test.ts: "%j ⇒ %s"                          | mapbox.test.ts: "%j ⇒ %s" (NoRoute/NoSegment/other codes), "maps 422 to CLIENT_ERROR and 5xx to SERVER_ERROR"; M-HTTP (404 ProfileNotFound ⇒ CLIENT_ERROR); M-422; M-MALF | M-TO; M-STALL; M-ABORT; M-NET                                       | M-TTL; M-NOCACHE                                                         | M-COST                                                                   | B1, B2, M-PARSE         |

Boundary references:

- **B1** — dependency-cruiser rules `no-client-to-server-workspace` (`geo-adapters` is in `SERVER_ONLY_WORKSPACE`, so
  `apps/wayvro-mobile`, `apps/web-public`, `apps/web-ops` may not import it) and `geo-adapters-composition-only`
  (only `apps/api/src/composition.ts` / `main.ts` may import it; the worker never). Run result in §5. Today no file
  under `apps/` references `@wayvro/geo-adapters` at all (grep, 2026-10-16), consistent with "no composition root
  binds an adapter before P3.7".
- **B2** — `eslint.config.mjs` `boundaries/dependencies`: `@wayvro/geo-adapters` is in `SERVER_ONLY_PACKAGES`, which
  client surfaces (`app-mobile`, rider/driver feature modules, web apps) may not import. Lint result in §5 (geo-adapters
  package only; the client apps were not linted here).
- Port-type-only outputs (no vendor DTO leak): G-PARSE / M-PARSE assert exact port-shaped objects (`PlaceCandidate`
  keys `providerPlaceId, components, kind`; `ResolvedPlace`; `RouteResult`) from fixtures that deliberately carry
  documented vendor-only fields. The package index (`src/index.ts`) exports adapter classes, options types,
  configuration loaders, errors and licence tables — no zod schema or provider DTO type.

Cache-policy notes:

- **C1 (gateway, not adapter)** — the TTL is enforced by the API gateway as `min(licence.maxCacheTtlSeconds,
  configured maximum)` (`apps/api/src/geo/gateway.ts` `cached()`; `apps/api/src/geo/routing.ts` uses 0 unless
  `cacheSharedAcrossUsers`) and `GeoCache.write` never writes when the lifetime is ≤ 0. The integration proof is
  `apps/api/test/geo.integration.test.ts` › "CS-05/CS-06: a terms TTL of 0 is never written to Valkey; a flushed cache
  only produces misses" — **NOT RUN here** (needs PostgreSQL + Valkey) and it exercises the MOCK geo doubles, not
  these adapters. The adapter-side half (declared TTLs, adapters hold no cache) is G-TTL / M-TTL / G-NOCACHE /
  M-NOCACHE.
- Mapbox `GEOCODE` TTL 0 means the gateway refuses the "type the full address" GEOCODE mode for S2
  (`GEO_GEOCODE_REF_UNSUPPORTED` in `gateway.ts`; existing ADR-006 item, unchanged).
- Quota/cost: the adapters only **declare** `microUsdPerCall` (planning-time ESTIMATES, `src/licences.ts`); the meter
  and budget guard live in the gateway (`apps/api/src/geo/provider-call.ts` `meter.costMicroUsd +=
  licence.microUsdPerCall`; `apps/api/test/geo-budget.integration.test.ts` BUD-01..04 — **NOT RUN here**, needs
  PostgreSQL + Valkey).

## 4. What the new tests prove (against synthetic shapes only)

1. **Key channel (G-KEY, M-KEY).** Places (New) and Routes send the key only in `X-Goog-Api-Key` (never in the URL or
   body); Geocoding v3 sends it only as one `key` query parameter (never in a header); Mapbox sends the token only as one
   `access_token` parameter (never in a header or the path). Every request has `Accept: application/json` and
   `redirect: 'error'`.
2. **Field masks (G-MASK).** Every Places (New) / Routes call carries a non-empty field mask with no `*` wildcard and
   no `displayName` (Pro-tier trigger); Geocoding v3 carries none.
3. **Session tokens (G-SESS, M-SESS, G-SESS-BAD, M-SESS-BAD).** An autocomplete followed by a resolve with the same
   `searchSessionId` sends the same token in both calls (Google body `sessionToken` → Place Details `sessionToken`
   query; Mapbox `/suggest` → `/retrieve` `session_token`); geocoding, reverse and routing calls carry no session token;
   malformed tokens (empty, short, spaces, over-long, path/parameter injection) are refused as `INVALID_INPUT` with zero
   provider calls.
4. **Parsing (G-PARSE, M-PARSE).** Full documented-shape payloads (with `matches`, `queryPrediction`, `viewport`,
   `plus_code`, `place_id`, `formatted_address`, `attribution`, `full_address`, `maki`, `match_code`, `bbox`,
   `routable_points`, `legs`, `waypoints`, `uuid`, …) map to exact port objects; vendor fields never appear in the
   output; missing accuracy stays `UNKNOWN`; query predictions and category suggestions are dropped.
5. **Error mapping (G-HTTP, G-V3, M-HTTP, M-422, G-MALF, M-MALF).** For all 10 operations: 400 ⇒ `CLIENT_ERROR`,
   401/403 ⇒ `AUTH`, 404 ⇒ `CLIENT_ERROR` (place resolution ⇒ `NOT_FOUND`), 429 ⇒ `QUOTA`, 500/503 ⇒ `SERVER_ERROR`,
   422 ⇒ `CLIENT_ERROR`; Geocoding v3 HTTP-200 statuses `OVER_QUERY_LIMIT`/`OVER_DAILY_LIMIT` ⇒ `QUOTA`,
   `REQUEST_DENIED` ⇒ `AUTH`, `INVALID_REQUEST` ⇒ `CLIENT_ERROR`, `UNKNOWN_ERROR` ⇒ `SERVER_ERROR` (now also for
   reverse); truncated JSON, an HTML page and schema-mismatched bodies on HTTP 200 ⇒ `MALFORMED_RESPONSE`. The
   breaker flag (`countsAsProviderFailure`) is false only for `CLIENT_ERROR`/`NOT_FOUND`/`ABORTED`.
6. **No leak in errors (all error tests).** For every failure the error's message, `String()`, stack, JSON and
   `util.inspect` contain neither the fake key/token, the query text, the provider body (which echoed key and query),
   nor the provider host for connect failures; `cause` is absent.
7. **Timeouts (G-TO, G-STALL, G-ABORT, G-NET, M-TO, M-STALL, M-ABORT, M-NET).** No response before the caller's deadline ⇒ `TIMEOUT`; headers
   received but body stalled past the deadline ⇒ `TIMEOUT` (HTTP 200 recorded); caller cancellation ⇒ `ABORTED`
   (non-breaker); a connect failure whose message embeds the keyed URL ⇒ `NETWORK` without copying it.
8. **Cache/cost hooks (G-TTL, G-COST, M-TTL, M-COST, G-NOCACHE, M-NOCACHE).** Declared TTLs match `PHASE3_ARCHITECTURE.md` §5.3
   (Google predictions and both route tiers 0; Google coordinates ≤ 30 days; Mapbox all 0, not shared, Geocoding v6
   always `permanent=false`, including the benchmark `forwardAutocomplete` variant); declared prices match the
   `MICRO_USD_PER_CALL` table per SKU (Mapbox `/retrieve` 0 because the session is billed on `/suggest`); two identical
   calls make two provider requests (no adapter-side cache).
9. **No logging (G-NOLOG, M-NOLOG).** Success, HTTP-error, malformed and timeout paths write nothing to `console.*`.

## 5. Commands run and exact outcomes

All from `C:\Dev\Wayvro` (Git Bash) on 2026-10-16. The laptop was heavily loaded by concurrent work during the run;
durations are wall-clock and not performance evidence.

| # | Command                                                                                                                                         | Outcome                                                                                                                                                                                                                                       |
| - | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `pnpm --filter @wayvro/geo-adapters test` (baseline, before changes)                                                                             | PASS — 7 files, 136/136 tests                                                                                                                                                                                                                 |
| 2 | `pnpm exec vitest run test/geo-unit.test.ts test/geo-roman-urdu.test.ts` (in `apps/api`; unit level, no infrastructure)                          | PASS — 2 files, 24/24 tests (2,436 s wall time: import-dominated under machine load)                                                                                                                                                          |
| 3 | `pnpm exec vitest run src/google.contract.test.ts` (first run)                                                                                   | FAIL — 101/102 passed; 1 failed: the first test (`Places Autocomplete (New): the key travels only …`) exceeded vitest's 5 s timeout with a 196,598 ms wall time while the machine was saturated; no assertion failed                         |
| 4 | `pnpm exec vitest run src/google.contract.test.ts` (immediate re-run, unchanged code)                                                            | PASS — 102/102 (8.87 s)                                                                                                                                                                                                                       |
| 5 | `pnpm exec vitest run src/mapbox.contract.test.ts`                                                                                               | PASS — 91/91                                                                                                                                                                                                                                  |
| 6 | `pnpm exec prettier --write` on the 5 new source/test files                                                                                      | formatted (2 test files rewritten, 3 unchanged)                                                                                                                                                                                               |
| 7 | `pnpm --filter @wayvro/geo-adapters typecheck`                                                                                                   | PASS — `tsc -p tsconfig.json --noEmit`, no diagnostics                                                                                                                                                                                       |
| 8 | `pnpm exec eslint --max-warnings=0 packages/geo-adapters`                                                                                        | PASS — exit 0, no findings                                                                                                                                                                                                                   |
| 9 | `pnpm --filter @wayvro/geo-adapters test` (after changes)                                                                                        | PASS — 9 files, 329/329 tests (136 existing + 102 + 91)                                                                                                                                                                                       |
| 10 | `pnpm --filter @wayvro/geo-adapters test:coverage`                                                                                              | PASS — 329/329; thresholds met (all files: statements 99.35 %, branches 95.64 %, functions 98.43 %, lines 99.84 %; `src/google` and `src/mapbox` 100 % statements)                                                                         |
| 11 | `pnpm exec knip --workspace packages/geo-adapters` and `… --production`                                                                         | PASS — both exit 0, no findings                                                                                                                                                                                                              |
| 12 | `pnpm exec depcruise packages/geo-adapters apps/api/src apps/worker/src apps/wayvro-mobile apps/web-public apps/web-ops --config .dependency-cruiser.cjs` | PASS — exit 0, "no dependency violations found (538 modules, 2566 dependencies cruised)" (read-only; other agents were editing `apps/wayvro-mobile` concurrently) |
| 13 | `pnpm exec prettier --check` on every touched file (including this document)                                                                    | PASS — "All matched files use Prettier code style!" (6 files) |

**NOT RUN** (with reasons):

- `apps/api` integration tests that cover the gateway side of these policies (`geo.integration.test.ts`,
  `geo-budget.integration.test.ts`, run by `vitest.integration.config.ts`): need local PostgreSQL + Valkey (`pnpm
  infra:up`); Docker resources were not started in this shared checkout. They also use the MOCK geo doubles, so they
  would not exercise these adapters even when run.
- `pnpm --filter @wayvro/geo-adapters test:live` (`scripts/live-check.mjs`): needs real FA-06 credentials; none exist.
- Full-repo `pnpm lint` / `pnpm depcruise` / root `pnpm knip` (three variants): out of scope for this bounded change;
  only the package-scoped variants above were run.

## 6. Findings (reported, not fixed)

1. **Adapter → gateway error-type bridge missing (integration gap; latent, no adapter is bound).** The adapters throw
   `GeoAdapterError` (`code`, `countsAsProviderFailure`), which does **not** extend `GeoProviderError` from
   `@wayvro/provider-interfaces`. The API gateway classifies failures only by `GeoProviderError.kind`
   (`apps/api/src/geo/provider-call.ts` `classifyFailure`). If an adapter were bound at P3.7 without a bridge, a
   `QUOTA` error would be classified `UPSTREAM` (counted against the breaker and no FG-05 quota cool-down),
   `CLIENT_ERROR`/`INVALID_INPUT` would not be `REJECTED_INPUT`, `MALFORMED_RESPONSE` would not be `MALFORMED`, a
   pre-status `NETWORK` failure would not get the single `CONNECT` retry, and `NO_ROUTE`/`NOT_FOUND` would count as
   provider failures. The gateway's own deadline abort is unaffected (`abortedByUs`). `packages/geo-adapters/README.md`
   says `countsAsProviderFailure` "tells the gateway's breaker", which is not what the gateway reads today. Not fixed
   here: `NO_ROUTE`, `NOT_FOUND`, `INCOMPLETE_ROUTE` and `AUTH` have no `GeoProviderFailure` kind, so the mapping is a
   design decision for the P3.7 binding (lead/founder), not a minimal fix.
2. **`Retry-After` is not propagated.** No adapter reads a `Retry-After` header on 429, and `GeoAdapterError` has no
   `retryAfterSeconds`; the gateway would fall back to its default 60 s cool-down. Whether Google/Mapbox send the header
   is EXTERNAL_ACCOUNT_REQUIRED.
3. **Invalid-key classification depends on the real answer.** The adapters map by HTTP status and never read the body
   (by design, T3-20/T3-21). Google's public error model describes some key problems as HTTP 400 `INVALID_ARGUMENT`
   (for example an `ErrorInfo` reason such as `API_KEY_INVALID`) rather than 401/403; such an answer would map to
   `CLIENT_ERROR` (non-breaker), not `AUTH`. Which status a real invalid, restricted or disabled key produces is
   EXTERNAL_ACCOUNT_REQUIRED.

## 7. What remains impossible without accounts or legal/commercial input

| Item                                                                                                                                    | Tag                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Real response conformance of all 10 operations against the documented schemas (field presence, types, optionality, enum values, Urdu/Roman-Urdu content) | EXTERNAL_ACCOUNT_REQUIRED |
| Real error bodies and statuses (invalid/restricted/disabled key, API not enabled, billing disabled, quota exceeded, 5xx shapes, Mapbox 401/403/429 bodies, Directions `code` values) | EXTERNAL_ACCOUNT_REQUIRED |
| Real quotas and rate limits (Google per-minute/day quotas, Mapbox 10 req/s Search Box, 1,000 req/min Geocoding, 300 req/min Directions) and `Retry-After` behaviour | EXTERNAL_ACCOUNT_REQUIRED |
| Latency, timeout adequacy (§5.4a SKU timeouts) and payload sizes from Pakistan-region traffic                                            | EXTERNAL_ACCOUNT_REQUIRED |
| Billing / SKU attribution (which console SKU each call is billed under; Essentials vs Pro for field masks and TRAFFIC_AWARE; reverse geocoding SKU naming) | EXTERNAL_ACCOUNT_REQUIRED |
| Session-token billing behaviour (Google autocomplete session closed by Place Details; Mapbox Search Box session of suggests + one retrieve, 180 s / 50-suggest expiry; abandoned-session billing) | EXTERNAL_ACCOUNT_REQUIRED |
| Key/token restriction behaviour (API restrictions, server-IP restrictions, Mapbox token scopes/URL restrictions) and the resulting error classification | EXTERNAL_ACCOUNT_REQUIRED |
| Terms-of-service caching/storage rights (Google 30-day lat/lng rule and whether cached address components are covered; Routes caching; Mapbox temporary-use and storage) | LEGAL_COMMERCIAL_REQUIRED |
| Attribution display rules and renderer coupling (Google content only on a Google map; Mapbox results only on a Mapbox map; attribution strings)            | LEGAL_COMMERCIAL_REQUIRED |
| Mapbox Commercial Application License applicability (FA-19)                                                                              | LEGAL_COMMERCIAL_REQUIRED |
| Pricing commitments (the `MICRO_USD_PER_CALL` values are planning-time ESTIMATES read 2026-10-12; no tier, discount or commitment is assumed) | LEGAL_COMMERCIAL_REQUIRED |

Nothing in this document claims real-provider verification, production readiness or an ADR-006 decision.

## 8. Fix (2026-10-17) — findings 1–3 closed in repository code (account-free evidence only)

**Trigger:** founder correction §4 (a repository-owned defect). **Branch/HEAD at run time:**
`phase-3/maps-quotes-unified-ux` @ `9647d80` (changes uncommitted; the lead commits). No provider account, key or
network call was used; no adapter is bound by any composition root (ADR-006 stays OPEN-SPIKE). Nothing below is SP-04
evidence or real-provider conformance.

### 8.1 Design: one translation boundary, inside the error type

`GeoAdapterError` now **extends** the canonical `GeoProviderError` (`@wayvro/provider-interfaces`). Its constructor
translates the detailed adapter `code` (+ HTTP status) into the canonical `kind`, once, through the total table
`toGeoProviderFailure` (`packages/geo-adapters/src/errors.ts`; a `Record` over every code, so a new adapter code without
a canonical mapping does not compile). Every adapter failure is therefore a canonical error by construction; the
gateway's `classifyFailure` (`instanceof GeoProviderError` → `kind`) needs no adapter knowledge, and `apps/api` still
does not depend on `@wayvro/geo-adapters` (dependency-cruiser `geo-adapters-composition-only` unchanged).

Why this rather than a `toGeoProviderError(e)` wrapper at each port method: a wrapper must be remembered in every method
of every adapter (10 Google/Mapbox operations, the open-stack adapters and the dev-only SP-04 harness's own Nominatim
port), and forgetting one silently reintroduces the defect; it would also discard the detailed `code`, `httpStatus` and
`countsAsProviderFailure` that the 329 existing tests and `tools/geo-bench` (SP-04 accounting, not touched here) read.
The subclass keeps that public surface unchanged (constructor signature, `code`, `httpStatus`,
`countsAsProviderFailure`, `cause` option, message text) and adds `kind` / `retryAfterSeconds`.
`countsAsProviderFailure` is now documented as SP-04 benchmark accounting only; the breaker/cool-down policy is the
gateway's, from `kind`.

**Additive taxonomy change** (`packages/provider-interfaces/src/geo-errors.ts`): `GeoProviderFailure` gains `AUTH`
(credential / project configuration refused: breaker FAILURE, never retried, no cool-down, error-level
`GEO_PROVIDER_ERROR` with `failure: AUTH`) and `NO_RESULT` (healthy "place gone / no route" answer: breaker NEUTRAL, not
retried, not counted as an error, never cached; refusal `NO_RESULT`). No kind was renamed or removed. `GeoProviderError`
gains an optional `ErrorOptions` third parameter and its `name` is typed `string` so subclasses can name themselves.
Exhaustive handling updated in `apps/api/src/geo/provider-call.ts` (`recordFailure` lists every kind, `refusalOf` is an
exhaustive switch, `ProviderRefusal` gains `NO_RESULT`, which flows into `RoutingUnavailableReason`); `gateway.ts`
treats `NO_RESULT` like `REJECTED_INPUT` (the endpoint's error — place resolution ⇒ 400 `PLACE_REF_STALE` — and never
masked by a stale entry). Routing ⇒ `RoutingUnavailableError('NO_RESULT')`; the quote service already maps every routing
refusal to its routing-unavailable answer (never an estimate). A repository search found no other exhaustive handling
of these unions.

### 8.2 Mapping table (adapter code → canonical kind → gateway policy)

| Adapter `code` (HTTP)                                           | Canonical `kind` | Breaker | Retried                         | Cool-down           | Refusal          |
| --------------------------------------------------------------- | ---------------- | ------- | ------------------------------- | ------------------- | ---------------- |
| `TIMEOUT`; `ABORTED` (caller signal; gateway abort wins anyway) | `TIMEOUT`        | TIMEOUT | no                              | no                  | `TIMEOUT`        |
| `NETWORK`, no HTTP status received                              | `CONNECT`        | FAILURE | once, if the deadline allows it | no                  | `PROVIDER_ERROR` |
| `NETWORK` after a status (body read failed)                     | `UPSTREAM`       | FAILURE | no                              | no                  | `PROVIDER_ERROR` |
| `SERVER_ERROR` (5xx), `PROVIDER_STATUS`                         | `UPSTREAM`       | FAILURE | no                              | no                  | `PROVIDER_ERROR` |
| `QUOTA` (429, v3 `OVER_*_LIMIT`, Google quota reason)           | `QUOTA`          | NEUTRAL | no                              | Retry-After or 60 s | `PROVIDER_ERROR` |
| `AUTH` (401/403, v3 `REQUEST_DENIED`, Google credential reason) | `AUTH`           | FAILURE | no                              | no                  | `PROVIDER_ERROR` |
| `CLIENT_ERROR` (other 4xx incl. 422), `INVALID_INPUT`           | `REJECTED_INPUT` | NEUTRAL | no                              | no                  | `REJECTED_INPUT` |
| `MALFORMED_RESPONSE`, `OVERSIZED_RESPONSE`, `INCOMPLETE_ROUTE`  | `MALFORMED`      | FAILURE | no                              | no                  | `PROVIDER_ERROR` |
| `NO_ROUTE`, `NOT_FOUND`                                         | `NO_RESULT`      | NEUTRAL | no                              | no                  | `NO_RESULT`      |

**Finding 3 (Google bad key as HTTP 400).** Places API (New) and Routes API 4xx bodies are classified by the documented
`google.rpc.ErrorInfo.reason` (domain `googleapis.com`, enum `google.api.ErrorReason`, read 2026-10-17 from googleapis
`google/api/error_reason.proto`, which gives no HTTP status per reason): credential/configuration reasons
(`API_KEY_INVALID`, `API_KEY_*_BLOCKED`, `SERVICE_DISABLED`, `BILLING_DISABLED`, `CONSUMER_INVALID`,
`CONSUMER_SUSPENDED`, `CREDENTIALS_MISSING`, `ACCOUNT_STATE_INVALID`, `GCP_SUSPENDED`) ⇒ `AUTH`; `RATE_LIMIT_EXCEEDED`
/ `RESOURCE_QUOTA_EXCEEDED` ⇒ `QUOTA`; any other reason, another domain or `@type`, a body without details or a non-JSON
body ⇒ the HTTP status decides. Only `@type`, `domain` and `reason` are read and the reason is only looked up in fixed
sets, never stored; `message` is never read. A Place Details 404 carrying a credential reason stays `AUTH` (not a
vanished place). Geocoding v3 keeps its documented HTTP-200 `status` mapping; Mapbox documents no reason enum ⇒ status
only. Which status/reason a real invalid, restricted or disabled key produces remains EXTERNAL_ACCOUNT_REQUIRED.

### 8.3 Retry-After rules (finding 2)

`packages/geo-adapters/src/retry-after.ts`, applied in `callJson` only when the final code is `QUOTA`:

- delta-seconds (`1*DIGIT`, clock-independent) ⇒ rounded up and clamped to **1–3600 s** (`0` ⇒ 1; huge ⇒ 3600);
- HTTP-date in all three RFC 9110 §5.6.7 forms (IMF-fixdate, RFC 850 with the 50-year rule, asctime),
  calendar-validated and converted against the **injected server clock** (`now` option on every adapter and bundle
  factory; default the process clock — adapters are server-only, never a device clock) ⇒ the difference rounded up and
  clamped to 1–3600 s; a date that is not in the future ⇒ unusable (clock skew or a stale cache ⇒ conservative
  default);
- malformed values (sign, fraction, exponent, unit, junk, lower-case or non-GMT zone, ISO 8601, impossible date/time,
  more than 64 characters), negative or non-finite ⇒ `undefined` ⇒ the gateway default;
- a `Retry-After` on a non-QUOTA answer (e.g. 503) is ignored; the header value never enters an error or a log;
- `GeoAdapterError` re-bounds any supplied value and keeps it only on `QUOTA`; the gateway cool-down
  (`quotaCooldownSeconds`, `apps/api/src/geo/provider-call.ts`) uses it when finite and non-negative, else its 60 s
  default, clamped to 1–3600 s again. (Before: `Math.round(x ?? 60)` — a NaN produced an invalid `EX`, i.e. silently no
  cool-down, and a negative value became 1 s.)

### 8.4 Tests added (synthetic fixtures only)

| File                                                        | Added | What they prove                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/geo-adapters/src/errors.test.ts` (new)            | 22    | the full code → kind table (written independently of the implementation), `instanceof GeoProviderError`, message/stack, bounded Retry-After only on QUOTA, `cause` passthrough; S1/S2 bundle factories pass the injected clock                                       |
| `packages/geo-adapters/src/retry-after.test.ts` (new)       | 36    | delta-seconds, the three HTTP-date forms, server-clock relativity, past dates, malformed/negative/non-finite/oversized values, bounds                                                                                                                                 |
| `packages/geo-adapters/src/http.test.ts`                    | 12    | Retry-After through `callJson` with an injected clock, ignored on 503; `errorReason` only for 4xx, null fallback, non-JSON body, undrainable body; CONNECT vs UPSTREAM                                                                                               |
| `packages/geo-adapters/src/google.contract.test.ts`         | 174   | all 5 S1 operations: HTTP 400/401/403/404/429/500/503 ⇒ canonical kind; 429 × 12 Retry-After cases; 503 + Retry-After; 8 ErrorInfo-reason cases (400 `API_KEY_INVALID` ⇒ AUTH on Places (New)/Routes); ignored reasons; v3 statuses; NO_RESULT/MALFORMED; timeout, cancellation, stalled body, CONNECT; no leak |
| `packages/geo-adapters/src/mapbox.contract.test.ts`         | 111   | all 5 S2 operations: the same status, Retry-After and 503 cases; 422; no vendor reason read; NoRoute/NoSegment/empty routes and a vanished place ⇒ NO_RESULT; incomplete route ⇒ MALFORMED; transport kinds                                                         |
| `packages/provider-interfaces/src/geo-binding.test.ts`      | 1     | additive kinds, optional cause, subclass naming                                                                                                                                                                                                                       |
| `apps/api/test/geo-provider-call.test.ts` (new, unit)       | 27    | candidate-adapter doubles (`geo-candidate-doubles.ts`, a GeoProviderError subclass shaped like GeoAdapterError) through the real `GeoProviderCaller` and real `CircuitBreaker`: classification by kind only; cool-down = Retry-After 7 / default 60 / clamp 3600 / floor 1; quota never opens the breaker; AUTH opens it without retry; NO_RESULT neutral and uncounted; only CONNECT retried; adapter message never logged |
| `apps/api/test/geo-candidate.integration.test.ts` (new)     | 3     | real PostgreSQL + Valkey and the real gateway: Valkey cool-down TTL ≤ 7 s after Retry-After 7 and no second provider call; resolve NO_RESULT ⇒ 400 `PLACE_REF_STALE`; routing NO_RESULT ⇒ `RoutingUnavailableError('NO_RESULT')`, AUTH ⇒ `PROVIDER_ERROR`; candidate message never logged |

No existing test was weakened or deleted; the contract harness gained an optional injected clock and canonical helpers.
The MOCK geo doubles (`packages/provider-test-doubles`, outside this change) still report a vanished place as
`REJECTED_INPUT`; the gateway answers both that and `NO_RESULT` with `PLACE_REF_STALE`.

### 8.5 Commands and exact outcomes (2026-10-17, Git Bash, `C:\Dev\Wayvro`; logs under `evidence-local/fix/logs/`, not committed)

| #   | Command                                                                                                                                                                         | Outcome                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm --filter @wayvro/geo-adapters test` after the source change, before the new tests                                                                                         | PASS — 9 files, 329/329 (existing behaviour unchanged)                                                                              |
| 2   | `pnpm --filter @wayvro/provider-interfaces build` (its dist feeds the dependants' typecheck) and `typecheck`                                                                    | PASS                                                                                                                                |
| 3   | `pnpm --filter @wayvro/geo-adapters typecheck`; `pnpm --filter @wayvro/api typecheck`                                                                                           | PASS (final runs)                                                                                                                   |
| 4   | `pnpm --filter @wayvro/geo-adapters test:coverage`                                                                                                                               | PASS — 11 files, 684/684; all files statements 99.42 %, branches 93.76 %, functions 98.52 %, lines 99.72 % (thresholds 90/85/90/90) |
| 5   | `pnpm --filter @wayvro/provider-interfaces test` and `test:coverage`; `pnpm --filter @wayvro/provider-test-doubles test`                                                        | PASS — 14/14; 14/14; 13/13                                                                                                          |
| 6   | apps/api `vitest run test/geo-provider-call.test.ts test/geo-unit.test.ts test/geo-roman-urdu.test.ts` (unit config)                                                            | PASS — 3 files, 51/51                                                                                                               |
| 7   | apps/api `vitest run --config vitest.integration.config.ts` on the `geo-candidate`, `geo`, `geo-budget` integration files + the 3 geo unit files (local PostgreSQL/Valkey; throwaway DB per suite) | PASS — 6 files, 99/99                                                                                              |
| 8   | apps/api `vitest run --config vitest.integration.config.ts test/quotes.integration.test.ts` (routing consumer regression)                                                       | PASS — 1 file, 30/30                                                                                                                |
| 9   | `eslint --max-warnings=0 packages/geo-adapters packages/provider-interfaces`; `eslint --max-warnings=0 apps/api/src/geo` + the touched/new `apps/api/test/geo*` files           | PASS — exit 0, no findings (both)                                                                                                   |
| 10  | `knip --workspace` `packages/geo-adapters`, `packages/provider-interfaces`, `apps/api`, each normal and `--production`                                                           | PASS — all 6 exit 0; one tag hint (`parseRetryAfter` `@internal` unused) fixed by removing the tag                                  |
| 11  | `depcruise packages/geo-adapters packages/provider-interfaces apps/api/src apps/api/test --config .dependency-cruiser.cjs`                                                     | PASS — "no dependency violations found (219 modules, 1259 dependencies cruised)"                                                    |
| 12  | `prettier --check` on every touched file including this document                                                                                                                | PASS (final run)                                                                                                                    |

**NOT RUN:** `pnpm --filter @wayvro/geo-adapters test:live` (no FA-06 credentials); `tools/geo-bench` typecheck/tests
(concurrent work owns that workspace and it reads the built `@wayvro/geo-adapters` dist, which was deliberately not
rebuilt while a benchmark may be running; the surface it uses — constructor, `code`, `countsAsProviderFailure`,
`cause` — is unchanged); full-repo `pnpm lint` / `knip` / `depcruise` (outside this bounded change); real-provider
behaviour (statuses, reasons and `Retry-After` presence stay EXTERNAL_ACCOUNT_REQUIRED, §7).

**Follow-ups for the lead:** add `AUTH` / `NO_RESULT` to the failure-policy rows of `docs/phase3/PHASE3_ARCHITECTURE.md`
§5.4 (no new log signal was introduced: AUTH uses `GEO_PROVIDER_ERROR` at error level; NO_RESULT is recorded only as the
span outcome); rebuild the `@wayvro/geo-adapters` dist before the next geo-bench run.
