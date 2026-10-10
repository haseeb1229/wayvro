# PHASE2_IMPLEMENTATION_SEQUENCE — Phase 2 micro-phases (PROPOSED)

**Date:** 2026-10-10 (planning closure correction applied the same day) · **Status:** Phase 2 PLAN ONLY. Micro-phases are bounded review units inside Phase 2, not new macro phases (roadmap stays Phase 0–12). Each runs on its own branch from the then-current `main` (proposed `phase-2/<n>-<slug>`), is reviewed by the founder/ChatGPT and merged by PR under the ruleset before the next starts, unless the founder authorises batching.

## 1. Ordering rationale
1. Identity core first — everything needs a principal, idempotency, limiter, audit, job runner, crypto envelope and the **production test-double isolation (F-01)**; each infrastructure piece arrives with its first real consumer.
2. Consent and age policy before onboarding — driver application requires versioned acceptance and the age-policy mechanism (A15).
3. Mobile account slice early — proves contracts end to end; introduces navigation/secure storage once.
4. Staff realm before compliance — requirement-set/age-policy maker-checker, restrictions and review need authorised staff; web-ops stops being unauthenticated before any ops screen exists.
5. Compliance domain before files; vault (starting with the image-processing evaluation) before review.
6. Mobile onboarding after the server path — CAMERA added once, with its first use.
7. Recovery/deletion late — they touch every earlier table.
8. OIDC last — P1, externally gated; it adds the OIDC-proof recovery path to the P2.9 machinery.

## 2. Micro-phases

