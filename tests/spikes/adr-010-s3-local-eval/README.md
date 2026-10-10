# ADR-010 evidence — S3 semantics of the local SeaweedFS server (DISPOSABLE)

`pnpm install --frozen-lockfile --ignore-workspace`, start the Wayvro compose stack (`pnpm infra:up` at the repo root), then `S3_ENDPOINT=http://127.0.0.1:<s3 port> pnpm eval`. Checks SigV4 auth, anonymous rejection, presigned PUT/GET, tampered/expired/re-targeted presigned URL rejection and multipart upload. See `docs/adr/ADR-010-object-storage-local-s3.md`.
