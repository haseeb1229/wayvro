# PHASE2_KYC_AND_EVIDENCE_VAULT — Driver/Partner onboarding, manual review and the evidence vault (PROPOSED)

**Date:** 2026-10-10 (planning closure correction applied the same day) · **Status:** Phase 2 PLAN ONLY. No upload, storage adapter, scanner, image processor or review code exists. **No real CNIC, licence, selfie, biometric or customer data is used in Phase 2** — synthetic, generated test images only. · **Requirements:** A15 (driver age), D01–D04, H02, K02–K07, K11, K14, Q08, Q36, Q44, Q45, R02–R06, R46, V03, W07 (evidence access). · **Boundary:** FD-06 / CL-19 / ADR-017.

## 1. The V1 KYC boundary, made testable

| Statement | How Phase 2 enforces it |
|---|---|
| Guided selfie/document capture is allowed | in-app camera screens with framing guides and simple client prompts (brightness/size only, no face models) |
| Pilot verification = qualified human/manual review (supervised/in-person where needed) | the only path to `VERIFIED` is a staff `APPROVE` decision with a recorded checklist; `REQUIRE_IN_PERSON` is a first-class decision |
| A selfie upload is **not** "liveness passed" | evidence kind `SELFIE_FOR_MANUAL_REVIEW`; a test scans contracts, enums and the localisation catalogue for liveness-success wording |
| Automated liveness / face-to-ID only via a vetted provider after DPIA/DPA/legal/privacy gates | no provider interface or code in Phase 2 (would be dead code); design in §9 (P2.A5) |
| Automated scores never activate a driver | no automated edge into `VERIFIED`; property test over system actors |
| Manual fallback and appeal are mandatory | camera denied / challenge inaccessible ⇒ alternatives, never rejection by itself; every `REJECT` appealable to a different reviewer |
| No NADRA claim | no NADRA/Verisys/Nishan code, wording or field |
| Gender is never inferred or recorded | no gender field anywhere in Phase 2; CL-17 |
| OCR never silently becomes identity truth | no OCR; claimed and reviewer-confirmed values stored separately |
| Capture source never proves authenticity | `capture_source` is client-declared metadata; manual review decides authenticity (closure correction §6) |

## 2. In-app Driver/Partner application flow (ONE Wayvro app; V01/V03)

Entry: account menu → **Earn with Wayvro** (flag `driver.onboarding`). Rider mode stays usable; no location/background-location permission in Phase 2; camera requested just in time.

| Step | Screen / action | Server effect |
|---|---|---|
| 1 | Explanation: data collected, purpose, access, retention, manual review, in-person alternative, appeal (K14; placeholder text until EG-02) | — |
| 2 | Accept `DRIVER_PARTNER_AGREEMENT` + `BIOMETRIC_KYC_NOTICE` | consent records; `DRAFT → CONSENTED` |
| 3 | City (`LHR`) and service category (`CAR`; bike/rickshaw shown as not yet available) | category junction rows; requirement set pinned at submission |
| 4 | Identity claims: legal name, CNIC number, date of birth | envelopes + CNIC lookup index; duplicate check enqueued; driver age evaluated by the reviewer against the age policy and licence (A15) |
| 5 | CNIC front/back — **camera capture or controlled import** (§2.1) | upload lifecycle §4 |
| 6 | Selfie for manual review — **camera only**; optional accessible capture challenge (§2.2) | challenge bound to the upload slot when used |
| 7 | Driving licence (front/back), class, number, expiry (claimed) — camera or controlled import | compliance document `SUBMITTED` |
| 8 | Vehicle: plate, details, ownership type (CL-10); registration document; authorised-use letter where needed | vehicle + affiliation; duplicate-plate signal |
| 9 | Punjab artefacts per active requirement set (44B route permit per district, VICS fitness, third-party insurance, token tax, police character certificate, PSCA QR panic button — R46) with expiries | compliance documents |
| 10 | Review & submit | `DOCUMENTS_PENDING → SUBMITTED` (idempotent) |
| 11 | Status: Submitted / In review / Needs information (itemised) / Rejected (reason + appeal) / Approved / In-person verification required | `GET /v1/driver-onboarding/applications/current` |

