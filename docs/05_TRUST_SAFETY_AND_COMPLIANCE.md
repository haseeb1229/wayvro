# 05 — Safety, Legal, Privacy, Fraud and Human Response

**No public launch without jurisdiction-specific legal counsel and operational testing.** This document is an implementation/compliance checklist, NOT legal advice or a final statement of Pakistan law.

## Regulatory dependencies
- SECP incorporation; business entity/beneficial ownership, tax/NTN/FBR/withholding sales tax as applicable.
- Punjab Transport Department / Punjab Transport Company route-permit, vehicle fitness, insurance, category and district applicability. July 2026 reporting refers to Section 44B per-district, per-platform route permits; a Punjab TNC operating licence requirement (reported basis MVO 1965 s.72-H; press reports about which incumbent was licensed first are SECONDARY_REPORT / NEEDS_OFFICIAL_RECONCILIATION), a mandatory Punjab Police character certificate for drivers (May 2026) and the PSCA QR panic-button mandate in Lahore (July 2026) were identified in Phase 0 — see `docs/phase0/PHASE0_LAUNCH_BLOCKERS.md` §B and requirement R46; confirm current enacted versions and enforcement with counsel.
- Other province/city rollout: Sindh, ICT, KP etc. require separate research. Islamabad reportedly rolled out online driver/vehicle registration in 2026; confirm current official rules before launch.
- Commercial vehicle, passenger and third-party liability insurance; written carrier/insurer coverage confirmation for ride-hail/pooling/bike/intercity.
- Driver vetting: identity/license validity through permissible providers, consent, human review, expiries, appeals and records. Never imply access to government API without an agreement.
- Data privacy: even if a comprehensive PDPL remains draft, apply privacy-by-design, confidentiality, purpose limitation, retention/deletion, breach response; review PECA, telecom, consumer, app-store rules with counsel.
- Payments: SBP rules differentiate PSP/PSO vs EMI; integrate licensed merchant/settlement partner. Internal ride ledger does NOT grant right to issue stored-value wallets or hold users' money.
- Employee/contractor and fleet relationships, insurance eligibility, labor obligations, anti-discrimination, tax and consumer terms must be reviewed.

## Driver & vehicle verification pipeline
See `docs/18_IDENTITY_AUTH_AND_KYC.md` for explicit CNIC front/back, live selfie/liveness, face-to-ID review, Google/Apple account linking, mobile OTP defenses, privacy retention and detailed verification acceptance tests. An automated face score NEVER authorizes a driver. Passenger CNIC/biometrics are not default mandatory.
Pipeline states follow the canonical driver-capability machine in `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` §3 (reconciled in Phase 0, CON-01): `DRAFT -> CONSENTED -> DOCUMENTS_PENDING -> SUBMITTED -> AUTO_CHECK_PENDING -> MANUAL_REVIEW -> NEEDS_INFO / REJECTED / VERIFIED -> ACTIVE_ELIGIBLE` with `EXPIRED`, `REVERIFY_DUE`, `SUSPENDED`, `APPEALED` paths; Punjab artefacts (police certificate, PSCA QR, district permits, fitness, insurance, token tax) are modelled under R46.
- Secure upload URLs, AV scanning, MIME validation and quarantine; minimum retention, encryption and signed access; manual review with approvals.
- ID never logged; avoid exposing unmasked CNIC/license. Driver photo, vehicle, plate shown only as operationally necessary.
- Periodic re-verification and daily eligibility at dispatch; a suspended driver cannot accept or start a trip.
- Optional background check only through lawful contracted channel; no unsupported claims of 'police verified'.

## SOS & incident response
- Rider and driver have fast emergency actions; safety screen must work in poor network conditions with clear call fallback.
- Severity codes S0 life-threatening, S1 imminent harm, S2 serious complaint, S3 ordinary support; differentiate law enforcement vs internal support.
- Incoming signal -> incident ticket -> page assigned trained human -> contact emergency services when necessary/possible -> safety follow-up -> restricted evidence -> decision -> audit/appeal.
- Threat-based trip termination, driver freezing, temporary payment holds if authorized, careful no-accusation process.
- Mandatory tabletop scenario testing: assault allegation, coercion, fake driver, vehicle mismatch, child at pickup, lost contact, medical emergency, theft, passenger harassment of driver, accident, driver GPS disabled, identity document leak.
- 24/7 support **must not be advertised** until actually staffed/resourced.

## Privacy architecture
- Profile and ID vault separate from routine operational tables; role-bound secure access and audit.
- Live precise trip location only to rider, relevant driver, authorized operations/safety and explicitly approved trusted-contact view with expiry.
- Aggregated analytics use pseudonymous IDs. Logs contain neither exact CNIC nor full address/GPS trace unless exceptional explicitly controlled telemetry storage.
- Retention matrix for location, trip history, KYC documents, communications, incidents, legal holds, consent and support evidence, verified by counsel.
- Users can revoke optional marketing and trusted-contact access; required trip location consent must explain service limitation.

## Security & fraud risks
- Account takeover, SIM swap, credential stuffing, OTP pumping, fake GPS, fake driver photos, account/device farms, promotion abuse, fare/bid manipulation, phantom trips, collusive driver/rider trips, driver/rider threats, payment replay, refund fraud, insider misuse, bulk scraping of personal data.
- Defenses: MFA for staff, device/session limits, risk rules + human appeal, webhook signatures, replay-window/idempotency, velocity limits, geofence sanity, immutable audit, separation of duties, least-privilege operations and abuse throttles.

## Women's mobility risk register
- Separate driver verification and sufficient supply, consent-based eligibility policy, optional rider preference and true women-only category semantics, protected identity evidence, safe boarding/driver mismatch, avoid false assurances.
- Test fail-closed scenarios: wrong driver arrives; co-passenger ineligible; driver cancels near pickup; woman driver replacement unavailable; support inaccessible; shared trip takes unsafe detour.

## Accessibility and fairness
- Low-literacy and low-connectivity workflows; Urdu/localized content; clear fare; screen reader and large text; voice-call fallback when permitted.
- Explain suspensions and safety hold decisions; records, appeal and independent human escalation. Avoid opaque discriminatory profiling.
