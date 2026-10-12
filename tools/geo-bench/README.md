# tools/geo-bench — SP-04 Lahore geo benchmark harness (DEV-ONLY)

Implements the desk steps of `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md` §5 against the candidate adapters in
`packages/geo-adapters` (the same adapters and normalisation the API would use). It is a workspace package
(`@wayvro/geo-bench`, `tools/*` in `pnpm-workspace.yaml`) so it gets the repository's strict TypeScript, ESLint,
Knip and Vitest setup; it is never a dependency of a deployable app (dependency-cruiser `geo-bench-dev-only`), so it
cannot enter an api/worker/realtime artefact (ADR-045 ART-ISO).

**Status: SP-04 NOT RUN.** No field data (FA-05) and no evaluation keys (FA-06) exist. Unit tests use a synthetic
sheet and fake adapters only.

## What stays local and what may be committed

| Data | Where | Commit? |
|---|---|---|
| Working capture CSV (5-dp coordinates, founder text) | outside the repository, or `tools/geo-bench/.local/input/` | **never** |
| GPX tracks, photos | founder's device / private folder (or `.local/gpx/`) | **never** |
| Raw provider responses (`raw/*.json`: status + body, no URL/headers) | `tools/geo-bench/.local/runs/<run>/raw/` | **never** (vendor terms; delete after the analysis and ≤ 30 days after capture) |
| Run record, blind-rating sheet + key, route-review list, usage ledger | `tools/geo-bench/.local/` | **never** |
| `sp04-aggregate.md` / `sp04-aggregate.json` from `score` | `<run>/aggregate/` (or `--report-out`) | **yes, after review** — metrics, flags, ranks, case ids and enumerations only |

`tools/geo-bench/.local/` is git-ignored (root `.gitignore`; verified by a `git check-ignore` unit test). The CLI
refuses to read or write working data at any path inside the repository that git does not ignore. Before the aggregate
is written, the bench-data guard refuses output containing a number with 4+ decimals (no coordinate can appear — the
aggregate carries none at all), a key-shaped string, Arabic-script text or any founder free-text value.

## Founder instructions

### 1. Before (after FA-05 field drives and FA-06 evaluation accounts)

1. Create **separate evaluation** projects/accounts (never the production or OAuth projects): Google Cloud project with
   the Places API (New), Geocoding API and Routes API enabled; a Mapbox account. In each console set **hard daily/per-API
   quotas at or below the free tier** and a billing alert; restrict the Google key to those three APIs (and to your
   current public IP if practical). Optional for S3: start your own Photon/Nominatim/OSRM/Valhalla on a Pakistan
   extract (see "Open-stack benchmark services" below).
2. Put the keys/URLs in an env file **outside the repository** (e.g. `C:\Users\<you>\wayvro-private\geo-bench.env`):

   ```
   GEO_GOOGLE_API_KEY=...
   GEO_GOOGLE_ROUTES_TRAFFIC_AWARE=false
   GEO_MAPBOX_ACCESS_TOKEN=...
   GEO_PHOTON_URL=http://127.0.0.1:2322
   GEO_NOMINATIM_URL=http://127.0.0.1:8088
   GEO_OSRM_URL=http://127.0.0.1:5000
   GEO_VALHALLA_URL=http://127.0.0.1:8002
   ```

   Leave out any bundle you do not want to run. Never paste keys into chat, prompts, issues or screenshots.
3. Copy your working CSV (template columns, EXAMPLE rows deleted) to a private folder or to
   `tools/geo-bench/.local/input/`; GPX files (one per ROUTE leg, named as in `gpx_file_ref`) to a private folder or
   `tools/geo-bench/.local/gpx/`.

### 2. Validate the sheet (no provider is called)

```
pnpm --filter @wayvro/geo-bench bench validate --csv <path to working.csv>
```

(Through `pnpm --filter` the working directory is `tools/geo-bench`: pass absolute paths.) Errors (EXAMPLE rows, missing required fields per case kind, coordinates outside Pakistan, GPS accuracy > 10 m,
non-public places, broken route references, header mismatch) block a run. Warnings include the §2.2/§2.3 minimums and
conservative **personal-data warnings** (phone/CNIC/e-mail/plate patterns, "house"/"home" words, honorifics). A clean
scan does not certify the sheet — re-read every free-text cell yourself.

### 3. Run

```
node --env-file=<private>/geo-bench.env tools/geo-bench/dist/cli.js run --csv <working.csv> --gpx-dir <gpx folder>
```

(build first with `pnpm --filter @wayvro/geo-bench build`; `--env-file` is a Node 24 flag and keeps the keys out of
your shell history.) Options: `--repeats 3` (latency repeats of the full-query calls, §6), `--concurrency 2`,
`--case-list-version LHR-SP04-CASES-v1`, `--already-used <bucket>=<n>,…` (usage made outside the harness this month).

Spend control: before any call the harness computes an upper bound of billable units per bucket and **refuses to
start** if it would exceed 80 % of the monthly free allowance (allowance minus 20 %, threat model §6), counting the
local usage ledger of the current UTC month. During the run every call reserves its units first; the first refusal
stops the run (`BUDGET_STOPPED`, exit code 2). Allowances are planning-time ESTIMATES (Google 10,000 per Essentials SKU
/ 5,000 Routes Pro; Mapbox 2,500 Search Box sessions, 100,000 temporary geocodes, 100,000 Directions) — re-check the
price pages before running; your console quotas are the real backstop. With no key/URL set the command prints `NOT RUN`.

