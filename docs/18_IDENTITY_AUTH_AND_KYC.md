# 18 — Identity, Authentication, CNIC, Selfie/Liveness and KYC (Explicit Requirements)

**Status: requirements proposal, not vendor selection, legal clearance, government access or a validated biometric system.** This document refines catalog K01–K24, existing A02/A03/A05/A11, D01–D04/D15, C02, H01/H02/H08, unified-app requirements V01–V14 and Phase 2. Feature priority does not override launch compliance.

## Actors, identity assurance levels and minimum data
- **Account/Rider profile:** phone number ownership via OTP at normal signup; contact and optional OIDC Google/Apple login. Every normal account can use Rider mode unless an account-wide restriction applies. Never request all passengers' CNIC/biometrics simply because the app is a taxi app; add extra checks only if specific verified legal or risk use case justifies them, with alternative access/review and a privacy assessment.
- **Driver/Partner profile linked to the same account:** stronger KYC prior to ACTIVE: +92 OTP, consent, CNIC front/back, suitable live selfie/liveness/manual alternative, careful identity comparison, driving license verification, vehicle details/registration, permits/insurance/fitness as locally required, staff approval, expiry controls. Verify **authenticity** through authorized human/process/provider, not by trusting OCR, model output or unapproved access to NADRA.
- **Staff:** separate identity realm with strong MFA, role/attribute controls, sensitive-action reauthentication, audit and constrained emergency access. Support must not impersonate passenger or driver sessions.
- **Fleet/partner representative:** owner and driver are distinct principals; delegated management never bypasses driver consent or central KYC approval.

## A. Phone login / SMS OTP
1. Normalize +92 Pakistani phone numbers to canonical E.164; test +92, 03..., spaces, invalid country codes, recycled numbers and roaming without asserting deliverability.
2. OTP issue/verify/resend with server-only source of truth, random cryptographically secure codes, strict expiry, single use, attempt limits, resend cooldown, generic responses without user enumeration, masked contact and replay protection.
3. Anti-OTP-pumping caps by number/device/IP/account/network/region, explicit monthly vendor cost budget, alerting and temporary blocks with appeal. Do not leak OTP in analytics, URLs, exception traces, screenshots or GitHub.
4. Explicit OTP SMS vendor failure/recovery route; local mock OTP in tests is **never** accepted in production. Never use a hardcoded master OTP/backdoor.
5. Account recovery and phone-number changes require controlled re-verification. Consider SIM swap, recycled numbers, recent device enrollment, risky transfers and cooldowns before high-risk actions.
6. Native platform auto-read/one-tap conveniences require policy and device testing; do not equate auto-read with verified authentication.

## B. OAuth/OIDC (Google and Apple)
- Optional account convenience, **not** proof of phone ownership or legal identity. Verify signed OIDC tokens server-side (issuer, audience, expiration, nonce/state/PKCE as applicable) and use provider immutable subject, not email as stable key.
- Google sign-in and Sign in with Apple are separately configured, policy- and platform-tested; Apple private relay, identity name shown only first sign-in, credential revocation and iOS review requirements are tracked.
- Account linking is an **explicit sensitive operation** requiring ownership verification of existing account and new provider; prevent same-email or changed-email account takeover, and preserve linked accounts when provider is unavailable.
- Social account is never implicitly granted 'verified driver' status. Rate limit, audit, unlink/recovery and test provider unavailability.

## C. Driver CNIC, selfie/liveness and document review

