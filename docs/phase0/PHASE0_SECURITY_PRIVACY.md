# PHASE0_SECURITY_PRIVACY — Threat model, biometric/privacy and abuse controls

**Date:** 2026-10-09 · **Status:** Phase 0 deliverable (plan-only). Extends `docs/10` and `docs/18`; evidence from research R2 (law), R4 (platform), R6 (incident patterns), R3 (payments). Targets: OWASP ASVS L2 (server), MASVS (mobile). **Nothing here is legal advice; the biometric DPIA (Q45) is an external gate.**

## 1. Trust boundaries

| # | Boundary | Assets crossing |
|---|---|---|
| TB1 | Unified mobile client ↔ API/realtime gateway | session tokens, trip state, location samples, KYC uploads (presigned), payment intents |
| TB2 | Rider mode ↔ Driver mode inside one binary | mode preference, cached state, FGS lifecycle, notification routing |
| TB3 | Driver background worker ↔ OS/OEM | location stream, FGS notification, battery/permission state |
| TB4 | Staff web (ops/T&S/finance) ↔ API | PII views, KYC evidence, money actions, config |
| TB5 | API ↔ providers (maps, OTP/SMS/WhatsApp, KYC, PSP, push, storage, email) | API keys, webhooks, PII subsets |
| TB6 | Provider webhooks → API | payment events, SMS delivery receipts, KYC results |
| TB7 | Public website / web booking ↔ API | lead data, scoped trip-status tokens |
| TB8 | Realtime subscriptions (sockets) | trip/driver location fan-out |
| TB9 | Data stores (Postgres, Redis, object storage, telemetry, backups) | everything at rest |
| TB10 | Build/release pipeline → stores | signing keys, provenance |

## 2. STRIDE summary per boundary (controls → requirement IDs)

| Boundary | Spoofing | Tampering | Repudiation | Info disclosure | DoS | Elevation |
|---|---|---|---|---|---|---|
| TB1 mobile↔API | OTP replay/brute force, SIM swap, recycled numbers → K08/S12/K17; device binding + Play Integrity/App Attest as **signals** Q02/Q03 | client-sent fare/role/KYC/time ignored (CLAUDE.md §9) → E05/K12/Q23; mock-GPS signals N18 | all transitions server-timestamped + audited I10/Q39 | least-data responses, no CNIC/phone in trip APIs N19/L27 | per-identity/device/IP limits Q05/Q06 | capability derived server-side V02; no local flags docs/18 §D |
| TB2 mode↔mode | mode switch as "role grant" → V02/V04 (INV-05/06) | cached driver state after suspension → recovery §6 of role model | — | rider screens reading driver data → V07 role-scoped queries | driver workers in rider mode → V06/V11 | deep-link context escalation → L14/V08 server re-check |
| TB3 driver worker | spoofed location/emulator → N18, Q03 | battery-saver kills → M26 fallback, server STALE handling | FGS stop logged | precise location retention Q24/Q25 | OEM kill → SP-01 | FGS started from background (Android 12+) → M26 design |
| TB4 staff | credential stuffing on staff → K10/Q42 SSO+MFA | manual ledger edits → G06/T24 maker-checker | append-only audit Q39, reason-for-access W07 | wildcard PII access → H03/H08/K11 vault, city/tenant scopes | — | role escalation/IDOR → H01 authorization-matrix tests, break-glass H08 |
| TB5/TB6 providers | forged webhooks → G02 signatures + replay window + idempotent writes; JazzCash hash **always** verified server-side + status inquiry (R3 §3) | vendor data changes → tolerant-but-safe parsing docs/27 §3 | provider event ids stored uniquely INV-11 | PII minimisation per vendor Q43/Q44, DPAs K22 | provider outage → circuit breakers I11, degraded modes CLAUDE.md §13 | key leakage → Q07 rotation runbook, U07 vendor kill switch |
| TB7 web | fake "Wayvro" sites/APKs → W04/Q49 official-channel list | lead-form injection → input schemas | — | map keys/trip tokens in page source → W09 | bot booking → W09/Q05 | — |
| TB8 realtime | unauthenticated subscribe → authenticated, per-trip scoped channels docs/06 | out-of-order events → sequence/version checks docs/07 | — | co-rider location leakage (pool) F07 | socket floods → connection limits I14 | subscribing to another trip id → scope tests |
| TB9 stores | — | ledger mutation → append-only G06 | — | CNIC/selfie leak RSK-012 → separate encrypted vault K11/Q08, presigned short-TTL URLs, telemetry default-deny Q36 | backup loss → Q20/Q21 restore drills | DB creds in app → I04 least privilege |
| TB10 release | unsigned/cloned builds → Q10 provenance, Q12 key custody | OTA update tampering → EAS Update signing (ADR-031) | — | secrets in CI logs → Q07 | — | store account takeover → T21 MFA |

