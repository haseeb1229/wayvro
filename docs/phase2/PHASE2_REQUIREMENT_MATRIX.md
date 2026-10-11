# PHASE2_REQUIREMENT_MATRIX — Traceability for all 55 Phase 2 requirements (PROPOSED)

**Date:** 2026-10-10 (planning closure correction applied the same day) · **Status:** Phase 2 PLAN ONLY. · **Source of scope:** `docs/requirements-register.json` (schema 5.1), filtered on `phase0.target_phase = 2`.

## 0. Scope verification (executed 2026-10-10 against `main` @ `3a1402f`; updated by the planning closure)

- Original verification: `target_phase = 2` count **54** — P0 **49**, P1 **5** (A11, K15, K16, K17, K22); exact match with the founder prompt's list (0 missing, 0 extra).
- Planning closure (2026-10-10): founder/ChatGPT approved **A15** (P0, target phase 2) through the generator workflow (`docs/phase0/tools/coverage-map-additions.js`); register 531 → **532**; Phase 2 scope **55** — P0 **50**, P1 **5**. The original 54 register entries are byte-identical (verified).
- Clarifications remain interpretation only (`docs/phase2/PHASE2_PLAN.md` §8).

Columns: **Class** — `NOW` = IMPLEMENTABLE_NOW, `N+G` = NOW + GATED_ACTIVATION, `EXT` = EXTERNAL_GATED (definitions and gate ids EG-xx in `docs/phase2/PHASE2_EXTERNAL_GATES.md`). **MP** — implementation micro-phase(s) (`docs/phase2/PHASE2_IMPLEMENTATION_SEQUENCE.md`). Surfaces use the register's codes (`api`, `worker`, `infra`, `mob-shared`, `mob-driver`, `web-ops`, `web-public`, `company`). Acceptance evidence per ID: `docs/phase2/PHASE2_TEST_STRATEGY.md` §3.

## 1. Classification, sequencing and gates

