# PHASE2_IMPLEMENTATION_SEQUENCE — Phase 2 micro-phases (PROPOSED)

**Date:** 2026-10-10 · **Status:** Phase 2 PLAN ONLY. Micro-phases are **bounded review units inside Phase 2**, not new macro phases; the roadmap remains Phase 0–12 (docs/12). Each micro-phase is implemented on its own branch from the then-current `main` (proposed names `phase-2/<n>-<slug>`), reviewed by the founder/ChatGPT and merged by PR under the existing ruleset before the next starts, unless the founder authorises batching.

## 1. Ordering rationale (why this order, not the prompt's sketch verbatim)

1. **Identity core first** — everything else needs an authenticated principal, the idempotency store, the limiter, audit and the job runner; each infrastructure piece arrives with its first real consumer (no dead code).
2. **Consent before any onboarding** — driver application requires versioned acceptance; small and independent.
3. **Mobile account slice early** — proves contracts end to end with the real app before the KYC surface grows; introduces navigation/secure storage once.
4. **Staff realm before compliance** — requirement-set maker-checker, restrictions and review all need authenticated, authorised staff; web-ops must stop being an unauthenticated shell before any ops screen exists.
5. **Compliance domain before files** — the vault attaches to documents/applications that must already exist.
6. **Vault before review** — reviewers need evidence.
7. **Mobile onboarding after the server path is complete** — avoids building screens against moving contracts; CAMERA permission is added exactly once, with its first use.
8. **Recovery/deletion late** — they touch every table created earlier; doing them last avoids re-touching deletion code each micro-phase.
9. **OIDC last** — P1, externally gated, and its collision rules reuse the recovery-case machinery from P2.9.

## 2. Micro-phases

Common exit gate for **every** micro-phase (in addition to its specific gates): `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm depcruise`, `pnpm knip`, `pnpm syncpack`, `pnpm flags:check`, `pnpm test`, `pnpm test:coverage`, `pnpm openapi:check`, `pnpm docs:check`, `pnpm test:integration`, `node scripts/boot-smoke.mjs`, migrations clean/previous/re-run, gitleaks + osv-scanner, and — whenever `apps/wayvro-mobile` changes — the Android release AAB with 16 KB/ABI and permission gates. Schema fully used by the code in the same micro-phase; no feature flag without registry entry; docs/register evidence updated in the same change; report with exact NOT RUN items.

### P2.1 — Consumer identity and session core (API + realtime + worker)
- **IDs:** A02, A03 (engineering), A05 (profile), A11 (session list/revoke), K01 (account/phone/rider profile), K08 (limits/outage), K09, Q06 (auth surfaces), Q36, Q39 (write path + seals), S12 (dormancy signals recorded), V02 (principal + guard), V07 (scoping pattern), K13 (first families).
- **Builds:** migration 0001; UUIDv7 helper; `FieldCipher`/`KeyProvider` (local key only); HMAC phone lookup; Valkey limiter (Lua) with fail-closed policy for OTP; persistent idempotency store wired into the existing `preHandler`; global policy guard + route-policy completeness test; OTP request/resend/verify; sessions/refresh/logout/revocations; `GET /v1/account/state` v1; profile PATCH; security events; audit write path; `platform.jobs` runner in `apps/worker` (first real wiring of the worker) with OTP send and audit-seal jobs; realtime `SessionTokenAuthenticator` replacing `DenyAllAuthenticator`; contracts + error codes + envelope `details`; redaction keys/patterns + canary harness; BOOT-NEG additions.
- **Entry:** Phase 2 plan approved; ADR-038/042 accepted.
- **Exit:** SEC-OTP, PROP-OTP, CONC-OTP, SEC-ENUM, SEC-SESS, CONC-SESS, API-SESS, SEC-RT, SEC-IDOR/SEC-MA (for P2.1 routes), SEC-AUDIT, SEC-LOG, BOOT-NEG green; grants proven as restricted roles.
- **Does NOT require:** OTP vendor, any store/Google/Apple account, counsel text.

### P2.2 — Policy versions, consent and public legal pages (API + web-public)
- **IDs:** A04, R09, W05, K14 (consent infrastructure), U06 (deletion page shell is P2.9 — not here).
- **Builds:** policy-content package (markdown + generated manifest with SHA-256; placeholders marked); migration 0002; `GET /v1/legal/policies`, consents; `requiredActions: ACCEPT_POLICIES`; production boot refusal for placeholders; web-public `/legal/*`, version pages, change log, `noindex` on placeholders.
- **Exit:** API-CONSENT; Playwright legal-page tests (introduces Playwright if Q-11 approves; otherwise rendered-HTML integration tests); immutability test.
- **Does NOT require:** counsel texts (placeholders), domain (local hosts).

