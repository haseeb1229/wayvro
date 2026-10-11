# ADR-041 — Evidence vault: storage client, encryption, malware scanning and the isolated image sanitiser

| Field | Value |
|---|---|
| Status | **ACCEPTED on P2.6 evidence** — pending founder/ChatGPT review of the full Phase 2 branch |
| Date | 2026-10-11 |
| Supersedes | `docs/phase2/PHASE2_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-041 (proposal, revised by the planning closure correction) |
| Requirements | K11, Q08, K02 (backend), K03 (optional challenge backend), D02, D03, K07 (evidence signals), Q36, Q44/Q45 (inputs only) |
| Evidence | Step-0 evaluation below (synthetic inputs only); `packages/image-sanitiser`, `packages/vault-adapters`, `infra/sanitiser/`, `packages/db/migrations/0005_vault.sql` and their tests (listed in `docs/phase2/PHASE2_IMPLEMENTATION_RECORD.md` §P2.6) |

## 1. Step 0 — bounded image-processing evaluation (recorded BEFORE any sanitiser code)

**Candidate evaluated first:** `sharp` **0.35.5** with its prebuilt **libvips 8.18.7** (`@img/sharp-*` platform packages). It is already in the lockfile through Next.js, so the evaluation installed nothing. Inputs were generated at run time and labelled "SYNTHETIC — NOT A REAL DOCUMENT". No real document, selfie or person was used.

**Harness configuration:**
- `sharp.block()` on every libvips foreign loader except JPEG and PNG (SVG, HEIF/AVIF, WebP, TIFF, GIF, PDF, Magick, JP2K, JXL, FITS, OpenEXR, RAD, Matrix, PPM, CSV, VIPS, Analyze, OpenSlide, NIfTI, DcRaw, UHDR).
- A magic-byte pre-check, then confirmation that the decoder agrees on the format.
- `limitInputPixels` 40,000,000; dimension cap 10,000 px per side.
- `failOn: 'warning'`, `sequentialRead`, `cache(false)`, `concurrency(1)`.
- `.rotate()` bakes EXIF orientation into pixels. There is **no `withMetadata()`**, so no metadata is copied.
- Re-encode, then re-decode the output.

**Metadata was checked by an independent reader:** a scan of JPEG APPn/COM segments and PNG ancillary chunks written for the test only. It is not part of the product.

| Check (SEC-FILE) | Result on win32-x64 (Node 24.20.0) |
|---|---|
| JPEG with EXIF (incl. GPS), ICC (P3) and XMP → output has no APPn/COM metadata, no XMP or maker strings | **PASS** (in: APP1 Exif, APP1 XMP, APP2 ICC; out: none) |
| PNG with `tEXt`, `iCCP`, `eXIf` → output has none of them and no text payload | **PASS** |
| Decompression bomb: 30000×30000 single-colour PNG (2.6 MB file) | **PASS**: refused by the pixel cap in 2 ms; RSS delta about 0 MB |
| Truncated JPEG (60% of the bytes) | **PASS**: refused (`failOn: 'warning'`) |
| Polyglot: JPEG + appended ZIP payload | **PASS**: accepted and re-encoded; the payload and the `PK\x03\x04` marker are absent from the output |
| SVG (with script), PDF disguised as JPEG, WebP, TIFF | **PASS**: refused before decoding (magic bytes) |
| WebP passed straight to libvips (bypassing the magic check) | **PASS**: blocked at library level ("unsupported image format") |
| Output re-decodes as JPEG within bounds, with no exif/icc/xmp | **PASS** |
| Determinism: 5 runs on a 12 MP noisy photo | **PASS**: identical output hash |

**Performance** (12 MP / 7.6 MB JPEG; developer laptop, 8 logical CPUs, measured while an Android Gradle build ran in parallel, so these are upper bounds):

| Encoder setting | ms per image | Output |
|---|---|---|
| mozjpeg q90, full resolution | 12,354–17,667 (earlier run 15,423–16,238) | 5.6 MB |
| libjpeg-turbo q90, full resolution | 545–677 | 6.6 MB |
| **libjpeg-turbo q88, longest side ≤ 2560 px** | **563–685** | **1.8 MB** |

Peak RSS of the harness process was 86 MB.

**Other criteria:**
- **Licences:** sharp is Apache-2.0. libvips (LGPL-3.0-or-later) is used unmodified as a shared library inside the prebuilt binaries.
- **Provenance:** the `@img/sharp-*` platform packages are fetched with lockfile integrity hashes. They are prebuilt by the sharp project, with no install script.
- **Advisories:** GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c and GHSA-wq5f-xc86-pv6w are all fixed at or before 0.35.5. The 2026 advisories inherited from bundled libheif/librsvg affect loaders that are blocked here.
- **Patch cadence:** active.
- **Reproducibility:** the Linux container runs the linux-x64 prebuilt binaries in CI and on the Windows machine (Docker Desktop), so no Windows native build is required.

**Alternatives:**
- **libvips CLI container:** the same decoder surface, but it would need a distribution-patched libvips and a separate wrapper. Not needed.
- **`jimp`:** pure JS, but it pulls a duplicate zod 3 and has a slower cadence. A reversal target only.
- **`jpeg-js`/`pngjs`:** rejected, unmaintained.
- **ImageMagick:** not preferred (decoder history).
- **Hand-written parser:** not authorised and not needed.

**Verdict:** sharp/libvips meets every criterion, so **no custom parser is proposed**.

## 2. Decision

### 2.1 Image sanitiser
**Package and runtime:**
- Package: `@wayvro/image-sanitiser`, which declares `sharp` **0.35.5** and has no other runtime dependency.
- It runs **only inside its own Linux container** (`infra/sanitiser/Dockerfile`):
  - base image `node:24.20.0-trixie-slim@sha256:50c3b2f6988dfc307b86e5301d69611af31f4789bdf232863b07d3b02fe55ae0`;
  - sharp installed with `npm ci --omit=dev --ignore-scripts` from a committed `package-lock.json` (integrity-checked, linux-x64 prebuilt libvips);
  - non-root user `65532`.

**Pipeline (one image per process):**
1. Read stdin, refusing more than the byte cap.
2. Magic-byte allowlist: JPEG and PNG only.
3. Every other loader blocked.
4. Pixel cap 40 MP and 10,000 px per side.
5. `failOn: 'warning'`, sequential read, cache off, a libvips timeout, and a process wall clock.
6. Orientation baked in.
7. Re-encode to canonical output:
   - **JPEG**: libjpeg-turbo, quality 88, longest side ≤ 2560 px, sRGB;
   - **PNG**: only when the input is PNG, longest side ≤ 2560 px.
8. Metadata is **absent by construction**: nothing is copied.
9. Re-decode the output and verify format, dimensions and size.
10. Write a framed result to stdout: 4-byte header length, JSON header, then the image bytes.

**Exit codes:**
- 0: clean;
- 10 / 11 / 12: `UNSUPPORTED_FORMAT` / `LIMITS` / `UNREADABLE`;
- anything else, a signal, or a timeout: treated as `LIMITS`, never clean.

mozjpeg was rejected for the canonical encoder: it was 20–30× slower for a quality gain that does not matter for manual review.

### 2.2 Isolation
The worker calls the `ImageSanitiserPort`. The bound adapter in local and CI is `DockerSanitiser` from `@wayvro/vault-adapters`. For **each image** it runs:

`docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 65532:65532 --memory 768m --memory-swap 768m --cpus 1 --pids-limit 32 --tmpfs /tmp:size=8m,noexec,nosuid`

The image reference is pinned by digest outside local/test. There are no environment variables, volumes or secrets. Bytes go in on stdin and come out on stdout. The adapter also enforces a wall clock (`docker rm -f` of the named container on timeout) and an output size cap.

**This adapter needs the Docker CLI and daemon, and is refused in staging/production** by worker configuration. A worker must never hold a Docker socket in production. Production hosting of the same hardened container is **activation track P2.A4** (external gate EG-05), for example a dedicated sandboxed job runner or a sidecar service without network egress. Until then, staging/production have no bound sanitiser, so evidence stays `UPLOADED` and the pipeline reports dependency-unavailable: **never clean**.

### 2.3 Object storage
**Adapter:** `S3ObjectStorage` in `@wayvro/vault-adapters`, using the official AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` **3.1141.0**, Apache-2.0). The client is configured with `requestChecksumCalculation: 'WHEN_REQUIRED'` and `responseChecksumValidation: 'WHEN_REQUIRED'` (ADR-010 finding).