| ID | P | Requirement (short) | Class | MP | Surfaces | External dependency | Activation / release gate |
|---|---|---|---|---|---|---|---|
| A02 | P0 | +92 → E.164, no enumeration, abuse protection (email = contact only, CL-01) | NOW | P2.1, P2.3 | api, mob-shared | — | real users only after A03 activation and EG-17 |
| A03 | P0 | verified phone onboarding with a tested provider; expiry, resend throttles, device controls | N+G | P2.1, P2.3, P2.A1 | api, mob-shared | EG-01, EG-14 | real-provider integration test (P2.A1) |
| A04 | P0 | Terms/privacy/consent/permission notices with policy version/time | N+G | P2.2, P2.3, P2.A7 | api, mob-shared, web-public | EG-02 | counsel texts replace placeholders; production boot check |
| A05 | P0 | profile, display name, contact edits with re-verify, recovery/lockout | NOW | P2.1, P2.3, P2.9 | api, mob-shared | — (e-mail contact deferred, Q-03) | — |
| A11 | P1 | device/session management, suspicious-login notices (staff MFA → K10, DUP-02) | NOW | P2.1, P2.3, P2.9 | api, mob-shared | SMS notices need EG-01 | push notices with S11 (Phase 4) |
| A15 | P0 | counsel-approved age and guardian eligibility policy; minimum declaration at signup; verified DOB/licence for drivers; explicit, reason-coded, privacy-minimised under-age handling; future guardian/teen programmes without replacing the identity model | N+G | P2.2, P2.3, P2.5, P2.7, P2.A9 | mob-shared, api, mob-driver, web-ops | EG-23 (thresholds, guardian rules) | approved policy replaces the placeholder (P2.A9) |
| D01 | P0 | signup, verified phone, unique driver identity (one driver profile per account + person-level duplicate signals; person uniqueness is not a DB invariant), duplicate/fraud detection | NOW | P2.5, P2.7, P2.8 | api, mob-driver | — | real drivers after EG-10/EG-20 |
| D02 | P0 | CNIC/licence/registration/fitness/insurance/permit upload (camera or controlled import, one pipeline) and secure review | N+G | P2.5–P2.8, P2.A8 | api, mob-driver, web-ops | EG-03 (categories) | approved requirement set (P2.A8) + EG-05/EG-10 for real files |
| D03 | P0 | document expiry, manual decisions, photo/device consent, evidence audit | N+G | P2.6, P2.7, P2.8 | api, worker, mob-driver, web-ops | EG-03; EG-10 for real data | M17 reminders Phase 5 |
| D04 | P0 | driver/vehicle status applicant→pending→approved/suspended/rejected, reason, appeal | NOW | P2.5, P2.7, P2.8 | api, mob-driver, web-ops | — | H09 generalised suspension Phase 6 |
| H01 | P0 | staff SSO/MFA, RBAC+ABAC, least privilege, audited access | N+G | P2.4 (+P2.A6) | api, web-ops | EG-19 (SSO federation only) | production network controls with hosting (Phase 7) |
| H02 | P0 | KYC reviewer queue, expiry monitoring, suspensions, appeals, evidence access | NOW | P2.7 | api, web-ops | — (staffing EG-20 to operate) | real evidence after EG-05/EG-10 |
| H08 | P0 | RBAC, privileged confirmation, break-glass + alert; reason-for-access (CL-06) | NOW | P2.4, P2.7 | api, web-ops | alert delivery EG-21 | on-call integration Phase 4/7 |
| K01 | P0 | explicit identities, roles, phone ownership (one current verified phone ↔ at most one account), lifecycle, safe linking | NOW | P2.1, P2.4, P2.5, P2.10 | api, mob-shared | — | fleet principals Phase 12 (K23) |
| K02 | P0 | CNIC front/back guided capture, quality checks, redacted extraction, consent, human authenticity review | N+G | P2.6, P2.7, P2.8 | api, mob-driver, web-ops | EG-10, EG-20; no OCR (FD-06) | DPIA before real CNIC |
| K03 | P0 | guided live selfie (camera only); optional accessible capture challenge as anti-replay aid; non-biometric manual fallback; automated liveness only via vetted provider | N+G | P2.6, P2.8 (+P2.A5) | api, mob-driver, web-ops | automated: EG-08, EG-10, EG-11 | manual path at exit; automated optional |
| K04 | P0 | ID-portrait vs selfie comparison with human review, appeal, no gender inference | N+G | P2.7 (+P2.A5) | api, web-ops | automated: EG-09, EG-10, EG-11 | manual comparison at exit |
| K05 | P0 | KYC status, evidence-proven decisions, rejection reason, resubmission, expiry, audit, appeals | NOW | P2.7, P2.8 | api, mob-driver, web-ops | — | — |
| K06 | P0 | licence class/expiry, registration/ownership, plate, permits, fitness, insurance verified by approved process | N+G | P2.5, P2.7, P2.A8 | api, web-ops | EG-03 | approved requirement set |
| K07 | P0 | proportionate dedupe of risky identities/documents/accounts, no abusive merges, human appeal | NOW | P2.5, P2.6, P2.7 | api, web-ops | — | — |
| K08 | P0 | OTP abuse controls: E.164, TTL, one-time, throttles, quotas, SIM-swap risk, outages, recovery | N+G | P2.1, P2.9, P2.A1 | api, mob-shared | EG-01, EG-22 | vendor caps + cost monitoring live |
| K09 | P0 | hashed rotating refresh, short access tokens, logout-all, revocation, lost device | NOW | P2.1, P2.3 | api, mob-shared | — | — |
| K10 | P0 | staff strong MFA, step-up, recovery, least privilege, break-glass audit | NOW | P2.4 | api, web-ops | — | separate production access (hosting) Phase 7 |
| K11 | P0 | evidence isolation: encryption, anti-malware, scoped URLs, retention/deletion, access logs, no raw IDs in telemetry | N+G | P2.6, P2.7, P2.9, P2.A4 | api, worker, infra | EG-05, EG-16 | production storage/KMS activation |
| K13 | P0 | adversarial auth/KYC suite (OTP/selfie replay, spoofed clients, IDOR, mass assignment, ATO, false matches) | NOW | all; completed P2.9 | api, mob-shared | — | independent test U01 (Phase 7) |
| K14 | P0 | applicant explanations, manual option, disputed decision, correction/erasure | N+G | P2.2, P2.8, P2.A7 | api, mob-driver | EG-02 | counsel texts |
| K15 | P1 | Google OIDC with token verification, verified-email handling, explicit phone-proof linking | N+G | P2.10, P2.A2 | api, mob-shared | EG-06 | real-provider integration test |
| K16 | P1 | Apple sign-in, relay email, unlink/revoke, store compliance, safe linking | N+G | P2.10, P2.A3 | api, mob-shared | EG-07 | real-provider integration test; iOS review |
| K17 | P1 | multi-device + recovery (strong pre-existing proof only; rider without it ⇒ new account), high-risk reauth, number-change safeguards, fraud notices | NOW | P2.9 | api, mob-shared | SMS notices EG-01 | — |
| K22 | P1 | KYC/OTP/identity vendor operational evaluation, DPAs, failover, exit | EXT | template now | company, api | EG-11 | founder decision per vendor |
| Q01 | P0 | auth/session secrets only in OS secure storage; nothing sensitive in AsyncStorage/logs | NOW | P2.3, P2.8 | mob-shared | — | device verification on real devices (Phase 3 matrix) |
| Q06 | P0 | credential stuffing, OTP bombing, enumeration, scraping, automated abuse limits + playbooks | N+G | P2.1, P2.9 | api, worker | vendor caps EG-01 | fare/driver-abuse surfaces re-verified Phase 3/4 (CL-P2-06) |
| Q08 | P0 | encryption at rest/in transit + key-management responsibilities documented | N+G | P2.6, P2.A4 | infra, api | EG-05 | KMS chosen and drilled |
| Q36 | P0 | telemetry default-deny/redaction (CNIC, selfie, tokens, OTP, phone, location, attachments) | NOW | all | api, worker, mob-shared, infra | — | — |
| Q39 | P0 | append-only, tamper-evident privileged audit | NOW | P2.1, P2.4 | api, web-ops | external anchoring EG-05 | — |
| Q42 | P0 | production admin SSO/MFA, least privilege, device/network controls, short sessions, step-up, offboarding tests | N+G | P2.4 | web-ops, infra | hosting (Phase 7), EG-19 for SSO | Phase 7 production access review |
| Q44 | P0 | data-location/cross-border inventory + legal review before provider adoption | EXT | P2.6 (inventory) | company, infra | EG-12 | counsel opinion |
| Q45 | P0 | biometric/KYC DPIA as launch gate | EXT | P2.6 (input pack) | company | EG-10 | DPIA signed |
| R02 | P0 | per-driver/vehicle route-permit status, district scope, expiry, evidence | N+G | P2.5, P2.7, P2.A8 | api, web-ops, mob-driver | EG-04 | dispatch use Phase 4 (K12) |
| R03 | P0 | fitness certificate status/source/date/expiry; expired/failed cannot go online | N+G | P2.5, P2.7, P2.A8 | api, web-ops, mob-driver | EG-04 | go-online enforcement Phase 4 (evaluator ready in P2.5) |
| R04 | P0 | insurance evidence/coverage by vehicle/service/city; claims contact linked to incidents | N+G | P2.5, P2.7, P2.A8 | api, web-ops, mob-driver | EG-04 | incident link Phase 6 (CL-P2-07) |
| R05 | P0 | token tax / registration ownership / authorised use (open-letter, hypothecated, company — CL-10) | N+G | P2.5, P2.7, P2.A8 | api, web-ops, mob-driver | EG-03 | — |
| R06 | P0 | licence category/endorsement, medical/training/background configurable, no fleet/admin bypass | N+G | P2.5, P2.7, P2.A8 | api, web-ops | EG-04 | background screening N28 Phase 8 |
| R09 | P0 | separate versioned Terms, Driver agreement, privacy, biometric notice, Community Guidelines + change communication | N+G | P2.2, P2.A7 | api, mob-shared, web-public | EG-02 | N02 guidelines text (Phase 6) |
| R46 | P0 | Punjab artefacts per driver/vehicle (police cert, PSCA QR, 44B district permits, VICS, insurance, token tax), configurable, revalidated at go-online | N+G | P2.5, P2.7, P2.A8 | api, web-ops, mob-driver | EG-03, EG-04 | district dispatch check Phase 4 (CL-P2-08) |
| S12 | P0 | recycled/reassigned number cannot silently inherit an account | N+G | P2.1, P2.9 | api, mob-shared | EG-22 (tuning) | — |
| S13 | P0 | phone/Google/Apple link collisions and merge requests: step-up, conflict-safe, audit, manual recovery, no auto-merge | N+G | P2.9, P2.10 | api, mob-shared, web-ops | EG-06/07 for production OIDC | — |
| U06 | P0 | account deletion in-app + web path + store disclosures, retention exceptions, downstream deletion | N+G | P2.9 | api, worker, mob-shared, web-public | EG-02, EG-16, EG-18 | store submission (Phase 7/9) |
| V01 | P0 | one public app; one account; Driver/Partner mode after approval without a second app | N+G | P2.3, P2.8 | mob-shared, infra | EG-18 (store identity) | single listing at release |
| V02 | P0 | one account, distinct rider/driver profiles; server (not UI mode) authorises | NOW\* | P2.1, P2.5 | api, mob-shared | — | re-verified as Phase 3–5 capabilities arrive |
| V03 | P0 | in-app application/KYC/approval/suspension/re-verification; rider access preserved | N+G | P2.5, P2.8 | mob-shared, mob-driver, api | EG-10, EG-20 (real onboarding) | training D20 Phase 8 |
| V07 | P0 | role-scoped data isolation across modes and staff | NOW\* | P2.1–P2.9 (suite P2.9) | api | — | extended per data class in later phases |
| V13 | P0 | role-specific vs account-wide restrictions, reason-coded, audited, appeal-aware | NOW\* | P2.5, P2.7 | api, web-ops, mob-shared | — | Phase 4/6 consumers (presence, H09) |
| W05 | P0 | public canonical, versioned, dated legal pages with change log | N+G | P2.2, P2.A7 | web-public | EG-02, EG-15 | domain + counsel texts |
| W07 | P0 | staff web baseline: accessible shell, MFA sessions, idle lock, reason-for-access, exports deny-by-default (no Phase 2 export; scoped paginated rosters), banners, no client authz | NOW\* | P2.4, P2.7 | web-ops, api | — | production network controls (Phase 7) |

