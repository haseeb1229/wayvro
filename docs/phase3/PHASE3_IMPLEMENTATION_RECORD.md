# PHASE3_IMPLEMENTATION_RECORD — Full macro Phase 3 implementation (P3.0 – P3.10)

**Branch:** `phase-3/maps-quotes-unified-ux` from protected `main` @ `b1a19865fa1a3f72244e2b5b10f9e1e5148004b9` (merge of the reviewed Phase-3 planning PR #7). · **Authorisation:** founder authorised the whole macro Phase 3 engineering run in one session (2026-10-12, `WAYVRO_PHASE3_FULL_IMPLEMENTATION_AUTHORISATION`); P3.0–P3.10 are internal checkpoints, not approval points. · **Plan:** `docs/phase3/PHASE3_IMPLEMENTATION_PROMPT_PROPOSED.md` with `<PHASE3_PLAN_MERGE_SHA>` = `b1a1986…`, and every `docs/phase3/` design file. · **Status (current, 2026-10-18):** repository-owned engineering closure **PASS** on final code `af5d8e2` (full matrix 39045502501 green; successor commits documentation-only); classification **8 ENGINEERING_SATISFIED / 21 PARTIAL_EXTERNAL_GATED / 0 BLOCKED**; macro Phase 3 **EXTERNAL BLOCKED** (real-world SP-01/SP-02/SP-04 evidence and the FA-09 native review are still missing); PR #8 open and not merged; Phase 4 not started — see **Current status** below. · **Historical (2026-10-13, superseded):** at the first closure the run was "ENGINEERING RUN AT CLOSURE — PR opened for review", with 14 IDs then BLOCKED on Maestro evidence (see the historical P3.10 closure section). · **Agent:** Claude Code (self-audit, not independent verification). · Synthetic data only; no provider account, key, real boundary, real price or real user data exists in this run.

Founder confirmations in force for this run (authorisation §4–§8): FA-01, FA-02, FA-07, FA-10, FA-11, FA-12, FA-16 APPROVED; FA-17 approved in principle; FA-18 deferred to Phase 4; FA-08 no paid spend; FA-09 native review required; FA-19 Mapbox licence clarification required before any S2 freeze. Pricing maker-checker: two distinct authenticated staff identities (both may hold `PRICING_MANAGER`), maker ≠ checker enforced by database and service, mandatory audit actor ids and reason codes, `STAFF_ADMIN` is not the routine approver, break-glass is not a shortcut. SP-01 thresholds are fixed pre-measurement values (FA-07).

Genuine founder/external actions still open at run start: FA-03 (SP-01 real devices), FA-04 (SP-02 low-end device), FA-05 (SP-04 Lahore field data), FA-06 (evaluation provider accounts/keys), FA-09 (native Urdu/Roman-Urdu review), FA-19 (Mapbox written licence clarification, S2 only).

## Current status (2026-10-18) — read this first

This block is the current state. Everything below it is a time-stamped log; earlier closure sections are **historical and superseded** where they differ, and their banners say so.
- **Repository-owned engineering closure: PASS.**
  - **Final code:** SHA `af5d8e20615f58c9600f9fbdfacdf0d2833c825d`.
  - **Branch successor:** `3985d43` and later commits are documentation-only, code-identical to `af5d8e2` (no change under apps, packages, infra, scripts, tests, .github, `pnpm-lock.yaml` or `package.json`).
  - **CI on `af5d8e2`:** push run 39045490954 and PR run 39045495235 green; Mobile E2E 14/14.
  - **Refreshed full matrix 39045502501 on `af5d8e2`:** every job success. PASS 105 · SKIPPED 6 · NOT RUN 6 · NOT TESTABLE 9 · FLAKY 0 · FAIL 0 · BLOCKED 0. The 50,000-run property tier, the load harness + 600 s FAULT-GEO soak and the network inventory all PASS.
- **Classification of the 29 Phase-3 IDs:**
  - **ENGINEERING_SATISFIED 8:** B04, B06, E05, E08, H06, H10, R28, V08.
  - **PARTIAL_EXTERNAL_GATED 21:** A01, A06, A07, A08, B01, B02, B03, E06, E07, I11, K19, L08, P18, Q26, Q27, Q31, U04, U05, V05, V10, V11.
  - **BLOCKED 0.**
  - The earlier 5 / 10 / 14 split (2026-10-13/14) is historical.
- **Macro Phase 3: EXTERNAL BLOCKED.** Not complete. The open gates fall into three separate categories (authority: `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` §1, `docs/phase3/PHASE3_FOUNDER_EVIDENCE_PACK.md` §0 and §5):
  - **Phase-3 close blockers** (exit needs all four):
    - FA-03 / SP-01 real OEM Android devices;
    - FA-04 / SP-02 reference low-end Android phone;
    - FA-05 / SP-04 Lahore field ground truth and provider benchmark;
    - FA-09 native Urdu / Roman-Urdu human review.
  - **Conditional dependencies** (no independent exit block):
    - FA-17 HTTPS tunnel for the signed-in SP-01 TC-01 and SP-02 subsets. Without an acceptable path those measurements stay BLOCKED, and TLS is never weakened.
    - FA-06 provider evaluation accounts, only if the SP-04 comparison of proprietary candidates needs them. The open stack can be benchmarked without them.
    - FA-19 written Mapbox licence clarification, only if S2 (Mapbox) remains a finalist. It blocks an S2 freeze, not exit.
  - **Future release gates** (not Phase-3 exit):
    - FA-13 iPhone / VoiceOver (Phase 7);
    - FA-14 physical TalkBack walkthrough (recommended before pilot);
    - EG-18 store listing, Play location declaration and Data safety.
- **Governance.** Ruleset 24837051 still requires the original five contexts and allows merge, squash and rebase. The founder-authorised update was prepared from the live ruleset (`Mobile E2E` as the sixth required context; merge-only). This session's permission policy refused the PUT on 2026-10-17 and 2026-10-18, so it is **pending, as a founder action**. Until then `Mobile E2E` is green on every run but informational.
- **Repository visibility:** the repository is **PRIVATE** again (checked 2026-10-27). The PUBLIC period recorded in the closure-CI section below is historical.
- **Latest CI on the documentation head `09b7672`:**
  - PR run 39063230948: all 11 jobs success, including the E2E APK, all four Mobile E2E shards and the aggregate (14 expected · PASS 14).
  - Push run 39063226015: all jobs success. The shards were SKIPPED there because nothing mobile-affecting changed since `5c5d285`; the aggregate reports that skip.
- **PR #8:** open and unmerged; review only. **Phase 4:** not started.

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
- Per-IP-prefix geo limits are NOT built (per-account only). **Resolved in the closure correction** (IPv4 /24, IPv6 /56, hashed keys).
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
- Requested products that are not ENABLED are listed as `ZONE_NOT_SERVED` (the reason list is fixed). **Superseded in the closure correction:** legal-gated products report `LEGAL_GATE_DISABLED`.
- `GET /v1/quotes/{id}` returns `unavailable: []`, because refusals are not stored.
- Columns added beyond the plan: `submission_preview`, `envelope_override_reason_code`, `attribution_code`, `polyline_expires_at`, `tax_included_*`.
- Not built (open items): the route-ratio sanity check (T3-06), a per-account limit on `GET /v1/quotes` (T3-04), the `QUOTE_NOT_FOUND_BURST` signal, and quote purge on account deletion. **The route-ratio check and the quote purge at deletion were built in the closure correction**; T3-04 and `QUOTE_NOT_FOUND_BURST` remain open.

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
- expo-location's library manifest declares a non-exported `LocationTaskService` (FGS type location) that is never started. Its effect on the Play FGS declaration must be checked before any store upload. **Resolved 2026-10-17:** removed from the merged manifest (see the targeted engineering correction section).
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

> **Historical (2026-10-13: 5 / 10 / 14 classification, Maestro and full matrix not yet green in CI, runtime network capture not yet run) — superseded by the final closure evidence; see Current status at the top.**

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

## Closure correction (founder decision 2026-10-14, `WAYVRO_PHASE3_ENGINEERING_CLOSURE_CORRECTION`)

> **Historical (2026-10-14: CI blocked by the Actions billing limit; 14 IDs then BLOCKED on Maestro evidence) — superseded by the final closure evidence; see Current status at the top.**

**Starting state:** main `b1a1986`, branch head `0573f87`, PR #8 open and not merged, worktree clean, 532 IDs / 29 Phase-3 IDs.

### Founder decisions recorded
- **FA-16 Mobile E2E:** one E2E APK + 4 balanced PR shards (≤ 900 s Maestro each), all 14 flows, an aggregate gate, one retry per flow, no nightly matrix, no paid Actions spend.
- **Native modules:** the 14 `transitiveAddedP35` modules and the first-party `wayvro-fully-drawn` module are APPROVED (`PHASE3_SDK_PRIVACY_INVENTORY.md` §11, `sdk-inventory.json`). This is not FA-09.
- **ADR-049:** the SECURITY single-person expedited path and the checker-less 15-minute undo are NOT APPROVED for Phase 3 (deferred, not implemented).
- **Q31:** `minSdk 24` (Expo SDK 57 default) stays the engineering floor; the iOS minimum stays unfrozen.

### Main hotfix — PR #9 (`fix/compliance-activation-clock-and-mobile-full-bootstrap`, head `c05ee74`)
- **Phase-2 requirement-set activation race fixed:** advisory lock per (city, category) before the ACTIVE set is read; `clock_timestamp()` timestamps. Deterministic regression test: main's original code answers 500, the fix 200 with `effective_until ≥ effective_from`.
- **`mobile-full.yml` bootstrapped** on the default branch with an unsupported-target guard: a ref without the SP-08 harness FAILS, never PASS.
- **`.gitleaksignore`:** the reviewed Phase-3 false-positive fingerprint, so the full-history Security scan passes.
- **CI:** all five required checks green on PR run 38562382643 (re-run after the `.gitleaksignore` commit).
- **NOT MERGED:** the merge (`gh pr merge 9 --merge`) was refused by this session's permission system as a merge without review, so the founder merges it. Main push CI after the merge, the merge of main into this branch, and the full-matrix dispatch therefore have **not happened**.

### Phase-3 branch changes (`a2fcd2b` … final SHA below)
| Item | Change | Evidence |
|---|---|---|
| PR-tier sharding (FA-16) | `mobile-e2e-apk` → `mobile-e2e-shard` ×4 (own emulator, own throwaway stack, 900 s budget) → `Mobile E2E` aggregate (`tests/e2e-mobile/aggregate-shards.mjs`: all 14 flows exactly once, PASS or non-INV-07 FLAKY, budget respected; 10-case `--self-test`); `device offline` ⇒ BLOCKED (infrastructure) | self-test PASS (local); see "CI status" |
| Network inventory (U04 §12) | `tests/e2e-mobile/net-inventory.mjs` (built-ins pcap parser; API-35 traffic is on netsim virtio-wifi, so the netsim Wi-Fi pcap is the source); wired into the mobile-full API-35 lane; raw pcaps never uploaded | 13-case self-test PASS; one local real emulator capture PASS (agent run: 12 hosts, no analytics/ads/crash/update host, `10.0.2.2:4120` = synthetic API); CI run NOT RUN |
| R28 | `LEGAL_GATE_DISABLED` for DISABLED_LEGAL_GATE products (never priced); zone failures stay `ZONE_NOT_SERVED`; mobile copy "This service is not available yet." (ur/ur-Latn pending native review) | contract, quote integration, mobile view-state tests |
| Deletion (§11) | **Decision A, purge:** the accepted Phase-2 model keeps no location/quote data as a retention exception (`packages/identity-core/src/deletion.ts` `retentionExceptions`; EG-16 accepts none). `identity.deletion-processing` purges the account's quote components, quotes and unshared route snapshots inside its transaction; a still-live quote defers completion to the next run. Accounts are tombstoned, never deleted, so the FK cannot strand deletion. | worker cross-phase deletion integration tests |
| Geo abuse controls (§9) | per-IP-prefix ceilings for autocomplete/geocode (600/min), resolve (300/min), reverse (300/min) per IPv4 /24 or IPv6 /56, HMAC-hashed keys, TRUST_PROXY address only, fail closed; T3-06 route sanity (shorter than the geodesic lower bound ⇒ refused; > 3.0× great-circle ⇒ LOW + `ROUTE_RATIO_OUTLIER`); result caps tested | RL-IP, route-ratio and cap tests |
| COMPAT-N1 (§8) | frozen test-only Phase-2 contracts (`packages/contracts/test/compat/phase2`, from `b1a1986`) parse the Phase-3 responses of 117 shared routes; requests stay strict; 225 enum positions compared | 290 contracts tests, 100 % coverage (runs in Quality) |
| COMPAT-N1 finding | a closed error-code enum in an older client discards the whole envelope of a newly added code (a Phase-2 build would see the ADR-049 426 by status only). No Phase-2 build was ever published. Fixed forward: the Phase-3 client reads the code as an opaque string, maps known codes, and keeps the status kind plus the hints for unknown codes | mobile unit test |
| Load harness + soak (§7) | `tools/load-harness` (Node built-ins): `pnpm load:local`, `pnpm soak:fault-geo`; full-tier `load` job in mobile-full.yml (the summary requires it) | local reports below |
| 50k property tier | pricing PROP-QUOTE added to the full tier; property-test timeouts scale with `WAYVRO_PROPERTY_RUNS` (vitest default kept at the PR default of 500 runs) — at 50,000 runs two properties exceeded the 5 s default (a timeout, not a counterexample) | local runs below |

### Evidence on the final branch state (LOCAL unless stated)
- **CI on `7772b63`** (push run 38580717297, PR run 38580731301): Quality, Integration, Security, Web E2E and Android all success (PR run Android success; push run Android success). **Mobile E2E FAILED:** every shard's emulator could not create its userdata partition ("Not enough space … Available 3729.78 MB, need 7372.80 MB"; the split shard jobs lacked the serial job's disk cleanup), so no flow ran. One PR-run shard also hit a corrupt emulator SDK download. Fixed in `3a38199` (free-disk step in the shard jobs and the mobile-full lanes).
- **CI from `3a38199` on: BLOCKED.** GitHub Actions refuses to start any job: "recent account payments have failed or your spending limit needs to be increased" (runs 38587027004, 38587039527). The private repository's Actions minutes are exhausted; no paid spend without founder approval. So the sharded PR tier, the full matrix (API 29 / API 35 / API 35 low-RAM), the CI 50k tier, the CI load + soak job and CI on the final SHA are all **BLOCKED (billing)**.
- **Local Quality mirror** (final code): format, build, build:local, eslint on every source root (`--max-warnings=0`), typecheck, depcruise, knip ×3, syncpack, flags:check, test:coverage, openapi:check, oasdiff gate + self-test, the five Android gate self-tests, the aggregate and net-inventory self-tests, docs generators, gitleaks full history (`--all`), osv-scanner, ART-ISO with negative controls — **all PASS**.
- **Local integration** (`pnpm test:integration`, real PostgreSQL/PostGIS/Valkey/SeaweedFS/ClamAV, throwaway databases): API 414/414, worker 57/57, realtime 14/14, identity-core 23/23, server-runtime 51/51 — **PASS**.
- **Local 50k property tier:** domain geo 10/10, API geo-unit + catalog-domain + pricing-engine 53/53 — **PASS**. fast-check seeds are random per run and printed only on failure; no failure occurred.
- **Local load harness** (`build-logs/load/load-2026-10-14T155114Z.md`, LOCAL NON-STAGING): 15 scenario/concurrency rows, 200 requests each, 0 % errors, 0 deadline refusals. quote MISS p95 422/481/801 ms at concurrency 1/4/16; quote HIT p95 80/137/327 ms (100 % hit); autocomplete p95 165/43/68 ms; reverse p95 252/224/328 ms; app-config p95 17/7/22 ms. Injected synthetic provider latency: ROUTE 250 ms, AUTOCOMPLETE 120, REVERSE 150. A first run failed reverse@4/@16 with 429: the new geo IP-prefix ceiling working, because all harness traffic comes from one loopback prefix. The harness now raises those ceilings for its local stack, as it already did for the account limits.
- **Local FAULT-GEO soak** (`build-logs/load/fault-geo-soak-2026-10-14T154052Z.md`): seed 20261014, 600 s, 3,265 requests, **0 invariant violations**, with planted negative controls detected before the run.