**Storage areas:**
- **`quarantine`**: the only area that ever gets a presigned URL. Uploads only, one random key, ≤ 5 minutes, with Content-Type and Content-Length signed. A 24 h lifecycle plus the orphan job clear it.
- **`vault`**: server-side access only. **No download presign exists anywhere.**

Each area maps to bucket + prefix by configuration. Local uses one SeaweedFS bucket with two prefixes; production buckets are P2.A4.

**Port and provider changes:** `ObjectStoragePort` grows additively by area-aware `head`, `delete` and `list`, plus a signed `contentLength`. The in-memory test double follows. Both ports `MalwareScannerPort` and `ImageSanitiserPort` join `PROVIDER_KINDS` (provider-interfaces).

### 2.4 Encryption
- **Per evidence object:** a fresh 256-bit DEK. The canonical bytes are sealed with the field-envelope v1 format (AES-256-GCM, random 96-bit nonce) under the DEK. The AAD binds `vault.evidence_objects.content`, the object id and the envelope version.
- **DEK wrapping:** with the `evidence_kek` key class (`FieldCipher`, AAD bound to the object row). Local/test take the KEK from the synthetic local key ring. Staging/production have no key provider until KMS custody (EG-05), so they refuse to boot, as for field keys.
- **KEK rotation:** re-wraps DEKs only.
- **Quarantine bytes** are protected only by provider SSE while they await scanning (≤ 24 h). This residual risk is accepted and documented (vault doc §6).

