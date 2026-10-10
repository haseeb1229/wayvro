# PHASE2_IMPLEMENTATION_RECORD — Full Phase 2 implementation (P2.1 review fixes, P2.2 – P2.10)

**Branch:** `phase-2/identity-controlled-onboarding` from P2.1 `2666c8ba8627831dd2b40b2a7fa1b18aef65d809` (protected `main` = `8c8e528bf2a975f2fe385fd49ed9de78f29ed530`, unchanged). · **Authorisation:** founder authorised the whole Phase 2 engineering implementation in one run (2026-10-11); micro-phases P2.1–P2.10 are internal checkpoints. · **Status:** IN PROGRESS — one living record, updated at every checkpoint; **not merged, no PR**. · **Agent:** Claude Code (self-audit, not independent verification). · Synthetic data only; external gates EG-01..EG-23 remain open unless stated otherwise with evidence.

The P2.1 record (`PHASE2_P2_1_IMPLEMENTATION_RECORD.md`) remains the record for P2.1; its §3a lists the review corrections.

## Checkpoint log

| Checkpoint | Commit | Summary |
|---|---|---|
| P2.1-fix | `9cfbc55` | RB-01 per-claim job lease tokens; RB-02 ledger-derived lookup plans + PostgreSQL advisory locks; DH-01/DH-02 deployment hardening (ADR-038, ADR-042) |
| P2.2 | (this commit) | policy registry, consent, age-eligibility mechanism, legal pages, Playwright + axe |

## P2.2 — Policy versions, consent, age eligibility and public legal pages

**IDs:** A04, R09, W05, K14 (consent infrastructure), A15 (mechanism). **ADR:** ADR-044.

| Area | Implementation |
|---|---|
| Content | `packages/legal-content`: 7 policies × `en`/`ur`, version 1 each, `PLACEHOLDER_NOT_FOR_PRODUCTION`, effective 2026-10-10T00:00Z; hash lock; `requiredFor` = TERMS/PRIVACY → `ACCOUNT`, DRIVER_PARTNER_AGREEMENT/BIOMETRIC_KYC_NOTICE → `DRIVER_APPLICATION` |
| Migration | `0002_policy_consent_age`: schema `legal`; `legal.policy_documents` (immutable), `legal.age_eligibility_policies` (retire-only; placeholder v1 seeded, no threshold, teen programme CHECK-disabled), `identity.consent_records` + `identity.age_declarations` (append-only; composite FKs bind hash and mode); generic `platform.append_only()` trigger function |
| API | `GET /v1/legal/policies?locale=`, `GET /v1/legal/policies/{policyKey}/versions/{version}`, `GET /v1/legal/age-eligibility-policy` (public); `GET/POST /v1/account/consents`, `POST /v1/account/age-declarations` (session, idempotent, audited `CONSENT_RECORDED` / `AGE_DECLARATION_RECORDED`). New error code `WAYVRO_E_CONFLICT` (409: stale version or hash mismatch; age declaration twice) |
| Required actions | computed on server time at sign-in and in account state: `ACCEPT_POLICIES` (never accepted, withdrawn/declined, or a MATERIAL change since the accepted version) and `AGE_DECLARATION` (mode ≠ NONE and no declaration for the current version) |
| Boot | registry registered + verified (drift ⇒ refuse); `WAYVRO_ENV=production` refuses placeholder texts and a placeholder age policy |
| Web | `apps/web-public`: `/legal`, `/legal/<slug>`, `/legal/<slug>/v<N>`, `/legal/changelog`, `?lang=ur` (RTL), placeholder banner + `noindex`, content fingerprint, nonce CSP |
| Hardening | ESLint + dependency-cruiser now classify `@wayvro/field-crypto` and `@wayvro/identity-core` as server-only (clients could previously import them); `@wayvro/legal-content` is a pure package |

**Evidence:** `packages/legal-content/src/index.test.ts` (6); `packages/db/test/policy-consent-age.integration.test.ts` (7) + generic lifecycle tests for every migration prefix; `apps/api/test/legal.integration.test.ts` (11: API-CONSENT, API-AGE server part, registry immutability), `apps/api/test/policy-registry.test.ts` (3, BOOT-NEG placeholders); `tests/e2e-web/web-public/legal.spec.ts` (11, Playwright + axe WCAG 2.1 A/AA: no serious/critical violations).

**Requirement status after P2.2** (whole-requirement view; final classification in the handoff):
- A04 — consent/versioning/time engineering done; mobile consent UI P2.3; counsel texts EG-02 ⇒ PARTIAL_EXTERNAL_GATED.
- R09 — separate versioned policies, change log, re-consent on material change done; counsel texts EG-02 ⇒ PARTIAL_EXTERNAL_GATED.
- W05 — canonical dated versioned pages + change log + placeholder banner done; domain/store links EG-15/EG-18, counsel texts EG-02 ⇒ PARTIAL_EXTERNAL_GATED.
- K14 — consent infrastructure done; applicant explanations/dispute/correction UI in P2.8 ⇒ PARTIAL (in progress).
- A15 — policy versions, declaration modes, DOB only when required, production refusal done; driver age evaluation + `AGE_POLICY` restriction P2.5; reviewer DOB check P2.7; thresholds EG-23 ⇒ PARTIAL (in progress).

**Residual / notes:** placeholder Urdu pending native review; Roman-Urdu readers get English pages; an under-age declaration (DOB below an approved minimum, or "I do not meet the minimum") is handled with the restriction model in P2.5 — until then only `affirmed: true` is accepted in affirmation mode.
