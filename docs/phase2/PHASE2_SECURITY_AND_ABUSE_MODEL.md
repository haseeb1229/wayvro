# PHASE2_SECURITY_AND_ABUSE_MODEL — Phase 2 threat model and abuse cases (PROPOSED)

**Date:** 2026-10-10 (planning closure correction applied the same day) · **Status:** Phase 2 PLAN ONLY. Extends `docs/phase0/PHASE0_SECURITY_PRIVACY.md` (TB1–TB10, AB-01..AB-22). OWASP ASVS L2 / MASVS are design targets; **conformance is not claimed** until assessed (EG-17/U01, Phase 7). Every threat maps to prevention, detection, recovery and tests (`docs/phase2/PHASE2_TEST_STRATEGY.md`).

## 1. Assets and boundaries
Assets: phone ownership, tokens, OTP budget, accounts and role isolation, driver applications and KYC evidence, reviewer decisions, restrictions, staff credentials/sessions, audit integrity, consent proof, age declarations, keys/peppers, the integrity of production artefacts. Boundaries: TB1, TB2, TB4 (staff via BFF), TB5/TB6 (OTP, storage, scanner, image sanitiser, future OIDC/KYC providers), TB7, TB9, TB10 (build → deployable artefact).

## 2. Threat register

| # | Threat | Prevention | Detection | Recovery | Tests |
|---|---|---|---|---|---|
| T-01 | OTP bombing / SMS pumping (AB-01) | +92-mobile-only; multi-dimensional limits; spend stop; silent drop; limiter fail-closed | prefix/ASN conversion monitor; budget alerts | friction per prefix/ASN; vendor caps (P2.A1) | SEC-OTP, LOAD-OTP |
| T-02 | Credential stuffing | no consumer passwords; staff WebAuthn | failure-rate metrics | — | SEC-AUTH |
| T-03 | Account enumeration | identical responses/status/work on all public identity routes | shape/timing regression tests | — | SEC-ENUM |
| T-04 | OTP brute force | 6 digits, 5 attempts, phone cooldown, MAC compare | failure spikes | cooldown, appeal | SEC-OTP, PROP-OTP |
| T-05 | OTP replay / cross-purpose reuse | single-use CAS; challenge id + purpose bound; superseding | reuse logged | — | CONC-OTP, SEC-OTP |
| T-06 | Stolen refresh token | rotation + reuse detection; secure storage; short access tokens | `REFRESH_REUSE_DETECTED` | session revoked, notice | SEC-SESS, CONC-SESS |
| T-07 | Session fixation | tokens minted only after successful auth | — | — | SEC-SESS |
| T-08 | Device theft / lost device | secure storage, expiries, remote revocation | unknown sessions visible | revoke one/all; support revoke after verification | API-SESS |
| T-09 | Recycled SIM inherits account (S12, AB-02) | dormant + unknown device ⇒ restricted `RECOVERY_REVIEW`; history only with strong proof | recycled-number signals | old account `SECURITY_HOLD`; new clean account | SEC-S12 |
| T-10 | SIM-swap takeover | step-up; 24 h cooldown on phone-dependent changes; driver `RISK_HOLD` when risk policy triggers | correlation signals | "not me" cancel; strong-proof recovery | SEC-K17 |
| T-11 | OAuth account-link takeover (S13) | link only from step-up-fresh session; `(provider, sub)`; nonce; aud/iss | link conflicts audited | unlink; recovery case | SEC-OIDC |
| T-12 | E-mail collision takeover | e-mail never a lookup/merge key | — | — | SEC-OIDC |
| T-13 | Fraudulent merge / duplicate-account merge | no merge feature; credential movement only via strong-proof, maker-checker, cooldown case; histories never merged | — | revert via audited case | SEC-S13 |
| T-14 | **Support social-engineering recovery** (attacker persuades support to restore an account) | support cannot decide recovery; rider-only accounts without a pre-existing strong factor are **never** restored by support judgement; driver recovery requires KYC evidence review + maker-checker + cooldown | recovery-case audit; unusual volume | "not me" cancellation during cooldown | SEC-RECOVERY |
| T-15 | IDOR | owner/profile-scoped queries; foreign ids 404 | staff denials audited | — | SEC-IDOR |
| T-16 | Mass assignment | strict schemas; server-owned fields absent | — | — | SEC-MA |
| T-17 | Cross-user document access | vault only via staff evidence-view flow; no URLs; separate DB role | access-log alerts | revoke staff, review | SEC-VAULT |
| T-18 | Cross-mode leakage | profile-scoped policies | — | — | SEC-V07 |
| T-19 | Staff privilege escalation | code-defined roles; maker-checker; no self-grant; step-up | denials audited/alerted | offboard | AUTHZ-MATRIX |
| T-20 | Reviewer abuse | city scope, claimed-case evidence, conflict checks, second approval, calibration sampling | view-volume alerts | new decisions; restrict; offboard | SEC-REV |
| T-21 | Presigned-URL leakage | upload-only, quarantine-only, ≤ 5 min, size/type signed; no download presigns | — | quarantine lifecycle | SEC-URL |
| T-22 | Malicious files (malware, polyglot, bombs, decoder exploits) | magic-byte allowlist (JPEG/PNG); ClamAV; **mature decoder in an isolated, resource-limited sanitiser; re-encode; metadata absent by construction**; no hand-written parser | sanitiser crash/timeout metrics; scanner rejects | object rejected; account review; decoder patching | SEC-FILE |
| T-23 | Document replay (AB-04) | source and canonical hash dedupe; document-number lookup; manual checks | duplicate signals | restriction + appeal | SEC-K07 |
| T-24 | Selfie replay / printed photo / screen playback | camera-only selfie (UX); optional accessible challenge; manual comparison; in-person path | challenge mismatch shown to reviewer | reject / in-person | SEC-SELFIE (no detection claim) |
| T-25 | Camera injection / emulator / rooted device | **not preventable in Phase 2**; attestation signals Phase 4 (Q02/Q03) | — | in-person path | documented residual risk |
| T-26 | Synthetic identity | checklist; dedupe; manual public lookups; in-person | reviewer escalation | restriction | SEC-K07 |
| T-27 | Duplicate driver/person accounts | per-account uniqueness in DB; person-level signals (CNIC/doc/evidence/plate/released phone) — **person uniqueness is not a DB invariant** | signals | review, restriction, strong-proof credential movement | SEC-D01 |
| T-28 | Audit tampering | INSERT-only + trigger; seals; verification job | mismatch alert | forensic restore; anchors later | SEC-AUDIT, PROP-AUDIT |
| T-29 | Bulk export abuse / insider scraping | **no export capability in Phase 2**; paginated scoped rosters with page caps; reason-gated PII views | view-volume alerts | revoke access | SEC-EXPORT |
| T-30 | **Production test-double activation (F-01)** | test doubles in a dev-only package absent from deployable artefacts; production composition roots cannot import them; local runner outside the build; release marker refuses `local`/`test`; static rules; runtime brand check kept | CI artefact-isolation step | refuse boot | ART-ISO, BOOT-NEG |
| T-31 | Break-glass misuse | ≤ 60 min, scoped, step-up, alerts, review | alerts | offboarding | SEC-BG |
| T-32 | Restriction escape | restrictions on server ids; evaluator per request | — | — | SEC-V13 |
| T-33 | Consent forgery / downgrade | `contentSha256` checked; production refuses placeholders | — | re-consent | API-CONSENT |
| T-34 | Deletion abuse | step-up / OTP; grace with notices; cancellation | security events | cancel; restore before processing | SEC-DEL |
| T-35 | Telemetry leakage | redaction + canary scans | CI | rotate, purge per runbook | SEC-LOG |
| T-36 | Key/pepper compromise or misuse (nonce reuse, cross-field ciphertext swap) | versioned envelope, random 96-bit nonces, AAD binding field/row/schema, per-class keys, rotation without destructive cut-over | decryption-failure alerts; key usage counters | rotate field keys/lookup keys/KEK (data model §8) | UNIT-CRYPTO, PROP-CRYPTO |
| T-37 | Staff phishing / session hijack | WebAuthn origin binding; `__Host-` cookies; nonce CSP; no API CORS | — | revoke sessions | SEC-STAFF |
| T-38 | Unauthenticated realtime subscription | session-token authenticator, fail-closed, server-derived rooms | — | — | SEC-RT |
| T-39 | Races (double submit, concurrent decisions/sign-ins/refreshes, rotation vs update) | CAS/version, partial unique indexes, idempotency store | — | — | CONC-* |
| T-40 | Age-ineligible accounts and over-collection of age data (A15) | policy-driven declaration only; no rider DOB unless required; driver DOB reviewer-confirmed; no inference from images | reports | reason-coded `AGE_POLICY` restriction with appeal | API-AGE |
| T-41 | Inaccessible selfie challenge causing unfair rejection | challenges optional; alternatives; decline is neutral; no automatic rejection | review sampling | in-person path; appeal | SEC-SELFIE |

