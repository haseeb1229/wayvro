# PHASE3_HANDOFF_REPORT — Android CI repair and macro Phase 3 planning handoff (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT plan review recorded 2026-10-12 (targeted fixes applied, `docs/phase3/PHASE3_PLAN.md` §11); no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

## A. Android CI repair (completed before planning)

### A.1 Initial red `main`
`main` @ `6aed6a455af3e3b406ef2aea7502ea0c3b06389d` (PR #5 merge), push run 38167751474: Quality, Integration, Security, Web E2E PASS; **Android FAIL on both attempts**. PR #5 run 38165558105 on head `157d197` (tree `2fcb86c`, identical to the merge tree) passed Android.

### A.2 Root cause

| Class | Statement | Evidence |
|---|---|---|
| PROVEN | Attempt 2 exhausted runner disk after both builds and all gates passed (`System.IO.IOException: No space left on device`; the job log blob was never uploaded). | check-run annotation, job 114566108027 |
| PROVEN | Since Phase 2 changed `pnpm-lock.yaml`, the Gradle key `gradle-Linux-<hash(pnpm-lock.yaml, app.config.ts)>` missed on every run and the prefix `restore-keys: gradle-Linux-` restored the Phase-1 cache `gradle-Linux-1aa778…` (2,041 MB, 2026-10-10). | attempt-1 log "Cache hit for restore-key: gradle-Linux-1aa778…"; cache inventory |
| PROVEN | The implicit post-job Gradle save failed (`tar` exit code 2, warning only) on every Android run since Phase 2 (PR #5 run, `main` run 38161242750, run 38167751474). | check-run annotations |
| PROVEN | The ubuntu-24.04 image starts with 14 GB free of 72 GB; without intervention the debug build ended at 2.1 GB free (98 %). | PR #6 run 38177849934 disk log |
| LIKELY | The `tar` failures were disk exhaustion while archiving the whole `~/.gradle/caches` (incl. transforms, 5.3 GB after both builds). | sizes above; not separately instrumented |
| UNPROVEN | Whether attempt 1's `Could not find org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.0` came from stale restored cache metadata or a transient repository response. The repair removes the stale-cache path either way; it is not claimed as the cause. | — |

### A.3 Repair (workflow only)
Branch `fix/android-ci-cache-disk`, commits `4590261` (ci: make Android cache and disk use deterministic) and `47b7a9d` (ci: free unused runner toolchains before the Android builds); PR #6 "CI: harden Android cache and runner disk usage"; normal merge commit **`058fcea7c9267d4e7861cb9bdaa1bbdba169a997`** (parents `6aed6a4`, `47b7a9d`). Only `.github/workflows/ci.yml` changed.

| Area | Old | New |
|---|---|---|
| Cache content | `~/.gradle/caches` (all, incl. transforms) + `~/.gradle/wrapper` | `~/.gradle/caches/modules-2` + `~/.gradle/wrapper/dists` (downloaded dependencies + wrapper only) |
| Key | `gradle-Linux-<hash(pnpm-lock.yaml, app.config.ts)>` | `gradle-deps-v2-Linux-jdk17-<hash(pnpm-lock.yaml, apps/wayvro-mobile/package.json, apps/wayvro-mobile/app.config.ts, scripts/android-build.mjs)>`; root `package.json`/`pnpm-workspace.yaml` and gate scripts evaluated and excluded (no Gradle input beyond the lockfile; gates only read the AAB) |
| Restore | prefix fallback to any older `gradle-Linux-*` | `actions/cache/restore` on the exact key only |
| Save | implicit post-job save on every branch | explicit `actions/cache/save` only on `push` to `main`, on a miss, after both builds and all gates, after removing the app's `android/`, native intermediates and Gradle lock files; then a `lookup-only` restore verifies the entry; a missing entry is a visible `::warning` (infrastructure outcome) |
| Disk | none | `df -h /` + bounded `du` at job start, after toolchain removal, after install/restore, after release, after intermediate cleanup, after debug, before/after save; removal of `node_modules/**/android/{build,.cxx}` after the release gates; removal (each measured first) of unused preinstalled toolchains: `/usr/share/dotnet` 5.8 G, `/usr/local/.ghcup` 3.7 G, `/usr/share/swift` 3.5 G, `/opt/hostedtoolcache/CodeQL` 1.4 G, `/usr/local/julia1.13.1` 1.1 G. Android SDK/NDK, Java toolcache and Node untouched; no third-party action; no `continue-on-error`; all actions SHA-pinned (`actions/cache` v6.1.0 `55cc834…` for restore and save). |

### A.4 Disk measurements (`/` = 72 G)

| Point | PR #6 run 38177849934 (`4590261`) | PR #6 run 38179868440 (`47b7a9d`) | `main` push 38181749238 (`058fcea`) |
|---|---|---|---|
| Job start | 14 G free | 14 G | 14 G |
| After toolchain removal | — | 29 G | 29 G |
| After install + restore | 12 G | 27 G | 27 G |
| After release AAB | 4.5 G | 20 G | 20 G |
| After intermediate cleanup | 5.0 G | 21 G | 21 G |
| After debug APK | **2.1 G (98 %)** | 18 G | 18 G |
| Before save (after cleanup) | — (no save on PR) | — | 20 G |

### A.5 Cache-MISS evidence
PR #6 runs 38177849934 and 38179868440 and the `main` push run 38181749238: `Cache not found for input keys: gradle-deps-v2-Linux-jdk17-b82ff150…`; release AAB BUILD SUCCESSFUL (14m49s–18m36s) with the 16 KB, ABI and permission gates passed and `build-reports/` uploaded; debug APK BUILD SUCCESSFUL (9m52s–12m48s); all five jobs PASS. On the `main` push: `Cache saved with key: gradle-deps-v2-Linux-jdk17-b82ff150…` (1,287 MB) and "Gradle cache saved and verified"; no warning annotation.

### A.6 Cache-HIT evidence
`workflow_dispatch` run https://github.com/haseeb1229/wayvro/actions/runs/38204073155 on `058fcea` (job 114663567619): `Cache hit for: gradle-deps-v2-Linux-jdk17-b82ff150…`, `Cache Size: ~1287 MB`, step label `Gradle cache hit=true`; the old `gradle-Linux-*` entries still existed at that time and were **not** restored (no prefix fallback exists). Release AAB BUILD SUCCESSFUL (18m47s) with the 16 KB, ABI and permission gates passed; debug APK BUILD SUCCESSFUL (13m45s); disk 26 G free after restore, 18 G free after the debug build; save steps correctly skipped on a hit; zero check-run annotations; all five jobs PASS. Build time is similar to a miss: the cache buys determinism (no stale restore) and disk headroom, not speed.

### A.7 Stale cache deletion
Deleted with `gh cache delete` after the hit run (2026-10-12), because their key scheme `gradle-Linux-*` is no longer produced or restored by any workflow:

| Cache id | Ref | Size (bytes) | Key |
|---|---|---|---|
| 8766379397 | `refs/heads/main` | 2,141,115,758 | `gradle-Linux-1aa778c7…` (Phase-1 lockfile; the stale prefix-restored cache) |
| 8778621599 | `refs/heads/phase-2/identity-controlled-onboarding` | 2,142,184,969 | `gradle-Linux-f806129d…` |
| 8777690779 | `refs/heads/phase-2/identity-controlled-onboarding` | 2,142,193,547 | `gradle-Linux-a09be61e…` |

No pnpm cache and no other repository was touched. Remaining Gradle entry: `gradle-deps-v2-Linux-jdk17-b82ff150…` (main, 1,287 MB).

### A.8 New protected `main`
`058fcea7c9267d4e7861cb9bdaa1bbdba169a997` — push run https://github.com/haseeb1229/wayvro/actions/runs/38181749238: Quality, Integration, Security, Android, Web E2E all PASS.

## B. Phase 3 planning

### B.1 Release URL-scheme verification (F-P3-01)
- **Artefact:** release AAB built by CI in PR #6 run 38177849934 (merge ref `5c7b7c3`; app tree identical to `main`), dumped with bundletool 1.18.3.
- **Result:** `dev.wayvro.app.MainActivity` is `exported=true` with an intent filter `android.intent.action.VIEW` + `DEFAULT` + `BROWSABLE` + `android:scheme="exp+wayvro"`. The only other BROWSABLE entry is a `<queries>` package-visibility declaration (not a handler). The exported `androidx.profileinstaller.ProfileInstallReceiver` is protected by `android.permission.DUMP` (standard).
- **Provenance:** `expo-dev-client` 57.0.19 is auto-applied by `expo prebuild` (listed in `@expo/prebuild-config` `legacyExpoPlugins`; not named in `app.config.ts`); its `withGeneratedAndroidScheme` (`addGeneratedScheme` default `true`) appends `exp+<slug>` to the shared main manifest, so the scheme is present in debug **and** release. Debug needs it (dev-client launch, e.g. the Phase-2 emulator smoke); release does not.
- **Reachability:** in release the dev launcher is inactive, so a `exp+wayvro://…` VIEW intent (from any app, or a browser link after a user tap) starts MainActivity and the URL is delivered to the app's initial-URL handling and expo-router's parser (which uses `query-string` → `decode-uri-component` 0.2.2).
- **Download size check (same artefact):** arm64-v8a 25,500,991–25,685,982 B, armeabi-v7a 24,757,832–24,942,823 B (`bundletool get-size total --dimensions=ABI`), consistent with the P2.8 baseline; the 41.1 MB AAB file includes debug symbols under `BUNDLE-METADATA` that are not shipped.

### B.2 decode-uri-component exception impact
The `osv-scanner.toml` runtime exception for GHSA-vcc3-ghjq-m6fr (expires 2026-12-31) states that no URL scheme or intent filter is registered; that premise is false for release builds today, so external input can reach the vulnerable parser (impact: availability/CPU-exhaustion of the app process on a malformed link; no data exposure identified). The plan makes the variant-conditional removal of the generated scheme, an exported-component/intent-filter release gate, the ADR-043 correction and a truthful re-statement (or removal) of the exception the **first** implementation checkpoint (P3.0); no intentional deep link is designed while the exception is open, the intent router caps URL length before parsing, and the exception is not extended casually.

### B.3 Provider terms and pricing (primary sources, accessed 2026-10-12)
Detail and per-claim CONTRACTUAL/TECHNICAL classification: `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md` §3–§10.
- **Google Maps Platform** (pricing page last updated 2026-10-08; Platform Terms 2026-08-26; Service Specific Terms 2026-06-10): mobile Maps SDK map loads no charge; Essentials SKUs 10,000 free/month (Geocoding, Place Details Essentials, Compute Routes Essentials USD 5/1,000; Autocomplete Requests USD 2.83/1,000; Routes Pro USD 10/1,000 after 5,000). **Contractual:** no use of Google Maps content with or near a non-Google map; lat/lng cacheable ≤ 30 days (Geocoding 6.3.2 allows longer only per-end-user); `place_id` storable; route results displayed on a map must be on a Google map.
- **Mapbox** (pricing page, no effective date): mobile Maps SDK 25,000 MAU free; temporary geocoding 100,000 free then USD 0.75/1,000; permanent geocoding USD 5/1,000; Directions 100,000 free then USD 2/1,000; Search Box **sessions** standard 2,500 free then USD 11.50/1,000 (introductory preview 500 free then USD 3.00/1,000) and **requests** (/category, /reverse) standard 25,000 free then USD 1.70/1,000 (preview 50,000 free then USD 1.00/1,000) — corrected at review closure. **Contractual:** temporary geocoding results may not be cached; geocoding responses only with a Mapbox map; in-app telemetry opt-out required; a **Commercial Application License** is required "for vehicle usage" and for "applications primarily intended for use within vehicles or use in any vehicle system" (annual subscription, possibly per seat) — applicability to Wayvro is EXTERNAL (FA-19).
- **Open stack:** OSRM (BSD-2), Valhalla (MIT), Photon (Apache-2.0), Nominatim (GPL-3.0, self-host only — the public server prohibits autocomplete and bulk use); OpenFreeMap public tiles commercial-allowed but no SLA; Protomaps PMTiles self-hostable; OSM public tiles not suitable; ODbL attribution required.
- **TomTom/HERE:** free tiers exist (TomTom: 20,000 routing/geocoding per month); paid prices, commercial terms on free tiers and Pakistan coverage NOT FOUND — vendor confirmation needed.
- **Pilot economics (ESTIMATE, 15,000 trips/month, corrected at review closure):** Google ≈ USD 275–375 on the Essentials subscription with Essentials routes, ≈ 450–750 PAYG, up to ≈ 1,200 for Pro-route variants (+ abandoned-session sensitivity); Mapbox ≈ USD 316–325 at standard Search Box session pricing (≈ 89 preview, ≈ 38 temporary-geocoding autocomplete) **plus an unknown Commercial Application License if applicable**; open stack ≈ USD 0–25 plus operations time. Every paid variant exceeds the FD-14 envelope, which already assumes maps at USD 0.
- **Platform policy:** Google Play location-permission declaration effective 2027-01-27 (FINE only where COARSE or the location button cannot support the feature); pre-review checks from 2026-10-27; Expo SDK 57 pins `expo-location` ~57.0.20 and `react-native-maps` 1.27.2; expo-location adds no foreground-service permission for foreground-only use.

### B.4 Planning branch and files
Branch `docs/phase-3-planning` from `058fcea`; planning commit recorded in the final handoff message (this file is part of that commit). Created under `docs/phase3/`: `PHASE3_PLAN.md`, `PHASE3_REQUIREMENT_MATRIX.md`, `PHASE3_ARCHITECTURE.md`, `PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md`, `PHASE3_PRICING_QUOTE_MODEL.md`, `PHASE3_GEO_PROVIDER_EVALUATION.md`, `PHASE3_MOBILE_UX_AND_NAVIGATION.md`, `PHASE3_PERMISSION_LOCATION_MODEL.md`, `PHASE3_PERFORMANCE_BUDGETS.md`, `PHASE3_SECURITY_COST_THREAT_MODEL.md`, `PHASE3_SDK_PRIVACY_INVENTORY.md`, `PHASE3_SP01_REAL_DEVICE_PROTOCOL.md`, `PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md`, `PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md`, `PHASE3_SP04_FIELD_CAPTURE_TEMPLATE.csv`, `PHASE3_SP08_CROSS_MODE_E2E.md`, `PHASE3_TEST_STRATEGY.md`, `PHASE3_IMPLEMENTATION_SEQUENCE.md`, `PHASE3_EXTERNAL_FOUNDER_ACTIONS.md`, `PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md`, `PHASE3_IMPLEMENTATION_PROMPT_PROPOSED.md`, `PHASE3_HANDOFF_REPORT.md`. Updated status/index: `README.md`, `ALL_FILES_INDEX.md`, `docs/00_README_AND_STATUS.md`, `docs/12_PHASE_PLAN_AND_GATES.md`, `docs/23_FOUNDER_PROMPT_TRACEABILITY.md`, `docs/adr/README.md`, plus the regenerated `V5_FILE_MANIFEST.json`.

### B.5 Scope (register-verified)
29 IDs with `phase0.target_phase = 3`: P0 17 (A01 A06 A07 B01 B02 B03 B04 B06 E05 E06 E07 E08 H06 I11 U04 U05 V05), P1 11 (A08 H10 K19 L08 P18 Q26 Q27 Q31 V08 V10 V11), P2 1 (R28). Register 532, unchanged. Classes: IMPL 12 · IMPL+FREEZE 11 · IMPL+EXT 6.

### B.6 Architecture, migrations, pricing (summary)
- Server-side vendor-neutral geo ports behind a geo gateway (normalise → authz → rate limit → keyed-HMAC Valkey cache → budget → circuit breaker → adapter with timeout → normalise → usage meter); adapters declare licence/renderer requirements and are refused at boot if the bound set is not licence-coherent; per-adapter terms-derived TTLs; `placeRef` sealing via field-crypto with a new key class; quote deadline 3.0 s with a single routing attempt (PROPOSED).
- Migrations proposed (none created): **0010** catalog products/zones/eligibility (+ conditional staff-role CHECK widening), **0011** geo controls (budgets, usage, landmark aliases), **0012** pricing (tax policies, rate cards, route snapshots, quotes, quote components), **0013** release controls (app version policies, blocked builds, runtime switches and history). Explicitly not created: ride requests, dispatch, offers, presence, location samples, trips, bids, surge, promotions, payments/ledger.
- Quote: `POST /v1/quotes` (idempotent) → shared route snapshot + one priced option per enabled product; components BASE/DISTANCE/TIME/BOOKING_FEE/AIRPORT_FEE/MINIMUM_ADJUSTMENT/TOLL/TAX/DISCOUNT(reserved)/ROUNDING on `Money` with Σ = total; versioned rate cards and tax policies with maker-checker, rollback by new version, preview; synthetic Lahore only, refused in production; PRICED → EXPIRED/SUPERSEDED.

### B.7 Provider strategy without premature freeze
ADR-006's hybrid abstraction (FD-04) is kept; the SP-04 decision is among licence-coherent bundles S1 Google, S2 Mapbox, S3 open stack, S4 terms-permitted mixes, scored 40 accuracy / 20 coverage-landmark usefulness / 20 cost / 10 latency / 10 terms-ops risk with hard gates (terms compatibility incl. FA-19 for S2, FD-14 envelope unless FA-08 with an explicit billing mode, production reliability, accuracy floor **and no unresolved CRITICAL route invalidity**). Hypotheses only: S3 is the cost baseline; S2 needs a quality advantage, an explicit billing mode and a resolved FA-19; S1 needs a demonstrated quality gap and FA-08. ADR-006 and ADR-046 (renderer) are frozen together at P3.7 only on SP-04 evidence.

### B.8 Mobile, permissions, SDKs
- One binary; `/ride/*` (eager), `/drive/*` (lazy), `/home` shared hub, `earn/*` kept; ModeController (preference never authorises; additive server `AccountState.modes`); restoration by server truth; internal intent router, no external scheme in release; text-first rider search → quote first, renderer after the bundle freeze; in-app Lite mode; Driver mode shell (readiness, eligible products, restriction/health/appeal, informational location rationale) with no going online.
- Permissions: only ACCESS_COARSE_LOCATION + ACCESS_FINE_LOCATION (foreground, when-in-use) in Phase 3 and only with FA-02; rider requests at first "use current location" tap, approximate-only supported, manual pin always available; driver background escalation designed for Phase 4 after SP-01.
- SDK/privacy inventory covers every current dependency and every proposed SDK/provider with data, endpoints, telemetry, store disclosure and terms; no analytics/ads/crash SDK.

### B.9 Spikes
- **SP-01:** spike build under `tests/spikes/` (not the release app) plus rider-hygiene checks on the real release app; candidate A expo-location + task-manager FGS, candidate B Transistorsoft only with FA-08; TC-01..TC-22 on Samsung A-class, Redmi (HyperOS), Transsion (Infinix/Tecno) and/or Vivo; pass ≥ 95 % location points over 60 min screen-off on ≥ 3 OEM classes, no BG/FGS prompt in the rider path, revocation detected ≤ 30 s, deterministic crash recovery, offer path with push disabled; iPhone later (release evidence, not Android freeze).
- **SP-02:** budgets fixed before testing; rounds R1a/R1b (no map) and R2 (renderer); `am start -W` ×5, `reportFullyDrawn` marker, Perfetto, `dumpsys meminfo`, `bundletool get-size`, netstats, gfxinfo; signed-in measurements need FA-17 (HTTPS synthetic endpoint).
- **SP-04:** ≥ 50 cases (target 60) across 12 categories with minimum counts, ≥ 20 route legs, Roman-Urdu and Urdu-script variants; passenger-operated phone, never the driver; per-SKU metrics and PROPOSED gating thresholds (FA-07); raw provider responses never committed.
- **SP-08:** Maestro on emulator; accounts A–G (+ optional H, I) × restore, back stack, mode switch, intent routing, permissions, lazy modules, quote UX, onboarding regression; PR tier ≤ 15 min, scheduled full matrix per FA-16 (private repository minutes).

### B.10 Budgets, threats, tests, sequence
- Budgets (PROPOSED, NOT MEASURED): cold start p50 ≤ 2.5 s / p90 ≤ 4.0 s; warm p50 ≤ 1.0 s; download arm64 ≤ 30.0 MB, armeabi-v7a ≤ 29.0 MB; JS ≤ 4.5 MB; PSS ≤ 160/260 MB; quote p95 ≤ 800 ms / p99 ≤ 1.5 s (miss); Lite flow ≤ 150 KB; driver battery ≤ 6 %/h (SP-01 harness only).
- Threat model T3-01..T3-34 incl. quote tamper, zone bypass, cost amplification, scraping, cache poisoning, licence violation, malicious links, wrong-mode navigation, SDK telemetry, insider rate-card/switch abuse, log leakage.
- Test strategy: 20 families with PR/nightly/release/device tiers and per-ID acceptance evidence for all 29 IDs; CI never closes SP-01/SP-02/SP-04.
- Sequence: one run, checkpoints P3.0 (F-P3-01 fix, oasdiff) → P3.1 catalog → P3.2 geo + harness → P3.3 pricing → P3.4 release controls → P3.5 mobile shell + text-first rider flow → P3.6 SP-02 R1 + SP-01 → P3.7 SP-04 freeze + renderer → P3.8 driver shell → P3.9 l10n/a11y → P3.10 SP-08 + closure; missing external evidence ⇒ BLOCKED-EXTERNAL, never a guessed freeze.

### B.11 Founder and external actions
FA-01..FA-19 in `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` with decisions and exact steps: devices (borrow first; Samsung A-class, Redmi HyperOS, Infinix/Tecno or Vivo; SP-01 ≈ 15–17 h active, SP-02 ≈ 7.5–9 h), SP-04 drives (passenger operates the phone), evaluation accounts with hard quotas and local-only keys (no paid tier without approval), native Urdu/Roman-Urdu review after P3.9 strings exist, iPhone before serious iOS validation (Phase 7 unless earlier), HTTPS synthetic endpoint (approved in principle, FA-17), FCM deferred to Phase 4 (FA-18), Maestro cadence (FA-16), Mapbox commercial-licence confirmation (FA-19).

### B.12 Genuine founder decisions
All recorded at review closure (`docs/phase3/PHASE3_PLAN.md` §9): FA-01 approved (subject to this correction merging); FA-02 approved (COARSE + FINE, just in time, no background); FA-07 approved as pre-measurement values + route-critical gate; FA-10 dedicated roles approved; FA-11, FA-12, FA-16 approved/decided; FA-17 approved in principle; FA-18 deferred; FA-08 no paid spend pre-approved. Open: FA-03/04/05/06 (evidence), FA-09 (native review), FA-19 (Mapbox licence).

### B.13 Validation
| Check | Result |
|---|---|
| `node docs/phase0/tools/regen-manifest.js` (regenerate) | PASS — manifest rewritten, summary PASS |
| `pnpm docs:check` (`phase0-coverage.js --check` + `regen-manifest.js --check`) | PASS — 532 IDs consistent; manifest current, 0 problems |
| `pnpm format:check` | PASS |
| `git diff --check` | PASS |
| gitleaks `protect --staged` | recorded in the final handoff message |
| Backticked-path existence (docs-check regex) | PASS (enforced by `regen-manifest.js --check`) |
| Scope | only `docs/`, `README.md`, `ALL_FILES_INDEX.md`, `V5_FILE_MANIFEST.json` changed; nothing under `apps/`, `packages/`, `infra/`, `scripts/`, `tests/`, `.github/`, migrations, lockfile or package manifests |
| Planning-branch CI | NOT RUN — `docs/**` branches have no push trigger and no PR is opened for the plan (founder/ChatGPT review first) |

### B.14 Confirmation
No Phase 3 product code, migration, dependency, provider account, credential or freeze was created. The planning branch changes only documentation and the generated manifest.

### B.15 Recommendation
**PASS** for founder/ChatGPT plan review: `main` is green again on all five required checks with cache-miss and cache-hit evidence; the plan covers all 29 IDs with no premature freeze. Phase 3 implementation must not start until the plan is reviewed and the founder sends the implementation prompt; SP-01, SP-02 and SP-04 evidence (FA-03..FA-06, FA-17) should start in parallel as soon as P3.2 lands.

## C. Plan-review closure (2026-10-12)
Review verdict on `dfb3e41`: TARGETED FIX BEFORE PASS. Applied in a separate commit on `docs/phase-3-planning`: Mapbox Search Box session/request pricing correction; Mapbox Commercial Application License gate (FA-19); Google PAYG + subscription model; SP-04 route-critical hard gate (SP-04 §7.1, gate G4); founder decisions FA-01..FA-19 recorded; one-run evidence semantics (no routine approvals; Phase 3 not declared complete without SP-01/SP-02/SP-04/native-review evidence); F-P3-01 P3.0 rule (dev-only `exp+<slug>` scheme via `addGeneratedScheme`, release AAB scheme check in CI). Summary and list: `docs/phase3/PHASE3_PLAN.md` §11. The corrected sections of §B above supersede the reviewed figures.
