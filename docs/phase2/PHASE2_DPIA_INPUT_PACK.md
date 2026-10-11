# PHASE2_DPIA_INPUT_PACK — Inputs for the Driver/Partner KYC DPIA (Q45) and the data-location inventory (Q44)

**Date:** 2026-10-11 · **Status:** ENGINEERING INPUT ONLY. This is **not** a DPIA, a legal opinion or a transfer assessment. The DPIA itself, the lawful-basis analysis, retention periods, cross-border transfer decisions and vendor DPAs are external gates (EG-10, EG-11, EG-12, EG-13, EG-16; `docs/phase2/PHASE2_EXTERNAL_GATES.md`). No real person's data has been processed: everything in Phase 2 runs on synthetic data. · **Built from:** the implemented P2.5/P2.6 code and migrations 0004/0005, ADR-041, `docs/phase2/PHASE2_KYC_AND_EVIDENCE_VAULT.md`.

## 1. Purpose, necessity and scope
- **Purpose:** decide whether an applicant may earn as a Driver/Partner in the ONE Wayvro app, by human review of identity, licence, vehicle and the Punjab artefacts of the active requirement set. **No automated decision:** no edge of the application state machine reaches `VERIFIED` without a human reviewer (P2.7).
- **Data subjects:** Driver/Partner applicants only. Riders are not subject to KYC evidence (K20/L28 are LATER).
- **Necessity:** each requirement-set item lists the evidence kinds it needs (`compliance.document_types.evidence_kinds`). The pilot set is a **placeholder** (LHR/CAR v0, EG-03/EG-04), so the final matrix may require more or less.
- **Alternatives offered:**
  - manual review with an in-person path (`REQUIRE_IN_PERSON`, P2.7; operations EG-20);
  - an accessible, optional capture challenge with a neutral decline;
  - no automated biometric matching or liveness (any vetted provider is P2.A5, behind EG-08/09/10/11/12).

## 2. Data inventory (as implemented)
| Data | Where | Protection | Who can read |
|---|---|---|---|
| Legal name, CNIC, DOB claims | `compliance.driver_applications` envelopes | AES-256-GCM field envelopes (key classes `identity_numbers`, `identity_dates`), AAD bound to row/column; CNIC last 4 for masked display | API role. Staff see masked values (case view P2.7) |
| CNIC lookup | `compliance.cnic_lookup_index` | HMAC-SHA-256 (`cnic_lookup`); a match is a **signal**, never a rejection | API role |
| Document numbers | `compliance.compliance_documents` envelopes + HMAC lookup | as above | API role |
| Evidence images (CNIC, licence, selfie, vehicle documents) | object storage, `vault` area, as **sanitised canonical re-encodes** | per-object DEK (AES-256-GCM) wrapped by `evidence_kek`; metadata removed by construction; provider SSE | only the `wayvro_vault` role (API vault module, worker evidence jobs); staff only through the one-time view flow |
| Uploaded originals (pre-sanitisation) | object storage, `quarantine` area | provider SSE only. **Residual risk:** at most 24 h, or until processed | nobody through the API. The worker reads them once to scan and sanitise, then deletes them |
| Evidence metadata | `vault.evidence_objects` | storage keys, hashes, wrapped DEKs, dimensions, `capture_source` (client-declared, never a decision input) | `wayvro_vault` only (the API role has NO grant) |
| Evidence access log | `vault.evidence_access_log` (append-only) | staff id, session, reason code, event, break-glass grant | `wayvro_vault` (auditor viewer P2.7) |
| Capture challenges | `compliance.capture_challenges` | challenge code, status (incl. `DECLINED_ACCESSIBILITY`) | API role |
| Duplicate signals | `compliance.duplicate_signals` | ids only (CNIC/document/plate/evidence-hash matches) | API role; reviewers (P2.7) |

**Not collected anywhere:**
- no gender (checked by a schema scan test);
- no inferred attributes;
- no OCR output;
- no face templates or embeddings;
- no liveness scores;
- no NADRA/Verisys data.

## 3. Processing operations
1. **Upload slot:**
   - the slot is owner-scoped and needs consent first;
   - selfies are camera-only and documents may also be imported (JPEG/PNG only, ≤ 10 MB);
   - a 5-minute, single-object, quarantine-only upload URL is issued, with type and length bound by the signature.
2. **Completion:** a HEAD check of size, then the processing job.
3. **Worker:**
   - ClamAV scan;
   - isolated sanitiser container (no network, read-only, no secrets, non-root, memory/CPU/pids limits, per-image process, wall clock);
   - canonical re-encode (JPEG q88 or PNG, ≤ 2560 px);
   - SHA-256, then envelope encryption, then the vault area;
   - the quarantine object is deleted.
