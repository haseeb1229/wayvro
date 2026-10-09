# Phase 0 research evidence R4 — Mobile platform and store-policy research (observed 2026-10-09)

**Provenance:** produced by a Claude research subagent during Phase 0 using live web search/fetch. "UNVERIFIED" = could not confirm against an official page. Feeds ADR-003, ADR-024, ADR-029, ADR-033, spike definitions SP-01/SP-02, `PHASE0_UNIFIED_APP_ROLE_MODEL.md` and new requirements M26/Q49.

> **Phase 0 founder-review closure note (2026-10-09):** this file is preserved verbatim as historical research evidence. Where it prescribes a decision, the canonical outcome is in `docs/phase0/PHASE0_GAP_REPORT.md` (CL-17..CL-22, FD-01..FD-14) and the requirement register; bracketed *[Closure note]* annotations below mark superseded conclusions.

## 1. Google Play (Android)

**Facts**
- **Background location** needs the Permissions Declaration Form (App content > Sensitive app permissions > Location). Only **one** background feature may be declared; approval covers the whole app; a ≤30s video must show the feature activated from background, the prominent in-app disclosure (must contain the word "location" and name background use), and the runtime prompt. Google's own example lists "delivery tracking for users (not drivers)" as foreground-only, implying driver-side live tracking is an acceptable background case. No explicit multi-role rule. [support.google.com/googleplay/android-developer/answer/9799150]
- **Foreground services**: apps targeting Android 14+ must declare each FGS type in Play Console with description, user-impact text, use case, and a demo video. `TYPE_LOCATION` approved use cases: user-initiated location sharing, navigation, geofencing — but **geofencing is removed as an approved FGS use case on 2027-01-27**. [answer/13392821; table/12921780]
- Android 14: FGS type + matching `FOREGROUND_SERVICE_LOCATION` permission required. Android 15: `dataSync`/`mediaProcessing` capped at 6h/24h; location type has **no timeout**. Android 16: jobs started from an FGS count against JobScheduler/WorkManager quotas. FGS cannot be started from background (Android 12+). [developer.android.com/develop/background-work/services/fgs/changes, /timeout]
- **Android 16 target behaviours** (API 36): edge-to-edge opt-out removed; predictive back on by default; orientation/resizability restrictions ignored on ≥600dp screens. [developer.android.com/about/versions/16/behavior-changes-16]
- **Target SDK**: API 36 required for new apps/updates since 2026-08-31 (extension requests close 2026-11-01). Third-party summaries; treat the exact date as HIGH-probability, verify in Console.
- **16 KB page size**: apps targeting API 35+ must support 16 KB on 64-bit; **from 2027-02-01 updates that don't are blocked**. AGP ≥8.5.1 + NDK r28+ default. [developer.android.com/guide/practices/page-sizes] *[Closure note (CL-22): Wayvro does not hard-code NDK r28; the NDK/AGP follow the supported Expo SDK/RN/AGP combination and the gate is a reproducible production build with verified 16 KB alignment. Android builds use JDK 17 on the RN/Expo path.]*
- **Account deletion**: in-app path + web URL + Data safety "Data deletion" answers; enforced since 2024-05-31. [answer/13327111]
- **Data safety form** mandatory; background location + SDK collection must be declared; prominent disclosure before the permission prompt.
- **answer/16558241** = "Permissions and APIs that Access Sensitive Information": two changes effective **2027-01-27**: (a) the **location button** becomes the recommended minimum scope for precise location; every app requesting `ACCESS_FINE_LOCATION` must file a Play Console declaration (available Nov 2026) explaining why coarse/location-button is insufficient (navigation, live tracking listed as acceptable persistent needs); (b) broad contacts access restricted — use Contact Picker. Same date: READ_CALL_LOG no longer allowed for phone-call verification. [answer/16558241, 17033915]
- **Play Integrity**: free; **10,000 requests/app/day default**; verdicts `MEETS_BASIC/DEVICE/STRONG_INTEGRITY`, `PLAY_RECOGNIZED`, `LICENSED`; requires Play-installed app. [developer.android.com/google/play/integrity/overview]
- **Developer verification / D-U-N-S**: organisation Play accounts require a D-U-N-S. Android developer verification: enforcement started 2026-09-30 in BR/ID/SG/TH; **global expansion 2027**. [answer/10841920; developer.android.com/developer-verification]
- **Fee**: US$25 one-time. **Staged rollouts**: updates only, % does not auto-increase, halt/resume affects the same user set. [answer/6346149]
- **Financial services / KYC**: Financial features declaration must be completed for every app; policy targets loans/EWA/crypto. Driver payouts and CNIC/selfie KYC not addressed by Play policy text found (UNVERIFIED gap) — fall under User Data (prominent disclosure, Data safety: "Personal info / Photos / Government ID"). If Wayvro ever adds driver micro-loans/fuel advances, the Personal Loans policy applies.

