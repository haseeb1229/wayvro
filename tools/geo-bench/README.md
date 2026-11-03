# tools/geo-bench — SP-04 Lahore geo benchmark harness (DEV-ONLY)

Implements the desk steps of `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md` §5 against the candidate adapters in
`packages/geo-adapters` (the same adapters and normalisation the API would use). It is a workspace package
(`@wayvro/geo-bench`, `tools/*` in `pnpm-workspace.yaml`) so it gets the repository's strict TypeScript, ESLint,
Knip and Vitest setup; it is never a dependency of a deployable app (dependency-cruiser `geo-bench-dev-only`), so it
cannot enter an api/worker/realtime artefact (ADR-045 ART-ISO).

**Status: SP-04 NOT RUN.** No field data (FA-05) and no evaluation keys (FA-06) exist (a DESK/open-data run of the
self-hosted open stack exists — LOCAL_SYNTHETIC_BENCHMARK, not field evidence; see the open-stack section). Unit tests use a synthetic
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

## Open-stack benchmark services (CON-P3-14) — compose profile PARTIAL (desk run only)

`infra/docker/geo-bench.compose.yaml` exists (evaluation/dev-only; never started by any other script). State on
2026-10-16: **Nominatim 5.3.2 and OSRM v26.10.0 built and run** on a Lahore clip of the Geofabrik Pakistan extract;
**Photon 1.3.0 and Valhalla 3.9.1 NOT RUN** (the release jar / image could not be downloaded over the available
bandwidth; their compose services are written but UNVERIFIED). Desk results, sizing, digests and limitations:
`docs/phase3/evidence/laptop/SP04_OPEN_STACK_DESK_BENCHMARK.md` — LOCAL_SYNTHETIC_BENCHMARK, desk/open-data, **not
field evidence**; it does not close FA-05/SP-04 and freezes nothing.

Rules: compose project `wayvro-geo-bench`, named volumes `wayvro-geo-bench-*`, ports bound to `127.0.0.1` only (2322
Photon, 8088 Nominatim, 5000 OSRM, 8002 Valhalla), images pinned by digest (listed in the compose header), memory
limits set, all data under the git-ignored `tools/geo-bench/.local/`. Never point the harness at public
demo/community servers (refused by the config loader).

### Reproduce (from the repository root, Git Bash; one heavy step at a time)

1. Data (ODbL — "© OpenStreetMap contributors"): download the dated Geofabrik extract the `pakistan-latest` link
   redirects to (e.g. `asia/pakistan-261015.osm.pbf`) and its `.md5` into `tools/geo-bench/.local/data/`; check
   `md5sum`.
2. Clip to the Lahore bbox `74.10,31.25,74.62,31.72` with complete ways, then export named features and the
   one-way/access-restricted highway ways (pyosmium 3.7 from the pinned Nominatim image; scripts in `desk-osm/`):

   ```
   IMG=mediagis/nominatim@sha256:7923a8e67197fc6d4f4ecb7c0e8bbedffeddcfdf4519596fe946e46a28f5a9f8
   V="-v C:/Dev/Wayvro/tools/geo-bench/.local/data:/data -v C:/Dev/Wayvro/tools/geo-bench/desk-osm:/scripts:ro"
   MSYS_NO_PATHCONV=1 docker run --rm --memory 2g --entrypoint python3 $V $IMG /scripts/clip.py \
     /data/pakistan-261015.osm.pbf /data/lahore-261015.osm.pbf 74.10 31.25 74.62 31.72
   MSYS_NO_PATHCONV=1 docker run --rm --memory 1500m --entrypoint python3 $V $IMG /scripts/export.py \
     /data/lahore-261015.osm.pbf /data/work/lahore-named.geojsonseq /data/work/lahore-restrictions.jsonl
   ```
3. Env file `tools/geo-bench/.local/geo-bench.env` (git-ignored): `GEO_BENCH_PBF=lahore-261015.osm.pbf` and a random
   local-only `GEO_BENCH_PG_PASSWORD`. Then (`C="docker compose -p wayvro-geo-bench -f infra/docker/geo-bench.compose.yaml --env-file tools/geo-bench/.local/geo-bench.env"`):
   `$C --profile prep run --rm osrm-prep`, then `$C up -d nominatim` (first start imports, ≈ 12 min on the clip),
   then `$C up -d osrm`. Photon/Valhalla (after verifying the jar sha256 / pulling the image): `$C --profile prep run --rm valhalla-prep`,
   `$C --profile prep run --rm photon-import`, `$C up -d photon valhalla`.
4. Desk cases: `node tools/geo-bench/desk-osm/gen-desk-cases.mjs tools/geo-bench/.local/data/work/lahore-named.geojsonseq tools/geo-bench/.local/input/lhr-desk-cases-v2.csv tools/geo-bench/.local/input/match-report.json`.
5. Harness (`--desk` = DESK_OSM source; output stamped "DESK — NOT FIELD"): `validate --desk`, then
   `node --env-file=<env with GEO_NOMINATIM_URL/GEO_OSRM_URL[/GEO_PHOTON_URL/GEO_VALHALLA_URL]> dist/cli.js run --desk …`
   (`GEO_BENCH_NOMINATIM_SEARCH=desk` adds the desk-only Nominatim `/search` comparison, labelled NOT autocomplete,
   for runs without Photon), then `score --desk --review <run>/route-review.desk-auto.csv` (automated T3-06 review)
   or a reviewed copy. `desk-osm/oneway-check.mjs` checks local OSRM routes against the extract's one-way and
   private/no-access ways (input to the desk route review). `desk-osm/route-ways.py` (pyosmium, pinned Nominatim
   image, `python3 -I`) maps saved OSRM route responses (`annotations=nodes`) to OSM way ids + access tags and checks
   whether the ways at each route end connect to the network without `access=private/no` ways (used for the
   2026-10-17 airport hard-gate root cause; output stays local).
6. Stop, keep data: `$C stop`. Remove only when no longer needed: `$C down` then
   `docker volume rm wayvro-geo-bench-nominatim wayvro-geo-bench-osrm wayvro-geo-bench-photon wayvro-geo-bench-valhalla`
   (never a prune), and delete `tools/geo-bench/.local/data/`.

Measured on the Lahore clip (laptop, 2026-10-16): OSRM extract peak ≈ 0.5 GB RAM, ≈ 1.5 min, volume ≈ 0.18 GB;
Nominatim import ≈ 12 min, ≈ 0.7 GB RAM serving, volume ≈ 0.9 GB. Pakistan-wide sizing is still NOT MEASURED.
