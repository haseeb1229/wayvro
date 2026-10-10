# PHASE2_KYC_AND_EVIDENCE_VAULT — Driver/Partner onboarding, manual review and the evidence vault (PROPOSED)

**Date:** 2026-10-10 · **Status:** Phase 2 PLAN ONLY. No upload, storage adapter, scanner or review code exists. **No real CNIC, licence, selfie, biometric or customer data is used in Phase 2** — synthetic, generated test images only. · **Requirements:** D01–D04, H02, K02–K07, K11, K14, Q08, Q36, Q44, Q45, R02–R06, R46, V03, W07 (evidence access). · **Boundary:** FD-06 / CL-19 / ADR-017 — no in-house face-recognition or liveness ML; manual review is the V1 baseline.

## 1. The V1 KYC boundary, made testable

| Statement | How Phase 2 enforces it |
|---|---|
| Guided selfie/document capture is allowed | in-app camera capture screens with framing guides, glare/blur prompts (client heuristics on brightness/size only, no face models) |
| Pilot verification = qualified human/manual review (supervised/in-person where needed) | the only path to `VERIFIED` is a staff `APPROVE` decision with a recorded checklist; `REQUIRE_IN_PERSON` is a first-class decision |
| A selfie upload is **not** "liveness passed" | evidence kind is `SELFIE_FOR_MANUAL_REVIEW`; no field, enum, string key or UI copy contains "liveness passed/verified"; a lint/test asserts the localisation catalogue and contracts contain no such phrase |
| Automated liveness / face-to-ID only via a vetted provider after DPIA/DPA/legal/privacy gates | no provider interface or code ships in Phase 2 (it would be dead code); the design for an advisory-signal integration is §9 (P2.A5, EXTERNAL_GATED by EG-08/09/10/11) |
| Automated scores never activate a driver | the application state machine has no automated edge into `VERIFIED`; a property test asserts that no sequence of system/job actors reaches `VERIFIED` |
| Manual fallback and appeal are mandatory | camera-denied → explained manual path (in-person verification request); every `REJECT` is appealable to a different reviewer |
| No NADRA claim without authorised access | no NADRA/Verisys/Nishan integration, wording or field; copy review in P2.8 |
| Gender is never inferred | no gender field in any Phase 2 table, contract or checklist; reviewers do not record gender; CL-17 |
| OCR never silently becomes identity truth | **no OCR in Phase 2**; applicants type claimed values, reviewers confirm against the image; claimed and confirmed values are stored separately |

## 2. In-app Driver/Partner application flow (ONE Wayvro app; V01/V03)

Entry: account menu → **Earn with Wayvro** (flag `driver.onboarding`). Rider mode remains fully usable throughout; no driver-only permission is requested until the step that needs it; **no location or background-location permission at all in Phase 2**.

