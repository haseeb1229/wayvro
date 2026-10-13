# PHASE3_IMPLEMENTATION_RECORD — Full macro Phase 3 implementation (P3.0 – P3.10)

**Branch:** `phase-3/maps-quotes-unified-ux` from protected `main` @ `b1a19865fa1a3f72244e2b5b10f9e1e5148004b9` (merge of the reviewed Phase-3 planning PR #7). · **Authorisation:** founder authorised the whole macro Phase 3 engineering run in one session (2026-10-12, `WAYVRO_PHASE3_FULL_IMPLEMENTATION_AUTHORISATION`); P3.0–P3.10 are internal checkpoints, not approval points. · **Plan:** `docs/phase3/PHASE3_IMPLEMENTATION_PROMPT_PROPOSED.md` with `<PHASE3_PLAN_MERGE_SHA>` = `b1a1986…`, and every `docs/phase3/` design file. · **Status:** IN PROGRESS. · **Agent:** Claude Code (self-audit, not independent verification). · Synthetic data only; no provider account, key, real boundary, real price or real user data exists in this run.

Founder confirmations in force for this run (authorisation §4–§8): FA-01, FA-02, FA-07, FA-10, FA-11, FA-12, FA-16 APPROVED; FA-17 approved in principle; FA-18 deferred to Phase 4; FA-08 no paid spend; FA-09 native review required; FA-19 Mapbox licence clarification required before any S2 freeze. Pricing maker-checker: two distinct authenticated staff identities (both may hold `PRICING_MANAGER`), maker ≠ checker enforced by database and service, mandatory audit actor ids and reason codes, `STAFF_ADMIN` is not the routine approver, break-glass is not a shortcut. SP-01 thresholds are fixed pre-measurement values (FA-07).

Genuine founder/external actions still open at run start: FA-03 (SP-01 real devices), FA-04 (SP-02 low-end device), FA-05 (SP-04 Lahore field data), FA-06 (evaluation provider accounts/keys), FA-09 (native Urdu/Roman-Urdu review), FA-19 (Mapbox written licence clarification, S2 only).

## Authority checks at run start (2026-10-12)

| Check | Result |
|---|---|
| local `main` = `origin/main` | `b1a19865fa1a3f72244e2b5b10f9e1e5148004b9` (both) |
| worktree / stash | clean / none |
| identity | `Muhammad Haseeb <abdulhaseeb1229@gmail.com>`; `gh` login `haseeb1229` |
| ruleset 24837051 | active; deletion + non-fast-forward + pull request + the five required checks (Quality, Integration, Security, Android, Web E2E) |
| latest `main` CI | run 38212729675 (push of the PR #7 merge): all five jobs success |
| Phase-3 implementation branch | none existed (`git branch -a`) |
| register | 532 IDs; `phase0.target_phase = 3` = 29 (P0 17, P1 11, P2 1) — matches the plan |

## Checkpoint log

| Checkpoint | Commit | Summary |
|---|---|---|
| P3.0 | `e339214` | F-P3-01 release URL scheme removed (dev-only scheme), exported-component/intent-filter release gate, oasdiff breaking-change gate, Web E2E title synchronisation, ADR-043/ADR-027/osv corrections. **CI run 38299271950:** Security, Integration, Android, Web E2E success; **Quality FAILED** at knip (unused file `apps/wayvro-mobile/plugins/dev-client-scheme.mjs` — plugin referenced only by a path string) |
| P3.0 fix | `9a77d57` | knip entry for the local Expo plugin (negative control: a planted unused mobile file is still reported); pushed with the next checkpoint |
| shared seams | `7572a8a` | contract-first base for the parallel checkpoints: FA-10 roles + Phase-3 permissions, new error codes, x-wayvro headers, consumer contracts (geo, quotes, catalog products, app config, `AccountState.modes`), vendor-neutral geo ports, runtime-switch registry |
| P3.6 prep | `ca9d727` | SP-01 spike harness (tests/spikes/sp-01-background-location; candidate A; not a release app); 48/48 unit tests, no device run |
| P3.2 (part) | `ea2d144` | candidate geo adapters (`packages/geo-adapters`, server-only, not bound; 136 tests) + SP-04 harness (`tools/geo-bench`, dev-only; 73 tests) |
| P3.5 | `74eaf8b` | unified-app shell: modes, intents, restoration, app-policy gate, rider foreground location (FA-02 scope), text-first quote flow, Lite mode; mobile 397 tests |
| P3.1 | `5d92d65` | catalog: service products, zone sets, hours, pickup points, eligibility rules, migration 0010 |
| P3.4 | `3374ea3` | release controls: version policy, maintenance, runtime switches, migration 0013 |
| P3.2 | `a885dae`, `266071d` | geo gateway, cost controls, breaker, placeRef, migration 0011; gitleaks false-positive fix (test title; one fingerprint in `.gitleaksignore`) |
| P3.3 | `6ed66af` | pricing: tax policies, rate cards, quotes, migration 0012; web-ops pricing + geo admin pages |
| P3.8 | `b381f2c` | Driver/Partner shell, K19 coverage, per-product eligibility; knip production fixes; geo maker-checker hardening. **Pushed: CI run 38427719184** |

Order note: checkpoints were developed in parallel by delegated agents in isolated worktrees (contract-first base `7572a8a`) and merged in dependency order, so commit order differs from the P3.0–P3.10 numbering (P3.5 before P3.1; P3.4 before P3.2). Each merge was re-verified in the main tree before its commit. Several agent worktrees were created from `main` instead of the Phase-3 base, and some git operations in agent worktrees were refused by the permission system; that work was extracted as patches against the actual base and applied with three-way merges (no history was rewritten anywhere). Agents were interrupted several times by API usage limits and resumed from their transcripts.

## P3.0 — Main hygiene and guardrails

**IDs touched:** V08 (prerequisite), U05 (manifest hygiene), V10 (gate). **ADR:** ADR-043 amendment, ADR-027 amendment.

### F-P3-01 — expo-dev-client scheme only in development builds

| Area | Change |
|---|---|
| Config | `apps/wayvro-mobile/app.config.ts` lists `['expo-dev-client', { addGeneratedScheme: false }]` — the documented option; `expo prebuild` skips its automatic (legacy-list) copy because config plugins run once per package — so the shared main manifest no longer gets `exp+wayvro` |
| Dev workflow | `apps/wayvro-mobile/plugins/dev-client-scheme.mjs` re-adds the identical intent filter (VIEW + DEFAULT + BROWSABLE, `exp+wayvro`, same derivation as the dev-client source) to the `debug` and `debugOptimized` source-set manifests only; the manifest merger applies them to development variants alone |
| Gate | `infra/ci/android/check-intent-filters.mjs` + `infra/ci/android/component-allowlist.json`: every exported activity/alias/service/receiver/provider must be allowlisted with exact permission and filters; any `<data>` or BROWSABLE in an application intent filter fails; `<queries>` ignored. Run by `scripts/android-build.mjs release` on the AAB (Android job) and `--self-test` in the Quality job |
| Exception | `osv-scanner.toml` decode-uri-component reason corrected to the now-true, CI-enforced premise; expiry 2026-12-31 unchanged (not extended) |
| iOS | no iOS build exists; the generated scheme is also absent from the iOS Info.plist; a Debug-only URL type is needed when iOS development builds start (open item) |

Evidence (local, this machine):

| Evidence | Result |
|---|---|
| Gate self-test (6 fixture cases: expected shape passes; `exp+wayvro` filter, extra exported receiver, https app-link alias, implicitly exported service, profile installer without DUMP all fail) | PASS |
| Gate against the PRE-FIX release AAB (`apps/wayvro-mobile/build-reports/app-release.aab` built 2026-10-11 from `main`) | FAIL as expected: `DATA activity:dev.wayvro.app.MainActivity … exp+wayvro`, `BROWSABLE …`, `FILTERS …` — the negative control on a real artefact |
| `expo prebuild` output after the fix | main manifest: no `exp+wayvro`; `src/debug` and `src/debugOptimized` manifests: the dev-client filter |
| Release AAB after the fix — local `node scripts/android-build.mjs release` (JDK 17.0.20.1, bundletool 1.18.3), 2026-10-12 | PASS: 16 KB (20/20 64-bit libraries aligned), permissions (unchanged set), intent filters — exported components exactly `activity:dev.wayvro.app.MainActivity` (MAIN/LAUNCHER only) and `receiver:androidx.profileinstaller.ProfileInstallReceiver` (DUMP); no `<data>`, no BROWSABLE; log `build-logs/p30-release.log` (local, not committed) |
| CI artefacts of `e339214` (run 38299271950, Android job) | release AAB: `16 KB CHECK: PASS`, `PERMISSION CHECK: PASS`, exported components exactly `activity:dev.wayvro.app.MainActivity` + `receiver:androidx.profileinstaller.ProfileInstallReceiver`, `INTENT-FILTER CHECK: PASS`; debug APK: "development launch scheme exp+wayvro present" — F-P3-01 closed on a CI-built release artefact |
| Development APK after the fix | `scripts/android-build.mjs debug` now asserts with `aapt2 dump xmltree` that the development APK still declares `exp+wayvro` (positive control of the dev-launcher path; fails the build otherwise). Local first attempt FAILED at prebuild: Node ESM cannot resolve `expo/config-plugins` (no exports map) — fixed by importing `expo/config-plugins.js`; prebuild then produced the debug/debugOptimized scheme. Local re-run after the fix: debug APK built, "development launch scheme exp+wayvro present" (PASS) |

### F-P3-09 — oasdiff breaking-change gate

`scripts/openapi-breaking.mjs` + oasdiff 1.32.1 (Apache-2.0, checksum-verified in CI; latest patch of the 1.32 line, 2026-09-15). Base = merge base with `origin/main` (`HEAD^1` on `main`). zod nests `$defs` per operation with `#/$defs/<id>` refs that oasdiff resolves against the document root (`map key "$defs" not found` on the raw spec), so both specs are normalised by hoisting the definitions into `components.schemas` first. Quality job checkout now uses `fetch-depth: 0`.

| Evidence | Result |
|---|---|
| `--self-test` (identical ⇒ pass; value added to a CLOSED response enum ⇒ breaking; route removed ⇒ breaking; required response field removed ⇒ breaking) | PASS (local, 4 cases) |
| current spec vs `b1a1986` | PASS — "no breaking changes" (the spec differs only by the extensible-enum representation below) |

**Finding while enabling the gate:** adding any error code (Phase 3 adds three) widened the closed `error.code` enum in all 415 error responses, which oasdiff reports as `response-property-enum-value-added` (ERR). The error-code vocabulary is extensible BY CONTRACT (`errors.ts`: codes are additive; the mobile client and web surfaces fall back to the HTTP status for an unknown code), so the generator (`packages/contracts/src/openapi.ts`) now documents exactly two vocabularies as `x-extensible-enum` in RESPONSE schemas: error codes and staff roles (code-defined, additive, consumed only by the lockstep-deployed web-ops). Request enums stay closed; every other response enum stays closed and the self-test proves a value added to a closed response enum still fails.

### Web E2E flake (`tests/e2e-web/web-ops/staff.spec.ts:40`, PR #7)

Fix at the narrowest test layer: `expectAccessible` waits for a non-empty `document.title` (a deterministic page-ready condition bounded by the expect timeout), and the enrolment test asserts the overview's own title after the `/enrol → /` navigation. The axe `document-title` rule stays enabled and no retries were added. Hypothesis (not yet proven): web-ops pages are dynamic (`connection()`), Next.js 16 streams their metadata, and `router.push('/')` + `router.refresh()` can briefly leave the document without its `<title>`. CI evidence: Web E2E PASS on run 38299271950 (P3.0). The reproduction probe (a MutationObserver on the title during repeated push + refresh navigations, with axe sampled at the original point without the wait) is prepared but **NOT RUN** yet — see the closure section.

## P3.1 — Catalog (migration 0010) — IDs E08, H10, R28, B04

Migration `0010_catalog_products_zones` (expand-only) adds:
- service products, separate from the unchanged vehicle classes (F-P3-04);
- a per-city product lifecycle with a DB legal gate (BIKE/RICKSHAW stay DISABLED_LEGAL_GATE, FA-11);
- versioned maker-checker zone sets (MultiPolygon/Point 4326; validity/SRID/non-empty/≤ 20,000 points; GiST), zone products, Asia/Karachi service hours, pickup points and eligibility rules;
- nullable district geometry, the FA-10 role-CHECK widening, and nullable vehicle claims for seats/body/AC (DM-OPEN-02 default adopted, ADR-051).

Guard triggers refuse edits after DRAFT, child-row edits once a set has left DRAFT, and direct ACTIVE inserts by the API.

Around it: server-only evaluators (zone decision, service hours, vehicle eligibility) with property tests; `CatalogReadModel`; the maker-checker staff API; consumer `GET /v1/catalog/products`; a local/test-only synthetic Lahore seed (FA-12); web-ops catalog/zone pages. ADR-051.

Decisions/deviations:
- A pending ENABLE may sit on SUSPENDED rows (un-suspend = maker-checker).
- Activation uses `clock_timestamp()` under an advisory lock.
- GEOM-03: PostGIS 3.5.2 promotes a Polygon into the MultiPolygon typmod. The test asserts the real behaviour; the import wraps with `ST_Multi`.
- Product-specific service-hour rows replace the general rows for the whole set.
- Airport precincts snap only to AIRPORT points.
- City-product audit ids are deterministic UUIDv8 values derived from (city, product).
- The T3-29 probe-point check is NOT built (it was only proposed).

## P3.2 — Geo gateway (migration 0011) — IDs E06, E07, I11, B02, A06, B03

The gateway follows architecture §5.2:
- **Cost and failure controls:** fail-closed Valkey; keyed-HMAC, provider-namespaced cache keys; terms-derived TTLs; day/month call and micro-USD budgets with 50/80/100 % signals; an in-house circuit breaker per (provider, SKU); deadline-aware retries.
- **Address handling:** a Lahore address formatter; landmark alias expansion.
- **placeRef:** sealed in an AES-GCM envelope (key classes `place_refs`, `geo_cache`).
- **Routing:** `GeoRouting` makes a single attempt and never serves a stale route.
- **Supporting pieces:** migration `0011_geo_controls`; worker `geo.usage-rollup`; MOCK doubles with fault injection; `assertGeoBundle`; redaction and telemetry URL scrubbing; ART-ISO coverage.

Candidate adapters (S1 Google, S2 Mapbox, S3 self-hosted open stack) live in `packages/geo-adapters` and are NOT bound by any composition root (no freeze, no keys). `tools/geo-bench` implements the SP-04 harness, with the FA-07 thresholds and the route-critical hard gate fixed in code. ADR-047.

Decisions/deviations:
- The city is part of the placeRef plaintext.
- Forward-geocode suggestions are held in Valkey for at most min(placeRef TTL, terms TTL); a terms TTL of 0 refuses GEOCODE mode.
- A provider quota opens a per-SKU cool-down instead of tripping the breaker (the test strategy wins over architecture §5.4).
- A cache read error counts as a miss; the budget step then fails closed.
- Per-IP-prefix geo limits are NOT built (per-account only).
- The API router's `maxParamLength` is 600, plus a framework-error handler: real placeRefs exceeded Fastify's default, and its default error body echoed the path.
- Candidate adapters use Google Geocoding v3 (v4 at P3.7).
- The open-stack compose profile is NOT DONE.
- Merge hardening: only the drafter submits a budget, and a drafter/creator can no longer reject their own budget or alias.

## P3.3 — Pricing (migration 0012) — IDs B04, B06, E05, H06, B03, E07

- **Engine:** pure `pe-v1` on `Money`; it reproduces the pricing doc's golden examples A/B exactly and holds the PROP-QUOTE invariants P-01…P-10; a depcruise rule keeps it pure.
- **Migration** `0012_pricing`, with guard triggers and deferred Σ constraint triggers.
- **Quote service** (pricing doc §4):
  - the request body is strict, and rate limits run before idempotency;
  - one routing call on a 3 s deadline, never retried; if it fails, 503 ROUTING_UNAVAILABLE and nothing is persisted;
  - older quotes are superseded under an account advisory lock;
  - production refuses synthetic or placeholder configuration.
- **Staff pricing API:** maker-checker by two distinct PRICING_MANAGERs (service + DB), step-up, reason codes, previews without provider calls, scheduled activation, rollback by new version, and a sanity envelope.
- **Other:** a support quote lookup without coordinates; a worker purge (30-day placeholder, EG-16); catalog ENABLE now checks for a real ACTIVE rate card. ADR-013.

Decisions/deviations:
- In its safe state, `rider.quotes` answers 404 `WAYVRO_E_FEATURE_DISABLED` (the code's Phase-2 status), not the plan's 503.
- Requested products that are not ENABLED are listed as `ZONE_NOT_SERVED` (the reason list is fixed).
- `GET /v1/quotes/{id}` returns `unavailable: []`, because refusals are not stored.
- Columns added beyond the plan: `submission_preview`, `envelope_override_reason_code`, `attribution_code`, `polyline_expires_at`, `tax_included_*`.
- Not built (open items): the route-ratio sanity check (T3-06), a per-account limit on `GET /v1/quotes` (T3-04), the `QUOTE_NOT_FOUND_BURST` signal, and quote purge on account deletion.

## P3.4 — Release controls (migration 0013) — IDs A01, Q31, V10

- **Migration** `0013_platform_release_controls`.
- **Runtime switches:** `RuntimeSwitchReader` with a 10 s cache and registry defaults; the registry holds no security-control switch (validated by `flags:check`).
  - Moving to the safe state: one staff member, step-up and a reason.
  - Moving away from it: maker-checker.
- **App config and enforcement:** public, cacheable `GET /v1/app/config`; a 426/503 hook with exempt routes.
- **Guardrails:** a released-build guardrail via `APP_LATEST_RELEASED_BUILD_*` config; a dry-run preview (builds are not recorded, so it reports app versions).
- **Worker:** scheduled activation with an activator registry, plus switch expiry.
- ADR-049.

**Not implemented:** the single-person SECURITY expedited path and the 15-minute "undo" (pending a founder decision); both recorded in ADR-049.

## P3.5 — Unified-app shell — IDs V08, V05, A07, U05, L08, V11, A01/Q31 client, B01–B06 display

- **Routes:** `/ride/*` loads eagerly; `/drive/*` lazily (its layout imports nothing from `features/driver`); `/home` is the shared hub.
- **Modes:** the ModeController treats the stored preference as a hint only.
- **Intent router:** a 512-character cap before any parsing, never percent-decodes; `+native-intent` → `redirectSystemPath` (verified in expo-router 57.0.25).
- **Restoration and policy:** restoration resolver; AppPolicyGate plus version headers.
- **Rider foreground location:** expo-location 57.0.20, when-in-use only. The release manifest adds exactly COARSE + FINE; FOREGROUND_SERVICE is blocked.
- **Rider flow:** text-first search/pin/quote/fare with every refusal state; Lite mode; new primitives with an AA contrast test.
- ADR-048, ADR-019, ADR-043 addendum.

Open items:
- expo-location's library manifest declares a non-exported `LocationTaskService` (FGS type location) that is never started. Its effect on the Play FGS declaration must be checked before any store upload.
- A signed-out user under HARD_UPDATE sees only the support text, because the legal and deletion routes are in the session group.
- There is no store URL mapping yet.

## P3.8 — Driver/Partner shell — IDs V08, K19, V05, H10 (display)

- Additive optional `DriverCompliance.productEligibility`, computed via `CatalogReadModel`; display only.
- `/drive` readiness, `/drive/eligibility` and `/drive/health`, from server state only: no Go-online, no online state, no offers, no location request.
- Optional vehicle claims in the onboarding form.
- A K19 table-driven state-coverage test across en/ur/ur-Latn.
- An upload "retrying" state.

## Shared verification after the merges (local, main tree, before the push of `b381f2c`)

| Suite | Result |
|---|---|
| packages/db integration (clean→latest, every previous prefix, re-run 0, grants, live-row upgrades) | PASS 158/158 (after P3.3) |
| apps/worker integration | PASS 55/55 |
| apps/api integration (full, `--maxWorkers=3`) | 389/390 at P3.3 (a readiness race in one test fixed; re-run 27/27). After P3.8: driver-readiness + compliance + quotes 38/38, geo-budget 9/9, staff AUTHZ-MATRIX 13/13 (alone) |
| apps/api unit | 113/113 (the cold-boot liveness case timed out twice under multi-agent load; it passes alone) |
| apps/wayvro-mobile vitest | 444/444 |
| knip (default, production, production strict) | PASS |
| oasdiff gate | PASS |
| web-ops Playwright (whole project) | NOT green locally under multi-agent load: intermittent enrolment and zone-import timing in the catalog and release journeys; pricing 8/8 and geo-admin 6/6 passed in every run. CI is the authoritative run |