### P2.3 — Mobile account slice (one app)
- **IDs:** Q01, V01 (topology), A02/A03/A05/A11 UI, A04 consent UI, K09 client.
- **Builds:** navigation (expo-router, Q-13), secure token store (`expo-secure-store`), installation id, typed API client on `@wayvro/contracts`, single-flight refresh, idempotency-key persistence, account-state routing, phone/OTP/consent/profile/sessions/security-activity screens, restriction/required-action messaging, `en` + `ur` + Roman-Urdu keys (placeholders marked), view states (loading/empty/error/offline/retry/disabled/destructive confirmation).
- **Exit:** mobile unit/component tests; Android release AAB + permission gate unchanged (**no new permission**); bundle-size/startup delta recorded (emulator/laptop numbers labelled as such; real-device budgets stay SP-02).
- **Does NOT require:** OTP vendor (local sink), real devices (reported NOT RUN), store accounts.

### P2.4 — Staff identity, authorization, audit console and web-ops shell
- **IDs:** H01, H08 (RBAC, confirmations, break-glass), K10, Q39 (seal verification, viewer), Q42 (app part), W07 (shell, banners, idle lock, reason-for-access framework), K01 (staff realm).
- **Builds:** migration 0003; founder bootstrap CLI; invitations/enrolment (two authenticators); WebAuthn login/step-up/unlock (`@simplewebauthn/*` 13.3.x — ADR-039); staff sessions; code-defined roles/permissions + ABAC evaluator; role grants with maker-checker; offboarding; break-glass + alert events; audit viewer + seal verification; web-ops BFF (cookie, Origin check), authenticated shell, environment banner, idle lock.
- **Exit:** AUTHZ-MATRIX (for P2.4 routes), SEC-STAFF, SEC-BG, offboarding test, Playwright + axe for login/enrol/lock/banner.
- **Does NOT require:** company IdP (SSO federation is P2.A6), hosting.

### P2.5 — Driver/vehicle compliance domain, requirement sets and restrictions
- **IDs:** D01, D04 (state machines), K06 (data/config), K07 (signals), R02, R03, R04, R05, R06, R46, V03 (application inside the account), V13 (model + staff operations), V02 (capabilities), K01 (driver profile).
- **Builds:** migration 0004 (catalog seed, document types, placeholder `LHR/CAR v0`, applications, profiles, vehicles, affiliations, compliance documents, duplicate signals, service capabilities, restrictions + events); application create/update/requirements/vehicles/submit/withdraw (without file upload yet — submission is impossible until P2.6 completes the evidence step, so the submit route ships in P2.6 to avoid an unusable endpoint); eligibility evaluator + PROP-ELIG; restrictions admin API + web-ops screens (T&S); requirement-set draft/approve (maker-checker) + web-ops screens; account-state driver section.
- **Exit:** PROP-SM (application/profile), PROP-ELIG, SEC-V13, SEC-D01/SEC-K07 (non-file signals), AUTHZ-MATRIX additions, SEC-MA/SEC-IDOR for new routes.
- **Does NOT require:** Punjab matrix (placeholder set), DPIA (no files yet).

### P2.6 — Evidence vault and upload pipeline
- **IDs:** K11, Q08 (local implementation + responsibility doc), K02 (backend), K03 (selfie challenge, manual path backend), D02 (upload), D03 (consent before capture), Q44 (inventory), Q45 (DPIA input pack), K07 (evidence hash signals), Q36.
- **Builds:** migration 0005 + `wayvro_vault` role/pool + dependency-cruiser rule; S3 adapter (`@aws-sdk/client-s3` + presigner, `WHEN_REQUIRED` checksum — ADR-041) against SeaweedFS (quarantine + vault buckets with lifecycle); ClamAV compose service + clamd adapter; container validator/metadata stripper; envelope encryption; upload slot/completion/discard routes; submission route; scan/encrypt/orphan-cleanup jobs; staff evidence-view token + stream + access log.
- **Exit:** SEC-VAULT, SEC-URL, SEC-FILE, UNIT-CRYPTO, SEC-LOG (evidence identifiers), orphan-cleanup dry-run test; ADR-010 presign finding re-verified on SeaweedFS.
- **Does NOT require:** production storage/KMS (P2.A4), real KYC data (synthetic only), DPIA (prepared, not required for synthetic data).

### P2.7 — Manual review, decisions, appeals and expiry monitoring
- **IDs:** H02, K05, K04 (manual comparison), K07 (duplicate review), D03 (expiry), D04, V13 (appeals), H08 (privileged confirmation on decisions), W07 (evidence reason-for-access, export request with the expiry roster), R02–R06/R46 (checklist items).
- **Builds:** migration 0006; review queue/claim/lease; case view (masked); decision API with structured checklist + reason-code catalogue + second-approval flow; driver profile + capability grants on approval; appeals (consumer submit, staff decide, not-original-decider); expiry job + roster; export-request maker-checker (expiry roster only, Q-15); outbox events with first consumer (`account.state-changed.v1` realtime hint) — removes the Knip production exception for the worker relay if wired.
- **Exit:** CONC (claims/decisions), SEC-REV, SEC-SELFIE (no automated approval property), SEC-EXPORT, AUTHZ-MATRIX complete for review routes, Playwright reviewer journey.
- **Does NOT require:** real reviewers or in-person centre (EG-20) — workflow is exercised with synthetic staff.