Offline/poor network: each step persists server-side when submitted; local capture files are deleted after confirmed upload, on abandon, logout and app-data clear.

### 2.1 Capture sources (founder Q-04, closure correction §6)

| Evidence | Allowed sources | Rules |
|---|---|---|
| Identity and vehicle **documents** | guided in-app camera **or** controlled gallery/file import (system photo picker; no broad storage permission) | accepted formats in V1: JPEG and PNG (iOS HEIC picks are exported as JPEG by the picker where available, otherwise the user is asked to retake with the camera); PDF not accepted in V1; every source enters the **identical** quarantine → scan → sanitise → review pipeline; `capture_source` recorded as metadata only |
| **Selfie** | in-app camera only, front camera | no gallery/file import option exists in the UI or the slot contract (`kind=SELFIE_FOR_MANUAL_REVIEW` slots accept only `capture_source=IN_APP_CAMERA`); this is a UX and integrity aid, **not** a security proof (a modified client can lie) |

Camera-only capture is not claimed to prove document authenticity; reviewers decide authenticity from the content.

### 2.2 Optional, accessible selfie capture challenge (closure correction §7)

- Purpose: an **optional anti-replay aid for manual review only**. It is never called or treated as automated liveness.
- The server picks one challenge from a small accessible set: e.g. *smile*, *neutral expression*, *turn your head slightly left*, *turn your head slightly right*, *look up slightly*, *raise either hand into the frame*. No fixed physical gesture (e.g. a specific hand/finger count) is mandatory for everyone.
- The applicant can tap **"I can't do this one"** to receive a different challenge, or **"None of these work for me"** to continue without a challenge; the status `DECLINED_ACCESSIBILITY` is shown to the reviewer as neutral information.
- **No applicant is rejected solely because a challenge was inaccessible or not performed.** Reviewers use other evidence, may request another capture, or choose `REQUIRE_IN_PERSON`.
- A challenge mismatch (wrong action, expired challenge) is shown to the reviewer as a reason to look more closely or escalate — not an automatic rejection.

## 3. Document matrix: configurable, not hard-coded (K06, R02–R06, R46)

`document_types` + `requirement_sets` + `requirement_set_items` express mandatory documents per city × category × ownership type, expiries, numbers, district scope, minimum validity, renewal lead and licence classes. Phase 2 seeds a **placeholder** `LHR/CAR v0` (`is_placeholder=true`, source "PHASE0_LAUNCH_BLOCKERS B2–B7, unconfirmed"); production refuses to activate placeholders and the evaluator reports `REQUIREMENT_SET_PLACEHOLDER`. No per-driver waiver exists (R06). Route permits are per vehicle **and per district** (`catalog.districts` FK). District-coverage dispatch checks are Phase 4; insurance-to-incident linkage is Phase 6.

## 4. Upload lifecycle (K02, K11)

```
App ─POST evidence-uploads {requirementKey, kind, captureSource, byteSize, mime}→ API (vault module):
     authorise owner + state + kind/source rules + limits; create evidence_objects SLOT_ISSUED;
     presign PUT to quarantine/<random>, ≤ 5 min, Content-Type + Content-Length signed
App ─PUT bytes→ object storage (quarantine; SSE; 24 h lifecycle expiry)
App ─POST …/completion→ API: HEAD object (size/type) → UPLOADED; enqueue processing job (same transaction)
Worker job: quarantine bytes → malware scan → isolated image sanitiser (decode with strict limits → re-encode canonical
            JPEG/PNG → metadata absent by construction) → verify result → hash → envelope-encrypt → vault/<random>
            → AVAILABLE | REJECTED_FORMAT | REJECTED_MALWARE | REJECTED_LIMITS; quarantine object deleted
```

