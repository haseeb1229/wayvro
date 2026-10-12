# PHASE3_SDK_PRIVACY_INVENTORY — Mobile/web third-party SDK and provider privacy inventory (U04) (PROPOSED)
**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT plan review recorded 2026-10-12 (FA-02 APPROVED; NEW FA-19 Mapbox licence gate); no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

## 0. Purpose and scope

U04 (P0): "Mobile/web third-party SDK inventory maps data collected, purpose, permissions, network endpoints, subprocessors and store disclosure/privacy-manifest requirements; unapproved SDK data collection blocks release." This document is the Phase-3 baseline of that inventory: (a) every runtime dependency of `apps/wayvro-mobile/package.json` on `main` @ `6aed6a4`, (b) every SDK/provider proposed for Phase 3, (c) the web surfaces in summary, (d) the rules and the CI check that keep it true. It also feeds U05 (permission minimisation) and the store-declaration track EG-18 (`docs/phase2/PHASE2_EXTERNAL_GATES.md`).

**What this is not.** It is not a Play Data safety form, an App Store privacy label, a DPIA or a transfer assessment (those are EG-18, EG-10/Q45 and EG-12/Q44). Nothing here has been network-captured from a release build: runtime network behaviour of the current release AAB is **NOT RUN** (planned at P3.10).

**Confidence.** V = vendor primary source seen 2026-10-12 (see `docs/phase3/PHASE3_GEO_PROVIDER_EVALUATION.md` for URLs); R = repository fact on `main` @ `6aed6a4`; S = secondary; NF = not found / verify. Versions are only those verified in the repo or the 2026-10-12 facts; anything else is "verify at install".

## 1. Rules (PROPOSED, binding once Phase 3 is approved)

1. **No hidden analytics, advertising, attribution, crash-reporting or session-replay SDK** in the mobile app or web surfaces. Any such SDK needs its own ADR, a founder decision and an inventory row before it can be installed (Phase-3 plan: no analytics/ads/crash SDK in Phase 3; `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md` §4).
2. **Every runtime dependency and every autolinked native module** (direct or transitive) has an inventory row with status APPROVED before it appears in a release build. Dev-only tools have rows with status DEV-ONLY and must be proven absent from the release artefact.
3. **Unapproved SDK data collection blocks release.** A release build whose dependency set, autolinked native modules, Android manifest permissions/intent filters or (later) iOS privacy manifest differs from the approved inventory fails CI (§8).
4. Client SDK vendors receive no Wayvro account identifiers, phone numbers or names. Where an SDK has optional telemetry, it is disabled unless an approved row says otherwise; where the vendor makes an end-user opt-out mandatory (Mapbox, V), the opt-out is implemented.
5. Server-side providers are listed too: they are not on the device, but they are subprocessors that receive user-derived data (queries, coordinates).
6. The inventory is **re-generated** at P3.7 (after the renderer/tile host and geo bundle are chosen on SP-04/SP-02 evidence) and at P3.10 (closure, from the actual release AAB), and at every later dependency change.
7. Permission changes go through `infra/ci/android/permission-allowlist.json` with a requirement ID and founder approval (FA-02 APPROVED 2026-10-12 for rider foreground location); the Phase-3 manifest delta is **ACCESS_COARSE_LOCATION + ACCESS_FINE_LOCATION only** (when-in-use).

Statuses used: APPROVED-EXISTING (shipped in Phase 1/2), PROPOSED (Phase-3 candidate, not installed), CANDIDATE (one of several; chosen at P3.7), CONDITIONAL (only if a spike fails and the founder approves), DEV-ONLY, SERVER-SIDE, EXCLUDED.

## 2. Current mobile dependencies — identity, permissions, data, network (R)