\* No external blocker; Phase 2 delivers a bounded slice that later phases extend (see `docs/phase2/PHASE2_EXTERNAL_GATES.md` §3).

## 2. Design traceability (domain → contract → data → UI → authorization → controls → tests)

| ID | Domain model / entities | API / contracts (`PHASE2_API_AND_SURFACES.md`) | Database (schema.table) | Mobile / web UI | Authorization policy | Security / privacy controls | Test families |
|---|---|---|---|---|---|---|---|
| A02 | Account, AccountPhone, OtpChallenge | otp-challenges, resends, sessions | identity.account_phones, otp_challenges | phone entry, OTP | public + limits | generic responses, HMAC lookup, encrypted phone, masked destination | unit (normalise, property), security (enumeration), api-e2e |
| A03 | OtpChallenge, Device | same + OtpDeliveryPort | identity.otp_challenges, account_devices | OTP screen (autofill, resend timer, outage state) | public | single use, TTL, cooldown, installation limits, fail-closed limiter | unit, security, integration, api-e2e |
| A04 | PolicyDocument, ConsentRecord | legal/policies, account/consents | legal.policy_documents, identity.consent_records | consent screens; web legal pages | consumer (restricted-ok) | content hash proof, append-only, placeholder refusal in production | unit, api-e2e, legal-review |
| A05 | Account profile, PhoneChangeRequest, restriction SECURITY_HOLD | account/profile, phone-changes, account-recoveries | identity.accounts, phone_change_requests | profile, phone change, recovery | consumer(+su) | allowlisted PATCH, step-up, cooldown, notices | unit, security, api-e2e |
| A11 | Session, Device, SecurityEvent | account/sessions, session-revocations, security-events | identity.sessions, account_devices, security_events | sessions list, activity | consumer | owner-scoped, no IP/location shown | security, api-e2e |
| A15 | AgeEligibilityPolicy, AgeDeclaration, AGE_POLICY restriction, driver verified DOB | legal/age-eligibility-policy, account/age-declarations, account/state requiredActions | legal.age_eligibility_policies, identity.age_declarations, compliance.driver_profiles.verified_date_of_birth_envelope, profile.restrictions | declaration step per policy mode; reviewer DOB check | public / consumer; COMPLIANCE_ADMIN maker-checker for policy data | no hard-coded threshold; no rider DOB unless required; no inference from images; placeholder refused in production | unit, api-e2e, legal-review |
| D01 | DriverApplication, DriverProfile, DuplicateSignal | driver-onboarding/applications | compliance.driver_applications, driver_profiles, duplicate_signals | Earn with Wayvro entry, claims form | consumer (policies + age declaration) | one non-terminal application/one profile per account (DB); CNIC lookup index produces signals (person uniqueness not a DB invariant) | security, api-e2e |
| D02 | ComplianceDocument, EvidenceObject, DocumentType | evidence-uploads, completion; admin review | compliance.compliance_documents, document_evidence; vault.evidence_objects | camera or controlled-import capture; ops case view | owner; reviewer (claimed case) | quarantine upload, scan, isolated decode/re-encode, encrypt, no URLs; capture source = metadata only | security, api-e2e, integration |
| D03 | ComplianceDocument expiry, ReviewDecision, ConsentRecord | renewals, expiry roster, decisions | compliance.*; vault.evidence_access_log | status/renewal screens; expiry roster | reviewer/T&S | live expiry evaluation, access log | api-e2e, security |
| D04 | application/profile state machines, restrictions, appeals | applications/current, account/state, appeals | compliance.driver_applications, driver_profiles; profile.restrictions, appeals | status, rejection, appeal screens | owner; reviewer | reason codes, appeal to different reviewer | unit (state tables), api-e2e |
| H01 | StaffAccount, WebAuthnCredential, RoleAssignment | admin/auth/*, staff admin | staff.* | web-ops login/enrol/admin | code-defined RBAC + ABAC | WebAuthn, maker-checker grants, audit | security, api-e2e |
| H02 | ReviewCase, ReviewDecision, Appeal | review-cases, claims, decisions, appeals, expiry roster | compliance.review_cases, review_decisions; profile.appeals | queue, case view, evidence viewer | KYC roles, city scope, claimed case | reason-for-access, step-up, conflict checks | api-e2e, security |
| H08 | BreakGlassGrant, step-up | break-glass-grants; step-up on privileged routes | staff.break_glass_grants | confirmation dialogs, banners | staff+su | alerting, post-hoc review | security, api-e2e |
| K01 | Account, RiderProfile, DriverProfile, StaffAccount (separate realm), OidcIdentity | account/state | identity.*, profile.rider_profiles, compliance.driver_profiles, staff.* | — | token type separation | one current verified phone ↔ at most one account and vice versa (DB); person-level uniqueness via signals only; no role duplication; no history merges | unit, security, api-e2e |
| K02 | EvidenceObject (CNIC front/back), claims vs confirmed fields | evidence-uploads | vault.evidence_objects; compliance.driver_applications | guided camera capture (JIT) or controlled import | owner; reviewer | no OCR; claims ≠ truth; masked display | security, device (deferred real-device), api-e2e |
| K03 | CaptureChallenge (optional, accessible set), EvidenceObject(SELFIE_FOR_MANUAL_REVIEW) | capture-challenges (+declines) | compliance.capture_challenges | camera-only selfie; optional challenge with "can't do this" alternatives; in-person path | owner; reviewer | no liveness-success wording; decline never rejects; exact-replay hash | security, device |
| K04 | ReviewDecision.identity_match_assessment | decisions | compliance.review_decisions | reviewer side-by-side viewer | KYC roles | human decision only; no score; no gender | security, legal-review |
| K05 | application machine, ReviewDecision, Appeal | applications, decisions, appeals | compliance.*, profile.appeals | status/NEEDS_INFO/appeal | owner; reviewer | append-only decisions, reason codes | api-e2e, security |
| K06 | RequirementSet, ComplianceDocument (licence class), Vehicle | requirement-sets, decisions | compliance.requirement_sets, requirement_set_items, vehicles | requirement checklist; ops checklist | COMPLIANCE_ADMIN maker-checker | no per-driver waiver; placeholder refusal | api-e2e, legal-review |
| K07 | DuplicateSignal | (internal) review cases | compliance.duplicate_signals | ops duplicate panel | KYC_SENIOR | signals never auto-decide; no merges | security, unit |
| K08 | OtpChallenge, limits, SIM-swap heuristics | otp-challenges, step-ups | identity.otp_challenges (+ Valkey counters) | outage/limit states | public | limits, budget stop, silent drop, cooldowns | unit, security, integration, load |
| K09 | Session, RefreshToken | sessions, token-refreshes, session-revocations | identity.sessions, refresh_tokens | session manager (single-flight) | consumer | SHA-256 token hashes, rotation, reuse detection | security, unit, api-e2e, concurrency |
| K10 | staff session, step-up, recovery | admin/auth/* | staff.sessions, webauthn_credentials | unlock/step-up prompts | staff | WebAuthn UV, short sessions, offboarding | security, api-e2e |
| K11 | EvidenceObject, EvidenceAccessLog, KeyProvider | evidence-views (+content stream) | vault.* | evidence viewer | `wayvro_vault` DB role; claimed case | AES-GCM envelope, ClamAV, sanitising, one-time tokens, retention, telemetry redaction | security, integration |
| K13 | (cross-cutting) | all | all | — | — | adversarial suite | security, concurrency |
| K14 | PolicyDocument (BIOMETRIC_KYC_NOTICE, DRIVER_PARTNER_AGREEMENT), appeals, corrections | consents, appeals, application PATCH | identity.consent_records | onboarding explanation + manual option + dispute screens | owner | placeholder marking, versioned consent | legal-review, a11y, api-e2e |
| K15 | OidcIdentity, nonce | oidc-nonces, oidc-sessions, oidc-links | identity.oidc_identities | (activation) Google button in Settings | consumer+su | `jose` verification, (provider, sub) key, no email lookup | security, integration |
| K16 | OidcIdentity (Apple relay) | same | same | (activation) Apple button | consumer+su | relay email as contact only; revocation | security, integration |
| K17 | PhoneChangeRequest, recovery review, SecurityEvent | phone-changes, account-recoveries, recovery-reviews | identity.phone_change_requests, security_events | recovery screens (strong-proof paths; new-account guidance) | consumer(+su), restricted; staff maker-checker for credential movement | strong proof only (linked OIDC; driver KYC case); 72 h cooldown; "not me" cancel; notices | security, api-e2e |
| K22 | vendor evaluation record (document) | — | — | — | — | DPA/exit criteria | integration, legal-review (external) |
| Q01 | (client) secure token store | — | — | session core | — | secure storage only; logout wipes; no tokens in logs | security, device |
| Q06 | limiter, monitors, playbooks | all public routes | Valkey counters | — | — | multi-dimensional limits; runbooks | security, unit, load |
| Q08 | KeyProvider, FieldCipher | — | ciphertext + key_id columns | — | — | key responsibility table | security, legal-review |
| Q36 | redaction rules | — | — | mobile log policy | — | key/value redaction + canary scans | security, unit |
| Q39 | AuditEvent, AuditSeal | admin/audit-events, seal verifications | audit.audit_events, audit_seals | audit viewer | AUDITOR | INSERT-only + trigger + seals | security, property |
| Q42 | staff session policy, offboarding | admin/auth, offboarding | staff.sessions | idle lock | staff | short sessions, step-up, offboarding test | security, ops-drill (Phase 7) |
| Q44 | data-location inventory (document) | — | — | — | — | provider rows flagged for counsel | legal-review |
| Q45 | DPIA input pack (document) | — | — | — | — | gate before real data | legal-review |
| R02 | ComplianceDocument(ROUTE_PERMIT_44B, district) | uploads, decisions | compliance.compliance_documents.district_code | permit capture per district | owner; reviewer | requirement-set driven | unit, api-e2e, legal-review |
| R03 | ComplianceDocument(VEHICLE_FITNESS_VICS) | same | same | fitness capture | same | expiry live in evaluator | unit, api-e2e |
| R04 | ComplianceDocument(THIRD_PARTY_INSURANCE) | same | same | insurance capture | same | coverage status per vehicle/category | unit, api-e2e, legal-review |
| R05 | Vehicle.ownership_type, VehicleAffiliation, AUTHORISED_USE_LETTER, TOKEN_TAX | vehicles, uploads | compliance.vehicles, vehicle_affiliations | vehicle form | same | ownership types per CL-10 | unit, api-e2e, legal-review |
| R06 | RequirementSetItem (licence classes, training/background markers) | requirement-sets | compliance.requirement_set_items | ops checklist | COMPLIANCE_ADMIN maker-checker | no bypass path exists | unit, api-e2e, legal-review |
| R09 | PolicyDocument keys incl. COMMUNITY_GUIDELINES | legal/policies, consents | legal.policy_documents | web legal pages, in-app policy screens | public / consumer | versioned, change log | api-e2e, legal-review |
| R46 | DocumentTypes (POLICE_CHARACTER_CERTIFICATE, PSCA_QR_PANIC_BUTTON, ROUTE_PERMIT_44B, VICS, insurance, TOKEN_TAX), district scope | uploads, decisions | compliance.* | artefact capture | owner; reviewer | configurable per city; placeholder refusal | unit, api-e2e, legal-review |
| S12 | recovery review, released phones | sessions (recovery-review requiredAction) | identity.account_phones (RELEASED), accounts.last_active_at | recovery-review screens | restricted session | no history without strong continuity proof; 90-day threshold provisional (EG-22) | security, unit |
| S13 | OidcIdentity conflicts, recovery cases | oidc-links, admin recovery-cases | identity.oidc_identities; compliance.review_cases(ACCOUNT_RECOVERY) | recovery case UI | consumer+su; T&S maker-checker | no auto-merge; immutable audit | security, api-e2e |
| U06 | AccountDeletionRequest, retention config | deletion-requests (app), public deletion request (web) | identity.account_deletion_requests | in-app deletion; web-public page | consumer+su; OTP for web | grace, blockers, downstream jobs, legal holds | api-e2e, security, legal-review |
| V01 | (topology) | — | — | one binary; onboarding inside the same app | — | separate-app path check (existing regen-manifest rule) | mobile-e2e (deferred), integration |
| V02 | capability evaluator, profiles | account/state | profile.rider_profiles, compliance.driver_profiles | mode presentation never authorises | server guard per route | client-supplied role/mode ignored | security, api-e2e, unit |
| V03 | application inside account; rider access preserved | driver-onboarding/* | compliance.* | Earn with Wayvro flow | consumer | DRIVER_ROLE restriction never blocks rider | api-e2e, security, mobile-e2e (deferred) |
| V07 | profile-scoped policies | all | all | — | `driver.documents` vs `rider.*` policies; staff scopes | foreign ids → 404 | security, api-e2e, property |
| V13 | Restriction (scopes), RestrictionEvent, Appeal | admin/restrictions, account/state, appeals | profile.restrictions, restriction_events, appeals | restriction messaging, appeal | T&S/KYC_SENIOR | CHECK per scope; evaluator | unit, api-e2e, security |
| W05 | policy-content package, PolicyDocument | legal/policies | legal.policy_documents | web-public `/legal/*` | public | immutable dated versions, change log, placeholder banner | legal-review, integration |
| W07 | staff shell, reason-for-access, scoped rosters | admin/* | staff.* (no export table) | web-ops shell, banners, idle lock, paginated rosters | staff | no client authz; no export/download route for identity/KYC data (route-inventory test) | security, a11y, api-e2e |

## 3. Implementation status

| Micro-phase | IDs touched | Status (2026-10-10) |
|---|---|---|
| P2.1 | A02, A03, A05, A11, K01, K08, K09, K13, Q06, Q36, Q39, S12, V02, V07 (+ F-01, F-03, F-04, F-05 job runner, F-06, F-08) | P2.1 portions implemented on `phase-2/1-identity-session-core`, **pending founder/ChatGPT review, not merged**; every ID remains **PARTIAL** as a whole and A03/A11/K08/Q06/Q39 are also external-gated — per-ID detail in `docs/phase2/PHASE2_P2_1_IMPLEMENTATION_RECORD.md` §1 |
| P2.2 – P2.10 + closure | all 55 | implemented and passed founder/ChatGPT review plus the closure run; per-ID reconciliation (15 ENGINEERING_SATISFIED, 35 PARTIAL_EXTERNAL_GATED, 2 PARTIAL_FUTURE_PHASE, 3 EXTERNAL_ONLY, 0 NOT_SATISFIED) in `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md` §"Phase-2 closure" |
| P2.A1 – P2.A9 | — | not started (activation; external gates EG-01..EG-23 open) |