### P2.8 — Mobile Driver/Partner onboarding (same app)
- **IDs:** V03, V01, D01–D04 UI, K02/K03 capture, K05/K14 applicant explanations and dispute/correction, Q01 (cached capture cleanup).
- **Builds:** lazy-loaded onboarding module; `expo-camera` capture screens (just-in-time CAMERA request at first capture; denied ⇒ manual/in-person path); upload queue with retry/resume and cache cleanup; requirement checklist; status/NEEDS_INFO/rejection/appeal/in-person screens; driver compliance view + renewal; permission allowlist change (**CAMERA → allowed**, founder review) and iOS usage strings; copy review for forbidden claims (liveness, NADRA, "verified by government").
- **Exit:** mobile unit/component tests incl. "camera only imported from onboarding"; Android AAB + permission gate with the new allowlist; manual emulator walkthrough evidence labelled as emulator-only; real-device capture checks (R4 spike item 9) reported NOT RUN unless a device is available.
- **Does NOT require:** real devices (NOT RUN reported), DPIA (synthetic data only).

### P2.9 — Recovery, phone change, SIM safeguards, deletion, and security hardening
- **IDs:** A05, A11 (notices), K08 (SIM-swap heuristics), K17, S12, S13 (manual merge-request handling), U06, K11 (deletion of evidence), K13 (suite completion), V07 (full isolation suite), Q06 (playbooks).
- **Builds:** migration 0007; step-up flows; phone change; lost-phone recovery with cooldown and "not me"; dormant-number recovery review; staff recovery cases; deletion requests (app + web-public `/account-deletion` with OTP), grace/blockers/processing jobs, retention configuration (placeholders), legal-hold flag on evidence; operational playbooks; adversarial family index.
- **Exit:** SEC-S12, SEC-K17, SEC-S13, SEC-DEL, complete K13 families, SEC-V07 full, AUTHZ-MATRIX complete.
- **Does NOT require:** SMS vendor (notices recorded/sent via sink), counsel retention (placeholders).

### P2.10 — Google/Apple OIDC linking (server; flags OFF)
- **IDs:** K15, K16, S13 (OIDC collisions), K01 (linked identities).
- **Builds:** migration 0008; nonce endpoint; `jose`-based verifier (ADR-040) with JWKS cache; OIDC sign-in, link, unlink; collision handling; flags `platform.auth-oidc-google`, `platform.auth-oidc-apple` default OFF in every environment; local JWKS fixture for tests. No mobile SDK yet (that is activation).
- **Exit:** SEC-OIDC complete; flags-off route behaviour tests.
- **Does NOT require:** Google/Apple accounts (activation P2.A2/P2.A3).

### Activation tracks (external-gated; not part of the Phase 2 exit)
P2.A1 OTP/SMS + WhatsApp + SMS Retriever · P2.A2 Google sign-in · P2.A3 Sign in with Apple (+ S2S, revocation) · P2.A4 production storage/KMS/scanner + seal anchoring · P2.A5 optional vetted liveness/face-to-ID advisory signals · P2.A6 optional staff SSO federation · P2.A7 counsel-approved legal texts · P2.A8 approved Punjab requirement set. Prerequisites and evidence: `docs/phase2/PHASE2_EXTERNAL_GATES.md` §5. Each is a separate founder-authorised change; none may be simulated.

## 3. Phase 2 exit gate (maps docs/12 Phase 2 gate)

| docs/12 gate clause | Evidence |
|---|---|
| valid / replay-resistant OTP and session | SEC-OTP, PROP-OTP, CONC-OTP, SEC-SESS, CONC-SESS |
| account-linking tests | SEC-OIDC, SEC-S13 (synthetic keys; real-provider tests remain P2.A2/A3) |
| driver cannot become ACTIVE on face score alone | no score field exists; property test: no automated actor reaches VERIFIED/ACTIVE_ELIGIBLE |
| spoofed/replayed selfie rejected or escalated | exact-replay hash signal; challenge mismatch blocks approval without escalation (SEC-SELFIE); camera injection documented as residual risk |
| reviewer evidence + appeals | H02/K05 api-e2e, evidence access log, appeal routing |
| no cross-user access | SEC-IDOR, SEC-V07, AUTHZ-MATRIX, SEC-VAULT |
| identity-document vault isolation | `wayvro_vault` role tests, no-URL tests, one-time view tokens |
| expiry blocks proven | PROP-ELIG + expiry job tests (go-online enforcement itself is Phase 4) |
| seed approved synthetic drivers | local-only seed CLI producing synthetic approved drivers through the real review path (refuses non-local env) |
| admin authorization matrix and audit | AUTHZ-MATRIX complete; SEC-AUDIT |

Phase 2 exit **does not** claim: real OTP delivery, Google/Apple production login, production storage/KMS, counsel-approved texts or Punjab matrix, DPIA completion, real-device results, independent security assessment — each stays listed as EXTERNAL/NOT RUN with its gate.

## 4. Rough size (for planning, not a deadline)

P2.1 and P2.6 are the largest (each comparable to the whole Phase 1 foundation in reviewed lines); P2.2, P2.10 are small; others medium. Durations depend on review cycles (docs/12: evidence, not prompt counts).
