# PHASE3_IMPLEMENTATION_PROMPT_PROPOSED — Full macro Phase 3 implementation run (NOT AN AUTHORISATION)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PROPOSED text only. It becomes an instruction only when the founder sends it (edited or as-is) after the Phase-3 plan passes founder/ChatGPT review. Nothing in this file authorises implementation.

---

WAYVRO — PHASE 3 FULL IMPLEMENTATION RUN
Macro Phase 3: maps, quotes and core unified Rider/Driver UX — ONE run, internal checkpoints P3.0–P3.10, ONE final report.

Fresh session. Before any edit:
1. Confirm `main` (local and origin) equals the SHA that merged the reviewed Phase-3 planning pack (founder to fill: `<PHASE3_PLAN_MERGE_SHA>`), worktree clean, identity `Muhammad Haseeb <abdulhaseeb1229@gmail.com>`, remote `haseeb1229/wayvro`, ruleset 24837051 active with the five required checks.
2. Confirm the latest `main` CI run is green on all five jobs. If Android is red: re-run once through GitHub; if it fails again, STOP and report (no workaround).
3. Read CLAUDE.md, `docs/phase3/PHASE3_PLAN.md` and every `docs/phase3/` file, `docs/adr/README.md`, ADR-043, ADR-045, ADR-004, ADR-030, `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md`.
4. Verify the register still has 532 IDs and exactly 29 with `phase0.target_phase = 3` (P0 17, P1 11, P2 1). Any mismatch → STOP.
5. Read the founder-action status the founder supplies with this prompt (FA-01..FA-18 answered / pending). Treat anything not explicitly answered as pending.

**Branch:** `phase-3/maps-quotes-unified-ux` from `<PHASE3_PLAN_MERGE_SHA>`. Founder-authored commits only, no AI/Claude co-author trailer, normal push only, no force/rebase/amend. Push at every checkpoint (CI runs on `phase-*/**`). No PR until the closure report; never merge.

**In scope (IDs):** A01 A06 A07 A08 B01 B02 B03 B04 B06 E05 E06 E07 E08 H06 H10 I11 K19 L08 P18 Q26 Q27 Q31 R28 U04 U05 V05 V08 V10 V11.

**Build exactly** (detail and order in `docs/phase3/PHASE3_IMPLEMENTATION_SEQUENCE.md`; designs in the named plan files):
1. **P3.0** F-P3-01 release URL-scheme removal + exported-component/intent-filter release gate + ADR-043/osv correction; enable oasdiff; start the Phase-3 implementation record.
2. **P3.1** Migration 0010_catalog_products_zones (expand-only, hand-written PostGIS SQL, guard triggers, grants; the section widening the `staff.role_assignments.role` CHECK only if FA-10 approves new roles), server-only zone/hours/eligibility evaluators in `apps/api`, staff maker-checker APIs, consumer read APIs, web-ops catalog pages, local/test-only synthetic Lahore seed (`docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md`).
3. **P3.2** Geo ports, MOCK-branded synthetic doubles (dev-only package), geo gateway (rate limits, Valkey cache, budgets, circuit breaker, deadline-aware retries, usage rollups), migration 0011_geo_controls, geo endpoints, `placeRef` sealing, SP-04 benchmark harness (dev-only) (`docs/phase3/PHASE3_ARCHITECTURE.md`, `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md`).
4. **P3.3** Migration 0012_pricing, server-only quote engine in `apps/api` on `Money` (`packages/domain`), `POST /v1/quotes` + `GET /v1/quotes/{quoteGroupId}`, rate-card/tax-policy maker-checker + rollback-by-new-version + preview, web-ops pricing pages, purge job (`docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md`).
5. **P3.4** Migration 0013_platform_release_controls, `GET /v1/app/config`, version-header enforcement (426), maintenance (503), runtime switches (disable fast path / enable maker-checker), web-ops pages, mobile handling.
6. **P3.5** Mobile shell: ModeController, Rider graph under the `/ride/*` URL segment (eager) and Driver graph under `/drive/*` (lazy), `/home` kept as the shared account hub, existing `earn/*` kept, restoration, intent router with no externally registered scheme, back stack, text-first rider search → quote flow, Lite mode, rider foreground location ONLY if FA-02 is approved, Maestro scaffolding + SP-08 PR tier (`docs/phase3/PHASE3_MOBILE_UX_AND_NAVIGATION.md`, `docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md`, `docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md`).
7. **P3.6** SP-02 round 1 and SP-01 spike on real devices per protocols; ADR-029/ADR-003 decisions only on evidence (`docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md`, `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md`).
8. **P3.7** SP-04 analysis with founder field data; ADR-006 per-SKU and ADR-046 renderer freeze only on evidence; production candidate adapters; map renderer behind `src/platform/maps`; SP-02 round 2 (`docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md`).
9. **P3.8** Driver/Partner mode shell: readiness, eligible products, restriction/health routing, location rationale (no background location), K19 state coverage.
10. **P3.9** Localization (en/ur/ur-Latn, pending native review), Roman-Urdu search aliases, accessibility hardening, RTL, map text alternatives; native-review export.
11. **P3.10** SP-08 nightly matrix, measured performance-budget table, final U04 SDK inventory (`docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md`), requirement reconciliation, closure record, PR opened for review.

