# PHASE2_SECURITY_AND_ABUSE_MODEL — Phase 2 threat model and abuse cases (PROPOSED)

**Date:** 2026-10-10 · **Status:** Phase 2 PLAN ONLY. Extends `docs/phase0/PHASE0_SECURITY_PRIVACY.md` (trust boundaries TB1–TB10, AB-01..AB-22) for the identity/KYC/staff surfaces. Targets OWASP ASVS L2 (server) and MASVS (mobile) as design goals; **conformance is not claimed** until assessed (U01 independent test is a Phase 7 gate). Every threat below maps to prevention, detection, recovery and at least one negative test (test IDs in `docs/phase2/PHASE2_TEST_STRATEGY.md`).

## 1. Phase 2 assets and trust boundaries

Assets: phone ownership, session/refresh tokens, OTP budget (money), consumer accounts and their role isolation, driver applications and KYC evidence, reviewer decisions, restrictions, staff credentials/sessions, audit integrity, policy-consent proof, encryption keys/peppers.
Boundaries in scope: TB1 (mobile ↔ API/realtime), TB2 (Rider ↔ Driver/Partner areas of one binary), TB4 (staff web ↔ API via BFF), TB5/TB6 (OTP, storage, scanner, future OIDC/KYC providers), TB7 (web-public legal/deletion pages), TB9 (PostgreSQL schemas/roles, object storage, Valkey, logs).

## 2. Threat register (Phase 2)

