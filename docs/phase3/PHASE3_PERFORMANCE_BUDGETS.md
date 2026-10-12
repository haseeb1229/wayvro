# PHASE3_PERFORMANCE_BUDGETS — Phase-3 mobile, server, data and provider performance budgets (PROPOSED)
**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — pending founder/ChatGPT review; no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

**No budget in this file has a PASS.** Every budget is **PROPOSED** (approval: FA-07; record: the future ADR-050 file) and **NOT MEASURED**. Release startup time and memory have never been measured on any device (ADR-043 "Not verified"); SP-01 and SP-02 are **NOT RUN** (`docs/phase0/PHASE0_ADR_BACKLOG.md` §E). The only existing numbers are build-time sizes from ADR-043, quoted as baselines below.

Requirement IDs: **Q26** (performance budgets incl. cold/warm start, map interaction, data, battery, API p95/p99, realtime reconnect), **Q27** (low-end devices and constrained memory/storage/network as first-class QA targets), **V11** (startup, memory, battery, size budgets; driver modules dormant for riders), **L08** (Lite mode for weak networks).

## 1. Principles
1. Budgets are fixed **before** measurement and never tuned to fit results. Changing a budget needs founder approval and an ADR-050 update (§8).
2. Device budgets are decided **only** on the reference device with the release artefact; emulators and flagships are comparison data.
3. A budget without a measurement is reported **NOT RUN** (or **BLOCKED** when the device/endpoint is missing), never PASS.
4. CI enforces what can be enforced deterministically (size, bundle size, static import isolation, instrumented module counts on an emulator); everything timing-related on a phone is device-only.
5. 1 MB = 1,000,000 bytes (ADR-043 convention). Percentiles use nearest rank; with 5 kept runs p90 equals the maximum (stated in `docs/phase3/PHASE3_SP02_LOW_END_PERFORMANCE_PROTOCOL.md` §11).

## 2. Reference environments
| Env | Definition |
|---|---|
| **REF-DEV** | Transsion-class Android Go phone, 3–4 GB RAM (Infinix Smart 10 or Tecno Spark 30C class; FA-04); release AAB installed with bundletool `--connected-device`; 5 kept runs (first of 6 discarded); median / p90 |
| N2 | 3G-like downlink ≈ 1 Mbps (SP-02 §9) — the startup budget condition |
| N1 | real 4G (SIM) |
| SP01-DEV | the SP-01 OEM-class devices, spike harness, 60-min screen-off |
| LOCAL | founder laptop, Docker local stack (ADR-037), synthetic provider doubles with injected latency — **indicative only** |
| STAGING-CLASS | a staging host comparable to the pilot deployment — **does not exist yet**; server budgets PASS only here |
| CI | GitHub Actions `android` job (Linux, Temurin 17; ~30–40 min per run, 75-min timeout; private repository, so Actions minutes are finite — FA-16) and the proposed SP-08 emulator scheduled matrix (cadence per FA-16) |

## 3. Budget table
Columns: **Source** = where the number comes from; **Baseline** = existing measured value (if any); **When** = Phase-3 checkpoint that first measures it; **Enforcement** = CI / DEVICE-ONLY / STAGING-ONLY.

