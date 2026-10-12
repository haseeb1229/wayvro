# PHASE3_PERMISSION_LOCATION_MODEL — Permission inventory, rider foreground location and driver escalation design (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — pending founder/ChatGPT review; no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

Requirement IDs: A07, V05, U05 (primary); B01, B02 (location as input); U04 (SDK inventory link: `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md`); V06/M26 (Phase-4 design only). Invariant: INV-07 (`docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` §9). Founder action: **FA-02** (approve the rider foreground location allowlist change). Without FA-02 the P3.5 location sub-step is BLOCKED and the rider flow ships search + pin/pickup points only.

Facts below marked "(re-verify)" come from vendor documentation read on 2026-10-12 and must be re-checked at implementation time; nothing here is claimed compliant.

---

## 1. Current truth

- Release allowlist (`infra/ci/android/permission-allowlist.json`, approved in Phase-2 closure): `android.permission.INTERNET`, `${applicationId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, `android.permission.CAMERA`. ACCESS_FINE/COARSE_LOCATION, ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE_LOCATION, POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT, RECORD_AUDIO, SYSTEM_ALERT_WINDOW, storage/media, READ_CONTACTS, READ_PHONE_STATE are in the forbidden list. CI gate: `infra/ci/android/check-permissions.mjs` on the release AAB.
- `app.config.ts` `blockedPermissions` additionally strips VIBRATE, ACCESS_NETWORK_STATE, CHANGE_WIFI_MULTICAST_STATE, USE_BIOMETRIC, USE_FINGERPRINT and the media permissions.
- iOS usage strings today: camera and photo library (Driver/Partner capture only).
- Architecture test bans importing expo-location, expo-notifications, expo-task-manager, expo-background-fetch, react-native-maps, expo-media-library anywhere in `src/`.

---

## 2. Permission inventory

Status values: **ALLOWED now** · **PROPOSED Phase 3 (needs FA-02)** · **Phase 4 after SP-01** (own founder approval then) · **FORBIDDEN** · **BLOCKED (no feature)** (stripped via `blockedPermissions`).

| Permission | Platform | Mode | Phase | Justification | Req IDs | Request moment | Denial path | Revocation detection | Status |
|---|---|---|---|---|---|---|---|---|---|
| INTERNET | Android | both | existing | API traffic (normal permission) | — | install | — | — | ALLOWED now |
| DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION | Android | both | existing | AndroidX signature permission | — | install | — | — | ALLOWED now |
| CAMERA / NSCameraUsageDescription | both | Driver/Partner onboarding | existing (P2.8) | document photos + selfie for manual review | K02, K03, V03 | capture screen, after explanation | Photo Picker for documents; in-person explanation for selfie | re-checked on capture screen focus | ALLOWED now |
| NSPhotoLibraryUsageDescription (system picker) | iOS | Driver/Partner onboarding | existing | document import | K02 | import action | camera path | — | ALLOWED now |
| ACCESS_COARSE_LOCATION | Android | Rider (request); Driver (status read only) | Phase 3 | pickup bias, approximate fallback; must accompany FINE on Android 12+ | B01, B02, A07, V05, U05 | first "Use current location" tap, after in-app rationale | search + pin + pickup points | `AppState` active ⇒ status re-read | PROPOSED Phase 3 (needs FA-02) |
| ACCESS_FINE_LOCATION | Android | Rider (request); Driver (status read only) | Phase 3 | pickup must be accurate to street/gate level; a ~km-level approximate fix cannot place a pickup — justification required by Play's 2027 location policy (§7) | B01, B02, A07, V05, U05 | same request as COARSE (user may grant Approximate only) | approximate handling (§4.3) | as above | PROPOSED Phase 3 (needs FA-02) |
| NSLocationWhenInUseUsageDescription | iOS | Rider | Phase 3 | same | B01, A07 | same | same; reduced accuracy handled like approximate | `AppState` active | PROPOSED Phase 3 (needs FA-02) |
| ACCESS_BACKGROUND_LOCATION | Android | Driver online only | Phase 4 | live tracking while online/on trip | D05, V06, M26 | go-online flow, after prominent disclosure, via Settings ("Allow all the time") | cannot go online; recovery screen | heartbeat + status check; server-forced offline | Phase 4 after SP-01 |
| FOREGROUND_SERVICE | Android | Driver online only | Phase 4 | host of location FGS (realtime socket/poll path, ADR-033) | V06, M26 | implicit (normal permission) | — | — | Phase 4 after SP-01 (forbidden in Phase 3) |
| FOREGROUND_SERVICE_LOCATION | Android | Driver online only | Phase 4 | FGS type `location` (Android 14+) | V06, M26 | implicit | — | FGS death ⇒ server-forced offline | Phase 4 after SP-01 |
| NSLocationAlwaysAndWhenInUseUsageDescription + UIBackgroundModes `location` | iOS | Driver online only | Phase 4 | same | V06 | go-online | cannot go online | Always→WhileInUse downgrade detection (SP-01 #7) | Phase 4 after SP-01 |
| POST_NOTIFICATIONS | Android 13+ | both | Phase 4 | wake/alert aid only (M26); FGS notice visibility | M26, L13 | first relevant moment with benefit statement | socket/poll keeps working; FGS notice only in Task Manager on 13+ (re-verify) | status check on foreground | Phase 4 (own approval; not SP-01-bound) |
| WAKE_LOCK, RECEIVE_BOOT_COMPLETED | Android | Driver | Phase 4 review | only if the chosen SDK (ADR-029) needs them; boot restart of tracking is not wanted (role model §6: explicit resume) | V06 | — | — | — | FORBIDDEN in Phase 3; Phase 4 decision |
| USE_FULL_SCREEN_INTENT | Android | — | never by default | offers never depend on it (M26/ADR-033) | M26 | — | — | — | FORBIDDEN |
| SYSTEM_ALERT_WINDOW | Android | — | — | dev overlay only | — | — | — | — | FORBIDDEN in release |
| RECORD_AUDIO / NSMicrophoneUsageDescription | both | — | — | no audio feature (ADR-021 open) | U05 | — | — | — | FORBIDDEN |
| READ_CONTACTS / NSContactsUsageDescription | both | — | — | trusted contacts use manual entry/picker later (S14) | S14, U05 | — | — | — | FORBIDDEN |
| BLUETOOTH_CONNECT / BLUETOOTH_SCAN / NSBluetoothAlwaysUsageDescription | both | — | — | no feature | U05 | — | — | — | FORBIDDEN |
| READ/WRITE_EXTERNAL_STORAGE, READ_MEDIA_IMAGES/VIDEO/VISUAL_USER_SELECTED, ACCESS_MEDIA_LOCATION | Android | — | — | Photo Picker needs none | Q01, U05 | — | — | — | FORBIDDEN |
| READ_PHONE_STATE | Android | — | — | no device identifiers collected | U05 | — | — | — | FORBIDDEN |
| USE_BIOMETRIC / USE_FINGERPRINT | Android | — | — | no biometric unlock decision | Q01 | — | — | — | BLOCKED (no feature) |
| VIBRATE, ACCESS_NETWORK_STATE, CHANGE_WIFI_MULTICAST_STATE | Android | — | — | not needed (no NetInfo; Lite uses request timing) | L08 | — | — | — | BLOCKED (no feature) |

Rider-only users never see the camera, background-location, FGS or notification prompts in Phase 3 (INV-07, §7).

---

## 3. Exact Phase-3 deltas (applied at P3.5 only after FA-02)

### 3.1 Android release manifest delta
Added: `android.permission.ACCESS_COARSE_LOCATION`, `android.permission.ACCESS_FINE_LOCATION`. Nothing else. Expected merged release permission set afterwards: INTERNET, DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION, CAMERA, ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION. The P3.0 intent-filter/exported-component gate (F-P3-01) must also stay green (expo-location must not add an exported service or receiver to the release manifest without review).

### 3.2 Allowlist delta (`infra/ci/android/permission-allowlist.json`)

Move from `forbidden` to `allowed`:
```json
{
  "name": "android.permission.ACCESS_FINE_LOCATION",
  "justification": "Phase 3 rider pickup: foreground (when-in-use) only, requested just in time at the first 'Use current location' tap after an in-app rationale, together with COARSE; approximate-only grants are handled by asking the rider to confirm a pin. Never requested at start-up, never in the background, never for the Driver/Partner area in Phase 3. Denial falls back to search, pin and pickup points.",
  "requirementIds": ["B01", "B02", "A07", "V05", "U05"]
},
{
  "name": "android.permission.ACCESS_COARSE_LOCATION",
  "justification": "Requested together with FINE (Android 12+ requires both); an approximate-only grant biases search and centres the pin, never sets a pickup by itself.",
  "requirementIds": ["B01", "B02", "A07", "V05", "U05"]
}
```
Add to `forbidden` (defensive; these are absent today and must stay absent in Phase 3):
```json
{ "name": "android.permission.FOREGROUND_SERVICE", "reason": "Phase 3 has no foreground service; the driver location FGS is Phase 4 after SP-01/ADR-029." },
{ "name": "android.permission.WAKE_LOCK", "reason": "No background work in Phase 3; Phase 4 decides with ADR-029." },
{ "name": "android.permission.RECEIVE_BOOT_COMPLETED", "reason": "Tracking never restarts on boot; resume is explicit (role model section 6)." },
{ "name": "android.permission.BLUETOOTH_CONNECT", "reason": "No Bluetooth feature (U05)." },
{ "name": "android.permission.BLUETOOTH_SCAN", "reason": "No Bluetooth feature (U05)." }
```
Update the `phase` field to name Phase 3 (P3.5). ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE_LOCATION, POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT stay forbidden.

### 3.3 `app.config.ts` delta (P3.5)
- Add `expo-location` (Expo SDK 57 pinned line, ~57.0.20 per the lead's 2026-10-12 check; exact version chosen at install against `bundledNativeModules`, ADR-030) as a dependency and plugin:
  - `locationWhenInUsePermission`: rider usage string (below);
  - `isAndroidBackgroundLocationEnabled: false` (default false);
  - `isAndroidForegroundServiceEnabled: false` (adds FOREGROUND_SERVICE + FOREGROUND_SERVICE_LOCATION when true; defaults true only when background is enabled);
  - `isIosBackgroundLocationEnabled: false` (default false);
  - the "always" usage-string options set so that no Always string is written (Phase 3 must not ship NSLocationAlways* keys).
  - **Writer note: verify the exact option names and the meaning of `false` for permission strings against the Expo SDK 57 expo-location documentation at install; the release-manifest gate and an Info.plist check are the proof, not the config text.**
- Add `android.permission.FOREGROUND_SERVICE` to `BLOCKED_ANDROID_PERMISSIONS` (ACCESS_BACKGROUND_LOCATION and FOREGROUND_SERVICE_LOCATION are already blocked) as a second line of defence.
- iOS Info.plist: `NSLocationWhenInUseUsageDescription` only. Draft text (pending native review for the in-app rationale; iOS string itself in English): "Wayvro uses your location only while the app is open and only when you choose 'Use current location', to suggest your pickup point. You can always search or set the pickup on the map instead."
- A new CI/prebuild check (PROPOSED) asserts the generated Info.plist has no `NSLocationAlways*` key and no `UIBackgroundModes` `location` (iOS builds are not in CI yet; the check runs on prebuild output).

### 3.4 Architecture-test changes (`apps/wayvro-mobile/src/architecture.test.ts`)
1. Remove `expo-location` from the global forbidden import regex; add a rule: `expo-location` may be imported **only** by files under `src/platform/location/` (proposed directory).
2. Keep expo-task-manager, expo-background-fetch, expo-notifications, expo-media-library banned everywhere; keep react-native-maps banned until ADR-046 selects a renderer (then: renderer package only under `src/platform/maps/`).
3. Static string ban across `src/` (production files): `requestBackgroundPermissionsAsync`, `startLocationUpdatesAsync`, `startGeofencingAsync`, `hasStartedLocationUpdatesAsync`, `enableNetworkProviderAsync`.
4. `src/platform/location/` exposes two entry points: `status` (read-only: `getForegroundPermissionsAsync`, services-enabled check) and `request` (rationale-gated request, one-shot fix, scoped watch). `features/driver/` may import only `status`; `features/rider/` may import both; `core/` imports neither (boot never evaluates the location module).
5. No production file logs (existing) — coordinates therefore never reach device logs.

---

## 4. Rider location state machine (A07)

### 4.1 States and transitions

```
UNKNOWN ──(status read on rider home mount; no prompt)──▶ NOT_DETERMINED | GRANTED_PRECISE | GRANTED_APPROXIMATE
                                                         | DENIED_CAN_ASK | BLOCKED | SERVICES_OFF