**Common exit gate for every micro-phase:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm depcruise`, `pnpm knip`, `pnpm syncpack`, `pnpm flags:check`, `pnpm test`, `pnpm test:coverage`, `pnpm openapi:check`, `pnpm docs:check`, `pnpm test:integration`, `node scripts/boot-smoke.mjs`, migrations clean/previous/re-run, gitleaks + osv-scanner, the **artifact-isolation** step (from P2.1), and the Android release AAB with 16 KB/ABI and permission gates whenever `apps/wayvro-mobile` changes. Schema used by the same micro-phase; flags registered; docs/register evidence updated through generator sources; exact NOT RUN items reported. **Every dependency is re-checked when first installed** (stable release, advisories, licence, compatibility, publish age, lockfile impact, ADR-030); planning-time versions are not approvals.

### P2.1 — Consumer identity and session core + production test-double isolation
- **IDs:** A02, A03 (engineering), A05 (profile), A11 (sessions), K01, K08 (limits/outage), K09, Q06 (auth surfaces), Q36, Q39 (write path + seals), S12 (signals), V02, V07 (pattern), K13 (families for P2.1 routes); **F-01 fix**.
- **Builds:** `@wayvro/provider-test-doubles` (dev-only) — move recording/in-memory doubles out of `@wayvro/provider-interfaces`, delete `defaultProviderBindings()`; production composition roots bind only real adapters; local runner outside `src/`; release build marker refusing `local`/`test`; dependency-cruiser `no-production-to-test-doubles`; CI `artifact-isolation` step (ART-ISO). Migration 0001 (incl. `phone_lookup_index`, `key_rotations`); UUIDv7 helper; versioned AEAD envelope + `KeyProvider` (local keys only) + HMAC lookup with key versions and the rotation job framework (dual-write/backfill/dual-read/switch/contract); Valkey limiter (fail-closed for OTP); persistent idempotency store; global policy guard + route-policy completeness test; OTP request/resend/verify; sessions/refresh/logout/revocations; account state v1; profile PATCH; security events; audit write path; PostgreSQL job runner in `apps/worker` (OTP send, audit seals); realtime session authenticator; contracts, error codes, envelope `details`, explicit error mapping; redaction + canary harness; BOOT-NEG.
- **Exit:** ART-ISO, SEC-OTP, PROP-OTP, CONC-OTP, SEC-ENUM, SEC-SESS, CONC-SESS, API-SESS, SEC-RT, SEC-IDOR/SEC-MA (P2.1 routes), UNIT-CRYPTO/PROP-CRYPTO, SEC-AUDIT, SEC-LOG, BOOT-NEG; grants proven as restricted roles.
- **Does NOT require:** OTP vendor, store/Google/Apple accounts, counsel texts, KMS.

### P2.2 — Policy versions, consent, age-eligibility policy mechanism and public legal pages
- **IDs:** A04, R09, W05, K14 (consent infrastructure), **A15** (policy versions, signup declaration API).
- **Builds:** policy-content package + manifest; migration 0002 (`legal.policy_documents`, `legal.age_eligibility_policies` with a placeholder version, `identity.consent_records`, `identity.age_declarations`); policies and age-policy read APIs; consent and age-declaration APIs; `ACCEPT_POLICIES`/`AGE_DECLARATION` required actions; production refusal of placeholders; web-public `/legal/*`, versions, change log.
- **Exit:** API-CONSENT, API-AGE (server part), legal-page E2E (Playwright introduced on a seasoned stable line), immutability test.
- **Does NOT require:** counsel texts or thresholds (placeholders), domain.

### P2.3 — Mobile account slice (one app)
- **IDs:** Q01, V01, A02/A03/A05/A11 UI, A04 consent UI, **A15** declaration UI, K09 client.
- **Builds:** `expo-router` + `@tanstack/react-query` (Q-13 approved, versions re-checked), `expo-secure-store`, installation id, typed client on `@wayvro/contracts`, single-flight refresh, idempotency persistence, account-state routing, phone/OTP/consent/age-declaration/profile/sessions/security-activity screens, restriction and required-action messaging, `en`/`ur`/`ur-Latn` keys, full view-state coverage.
- **Exit:** mobile unit/component tests; AAB + permission gate unchanged (**no new permission**); bundle/startup deltas recorded (non-device numbers labelled as such).
- **Does NOT require:** OTP vendor (local runner), real devices (NOT RUN).

### P2.4 — Staff identity, authorization, audit console and web-ops shell
- **IDs:** H01, H08, K10, Q39 (verification, viewer), Q42 (app part), W07 (shell, banners, idle lock, reason-for-access), K01 (staff realm).
- **Builds:** migration 0003 (incl. `role_assignment_cities`); bootstrap CLI (no emergency credentials); invitations/enrolment; WebAuthn login/step-up/unlock (SimpleWebAuthn, version re-checked); two-authenticator rule for real-evidence mode; code-defined roles + ABAC; maker-checker grants; offboarding; break-glass + alerts; audit viewer + seal verification; BFF; authenticated shell.
- **Exit:** AUTHZ-MATRIX (P2.4 routes), SEC-STAFF, SEC-BG, offboarding, Playwright + axe.
- **Does NOT require:** company IdP (P2.A6), hosting.

### P2.5 — Driver/vehicle compliance domain, requirement sets, age checks and restrictions
- **IDs:** D01, D04, K06, K07, R02–R06, R46, V03, V13, V02, K01 (driver profile), **A15** (driver age evaluation, `AGE_POLICY` restriction reason).
- **Builds:** migration 0004 (catalog cities/districts/categories, document types, placeholder set, applications + category junction, CNIC lookup index, profiles, vehicles, affiliations, compliance documents + number lookup index, duplicate signals, capabilities, restrictions + events); application create/update/requirements/vehicles/withdraw (submit ships in P2.6 with evidence); eligibility evaluator; restrictions API + web-ops screens; requirement-set and age-policy data maker-checker screens; account-state driver section.
- **Exit:** PROP-SM, PROP-ELIG, SEC-V13, SEC-D01/SEC-K07 (non-file), AUTHZ-MATRIX additions, SEC-MA/SEC-IDOR.
- **Does NOT require:** Punjab matrix or age thresholds (placeholders), DPIA (no files yet).

### P2.6 — Evidence vault and upload pipeline (starts with the image-processing evaluation)
- **IDs:** K11, Q08, K02 (backend), K03 (optional challenge backend), D02, D03, Q44 (inventory), Q45 (DPIA input pack), K07 (evidence signals), Q36.
- **Step 0 (gate):** bounded technical evaluation of mature isolated image decode/re-encode options (`docs/phase2/PHASE2_KYC_AND_EVIDENCE_VAULT.md` §5) recorded in ADR-041 **before** any sanitiser code; a hand-written parser is not authorised without evidence that mature options failed and explicit founder approval.
- **Builds:** migration 0005 + `wayvro_vault` role/pool + boundary rule; S3 adapter (`WHEN_REQUIRED` checksum) against SeaweedFS (quarantine + vault, lifecycle); ClamAV service + clamd adapter; isolated sanitiser service (chosen option, pinned, resource-limited, no network); envelope-encrypted evidence; slot (with capture-source rules)/completion/discard; submission route; processing/orphan jobs; staff evidence-view token + stream + access log; optional accessible capture challenges.
- **Exit:** SEC-VAULT, SEC-URL, SEC-FILE (revised), UNIT-CRYPTO (evidence DEKs), SEC-LOG, orphan dry-run; ADR-010 presign finding re-verified.
- **Does NOT require:** production storage/KMS (P2.A4), real KYC data, DPIA (prepared only).

### P2.7 — Manual review, decisions, appeals and expiry monitoring
- **IDs:** H02, K05, K04 (manual), K07, D03, D04, V13 (appeals), H08 (privileged confirmation), W07 (evidence reason-for-access, **paginated scoped rosters — no export**), R02–R06/R46 checklist items, **A15** (reviewer DOB/licence check).
- **Builds:** migration 0006 (review cases with explicit subject FKs, decisions + evidence junction, appeals + appeal evidence junction); queue/claim/lease; masked case view; decisions with checklist, reason catalogue and second approval; profile + capability grants on approval; appeals; expiry job + roster; outbox relay wired with its first consumer (removes the Knip production exception).
- **Exit:** CONC (claims/decisions), SEC-REV, SEC-SELFIE (no automated approval), SEC-EXPORT (no export route), AUTHZ-MATRIX for review routes, Playwright reviewer journey.
- **Does NOT require:** real reviewers or in-person centre (EG-20).

### P2.8 — Mobile Driver/Partner onboarding (same app)
- **IDs:** V03, V01, D01–D04 UI, K02/K03 capture, K05/K14 explanations/dispute/correction, Q01 (capture cleanup).
- **Builds:** lazy-loaded onboarding; `expo-camera` (JIT CAMERA); controlled import via `expo-image-picker` (system photo picker; verify no storage permission is added); selfie camera-only with optional accessible challenge; upload queue with retry/resume and cleanup; checklist; status/NEEDS_INFO/rejection/appeal/in-person; driver compliance view + renewal; allowlist change (**CAMERA → allowed**, founder review); copy review for forbidden claims.
- **Exit:** mobile tests incl. camera/picker import boundary; AAB + permission gate with the new allowlist and no storage permission; emulator walkthrough labelled emulator-only; real-device capture NOT RUN unless a device is available.

### P2.9 — Recovery, phone change, SIM safeguards, risk holds, deletion and hardening
- **IDs:** A05, A11 (notices), K08 (SIM-swap heuristics), K17, S12, S13, U06, K11 (evidence deletion), K13 (completion), V07 (full suite), Q06 (playbooks).
- **Builds:** migration 0007 (phone-change/recovery requests with `SELF_SERVICE` and `RECOVERY_DRIVER_KYC` kinds, deletion requests + blocker/exception rows); step-up; phone change; driver-KYC recovery case (maker-checker, cooldown, "not me"); **no rider-only recovery path without strong proof** (new-account guidance); dormant-number review; risk policy producing `RISK_HOLD` + `REVERIFICATION` cases (risk-triggered only); deletion (app + web-public with OTP), grace, blockers, processing jobs, retention placeholders, legal-hold flag; playbooks.
- **Exit:** SEC-S12, SEC-K17, SEC-RECOVERY, SEC-S13, SEC-DEL, complete K13 families, SEC-V07, AUTHZ-MATRIX complete.

### P2.10 — Google/Apple OIDC linking (server; flags OFF)
- **IDs:** K15, K16, S13, K01, K17 (adds the `RECOVERY_OIDC_PROOF` kind additively).
- **Builds:** migration 0008; nonce endpoint; `jose` verifier (version re-checked); OIDC sign-in/link/unlink; collisions; unknown-device `PHONE_STEP_UP`; OIDC-proof recovery; flags `platform.auth-oidc-google` / `platform.auth-oidc-apple` default OFF; local JWKS fixture in the dev-only test-double package.
- **Exit:** SEC-OIDC, SEC-RECOVERY (OIDC path), flags-off behaviour.

### Activation tracks (external-gated; not part of the Phase 2 exit)
P2.A1 OTP/SMS (+WhatsApp, SMS Retriever) · P2.A2 Google · P2.A3 Apple (+S2S, revocation) · P2.A4 production storage/KMS/scanner/sanitiser hosting + seal anchoring · P2.A5 optional vetted liveness/face-to-ID advisory signals · P2.A6 optional staff SSO · P2.A7 approved legal texts · P2.A8 approved Punjab requirement set · P2.A9 approved age and guardian policy. Prerequisites/evidence: `docs/phase2/PHASE2_EXTERNAL_GATES.md` §5. None may be simulated.

## 3. Phase 2 exit gate (maps docs/12)

| docs/12 clause | Evidence |
|---|---|
| valid / replay-resistant OTP and session | SEC-OTP, PROP-OTP, CONC-OTP, SEC-SESS, CONC-SESS |
| account-linking tests | SEC-OIDC, SEC-S13, SEC-RECOVERY (synthetic keys; real providers in P2.A2/A3) |
| driver cannot become ACTIVE on face score alone | no score field; property test: no automated actor reaches VERIFIED/ACTIVE_ELIGIBLE |
| spoofed/replayed selfie rejected or escalated | exact-replay hash signals; camera-only selfie slots; challenge outcome shown to reviewer; residual risks documented |
| reviewer evidence + appeals | H02/K05 api-e2e; access log; appeal routing |
| no cross-user access | SEC-IDOR, SEC-V07, AUTHZ-MATRIX, SEC-VAULT |
| vault isolation | `wayvro_vault` role tests; no-URL tests; one-time view tokens |
| expiry blocks proven | PROP-ELIG + expiry job (go-online enforcement Phase 4) |
| seed approved synthetic drivers | local-only seed CLI in development tooling, through the real review path |
| admin authorization matrix and audit | AUTHZ-MATRIX; SEC-AUDIT |
| (added) production artefacts free of test doubles | ART-ISO from P2.1 onward |

Phase 2 exit does **not** claim real OTP delivery, Google/Apple production login, production storage/KMS, counsel texts, Punjab matrix, age thresholds, DPIA completion, real-device results or an independent security assessment.

## 4. Rough size
P2.1 and P2.6 are the largest; P2.2 and P2.10 small; others medium. Durations follow review evidence, not prompt counts.