### 3.1 Mobile client (Rider mode on REF-DEV)
| ID | Metric | Budget | Env | Method | Source / rationale | Baseline | Status | When | Enforcement |
|---|---|---|---|---|---|---|---|---|---|
| PB-01 | Cold start → Rider home interactive (signed in, cached session) | p50 ≤ 2.5 s, p90 ≤ 4.0 s | REF-DEV, N2 | `am start -W` + `reportFullyDrawn()` marker (SP-02 M-01) | backlog SP-02 TTI; R4 item 5 | none | PROPOSED · NOT MEASURED | P3.6 (R1b), P3.7 (R2) | DEVICE-ONLY |
| PB-02 | Cold start → sign-in screen (signed out) | p50 ≤ 2.0 s | REF-DEV | SP-02 M-01 | stricter than PB-01: no account fetch needed | none | PROPOSED · NOT MEASURED | P3.6 | DEVICE-ONLY |
| PB-03 | Warm start | p50 ≤ 1.0 s, p90 ≤ 1.5 s | REF-DEV | SP-02 M-02 (`LaunchState` HOT/WARM recorded) | Q26 | none | PROPOSED · NOT MEASURED | P3.6 | DEVICE-ONLY |
| PB-04 | Play download size per ABI (bundletool `get-size total --dimensions=ABI`, MAX) | arm64-v8a ≤ 30.0 MB (hard); armeabi-v7a ≤ 29.0 MB; any single change > +1.5 MB needs written justification | laptop / CI | SP-02 M-05 | R4 item 5 "≤30 MB"; CON-P3-05 | arm64-v8a 25,651,727 B; armeabi-v7a 24,909,619 B (ADR-043 P2.8 MAX) | PROPOSED · baseline measured, budget not yet evaluated | P3.0 (CI guard), every PR | **CI** |
| PB-05 | Hermes JS bundle | ≤ 4.5 MB | laptop / CI | SP-02 M-06 | headroom for Phase-3 screens and strings | 3,321,764 B (ADR-043 P2.8) | PROPOSED · baseline measured | P3.0 (CI guard), every PR | **CI** |
| PB-06 | Driver feature modules evaluated before Rider home interactive | 0 | CI emulator + REF-DEV | static import rule + instrumented build counter (SP-02 §6.2) | V11; F-P3-07 (evaluation, not download) | not measured (static `lazyScreen(` rule exists in `apps/wayvro-mobile/src/architecture.test.ts`) | PROPOSED · NOT MEASURED | P3.5 (static), P3.10 (nightly) | **CI** (static + emulator nightly) + DEVICE once per round |
| PB-07 | PSS, Rider home without map | ≤ 160 MB p90 | REF-DEV | `dumpsys meminfo` TOTAL PSS (SP-02 M-04) | 3–4 GB devices with Android Go memory limits | none | PROPOSED · NOT MEASURED | P3.6 | DEVICE-ONLY |
| PB-08 | PSS, Rider route preview with map | ≤ 260 MB p90 | REF-DEV | SP-02 M-04 | renderer cost bounded (ADR-046 input) | none | PROPOSED · NOT MEASURED | P3.7 | DEVICE-ONLY |
| PB-09 | Memory growth over 10 quote cycles | ≤ 10 % | REF-DEV | SP-02 M-04 | leak guard | none | PROPOSED · NOT MEASURED | P3.6 / P3.7 | DEVICE-ONLY |
| PB-10 | Janky frames during scripted 10-s pan/zoom | ≤ 10 % | REF-DEV | `dumpsys gfxinfo` or Perfetto FrameTimeline (SP-02 M-08) | Q26 map interaction | none | PROPOSED · NOT MEASURED | P3.7 | DEVICE-ONLY |
| PB-11 | Pin move → address shown (600 ms debounce included) | p75 ≤ 1.5 s | REF-DEV, N1 | screen recording frame count (SP-02 M-09) | leaves ≈ 900 ms for reverse geocode round trip after debounce | none | PROPOSED · NOT MEASURED | P3.7 | DEVICE-ONLY |
| PB-14 | Rider home refresh behaviour | no periodic polling on Rider home; quote expiry countdown local (server-offset clock); no re-render per GPS sample | REF-DEV + code review | netstats idle diff + Perfetto (SP-02 M-12) | L08 "reduced map refresh" | none | PROPOSED · NOT MEASURED | P3.5 / P3.7 | DEVICE + review |

### 3.2 Data (L08, Q26)
| ID | Metric | Budget | Env | Method | Source / rationale | Baseline | Status | When | Enforcement |
|---|---|---|---|---|---|---|---|---|---|
| PB-12a | Data per standard quote flow, **Lite** (no tiles; `?detail=lite` omits polyline) | ≤ 150 KB | REF-DEV, N2 | per-uid netstats diff (SP-02 M-10) | L08 text-first; weak-network users | none | PROPOSED · NOT MEASURED | P3.6 | DEVICE + partial CI (§7 CG-05) |
| PB-12b | Standard flow, **cold** tile cache | ≤ 2.0 MB | REF-DEV, N1 | SP-02 M-10 | first map use on a fresh install | none | PROPOSED · NOT MEASURED | P3.7 | DEVICE-ONLY |
| PB-12c | Standard flow, **warm** tile cache | ≤ 600 KB | REF-DEV, N1 | SP-02 M-10 | repeat use | none | PROPOSED · NOT MEASURED | P3.7 | DEVICE-ONLY |
| PB-13 | On-device map tile cache | capped at 50 MB | REF-DEV + config review | SP-02 M-11 | storage-constrained devices (Q27) | none | PROPOSED · NOT MEASURED | P3.7 | config review + DEVICE |