Release build facts (R): Expo SDK 57.0.27, RN 0.86.3, Hermes; `updates.enabled=false` (no OTA endpoint); reanimated / gesture-handler / worklets excluded from native autolinking (ADR-043); expo-camera compiled from source so its prebuilt ML Kit barcode / Play services code-scanner code is not linked; release permission allowlist = INTERNET, DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION, CAMERA; 16 permissions contributed by Expo/modules explicitly blocked in `app.config.ts` (storage, media, audio, biometric, background location, full-screen intent and others).

| Package | Version (R) | Licence | Maturity (ADR-030) | Permissions | Data handled | Network endpoints at runtime |
|---|---|---|---|---|---|---|
| expo (+ expo-modules-core) | 57.0.27 | MIT | Expo SDK 57 line, pinned; no upgrade in Phase 3 | none added beyond blocked set | none | none known (OTA disabled); verify by release capture (NOT RUN) |
| @expo/metro-runtime | 57.0.16 | MIT | Expo-pinned | none | none | dev only: Metro dev server on the developer LAN; none in release (verify) |
| expo-router | 57.0.25 | MIT | Expo-pinned | none | route state in memory | none |
| expo-linking | 57.0.12 | MIT | Expo-pinned | none | URLs it opens/parses | opens system browser/settings only; **no direct import** (peer of expo-router) |
| expo-constants | 57.0.21 | MIT | Expo-pinned | none | app config incl. API base URL | none |
| expo-status-bar | 57.0.1 | MIT | Expo-pinned | none | none | none |
| expo-secure-store | 57.0.4 | MIT | Expo-pinned | contributes USE_BIOMETRIC / USE_FINGERPRINT — **blocked** (R) | session tokens in Android Keystore-backed storage / iOS Keychain | none |
| expo-crypto | 57.0.3 | MIT | Expo-pinned | none | random values, hashes (local) | none |
| expo-camera | 57.0.6 | MIT | Expo-pinned; built from source (R) | CAMERA (allowlisted; requested just in time on the Driver/Partner capture screen) | document photos and one selfie for manual KYC review, local until uploaded | none by itself; uploads go to Wayvro-issued presigned URLs (Wayvro object storage) |
| expo-image-picker | 57.0.20 | MIT | Expo-pinned | none requested (system Photo Picker; media permissions blocked) | user-selected document image | none |
| expo-file-system | 57.0.7 | MIT | Expo-pinned | storage permissions blocked | evidence files in app storage; upload via `UploadType` (R: `src/features/driver/upload/evidence-files.ts`) | Wayvro presigned upload URLs only |
| expo-dev-client | 57.0.19 | MIT | Expo-pinned | **F-P3-01:** release AAB registers VIEW/BROWSABLE intent filter with scheme `exp+wayvro` (verified on the 2026-10-11 local release AAB; re-verification on the post-repair CI artefact recorded in `docs/phase3/PHASE3_PLAN.md`) | none intended in release | dev: Metro/dev launcher on LAN; release: launcher inclusion and any network use **to verify** in P3.0 fix |
| react | 19.2.3 | MIT | pinned | none | UI state | none |
| react-native | 0.86.3 | MIT | pinned; no upgrade in Phase 3 | INTERNET (allowlisted) | — | only what app code calls (Wayvro API) |
| react-native-screens | 4.26.2 | MIT | pinned | none | none | none |
| react-native-safe-area-context | 5.7.0 | MIT | pinned (its transitive `kotlin-stdlib-jdk8:1.8.0` was involved in the F-P3-02 CI failure, caused by a stale Gradle cache and fixed by PR #6) | none | none | none |
| @tanstack/react-query | 5.103.3 | MIT | pinned; devtools not installed | none | API responses cached in memory | none (fetchers call the Wayvro API) |
| zod | 4.6.5 | MIT | pinned | none | none | none |
| @wayvro/contracts | workspace | first-party | — | none | none | none |
| typescript, vitest, @types/react | devDependencies | Apache-2.0 / MIT / MIT | dev only | — | — | not shipped |

The only runtime network peer of the current app is the **Wayvro API** (and Wayvro-issued presigned object-storage URLs). This statement is derived from source reading, not from a network capture.

## 3. Current mobile dependencies — subprocessors, telemetry, disclosures, terms

| Package | Subprocessors | SDK telemetry | Opt-out / control | Play Data safety (SDK-level) | Apple privacy manifest | Pakistan/Lahore implications (FD-03/EG-12) | Commercial terms | Free-tier limits | Upgrade triggers |
|---|---|---|---|---|---|---|---|---|---|
| Expo modules (all rows above) | none at runtime | none known at runtime (Expo CLI telemetry is a developer-machine tool, not shipped) | n/a | no SDK-level collection; Wayvro's own collection (account, phone, KYC images) is declared under EG-18/U06 | Expo modules may declare required-reason APIs (e.g. file timestamps, user defaults); aggregated manifest must be checked at the first iOS build (NOT RUN; FA-13) | none (no third-party transfer) | MIT; EAS build service is separate (Phase-0 matrix) | n/a | Expo SDK upgrade — forbidden in Phase 3 (ADR-030); security patch within SDK 57 as bounded change |
| expo-dev-client | none | NF in release | P3.0: `addGeneratedScheme: false` and/or exclude from release variant, decided by evidence; CI intent-filter gate | must not ship any exported component not on the allowlist | n/a | none | MIT | n/a | P3.0 fix lands; re-verify every Expo patch |
| react-native, react, screens, safe-area, TanStack, zod | none | none | n/a | none | RN core required-reason APIs: verify at iOS build | none | MIT | n/a | RN upgrade forbidden in Phase 3 |

## 4. Proposed Phase-3 SDKs and providers — identity, permissions, data, network

Nothing in this section is installed. Renderer and tile host are **one choice coupled to the geo bundle** (CON-P3-16): S1 Google → react-native-maps (Google provider) or Google-on-both-platforms equivalent; S2 Mapbox → @rnmapbox/maps; S3 Open → MapLibre RN + open tiles; S4 only with verified terms.

| Package / vendor | Status | Version candidate | Licence | Maturity (ADR-030) | Permissions | Data collected | Network endpoints |
|---|---|---|---|---|---|---|---|
| expo-location | PROPOSED (P3.5; FA-02 APPROVED 2026-10-12) | ~57.0.20 (Expo SDK 57 bundled, V) | MIT | Expo-pinned — OK | ACCESS_COARSE_LOCATION + ACCESS_FINE_LOCATION added automatically (V); background and FGS options default false and stay false — no ACCESS_BACKGROUND_LOCATION / FOREGROUND_SERVICE* (V); iOS NSLocationWhenInUseUsageDescription only | rider current location when the user taps "use current location"; held in memory, sent only in quote / reverse-geocode requests to the Wayvro API | none by the module itself; on Android the platform location provider (Google Play services fused provider, S — verify) |
| @maplibre/maplibre-react-native | CANDIDATE (S3/S4) | 11.5.0 (2026-10-04, V); New Architecture only; peers RN ≥ 0.80, expo ≥ 54, react ≥ 19.1 (V) | MIT | 11.5.0 is 8 days old at planning: take the latest patch of the newest minor that has had ≥ 1 follow-up patch at install time (verify) | none | tile/style requests reveal viewport | style + tile host chosen below |
| react-native-maps | CANDIDATE (S1) | 1.27.2 (Expo SDK 57 pin, V; npm latest 1.29.11, V) | MIT | Expo-pinned preferred — OK | none itself; Google Maps SDK needs API key in manifest | Google Maps SDK: device/SDK metadata, crash data, IP, pseudonymous ID, map-interaction events (V) | Google Maps endpoints (Android); iOS default provider is Apple Maps — **S1 requires the Google provider on iOS** (evaluation doc §6) |
| expo-maps | CANDIDATE (S1 Android only) | ~57.0.4 (Expo SDK 57 bundled, V) | MIT | maturity/status to verify at P3.7 | none itself | Google Maps SDK (Android) as above; Apple Maps on iOS | Google (Android), Apple (iOS) — iOS rendering incompatible with Google geo content (analysis; counsel) |
| @rnmapbox/maps | CANDIDATE (S2) | 10.3.7 (2026-10-05, V); Mapbox Maps SDK v11 | MIT (wrapper); Mapbox SDK under Mapbox terms; a Mapbox Commercial Application License may apply to vehicle usage (FA-19, EXTERNAL) | patch of an established line — verify follow-up patch at install | none | Mapbox telemetry **on by default** (V); device IP, viewport, SDK events | Mapbox tiles/styles/telemetry endpoints |
| OpenFreeMap (tile host, public) | CANDIDATE (dev/SP-04; production only with fallback) | n/a (hosted) | OpenMapTiles + OSM ODbL attribution (V) | n/a | none | device IP, user agent, viewport tiles | OpenFreeMap public hosts |
| Protomaps PMTiles self-hosted | CANDIDATE (S3 production) | n/a | code BSD-3, spec CC0, data ODbL (V) | n/a | none | device IP + byte ranges seen by Wayvro's storage/CDN host | Wayvro-controlled S3-compatible host (e.g. R2, already planned) |
| MapTiler | CANDIDATE (paid fallback only) | n/a | commercial terms | n/a | none | device IP, viewport, session counting | MapTiler hosts |
| Mapbox tiles | CANDIDATE (S2 only) | via @rnmapbox/maps | Mapbox terms; Commercial Application License may apply to vehicle usage (FA-19, EXTERNAL) | n/a | none | as @rnmapbox/maps | Mapbox |
| Google map tiles | CANDIDATE (S1 only) | via Maps SDK | Google Maps Platform terms | n/a | none | as react-native-maps | Google |
| Google Places / Geocoding / Routes | SERVER-SIDE CANDIDATE (S1) | n/a | Google Maps Platform terms | n/a | — | query text, coordinates (≤ 5 dp), session token, Wayvro server IP | called from Wayvro API only |
| Mapbox Search Box / Geocoding / Directions | SERVER-SIDE CANDIDATE (S2) | n/a | Mapbox terms; Commercial Application License may apply to vehicle usage (FA-19, EXTERNAL) | n/a | — | same as above | Wayvro API only |
| TomTom / HERE | SERVER-SIDE CANDIDATE (S4, terms NF) | n/a | vendor terms (NF) | n/a | — | same as above | Wayvro API only |
| OSRM / Valhalla | SERVER-SIDE CANDIDATE (S3; benchmark profile in Phase 3) | OSRM v26.10.0 (2026-10-01, V); Valhalla 3.9.1 (2026-10-06, V) | BSD-2 / MIT | OSRM v26.10.0 is new — prefer a release with a follow-up patch for any production use (verify) | — | none leaves Wayvro | Wayvro host |
| Photon / Nominatim (self-hosted) | SERVER-SIDE CANDIDATE (S3) | Photon 1.3.0 (2026-08-07, V); Nominatim v5.3.2 (V) | Apache-2.0 / GPL-3.0 (server-side use; no distribution to devices) | verify at install | — | none leaves Wayvro | Wayvro host; **public Nominatim server excluded** (autocomplete prohibited, V) |
| Maestro CLI | DEV-ONLY (SP-08; ADR-052 proposed) | cli-2.11.0 (2026-09-29, V) | Apache-2.0 (V) | verify follow-up patch at install | none in app | none from users; CLI usage analytics NF — disable if present | CI/dev machine only |
| reactivecircus/android-emulator-runner | DEV-ONLY (CI) | v2.38.0 (2026-07-05, V) | verify at install | OK on age | — | — | GitHub Actions runner |
| oasdiff | DEV-ONLY (CI, P3.0) | verify at install | verify at install | verify | — | — | CI only |
| Transistorsoft react-native-background-geolocation | CONDITIONAL (only if SP-01 candidate A fails and the founder makes a specific FA-08 spend decision; no paid spend pre-approved) | 5.8.0 (2026-10-09, V) — 3 days old at planning: verify at install | commercial licence for RELEASE builds; free in DEBUG (V) | verify | background location + FGS (Phase 4 only; not in any Phase-3 release) | driver location stream to Wayvro | Wayvro API; any vendor licence-check or telemetry endpoint NF — must be verified before approval |

## 5. Proposed Phase-3 SDKs and providers — subprocessors, telemetry, disclosures, terms

| Package / vendor | Subprocessors | SDK telemetry | Opt-out / control | Play Data safety | Apple privacy manifest | Pakistan/Lahore implications (FD-03/EG-12) | Commercial terms | Free-tier limits (V unless marked) | Upgrade / review triggers |
|---|---|---|---|---|---|---|---|---|---|
| expo-location | none (OS/Play services location stack) | none known | OS permission + in-app fallback (manual pin) | **Location: approximate and precise, collected by Wayvro, purpose App functionality, not shared, required only for "use current location"** (draft; EG-18) | location is not a required-reason API; NSLocationWhenInUseUsageDescription; nutrition label "Precise Location", linked to user (quotes are account-bound), not used for tracking (draft) | pickup/drop coordinates stored on quotes (30-day purge proposal) in the provisional Singapore region — EG-12 | MIT | n/a | Play location declaration effective 2027-01-27 (FINE only if COARSE cannot support the feature, V) — draft justification for pickup precision; any background request = Phase 4 + SP-01 + new row |
| MapLibre RN | tile host only | MapLibre Native removed Mapbox telemetry (S) — verify no telemetry endpoint in network capture | n/a | depends on tile host (device IP to host) | MapLibre not on Apple's commonly-used SDK list (V); verify bundle for required-reason APIs | tile host location: OpenFreeMap NF; R2 = Cloudflare global | MIT | n/a | renderer size > SP-02 budget; New-Arch/Expo compatibility on any Expo patch |
| react-native-maps / expo-maps (Google SDK) | Google | Google Maps SDK collection listed above (V) | not user-configurable (NF) | must declare Google Maps SDK data types per Google's Play disclosure (V: device/other IDs, crash, diagnostics, IP-derived approximate location if applicable — verify exact Play categories) | GoogleMaps not on Apple's commonly-used list (V); Google SDK ships its own manifest (verify) | device data to Google (global) — EG-12 | Google Maps Platform terms; key restricted by package + signing cert | Maps SDK mobile: Essentials, no charge listed (V) | Google terms/pricing change; key abuse; S1 not selected ⇒ remove |
| @rnmapbox/maps | Mapbox | **on by default** (V) | **mandatory in-app telemetry opt-out** (V); default OFF if technically and contractually allowed (NF) | declare Mapbox SDK data (device IDs/diagnostics/approximate location per Mapbox disclosure — verify) | Mapbox not on Apple's commonly-used list (V); verify vendor manifest | device data to Mapbox — EG-12 | Mapbox terms; token restricted, rotatable via `GET /v1/app/config`; **commercial terms: a Commercial Application License may apply to vehicle usage** — Mapbox's pricing page (https://www.mapbox.com/pricing, Licensing section, accessed 2026-10-12, no page date) says it is required "for vehicle usage (including ground, aerial, manned and unmanned vehicles)" and "consists of an annual subscription and, where applicable, a per-user or seat-based component"; applicability to Wayvro Rider/Driver use is EXTERNAL (FA-19, written Mapbox sales/legal clarification); no fee assumed; no pilot/production S2 freeze while unresolved | 25,000 MAU, then USD 4.00/1K MAU (public pay-as-you-go; not treated as the complete production cost until FA-19 is resolved) | MAU ≥ 80 % of free tier (budget signal); terms change |
| OpenFreeMap public | OpenFreeMap operators (NF) | NF | none | device IP to third party — disclose if deemed collection by a third party (verify with EG-18 reviewer) | n/a | unknown hosting location — EG-12 | free, commercial OK, **no SLA** (V) | unlimited, donation-run (R5) | never sole production host (gate G3) |
| Protomaps self-hosted | Wayvro's storage/CDN provider (Cloudflare R2 proposed) | none | Wayvro controls logs | Wayvro-controlled processing | n/a | Cloudflare global edge — EG-12 | storage cost only | R2 free 10 GB-month, 10M Class B ops (R5) | extract update cadence; storage growth |
| MapTiler | MapTiler | NF | NF | third-party host | n/a | NF | Flex USD 30/month, 25K sessions (V) | free 5,000 sessions / 100K requests, **non-commercial**, pauses at quota (V) | only if chosen as paid fallback |
| Google geo (server) | Google | n/a (server) | Wayvro gateway: no account ids, coarse bias, ≤ 5 dp | service-provider processing on Wayvro's behalf (Play "sharing" exemption to verify with EG-18) | n/a | queries/coordinates to Google — EG-12 | caching limits (30-day lat/lng, predictions not cacheable, `place_id` storable), Google-map-only display (V) | 10K free per Essentials SKU/month (V) | budget 50/80/100 % signals; FA-08 for paid |
| Mapbox geo (server) | Mapbox | n/a | same gateway rules | same as above | n/a | EG-12 | temporary geocoding uncacheable and Mapbox-map-only (V); **commercial terms: Commercial Application License may apply to vehicle usage (FA-19, EXTERNAL; see the @rnmapbox/maps row)** | Search Box 25K; temp geocoding 100K; Directions 100K (V) — Search Box billing modes (sessions vs requests; introductory preview vs standard pricing) must not be conflated when costing | same; FA-19 outcome |
| TomTom / HERE (server) | vendor | n/a | same | same | n/a | NF | NF | TomTom 20K routing/geocode/reverse, 2.5K search per month (V); HERE ~30K/service (S) | admissible only after written terms check |
| OSRM / Valhalla / Photon / Nominatim (self-hosted) | Wayvro hosting provider | none | Wayvro | no third party | n/a | runs in Wayvro's region (FD-03) | open-source licences; ODbL attribution in app | n/a | monthly extract update; capacity |
| Maestro, emulator runner, oasdiff | none for users | Maestro CLI analytics NF | disable via documented setting if present | not shipped — must be absent from release AAB | not shipped | none | Apache-2.0 / verify | GitHub Actions minutes (FA-16 APPROVED: PR tier ≤ 15 min + manual full matrix, no nightly) | PR-tier runtime > 15 min |
| Transistorsoft | NF | NF | NF | background location declaration + video (Phase 4) | verify vendor manifest | driver location — EG-12 | Starter USD 399 one-time (1 app key) + 1 year updates; Venture 599, Pro 749, Studio 999 (V) | free in DEBUG only (V) | only if SP-01 A fails (FD-08/FA-08) |

## 6. Web surfaces (summary)

| Surface | Runtime dependencies (R) | Third-party runtime SDKs | Phase-3 change |
|---|---|---|---|
| apps/web-public | next 16.3.8, react / react-dom 19.2.3, first-party workspace packages | none (no analytics, no tag manager, no fonts CDN known — verify at P3.10) | none proposed |
| apps/web-ops | next 16.3.8, react / react-dom 19.2.3, @simplewebauthn/browser 14.0.0 (MIT; local WebAuthn ceremony, no third-party endpoint), first-party packages | none | pricing/catalog/release-control staff screens add **no** third-party SDK; any zone-preview map in web-ops would need its own row and the same licence coupling check |

Next.js build-time telemetry is a developer/CI tool setting, not a runtime SDK; it should stay disabled in CI (verify).

## 7. Store disclosure and privacy-manifest consequences of Phase 3 (drafts, EG-18)

| Topic | Phase-3 delta (draft) | Evidence needed |
|---|---|---|
| Play Data safety | add Location (approximate, precise) collected by Wayvro for App functionality; add renderer SDK data per the chosen vendor; server-side geo providers as service providers | founder/EG-18 review; vendor disclosures re-read at P3.7 |
| Play location declaration | Phase-3 release AAB with COARSE + FINE would require the declaration once location permissions are submitted after 2027-01-27 (V); pre-review checks start 2026-10-27 (V). No Play upload happens in Phase 3 | draft justification text (precise pickup point; approximate-only supported) |
| Apple privacy manifest / nutrition label | location when-in-use; renderer SDK manifest check; aggregated required-reason APIs | first iOS build (NOT RUN; FA-13, Phase 7) |
| Android manifest | allowlist adds COARSE + FINE only; F-P3-01 removes the generated `exp+wayvro` scheme; new CI gate for exported components/intent filters | P3.0 / P3.5 CI evidence |

## 8. CI check proposal (U04 enforcement)

Proposed script (name illustrative: scripts/check-sdk-inventory.mjs, not created) run in the Quality job:

1. Read `apps/wayvro-mobile/package.json` dependencies and the **resolved autolinked native module list** for the release variant (Expo autolinking resolution output), so transitive native SDKs are caught, not only direct dependencies.
2. Read a machine-readable inventory (proposed future JSON file under docs/phase3, generated from this document's tables) mapping each package to status, allowed version range, permissions it may contribute, network-endpoint class and approval reference.
3. Fail if: a dependency or autolinked module has no row; its status is not APPROVED/APPROVED-EXISTING (DEV-ONLY packages fail if present in the release module list); its version is outside the approved range; a row is APPROVED but the package is gone (stale row — warn, then fail at closure).
4. Combine with the existing release-AAB gates: `infra/ci/android/check-permissions.mjs` against `infra/ci/android/permission-allowlist.json`, the 16 KB check, and the new exported-components/intent-filter gate from F-P3-01.
5. Diff-gate on pull requests: any change to `apps/wayvro-mobile/package.json` or the lockfile entries of mobile runtime packages requires the inventory file to change in the same PR (reviewer sees both).
6. Later (iOS builds exist): verify the aggregated `PrivacyInfo.xcprivacy` presence and required-reason entries against the inventory.

The check is a guard against silent drift; approval itself remains a human (founder) decision recorded on the row.

## 9. Regeneration schedule and open items

| When | Action | Status |
|---|---|---|
| P3.0 | add rows for oasdiff; fix and re-verify expo-dev-client release behaviour (F-P3-01) | NOT RUN |
| P3.5 | expo-location row moves to APPROVED on install (FA-02 APPROVED 2026-10-12); manifest/allowlist delta COARSE + FINE | NOT RUN |
| P3.7 | choose renderer + tile host + geo bundle on SP-04/SP-02 evidence (an S2 bundle only with FA-19 resolved for a pilot/production freeze); remove rows of non-chosen candidates; telemetry settings verified by network capture | NOT RUN |
| P3.10 | regenerate from the actual release AAB (dependency tree, autolinked modules, manifest, network capture of a scripted rider/driver session); store-disclosure drafts updated | NOT RUN |

Open items: runtime network capture of the current release build (never done); exact Play Data safety categories for the chosen renderer SDK; Maestro CLI analytics behaviour; Transistorsoft licence-check/telemetry endpoints (only if CONDITIONAL activates); Mapbox Commercial Application License applicability (FA-19, only if S2 is a freeze candidate); Expo-module required-reason APIs on iOS; vendor DPAs and subprocessor lists (EG-11/EG-12, counsel).