| Step | Screen / action | Server effect |
|---|---|---|
| 1 | Explanation: what is collected, why, who sees it, retention, manual review, in-person alternative, appeal rights (K14 — placeholder text until counsel, EG-02) | — |
| 2 | Accept `DRIVER_PARTNER_AGREEMENT` + `BIOMETRIC_KYC_NOTICE` (versioned) | consent records; `DRAFT → CONSENTED` |
| 3 | City (`LHR`) and service category (`CAR`; bike/rickshaw shown as unavailable with "not yet available" — B15/FD-02) | requirement set pinned (placeholder in Phase 2) |
| 4 | Identity claims: legal name as on CNIC, CNIC number (13 digits, `#####-#######-#` format), date of birth | encrypted + lookup hash; duplicate check enqueued; age floor check (counsel-set; GAP-P2-01) |
| 5 | CNIC front, CNIC back — guided capture (camera permission requested **here**, just in time) | upload lifecycle §4 |
| 6 | Selfie for manual review: server issues a capture challenge ("raise your right hand with two fingers"); camera-only, front camera | challenge bound to the upload slot |
| 7 | Driving licence (front/back), licence class, number, expiry (claimed) | compliance document `SUBMITTED` |
| 8 | Vehicle: plate, make/model/year/colour, ownership type (incl. open-letter/hypothecated/company/family — CL-10); registration book/card; authorised-use letter where ownership ≠ applicant | vehicle + affiliation; duplicate-plate signal |
| 9 | Punjab artefacts per the active requirement set (route permit per district — 44B, VICS fitness, third-party insurance, token tax, police character certificate, PSCA QR panic button — R46) with expiry dates where applicable | compliance documents |
| 10 | Review & submit (checklist shows missing items with reasons) | `DOCUMENTS_PENDING → SUBMITTED` (idempotent) |
| 11 | Status screen: Submitted / In review / Needs information (exact items + reviewer's user-safe reason codes) / Rejected (reason + appeal) / Approved — next steps / In-person verification required | reads `GET /v1/driver-onboarding/applications/current` |

Offline/poor network: each step persists server-side as soon as it is submitted; capture files stay in the app cache only until their upload is confirmed and are deleted on completion, failure-abandon, logout and app-data clear. Resume reloads server state (K19 baseline; full localized onboarding UX polish is K19/Phase 3).

## 3. Document matrix: configurable, not hard-coded (K06, R02–R06, R46)

- `document_types` + `requirement_sets` + `requirement_set_items` (data model §2.3) express which documents are mandatory per city × service category × ownership type, which have expiries/numbers/district scope, minimum validity at submission, renewal lead time, and allowed licence classes.
- Phase 2 seeds **one placeholder set** `LHR/CAR v0` flagged `is_placeholder=true`, `source_reference=PHASE0_LAUNCH_BLOCKERS B2–B7 (unconfirmed)`. It lets the whole pipeline be built and tested; **production refuses to activate placeholder sets** and the eligibility evaluator reports `REQUIREMENT_SET_PLACEHOLDER` in production. The real matrix is EXTERNAL (EG-03/EG-04: TNC safety protocols B2, 44B B3, police certificate B4, PSCA QR B5, VICS/insurance/token tax B6, licence categories B7).
- No per-driver waiver exists. Fleet/admin roles cannot bypass requirements (R06); the only lever is a new requirement-set version approved by a second `COMPLIANCE_ADMIN` with a source reference.
- Route permits are per vehicle **and per district** (`compliance_documents.district_code`); dispatch's district-coverage check is Phase 4 (K12/E08) using this data (R46 split noted in the matrix).
- Insurance: coverage status per vehicle/category is modelled; "claims contact linked to incidents" (R04) completes when incidents exist (Phase 6, N15 Phase 9).

## 4. Upload lifecycle (K02, K11)

```
App                        API (vault module)                   Object storage                Worker (vault job)
 | POST evidence-uploads  →  authorise owner+state+kind,          |                               |
 |  {requirementKey, kind,   limits; create evidence_objects      |                               |
 |   byteSize, mime}         SLOT_ISSUED; presign PUT to          |                               |
 |                           quarantine/<random>, 5 min,          |                               |
 |                           Content-Type + Content-Length signed |                               |
 | ← {uploadId, url, expiresAt, headers}                          |                               |
 | PUT bytes ──────────────────────────────────────────────────→  | (quarantine bucket, SSE,      |
 |                                                                |  24 h lifecycle expiry)       |
 | POST evidence-uploads/{id}/completion → HEAD object: size/type match → UPLOADED; enqueue scan job (same txn)
 |                                                                |  ← GET quarantine object ──── |
 |                                          validate container, strip metadata, malware scan, hash,
 |                                          dedupe hash check, encrypt (per-object DEK) → PUT vault/<random>
 |                                          → AVAILABLE | REJECTED_FORMAT | REJECTED_MALWARE; delete quarantine object
 | GET application (status per item, user-safe rejection reason)                                  |
```

Controls:
- **Opaque identifiers:** `evidence_objects.id` (UUIDv7) is the only id clients see; storage keys are separate 128-bit random values never returned to clients; no object URL is ever stored in non-vault tables or returned to staff/clients.
- **Scoped short-lived upload URLs:** presigned PUT only to the quarantine bucket/prefix, single key, ≤ 5 min, signed `Content-Type` and `Content-Length`; per ADR-010 the S3 client sets `requestChecksumCalculation: 'WHEN_REQUIRED'` (the default embeds an empty-body checksum and breaks presigned PUTs) — re-verified against SeaweedFS in P2.6 and against the production provider in P2.A4.
- **Limits:** JPEG or PNG only in V1 (no PDF, no HEIC — capture is in-app and produces JPEG); ≤ 5 MB per object (typical capture 0.3–1.5 MB at quality 0.7); ≤ 40 objects per application; ≤ 10 slots per 10 min per account; slot TTL 10 min; unfinished slots expire and their quarantine objects lifecycle-delete.
- **Content sniffing / extension distrust:** declared MIME and file name are ignored for decisions; the worker validates magic bytes (`FF D8 FF` / `89 50 4E 47 0D 0A 1A 0A`), walks the container structure with strict length checks (JPEG segments / PNG chunks + CRC), rejects trailing data and polyglots, enforces dimension bounds read from headers (e.g. ≤ 8,000 × 8,000) to stop decompression bombs, and **removes metadata** (JPEG APP1–APP15 incl. EXIF/GPS, PNG `tEXt/iTXt/zTXt/eXIf`) — no pixel decoding on the server in Phase 2, so no native image library is added. Full transcoding (e.g. `sharp`/libvips) is a deferred dependency proposal with its own CVE review.
- **Malware scanning boundary:** `MalwareScannerPort` with a ClamAV adapter speaking the clamd `INSTREAM` protocol over `node:net` (no npm dependency); a pinned `clamav/clamav` container is added to the local compose project (GPL-2.0, run unmodified as a separate service — licence note in ADR-041 proposal). Scanner unavailable ⇒ object stays `UPLOADED`, job retries with backoff, never marked clean. Production scanner hosting is part of EG-05.
- **Integrity:** SHA-256 of the sanitised bytes stored; the encrypted object carries the AEAD tag; every staff view re-verifies the tag; mismatch ⇒ `INTEGRITY_FAILED` alert, object withheld.
- **Exact-replay detection:** identical sanitised-bytes hash already seen on another application ⇒ `EVIDENCE_HASH_MATCH` duplicate signal (AB-04). Perceptual near-duplicate detection needs pixel decoding → deferred with the transcoding proposal.
- **Failed uploads:** client sees a user-safe reason (`TOO_LARGE`, `UNSUPPORTED_FORMAT`, `UNREADABLE`, `SCAN_FAILED_TRY_AGAIN`) and retakes; malware rejects are additionally a T&S signal; no partial object reaches the vault.
- **Orphan cleanup:** daily job deletes vault objects whose metadata row is missing or `DELETED`, metadata rows whose slot expired without upload, and quarantine leftovers older than 24 h (also bucket lifecycle); counts are metrics; a dry-run mode is required before the first production run.

## 5. Encryption and key responsibility (K11, Q08)

| Data | At rest | In transit | Key owner (proposal) | Status |
|---|---|---|---|---|
| PostgreSQL (all schemas) | provider disk/volume encryption | TLS (`sslmode=verify-full` enforced by existing staging/production config rules) | DB provider + founder (ADR-028) | EXTERNAL (hosting) |
| Field-encrypted columns (phone, CNIC, licence/registration numbers, legal name, DOB, OIDC email) | AES-256-GCM, `key_id` per row, KEK-wrapped data keys | TLS | Wayvro `KeyProvider`: local env key (local/test only, refused elsewhere); production KMS | local NOW; prod EG-05 |
| KYC evidence objects | per-object 256-bit DEK, AES-256-GCM; DEK wrapped by KEK (`vault.evidence_objects.wrapped_dek`, `kek_id`); plus provider SSE | TLS to storage; staff viewing streamed over TLS from the API | KEK in KMS (HashiCorp Vault Transit, AWS/GCP KMS or an HSM-backed equivalent — choice EG-05); rotation by re-wrapping DEKs | local NOW; prod EG-05 |
| Quarantine objects (plaintext ≤ 24 h) | provider SSE only | TLS | storage provider | accepted residual risk, documented; alternative = upload-through-API (rejected for bandwidth/complexity, revisitable) |
| Backups | provider-encrypted; restore drill Phase 7 (Q20/Q21) | — | founder/provider | EXTERNAL |
| Analytics exports | none exist in Phase 2; W07 exports carry no evidence and are encrypted at rest with expiry | — | — | design |
| Audit seal anchors | write-once external copy (DESIGN_NOW_ACTIVATE_LATER) | — | founder | EG-05 |

Crypto uses only `node:crypto` (AES-256-GCM, HMAC-SHA-256, SHA-256, `randomBytes`, `timingSafeEqual`). Peppers/KEKs come from managed secrets (Q07) in deployed environments; local values are obviously fake and refused by staging/production config.

## 6. Reviewer access to evidence (H02, W07, K11)

1. Reviewer claims a case (city scope, not own/linked account — conflict check against `staff_accounts.conflict_phone_lookup_hash`).
2. Case view shows **masked** data (CNIC `35202-*******-1`, phone last4) and thumbnails are *not* pre-loaded.
3. Viewing an evidence item requires a **reason-for-access** (closed list: `CASE_REVIEW`, `APPEAL_REVIEW`, `DUPLICATE_INVESTIGATION`, `RECOVERY_VERIFICATION`, `LEGAL_REQUEST` (Phase 6 workflow) + free-text ≥ 10 chars for non-case reasons) → `POST /v1/admin/evidence-views` → one-time view token (60 s, single use, bound to the staff session) → `GET /v1/admin/evidence-views/{token}/content` streams the decrypted image with `Cache-Control: no-store`, `Content-Disposition: inline`, strict CSP, no download button, a visible per-view watermark overlay in the viewer UI (staff id + time) — screenshots cannot be technically prevented and this is stated, not hidden.
4. Every view writes `vault.evidence_access_log` and an audit event; unusual volume (e.g. > 50 views/hour per reviewer, views outside claimed cases) raises an alert (AB-14).
5. No bulk download, no export of evidence, no evidence in support/T&S views without a case link; break-glass is the only route outside scope and is alerted (H08).

## 7. Manual review (K04, K05, H02, D03, D04)

Reviewer checklist (structured, schema-validated, stored in `review_decisions.checklist`):
- CNIC: front/back legible; claimed name/number/DOB match the image; card not visibly expired; no visible tampering signs (font/layout inconsistency, edited photo area); portrait present.
- Identity match (human): selfie vs CNIC portrait → `CONFIRMED_BY_REVIEWER` | `NOT_MATCHING` | `UNCERTAIN_ESCALATE` | `IN_PERSON_REQUIRED`; capture challenge performed correctly (yes/no/unclear). **Never a numeric score.** Calibration: two-reviewer sampling of a percentage of approvals (proposal 10 %) during the pilot.
- Licence: class allows the requested category (R06), name matches, expiry confirmed; DLIMS public lookup performed manually where the reviewer has it (R2 §D — manual screen check, no integration, no claim of government verification).
- Vehicle: plate matches registration; ownership type evidence; authorised-use letter where needed; MTMIS public lookup manually where available.
- Punjab artefacts per requirement set: present, matching vehicle/district, expiry confirmed.
- Duplicate signals reviewed and cleared/confirmed (K07).
Decisions: `APPROVE` (step-up-fresh; second reviewer when a duplicate signal or in-person override is involved), `NEEDS_INFO` (itemised, user-safe reason codes), `REJECT` (reason codes, appealable), `ESCALATE`, `REQUIRE_IN_PERSON` (field verification — operations process, EG-20). Approval of the application creates the driver profile and the service-capability grants listed in the decision, inside one transaction.
Reason codes are a closed catalogue with user-facing localisation keys (no free-text reviewer notes reach the applicant).

Expiry monitoring (D03, SM-10): a daily job recomputes `VALID → EXPIRED` and the driver profile projection, writes in-app status, and feeds the ops expiry roster; the eligibility evaluator checks expiry live anyway (no job-lag window). Renewal = a `DOCUMENT_RENEWAL` review case; until approved the document stays expired.

Re-verification (`REVERIFY_DUE`): policy-driven (e.g. CNIC renewal, risk signal); risk-triggered periodic selfie rechecks are K18 (Phase 9) — Phase 2 only provides the case type.

Appeals: applicant submits a statement (+ optional new evidence) → `APPEAL` case routed to a `KYC_SENIOR_REVIEWER` who did not make the original decision → `UPHELD`/`OVERTURNED`.

## 8. Duplicate and synthetic-identity defences (K07, D01)

Signals (never auto-decisions): CNIC lookup-hash match with another application/profile; document-number hash match (licence, registration); evidence exact-hash match; plate already affiliated with another driver; phone recently released (recycled-number); many applications from one installation. Each opens or annotates a review case. Outcomes: cleared (legitimate: e.g. family vehicle), or confirmed fraud → `DRIVER_ROLE`/`ACCOUNT` restriction with appeal. Accounts are **never merged**; a person with an old account is guided to recover it (auth design §5).

Residual risks stated honestly (not "solved"): high-quality forged documents and synthetic identities can pass manual review; camera injection on rooted/emulated devices cannot be prevented without attestation (Q02/Q03, Phase 4 signals) and will not be claimed; deepfake selfies are mitigated only by the capture challenge, human review and the in-person path.

## 9. Design for a future vetted automated provider (P2.A5 — DESIGN_NOW_ACTIVATE_LATER)

Only after EG-08/EG-09 (vetted provider), EG-10 (DPIA, Q45), EG-11 (DPA/contract, K22), EG-12 (cross-border review, Q44 — candidate vendors are EU/UK/US-hosted, PK residency UNVERIFIED):
- A `IdentityVerificationProviderPort` (added in that activation change, not before) submits evidence references through a server-side adapter; results are stored as `kyc_signals` (provider, signal type `LIVENESS`/`FACE_MATCH`/`DOC_AUTHENTICITY`, provider decision, calibrated score band, provider reference, retention) attached to the review case as **advisory input** shown to the reviewer.
- No signal changes application state; thresholds can only route a case (e.g. priority or mandatory in-person), never approve; false-match/false-non-match rates measured on representative synthetic/consented data before use; manual path and appeal unchanged; feature flag per city; provider outage ⇒ manual path.

## 10. DPIA input pack and data-location inventory (Q45, Q44 — EXTERNAL decisions)

Phase 2 prepares inputs; a qualified person decides.
- **DPIA inputs (Q45):** purpose/necessity (driver identity and legal eligibility; riders excluded — K20/L28 LATER), alternatives (manual/in-person; no automated biometrics in V1), data inventory (§5 table + data model §8), access model (§6, staff matrix), retention placeholders (data model §7), vendor access (none in Phase 2), breach playbook hook (U09), appeal/correction (§7), accuracy/bias (human review calibration sampling; future provider measurement §9), children (age floor GAP-P2-01), residual risks (§8).
- **Data-location inventory for Phase 2 data classes (Q44):** PostgreSQL (all identity/compliance metadata) — provisional Singapore region (FD-03), migratable; object storage (evidence) — provider TBD (R2 candidate, global/APAC), behind `ObjectStoragePort` with documented export/migration (S3 API, re-encryption not required because objects are client-of-storage encrypted with Wayvro-held KEKs); KMS — TBD; OTP vendor (phone numbers, message content) — PK gateway (in-country) / WhatsApp (Meta, cross-border); Google/Apple (ID tokens) — cross-border; logs/telemetry — no PII by design, OTLP endpoint TBD. Each provider row is flagged "counsel review required before adoption" (Q44/CL-13 localisation migration path).

## 11. Synthetic test assets

Generated in tests at run time (no binary fixtures of people or real documents): solid-colour PNG/JPEG images labelled "SYNTHETIC — NOT A REAL DOCUMENT", valid and malformed containers, metadata-bearing JPEGs (to prove stripping), oversized dimension headers (bomb), polyglot JPEG+ZIP, trailing-data files, the EICAR anti-malware test string (harmless industry standard) for scanner tests, and fake CNIC numbers from a synthetic pattern documented in the test helper, chosen so it cannot match a real issuing-region prefix (the exact pattern is verified against official CNIC numbering before use — UNVERIFIED today). gitleaks remains clean; no screenshot of real identity data enters the repository.