"Standard quote flow" = open → where-to → 2 searches (about 8 keystroke requests, debounced 300 ms, minimum 3 characters) → quote.

### 3.3 Driver background (measured in the SP-01 harness only; nothing ships in Phase 3)
| ID | Metric | Budget | Env | Method | Source / rationale | Status | When | Enforcement |
|---|---|---|---|---|---|---|---|---|
| PB-15 | Battery, screen-off, online, location FGS | ≤ 6 %/h (record actual) | SP01-DEV | battery level delta + batterystats (SP-01 TC-03/TC-04) | R4 item 2 | PROPOSED · NOT MEASURED | P3.6 | DEVICE-ONLY |
| PB-16 | Realtime reconnect to authoritative state | < 5 s p95 | SP01-DEV (harness, informational); STAGING-CLASS (Phase-4 gate) | SP-01 TC-06/TC-13; ADR-005b re-test | Phase-0 SLO (`docs/phase0/PHASE0_ARCHITECTURE_PROPOSAL.md` §9); ADR-005b | PROPOSED · NOT MEASURED (SP-05 laptop evidence: met up to 1,000-client herds, not at 2,000) | P3.6 (informational) / Phase 4 gate | DEVICE + STAGING |
| PB-17 | Location completeness while online | ≥ 95 % of expected points over 60 min, ≥ 3 OEM classes | SP01-DEV | SP-01 §12–§13 | backlog SP-01 | OPEN-SPIKE · NOT RUN | P3.6 | DEVICE-ONLY |

### 3.4 Server latency (end-to-end at the API, provider excluded where noted)
| ID | Endpoint / path | Budget | Env for PASS | Phase-3 method | Source / rationale | Status | Enforcement |
|---|---|---|---|---|---|---|---|
| PB-20 | `POST /v1/quotes`, route-cache **miss** (incl. provider), successful quotes with a single routing attempt | p95 ≤ 800 ms, p99 ≤ 1,500 ms; refusals at the timeout/overall deadline counted separately: ≤ 1 % of quote requests per window (PROPOSED) | STAGING-CLASS | LOCAL indicative: synthetic routing double with latency injected from the SP-04 harness's measured provider distribution; SP-04 harness provider latencies from Lahore | Phase-0 SLO "Quote p95 < 800 ms" | PROPOSED · NOT MEASURED | STAGING-ONLY (local indicative report) |
| PB-21 | `POST /v1/quotes`, route-cache **hit** | p95 ≤ 250 ms | STAGING-CLASS | LOCAL indicative | server work only: zone checks, pricing, one transaction | PROPOSED · NOT MEASURED | STAGING-ONLY |
| PB-22 | autocomplete | p95 ≤ 450 ms | STAGING-CLASS | LOCAL indicative + SP-04 provider latency | typing feel with 300 ms debounce | PROPOSED · NOT MEASURED | STAGING-ONLY |
| PB-23 | reverse geocode | p95 ≤ 500 ms | STAGING-CLASS | as PB-22 | feeds PB-11 | PROPOSED · NOT MEASURED | STAGING-ONLY |
| PB-24 | `GET /v1/app/config` | p95 ≤ 100 ms | STAGING-CLASS | LOCAL indicative | on every cold start; cacheable | PROPOSED · NOT MEASURED | STAGING-ONLY |

Forward geocode has a provider timeout (PT-02) but **no latency budget** in this set; it is not on the interactive critical path in the Phase-3 flow (autocomplete selection resolves through the place reference). Adding one is a FA-07 option.

### 3.5 Provider timeouts and retries (configuration, enforced in the geo gateway)
| ID | Provider call | Timeout | Retry | Notes |
|---|---|---|---|---|
| PT-01 | autocomplete | 1.5 s | max 1 retry, **connect error only**, and only if the remaining request deadline (timeout + 500 ms) ≥ 1.5 s | degrade to "type full address / drop pin" on timeout, budget exhaustion or open circuit |
| PT-02 | forward geocode / place resolve | 2.0 s | as PT-01 (deadline 2.5 s) | — |
| PT-03 | reverse geocode | 2.0 s | as PT-01 (deadline 2.5 s) | stale-serve allowed only per the ADR-047 cache rules |
| PT-04 | directions (routing) | min(2.5 s, remaining quote deadline) | **none** — single attempt inside the overall `POST /v1/quotes` deadline of 3.0 s | timeout/deadline/open circuit ⇒ quote refused 503 `ROUTING_UNAVAILABLE`, never invented values |