### Requirement status after the correction
Unchanged totals: **ENGINEERING_SATISFIED 5 · PARTIAL_EXTERNAL_GATED 10 · BLOCKED 14**, by the matrix rule (CI on the closure SHA).
- **R28:** the deviation is gone (`LEGAL_GATE_DISABLED`).
- **E07:** the repository gap (load harness) is closed locally; production TTLs remain external.
- **Q31:** COMPAT-N1 is built and the floor is decided; the iOS minimum remains external.
- **U04:** the approval is recorded and the network inventory is built; its CI run is BLOCKED.
- **The 14 BLOCKED IDs:** still blocked on Maestro evidence in CI (sharded tier and full matrix cannot run while Actions is blocked; the full matrix also waits for the PR #9 merge).

### Repository-owned engineering closure
**NOT PASS — BLOCKED on two founder actions:** (1) merge PR #9; (2) restore GitHub Actions (billing/spending limit). The code for every repository-owned item of the correction is complete and passes locally. The CI evidence the correction requires (sharded PR tier green, full matrix, CI 50k, CI load/soak) has not been produced. **Macro Phase 3: EXTERNAL BLOCKED** (SP-01, SP-02, SP-04, FA-09 unchanged).

## Closure — CI evidence (founder authorisation 2026-10-15, `WAYVRO_PHASE3_CLAUDE_DO_EVERYTHING_POSSIBLE`)

> **Historical (2026-10-15/16: closure on `4bf4803`; superseded by the targeted correction and the refreshed full matrix on `af5d8e2`) — superseded by the final closure evidence; see Current status at the top.**

The repository was made PUBLIC by the founder to restore GitHub Actions; no workflow, runner or architecture was changed for that. Public-repo safety preflight:
- no `pull_request_target` trigger;
- no `secrets.*` reference, and the repository has 0 Actions secrets;
- `permissions: contents: read`, and the default workflow permissions are read;
- standard `ubuntu-24.04` runners only;
- artefact retention 7 days;
- gitleaks full history clean.

**PR #9 merged** by a normal merge commit **`c2d8ac789ad4d5e8253372c0bd4eb167cd30cea8`** (parents `b1a1986` main, `c05ee74` PR head). **Main push CI 38620534896:** Quality, Integration, Security, Android and Web E2E all success.

**Main merged into this branch** by a normal merge commit `b7dbb38` (parents `50f4ec0`, `c2d8ac7`). Conflict: `mobile-full.yml` (added on both sides), resolved to the branch version, which is a superset of main's bootstrap.

### CI on the branch
| SHA | Push run | PR run | Notes |
|---|---|---|---|
| `b7dbb38` | 38623258117: all success incl. Mobile E2E 14/14 PASS | 38623262811: all success, 14/14 PASS | first real-CI proof of the 4-shard design + free-disk fix; shards 196–311 s of 900 |
| `0962861` | 38635172209 attempt 2: all success, 14/14 PASS | 38635182862: all success (13 PASS + pr-03 FLAKY: first attempt lost the adb transport, the retry passed) | attempt 1 of the push run: the E2E APK job failed downloading NDK 27.1 (infrastructure) — one rerun |
| `aff4f40` | 38643691564: all success, 14/14 PASS first attempt (shards 197–261 s) | 38643700388 attempt 2: all success, 14/14 PASS | attempt 1: shard 4 hit a corrupt system-image download (infrastructure) — one rerun |
| `4bf4803` | 38855393762: all success, 14/14 PASS first attempt (shards 160–313 s) | 38855400225: all success, 14/14 PASS first attempt (shards 173–487 s) | SP-08 coverage closure + release-state race fix |

### Full matrix (manual workflow_dispatch from the default branch)
- **Run 38623281968** (`b7dbb38`) — **FAILED**, and the failures were real:
  - **n-03 (app defect, V08):** a successful sign-in left `/sign-in` beneath the mode home, so hardware back could never leave the app.
  - **n-10 (server defect, A01):** a RIDER-scoped `rider.quotes` stop was enforced, but never reached `GET /v1/app/config`.
  - **n-02, n-09, n-15:** stale flows written before P3.8/P9.
  - **Network inventory:** the netsim capture was not found.
  - Fixed in `0962861`.
- **Run 38635173646** (`0962861`) — **FAILED**, but confirmed n-02, n-03 and n-10 on every lane. Still failing:
  - **n-15:** tapped the pickup's helper text instead of the suggestion;
  - **n-09:** `.*Rs.*` also matched ordinary copy;
  - **n-05 (low-RAM lane):** depended on n-04's leftover location fix;
  - **Network inventory:** captured but BLOCKED, because the netsim Wi-Fi capture starts after the install began, so there was no baseline window.
  - Fixed in `aff4f40`: a 120 s idle baseline on the API-35 lane, plus per-app UID attribution.
- **Run 38643695206** (`aff4f40`) — **SUCCESS on every job**:
  - target guard;
  - E2E APK;
  - **50,000-run property tier**;
  - **load harness + 600 s FAULT-GEO soak**;
  - **Maestro API 29: PASS** (24 PASS, 4 SKIPPED by design (system-dialog flows run on API 35 only), 1 NOT RUN (n-14 manual-only), 2 NOT TESTABLE);
  - **API 35: PASS** (28 PASS, 1 NOT RUN, 2 NOT TESTABLE);
  - **API 35 low-RAM: PASS** (28 PASS, 1 NOT RUN, 2 NOT TESTABLE);
  - Matrix summary success.
  - **Totals:** PASS 80, FAIL 0, BLOCKED 0, FLAKY 0.
- **Network inventory (API 35, `aff4f40`): PASS.**
  - Source: the netsim Wi-Fi pcap (`/tmp/android-runner/netsimd/pcaps`), 242,430 packets.
  - No analytics, ads, crash-reporting or update host was first seen during the app session.
  - `pagead2.googlesyndication.com` and `update.googleapis.com` are in the BASELINE window, before the Wayvro APK was installed, so they are OS / Google Play services traffic on the `google_apis` image.
  - Per-app UID attribution reported "not available" on that run. The parser stopped at the `mAppUidStatsMap: OK` status line, not the content section. This was verified against a real API-35 `dumpsys netstats` on a throwaway local AVD and fixed in the closure commit, with a regression fixture.

### Coverage audit after the green matrix — gaps found and closed (`4bf4803`)
Before reclassifying, every strategy-named Maestro case and every SP-08 row was compared with `tests/e2e-mobile/flows/manifest.mjs`. The manifest's claim that every SP-08 row was accounted for did **not** hold on `aff4f40`:
- SP-08 #6 / NAV-04 internal intent routing had no flow;
- #21 version policy covered only HARD (pr-13), not SOFT (UPD-01) or MAINTENANCE → retry (MAINT-01);
- #16 refusal states covered only outside-area (n-09);
- PIN-01..03, SRCH-02..04, ONB-03 and LOC-04 had no flows.

These were repository-owned gaps (affecting A01, A07, B01, B02, K19, V08). They were closed in `4bf4803` with new full-tier flows, each validated on a local API-35 emulator and then in the CI matrix:
- **n-18, n-19a–e:** internal intents / NAV-04 (signed-out, Rider, Driver, unknown and stale intents resolved by server state);
- **n-20a–c:** SOFT update prompt, dismiss and continue (UPD-01);
- **n-21a–c:** MAINTENANCE screen, retry while still in maintenance, recovery (MAINT-01);
- **n-22a–c:** pickup restricted, routing unavailable, routing recovered (#16);
- **n-23a/b:** pin and search fallback (PIN-01, PIN-03, SRCH-02, SRCH-04);
- **n-24:** location permission denied permanently → settings path (LOC-04);
- **n-25:** pin accuracy (PIN-02);
- **n-26:** Roman-Urdu place alias (SRCH-03).

Writing n-21 exposed a real defect: the release-state cache answered a concurrent caller with the old snapshot while a refresh was in flight, so the app missed the maintenance state. `apps/api/src/platform/release/state.ts` now awaits the in-flight refresh, with a regression test in `apps/api/test/app-config-service.test.ts`.

Documented exceptions (not counted as passes):
- **n-22x outside hours — NOT TESTABLE in Maestro:** the stack seeds all-day service hours so quote flows never depend on the wall clock, and an ACTIVE zone set is immutable; the HOURS refusal is covered by the API integration tests.
- **n-27 ONB-03 capture resume — NOT RUN:** the resumable capture intent is an evidence file in the persisted upload queue, which needs a camera capture or gallery image on the emulator; the queue's persistence and resume logic is covered by unit tests.
- **n-14 KYC upload — NOT RUN** (manual-only); **n-16, n-17 — NOT TESTABLE** (static flag registry; no external URL scheme in release builds).

### Final CI evidence on `4bf4803`
- **Push CI 38855393762 and PR CI 38855400225:** Quality, Integration, Security, Android, Web E2E, E2E APK, four shards and the Mobile E2E aggregate all success, first attempt; aggregate 14 expected · PASS 14.
- **Full matrix 38855394910 (workflow_dispatch from main, target `phase-3/maps-quotes-unified-ux`): SUCCESS on every job.**
  - **API 29:** PASS 31, SKIPPED 6 (system-dialog flows run on API 35 only), NOT RUN 2, NOT TESTABLE 3.
  - **API 35:** PASS 35, FLAKY 2 (n-06, n-26: first attempt failed, the single retry passed), NOT RUN 2, NOT TESTABLE 3.
  - **API 35 low-RAM:** PASS 36, FLAKY 1 (n-26), NOT RUN 2, NOT TESTABLE 3.
  - **Totals:** PASS 102 · SKIPPED 6 · FLAKY 3 · NOT RUN 6 · NOT TESTABLE 9 · FAIL 0 · BLOCKED 0.
  - **50,000-run property tier:** success. **Load harness + 600 s FAULT-GEO soak:** success.
- **Network inventory (API 35): PASS.** Netsim Wi-Fi pcap, 233,354 packets. No analytics, ads, crash-reporting or update host first seen during the app session; `pagead2.googlesyndication.com` is BASELINE (seen before the APK was installed). **Per-app attribution** (`dumpsys netstats`, app UID 10209): the app exchanged 724,706 B and the capture saw 727,790 B to the synthetic API (tolerance 444,092 B), so the app's traffic is accounted for by the synthetic API.
- The closure documentation commit after `4bf4803` changes documentation only; the matrix evidence stays on the code-identical `4bf4803`.

### Final requirement classification (29 IDs)
All repository-owned Maestro evidence is green in CI (sharded PR tier and full matrix), and the SP-08 coverage gaps are closed.
- **ENGINEERING_SATISFIED (8):**
  - B04 (QUOTE-01 pr-10 green);
  - B06; E05; E08; H06;
  - H10 (driver readiness flows green);
  - R28 (`LEGAL_GATE_DISABLED`);
  - V08 (NAV flows incl. n-03 back stack and n-18/n-19 intents green; external deep links out of Phase-3 scope).
- **PARTIAL_EXTERNAL_GATED (21):**
  - A01 (store link, EG-18);
  - A06 (FA-09, SP-04 Roman-Urdu metric);
  - A07 (SP-01 OEM devices);
  - A08 (TalkBack walkthrough FA-14, VoiceOver FA-13);
  - B01 (renderer freeze, SP-04);
  - B02 (SP-04, ADR-006);
  - B03 (SP-04, rendered polyline);
  - E06 (production adapter per SKU, FA-05/06/19);
  - E07 (production TTLs with ADR-006);
  - I11 (FA-06 console caps, EG-21);
  - K19 (FA-09, physical TalkBack);
  - L08 (SP-02 device data);
  - P18 (FA-09);
  - Q26 (SP-02/SP-01 device numbers, staging);
  - Q27 (physical low-end devices, FA-04);
  - Q31 (iOS minimum unfrozen);
  - U04 (renderer row at P3.7, EG-18, iOS privacy manifest);
  - U05 (background-location justification, SP-01);
  - V05 (SP-01 physical OEM rider-hygiene check);
  - V10 (physical-device release subset; making Mobile E2E a required check is a founder action);
  - V11 (SP-02 device measurements).
- **BLOCKED: 0.**

### Repository-owned engineering closure: **PASS**. Macro Phase 3: **EXTERNAL BLOCKED** (SP-01 real OEM devices, SP-02 low-end device, SP-04 Lahore field/provider benchmark, FA-09 native Urdu/Roman-Urdu review; FA-19 only if Mapbox remains a candidate). Phase 3 is not complete and PR #8 is not merged; Phase 4 has not started.

### Founder preview APK (synthetic, non-performance, laptop-required)
- **File:** `C:\Dev\wayvro-founder-artifacts\wayvro-phase3-preview-arm64.apk` (outside Git).
- **SHA-256:** `b1fe23834cc220a07da2aab4ed4812c2a034cb5f9d0ad90e9eae3859750600a5`.
- **Build:** a debug development client (arm64-v8a + x86_64) whose API origin is the laptop's LAN address `http://192.168.100.69:4120`.
- **Use:** `start-preview.ps1` starts the synthetic stack (throwaway DB) and Metro; `README.txt` holds the steps.
- **Not taken — release-like FA-17 HTTPS build:** an account-free quick tunnel gets a new random hostname on every start, so an APK built against it would stop working at teardown. A stable hostname needs a tunnel account (founder action).

## Laptop-only evidence sweep (founder instruction 2026-10-16, `WAYVRO_PHASE3_MAXIMUM_LAPTOP_EVIDENCE_SWEEP`)

> **Historical (2026-10-16/17: its masked-number finding was later withdrawn and SP02-F1 re-measured) — superseded by the final closure evidence; see Current status at the top.**

Every result below was produced on the Windows development laptop (Intel i5-1145G7, 4 cores / 8 threads, 15.7 GB RAM, shared with an unrelated project) with Android emulators, ADB, the local synthetic API (throwaway databases), local Docker and open data. **None of it is real-device, field, legal/commercial or native-speaker evidence**, and no macro-Phase-3 status changes because of it. Summaries are in `docs/phase3/evidence/laptop/`; raw captures stay in the git-ignored `evidence-local/` and `tools/geo-bench/.local/`.

Classes used: `REPOSITORY_CI`, `LOCAL_EMULATOR_SUPPLEMENTARY`, `LOCAL_SYNTHETIC_BENCHMARK`, `REAL_DEVICE_REQUIRED`, `FIELD_REQUIRED`, `HUMAN_REVIEW_REQUIRED`, `EXTERNAL_ACCOUNT_REQUIRED`, `LEGAL_COMMERCIAL_REQUIRED`.

| Stream | Evidence | Class | What it does NOT close |
|---|---|---|---|
| SP-01 background location | `SP01_EMULATOR_SUPPLEMENT.md` — API 35 emulator TC set + an interrupted ~53-minute session | LOCAL_EMULATOR_SUPPLEMENTARY | SP-01 / FA-03 (REAL_DEVICE_REQUIRED: OEM kill policies, GNSS, battery/thermal, radio) |
| SP-02 low-end performance | `SP02_LOW_RAM_AVD_SUPPLEMENT.md` — 2 GB API-35 AVD, release-mode Hermes E2E APK | LOCAL_EMULATOR_SUPPLEMENTARY | SP-02 / FA-04 (REAL_DEVICE_REQUIRED) |
| SP-04 geo | `SP04_OPEN_STACK_DESK_BENCHMARK.md` — self-hosted OSRM + Nominatim on a dated Lahore OSM clip, 79 desk cases | LOCAL_SYNTHETIC_BENCHMARK | SP-04 / FA-05 (FIELD_REQUIRED); S1/S2 (EXTERNAL_ACCOUNT_REQUIRED, FA-06); no ADR-006/046 freeze |
| Provider adapters | `PROVIDER_ACCOUNT_FREE_CONTRACTS.md` — 193 account-free Google/Mapbox contract tests | REPOSITORY_CI | real response conformance, quotas, latency (EXTERNAL_ACCOUNT_REQUIRED); terms/caching (LEGAL_COMMERCIAL_REQUIRED) |
| Accessibility | `A11Y_EMULATOR_SUPPLEMENT.md` | LOCAL_EMULATOR_SUPPLEMENTARY | FA-14 physical TalkBack (REAL_DEVICE_REQUIRED); FA-13 VoiceOver |
| Urdu / Roman-Urdu | `FA09_AUTOMATED_PREREVIEW.md` — `i18n:prereview` checker + git-ignored reviewer pack | REPOSITORY_CI (checker) | FA-09 (HUMAN_REVIEW_REQUIRED; 0 of 934 REVIEWED) |

### Results in one place
- **SP-01 (emulator):** TC-01 Rider hygiene PASS on the release-permission E2E variant (no background location, no FGS, no background prompt); TC-02/08/09/12b/13/16/17/18 and activity recreation PASS; TC-06, TC-11 and TC-15 FAIL. An interrupted ~53-minute API-35 session reached 99.21 % point completeness (631/636), longest gap 5.95 s, 0 drops/duplicates. Spike defects fixed: the persisted-job crash (RECEIVE_BOOT_COMPLETED required by expo-task-manager) and stale-snapshot stop. Open design inputs for ADR-029/Phase 4: an orphan location FGS survives a native crash or a revoke-kill for ~60 s, and the R8-minified build needs a keep rule for `RNHeadlessAppLoader`. The release manifest still declares the never-started `LocationTaskService` (decision needed before store upload). API 29 and low-RAM lanes, the AOSP image and a full 60-minute run were NOT RUN (time; AOSP download failed).
- **SP-02 (2 GB API-35 AVD, release-mode Hermes E2E APK):** warm start p50 329 ms / p90 559 ms; PB-06 driver modules before fully drawn 0 (40/40); PSS at Rider home p90 132.9 MiB; one process; Hermes bundle 3.72 MB; a whole scripted Rider walk used 27.5 KB. Cold start to fully drawn is far above PB-01/PB-02 on this saturated host (signed-in p50 7.1 s / p90 10.9 s; signed-out p50 3.1 s): **finding SP02-F1**, decomposed per sample; one avoidable cost identified (no proactive refresh of an expired 15-minute access token → `401 → refresh → retry` on cold start); recommended, not fixed (security-sensitive path, no device evidence). Lite, PB-09 and kill-recovery timing and the 3 GB comparison were NOT RUN.
- **SP-04 (open stack, desk):** OSRM v26.10.0 + Nominatim 5.3.2 (digest-pinned) on the Geofabrik Pakistan extract of 2026-10-15 (md5 verified) clipped to Lahore; 79 desk cases. Route answers 24/24 with ETA, route/straight-line ratio median 1.46, 0 wrong-way legs; Nominatim-as-autocomplete top-5 29 % (Roman-Urdu 5 %); **hard gate FAILS on the desk review** (4 airport legs use `access=private` service roads: S3 INELIGIBLE on desk data until field review). Photon and Valhalla NOT RUN (download speed below 10 KB/s). Accuracy numbers are circular (cases come from the same OSM data).
- **Provider adapters:** 193 new account-free Google/Mapbox contract tests (329/329 pass, coverage 99.35 % statements). Latent finding for the P3.7 binding: adapters throw `GeoAdapterError`, the gateway classifies only `GeoProviderError`, so QUOTA/CLIENT_ERROR/NETWORK would be misclassified once a real adapter is bound; `Retry-After` is not propagated. Mapping is a founder/lead decision at binding time.
- **Accessibility (emulator):** English, Urdu and 200 %-font Rider walks PASS end to end; Rider-home accessibility tree 0 problems; TalkBack present and bound but synthetic swipes did not move its focus (walkthrough NOT RUN; FA-14 open). One Urdu bidi defect fixed and verified on screen (`phone.hint` order) and the "1 suggestions" copy defect fixed and verified. A reported masked-number reversal in `otp.body` was a misreading of a full-line screenshot and was **withdrawn** on 2026-10-17 (number-only pixel crops show it in order; see the targeted correction below).
- **FA-09 pre-review:** deterministic checker (`i18n:prereview`): 0 errors over now 934 strings; 21 terminology, 7 bidi and 125 length warnings for the reviewer; glossary (4 terms with two renderings) and a SAFETY → LEGAL → PRICE → PERMISSION → GENERAL priority sheet with suggestions marked NOT REVIEWED. 0 of 934 REVIEWED.
- **n-14 / n-27 (camera/gallery):** synthetic non-personal images were generated and an emulator Photo-Picker flow drafted, but no deterministic, repeatable flow was achieved in the time-box: both stay **NOT RUN** (no KYC/liveness claim).
- **Founder preview:** `C:\Dev\wayvro-founder-artifacts` now keeps one APK per laptop LAN address (`builds\<ip>\`), `start-preview.ps1` verifies the SHA-256 and the baked API origin against the current Wi-Fi address and starts only what is not already running, and `rebuild-preview.ps1` rebuilds for a new address with one command (a new APK for 10.9.217.213 was built: SHA-256 `ad9a98dc…ae70`). The APK installs and opens the dev launcher on the x86_64 emulator.

### Requirement classification after the sweep
Unchanged: **ENGINEERING_SATISFIED 8**, **PARTIAL_EXTERNAL_GATED 21**, **BLOCKED 0**. Laptop evidence is recorded as supplementary against: A07, U05, V05 (SP-01 emulator); Q26, Q27, L08, V11 (SP-02 AVD); B01, B02, B03 (open-stack desk benchmark); E06, E07, I11 (account-free contracts); A08, K19 (emulator accessibility); A06, P18, K19 (automated pre-review). None of them becomes ENGINEERING_SATISFIED from laptop evidence: each remaining item is a real device, field data, a human reviewer, a provider account/terms, or a legal/commercial answer.

### Repository-owned engineering closure: **PASS** (re-confirmed in CI after the sweep's code changes). Macro Phase 3: **EXTERNAL BLOCKED**. PR #8 stays open and unmerged; Phase 4 has not started.

## Targeted engineering correction (founder review of the laptop sweep, 2026-10-17, `WAYVRO_PHASE3_FINAL_LAPTOP_ENGINEERING_CORRECTION`)

Reviewer verdict on `9647d80`: TARGETED ENGINEERING CORRECTION REQUIRED. Starting state: main `c2d8ac7`, PR #8 open and mergeable at `9647d80`, push run 39016829364 and PR run 39016832712 green. The last full matrix (38855394910) was on `4bf4803`. Product/mobile code changed between `4bf4803` and `9647d80`: `strings.ts`, the three phone-hint screens, the search count and the `search-view.ts` helper, plus tool/test code (geo-bench, geo-adapter contract tests, the SP-01 spike). That old matrix therefore cannot prove the final code.

### 1. Urdu masked phone number (OTP, step-up, phone change) — no defect; the earlier finding is withdrawn
- **Finding withdrawn.** The masked-number "reversal" reported by the laptop sweep was a misreading of full-line screenshots, not a rendering defect.
- **Proof with number-only pixel crops** on the unchanged rendering code (the original CI APK; the final code renders these sentences identically):
  - `otp.body`: "+92 3** *** **01";
  - `stepUp.sent`: "…92 3** *** **01" (the "+" just outside the crop);
  - `phoneChange.codeBody`: "+92 3** *** **02";
  - all in left-to-right order inside the Urdu sentence.
- **Diagnostic changes reverted.** The LRI/LRE/LRM marks, the split rendering and the per-character rendering were all reverted; no rendering code changed for these sentences.
- **Real defect, kept fixed.** `phone.hint` was a real defect: crops show "3XX XXXXXXX 92+" before and "+92 3XX XXXXXXX" after the fix in `9647d80`.
- **Other checks.**
  - English and Roman Urdu are unaffected (left-to-right sentences; walks PASS).
  - The Urdu Rider walk at 1.0 font and the English walk at 200 % show no clipping.
  - An Urdu walk at 200 % font was NOT RUN.
- **Evidence and lesson.** Evidence: `docs/phase3/evidence/laptop/A11Y_EMULATOR_SUPPLEMENT.md` §5. Lesson: mixed-direction rendering is judged only from number-only crops or view geometry.

### 2. SP02-F1 (signed-in cold start) — instrumented
`docs/phase3/evidence/laptop/SP02_LOW_RAM_AVD_SUPPLEMENT.md` §5 (cohorts A/B/C/D, device logcat plus API request log on one timeline). With a fresh token, the account-state and app-policy requests already run in parallel; fully drawn was p50 2.97 s / p90 3.29 s on a less loaded host. The 7.1 s of the sweep was host saturation.

**App-owned inefficiency fixed:** with an expired access token, every cold start first sent a request that could only answer 401. `SessionManager.refreshDueAtFirstUse` now refreshes first, at most once per process, through the unchanged single-flight refresh. After the fix: 0 of 9 samples with a 401 (before: 9 of 9).

**Security invariants unchanged:** access TTL 900 s, idle/absolute lifetimes, refresh rotation and replay protection (persisted idempotency key), secure storage, server authority.

**Status:** remaining startup time is native/Hermes bootstrap and render on the emulator, so **REAL_DEVICE_REQUIRED** (FA-04). The 3 GB AVD, Lite cold/warm and quote-cycle memory checks were NOT RUN (time).

### 3. Geo adapter ↔ gateway error semantics (fixed)
- **Design.** `GeoAdapterError` now extends `GeoProviderError`. Its `kind` comes from one exhaustive table (`packages/geo-adapters/src/errors.ts`).
- **Taxonomy.** `GeoProviderFailure` gains `AUTH` and `NO_RESULT`; nothing is renamed or removed.
- **Google bad keys.** Google 4xx answers are classified by `google.rpc.ErrorInfo.reason` (the bad-key reason maps to AUTH).
- **Retry-After.** It is parsed in delta-seconds and HTTP-date forms against an injected server clock. Malformed or past values are dropped, and valid ones are clamped to 1–3600 s. Applied on QUOTA only.
- **Gateway.** It reads only `kind`. The cool-down uses `Retry-After` when valid, else 60 s.
- **Tests.** geo-adapters 684/684 (coverage 99.42 % statements), apps/api geo unit 51/51, geo integration 99/99 (real PostgreSQL/Valkey, throwaway DBs), quotes 30/30.
- **Docs.** `docs/phase3/evidence/laptop/PROVIDER_ACCOUNT_FREE_CONTRACTS.md` §8, `PHASE3_ARCHITECTURE.md` §5.4.

### 4. Release `LocationTaskService` (removed)
- **Why it is unused.** expo-location 57.0.20 starts the service only from `LocationTaskConsumer` (`startLocationUpdatesAsync` with a foreground-service option). Wayvro uses only foreground permission and position APIs; a test bans the background/task APIs in app source.
- **Removal.** `apps/wayvro-mobile/plugins/no-location-task-service.mjs` removes the service from the merged manifest of every variant with `tools:node="remove"`, without modifying the upstream package.
- **Release gate.** `infra/ci/android/check-intent-filters.mjs` now fails any service declaring `foregroundServiceType` unless `component-allowlist.json` `foregroundServices` lists it. The list is empty in Phase 3; the self-test has a negative case.
- **Evidence.** In the merged manifest of the locally built E2E APK: 0 `LocationTaskService`, 0 `foregroundServiceType`, permissions unchanged (COARSE, FINE, CAMERA, INTERNET). The release AAB is proven by the CI Android job (below).
- **Spike.** The SP-01 spike keeps its own service; it is a separate app.

### 5. SP-01 spike
The R8 keep rule for `RNHeadlessAppLoader` (`tests/spikes/sp-01-background-location/plugins/spike-proguard.mjs`, with a test) is applied by prebuild. In the R8 mapping of build r5 the class is kept under its original name. Correction re-run on API 35 with build r5 (`docs/phase3/evidence/laptop/SP01_EMULATOR_SUPPLEMENT.md` §7), LOCAL_EMULATOR_SUPPLEMENTARY:
- **Headless starts: PASS.** 4 process starts without an activity; 0 ClassNotFoundException.
- **TC-06: FAIL** on the informational < 5 s reconnect target. Reconnect + snapshot p50 19.4 s, p95 34.0 s; 2 of 4 offers lost while the socket was down; 0 duplicates.
- **TC-11 and TC-15: FAIL.** Detection passes, but the location FGS stays for the life of the process. The earlier "~60 s" was only the observation window.
- **Root cause (cited source lines).** expo-location `LocationTaskService.onStartCommand` returns START_REDELIVER_INTENT and never stops itself. Android restarts the crashed sticky service as foreground. On restore, `LocationTaskConsumer` cannot bind while the app is not yet foregrounded, so `stopLocationUpdatesAsync` reaches a null service.
- **Not fixable in spike JS.** This is a Phase-4 input for ADR-029/ADR-033: native FGS lifecycle control (stop on a restarted start without a user session, or START_NOT_STICKY, or candidate B after FA-08), a permission re-check before running as foreground again, and on-device re-measurement.
- **Release app not affected.** It no longer declares the service (§4).
- **NOT RUN:** API 29 and low-RAM lanes, TC-21 on r5, the long session.

### 6. Open-stack S3 airport hard gate (root-caused, no change)
- **Cause.** The desk endpoint (the aerodrome polygon's vertex mean) is airside: classification C, with B contributing. Untagged stub way 1488381974 is the snap target, and the route then follows the private perimeter chain 232121109 / 105840612 / 946418464.
- **Profile.** The OSRM car profile treats `access=private` service ways as destination-only, not as through roads. No profile change was made.
- **Diagnostic.** A separately labelled landside endpoint gives the same four legs 0 restricted ways.
- **Status.** S3 desk hard gate **FAIL / FIELD_REQUIRED**. Cases FL-AIR-1..4 are added to the SP-04 field list (`SP04_OPEN_STACK_DESK_BENCHMARK.md` §6a).

### 7. n-14 / n-27
One bounded attempt (synthetic "SYNTHETIC TEST DOCUMENT" images pushed to the emulator gallery and media-scanned; seeded applicant account) did not reach the system Photo Picker. The drafted applicant-details flow cannot fill the date-of-birth fields on the 720×1600 AVD (keyboard over the fields). No deterministic picker or camera automation was demonstrated, so **n-14 and n-27 stay NOT RUN**. Existing coverage: the CI flow pr-12 (onboarding form on the CI emulator), the upload-queue and capture unit tests, and the evidence pipeline integration tests. No KYC, liveness or face claim.

### 8. Full-matrix harness defect found and fixed
The first refreshed full matrix (run 39039135285 on `6832ad4`) had API 29, API 35, the 50k property tier and load + FAULT-GEO soak all green. The **API 35 low-RAM lane crashed**: after n-22 passed, the `run-flows` process died with an unhandled `fetch failed: other side closed` (UND_ERR_SOCKET) from the n-23 hook's local geo-control PUT. That is a keep-alive socket closed by the API under load; the API itself did not exit. One transient socket close should not end a lane.
- **Fix** (`tests/e2e-mobile/run-flows.mjs`): the idempotent control PUT retries once on a network-level failure (UND_ERR_SOCKET / ECONNRESET / UND_ERR_CLOSED).
- Any hook that still throws marks only that flow **BLOCKED**, with the reason, instead of crashing the runner; cleanup hooks still run.

### 9. CI, full matrix and ruleset
Final code SHA **`af5d8e2`**. The later closure commit changes documentation only. It touches no file under apps/, packages/, tools/, tests/, infra/ or .github/, which `git diff --stat af5d8e2 HEAD -- apps packages tools tests infra .github` proves to be empty.
- **CI on `6832ad4`.** Push run 39036576380 and PR run 39036580711: all jobs success. The Android job ran the new FOREGROUND-SERVICE rule against the release AAB; the Quality self-test has 7 cases. All four Mobile E2E shards were green.
- **First refreshed full matrix.** Run 39039135285 on `6832ad4`: the API 35 low-RAM lane crashed on the runner defect described in §8. The other lanes, the 50k property tier and load + soak were green.
- **CI on `af5d8e2`.** Push run 39045490954 and PR run 39045495235: Quality, Integration, Security, Android, Web E2E, E2E APK, four shards and the Mobile E2E aggregate all success. The aggregate reports "Flows: 14 expected · PASS 14 · Aggregate: PASS".
- **Full matrix 39045502501 on `af5d8e2` (final code): SUCCESS on every job.** Jobs: target guard, E2E APK, Maestro API 29, API 35, API 35 low-RAM, 50,000-run property tier, load harness + 600 s FAULT-GEO soak, and matrix summary.
  - API 29: PASS 31, SKIPPED 6, NOT RUN 2, NOT TESTABLE 3.
  - API 35: PASS 37, NOT RUN 2, NOT TESTABLE 3.
  - API 35 low-RAM: PASS 37, NOT RUN 2, NOT TESTABLE 3.
  - **Totals: PASS 105 · SKIPPED 6 · NOT RUN 6 (n-14, n-27) · NOT TESTABLE 9 · FLAKY 0 · FAIL 0 · BLOCKED 0.**
- **Network inventory (API 35): PASS.** 272,454 packets. The 5 hosts first seen during the app session are Google OS / Play-services endpoints (`update.googleapis.com`, `accounts.google.com`, `clientservices.googleapis.com`, `infinitedata-pa.googleapis.com`, `android-context-data.googleapis.com`). Per-app attribution (`dumpsys netstats`, app UID 10209): the app exchanged 713,832 B, and the capture saw 713,912 B to the synthetic API, so the app's own traffic is the synthetic API.
- **Ruleset 24837051.** The update adding `Mobile E2E` as the sixth required context (existing five unchanged, no bypass) was prepared (`evidence-local/fix/ruleset-after.json`) but the call was **refused by this session's permission policy**. It is NOT applied; it is a founder action. The ruleset still requires the original five contexts.

### Classification after the correction
29 IDs: **ENGINEERING_SATISFIED 8** (B04, B06, E05, E08, H06, H10, R28, V08), **PARTIAL_EXTERNAL_GATED 21**, **BLOCKED 0** — unchanged, because every remaining item is external.

### Repository-owned engineering closure: **PASS**. All of the following hold:
- the masked-number finding is resolved (withdrawn, with proof);
- the adapter error translation is fixed and proven;
- `LocationTaskService` is removed and gated;
- SP02-F1's app-owned inefficiency is fixed, with the residual classified REAL_DEVICE_REQUIRED;
- normal CI is green;
- Mobile E2E is green;
- the full matrix is green on the final code SHA.

Macro Phase 3 stays **EXTERNAL BLOCKED**. PR #8 is open and unmerged; Phase 4 has not started.