### 2.5 Malware scanning
**Adapter:** `ClamdScanner` (clamd `INSTREAM` over `node:net`, chunked, bounded by a timeout) behind `MalwareScannerPort`.

**Scanner service:**
- Local compose service `clamav`: pinned `clamav/clamav:1.4.6-debian13-slim@sha256:6d0680780fd29855cb7018f68272cb520821f614259e2066f8ec669069ac91b3` (1.4 LTS, GPL-2.0, unmodified, separate process).
- Bound to `127.0.0.1:${WAYVRO_CLAMAV_PORT:-23310}`. Port 3310 belongs to another project's container on the founder machine and is never touched.

**Failure behaviour:** scanner unreachable or erroring means the object stays `UPLOADED` and the job retries with backoff (never "clean"). A `FOUND` result means `REJECTED_MALWARE` plus an audit row.

**Signatures:** the pinned image ships the official signature databases (main/daily/bytecode CVDs, as of the image build).
- **Local default:** freshclam refreshes them.
- **CI:** sets `WAYVRO_CLAMAV_NO_FRESHCLAM=true`, which uses the bundled databases with no download. This avoids rate-limited signature downloads on shared runners; the signatures are therefore only as fresh as the pinned image.

Measured locally with freshclam disabled: healthy after 74 s, about 1.04 GiB RSS; the EICAR test string returns `Eicar-Test-Signature FOUND` and clean bytes return `OK`.

This proves the integration path and the rejection handling, not production detection quality. Production scanning and signature freshness are P2.A4.

### 2.6 Database boundary
- Migration 0005 creates schema `vault` and the NOLOGIN role `wayvro_vault`.
- `wayvro_api` and `wayvro_worker` have **no** privilege on `vault.*`.
- The API and worker open a second, small pool (`DATABASE_VAULT_URL`) as a member of `wayvro_vault`, and only `src/vault/**` receives it. ESLint/dependency-cruiser forbid importing vault internals from other modules.

## 3. Consequences
- Every evidence byte path is: quarantine → scan → isolated sanitise → hash → encrypt → vault. Declared MIME and `capture_source` never drive a decision.
- Local development and CI need Docker for the sanitiser and the scanner (already true for PostgreSQL/Valkey/SeaweedFS).
- Production evidence processing is impossible until P2.A4/EG-05 provide storage, KMS, scanner and sanitiser hosting. This is stated in the external-gates register, not simulated.

## 4. Reversal path
- `ImageSanitiserPort` makes the sanitiser swappable (libvips CLI or jimp container) without touching the domain.
- `ObjectStoragePort` makes the storage provider swappable; `MalwareScannerPort` makes the scanner swappable.
- If the sharp line stops being patched promptly, the reversal target is jimp inside the same container contract.