**Implications**: Declare one background feature ("driver live trip tracking while online/on-trip"); gate `ACCESS_BACKGROUND_LOCATION` + `FOREGROUND_SERVICE_LOCATION` requests behind approved Driver mode; prepare three videos (background location, FGS location, fine-location declaration in Nov 2026). Do not use `location` FGS for geofencing. Ship with AGP 8.5.1+/NDK r28+ and run 16 KB check on every AAB. *[Closure note: superseded by CL-22 — toolchain per supported Expo/RN/AGP combination, JDK 17, 16 KB check on every AAB.]* Budget ~2-week org D-U-N-S lead time before any Console work.
**Confidence**: High on policy text; Medium on target-SDK date.

## 2. Apple App Store (iOS)

**Facts**
- **Background location**: Guideline 2.5.4 allows background services only for intended purposes (VoIP, audio, location…). 5.1.1(ii) purpose strings must clearly describe data use; 5.1.1(iii) data minimisation. Reports of rejections when `Always` is declared but no real background feature exists. Practice: request When-In-Use first, upgrade to Always only on driver go-online; include review notes with a demo path.
- **Always flow**: standard behaviour is When-In-Use first, later `requestAlwaysAuthorization()` shows a system-timed second prompt; requires `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocationWhenInUseUsageDescription`, `UIBackgroundModes: location`.
- **Account deletion**: 5.1.1(v) in-app account deletion required (since 2022-06-30). Sign in with Apple token revocation on deletion widely reported but UNVERIFIED against Apple text.
- **4.8 Login Services**: if Google Sign-In is offered as primary login you must offer an equivalent privacy-preserving option — Sign in with Apple in practice. Exempt if using only your own account system (phone+OTP only avoids 4.8).
- **Privacy**: nutrition labels + `PrivacyInfo.xcprivacy` with required-reason API entries for app and SDKs (enforced since 2024-05-01). Expo has a privacy-manifest guide. [docs.expo.dev/guides/apple-privacy/]
- **Age ratings**: new 13+/16+/18+ tiers; questionnaire deadline 2026-01-31. Xcode 26/iOS 26 SDK required for uploads since 2026-04-28. [developer.apple.com/news/upcoming-requirements/]
- **App Attest/DeviceCheck**: Secure Enclave key attested once per install; `isSupported` false on Simulator/some devices — treat as a risk signal, not a block.
- **TestFlight**: 100 internal, 10,000 external testers, builds expire 90 days, first external build goes to App Review.
- **Fees**: Developer Program **$99/yr**. Org enrolment needs a **D-U-N-S** registered to a legal entity; D&B up to 5 business days, Apple +2.

**Implications**: Phone-OTP-first auth sidesteps 4.8; if Google login is added, add Sign in with Apple. Build the Always upgrade only inside the driver go-online flow with an in-app pre-prompt. Add privacy manifest audit to CI.
**Confidence**: High.

## 3. React Native + Expo (state as of 2026-10-09)