## 3. Abuse cases (each becomes a negative acceptance test; sourced patterns from R6/R3 marked ★)

| # | Abuse | Control | Test family |
|---|---|---|---|
| AB-01 | OTP pumping / SMS bombing via signup form | K08 caps by number/device/IP/ASN, vendor budget alarms, CAPTCHA-free risk scoring | security/load |
| AB-02 | Recycled SIM inherits old account ★ | S12 re-verification on inactivity + device change, high-risk reauth | security |
| AB-03 | Account farm via SIM farms ★ (200+ SIMs seized, Lahore 2025) | device integrity + velocity + duplicate-identity checks K07; promo eligibility P11 | security |
| AB-04 | Recycled driver records from defunct platforms passing verification ★ | K07 document-hash dedupe across applications; reviewer checklist; vehicle-level history D26 | security |
| AB-05 | Fake/cloned app robbery ★ | W04 official channels, Q49 store-only distribution, in-app "verify your ride" (C01) and PSCA QR display (R46) | ops-drill |
| AB-06 | Pre-payment scam ("pay via JazzCash before pickup") ★ (inDrive blocked 80k accounts) | in-app messaging policy P01 blocks payment solicitation keywords/links; rider education; no off-platform payment flows | security/unit |
| AB-07 | Driver demands cash above app fare, then cancels ★ | M10 dual confirmation, O17 dispute, N02 enforcement, cancellation forensics C09 | api-e2e |
| AB-08 | Driver takes cash and marks ride cancelled to avoid commission ★ | trip telemetry vs cancel pattern E09/N04; commission on completed-by-telemetry; audit | unit/integration |
| AB-09 | Mock GPS / teleport to farm incentives or fake arrival | N18 integrity signals, geofenced arrival D10, incentive fraud limits D17 | integration |
| AB-10 | Account sharing / renting driver accounts ★ | K18 risk-triggered selfie recheck (parked only), D27 single session, device fingerprint | security |
| AB-11 | Vehicle swapped for unapproved vehicle | M16 vehicle switching checks, N17 plate rechecks, rider mismatch report B13/N16 | api-e2e |
| AB-12 | Post-trip contact / stalking via leaked number ★ | N31 masked channel expiry, N19 history redaction, report reason + no-rematch N03 | security |
| AB-13 | Harassment / assault (rider or driver victim) ★ | N24 specialist handling, R47 FOSPAH kit, SOS C04/N10, evidence chain N13 | ops-drill |
| AB-14 | Staff insider exports PII | W07 reason-for-access, approval-gated exports, Q39 audit, U08 workstation controls | security |
| AB-15 | Webhook replay / duplicate capture | INV-11, G02 | concurrency |
| AB-16 | Refund fraud / chargeback abuse | G08 maker-checker, O22 evidence, risk flags I13 | api-e2e |
| AB-17 | Promo stacking / self-referral | P11/P12/G15 | unit |
| AB-18 | Scraping driver positions from supply preview | B26 jitter/aggregation/rate limits | security/load |
| AB-19 | Pool co-rider privacy leakage | F07/N26 | security |
| AB-20 | Mode-switch escape from active job | INV-06 | api-e2e |
| AB-21 | Deep link / push payload trust | L14/V08 server re-authorisation | mobile-e2e |
| AB-22 | Rooted device spoofing Play Integrity ★ | integrity as signal only; payouts gated on `MEETS_DEVICE_INTEGRITY` + other signals (R4 §7) | security |

## 4. Biometric / KYC privacy (DPIA questions for Q45; ADR-017)

