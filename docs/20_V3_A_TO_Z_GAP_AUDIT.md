# 20 — v3 A-to-Z Gap Audit: Why v2 Was Not Safe to Freeze

**Status:** HISTORICAL CONTEXT ONLY. This file explains omissions found in an earlier baseline. Current v5 founder decisions, `requirements-register.json`, root `CLAUDE.md`, and current canonical docs outrank this file if anything conflicts.
**Audit date:** 2026-10-09. **Scope:** user requirements, v2 package, current public competitor capabilities, Pakistan/Punjab operational realities, Minhaj-derived engineering controls.

## Finding
v2 was a useful baseline but was **not complete enough to freeze**. Some important capabilities were present only as umbrella prose, some were absent, and several Pakistan-specific operational requirements were not atomic/testable. Because Claude can implement exactly what the docs say, anything merely implied is treated as a gap. v3 converts these into explicit requirement IDs.

## Major gaps corrected in v3
1. **Marketplace/reputation:** explicit two-way ratings, rider reputation, detailed driver offer cards and deliberate driver choice in negotiated mode.
2. **Pakistan accessibility:** Low-data/Lite experience, browser booking, assisted phone booking and transactional fallback channels.
3. **Payments:** explicit cash controls; card tokenization; JazzCash/Easypaisa/Raast ADRs; preauth/capture, refunds, tips, waiting/toll/damage/no-show fees, driver dues and payout edge cases.
4. **Safety:** unified Safety Center, community guidelines, route anomaly/crash check-in, discreet reporting, recording/dashcam policy, evidence chain, no-rematch, background checks, breakdown and insurance-claim flows.
5. **Driver product:** destination mode, women-rider preference, next-ride queue, airport queue, heatmaps, wait timer, vehicle switching, document reminders, fatigue/hour controls and support-center workflows.
6. **Service details:** child seat, pet, XL, airport, insurance/takaful and explicit service-class eligibility instead of generic future-category prose.
7. **Mobile/platform quality:** device attestation/tamper risk, secure storage, SBOM/provenance, signing-key custody, staged releases, IaC, SLO/SLI, RPO/RTO, status/incident management, low-end Android/battery/data budgets.
8. **Regulatory operations:** TNC licensing, route permits, fitness, insurance, token tax, lawful regulator export and city-by-city approval encoded as activation blockers.
9. **Support/growth:** notification inbox, help CMS/agent knowledge base, omnichannel support, communication preferences, CRM/referrals/promos and experimentation boundaries.
10. **Engineering process:** current-repo authority, canonical-doc rule, no Docker destructive prune, no force-push/history rewrite, exact SHA/test evidence and Claude-only implementation with external human launch assurance.

## What this audit does NOT claim
A list can never prove that no future product idea, law, device behavior or abuse case exists. The correct engineering goal is **no known unexplained gap at freeze time**, plus a traceability system that makes newly discovered gaps visible and gated. At that stage Phase 0 had to challenge v3 rather than blindly accept it; the current Phase 0 must challenge v5.

## Freeze test
The product requirements may be frozen for Phase 1 only when every register ID has: disposition, priority, owner/domain, target phase, UX states, API/data/state impacts, security/privacy/financial implications, tests and any external release dependency. “Mentioned somewhere” is not coverage.