4. **Rejections:** malware, unsupported format, unreadable input or limits. The original is deleted and the applicant sees a user-safe reason (`SECURITY_CHECK_FAILED` for malware).
5. **Exact replay of an image on another application:** an `EVIDENCE_HASH_MATCH` signal for review. No perceptual matching and no face matching.
6. **Staff viewing:**
   - requires the permission, a fresh WebAuthn step-up, a reason from a closed list, city scope and no conflict of interest;
   - issues a one-time 60-second token bound to the session, then a decrypted stream with integrity check and no-store/inline headers;
   - every step is logged;
   - there is no export or bulk download;
   - case-claim scoping arrives in P2.7.
7. **Discard:** while the application is editable, the applicant can discard an upload and its stored objects are deleted.
8. **Orphan job:** daily, dry-run by default. It expires stale slots and reports or deletes unreferenced storage objects.

## 4. Access model
- **Staff:** code-defined roles (KYC reviewer, KYC senior reviewer and T&S hold `vault.evidence.view`) behind WebAuthn-only sign-in. Further controls:
  - idle lock 15 min;
  - break-glass ≤ 60 min, mandatory review and alert;
  - the audit viewer.
- **Real evidence in staging/production:** blocked by `ops.kyc-real-evidence` (OFF everywhere) until EG-05/EG-10/EG-17. When enabled, viewers need two registered authenticators.
- **Vendors:** no vendor processes evidence in Phase 2. Storage/KMS/scanner/sanitiser hosting is P2.A4.

## 5. Retention (placeholders, EG-16)
- `vault.evidence_objects.retention_until` and `legal_hold` exist but no period is configured. Retention periods are a counsel decision (EG-16).
- Account deletion and evidence-deletion processing arrive in P2.9 (deletion blockers, legal hold).
- Quarantine objects: ≤ 24 h by the orphan job (and provider lifecycle in production, P2.A4).

## 6. Rights, accuracy and appeals
- **Applicant view:** the applicant sees each upload's status and reason, can discard and re-upload while the application is editable, and gets an itemised list of missing evidence before submission.
- **Rejections and appeals:** human decisions with an appeal to a different reviewer (P2.7).
- **Calibration:** two-reviewer sampling is proposed (P2.7).
- **Accuracy:** claimed values and reviewer-confirmed values are stored separately (no OCR).

## 7. Residual risks to assess (not resolved by engineering)
- **Forgeries and synthetic identities:** high-quality forgeries can pass manual review. Camera injection on rooted devices cannot be prevented without attestation (Q02/Q03, Phase 4).
- **Quarantine originals:** they keep their metadata (EXIF/GPS) for up to 24 h under provider SSE only.
- **Screenshots** of viewed evidence cannot be prevented, only deterred (per-view watermark in the viewer, P2.7) and logged.
- **Decoder vulnerabilities:** mitigated by loader blocking, limits, isolation and patching (ADR-041), but not eliminated.
- **Signatures in CI:** ClamAV signatures in CI are frozen at the image build date. Production freshness is P2.A4.
- **Key custody:** a local synthetic key ring in Phase 2. Production KMS custody and KEK rotation procedures are EG-05.

## 8. Data-location inventory (Q44 — every row needs counsel review before adoption, CL-13)
| Data store | Content | Location today | Location decision |
|---|---|---|---|
| PostgreSQL | identity, compliance, vault metadata, audit | developer machine and CI only (synthetic) | provisional Singapore (FD-03), migratable — EXTERNAL |
| Object storage | quarantine originals (≤ 24 h), encrypted evidence | local SeaweedFS (synthetic) | provider TBD (R2 candidate); Wayvro-held KEKs allow migration without re-encryption — EG-05 |
| KMS | KEK for field keys and evidence DEKs | none (local synthetic key ring) | TBD — EG-05 |
| Malware scanner | transient bytes in memory | local ClamAV container | hosting TBD (P2.A4) |
| Image sanitiser | transient bytes in memory | local per-image container | hosting TBD (P2.A4) |
| OTP vendor | phone numbers, message text | none bound | PK gateway / WhatsApp (Meta, cross-border) — EG-01 |
| Google/Apple sign-in | ID-token claims | none bound (P2.10, flags OFF) | cross-border — EG-06/EG-07 |
| Telemetry | no PII by design (redaction tests) | none exporting | TBD |