- Opaque ids only; storage keys are 128-bit random and never returned; no URL stored outside `vault`.
- Upload URLs are quarantine-only, single key, ≤ 5 min, size/type signed; the S3 client uses `requestChecksumCalculation: 'WHEN_REQUIRED'` (ADR-010 finding), re-verified on SeaweedFS (P2.6) and the production provider (P2.A4).
- Limits (configuration): JPEG/PNG only; ≤ 10 MB per source object (imports can be larger than in-app captures); ≤ 40 objects per application; ≤ 10 slots per 10 min per account; slot TTL 10 min.
- Declared MIME/extension are never trusted for decisions; format is established by the decoder.
- Malware scanning: `MalwareScannerPort` with a ClamAV adapter speaking clamd `INSTREAM` over `node:net`; pinned `clamav/clamav` container in the local compose project (GPL-2.0, unmodified separate service). Scanner unavailable ⇒ object stays `UPLOADED` and retries; never marked clean.
- Integrity: `source_sha256` (original bytes, for exact-replay signals) and `canonical_sha256` (sanitised output) stored; AEAD tag verified on every staff view.
- Exact-replay detection: identical `source_sha256` or `canonical_sha256` on another application ⇒ `EVIDENCE_HASH_MATCH` signal (AB-04). Perceptual near-duplicate detection is possible later with the decoder but is not in Phase 2 scope.
- Failed uploads give a user-safe reason (`TOO_LARGE`, `UNSUPPORTED_FORMAT`, `UNREADABLE`, `SCAN_FAILED_TRY_AGAIN`); malware rejects are also a T&S signal.
- Orphan cleanup: daily job (dry-run mode first) for vault objects without metadata, expired slots and quarantine leftovers.

## 5. Image sanitisation security boundary (closure correction §8 — replaces the earlier hand-written parser proposal)

**Decision:** a hand-written JPEG-segment/PNG-chunk parser and metadata stripper is **not** the default security boundary. P2.6 **begins with a bounded technical evaluation** of a mature, pinned, scanned image-processing approach run in isolation; nothing is installed during planning. A custom parser may only be proposed later with evidence that every mature option failed the criteria, and requires explicit founder authorisation.

**Target security model:** quarantine → malware scan → **decode with strict byte, pixel, dimension, resource and time limits in an isolated process/container** → **re-encode to a canonical allowed format** (JPEG for photos/documents; PNG only when input is PNG and lossless is needed) → **metadata stripped by construction** (no metadata copied) → verify the result (re-decode, format, dimensions, size bounds) → hash → encrypt → vault.

**Isolation requirements:** a dedicated sanitiser process/container with no network, read-only root filesystem, no secrets/keys, non-root user, CPU and memory cgroup limits, per-job wall-clock timeout, one input per process invocation (or a short-lived worker pool recycled per N jobs), input via stdin/socket and output via stdout; a crash, timeout or limit breach marks the object `REJECTED_LIMITS`/retry — never clean.

**Candidates to evaluate (registry/advisory facts as of 2026-10-10; re-check at P2.6):**

| Candidate | Licence | Maintenance | Security notes | Fit |
|---|---|---|---|---|
| `sharp` 0.35.x (bundled libvips) in the isolated sanitiser | Apache-2.0 (libvips LGPL-2.1 shared library, prebuilt binaries) | very active | GitHub advisories in 2026 all **inherited from bundled native decoders**: libvips (2026-07), libheif (2026-09), librsvg (2026-10) — high severity; mitigations to evaluate: accept only JPEG/PNG (magic-byte pre-check so only those loaders run), libvips untrusted-loader blocking where supported, `limitInputPixels`, sequential read, fail on decoder warnings, prompt patching, isolation | **preferred candidate** pending evaluation |
| libvips CLI (`vips`) in a minimal pinned container | LGPL-2.1 | active | same decoder surface; distro patch cadence matters | alternative to sharp |
| Pure-JavaScript decoder/encoder (e.g. `jimp` 1.6.x) in the isolated sanitiser | MIT | maintained (2026) | memory-safe language removes native memory-corruption classes; DoS/limits still required; slower | fallback if native supply-chain risk is unacceptable |
| `jpeg-js` / `pngjs` directly | BSD-3 / MIT | no releases since 2022 / 2023 | historical infinite-loop/resource advisories (jpeg-js) | **rejected** (unmaintained) |
| ImageMagick | ImageMagick licence | active | long history of decoder CVEs; needs strict `policy.xml` | not preferred |
| Hand-written container parser | — | ours | parser risk is the reason for this correction | **not authorised** |