**V1 implementation boundary (founder decision FD-06, Phase 0 closure 2026-10-09):** Wayvro will **not** build its own face-recognition or liveness machine-learning system for V1. The pilot baseline is guided CNIC/document capture, human/manual authenticity review, and supervised/manual/in-person verification where needed; OCR may assist reviewers but must not silently become identity truth. Remote automated liveness and face-to-ID comparison may be enabled only through a vetted provider or authorised integration after DPIA, accuracy/bias/privacy review, contract/DPA and a fallback/appeal workflow. A manual selfie upload is never labelled "liveness passed"; NADRA integration is never claimed without actual authorised access; real CNIC/selfie data is not used before the relevant privacy/security/legal gate. Items 3–4 below describe the target capability once a vetted provider is approved.
1. Guided capture UI for ID front/back, readable text/face, glare/blur/crop checks, with explicit purpose, access, retention and consent disclosures. Reject malicious files and preserve secure resumable upload state.
2. Extract fields as **untrusted suggestions**. Verify human identity, document/expiry and class via lawful provider/manual review; do not claim government confirmation without an actual authorized relationship.
3. Capture live selfie in secure app flow; evaluate anti-presentation attacks (printed face, screen playback, deepfake/replay, device camera injection). **No vendor or model can guarantee** spoof-proof biometrics.
4. Compare live selfie against ID portrait as one signal, not sole irreversible rejection mechanism. Calibrate failure/uncertainty on target devices and representative conditions; protect against false matches and false nonmatches. Provide human/manual non-biometric fallback and appeals where warranted.
5. Never algorithmically infer gender, ethnicity, religion or sensitive traits from face, selfie, name, CNIC number, photograph or any proxy. Women-focused eligibility uses an explicit, consent-based, privacy-minimised, counsel-reviewed policy with qualified human review, fallback and appeal; an attribute explicitly present on an authoritative document may be checked only for a counsel-approved limited purpose; identity evidence is never exposed to riders or drivers.
6. Driver onboarding states: the canonical machine is `docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` §3 (DRAFT -> CONSENTED -> DOCUMENTS_PENDING -> SUBMITTED -> AUTO_CHECK_PENDING -> MANUAL_REVIEW -> NEEDS_INFO / REJECTED / VERIFIED -> ACTIVE_ELIGIBLE, plus EXPIRED, SUSPENDED, REVERIFY_DUE, APPEALED; phone verification is an account precondition, not an application state). Every transition is privileged, audited and reasoned. A face match score alone MUST NEVER set ACTIVE_ELIGIBLE; there is no automated approval path.
7. Verify driving license class/expiry, matched driver name, registration, vehicle ownership/authorized use, route permit, fitness/insurance categories and local legal availability via documented permitted process. Escalate mismatches; do not silently approve.
8. Photo/face data and CNIC go in separately controlled encrypted evidence vault, not standard profile/logs. Use restricted presigned uploads, antivirus/quarantine, access logs, time-bounded reviewer sessions, retention schedules, deletion and correction, incident response, vendor data-processing agreements and least privilege.
9. Allow re-submission, document re-verification after expiry/changes, suspension and appeals. Risk-based periodic live selfie only while parked/not on active ride, and with accessibility/manual recovery; prohibit opportunistic always-on facial monitoring.

## D. Session and authorization controls
- Model distinct `Account`, `RiderProfile`, optional `DriverProfile`/`DriverApplication`, `Credential`, `VerifiedPhone`, `LinkedOIDCIdentity`, `Session`, `Capability`, `RoleRestriction`, `AccountRestriction`, `IdentityEvidence`, `VerificationDecision`, `VehicleEligibility`, `ServiceEligibility`, `ConsentRecord`, `AuditEvent`, `Appeal` and client `ModePreference` with least-privilege schemas. These are conceptual entities; ADR chooses implementation. `ModePreference` is never authorization.

- One account may legitimately act as both rider and approved driver/partner. Do not create duplicate identities merely to support the two modes. Driver suspension/expired documents should normally remove earning capability while retaining lawful Rider-mode access; severe account-wide restrictions are modeled separately.
- Active-state authorization is server-enforced: an account cannot bypass an active trip/driver obligation by switching UI mode, reinstalling the app or changing devices.
- Secure tokens with rotation/revocation, device lost/logout-all, tight scopes, optional device binding and risk checks; encrypt stored secrets. Never use client-provided user/driver role, face outcome, document status or email_verified as authorization truth.
- Authorization object/resource boundaries are tested across passengers, drivers, fleets, reviewers, finance staff and cities; do not expose ID evidence through regular trip APIs.

## E. Provider decisions, pricing and rollouts
- Phase 0 ADR must compare SMS delivery/reliability in Pakistan, per-OTP costs, spam protection, Google/Apple auth compatibility, document OCR/liveness options, vendor contractual rights, biometrics/privacy obligations, provider outages, retention and API change risk.
- **Free-tier and test providers can be used locally**, but production rollout requires chosen vendors, verified contracts where needed and measured false-match/false-reject behavior. If automated face verification is unsuitable or unaffordable, use documented secure manual workflow rather than fake functionality or unvalidated AI.
- No real users' CNIC/selfie in LLM prompts, public demo data, issue attachments or test fixtures. All identity tests use synthetic or specifically licensed test assets.

## F. P0 acceptance and attack cases (must add to automated/manual tests)
- One OTP accepted exactly once; expired, wrong, brute-forced or replayed OTPs rejected; recovery does not bypass checks.
- Same phone account cannot accidentally generate duplicate active drivers; different users cannot read another user's KYC docs or evidence.
- Replayed selfie/deepfake/printed-photo/camera-injection attempts fail or route to **manual review** (not automatically approved).
- ID photo matches but license class is wrong => driver is not ACTIVE. Any permit/insurance expiry => cannot accept/continue new rides.
- Google/Apple same-email account linking without proof of ownership => rejected.
- Staff member without reviewer permission cannot approve driver; role escalation/IDOR denied, audited; privileged decision has evidence and actor.
- Phone gateway outage => honest error/fallback without bogus verification; app cannot skip verification due to connectivity.
- Manual fallback cannot secretly circumvent other legal document and licensing requirements.
- Women-only matching **never** infers eligibility from a face or automatically downgrades a booked mode; explicit consent + reviewer-approved criteria required.

**Phase 2 gate:** P0 K items have traced UX/API/data/roles/error/privacy/threat tests. Actual legal and provider validation remains a separate real-launch dependency.
