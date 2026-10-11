# ADR-010 — Object storage: local S3-compatible development server (production storage unchanged)

| Field | Value |
|---|---|
| Status | **Local development server: ACCEPTED (Phase 1 evidence)** — in force since Phase 1 review and merge (PR #1, merge commit `eaa1fcb`, 2026-10-10). **Production storage: still PROPOSED** (Cloudflare R2 candidate per `docs/phase0/PHASE0_ADR_BACKLOG.md`; not decided here) |
| Date | 2026-10-09 |
| Requirements | I01 (environment separation), I02 (synthetic data only), U03 (licence inventory); groundwork for KYC/evidence storage (K11/Q08) — **no storage feature is implemented** |
| Evidence | `tests/spikes/adr-010-s3-local-eval/` (`eval.mjs`, run against the compose service) and the research summary below |

## Context
Phase 0 required a local S3-compatible server chosen **after a licence/maintenance check** because the MinIO community edition was reportedly archived. This server is for **local development and CI only**; it never stores real user data and is never a production dependency.

## Candidates checked (sources accessed 2026-10-09; statements from vendor repositories/registries)
| Candidate | Licence | Maintenance (2026) | Verdict |
|---|---|---|---|
| **SeaweedFS** (`chrislusf/seaweedfs`) | Apache-2.0 | releases every 1–2 weeks; 4.48 published 2026-09-28 | **chosen** |
| RustFS | Apache-2.0 | very active, but 1.0.0 only on 2026-09-16 | fallback |
| Garage (Deuxfleurs) | AGPL-3.0 | active | rejected: AGPL needs an ADR exception (guardrails §2 stage 4) and a config file with an RPC secret |
| Adobe S3Mock | Apache-2.0 | active | rejected: presigned URLs are accepted without validating signature/expiry, so it cannot prove upload flows |
| Zenko CloudServer | Apache-2.0 | active code, but no current tagged container image | rejected |
| Versity S3 Gateway | Apache-2.0 | active | rejected: a gateway over other storage, not a dev-first server |
| LocalStack (S3) | Apache-2.0 repo archived 2026-03-23 + EULA | auth token/account required since 2026.03 | rejected |
| MinIO | AGPL-3.0 | repository archived 2026-04-25 ("NO LONGER MAINTAINED"); last image lacks a 2025 CVE fix | rejected |

Primary sources: github.com/seaweedfs/seaweedfs (+ releases), hub.docker.com/r/chrislusf/seaweedfs tags, github.com/rustfs/rustfs, github.com/deuxfleurs-org/garage, github.com/adobe/S3Mock, github.com/localstack/localstack + blog.localstack.cloud, github.com/minio/minio.

## Hands-on verification (this machine, 2026-10-09)
Image `chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` (`weed version` → `30GB 4.48 530be3e37 linux amd64`), started as `weed mini -dir=/data -master.telemetry=false -s3.config=/etc/seaweedfs/s3.json -bucket=wayvro-local`; ~75 MiB RAM idle; `/healthz` → 200; image contains `curl`/`wget` for healthchecks.

| Check (AWS SDK for JavaScript v3.1146.0) | Result |
|---|---|
| bucket pre-created at start; SigV4 put/get round trip | PASS |
| wrong secret rejected (`SignatureDoesNotMatch`); anonymous GET rejected (403) | PASS |
| presigned PUT and presigned GET | **FAIL with SDK defaults** (HTTP 400 `BadDigest`), **PASS with `requestChecksumCalculation: 'WHEN_REQUIRED'`** |
| tampered presigned signature rejected; presigned URL reused for another key rejected; expired presigned URL rejected | PASS (403 each) |
| multipart upload (5 MiB + tail) and listing | PASS |

**Finding that also applies to production:** AWS SDK v3's default flexible-checksum mode (`WHEN_SUPPORTED`) embeds `x-amz-checksum-crc32` of the *empty* request body into presigned PUT URLs; a server that verifies checksums correctly rejects the real upload. The future storage adapter (behind `packages/provider-interfaces`) must set `requestChecksumCalculation: 'WHEN_REQUIRED'` (or sign an explicit checksum of the actual payload) and must be re-verified against R2 before Phase 2 evidence uploads.

**Privacy finding:** SeaweedFS reports anonymous cluster statistics to `telemetry.seaweedfs.com` **by default**. The Wayvro compose service always passes `-master.telemetry=false`.

## Decision
- Local/CI S3-compatible server: **SeaweedFS 4.48**, pinned by digest, single-process `weed mini`, S3 on container port 8333 published on `127.0.0.1` only, **named volume** (`wayvro_s3_data`; the image declares `VOLUME /data`, which would otherwise create anonymous volumes), telemetry disabled, a local-only identity file (`infra/docker/seaweedfs/s3.json`) with obviously non-production credentials.
- Application code never imports an S3 SDK directly; storage stays behind the provider interface (CLAUDE.md §4). Phase 1 ships the interface only.

## Consequences
- Developers get real SigV4/presigned semantics locally (unlike S3Mock), so presigned-upload bugs surface before staging.
- The image is large (≈724 MB uncompressed) — acceptable for local/CI; CI pulls it only in the integration job.
- Licence obligations: Apache-2.0, used unmodified as a separate container — no redistribution.

## Alternatives / reversal path
RustFS (`rustfs/rustfs:1.0.1`, Apache-2.0) is the documented fallback if SeaweedFS regresses; swapping is a compose-only change because clients use plain S3 APIs through the provider interface. Garage remains possible with an AGPL exception ADR.