NOT_DETERMINED | DENIED_CAN_ASK ──(tap "Use current location")──▶ RATIONALE
RATIONALE ──(Continue)──▶ REQUESTING ──▶ GRANTED_PRECISE | GRANTED_APPROXIMATE | DENIED_CAN_ASK | BLOCKED
RATIONALE ──(Not now)──▶ previous state (no OS dialog)
GRANTED_* ──(tap / pin screen focus)──▶ FIXING ──▶ FIX_OK | FIX_TIMEOUT | FIX_UNAVAILABLE
GRANTED_* ──(foreground re-check finds denial)──▶ REVOKED ──▶ DENIED_CAN_ASK | BLOCKED
GRANTED_PRECISE ──(user downgrades in Settings; Android may restart the process)──▶ GRANTED_APPROXIMATE
GRANTED_APPROXIMATE ──(tap "Use precise location" → re-request)──▶ REQUESTING
any ──(device location off)──▶ SERVICES_OFF ──(turned on, foreground)──▶ re-read
```

`BLOCKED` = Android "don't ask again" (`canAskAgain=false`, including the automatic block after repeated denials on Android 11+) or iOS denied. The app never loops the OS dialog.

### 4.2 UI per state

| State | UI |
|---|---|
| UNKNOWN | nothing location-specific yet |
| NOT_DETERMINED | "Use current location" button |
| RATIONALE | `/ride/location`: why (pickup suggestion), when (only while open, only on tap), what is sent (point to Wayvro servers for address/price), not stored on the phone, alternatives; Continue / Not now |
| REQUESTING | OS dialog; app shows nothing over it |
| GRANTED_PRECISE + FIX_OK | pickup card "Current location: {address}"; user still confirms |
| GRANTED_APPROXIMATE | "Wayvro has your approximate area only. Choose your exact pickup." — search biased, pin centred on the area, pickup never auto-set; "Use precise location" link |
| FIX_TIMEOUT / FIX_UNAVAILABLE | "Couldn't find your location. Search or set the pickup on the map." + Retry |
| DENIED_CAN_ASK | button stays; next tap shows the rationale again (at most once per session) |
| BLOCKED | "Location is off for Wayvro. You can turn it on in Settings." + "Open settings" (expo-linking app settings) — search/pin unaffected |
| SERVICES_OFF | "Your phone's location is turned off." + settings hint |
| REVOKED | silent fallback: current-location card disappears; in-memory fixes are discarded; no dialog |

### 4.3 Approximate handling
Approximate coordinates are used only as a search bias (2 decimals) and to centre the pin view. They are never sent as a quote pickup without the rider choosing a place or confirming a pin. The UI never labels an approximate point as "your location".

### 4.4 Fix parameters (verify option names at install)

| Use | Parameters |
|---|---|
| One-shot ("Use current location") | last known position accepted if ≤ 30 s old and ≤ 100 m accuracy; else current position, Balanced accuracy, 10 s app-side timeout; one attempt + one manual retry |
| Watch (pin screen only, P3.7 renderer or text-first "refresh") | only while `/ride/pin` is focused and the app is active; time interval ≥ 5 s, distance interval ≥ 10 m; stopped on blur, background, sign-out, or revocation |
| Never | no watch on rider home; no location while backgrounded; no location in Lite mode unless the rider taps |

### 4.5 Privacy
- Coordinates live in memory only; never persisted on the device (no recents with coordinates, no cache), never logged (no console in production; server pino redaction of lat/lng keys and coordinate pairs + a new test that geo routes log templates only).
- Precision sent: pickup/drop-off and reverse geocode at 5 decimals (≈1 m); autocomplete bias at 2 decimals (≈1.1 km cell), rounded on the device before sending.
- Sent only to Wayvro's API (quote, reverse geocode, autocomplete bias). Providers receive Wayvro's server request, never the device or account id.
- Location is not used for analytics, ads or crash reporting (none installed; U04).

---

## 5. Driver permission state machine — Phase 4 escalation design (no Phase-3 code)

Phase 3 ships only: the informational readiness row and `/drive/location` rationale (status read, no request), and the SP-01 spike **outside** the release app (proposed `tests/spikes/sp-01-background-location/`). The states below are design input for Phase 4, parameterised by SP-01/ADR-029.

```
FG_NONE ──(go-online prerequisites; rationale)──▶ FG_REQUESTING ──▶ FG_GRANTED | FG_DENIED
FG_GRANTED (precise required for driving) ──(prominent disclosure: "location" wording, all-the-time use while online)──▶ BG_RATIONALE
BG_RATIONALE ──(Android 11+: Settings page "Allow all the time")──▶ SETTINGS_REDIRECT ──(return, re-read)──▶ BG_GRANTED | BG_DENIED
BG_GRANTED ──(POST_NOTIFICATIONS asked with benefit statement; denial tolerated)──▶ READY_TO_GO_ONLINE
READY_TO_GO_ONLINE ──(user taps Go online while app in foreground; server canGoOnline)──▶ FGS_RUNNING (type location)
FGS_RUNNING ──(stop condition)──▶ STOPPED (server informed; offline reason-coded)
```

- Android 14+: a location FGS cannot be started from the background without ACCESS_BACKGROUND_LOCATION; it is started only as a continuation of the user-initiated go-online action, with FOREGROUND_SERVICE_LOCATION declared (re-verify at Phase 4).
- Android 13+: the FGS can run without notification permission, but its notice is then not shown in the drawer (re-verify); offers never depend on push or USE_FULL_SCREEN_INTENT (M26/ADR-033).
- **Stop conditions (all):** go offline; sign-out or session expiry/displacement; driver or account restriction; switching to Rider mode (Phase 4 rule: offline first); permission revocation or downgrade to approximate/while-in-use; FGS killed; stale heartbeat beyond `T_offline`; app update requiring re-consent.
- Revocation detection target ≤ 30 s with forced offline + reason (SP-01 criterion); crash/kill recovery: if the FGS runs but the server says OFFLINE ⇒ stop; if the server says ONLINE but no FGS ⇒ "tracking stopped" + explicit resume (role model §6).
- SP-01 linkage: `docs/phase3/PHASE3_SP01_REAL_DEVICE_PROTOCOL.md` measures items 1–4, 6–8, 10–11 on ≥ 3 OEM classes; ADR-029 decides expo-location + expo-task-manager vs Transistorsoft (FD-08). Only then does Phase 4 propose the allowlist change for BACKGROUND/FGS permissions.

---

## 6. INV-07 proof plan (rider-only account never receives background-location, FGS or KYC prompts)

| Layer | Proof | When |
|---|---|---|
| Static — manifest | release AAB permission gate: no ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE*, POST_NOTIFICATIONS | every CI run |
| Static — code | architecture test: background location APIs string-banned; expo-location only in `src/platform/location/`; camera only in `features/driver/`; driver screens lazy | every CI run |
| Static — iOS | prebuild Info.plist check: no Always key, no background mode | P3.5 onward |
| E2E (SP-08) | account A full rider journey (sign-in → home → search → use current location → quote → fare → account hub → sign-out) asserts the only system dialog seen is the foreground location dialog after the rationale; after the run `adb shell dumpsys package <appId>` shows no camera grant request and `adb shell appops get <appId> CAMERA` shows no use | PR tier (core) + nightly |
| Device | SP-01 rider-hygiene check on the real release app on each OEM class | P3.6 (FA-03) |
| Lazy modules | SP-02 Perfetto/Hermes evidence that rider start-up evaluates 0 driver feature modules (F-P3-07) | P3.6 (FA-04) |

Result reporting: NOT RUN until each layer actually runs; emulator results never substitute for device results.

---

## 7. Play and App Store policy notes (re-verify every date before submission)

- **Play location permission declaration (CL-16):** per Google's policy page and 2026-04-15 announcement (read 2026-10-12, re-verify): from **2027-01-27** any app declaring a location permission needs a Play Console declaration and review; pre-review checks start **2026-10-27**. FINE is allowed only when COARSE cannot support the feature (or, from Android 17+, the system location button cannot); apps targeting API 37+ that need precise location only for one-time user-initiated actions must use the location button. Wayvro targets API 36 today; a target-37 upgrade must revisit the rider one-shot flow. Phase 3 drafts the declaration text (rider pickup precision; later driver live tracking) on the EG-18 track; submission is a founder action.
- **Background location declaration + prominent disclosure + video:** Phase 4 design, store submission Phase 9 (EG-18).
- **FGS type declaration (`location`) with demo video:** Phase 4 implementation, Play Console declaration before the first driver-online release.
- **Data safety / App Privacy:** Phase 3 adds "Location — approximate and precise, collected, not shared for advertising, purpose: app functionality" (draft for `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md`, U04); final declaration EG-18.
- **iOS:** when-in-use only in Phase 3; App Review notes explain the one-tap pickup use.

---

## 8. Data retention statement (Phase 3)

- Phase-3 location is used only to suggest a pickup, resolve an address and price a quote. There is no trip, no tracking, no location history.
- Server side: pickup/drop-off points are stored only inside quote rows (`pricing.quotes`) and route snapshots; unaccepted quotes and snapshots are purged after **30 days (placeholder until EG-16 retention schedule)**; geo cache keys use rounded coordinates with short TTLs (`docs/phase3/PHASE3_ARCHITECTURE.md`); no coordinates in logs; support lookup shows district only.
- Device side: nothing persisted; in-memory values are dropped on revocation, sign-out and process death.

---

## 9. Explicitly forbidden in Phase 3

Contacts; Bluetooth (connect/scan/advertise); microphone/RECORD_AUDIO; storage and media permissions (READ/WRITE_EXTERNAL_STORAGE, READ_MEDIA_*, ACCESS_MEDIA_LOCATION); USE_FULL_SCREEN_INTENT; SYSTEM_ALERT_WINDOW in release; ACCESS_BACKGROUND_LOCATION; FOREGROUND_SERVICE and FOREGROUND_SERVICE_LOCATION; POST_NOTIFICATIONS; READ_PHONE_STATE; WAKE_LOCK; RECEIVE_BOOT_COMPLETED; any geofencing or background task registration; any location prompt at app start or for an account that has not tapped a location action; any location prompt in the Driver/Partner area in Phase 3.