**Evaluation criteria (recorded in ADR-041 at P2.6 start):** current advisories and patch cadence; licence and redistribution in the container; native-binary provenance (checksums, prebuilt vs built from source, SBOM entry); decompression-bomb controls (pixel cap, dimension cap, byte cap) proven with crafted inputs; peak memory and CPU per image under limits; timeouts honoured; deterministic output; metadata absence in output verified by an independent reader; reproducibility on Linux CI and on the Windows developer machine (the sanitiser runs in a Linux container in both, so Windows native builds are not required); image size impact on the worker container.

**SEC-FILE tests (updated):** wrong/unsupported formats (incl. SVG, HEIC, WebP, TIFF, PDF disguised as JPEG) rejected before decoding; decompression bombs (huge declared dimensions, high-ratio PNG) stopped by pixel/byte caps; truncated/corrupt files rejected; polyglots (JPEG+ZIP, trailing data) produce clean re-encoded output without the payload; EXIF/GPS/XMP/ICC/text chunks absent from output (verified by an independent metadata reader); sanitiser crash/timeout/OOM ⇒ not clean; EICAR ⇒ `REJECTED_MALWARE`; output re-decodes within bounds.

## 6. Encryption and key responsibility (K11, Q08)

| Data | At rest | In transit | Key owner (proposal) | Status |
|---|---|---|---|---|
| PostgreSQL | provider volume encryption | TLS (`verify-full` enforced by existing staging/production rules) | DB provider + founder | EXTERNAL (hosting) |
| Field-encrypted columns | versioned AES-256-GCM envelope with AAD (data model §8), field data keys wrapped by KEK | TLS | `KeyProvider`: env key in local/test only; production KMS | local NOW; prod EG-05 |
| Evidence objects | per-object 256-bit DEK, AES-256-GCM, AAD binding object id + kind + envelope version; DEK wrapped by KEK; plus provider SSE | TLS; staff views streamed from the API | KMS (EG-05); rotation by re-wrapping DEKs | local NOW; prod EG-05 |
| Quarantine objects (≤ 24 h, pre-sanitisation) | provider SSE only | TLS | storage provider | accepted residual risk, documented |
| Backups | provider-encrypted; restore drill Phase 7 | — | founder/provider | EXTERNAL |
| Audit seal anchors | write-once external copy (DESIGN_NOW_ACTIVATE_LATER) | — | founder | EG-05 |

No analytics or bulk exports exist in Phase 2.

## 7. Reviewer access to evidence (H02, W07, K11)