| # | Threat | Prevention | Detection | Recovery | Tests |
|---|---|---|---|---|---|
| T-01 | **OTP bombing / SMS pumping** (cost abuse, AB-01) | +92-mobile-only; per-phone/installation/IP/prefix/ASN limits; global budget hard stop; silent drop; fail-closed when Valkey down | conversion-rate monitor per prefix/ASN; budget alerts 50/80/100 % | temporary friction per prefix/ASN; block lists with appeal; vendor-side caps (P2.A1) | SEC-OTP-01..06, LOAD-OTP-01 |
| T-02 | **Credential stuffing** | no passwords for consumers; staff use WebAuthn | failed-OTP and failed-assertion rates | — | SEC-AUTH-01 |
| T-03 | **Account enumeration** (OTP request, verify, OIDC, phone change, recovery, web deletion) | identical responses/status/timing paths; existence revealed only after phone ownership proven | response-shape/timing regression tests | — | SEC-ENUM-01..07 |
| T-04 | **OTP brute force** | 6 digits, 5 attempts/challenge, phone lockout after 5 failed challenges/24 h, MAC compare | failure spikes per phone/IP | lock + cooldown, support appeal | SEC-OTP-07..09, PROP-OTP-01 |
| T-05 | **OTP replay** / reuse across purposes | single-use CAS; purpose and challenge id bound in MAC; superseding | reuse attempts logged | — | CONC-OTP-01, SEC-OTP-10 |
| T-06 | **Stolen refresh token** | rotation + family reuse detection; secure storage; short access tokens | `REFRESH_REUSE_DETECTED` security event | session revoked; user notified; logout-all | SEC-SESS-01..04, CONC-SESS-01 |
| T-07 | **Session fixation** | tokens minted only after successful auth; no pre-auth session promotion | — | — | SEC-SESS-05 |
| T-08 | **Device theft / lost device** | OS secure storage (device-locked keys), idle/absolute expiry, remote revocation | session list shows unknown devices | revoke one/all; support-assisted revoke after verification | API-SESS-01..03 |
| T-09 | **Recycled SIM inherits account** (S12, AB-02) | dormant-account + new-device ⇒ `RECOVERY_REVIEW` restricted session; no history exposed | recycled-number signals | old account `SECURITY_HOLD`; staff recovery for true owner | SEC-S12-01..04 |
| T-10 | **SIM swap takeover** | 24 h cooldown for phone-dependent changes after new-device sign-in; step-up; driver manual re-check before earning on new device (Phase 4 enforcement) | new-device + phone-change correlation | "this wasn't me" cancellation from old sessions; staff recovery | SEC-K17-01..05 |
| T-11 | **OAuth account-link takeover** (S13) | link only from authenticated, step-up-fresh session; `(provider, sub)` key; nonce; aud/iss checks; no implicit account creation | link conflicts audited | unlink; recovery case | SEC-OIDC-01..08 |
| T-12 | **Email-collision takeover** | email is never a lookup/merge key | — | — | SEC-OIDC-04 |
| T-13 | **Fraudulent account merge / duplicate-account merge request** | no merge feature; staff recovery case with proof of both principals + maker-checker + cooldown | — | revert via audited case | SEC-S13-01..03 |
| T-14 | **IDOR** (sessions, applications, uploads, appeals, consents, evidence) | owner/profile-scoped queries; foreign ids → 404 | denied-access audit for staff routes | — | SEC-IDOR-01..12 (generated per route) |
| T-15 | **Mass assignment** (state, verified fields, roles, account id) | `.strict()` request schemas with allowlists; server-owned fields absent from DTOs | schema rejection metrics | — | SEC-MA-01..06 |
| T-16 | **Cross-user document access** | vault reachable only via staff evidence-view flow; no URLs stored/returned; separate DB role | access-log anomaly alerts | revoke staff, audit review | SEC-VAULT-01..08 |
| T-17 | **Cross-mode data leakage** (rider ↔ driver of same account) | profile-scoped policies (`driver.documents`, `rider.*`), driver views only with driver profile | — | — | SEC-V07-01..05 |
| T-18 | **Staff privilege escalation** | code-defined roles; maker-checker grants; no self-grant; step-up | denied attempts audited + alerted | offboard/revoke | AUTHZ-MATRIX (all routes × roles) |
| T-19 | **Reviewer abuse** (approving associates, browsing evidence, bribery) | city scope, claimed-case-only evidence, conflict checks, second approval on flagged cases, 10 % calibration sampling | evidence-view volume alerts; decision-pattern review | reverse decisions via new decisions; restrict driver; offboard reviewer | SEC-REV-01..05 |
| T-20 | **Presigned-URL leakage** | upload-only, quarantine-only, single key, ≤ 5 min, size/type signed; downloads never presigned (API stream with one-time token) | — | object never reaches vault unvalidated; quarantine lifecycle | SEC-URL-01..04 |
| T-21 | **Malicious files** (malware, polyglot, decompression bomb, parser exploits) | magic bytes + strict container walk + dimension bounds + metadata stripping; no server pixel decoding; ClamAV; reviewers view via hardened browser with CSP | scanner rejects → T&S signal | object deleted; account review | SEC-FILE-01..08 |
| T-22 | **Document replay** (reusing images from other people/platforms, AB-04) | exact-hash dedupe; document-number hash dedupe; manual checks | duplicate signals | restriction + appeal | SEC-K07-01..04 |
| T-23 | **Selfie replay / printed photo / screen playback** | camera-only capture; server-random capture challenge; manual comparison; in-person path | challenge mismatch → escalation | reject/in-person | SEC-SELFIE-01..03 (manual-path assertions; no detection claim) |
| T-24 | **Camera injection / emulator / rooted device** | **not preventable in Phase 2**; attestation signals are Q02/Q03 (Phase 4) | — | in-person verification path | documented residual risk; no test claims detection |
| T-25 | **Synthetic identity** | manual review checklist; dedupe; DLIMS/MTMIS manual lookups where available; in-person path | reviewer escalation | restriction | SEC-K07-05; ops drill later |
| T-26 | **Duplicate driver accounts** (one human, two accounts) | CNIC hash, document hashes, plate affiliation signals; one profile per account | signals | restriction/appeal | SEC-D01-01..03 |
| T-27 | **Audit-log tampering** | INSERT-only grants + trigger; seals (Merkle + chain); verification job | seal mismatch alert | forensic restore from backups; external anchors later | SEC-AUDIT-01..04, PROP-AUDIT-01 |
| T-28 | **Bulk export abuse / scraping by insiders** | deny-by-default; page caps; maker-checker export; no evidence exports | export/view volume alerts | revoke access | SEC-EXPORT-01..03 |
| T-29 | **Production mock/bypass activation** (F-01) | `bindProviders` mock refusal; staging/production config requires real adapters; test-OTP route absent outside local/test; no deterministic codes; no seeded users | boot-smoke negative checks in CI | refuse boot | BOOT-NEG-01..04 |
| T-30 | **Break-glass misuse** | ≤ 60 min, scoped, step-up, alert at start/end, mandatory review | alert | post-hoc review → offboarding | SEC-BG-01..03 |
| T-31 | **Restriction escape** (mode switch, logout/login, reinstall, new device) | restrictions on account/profile/vehicle ids; evaluator on every request | — | — | SEC-V13-01..05 |
| T-32 | **Consent forgery / policy downgrade** (accepting an old/placeholder text) | server validates `contentSha256` against registry; production refuses placeholders | — | re-consent required | API-CONSENT-01..04 |
| T-33 | **Deletion abuse** (attacker deletes victim's account) | step-up OTP to the account phone; grace period with notices; cancellation from any session | security events | cancel within grace; staff restore before processing | SEC-DEL-01..04 |
| T-34 | **Telemetry/log leakage** of OTP, tokens, CNIC, phone, presigned URLs | key + value redaction; canary scans; no PII in audit rows | canary tests in CI | rotate leaked secrets; purge logs per runbook | SEC-LOG-01..05 |
| T-35 | **Key/pepper compromise** | managed secrets; key ids per row; KEK rotation by re-wrap; separate peppers per purpose | — | rotate + re-wrap; re-hash lookup tables (runbook) | UNIT-CRYPTO-01..04 |
| T-36 | **Staff phishing / session hijack in web-ops** | WebAuthn (origin-bound), `__Host-` HttpOnly SameSite=Strict cookies, nonce CSP (exists), no CORS on API | — | revoke sessions | SEC-STAFF-01..05 |
| T-37 | **Realtime unauthenticated subscription** | session-token authenticator, fail-closed, server-derived rooms | — | — | SEC-RT-01..03 |
| T-38 | **Race conditions** (double submit, concurrent decisions, concurrent first sign-in, refresh races) | CAS/version columns, partial unique indexes, idempotency store | — | — | CONC-* family |
| T-39 | **Age-inappropriate accounts** (minors) | age attestation at sign-up (proposed GAP-P2-01); driver DOB check | reports | account restriction per policy | pending founder approval of GAP-P2-01 |

## 3. Production fail-closed checklist (verified by tests, not prose)

1. Mock provider bound under `staging`/`production` ⇒ boot refused (exists; extended to new ports).
2. Missing real OTP adapter config under `staging`/`production` ⇒ `ConfigError`.
3. Test OTP inbox route ⇒ 404 under `staging`/`production`.
4. Local field-encryption key / pepper under `staging`/`production` ⇒ boot refused.
5. Required policy in `PLACEHOLDER_NOT_FOR_PRODUCTION` under `production` ⇒ boot refused.
6. Placeholder requirement set under `production` ⇒ cannot be activated; evaluator returns `REQUIREMENT_SET_PLACEHOLDER`.
7. `ops.kyc-real-evidence` flag default OFF in all environments; turning it ON in production requires the flag registry's `productionApprovedBy` (existing field) referencing the gate evidence.
8. Local-only seed CLI ⇒ refuses any env other than `local`/`test`.

## 4. Known residual risks (accepted only by founder decision)

- WAYVRO_ENV is a configuration value; a mis-set `local` in a deployed environment would bind mocks (F-01). Mitigation in Phase 2: config requirements + boot-smoke tests; full mitigation (immutable release build marker) in Phase 7.
- Manual review cannot reliably detect high-quality forgeries, deepfakes or camera injection; the in-person path and later attestation/provider signals reduce, not remove, this.
- Quarantine plaintext ≤ 24 h under provider SSE only.
- Single-operator pilot cannot satisfy two-person controls; affected actions block.
- No operator SIM-swap signal (UNVERIFIED availability).
- Audit seals can be rewritten by a database superuser until external anchoring exists.

## 5. Incident playbooks to write in Phase 2 (Q06)

Short operational runbooks under `docs/operations/` (P2.9): OTP pumping response (identify prefix/ASN, raise friction, vendor caps, cost reconciliation), credential/session compromise (revoke, notify, rotate peppers if needed), staff account compromise (offboard, review audit since last good seal), evidence exposure suspicion (access-log review, notify per counsel breach procedure U09), provider outage (OTP, storage, scanner). Playbooks name owners as roles, mark legal notification steps as counsel-dependent, and are reviewed in the Phase 7 drills.
