# ADR-050 — Phase 3 performance budgets

| Field | Value |
|---|---|
| Status | **ACCEPTED for the budget values (FA-07, approved pre-measurement 2026-10-12); PARTIAL for evidence** — only the CI-measurable budgets are measured; every device and staging budget is NOT MEASURED |
| Date | 2026-10-13 |
| Supersedes | `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-050 (proposal) |
| Requirements | Q26, Q27, V11; CON-P3-05 |
| Budget source | `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` (PB-01 … PB-24, PT-01 … PT-04) |
| Enforcement | `infra/ci/android/check-size.mjs` (SIZE gate, Android CI job, with a `--self-test` negative control); dependency-cruiser + architecture tests (no static import of `features/driver` from the rider graph or any layout); E2E-build module-evaluation probe (ADR-052) |

## Context
Wayvro ships one app to riders and Driver/Partners (CLAUDE.md §2, §9). Rider users on 3–4 GB Transsion-class Android phones must not pay for driver-only code, and the 30 MB download budget had about 4.3 MB of headroom at the end of Phase 2 (F-P3-06). The budget values were fixed by the founder before any measurement (FA-07), so a result cannot move a threshold.

## Decision
1. The budgets in `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md` §3 are binding. They change only with founder approval and an update to this ADR.
2. A budget is reported PASS only when it was measured in its own environment (REF-DEV, SP01-DEV, STAGING-CLASS or CI, as the table says). An emulator or a laptop number is labelled indicative and never closes a device budget.
3. CI enforces what CI can measure on every Android run: PB-04 (download size per ABI, bundletool `get-size total`, MAX) and PB-05 (Hermes bundle). A change of more than +1.5 MB needs a written justification.
4. PB-06 (0 Driver/Partner modules evaluated before Rider home is interactive) is enforced statically in CI (lazy `/drive` routes, layouts free of `features/driver`, depcruise) and measured by the instrumented E2E build on an emulator. The device measurement remains SP-02.

## Measured (closure, release AAB of `4347289`, CI run 38439820550, Android job)

| ID | Metric | Budget | Phase 2 baseline (ADR-043 P2.8) | Measured | Status |
|---|---|---|---|---|---|
| PB-04 | Download size arm64-v8a (get-size MAX) | ≤ 30,000,000 B | 25,651,727 B | **26,131,920 B** (+480,193 B) | **PASS (CI)** |
| PB-04 | Download size armeabi-v7a (get-size MAX) | ≤ 29,000,000 B | 24,909,619 B | **25,388,836 B** (+479,217 B) | **PASS (CI)** |
| PB-05 | Hermes JS bundle | ≤ 4,500,000 B | 3,321,764 B | **3,687,008 B** | **PASS (CI)** |
| PB-06 | Driver modules evaluated before Rider home | 0 | — | 0 on an API 35 emulator (instrumented E2E build, local run, ADR-052) | static rule PASS (CI); emulator proxy only; **device NOT MEASURED** |
| PB-01 … PB-03, PB-07 … PB-14, PB-12a–c | cold/warm start, memory, jank, pin-to-address, data per flow, tile cache | see budget doc | none | — | **NOT MEASURED** — no reference device (FA-04, SP-02) |
| PB-15 … PB-17 | battery, reconnect, location completeness (driver background) | see budget doc | — | — | **NOT MEASURED** — SP-01 (FA-03) |
| PB-20 … PB-24 | server p95/p99 (quotes, autocomplete, reverse geocode, app config) | see budget doc | — | — | **NOT MEASURED** — no staging-class environment exists |
| PT-01 … PT-04 | provider timeouts and retries | see budget doc | — | implemented in the geo gateway and quote service; covered by fault-injection tests | configuration implemented (tests PASS); provider latency NOT MEASURED |

The +0.48 MB for Phase 3 comes from expo-location, the Phase-3 screens and strings, and the first-party `wayvro-fully-drawn` module. No map renderer is installed: the renderer's size delta, which must stay inside the remaining ≈ 3.87 MB of arm64-v8a headroom, is measured at the P3.7 freeze (BLOCKED-EXTERNAL).

## Current evidence (2026-10-27) — budget values unchanged
- **CI size gate on the final code `af5d8e2`** (Android job, push run 39045490954, `SIZE CHECK: PASS`; self-test 7 cases PASS): arm64-v8a download MAX **26,134,975 B** (+483,248 B vs baseline), armeabi-v7a **25,391,891 B** (+482,272 B), Hermes bundle **3,688,896 B** — PB-04/PB-05 **PASS (CI)**. The gate also ran green on the documentation head `09b7672` (push run 39063226015, PR run 39063230948).
- **SP-02 emulator supplement** (`docs/phase3/evidence/laptop/SP02_LOW_RAM_AVD_SUPPLEMENT.md`, 2 GB API-35 AVD, release-mode Hermes E2E APK): `LOCAL_EMULATOR_SUPPLEMENTARY`. Indicative only (Decision 2): it closes no PB-01 … PB-14 device budget and reports none as PASS. PB-06 was 0 driver modules before fully drawn in 40/40 samples, still an emulator proxy.
- **SP02-F1 correction** (`docs/phase3/PHASE3_IMPLEMENTATION_RECORD.md`, targeted correction §2): the signed-in cold start sent a request that could only answer 401 when the access token had expired. The app now refreshes first (0 of 9 samples with a 401 afterwards, against 9 of 9 before). The remaining startup time is classified REAL_DEVICE_REQUIRED (FA-04).
- **Still NOT MEASURED:** every device budget (SP-02 / FA-04, SP-01 / FA-03), every staging budget (no staging-class host) and provider latency. The ADR status stays PARTIAL for evidence.

## Consequences
- The size gate fails the Android job on any regression past the budget; the negative control proves it can fail.
- Q26/Q27/V11 cannot be closed by CI. Their device and staging lines stay open until SP-02 (FA-04), SP-01 (FA-03) and a staging-class host exist.

## Reversal
The budget values change only with a founder decision recorded here. The gates are scripts in `infra/ci/android/` and can be adjusted without app changes.