1. Claim a case (city scope; conflict check against the staff member's declared consumer phone).
2. Case view shows masked data; thumbnails are not pre-loaded.
3. Viewing evidence requires a reason code (+ text for non-case reasons) → one-time, 60 s, staff-session-bound view token → API streams the decrypted, sanitised image with `Cache-Control: no-store`, inline disposition, strict CSP, no download control, per-view watermark overlay in the viewer (screenshots cannot be prevented — stated, not hidden).
4. Every view writes `vault.evidence_access_log` + audit; unusual volume alerts (AB-14).
5. **No bulk download or export of evidence or identity data in Phase 2** (closure correction §10); break-glass is the only out-of-scope route and is alerted.

## 8. Manual review (K04, K05, H02, D03, D04, A15)

Checklist (schema-versioned, stored on the decision): CNIC legibility and claim match; human identity-match assessment (`CONFIRMED_BY_REVIEWER` | `NOT_MATCHING` | `UNCERTAIN_ESCALATE` | `IN_PERSON_REQUIRED`, never a score); capture-challenge outcome if one was used (performed / declined for accessibility / mismatch / none); licence class vs category (R06), name, expiry; DOB vs the approved age policy's driver minimum and regulatory requirements (A15); vehicle and ownership evidence; Punjab artefacts per set; duplicate signals cleared or confirmed. Manual DLIMS/MTMIS public lookups may be recorded as reviewer checks (no integration, no government-verification claim). Decisions: `APPROVE` (step-up; second reviewer when a duplicate signal or in-person override is involved), `NEEDS_INFO`, `REJECT` (appealable), `ESCALATE`, `REQUIRE_IN_PERSON` (operations process, EG-20). Evidence relied on is linked through `review_decision_evidence`. Two-reviewer calibration sampling of approvals during the pilot (proposal 10 %).

Expiry: daily job + live evaluation; renewal via `DOCUMENT_RENEWAL` case. Re-verification: **policy-scheduled or risk-triggered** (`REVERIFICATION` case; auth design §5); never a blanket new-device rule. Appeals: routed to a `KYC_SENIOR_REVIEWER` who did not decide the original.

## 9. Duplicate and synthetic-identity defences (K07, D01)

Signals (never auto-decisions): CNIC lookup match, document-number match, evidence hash match, plate already affiliated, phone recently released, many applications per installation — each recorded with explicit subject/matched foreign keys and opening/annotating a review case. **No account merging** (data model §1). Residual risks stated: high-quality forgeries and synthetic identities can pass manual review; camera injection on rooted/emulated devices cannot be prevented without attestation (Q02/Q03, Phase 4); deepfakes are mitigated only by human review, the optional challenge and the in-person path.

## 10. Future vetted automated provider (P2.A5 — DESIGN_NOW_ACTIVATE_LATER)

Only after EG-08/09, EG-10, EG-11, EG-12: an `IdentityVerificationProviderPort` (created in that change) produces advisory `kyc_signals` attached to the case; no signal changes state or approves; thresholds may only route (priority / mandatory in-person); error rates measured before use; manual path and appeal unchanged; per-city flag; outage ⇒ manual path.

## 11. DPIA input pack and data-location inventory (Q45, Q44 — EXTERNAL decisions)

- **DPIA inputs:** purpose/necessity (drivers only; riders excluded — K20/L28 LATER), alternatives (manual/in-person, no automated biometrics), data inventory (§6, data model §9), access model (§7, staff matrix), retention placeholders (data model §7/§4.9), vendor access (none in Phase 2), breach hook (U09), appeals/correction (§8), accuracy/bias (calibration sampling), age/guardian policy (A15), capture-source and challenge accessibility design (§2.1/§2.2), residual risks (§9).
- **Data-location inventory:** PostgreSQL — provisional Singapore (FD-03), migratable; object storage — provider TBD (R2 candidate), Wayvro-held KEKs so objects can migrate without re-encryption; KMS — TBD; OTP vendor (numbers/message content) — PK gateway / WhatsApp (Meta, cross-border); Google/Apple ID tokens — cross-border; telemetry — no PII by design. Every provider row requires counsel review before adoption (Q44/CL-13).

## 12. Synthetic test assets

Generated at test run time: labelled synthetic PNG/JPEG images ("SYNTHETIC — NOT A REAL DOCUMENT"), metadata-bearing images (to prove removal), bombs, polyglots, truncated files, disguised formats, the EICAR test string, and fake CNIC numbers from a documented synthetic pattern chosen so it cannot match a real issuing-region prefix (the exact pattern is verified against official CNIC numbering before use — UNVERIFIED today). No real person or document imagery enters the repository.