Consistency rule (ADR-047, all values PROPOSED): `POST /v1/quotes` has an overall server-side deadline of 3.0 s (`QUOTE_DEADLINE_MS`); its routing call is a single attempt and is never retried, so no retry can stack on the 2.5 s routing timeout. Geo reads allow one connect-error retry only while the remaining deadline (SKU timeout + 500 ms) is at least the SKU timeout. PB-20's p99 ≤ 1.5 s is measured over successful cache-miss quotes with that single attempt; slow providers show up as timeouts/deadline refusals in the separate ≤ 1 % refusal budget, never hidden in the percentile (`docs/phase3/PHASE3_ARCHITECTURE.md` §5.4a). The mobile client's existing 15 s timeout and bounded retries stay unchanged.

Rate limits and cost budgets are not performance budgets; they are in `docs/phase3/PHASE3_SECURITY_COST_THREAT_MODEL.md` and `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md`.

### 3.6 Deliberately not budgeted in Phase 3
| Item | Why | Where it belongs |
|---|---|---|
| Dispatch assignment latency (Q26) | no dispatch in Phase 3 | Phase 4 |
| Trip transition API p95 < 500 ms | no trip aggregate in Phase 3 | Phase-0 SLO; Phase 4/5 |
| Driver location freshness ≤ 10 s on trip | no trips; SP-01 measures delivery latency as input | Phase 4/5 |
| Crash-free sessions ≥ 99.5 % | no crash reporting SDK (none approved) | Phase 7 decision |
| KYC capture time/size/memory (R4 item 9) | Phase-2 capture device debt | Phase-2 debt record |
| iOS startup/memory | no iOS build environment approved (ADR-036); FA-13 | Phase 7 |

## 4. Size headroom analysis (F-P3-06)
| | arm64-v8a | armeabi-v7a | JS bundle |
|---|---|---|---|
| Current (ADR-043 P2.8, get-size MAX) | 25,651,727 B | 24,909,619 B | 3,321,764 B |
| Budget | 30,000,000 B | 29,000,000 B | 4,500,000 B |
| **Headroom** | **4,348,273 B (≈ 4.35 MB)** | **4,090,381 B (≈ 4.09 MB)** | **1,178,236 B (≈ 1.18 MB)** |

The armeabi-v7a headroom is the smaller one, so a native library added to both ABIs is bounded by about 4.09 MB unless the 32-bit budget changes (Q49 keeps armeabi-v7a while coverage justifies it).

Expected Phase-3 additions — **all to measure**, no estimates are claimed:
| Addition | Checkpoint | Size |
|---|---|---|
| `expo-location` (foreground only; FA-02) incl. its Android dependencies | P3.5 | to measure |
| Fully-drawn marker local module (SP-02 §6.1) | P3.5 | to measure (expected tiny) |
| New JS: rider graph, mode controller, intent router, Lite mode, version policy, strings en/ur/ur-Latn | P3.5–P3.9 | to measure (counts against both PB-05 and PB-04) |
| Urdu-script font, only if system fonts prove insufficient | P3.9 | to measure; system fonts are evaluated first |
| **Map renderer** (one of `@maplibre/maplibre-react-native`, `react-native-maps`, `@rnmapbox/maps`) | P3.7 | **to measure per candidate** — the dominant uncertainty |
| Possible reclaim: excluding `expo-dev-client` from the release variant (F-P3-01 fix) | P3.0 | to measure (hypothesis only) |

Implications for the renderer choice (ADR-046):
- The renderer must fit inside the headroom **left after** the other Phase-3 additions are measured; P3.5 numbers therefore precede the renderer decision.
- Structural hypotheses to verify, not facts: a renderer that ships its own native map engine per ABI adds native-library weight to both splits; a renderer that delegates to a platform-provided map component may add little APK weight but couples rendering to that platform vendor (provider coupling is decided per SKU in ADR-006/ADR-046, not by size alone).
- If no candidate fits, the options are (in order): reduce other weight; Lite/text-first default with the map loaded on demand (size still counts — single bundle and AAB splits are per ABI, not per feature, F-P3-07); founder-approved budget change through ADR-050. Reanimated/gesture-handler stay excluded (F-P3-08) unless measured headroom remains after the renderer.

