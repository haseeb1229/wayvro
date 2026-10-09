# 15 — Risk Register and Failure Scenarios

Use `RSK-*` identifiers so risk IDs cannot be confused with requirement IDs such as `R01`/`V01`.

| ID | Risk | Probability / impact | Mitigation and gate |
|---|---|---|---|
| RSK-001 | Too few drivers to meet demand | High / severe | Micro-zone launch; measure supply before ad spend; honest no-driver fallback |
| RSK-002 | Driver/vehicle documents invalid or expire | Medium / severe | Reverification, dispatch-time eligibility and audit; fail closed |
| RSK-003 | Assault/harassment/accident/medical incident | Uncertain / critical | Human response, insurance/legal readiness, incident/SOS drills; no false guarantees |
| RSK-004 | PSP/cash accounting leakage | High / severe | Double-entry ledger, provider reconciliation, maker-checker and fraud controls |
| RSK-005 | Rider/driver double-assignment race | Medium / severe | DB invariants, leases/versioning and concurrency tests |
| RSK-006 | Tracking stale/disconnected/spoofed | High / high | Freshness UI, OS/device tests, resync and safety fallback |
| RSK-007 | Maps/navigation inaccurate in Lahore | Medium / high | Field benchmark, pin correction and provider abstraction |
| RSK-008 | Pooling causes excessive detour, disclosure or unsafe co-riders | Medium / critical | Pool-specific consent, detour/seat caps, privacy and safety gates |
| RSK-009 | Women-focused supply unavailable or eligibility/matching wrong | High / critical | Fail closed; supply threshold; privacy-reviewed eligibility; human escalation |
| RSK-010 | Free hosting sleeps/limits change | High / high | Production-capable hosting, quotas/alerts and paid migration path |
| RSK-011 | OTP pumping/bot account farms | High / medium | Multi-dimensional rate limits, vendor budget alarms, device/risk controls |
| RSK-012 | CNIC/selfie/location data leak | Medium / critical | Segregated evidence vault, least privilege, encryption, retention and external review |
| RSK-013 | Fake selfie/replay/deepfake or biometric false match/exclusion | High / critical | Liveness/spoof testing, calibrated signal, manual fallback, appeals and privacy review |
| RSK-014 | OIDC/account-link hijack, SIM recycle or recovery abuse | High / high | Phone ownership proof, secure account linking, step-up recovery, audit and cooldowns |
| RSK-015 | Transport/permit/legal rules differ by city/province | High / critical | Current written regulatory matrix and qualified counsel before activation |
| RSK-016 | Discount/incentive warfare makes rides unprofitable | High / high | Contribution-margin/cohort guardrails and capped experiments |
| RSK-017 | Driver fees/deductions perceived or implemented unfairly | High / high | Transparent statements, reason codes, appeals and policy testing |
| RSK-018 | Maps/matrix/OTP/KYC/realtime provider cost spikes | High / medium | Per-ride budgets, caching/optimization, quotas, alerts and provider exit plan |
| RSK-019 | Release breaks an active trip or supported old app | Medium / severe | Backward compatibility, staged rollout, feature flags and active-trip-safe rollback/forward fix |
| RSK-020 | Staff privileges abused | Medium / critical | Least privilege, MFA/reauth, immutable audit, maker-checker and break-glass review |
| RSK-021 | Proprietary brand/design/code copying or IP claim | Medium / high | Original design/code, licensing inventory and trademark/domain review |
| RSK-022 | Marketing/investor claims exceed evidence | High / medium | Evidence-based claims, approved metrics and documented limitations |
| RSK-023 | Human support/safety capacity insufficient while trips are live | High / critical | Staffing and escalation coverage are launch gates; reduce/suspend service when unavailable |
| RSK-024 | AI-generated code creates hidden state/security bugs | High / high | Bounded changes, strong tests, ChatGPT repo review when accessible and qualified external reviews for launch-sensitive systems |
| RSK-025 | App store rejects background location/KYC/privacy behavior | Medium / high | Early policy spike, accurate declarations, just-in-time permissions and review package |
| RSK-026 | Traffic/weather/fuel shocks distort prices/ETA/driver economics | High / medium | Versioned pricing, monitoring, caps and transparent rider/driver communication |
| RSK-027 | Chargebacks/refunds/pool changes cause double payment | Medium / severe | Idempotent payment orchestration, ledger reversals and reconciliation runbooks |
| RSK-028 | Unified app leaks role-specific data/authorization between Rider and Driver modes | Medium / critical | Server capability checks, role-scoped data queries, negative IDOR tests and V02/V07 controls |
| RSK-029 | Driver background services drain battery or invade Rider-only privacy | Medium / high | Just-in-time permissions, dormant driver services outside justified states, device/battery profiling and V05/V06/V11 controls |
| RSK-030 | One mobile release has larger blast radius across riders and drivers | Medium / severe | Cross-mode regression, staged rollout, mode-scoped kill switches, telemetry segmentation and V10/V12 controls |
| RSK-031 | Mode switch lets account escape an active obligation/conflict | Medium / severe | Server state machine, active-trip conflict rules and crash/reinstall/device-change tests under V04 |
| RSK-032 | Single app becomes bloated/slow on low-end Android | Medium / high | Modular initialization, dependency discipline, startup/memory/binary budgets and low-end device benchmarks |
| RSK-033 | Punjab Section 44B per-district/per-platform permits shrink driver supply or create illegal-trip exposure (Phase 0) | High / severe | R46 permit artefacts with expiry; district-coverage dispatch check; counsel confirmation; pilot zone within one district |
| RSK-034 | TNC licence conditions unknown (19-Feb-2026 safety protocols unread) force late redesign (Phase 0) | High / high | Counsel reads protocols before Phase 2 design freeze; configurable compliance artefacts |
| RSK-035 | OEM battery savers/kills (Xiaomi, Transsion, Vivo) cause missed offers and stale tracking (Phase 0) | High / high | M26 offer alerting with socket/poll fallback; V06 FGS; SP-01 device spike; ADR-029 SDK choice |
| RSK-036 | Fake/cloned apps and pre-payment scams damage trust (Phase 0) | Medium / high | W04 official channels, Q49 store-only distribution, in-app verify-ride, messaging keyword controls |
| RSK-037 | Personal Data Protection Bill enacted with localisation/breach duties mid-build (Phase 0) | Medium / high | Build to draft; localisation migration path (CL-13); T25 legal watch |
| RSK-038 | Telecom/internet shutdowns halt app-only operations (Phase 0) | Medium / high | S26 continuity: call-centre booking, SMS hierarchy, offline-tolerant trip completion |
| RSK-039 | Card fixed fees make small digital trips uneconomic (Phase 0) | High / medium | Raast/wallet-first rails, no-fixed-fee MDR negotiation, cards deferred (ADR-022) |
| RSK-040 | Store policy deadlines (16 KB pages, fine-location declaration, target SDK) block releases (Phase 0) | Medium / high | U16 dated watch (CL-16); Q49 build checks; declaration videos prepared early |

## Risk owner workflow
Every risk gets an owner, trigger, monitor, countermeasure, go/no-go gate, current status and last-reviewed date during Phase 0. Critical launch risks must map to requirements/tests and cannot be marked closed from prose alone.

At minimum, RSK-001/002/003/004/005/006/007/009/010/012/013/015/019/020/023/025/028/029/030/031/033/034/035/036 require explicit review before a controlled real-ride pilot or relevant feature activation. Risk IDs now run RSK-001..RSK-040 (RSK-033..040 added in Phase 0, 2026-10-09; see `docs/phase0/PHASE0_GAP_REPORT.md` §8).
