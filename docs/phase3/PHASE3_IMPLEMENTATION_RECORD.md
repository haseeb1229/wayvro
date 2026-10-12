# PHASE3_IMPLEMENTATION_RECORD — Full macro Phase 3 implementation (P3.0 – P3.10)

**Branch:** `phase-3/maps-quotes-unified-ux` from protected `main` @ `b1a19865fa1a3f72244e2b5b10f9e1e5148004b9` (merge of the reviewed Phase-3 planning PR #7). · **Authorisation:** founder authorised the whole macro Phase 3 engineering run in one session (2026-10-12, `WAYVRO_PHASE3_FULL_IMPLEMENTATION_AUTHORISATION`); P3.0–P3.10 are internal checkpoints, not approval points. · **Plan:** `docs/phase3/PHASE3_IMPLEMENTATION_PROMPT_PROPOSED.md` with `<PHASE3_PLAN_MERGE_SHA>` = `b1a1986…`, and every `docs/phase3/` design file. · **Status:** IN PROGRESS. · **Agent:** Claude Code (self-audit, not independent verification). · Synthetic data only; no provider account, key, real boundary, real price or real user data exists in this run.

Founder confirmations in force for this run (authorisation §4–§8): FA-01, FA-02, FA-07, FA-10, FA-11, FA-12, FA-16 APPROVED; FA-17 approved in principle; FA-18 deferred to Phase 4; FA-08 no paid spend; FA-09 native review required; FA-19 Mapbox licence clarification required before any S2 freeze. Pricing maker-checker: two distinct authenticated staff identities (both may hold `PRICING_MANAGER`), maker ≠ checker enforced by database and service, mandatory audit actor ids and reason codes, `STAFF_ADMIN` is not the routine approver, break-glass is not a shortcut. SP-01 thresholds are fixed pre-measurement values (FA-07).

Genuine founder/external actions still open at run start: FA-03 (SP-01 real devices), FA-04 (SP-02 low-end device), FA-05 (SP-04 Lahore field data), FA-06 (evaluation provider accounts/keys), FA-09 (native Urdu/Roman-Urdu review), FA-19 (Mapbox written licence clarification, S2 only).

## Authority checks at run start (2026-10-12)

| Check | Result |
|---|---|
| local `main` = `origin/main` | `b1a19865fa1a3f72244e2b5b10f9e1e5148004b9` (both) |
| worktree / stash | clean / none |
| identity | `Muhammad Haseeb <abdulhaseeb1229@gmail.com>`; `gh` login `haseeb1229` |
| ruleset 24837051 | active; deletion + non-fast-forward + pull request + the five required checks (Quality, Integration, Security, Android, Web E2E) |
| latest `main` CI | run 38212729675 (push of the PR #7 merge): all five jobs success |
| Phase-3 implementation branch | none existed (`git branch -a`) |
| register | 532 IDs; `phase0.target_phase = 3` = 29 (P0 17, P1 11, P2 1) — matches the plan |

## Checkpoint log

| Checkpoint | Commit | Summary |
|---|---|---|
| P3.0 | (this commit) | F-P3-01 release URL scheme removed (dev-only scheme), exported-component/intent-filter release gate, oasdiff breaking-change gate, Web E2E title synchronisation, ADR-043/ADR-027/osv corrections |

## P3.0 — Main hygiene and guardrails

**IDs touched:** V08 (prerequisite), U05 (manifest hygiene), V10 (gate). **ADR:** ADR-043 amendment, ADR-027 amendment.

### F-P3-01 — expo-dev-client scheme only in development builds

| Area | Change |
|---|---|
| Config | `apps/wayvro-mobile/app.config.ts` lists `['expo-dev-client', { addGeneratedScheme: false }]` — the documented option; `expo prebuild` skips its automatic (legacy-list) copy because config plugins run once per package — so the shared main manifest no longer gets `exp+wayvro` |
| Dev workflow | `apps/wayvro-mobile/plugins/dev-client-scheme.mjs` re-adds the identical intent filter (VIEW + DEFAULT + BROWSABLE, `exp+wayvro`, same derivation as the dev-client source) to the `debug` and `debugOptimized` source-set manifests only; the manifest merger applies them to development variants alone |
| Gate | `infra/ci/android/check-intent-filters.mjs` + `infra/ci/android/component-allowlist.json`: every exported activity/alias/service/receiver/provider must be allowlisted with exact permission and filters; any `<data>` or BROWSABLE in an application intent filter fails; `<queries>` ignored. Run by `scripts/android-build.mjs release` on the AAB (Android job) and `--self-test` in the Quality job |
| Exception | `osv-scanner.toml` decode-uri-component reason corrected to the now-true, CI-enforced premise; expiry 2026-12-31 unchanged (not extended) |
| iOS | no iOS build exists; the generated scheme is also absent from the iOS Info.plist; a Debug-only URL type is needed when iOS development builds start (open item) |

Evidence (local, this machine):

| Evidence | Result |
|---|---|
| Gate self-test (6 fixture cases: expected shape passes; `exp+wayvro` filter, extra exported receiver, https app-link alias, implicitly exported service, profile installer without DUMP all fail) | PASS |
| Gate against the PRE-FIX release AAB (`apps/wayvro-mobile/build-reports/app-release.aab` built 2026-10-11 from `main`) | FAIL as expected: `DATA activity:dev.wayvro.app.MainActivity … exp+wayvro`, `BROWSABLE …`, `FILTERS …` — the negative control on a real artefact |
| `expo prebuild` output after the fix | main manifest: no `exp+wayvro`; `src/debug` and `src/debugOptimized` manifests: the dev-client filter |
| Release AAB after the fix — local `node scripts/android-build.mjs release` (JDK 17.0.20.1, bundletool 1.18.3), 2026-10-12 | PASS: 16 KB (20/20 64-bit libraries aligned), permissions (unchanged set), intent filters — exported components exactly `activity:dev.wayvro.app.MainActivity` (MAIN/LAUNCHER only) and `receiver:androidx.profileinstaller.ProfileInstallReceiver` (DUMP); no `<data>`, no BROWSABLE; log `build-logs/p30-release.log` (local, not committed) |
| Development APK after the fix | `scripts/android-build.mjs debug` now asserts with `aapt2 dump xmltree` that the development APK still declares `exp+wayvro` (positive control of the dev-launcher path; fails the build otherwise). Local first attempt FAILED at prebuild: Node ESM cannot resolve `expo/config-plugins` (no exports map) — fixed by importing `expo/config-plugins.js`; prebuild then produced the debug/debugOptimized scheme. The debug APK verification runs in the CI Android job on this commit (local Gradle re-run in progress at commit time) |

### F-P3-09 — oasdiff breaking-change gate

`scripts/openapi-breaking.mjs` + oasdiff 1.32.1 (Apache-2.0, checksum-verified in CI; latest patch of the 1.32 line, 2026-09-15). Base = merge base with `origin/main` (`HEAD^1` on `main`). zod nests `$defs` per operation with `#/$defs/<id>` refs that oasdiff resolves against the document root (`map key "$defs" not found` on the raw spec), so both specs are normalised by hoisting the definitions into `components.schemas` first. Quality job checkout now uses `fetch-depth: 0`.

| Evidence | Result |
|---|---|
| `--self-test` (identical ⇒ pass; value added to a CLOSED response enum ⇒ breaking; route removed ⇒ breaking; required response field removed ⇒ breaking) | PASS (local, 4 cases) |
| current spec vs `b1a1986` | PASS — "no breaking changes" (the spec differs only by the extensible-enum representation below) |

**Finding while enabling the gate:** adding any error code (Phase 3 adds three) widened the closed `error.code` enum in all 415 error responses, which oasdiff reports as `response-property-enum-value-added` (ERR). The error-code vocabulary is extensible BY CONTRACT (`errors.ts`: codes are additive; the mobile client and web surfaces fall back to the HTTP status for an unknown code), so the generator (`packages/contracts/src/openapi.ts`) now documents exactly two vocabularies as `x-extensible-enum` in RESPONSE schemas: error codes and staff roles (code-defined, additive, consumed only by the lockstep-deployed web-ops). Request enums stay closed; every other response enum stays closed and the self-test proves a value added to a closed response enum still fails.

### Web E2E flake (`tests/e2e-web/web-ops/staff.spec.ts:40`, PR #7)

See "Web E2E investigation" below for the reproduction attempt and outcome.

### Gates (P3.0)

Filled at the checkpoint commit.
