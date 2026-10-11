# Incident playbooks (Q06) — Phase 2

**Status:** written in P2.9 for review. These playbooks name the controls that exist in the code today and say plainly what is **not built yet** or **externally gated**. They have **not** been rehearsed: drills are a Phase 7 gate. Owners are roles, not people. No staffed rota exists yet.

Every step that touches production data needs a reviewed runbook, least privilege and audit (CLAUDE.md §6). Nothing here permits manual edits to live data, wiping data, or force-pushing.

## Roles
| Role | Responsible for |
|---|---|
| Incident lead (on-call engineer) | declares the incident, keeps the timeline, decides when to escalate |
| Security lead | containment decisions, key and credential actions, evidence handling |
| Trust & Safety lead | consumer restrictions, recovery cases, user communication content |
| Founder | external communication, regulator/counsel contact (U09 breach steps are counsel-dependent) |

## Shared first steps
1. **Open an incident record.** Use the time, a short description, the lead and the severity. Never paste OTPs, tokens, phone numbers, CNICs, images or keys into it (CLAUDE.md §11).
2. **Preserve evidence.** The audit trail is append-only and sealed by the `audit.seal` job, and `audit.verify-seals` re-checks the seals. Request `POST /v1/admin/audit-seals/verifications` and read `GET /v1/admin/audit-seals/status` (auditor) before and after containment.
3. **Contain first, then investigate.** Prefer reversible controls: feature flags, limits, restrictions and revocations. Avoid deletions.

## 1. OTP pumping or OTP bombing (A02/K08/Q06)
**Signals:**
- Log signals `OTP_IP_PREFIX_SOFT_LIMIT` and conversion-monitor elevation of an operator prefix (`PREFIX_FRICTION` suppression).
- A rising `OTP_CHALLENGE_SUPPRESSED` audit count.
- Daily or monthly send-budget exhaustion. Once a budget is spent, every request is refused with 503 (fail closed).

**Contain:**
- Lower `OTP_PHONE_SENDS_PER_HOUR`/`_PER_DAY`, `OTP_INSTALLATION_SENDS_PER_DAY`, `OTP_IP_PREFIX_SENDS_PER_HOUR_HARD`, `OTP_DAILY_SEND_BUDGET` or `OTP_PREFIX_ELEVATED_SENDS_PER_MINUTE`, then roll the API. These are configuration only; no code change is needed.
- If needed, unbind the delivery adapter. The API then answers 503 for every OTP request and never shows a fake success.
- Vendor-side caps and destination allow-lists are **EXTERNAL** (EG-01: no SMS vendor contracted).

**Recover:** restore the limits stepwise and watch prefix conversion.

**Not built:** automated prefix blocking and a pumping dashboard (Phase 7 observability).

## 2. Consumer session or credential compromise (K17/S12/S13)
**Signals:**
- `REFRESH_TOKEN_REUSE_DETECTED` security events (the session family is revoked automatically).
- Many `SIGN_IN_NEW_DEVICE` events, `DORMANT_ACCOUNT_NEW_INSTALLATION`, or `RISK_*` holds.
- User reports through support.

**Contain:**
- The user can revoke all sessions after a step-up, and can cancel an open phone change or recovery from any session ("this wasn't me").
- T&S can place an ACCOUNT restriction with `reason_class SECURITY_HOLD` through `POST /v1/admin/restrictions` (step-up). This blocks every consumer route except the restricted-session set.
- A driver earning hold is a DRIVER_ROLE restriction. Risk holds (`RISK_HOLD`) are created by the risk policy, and a REVERIFICATION case follows.

**Recover:**
- Lost phone: the strong-proof recovery case (in-person identity check + second senior + 72 h cooldown).
- Rider-only accounts without a strong factor continue with a new account; histories are never merged.

**Not built:**
- A staff route to revoke a consumer's sessions directly. Use a `SECURITY_HOLD`, which revokes access at the guard, until the support console arrives.
- SMS notices for the highest-risk events (EG-01) and push (Phase 4).

## 3. Staff account compromise (H01/H03/H08)
**Signals:**
- Unexpected `BREAK_GLASS_*` audit events, unusual `EVIDENCE_VIEW_ISSUED` volume in the evidence access log, or denied actions from one staff account.

**Contain:**
- Offboard the staff account (`POST /v1/admin/staff/{id}/offboarding`, staff admin with step-up). This revokes its sessions and credentials. A separate lost-device flow is **not built**.
- End any active break-glass grant and review the tagged actions.

**Recover:** re-enrol a security key after identity confirmation outside the compromised channel. Then review every action the account took in the window (audit viewer, paginated, no export).

**Externally gated:** an external identity provider or SSO for staff (not chosen) and production MFA attestation.

## 4. Suspected KYC evidence exposure (K11/U09)
**Signals:**
- `INTEGRITY_FAILURE` or `TOKEN_REPLAY_REFUSED` in the evidence access log.
- Unusual view-token issuance.
- A storage access anomaly. Provider logs are **EXTERNAL** (EG-05).

**Contain:**
- Turn the `ops.kyc-real-evidence` flag OFF. It is already OFF everywhere until the gates pass.
- Stop issuing view tokens by removing `vault.evidence.view` from the affected roles (code-defined roles; redeploy).
- Rotate the evidence KEK through the key provider (see playbook 6). Objects are sealed per object with wrapped DEKs.

**Breach notification:** the steps, deadlines and authorities are **counsel-dependent (U09)** and must not be improvised. Escalate to the founder.

**Not built:** automated anomaly alerts on view volume (Phase 7).

## 5. Provider outage (OTP delivery, object storage, malware scanner, image sanitiser)
- **OTP delivery down:** challenges end `DELIVERY_FAILED` and are never treated as verified. The app shows the honest error. No action is needed beyond monitoring the job dead letters.
- **Object storage down:** upload slots and evidence views answer 503. Uploads already confirmed stay `UPLOADED` until processing can run.
- **Scanner or sanitiser down:** evidence stays `UPLOADED`, never AVAILABLE ("never clean on failure"). The `evidence.process` job retries with backoff and dead-letters after its budget.
- **Deletion processing** waits whenever the vault pool or storage is unavailable. A request is never completed while evidence would remain.

## 6. Key rotation emergency (field key, lookup key, evidence KEK)
1. Mark the suspected key as no longer active in the key provider. Locally that is `WAYVRO_LOCAL_KEY_SPEC`; production is **EXTERNAL** until a KMS exists (EG-05).
2. Start the data migration with `pnpm --filter @wayvro/worker key-rotation start-field <schema.table.column>` or `… start-lookup`. Watch progress with `… status`. Every step is idempotent and resumable.
3. **Lookup keys:** after `READ_SWITCHED`, run `contract-lookup <rotationId>`, then `complete` once the old key is RETIRED in the provider. `complete` verifies zero old rows.
4. **Not built:** a KEK re-wrap job for evidence DEKs. Until it exists, a KEK compromise means turning the real-evidence flag OFF and running a reviewed re-wrap runbook.

## 7. Account takeover via a recycled number (S12)
**Built behaviour:** a dormant account signed in from an unknown installation gets a restricted session and the dormant-number review. "I'm new" releases the number, places a `SECURITY_HOLD` on the old account and starts a clean account. "This is my account" is accepted only with strong proof (driver identity check in person; linked OIDC from P2.10).

**If a takeover is suspected anyway:** place a `SECURITY_HOLD`, open a T&S review, and contact the owner only through a verified channel.

**Externally gated:** operator recycling data and any SIM-swap API (EG-22). The 90-day dormancy threshold is a provisional test value (founder Q-07).