## 5. When each budget is measured
| Checkpoint | Budgets |
|---|---|
| P3.0 | CI guards for PB-04, PB-05 switched on against the ADR-043 baseline |
| P3.5 | PB-06 static rule; PB-14 review; size deltas of P3.5 additions |
| P3.6 | SP-02 R1a/R1b: PB-01, PB-02, PB-03, PB-06 runtime, PB-07, PB-09, PB-12a; SP-01: PB-15, PB-16 (informational), PB-17 |
| P3.7 | SP-02 R2 + renderer candidates: PB-04 re-check, PB-08, PB-10, PB-11, PB-12b/c, PB-13; LOCAL indicative PB-20…PB-24 with SP-04 latency data |
| P3.10 | full budget verification record; PB-06 nightly green; every budget reported PASS / FAIL / NOT RUN / BLOCKED |
| Phase 4 / later | PB-16 STAGING-CLASS gate (ADR-005b); PB-20…PB-24 on STAGING-CLASS once such a host exists |

## 6. Measurement prerequisites that can block budgets
| Prerequisite | Blocks | Owner |
|---|---|---|
| REF-DEV in hand (FA-04) | PB-01…PB-14 device budgets | Founder |
| SP-01 OEM devices (FA-03) | PB-15, PB-17 | Founder |
| HTTPS-reachable synthetic API for the release app (SP02-D1, founder action FA-17) | PB-01, PB-07, PB-09, PB-11, PB-12 (NOT RUN without it) | Founder decision (FA-17) |
| Map renderer chosen after SP-04 + size (P3.7) | PB-08, PB-10, PB-11, PB-12b/c, PB-13 | SP-04 data (FA-05) |
| STAGING-CLASS host | PASS for PB-16, PB-20…PB-24 | later phase |

## 7. Proposed CI guards
| ID | Guard | Where | Fails when | Notes |
|---|---|---|---|---|
| CG-01 | AAB download-size check: a proposed `infra/ci/android/check-size.mjs` gate, called from `scripts/android-build.mjs release` after the existing 16 KB and permission gates; runs `bundletool build-apks` + `get-size total --dimensions=ABI` | `android` job | arm64-v8a MAX > 30,000,000 B or armeabi-v7a MAX > 29,000,000 B; or growth vs the committed baseline > 1,500,000 B without a justification entry | baseline + justification log kept in a proposed committed JSON next to the allowlist; updating it is a reviewed change |
| CG-02 | JS bundle size check (same script, reads the Hermes bundle entry size in the AAB) | `android` job | > 4,500,000 B | |
| CG-03 | Static driver isolation: extend `apps/wayvro-mobile/src/architecture.test.ts` to the new `/drive/*` route directory (`drive/_layout.tsx` and route files) and mode controller; add a dependency-cruiser rule (no static path from the app root / rider graph to `src/features/driver/**`) | Quality job | any eager import path | existing `lazyScreen(` rule extended, not replaced |
| CG-04 | Runtime driver-module evaluation count on the emulator, instrumented build (never the release artefact) | SP-08 nightly (FA-16 runtime budget) | count > 0 before the fully-drawn marker | ART-ISO (`scripts/artifact-isolation.mjs`) extended to prove the release bundle has no instrumentation marker |
| CG-05 | Payload-size contract tests: Lite quote response omits the polyline; per-response ceilings derived in P3.3 from the 150 KB Lite flow budget | Integration job | response above ceiling or polyline present in Lite | partial guard for PB-12a; the device measurement remains authoritative |
| CG-06 | No CI latency gate | — | — | shared runners are too noisy; LOCAL indicative reports only, never PASS evidence |

All CI guards are additions; none weakens an existing gate. Docs-only branches (like this one) get no push CI.

## 8. Change control
- The budget set becomes effective when the founder approves FA-07; it is recorded in the future ADR-050 file (PROPOSED → ACCEPTED-ON-EVIDENCE only after the first REF-DEV measurement).
- Any change (looser or tighter) needs: the measured evidence motivating it, the affected budgets, the founder's approval, and an ADR-050 amendment in the same change. CI thresholds (CG-01/CG-02) change only together with that amendment.
- A breach found after acceptance is a FAIL that blocks the relevant release/freeze checkpoint; it is never resolved by editing the threshold silently.

## 9. Statement of status
As of 2026-10-12: SP-01 **NOT RUN**, SP-02 **NOT RUN**, no Phase-3 budget measured, **no budget PASS exists**. Build-time size baselines (PB-04, PB-05) come from ADR-043 and have not been evaluated against an approved budget. Server budgets cannot PASS before a STAGING-CLASS host exists.