## 3. Production fail-closed checklist (verified by tests)
1. Production artefacts contain no test-double package, mock brand or test-OTP route (ART-ISO).
2. Release artefact refuses `WAYVRO_ENV=local|test` (release marker).
3. Mock provider bound under staging/production ⇒ refuse (existing guard, retained).
4. Missing real adapter configuration under staging/production ⇒ `ConfigError`.
5. Local field/lookup/KEK keys under staging/production ⇒ refuse.
6. Required policy or age policy in placeholder status under production ⇒ refuse.
7. Placeholder requirement set cannot be activated in production; evaluator reports `REQUIREMENT_SET_PLACEHOLDER`.
8. `ops.kyc-real-evidence` default OFF; production enablement needs registry `productionApprovedBy` with gate evidence and two-authenticator enrolment.
9. Local-only seed CLI exists only in development tooling and refuses non-local environments.

## 4. Residual risks (accepted only by founder decision)
Manual review cannot reliably detect high-quality forgeries, deepfakes or camera injection; quarantine plaintext ≤ 24 h under provider SSE; single-operator pilots cannot satisfy two-person controls (actions block); no operator SIM-swap signal (UNVERIFIED); audit seals rewritable by a database superuser until external anchoring; mature image decoders still carry native-decoder advisories (mitigated by format allowlist, isolation, limits and patch cadence, not eliminated); riders who lose their number without a strong factor lose access to their old history by design (safety over convenience).

## 5. Incident playbooks to write in Phase 2 (Q06)
Under `docs/operations/` in P2.9: OTP pumping; session/credential compromise; staff account compromise; evidence exposure suspicion (breach steps counsel-dependent, U09); provider outage (OTP, storage, scanner, sanitiser); key rotation emergency (field key, lookup key, KEK). Owners named by role; reviewed in Phase 7 drills.