1. **Necessity & proportionality:** why CNIC front/back + live selfie for drivers; why not for riders by default (K20/L28); what manual non-biometric path exists (K03).
2. **Legal basis today:** no enacted PDP law; consent + contract + legitimate purpose documented (A04/K14); re-assess on enactment (draft classifies biometrics as sensitive, requires explicit consent and localisation of "critical" data).
3. **Accuracy & bias:** face comparison is one signal; calibrated thresholds on representative Pakistani devices/lighting; false-match and false-non-match rates measured before use; human review always decides (K04).
4. **Retention:** minimum per artefact (proposal: CNIC images until verification + statutory retention set by counsel; selfie until decision + appeal window; derived match scores not retained beyond decision); legal holds; deletion pipeline Q24/Q47.
5. **Access:** vault-only, reviewer role, reason-for-access, time-bounded sessions, no export, audit (K11/W07).
6. **Vendors:** if a liveness vendor is used, DPA, sub-processors, region (EU/US hosting — cross-border review Q44), exit path (K22).
7. **Breach:** 72-hour notification readiness per draft PDP; U09 playbook.
8. **Appeals & correction:** K05/K14; no automated rejection without human path.
9. **Women-focused eligibility (CL-17):** Wayvro never algorithmically infers gender from face, selfie, name, CNIC number, photograph or any proxy; eligibility uses an explicit, consent-based, privacy-minimised, counsel-reviewed policy with qualified human review, fallback and appeal; an attribute explicitly present on an authoritative document may be checked only for a counsel-approved limited purpose; identity evidence is never exposed to riders/drivers; inclusion/edge cases remain an external decision (K21/F09/M05).
11. **V1 implementation boundary (FD-06/CL-19):** no in-house face-recognition or liveness ML; guided capture + human/manual review (supervised/in-person where needed); automated liveness/face-to-ID only via a vetted provider after this DPIA, accuracy/bias review and DPA; a manual selfie upload is never labelled "liveness passed"; no NADRA claim without authorised access; no real CNIC/selfie data before the privacy/security/legal gate.
10. **Periodic selfie rechecks:** risk-triggered, never while driving, manual alternative (K18).

## 5. Secrets, PII and telemetry rules (operationalise CLAUDE.md §11)

- Secret classes: provider keys, signing keys, DB credentials, JWT/HMAC keys, store credentials → managed secret storage with owner/rotation/scope (Q07); never in repo, prompts, fixtures or screenshots (R45).
- PII classes and handling: identity evidence (vault, encrypted, presigned), contact (hashed where only equality needed, e.g. phone lookup), precise location (TTL, downsampling Q25), payment tokens (PSP-held only, O02), support attachments (quarantine, retention).
- Telemetry default-deny list (Q36): CNIC, selfie/biometric, tokens, card data, OTPs, full phone, precise long-term location, support attachments; structured error codes only (CLAUDE.md §13).
- Logs/metrics segmented by mode without identifiers (V12).

## 6. Device integrity and attestation (ADR-024)

Play Integrity (10k req/day free default) and App Attest are **risk signals**: required for payouts/payee changes (O19), promo redemption, driver go-online scoring; never a hard block for rider booking. Expect `STRONG` to fail on many legitimate budget devices and sideloaded installs to be `UNLICENSED`; combine with velocity/device-age/session signals and human appeal (Q03).

## 7. Supply chain, build provenance and release (Q09/Q10/Q12/Q49)

- Exact lockfiles (pnpm), Dependabot/Renovate with review, SCA (OSV/Snyk free), Semgrep CE SAST, gitleaks secret scan, Trivy container/IaC scan, licence inventory/SBOM (CycloneDX via `@cyclonedx/cyclonedx-npm`) — U03.
- Mobile: SDK inventory with data-collection purposes (U04); Apple privacy manifest audit in CI; Play AAB (evidence-based ABI set, 16 KB-compliant) and signed iOS production archive with keys/certificates in founder/company custody; provenance attestation (GitHub artifact attestations) links every Android and iOS binary to a reviewed commit SHA (Q49).
- OTA (EAS Update) only for JS; never changes native permissions; signed and staged (ADR-031).

## 8. Staff access and retention (K10/Q42/T05/U08)

SSO+MFA, least privilege by module (docs/28 §11), step-up for money/KYC/suspension actions, maker-checker (T24), break-glass with alerting (H08), joiner/mover/leaver drills (T05), privileged workstation baseline (U08), audit retention aligned to legal advice; regulator/police requests only through the lawful-request workflow (N14/R07).

## 9. Retention matrix (proposal for counsel; Q24)

| Data class | Proposed retention | Notes |
|---|---|---|
| Precise location samples | 30 days raw; downsampled trip polyline for trip retention period | Q25 |
| Trip records / receipts | statutory financial retention (accountant) | pseudonymise after account deletion |
| KYC images | per DPIA; minimum needed for verification + appeal + legal | vault, legal hold |
| Chat/call metadata | 90 days unless case-linked | P01/S10 |
| Safety incident evidence | case lifetime + legal hold | N13 |
| Telemetry/logs | 14–30 days | redacted |
| Consent records | life of account + statutory | A04 |

## 10. Security test plan by phase (feeds test families)
Phase 1: static/secret/SCA gates. Phase 2: auth/KYC adversarial suite (K13), authorization matrix tests (H01), vault isolation. Phase 4: concurrency/assignment, integrity signals, socket scope tests. Phase 5: ledger/idempotency/webhook replay (U14). Phase 6: evidence chain, lawful-request, staff access drills. Phase 7: independent penetration test (U01), chaos (Q33), restore drills (Q21), game day (U19). Every P0 feature has at least one negative/abuse test before pilot (docs/10).
