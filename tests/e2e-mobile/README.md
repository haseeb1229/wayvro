# tests/e2e-mobile — SP-08 cross-mode Maestro E2E (ADR-052)

Black-box flows for the ONE Wayvro app (`docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md`). Results from these flows are
**EMULATOR evidence only** — never device evidence (CLAUDE.md §8); SP-01/SP-02 device protocols stay separate.

| Path | Purpose |
|---|---|
| `mobile-stack.mjs` | throwaway DB `wayvro_e2e_mobile` (recreated each run), migrations, 2 bootstrap STAFF_ADMINs, synthetic catalog + synthetic rate cards (60 s quote TTL), API local runner on `:4120`, accounts A–G + APPLICANT; writes `build-logs/e2e-mobile/stack.json` |
| `seed-accounts.mjs` | accounts through the PUBLIC sign-in / consent / age endpoints; Driver/Partner states by SQL in the shapes the review service and worker write |
| `run-flows.mjs` | one tier on one emulator: hooks, checks, flake policy, summaries |
| `flows/manifest.mjs` | the matrix: every SP-08 row with its tier, accounts, hooks, checks, prerequisites — or its NOT TESTABLE / NOT RUN reason |
| `flows/*.yaml` | Maestro flows (`pr-*` PR smoke + full; `n-*` full only); `flows/subflows/sign-in.yaml`; `flows/scripts/*.js` (Maestro GraalJS) |
| `flows/quarantine.json` | quarantine list (§6); empty |
| `summarise.mjs` | merges the lane summaries of the manual full matrix |
| `net-inventory.mjs` | U04 emulator network inventory: parses an emulator pcap — the netsim Wi-Fi capture (`-netsim-args --pcap`) on virtio-wifi images such as API 35, `-tcpdump` on older images — (DNS names, TLS SNI, endpoints) against the run-flows `timestamps`; BASELINE / WAYVRO_SYNTHETIC_API / DURING_APP_SESSION_ONLY; FAIL on an analytics/ads/crash/update host in the app session; `--self-test`. Emulator evidence with limited per-app attribution — not device evidence |

## Rules this harness keeps

- **No new production route, no fixture endpoint, no in-app bypass.** Sign-in is the real OTP flow; the code is read
  from the local-runner-only `/__local/otp-inbox` (ADR-045; absent from release artefacts — ART-ISO). There is no master
  or fixed code. Release-control rows and switches are written by run-flows hooks with the seeded staff identities as
  maker and approver — never from the app.
- **Synthetic data only**: phones `+92399…` generated per run (the recording sink never sends SMS), the repository's
  synthetic CNIC, synthetic gazetteer places. Nothing here is a real person, document or private address.
- **Permissions start at the OS default.** Maestro pre-grants every runtime permission on `launchApp` unless told
  otherwise; the sign-in subflow passes `permissions: all: deny`, which on API 35 leaves each permission revoked with no
  USER_SET/USER_FIXED flag — the never-asked state (verified with `dumpsys package`; `all: unset` dropped the emulator's
  adb transport in local runs). The rider-hygiene check then reads `dumpsys package` / `appops` after the flow.
- **Flake policy (§6)**: one automatic retry; pass-on-retry = FLAKY (never PASS); INV-07 flows are never quarantined and
  FLAKY fails the run; a flow that cannot run is BLOCKED with its cause; budget exhaustion BLOCKS the remaining flows;
  no sleep-based waits (Maestro element waits and bounded `retry` only).
- **Pricing**: quote flows need ACTIVE synthetic rate cards. `seedSyntheticCatalog` (`@wayvro/test-support`) seeds them
  with `quoteTtlSeconds: 60` (the rate card CHECK minimum) so expiry is testable. If the seed produced no ACTIVE card,
  the quote flows are reported **NOT RUN** with that reason — never PASS.
- **Seed simplification**: approved drivers carry no `service_capabilities` rows (a grant must reference a staff review
  decision, whose staff-session/WebAuthn chain the stack does not create). Phase-3 Driver/Partner screens read profile,
  documents and restrictions only; revisit when Phase 4 adds eligibility-dependent flows.

## Run locally (Windows or Linux)

```
pnpm install --frozen-lockfile
pnpm turbo run build build:local --filter=@wayvro/api... --filter=@wayvro/test-support --filter=@wayvro/wayvro-mobile^...
node scripts/android-build.mjs e2e                 # E2E APK → apps/wayvro-mobile/build-reports/e2e/wayvro-e2e.apk
node tests/e2e-mobile/mobile-stack.mjs             # keep running (compose infra must be up)
node tests/e2e-mobile/run-flows.mjs --tier pr --device emulator-5554 \
     --apk apps/wayvro-mobile/build-reports/e2e/wayvro-e2e.apk --maestro <maestro bin>
```

Maestro CLI 2.11.0 (checksum `5384593c…283a`, `maestro.zip` of the `cli-2.11.0` GitHub release) needs Java 17+. Set
`MAESTRO_CLI_NO_ANALYTICS=1`, `MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true`, `MAESTRO_DISABLE_UPDATE_CHECK=true`
(run-flows sets them for its own invocations). Windows: native builds hit the 260-character ninja/CMake object-path
limit from long checkout paths (e.g. a `.claude/worktrees/...` worktree); build from a short checkout path.

Environment: `WAYVRO_E2E_API_PORT` (default 4120; the APK and the stack must agree), `WAYVRO_E2E_MOBILE_DB`
(`wayvro_e2e_<name>`), `DATABASE_URL` / `REDIS_URL` (local compose defaults).

## SP-02 instrumentation in the E2E APK

The E2E APK is also the SP-02 §6.2 **instrumented** build: every app module logs `WayvroPerf eval n=<app modules> d=<driver
modules> driver=<0|1> <path>` (logcat tag `ReactNativeJS`) when it is evaluated, and the release-safe fully-drawn
marker logs `Fully drawn dev.wayvro.app/.MainActivity: +<time>` (`ActivityTaskManager`). PB-06 = the `d` value of the
last `WayvroPerf` line before `Fully drawn`. The release AAB carries neither the probe nor the E2E config
(`infra/ci/android/check-release-purity.mjs`, `scripts/artifact-isolation.mjs`).

## CI

- `Mobile E2E` job in `.github/workflows/ci.yml` — PR tier on API 35; informational (not in ruleset 24837051; making it
  required is a founder action); heavy steps run only on mobile-affecting changes (`SKIPPED (no mobile-affecting change)`).
- `.github/workflows/mobile-full.yml` — `workflow_dispatch` ONLY (FA-16; no schedule): full tier on API 29, API 35 and a
  2 GB low-RAM AVD lane, property tests at `WAYVRO_PROPERTY_RUNS=50000`, merged per-flow summary.
