# PHASE3_IMPLEMENTATION_RECORD — Full macro Phase 3 implementation (P3.0 – P3.10)

**Branch:** `phase-3/maps-quotes-unified-ux` from protected `main` @ `b1a19865fa1a3f72244e2b5b10f9e1e5148004b9` (merge of the reviewed Phase-3 planning PR #7). · **Authorisation:** founder authorised the whole macro Phase 3 engineering run in one session (2026-10-12, `WAYVRO_PHASE3_FULL_IMPLEMENTATION_AUTHORISATION`); P3.0–P3.10 are internal checkpoints, not approval points. · **Plan:** `docs/phase3/PHASE3_IMPLEMENTATION_PROMPT_PROPOSED.md` with `<PHASE3_PLAN_MERGE_SHA>` = `b1a1986…`, and every `docs/phase3/` design file. · **Status:** ENGINEERING RUN AT CLOSURE — PR opened for review, **not merged**; Phase 3 is **not complete** (real-world evidence SP-01/SP-02/SP-04 and the FA-09 native review are missing; 14 IDs BLOCKED on Maestro evidence — see the closure section). · **Agent:** Claude Code (self-audit, not independent verification). · Synthetic data only; no provider account, key, real boundary, real price or real user data exists in this run.

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
| P3.8 | `b381f2c` | Driver/Partner shell, K19 coverage, per-product eligibility; knip production fixes; geo maker-checker hardening. **CI run 38427719184:** Security, Android, Web E2E success; **Quality FAILED** (mobile architecture test timeout; contracts coverage); **Integration FAILED** (PROP-QUOTE P-06 counterexample) |
| CI fix | `08b8b15` | mobile architecture guards read each file once (same assertions); record P3.1–P3.8; founder evidence pack |
| CI fix | `4547cef` | P-06: MINIMUM_ADJUSTMENT taxable only together with BASE/DISTANCE/TIME (contract refine + 0012 CHECK + engine refusal + regression test); contracts request-rule tests; property timeouts scale with run count. **CI run 38434456189:** Security, Integration, Android, Web E2E success; **Quality FAILED** (worker unit coverage) |
| SP-08 | `af5bfd4` | mobile E2E tooling + release gates (ADR-052) merged; HARD_UPDATE escape-route, status-bar inset and E2E pricing-seed fixes; worker coverage scope (DB-backed modules measured by the integration run) |
| P3.9 | `4347289` | localisation, Roman-Urdu aliases, accessibility audits, native-review export/import. **CI run 38439820550:** Security, Integration, Android (all release gates incl. size/purity/SDK-INV/bundle-secrets), Web E2E success; **Quality FAILED** (ART-ISO-08: the route probe lacked the P3.1/P3.4 dependencies — masked earlier because Quality had already failed at an earlier step); **Mobile E2E FAILED** (informational; 3 PASS / 3 FAIL / 8 BLOCKED, see closure) |
| P3.10 | `4faf5a9` | ART-ISO-08 probe fix; driver-home flow selectors after P3.8; ADR-050; final U04 inventory; requirement reconciliation; status docs. **CI:** push run 38446105899 Quality, Integration, Security, Web E2E success; PR run 38446160279 **Integration FAILED** (CONC-PRICING 500, below) |
| P3.10 fix | `1895813` | activation timestamps use `clock_timestamp()` under the activation locks; deterministic regression test. CI: see the PR |

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

Fix at the narrowest test layer: `expectAccessible` waits for a non-empty `document.title` (a deterministic page-ready condition bounded by the expect timeout), and the enrolment test asserts the overview's own title after the `/enrol → /` navigation. The axe `document-title` rule stays enabled and no retries were added. Hypothesis: web-ops pages are dynamic (`connection()`), Next.js 16 streams their metadata, and `router.push('/')` + `router.refresh()` can briefly leave the document without its `<title>`. CI evidence: Web E2E PASS on run 38299271950 (P3.0). **Probe run (2026-10-13, local, production builds, not committed):** a MutationObserver on the document during 1 enrolment + 25 sign-out/sign-in navigations (`router.push('/')` + `router.refresh()`). In **26 of 26** navigations the document on `/` briefly had **no `<title>` element** (1–14 ms, median 5 ms) before the streamed metadata inserted "Wayvro Operations". At the original check point (overview banner visible), all 26 samples had the title and axe reported 0 `document-title` violations — so the flake needs axe to land inside that few-millisecond window, which matches its rarity. This supports the hypothesis; it does not reproduce the CI failure itself. The title wait closes exactly that window.

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

## P3.9 — Localisation, Roman-Urdu search, accessibility — IDs P18, A06, K19, U05, L08

- **Bidi and interpolation:** one shared `interpolate()`. In Urdu every inserted value is direction-isolated; in other locales only values containing Urdu/Arabic letters are. Place rows take their direction from their own text.
- **Review discipline (FA-09):** `Screen` always renders the "translation pending native-speaker review" note (the full-screen camera view adds it itself). The review ledger `REVIEW_LEDGER` is empty, so nothing is REVIEWED.
- **Native-review export/import:** `pnpm --filter @wayvro/wayvro-mobile i18n:export` / `i18n:import-review` (`apps/wayvro-mobile/scripts/i18n/README.md`). The export is deterministic: 931 strings (app 469, driver 462); ur and ur-Latn are 931 PENDING_NATIVE_REVIEW each. Flags: SAFETY 261, LEGAL 154, PRICE 81, PERMISSION 56. 4 PKR format decisions are pending. The import never writes the ledger: it produces a git-ignored intake file for a developer to apply.
- **Roman-Urdu / Urdu search (A06):** 39 synthetic landmark aliases (ur-Latn 20, en 11, ur 8) covering all 14 gazetteer places, seeded as PROPOSED only (`seedSyntheticLandmarkAliases`; activation needs two distinct staff). Normaliser tests prove each alias is stored in canonical form and finds its place.
- **Accessibility (U05/L08):** static audits — role and label on every Pressable/TextInput; 48 dp targets read from the real StyleSheet; no truncation and no fixed text heights; no animation APIs; decorative glyphs hidden; live regions (blocking banners assertive, quote/fare updates polite); spoken fare labels; text alternatives for map tasks; AA contrast for every tone/badge/confidence pair.
- **Guard changes:** `.dependency-cruiser.cjs` `not-to-dev-dep` now skips `src/__mocks__/` (the test-only syntax-tree helper imports `typescript`); knip entries for the review CLIs.

Not done / external: FA-09 native review OPEN (blocks P18/A06/K19 exit); TalkBack walkthrough on a physical device (FA-14) NOT RUN; VoiceOver (FA-13) NOT RUN; 200 % font and RTL screenshots (SP-08 full matrix) — see the closure section; the A06 field measure belongs to SP-04 (FA-05).

## SP-08 — Mobile E2E tooling and release gates (ADR-052) — IDs V10, U04, U05, Q26 (+ V08/V05/V11/A01/L08/K19 flows)

- **Tool:** Maestro CLI 2.11.0 (checksum-verified, telemetry off) on an emulator; flows in `tests/e2e-mobile/flows` (PR tier + full tier, manifest-driven); a throwaway stack `wayvro_e2e_mobile` (recreated per run) with the synthetic catalog and pricing (60 s quote TTL), accounts created through the public OTP/consent endpoints.
- **E2E build variant:** `node scripts/android-build.mjs e2e` — release-mode Hermes bundle, x86_64, debug-key signed, emulator-loopback origin only (`10.0.2.2:<port>`), E2E-only network security config. `release` mode refuses to build while the E2E variables are set.
- **New release gates in the Android job** (each with a `--self-test` negative control in CI): SDK-INV (`sdk-inventory.json`, exact versions), release purity (no cleartext, no E2E resources/keys, no instrumentation probe, no dev launcher), size budgets (FA-07), bundle secrets. ART-ISO 03d covers the same markers in server artefacts.
- **SP-02 instrumentation:** a first-party local Expo module `modules/wayvro-fully-drawn` (Kotlin, `Activity.reportFullyDrawn()` once per process) ships in the release AAB; the driver-module evaluation probe exists only in the instrumented E2E build.
- **Workflows:** CI job `Mobile E2E` (INFORMATIONAL, not in the ruleset; runs only on mobile-affecting changes); `.github/workflows/mobile-full.yml` (manual full matrix, FA-16: no schedule).

Fixed at the merge (findings of the SP-08 emulator run):
- HARD_UPDATE "Read legal policies" stalled on the session guard's `/v1/account/state` read (426). Under a blocking policy the guard now renders the escape screens (legal; deletion under HARD_UPDATE) without the account state (`rendersWithoutAccountState`, unit-tested). The server's 426/503 gate is unchanged.
- The blocking screen's title was drawn under the status bar: `Screen topInset`.
- Pricing seed: the E2E stack now uses `seedSyntheticCatalog({ quoteTtlSeconds: 60 })` (new optional, range-checked, integration-tested) instead of the never-built `seedSyntheticPricing`; the quote TTL is 60 s (the rate card CHECK minimum), not 45 s.

Evidence: the PR tier ran on a local API 35 emulator only (EMULATOR evidence): 9 PASS, 2 NOT RUN (pricing pending at the time), 1 FLAKY + 1 FAIL from adb transport loss under load, 1 FAIL that was the HARD_UPDATE finding above. After the fixes, the emulator re-run is **NOT RUN**. The first CI run of `Mobile E2E` and the `mobile-full.yml` full matrix: see the closure section.

Founder confirmation needed: 14 transitive native modules newly listed as APPROVED-EXISTING in `sdk-inventory.json` (`transitiveAddedP35: true`; all MIT; already in the Phase 1/2 release AABs) and the first-party `wayvro-fully-drawn` module (FA-09 native review).

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

## P3.10 — Closure (2026-10-13)

### SP-08 evidence
- **PR tier, first CI run** (`Mobile E2E`, run 38439820550 on `4347289`, API 35 emulator, EMULATOR evidence): **3 PASS** (pr-01 sign-in → Rider home with the rider-hygiene check, pr-02 restore, pr-04 Earn entry rider-only with hygiene), **3 FAIL**, **8 BLOCKED**. Maestro wall time 924 s; E2E APK build 1,011 s.
  - The 3 FAILs (pr-03, pr-05, pr-06) waited for the pre-P3.8 driver-home copy "Going online isn't available yet". Since P3.8 the readiness headline is one of three sentences. The closure commit matches any of the three exact headlines (no assertion removed), and the restriction-row selector allows the P3.8 "Earning paused." prefix and the P3.9 spoken detail. Re-run: the closure SHA's CI run.
  - The 8 BLOCKED rows: **the 900 s Maestro budget (FA-16: PR tier ≤ 15 min) ran out after 6 of 14 flows.** Measured per-flow time is 63–210 s (≈ 40 s of it Maestro JVM start, plus a full sign-in per flow), so 14 flows need ≈ 25–35 min on a GitHub-hosted runner by that first measurement; the later runs on `4faf5a9` and `1895813` (46–176 s per passing flow, 10–12 flows in 969–1,113 s) put it at ≈ 19–25 min. **Founder decision required (FA-16):** raise the PR-tier budget, split the PR tier across parallel jobs (more Actions minutes), or approve reworking the runner so flows share one Maestro session and sign-in. The budget was not changed in this run.
- **Full matrix** (`.github/workflows/mobile-full.yml`, mandatory at closure): **BLOCKED** — GitHub dispatches a `workflow_dispatch` workflow only when the file exists on the default branch (`gh workflow run mobile-full.yml --ref phase-3/maps-quotes-unified-ux` → HTTP 404 "workflow mobile-full.yml not found on the default branch"). FA-16 forbids adding an automatic trigger. It can run once the workflow file is on `main` (`gh workflow run mobile-full.yml --ref <branch>`). The 50,000-run property tier runs inside it and is therefore NOT RUN.

### Performance budgets (ADR-050)
Release AAB of `4347289` (CI): arm64-v8a **26,131,920 B** (budget 30,000,000), armeabi-v7a **25,388,836 B** (29,000,000), Hermes **3,687,008 B** (4,500,000) — PASS. Every device, battery and staging budget: NOT MEASURED.

### U04
Final inventory: `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md` §11 (36 rows; the release permission delta for Phase 3 is COARSE + FINE only).

### Requirement reconciliation (29 IDs)
Rule (`docs/phase3/PHASE3_REQUIREMENT_MATRIX.md`): ENGINEERING_SATISFIED only if every repository-provable evidence item passed in CI on the closure SHA. Where an ID's evidence includes Maestro flows that have not passed in CI (PR-tier budget; full matrix not dispatchable before merge), the ID is **BLOCKED**, even when its server and unit evidence is complete.

| ID | Status | Evidence in CI | Missing / external |
|---|---|---|---|
| A01 | BLOCKED | app-config contract, 426/503 + exempt-route integration, MC/step-up/audit, policy table tests; HARD_UPDATE escape fix (unit) | Maestro UPD/MAINT flows (pr-13 BLOCKED by budget; full tier not dispatchable); store link (EG-18) |
| A06 | BLOCKED | normaliser unit/property, 39 PROPOSED aliases, alias→place tests, catalogue parity | RTL `ur` Maestro run (full tier); FA-09 native review; SP-04 Roman-Urdu field metric |
| A07 | BLOCKED | location state-machine unit tests; release permission gate (COARSE + FINE) | Maestro LOC flows (pr-07 BLOCKED; n-04..06 full tier); SP-01 real OEM devices |
| A08 | BLOCKED | AA contrast pairs, 48 dp, roles/labels, live regions, no-truncation audits | Maestro font-scale 2.0 run (full tier); TalkBack walkthrough (FA-14); VoiceOver (FA-13) |
| B01 | BLOCKED | landmark formatter, reverse geocode vs MOCK incl. faults | Maestro PIN flows; renderer freeze (P3.7 BLOCKED-EXTERNAL); SP-04 |
| B02 | BLOCKED | placeRef seal/tamper, autocomplete integration incl. stale/budget degrade, debounce tests | Maestro SRCH (pr-08 BLOCKED); SP-04; ADR-006 |
| B03 | PARTIAL_EXTERNAL_GATED | polyline property tests, route snapshot contract, FAULT-GEO, Lite payload, confidence labels | SP-04 route/ETA accuracy; rendered polyline (P3.7) |
| B04 | BLOCKED | product attribute contracts; DISABLED_LEGAL_GATE products never priced; no client constants | Maestro QUOTE-01 (pr-10 BLOCKED) |
| B06 | ENGINEERING_SATISFIED | PROP-QUOTE incl. the P-06 fix, DB Σ trigger, component-kind contract, breakdown view-state | values synthetic by design; a real tax policy needs counsel |
| E05 | ENGINEERING_SATISFIED | snapshot immutability, `wayvro_api` UPDATE refused, rounding properties, inclusive/exclusive tax split | — |
| E06 | PARTIAL_EXTERNAL_GATED | port contract suite vs doubles, ART-ISO geo markers, BOOT-NEG, depcruise | production adapter per SKU + licence (P3.7; FA-05/06/19) |
| E07 | PARTIAL_EXTERNAL_GATED | CACHE-STALE, FAULT-GEO, quote refusal (503, nothing invented) | production TTLs with the ADR-006 freeze; the local load harness (cache-hit ratio / p95, informational) is **NOT BUILT** |
| E08 | ENGINEERING_SATISFIED | zone boundary + hours suites, migration/grants, MC, per-reason quote tests | boundaries synthetic by design |
| H06 | ENGINEERING_SATISFIED | AUTHZ-MATRIX extended, CONC-PRICING, rollback-by-new-version, web-ops pricing journey + axe | — |
| H10 | BLOCKED | PROP-ELIG-VEH, API + MC tests, per-product eligibility in the compliance view | driver-readiness Maestro step (pr-03 selector fix not yet re-run green; full tier) |
| I11 | PARTIAL_EXTERNAL_GATED | BUDGET + BREAKER suites, rollup idempotency, signal dedupe, budget concurrency | console caps attestation (FA-06); alert routing (EG-21) |
| K19 | BLOCKED | K19 state-coverage table test (en/ur/ur-Latn) | Maestro ONB flows (n-01/n-02 full tier; pr-12 BLOCKED); FA-09; TalkBack |
| L08 | BLOCKED | Lite payload tests, stale thresholds, restore tests | Maestro LITE-01 (full tier); SP-02 device data |
| P18 | PARTIAL_EXTERNAL_GATED | catalogue completeness + placeholder parity, hard-coded-copy scan, reproducible review export | FA-09 reviewer sign-off (0 of 931 strings REVIEWED) |
| Q26 | PARTIAL_EXTERNAL_GATED | budget table + ADR-050; CI size and Hermes gates PASS | device start/memory/jank/data/battery (SP-02/SP-01); staging-class server numbers; local server load runs NOT RUN |
| Q27 | BLOCKED | device protocols + capture templates | low-RAM AVD lane (full tier, not dispatchable); physical devices (FA-04) |
| Q31 | PARTIAL_EXTERNAL_GATED | oasdiff gate green, policy evaluation tests, ADR-049 matrix | founder records the minimum OS. Deviation: no separate COMPAT-N1 test (old schemas parsing new responses); backward compatibility is enforced by the oasdiff gate against `main` |
| R28 | ENGINEERING_SATISFIED | lifecycle legal-gate trigger tests, no product-code switches in UI (static scan) | deviation for review: BIKE/RICKSHAW appear in `unavailable[]` as `ZONE_NOT_SERVED` (closed reason list), not `DISABLED_LEGAL_GATE` |
| U04 | PARTIAL_EXTERNAL_GATED | SDK-INV gate PASS on the release AAB | renderer row (P3.7); founder confirmation of 14 transitive rows + `wayvro-fully-drawn`; network capture NOT RUN; iOS privacy manifest NOT RUN; EG-18 |
| U05 | PARTIAL_EXTERNAL_GATED | AAB gates (permissions, intent filters, 16 KB, ABI) + negative controls on every Android run | background-location justification (SP-01, Phase 4) |
| V05 | PARTIAL_EXTERNAL_GATED | RIDER-HYGIENE in CI on `1895813`: pr-01 and pr-04 (account A) and pr-09 (account B in Rider mode) PASS with the host-side `dumpsys package` / `appops` hygiene check; static rider-graph import rules; release manifest gate | SP-01 rider-hygiene check on the real release AAB on physical OEM devices |
| V08 | BLOCKED | resolveIntent + restoration precedence tests; pr-02 PASS on CI | NAV flows (pr-03/05/06 selector fix not yet re-run green; n-03 full tier) |
| V10 | BLOCKED | switch semantics tests; SP-08 tooling in place | PR-tier job not green (FA-16 budget); full matrix not dispatchable before merge; physical-device subset |
| V11 | BLOCKED | size gate PASS; no static driver import from the rider graph or layouts | module-evaluation probe in CI (n-07, full tier); SP-02 device measurements |

**Totals:** ENGINEERING_SATISFIED 5 · PARTIAL_EXTERNAL_GATED 10 · BLOCKED 14 (V05 moved from BLOCKED once its flows passed in CI on `1895813`).

### PR tier re-run on the closure SHA `4faf5a9` (push run 38446105899)
**9 PASS** (pr-01 … pr-09, including the re-selected pr-03/05/06 and pr-07 location denied, pr-08 search, pr-09 rider hygiene for account B), **1 FAIL** (pr-10), **4 BLOCKED** (budget: 900 s exhausted after 10 flows, 1,113 s). The pr-10 failure was a test precondition, not a product defect: the run reached the quote screen at 23:56 Pakistan time, and the server correctly refused it as outside the synthetic 06:00–23:00 hours ("Rides here start again at 06:00"). The E2E stack now seeds all-day hours (`seedSyntheticCatalog({ allDayServiceHours: true })`, integration-tested), as the API integration helpers already did. The PR run 38446160279 Mobile E2E job also FAILED (informational).

### PR tier on `1895813` (all five required checks green on push run 38452091883 and PR run 38452098038)
- push run 38452091883: **9 PASS** (pr-01 … pr-09), **1 FAIL** (pr-10), **4 BLOCKED** (budget; 1,089 s);
- PR run 38452098038: **10 PASS** (pr-01, pr-03 … pr-09, pr-11 quote restore, pr-12 KYC onboarding), **1 FLAKY** (pr-02 restore, passed on its automatic retry; never counted as PASS), **1 FAIL** (pr-10), **2 BLOCKED** (pr-13, pr-14; 969 s).
- pr-10 now reaches the priced Economy card (synthetic Rs 630, tolls disclosed, synthetic-price label, validity countdown). It failed only because it expected a "Comfort" card: in the synthetic seed COMFORT is CONFIGURED, not ENABLED, so the catalog correctly never offers it. The flow now asserts that Comfort is **not** offered, the stronger product rule. Re-run: the next CI run.
- pr-13 (HARD_UPDATE, legal reachable) and pr-14 (sign-out wipe) have not yet run in CI because of the budget.

### Fixed after the PR was opened — activation time order under concurrency
- **Finding:** PR #8's `pull_request` CI run 38446160279 failed Integration at `CONC-PRICING` (two concurrent rate-card activations): one request answered **500**. Reproduced locally in 2–3 of 15 runs. The server error was `rate_cards_check6` (`effective_until >= effective_from`).
- **Cause:** activations are serialised by an advisory lock, but they stamped `effective_from` / `effective_until` with `now()`, the transaction start time. A request that began its transaction before a competing activation committed, and then waited on the lock, retired that card with an `effective_until` earlier than its `effective_from`.
- **Fix:** every activate/retire timestamp written under these locks now uses `clock_timestamp()`, as the catalog activations already did. That covers rate cards (API and worker), app version policies (API and worker) and geo budgets (whose CHECK is strict `>`). Selection predicates (`effective_from <= now()`) are unchanged.
- **Regression test** (deterministic): the test holds the activation lock while the request's transaction waits, then activates another card and commits. With the old `now()` the request answers 500 (negative control run); with the fix it answers 200 and the time order holds. `CONC-PRICING` then passed 55 consecutive local runs (15 + 40; temporary repetition, not committed).
- **Same pattern outside Phase 3 (not changed):** the Phase 2 compliance requirement-set activation (`compliance-admin.service.ts`) also stamps `now()` under serialisation. It is recorded here for a bounded follow-up, not changed in this phase.

### Freezes and spikes
- **SP-01** (background location, real OEM devices): harness built (`tests/spikes/sp-01-background-location`); no device run. ADR-029 / ADR-003 stay OPEN-SPIKE. FA-03 open.
- **SP-02** (low-end device): fully-drawn marker and instrumented build exist; no device run. FA-04 open.
- **SP-04** (Lahore field benchmark): `tools/geo-bench` with the FA-07 thresholds and the route-critical hard gate; no field data, no provider keys. ADR-006 / ADR-046 NOT WRITTEN (BLOCKED-EXTERNAL). FA-05, FA-06, FA-19 open; FA-08 no spend.
- **FA-09** native Urdu/Roman-Urdu review: export ready; nothing REVIEWED.

### Can Phase 3 be called complete?
**No.** Under the full-run evidence semantics (sequence §1.1), Phase 3 must not be merged as complete while the SP-01/SP-02/SP-04 evidence and the FA-09 review are missing, and 14 IDs are BLOCKED on Maestro evidence. The engineering run is closed and the PR is open for review only.