**Do NOT:**
- build dispatch, offers, presence, ride requests, assignment, trip lifecycle, payments, ledger, promotions, bidding, surge, pooling, delivery, corporate/fleet, or any Phase-4+ table or route;
- add ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE(_LOCATION), POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT, contacts, Bluetooth, microphone, storage/media permissions to the release app; add COARSE/FINE location only with FA-02;
- register an external URL scheme or app/universal link in the release app;
- freeze a provider, renderer, background-location SDK or mobile stack without the SP evidence named in the plan; never treat emulator results as closing SP-01/SP-02;
- invent ETA, distance, address or price when a provider fails — refuse honestly;
- put provider keys in the repo, prompts, logs, fixtures or screenshots; create provider accounts, accept vendor terms or spend money (founder actions FA-06/FA-08);
- activate BIKE/RICKSHAW or any synthetic rate card/zone set in production configuration;
- upgrade Expo/RN/React or any framework minor/major (ADR-030); add expo-updates, analytics/ads/crash SDKs, jest/RTL, reanimated/gesture-handler (unless SP-02 evidence + ADR-043 amendment);
- weaken, skip or delete tests; add lint/type suppressions or coverage exclusions to go green;
- rename/remove existing fields, enums, routes, tables (`catalog.service_categories` stays as is).

**Tests** (report each as PASS / FAIL / NOT RUN / BLOCKED / SKIPPED with the exact command; detail in `docs/phase3/PHASE3_TEST_STRATEGY.md`): format, lint, typecheck, depcruise, knip, syncpack, flags:check, unit + property, coverage, openapi:check + oasdiff, docs:check; integration on real PostGIS/Valkey (migrations clean + every previous prefix + live-row upgrade, restricted-role grants, geometry); API integration incl. quote tamper/idempotency/zone/hours/outage; provider fault injection, breaker, budgets, cache; log-redaction for coordinates and geo query strings; artefact isolation incl. geo doubles; web E2E for new web-ops pages; Maestro SP-08 tiers; Android release gates (permissions, intent filters, 16 KB, ABI, size budget); gitleaks (history + staged) and osv; SP-01/SP-02/SP-04 evidence only from real devices/field data.

**Docs in the same change:** Phase-3 implementation record per checkpoint; ADR files at their checkpoints (only on evidence where evidence is required); `docs/adr/README.md`; register implementation evidence through the generator workflow (never hand-edit generated files); `ALL_FILES_INDEX.md`; run the manifest generator `docs/phase0/tools/regen-manifest.js` (then with `--check`) and `docs/phase0/tools/phase0-coverage.js` with `--check`.

**Finish:** one final report per CLAUDE.md §17 — scope/files, IDs with status (ENGINEERING_SATISFIED / PARTIAL_EXTERNAL_GATED / BLOCKED), commands and outcomes, migrations 0010–0013, permission/size/intent-filter deltas, provider/config impacts, security/privacy implications, cross-mode regression evidence, SP-01/02/04 status, founder actions still pending, CI run ids per pushed SHA, final SHA, PR link. Then STOP. Do not start Phase 4.