Outputs (all local): `run.json`, `raw/`, `plan.json`, `blind-rating-sheet.csv` + `blind-key.json`, `route-review.csv`.

### 4. Manual review

- **Blind rating (§5.5):** open `blind-rating-sheet.csv` without opening `blind-key.json`; for every answer fill
  `usefulness_0_3` (0 wrong/useless, 1 correct area only, 2 block/street or nearby landmark, 3 landmark/building level).
  Failed/no-address answers are pre-marked and scored 0.
- **Route review (§7.1):** for every row of `route-review.csv` fill `classification` = NONE / MINOR / CRITICAL; for
  CRITICAL also `critical_class` (WRONG_WAY, PRIVATE_OR_INACCESSIBLE, PROHIBITED_OR_CLOSED, UNSAFE_OR_IMPOSSIBLE,
  SYSTEMATIC_SEVERE_DEFECT) and, only when cleared, `cleared=Y` + `clearing_action` (GROUND_TRUTH_CORRECTED,
  PROVIDER_FIX_RERUN, FOUNDER_MITIGATION). `auto_hints` only prioritise the review. Claude classifies from the local
  geometry against your GPX/notes; you confirm.
- **Scoring inputs** (`scoring-inputs.json`, enumerations and numbers only): per bundle `G1`, `G2`, `G3`, `G5`, `G6`
  (PASS / FAIL / PENDING), `costPilotScore`, `costScaleScore`, `termsOpsScore` (0–100, from the evaluation doc §7
  arithmetic re-run at the freeze) and, for S2, `fa19WrittenConfirmation` (without it S2 G1 fails for any freeze).

### 5. Score

```
node tools/geo-bench/dist/cli.js score --run <run folder> --csv <working.csv> --gpx-dir <gpx folder> \
  --ratings <filled blind sheet> --review <filled route-review.csv> --scoring-inputs <scoring-inputs.json> \
  [--peak-sessions LHR-SP04-S4] [--report-out <folder>]
```

The score applies the §7 thresholds and the §12.2 weights exactly as approved before measurement (FA-07; pinned by a
unit test — never tuned after seeing results), evaluates every licence-coherent configuration inside a bundle (e.g.
S3 OSRM vs Valhalla, Photon vs Nominatim reverse; S2 Search Box vs temporary-geocoding autocomplete) and reports per
configuration: thresholds, gates G1–G6, weighted score, unresolved CRITICAL count and eligibility —
**any unresolved CRITICAL route finding ⇒ INELIGIBLE regardless of score**; missing review/ratings/inputs ⇒ PENDING;
a missed threshold ⇒ SHORTFALL_NEEDS_FOUNDER_ACCEPTANCE. The harness reading of details the documents leave open is
listed under `assumptions` in every report (A1–A9). Paired tests (§9) and the tie rule are done in the P3.7 analysis.

### 6. After

1. Review the aggregate; commit only `sp04-aggregate.*` (into the future SP-04 evidence record).
2. **Revoke the evaluation keys:** Google Cloud console → APIs & Services → Credentials → delete the key (or disable
   the evaluation project); Mapbox → Account → Tokens → delete the token. Remove the env file.
3. Delete `tools/geo-bench/.local/runs/*/raw/` after the analysis and at the latest 30 days after capture; record the
   deletion date in the evidence record. Keep GPX/photos private; delete raw tracks within 30 days of the ADR-006
   freeze (threat model T3-32).

## Open-stack benchmark services (CON-P3-14) — compose profile NOT DONE

The optional `infra/docker/geo-bench.compose.yaml` was **not created**: its images must be pinned by digest and the
digests could not be verified from this environment (no registry access was attempted, Docker is owned by other
work). Procedure for the founder/a later step, never started by any script automatically:

1. Choose releases (evaluation doc §3: OSRM v26.10.0, Valhalla 3.9.1, Photon 1.3.0, Nominatim 5.3.2 — prefer a patch
   release for OSRM) and their official images where they exist (OSRM `ghcr.io/project-osrm/osrm-backend`, Valhalla
   `ghcr.io/valhalla/valhalla`; Photon publishes release jars — build a local image from the jar; Nominatim's official
   project images or a reviewed, pinned community image). Resolve each tag to a digest
   (`docker buildx imagetools inspect <image>:<tag>`) and pin `image: <image>@sha256:<digest>`.
2. Compose project name `wayvro-geo-bench`, named volumes `wayvro-geo-bench-*`, ports bound to `127.0.0.1` only
   (2322 Photon, 8088 Nominatim, 5000 OSRM, 8002 Valhalla), separate from the default stack (`infra/docker`), started
   only by an explicit `docker compose -p wayvro-geo-bench -f infra/docker/geo-bench.compose.yaml up`.
3. Pakistan OSM extract: download a regional extract (e.g. a Geofabrik Pakistan `.osm.pbf`), verify its checksum,
   record the extract date (ODbL data — attribution "© OpenStreetMap contributors", share-alike for any derivative
   database; licence of the extract service to verify). Pre-process locally: OSRM `extract → partition → customize`
   (car profile, MLD), Valhalla tile build, Photon import (Pakistan-limited; languages default/en), Nominatim import.
   RAM/disk sizing for Pakistan is NF — measure and record it.
4. Never point the harness at the public demo/community servers (refused by the config loader).