**Facts**
- **Versions**: Expo **SDK 57 stable** (released 2026-06-30; RN 0.86, React 19.2; 57.0.17+ fixes a Hermes V1 memory regression). **SDK 58 beta** (2026-09-15) on RN 0.88 RC; RN 0.88.0 scheduled 2026-10-12; npm `latest` RN = 0.87.1. [expo.dev/changelog/sdk-57, sdk-58-beta; reactnative.dev/releases/overview]
- **New Architecture**: mandatory since SDK 55 / RN 0.82. **Hermes V1 default since RN 0.84**. RN 0.87 made Strict TypeScript API default.
- **expo-location**: background via `startLocationUpdatesAsync` + `TaskManager.defineTask`; config plugin `isAndroidBackgroundLocationEnabled`, `isAndroidForegroundServiceEnabled`, `isIosBackgroundLocationEnabled`. Docs state: background location **stops if the user terminates the app**; Android will not auto-restart on location events; "removing from recents may or may not kill it depending on vendor". **Not available in Expo Go.**
- Historical expo issues (#15081 Redmi Android 10/11, #15603/#15604/#15619 SDK 44) show FGS dying after app kill; #32545 FGS cannot start from background. No current Xiaomi/Oppo/Vivo-specific open issue found (UNVERIFIED that these are fully resolved).
- **expo-notifications**: remote push unavailable in Expo Go on Android since SDK 53; development build required; FCM V1 service-account credentials required; headless background handling needs expo-task-manager, data-only payloads, iOS `remote-notification` background mode; Android 13+ needs a channel before permission prompt.
- **EAS pricing**: Free $0 — 15 Android + 15 iOS builds/mo, low-priority queue, 1 concurrent, 45-min timeout, 1,000 EAS Update MAU. Starter $19, Production $199. Overage: Android $1–2/build; iOS $2–4/build. [expo.dev/pricing]
- **Transistorsoft react-native-background-geolocation**: commercial — Starter **$399** one app key (perpetual, 1 year updates); free in debug builds. Flutter plugin 5.4.0 (Jul 2026) moved geofencing/motion off FGS; 5.8.1 (Oct 2026) fixed ANR/dup-location after process kill.
- **Maps**: react-native-maps v1.29.11 (2026-09-27). `@maplibre/maplibre-react-native` 11.5.0 (New Arch only, RN ≥0.80, MapLibre Native 13.6.1). Mapbox RN is paid above free tier.
- **Size/startup**: no rigorous 2026 low-end benchmark found — measure in spike.
- **Code splitting**: no native RN code-splitting; patterns are `React.lazy`/dynamic `require` with Metro inline-requires and lazy screen registration; Android dynamic feature modules not supported by Expo/RN tooling.

**Implications**: Use **dev builds + EAS** (Expo Go is non-viable). Free tier (30 builds/mo) is enough for a solo dev if EAS Update handles JS iterations. Decide early between expo-location (free, documented limits on killed apps) and Transistorsoft ($399, mature OEM handling). Keep driver-only modules behind lazy requires.
**Confidence**: High on versions/pricing; Medium on OEM reliability.

## 4. Flutter alternative

- Stable **3.47** (2026-08-12; 3.47.6 on 2026-10-01), Dart 3.13. 3.44 (2026-05-18) froze Material/Cupertino in-framework, moving to `material_ui`/`cupertino_ui` packages. Impeller default on Android API 29+ with OpenGL fallback; mixed low-end reports (issue #175128 cold-start regression; #183510). [docs.flutter.dev/release/whats-new; flutter.dev/blog/whats-new-in-flutter-3-44]
- Background location: `flutter_background_geolocation` (same Transistorsoft licence) is the mature option; `geolocator` needs a separate foreground-task plugin.
- **Deferred components**: Android (Play Feature Delivery) and web; no iOS Dart deferral. [docs.flutter.dev/perf/deferred-components]
- Hiring (Pakistan): Indeed PK shows 100+ RN/Flutter listings; advertised bands overlap; no clear premium either way.

**Fair comparison for a solo junior + AI assistance**: RN/Expo wins on JS/TS ecosystem overlap with backend/web, OTA updates (EAS Update), and larger AI training corpus; Flutter wins on deferred components, consistent rendering, single-language toolchain, but carries the Material/Cupertino package migration churn in 2026 and Impeller low-end risk. Both rely on the same commercial SDK for robust background location. Recommendation: stay with RN + Expo dev builds unless the spike fails the background-location or cold-start gates.
**Confidence**: Medium.

## 5. Android device landscape, Pakistan 2025–26

- StatCounter mobile vendor share, **Sep 2026** (page views): Samsung 17.35%, Infinix 15.04%, Vivo 11.9%, Xiaomi 10.64%, Apple 10.17%, Oppo 10.14%. Android ~92.8% of mobile OS. [gs.statcounter.com/vendor-market-share/mobile/pakistan]
- Unit share (secondary, Q2 2025): Transsion (Infinix+Tecno+Itel) 44%, Xiaomi 18%, Vivo 17%, Samsung 10%, Oppo 6% (UNVERIFIED). FY2025-26 PTA-based volume 39.2M units: Vivo 15.7%, Tecno 13.6%, Infinix 11.2%, Samsung 10.7%, Xiaomi 10.4%. 2025 local assembly 30.2M handsets, of which only 15.6M smartphones vs 14.6M 2G feature phones.
- **Android versions, Sep 2026** (StatCounter): 16 = 21.4%, 15 = 16.4%, 13 = 14.8%, 14 = 11.9%, 11 = 11.5%, 12 = 8.8% (remaining ~15% older). Implies **minSdk 26–29** is defensible; ~11% still on Android 11.
- Sub-PKR-30k devices: Infinix Smart 10 (Rs 23,999; Android 15 Go; Unisoc T7250; 3–4 GB RAM), Smart 10 Plus, Redmi A5 (4 GB), Redmi 14C (6 GB), Tecno Spark 30C, Galaxy A06. Expect 3–4 GB RAM, Unisoc/Helio G-series, Android Go editions, HiOS/XOS skins.
- Network: PTA 2024-25 — 4G coverage ~95%; Opensignal Q2 2026 — 4G 93.7% of connected time, 5G ~4%, avg 4G download ~18.9 Mbps; ~148M 3G/4G of ~196M subs.
- 64-bit/16 KB: all current Transsion/Unisoc budget phones are arm64; 16 KB-page devices rare in PK today — the constraint is Play compliance.

**Implications**: Primary test matrix = Infinix/Tecno (HiOS/XOS, Android Go), Vivo (Funtouch/OriginOS), Xiaomi (HyperOS), plus one Samsung A-series. Design for 3 GB RAM, 18 Mbps, intermittent 3G; ship arm64-only AAB. *[Closure note: superseded by Q49 — the ABI set is chosen from dependency compatibility and measured Pakistan device coverage; arm64-v8a required, armeabi-v7a included where dependencies support it and coverage justifies it; arm64-only only after explicit device/market evidence; AAB split delivery.]*
**Confidence**: High for StatCounter/PTA; Low–Medium for unit-share figures.

## 6. Push and SMS

- FCM legacy API shut down July 2024; **HTTP v1 with service-account OAuth is mandatory**; Expo push requires FCM V1 credentials. APNs via token-based auth (.p8).
- dontkillmyapp.com ranking (worst first): Xiaomi #2, OnePlus #3, Samsung #4, Oppo #8, Vivo #11, realme #12, **Tecno #15**; Infinix not listed (same Transsion stack — UNVERIFIED equivalence). Xiaomi: "in default settings background processing does not work right". [dontkillmyapp.com]
- Android SMS: `READ_SMS` restricted to default-SMS apps; use **SMS Retriever API** (11-char app hash, zero prompts) or **SMS User Consent API** (one-tap consent). iOS: `textContentType = .oneTimeCode` autofill; reports of iOS 26.x multi-field OTP autofill bugs — use a single field.

**Implications**: Data-only FCM pushes for driver dispatch must not be the sole wake mechanism on Xiaomi/Transsion; keep a socket/poll fallback inside the location FGS while online *[Closure note: canonical M26/ADR-033 makes the realtime socket/poll path the PRIMARY offer channel while online and push a wake aid only; full-screen intent is not requested by default.]* and show an OEM-specific "disable battery optimisation / autostart" onboarding step (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` justified as core functionality). Use SMS Retriever with the OTP provider's hash; fall back to User Consent.
**Confidence**: High.

## 7. Device integrity

- Play Integrity: `MEETS_DEVICE_INTEGRITY` on Android 13+ requires locked bootloader + certified image; `STRONG` also needs security patch <1 year — many PK budget phones will fail STRONG legitimately. Rooted/custom-ROM users spoof via Zygisk modules, so it is a signal, not a gate. 10k/day default quota.
- App Attest: attest once per key, assertions thereafter; `isSupported` false on Simulator/older devices.
- Sideloaded (APK-shared) installs return `UNLICENSED`/`UNEVALUATED` — common in PK via shared APKs.

**Implications**: Use integrity for **risk scoring on driver go-online, payouts and promo redemption**, never as a hard block for Rider booking; expect STRONG to fail on a large share of legitimate drivers' phones; require Play-installed app only for payout-sensitive flows.
**Confidence**: High.

## Spike plan (Phase-0, on-device) — adopted as SP-01/SP-02 in `PHASE0_ADR_BACKLOG.md`

Devices: Infinix Smart 10 (Android 15 Go, 3–4 GB), Tecno Spark 30C, Vivo Y-series (Funtouch), Redmi 14C/A5 (HyperOS), Samsung A06, one Android 16 Pixel/emulator, iPhone (iOS 26). Build: Expo SDK 57 dev build (New Arch, Hermes V1), release AAB arm64, targetSdk 36, AGP 8.5.1+. *[Closure note: spike builds use JDK 17 and the supported Expo/RN/AGP/NDK combination; ABI set per Q49; schedule per `PHASE0_ADR_BACKLOG.md` §E; devices acquired progressively (FD-13).]*

1. **Rider-only permission hygiene** — fresh install, complete Rider onboarding + a booking. PASS: `adb shell dumpsys package` shows `ACCESS_BACKGROUND_LOCATION` never requested at runtime; no FGS notification ever appears; no camera/notification prompts outside their feature screens.
2. **Driver go-online background location** — grant Always/All-the-time, go online, screen off, app backgrounded 60 min on each device with default battery settings; then repeat after OEM battery whitelist. PASS: ≥95% of expected location points reach the server over 60 min; FGS notification persists; iOS background indicator shows; battery drain ≤6%/h (record actual).
3. **Swipe-away / process kill** — remove from recents, then `adb shell am kill`. PASS A (expo-location): client detects stop within 60 s, server marks driver offline/stale, user sees "tracking stopped" notification on next launch. PASS B (Transistorsoft): service survives swipe on Vivo/Xiaomi/Tecno with whitelist; document each OEM.
4. **FGS start rules** — trigger go-online from a push while backgrounded. PASS: no `ForegroundServiceStartNotAllowedException`; app routes to a foreground screen first.
5. **Cold start** — release build, airplane mode and 3G throttle, `adb shell am start -W` ×5 after reboot. PASS: TTI to Rider home ≤2.5 s on Infinix Smart 10 (p50), ≤4 s p90; download size ≤30 MB; driver modules not loaded.
6. **Push wake** — data-only FCM to backgrounded/killed app on each OEM. PASS: delivered within 10 s while whitelisted; record failure rate un-whitelisted.
7. **Permission revocation / downgrade** — revoke location mid-trip; iOS downgrade Always → While Using. PASS: app detects within 30 s, trip state recovered from server on relaunch, driver forced offline with reason code.
8. **Crash recovery** — force JS crash and native crash during trip; relaunch. PASS: authoritative trip/mode restored from server, no duplicate FGS, no duplicate location batch.
9. **KYC capture** — CNIC front/back + selfie with expo-camera on 3 GB device. PASS: capture ≤3 s, image ≤1.5 MB, OCR-legible at 1080p, memory <250 MB peak.
10. **Integrity** — Play Integrity standard request on each device + one rooted phone. PASS: record verdict matrix; `DEVICE` passes on all stock devices; API latency <1.5 s p90.
11. **Compliance build check** — `bundletool` 16 KB alignment check, Play Console pre-launch report, privacy manifest present, Data safety draft, FGS/background-location videos recorded.

Exit gate: items 1, 2 (≥95% on at least Infinix+Vivo+Xiaomi), 5, 7, 8 must pass on RN/Expo; otherwise rerun 2/3/5 on a Flutter + flutter_background_geolocation build before choosing the stack.

**Key sources** (observed 2026-10-09): support.google.com/googleplay/android-developer/answer/{16558241,17033915,9799150,13392821,13327111,11926878,6112435,6346149,9876821,13849271,10841920}, table/12921780; developer.android.com/{guide/practices/page-sizes, about/versions/16/behavior-changes-16, develop/background-work/services/fgs/changes, fgs/timeout, google/play/integrity/overview, developer-verification}; developer.apple.com/{app-store/review/guidelines, programs, help/account/membership/D-U-N-S, help/app-store-connect/.../testflight-overview, news/upcoming-requirements}; expo.dev/{changelog/sdk-57, changelog/sdk-58-beta, pricing}; github.com/expo/expo docs location.mdx & notifications.mdx; reactnative.dev/{blog, releases/overview}; shop.transistorsoft.com; pub.dev/packages/flutter_background_geolocation/changelog; docs.flutter.dev; flutter.dev/blog/whats-new-in-flutter-3-44; gs.statcounter.com (PK vendor & Android version, Sep 2026); dontkillmyapp.com; pta.gov.pk annual report 2024-25; techjuice.pk Q2-2026; developers.google.com/identity/sms-retriever; github.com/react-native-maps releases.
