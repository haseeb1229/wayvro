# PHASE3_MOBILE_UX_AND_NAVIGATION — Unified-app shell, mode navigation, rider quote UX and driver readiness (PROPOSED)

**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — pending founder/ChatGPT review; no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

Requirement IDs covered by this document: V08, V05, V11, A01, A06, A07 (UI side), A08, B01, B02, B03, B04, B06 (rider display), K19, L08, P18, Q31 (client behaviour), R28 (rider display). Permission and location detail lives in `docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md`; cross-mode E2E proof in `docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md`; endpoint and schema detail in `docs/phase3/PHASE3_ARCHITECTURE.md` and `docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md` (those documents own exact paths; endpoint names below are PROPOSED references).

Founder-locked frame (CLAUDE.md §2/§3, `docs/28_APP_SURFACES_AND_REPO_TOPOLOGY.md`): ONE app (`apps/wayvro-mobile`), one account, Rider mode for everyone, Driver/Partner mode after server approval, the mode switch is never a security boundary.

---

## 1. Current state (repository truth at `6aed6a4`)

### 1.1 Route files today (`apps/wayvro-mobile/src/app/`)

| Route (URL) | File | Screen module | Loading |
|---|---|---|---|
| `/` | `index.tsx` | `core/account/EntryRedirect` (signed in ⇒ `/home`, else `/sign-in`) | eager |
| `/sign-in` | `sign-in/index.tsx` | phone entry | eager |
| `/sign-in/verify` | `sign-in/verify.tsx` | OTP entry | eager |
| (group) | `(session)/_layout.tsx` | `AccountGate` wrapping one `Stack` | eager |
| `/home` | `(session)/home.tsx` | `features/account/home/HomeScreen` (greeting, deletion banner, restriction notices, "rides coming" banner, Earn/Driver entry, profile/sessions/security/legal links, language, sign out) | eager |
| `/profile`, `/security`, `/sessions` | `(session)/*.tsx` | account slice | eager |
| `/required-action` | `(session)/required-action.tsx` | recovery review / phone step-up | eager |
| `/onboarding/policies`, `/onboarding/age` | `(session)/onboarding/*.tsx` | consent, age declaration | eager |
| `/account`, `/account/appeal`, `/account/delete`, `/account/phone`, `/account/recovery` | `(session)/account/*.tsx` | account security, restriction appeal, deletion, phone change, recovery | eager |
| `/legal`, `/legal/[policyKey]/[version]` | `(session)/legal/…` | policy list and text | eager |
| `/earn` | `(session)/earn/index.tsx` | `features/driver/screens/DriverHubScreen` | **lazy** (`lazyScreen(() => import(…))`) |
| `/earn/appeal`, `/earn/capture`, `/earn/compliance`, `/earn/details`, `/earn/document`, `/earn/documents`, `/earn/renewal`, `/earn/vehicle` | `(session)/earn/*.tsx` | Driver/Partner onboarding, capture, compliance, renewals, appeals | **lazy** |
| `/earn/policies` | `(session)/earn/policies.tsx` | `features/account/policies/PolicyAcceptanceScreen` (driver policy variant) | eager (account-slice screen, no driver module) |

Shell facts that this plan builds on:
- Root `_layout.tsx` = `SafeAreaProvider` → `AppRoot` → one native `Stack` (`index`, `(session)`). No tabs, no drawer.
- `AppRoot` resolves API config, creates services once (`app-services.ts`: secure `KeyValueStore`, `SessionManager`, typed `WayvroClient`, server-clock offset, TanStack `QueryClient`, `SignInFlow`), wires foreground refetch via `AppState`, and requests no permission and starts no background work. Session wipe already clears intents, query cache, sign-in flow and (via a dynamic import) driver evidence.
- `AccountGate` routes ONLY on `requiredActions` (pure `redirectFor` in `account-route.ts`); restrictions are shown as notices (`RestrictionNotices`, filtered by server `affectsRiderUse`) and enforced by the server (`WAYVRO_E_ACCOUNT_RESTRICTED`), not by the gate.
- Driver entry on `/home` is a presentation hint from `AccountState.driver` (`driverEntry()` in `features/account/home/home.ts`): `apply` | `driver` | null.
- `features/rider/` contains only `apps/wayvro-mobile/src/features/rider/README.md`. There is no `src/platform/` directory in the app yet (the README already names it as a shared layer; device helpers live in `src/core/platform/`).
- `architecture.test.ts` enforces: thin route files (< 25 lines, default export), driver screens only via `lazyScreen(import())`, core never statically imports `features/driver/`, rider/driver/account feature isolation, camera/picker/file-system only in `features/driver/`, a global import ban on expo-location, expo-notifications, expo-task-manager, expo-background-fetch, react-native-maps, expo-media-library, no console logging, secure storage only.
- No i18n library: typed catalogue `core/i18n/strings.ts` (en source; ur/ur-Latn provisional, `PENDING_REVIEW_LOCALES`), driver catalogue `features/driver/i18n/driver-strings.ts`, RTL per component (`isRtl`), `TranslationPendingNote`.
- Design tokens are provisional (`core/ui/tokens.ts`: colours, spacing, 4 type styles, `MIN_TOUCH_TARGET = 48`); primitives (`core/ui/primitives.tsx`): Screen, Title, Heading, Body, Button (primary/secondary/danger, busy), LinkRow, TextField, Checkbox, RadioGroup, Banner (info/warning/error), PlaceholderBadge, TranslationPendingNote, ErrorBanner, StateView; view-state adapters (`core/ui/view-state.ts`: loading / error / empty / ready+stale).
- Reanimated, gesture-handler and worklets are excluded from autolinking (ADR-043; F-P3-08). `updates.enabled=false`. No URL scheme is configured in `app.config.ts`, but the release AAB still registers `exp+wayvro` through expo-dev-client (F-P3-01 (verified on the 2026-10-11 local release AAB; re-verification on the post-repair CI artefact recorded in `docs/phase3/PHASE3_PLAN.md`); fixed at P3.0).

### 1.2 What does not exist yet
Rider screens, mode controller, driver home outside `earn/*`, intent router, version/maintenance handling, location, maps, client flags/config, Lite mode, quote UI, money formatting for display, component or device E2E tests.

---

## 2. Target route tree (additive — every existing route is kept)

The rider and driver graphs are plain directories inside the existing `(session)` group, so they are real URL segments: `/ride/*` (eager) and `/drive/*` (lazy); each directory has its own thin `_layout.tsx`. No new route group is added. `/home` stays the shared account hub and `earn/*` is unchanged.

```
src/app/
├─ _layout.tsx                    root: SafeAreaProvider → AppRoot (+ AppPolicyGate, proposed) → Stack
├─ index.tsx                      EntryRedirect → restoration resolver (§6) instead of fixed /home
├─ +native-intent.tsx             PROPOSED: every system-delivered path passes the intent allowlist (§7); verify hook name in SDK 57
├─ sign-in/index.tsx, verify.tsx  unchanged
└─ (session)/_layout.tsx          AccountGate + ModeProvider (proposed) → Stack
   ├─ home.tsx                    KEPT: becomes the shared "Account" hub (same content; reached from both mode homes)
   ├─ profile, security, sessions, required-action, onboarding/*, account/*, legal/*   unchanged
   ├─ earn/*                      unchanged (lazy; onboarding, compliance, renewals, appeals)
   ├─ ride/
   │  ├─ _layout.tsx              EAGER thin Stack layout (rider flow draft provider, in memory)
   │  ├─ index.tsx                /ride              Rider home
   │  ├─ search.tsx               /ride/search       Where-to search (param field=pickup|dropoff)
   │  ├─ pin.tsx                  /ride/pin          Pin / map (text-first until P3.7)
   │  ├─ quote.tsx                /ride/quote        Route summary + quote options (+ expired/area/hours/degraded states)
   │  ├─ fare.tsx                 /ride/fare         Fare breakdown (param quoteId)
   │  └─ location.tsx             /ride/location     Location rationale (before the OS prompt)
   └─ drive/
      ├─ _layout.tsx              thin Stack layout; imports NOTHING from features/driver
      ├─ index.tsx                /drive             Driver home / readiness            LAZY
      ├─ eligibility.tsx          /drive/eligibility Eligibility per service product    LAZY
      ├─ health.tsx               /drive/health      Restriction / account health       LAZY
      └─ location.tsx             /drive/location    Location rationale (informational) LAZY
```

Rules:
- Rider routes are eager (rider is the default path). They import `features/rider/*` screens directly; `features/rider` never imports `features/driver` (existing isolation test).
- Driver routes use `lazyScreen(() => import(…))` like `earn/*`. Per F-P3-07 this defers module **evaluation**, not download: the release build is one Hermes bundle. The `drive/_layout.tsx` file is evaluated at start-up (Expo Router registers all routes), so it must stay a plain `Stack` with no driver imports (extend the architecture test to layouts).
- `/home` keeps its URL and content (renamed "Account" in the UI). Its "rides coming" banner is replaced by a link to `/ride`. `BackToAccount` in `DriverHubScreen` (`router.replace('/home')`) keeps working.
- `account-route.ts` changes only its "no pending action" target: instead of the constant `/home`, `redirectFor` returns the restoration resolver's mode home (`/ride` or `/drive`). Pure function; existing unit tests extended, not weakened.
- Quote-expired, outside-area, outside-hours and degraded are **states of `/ride/quote`** (and of `/ride` for degraded geo), not separate routes, so the back stack never contains dead-end error routes.
- Version/maintenance screens are rendered by `AppPolicyGate` above the router (§9), not as routes, so no path can bypass them.

---

## 3. Shared shell responsibilities

| Layer | Owns | Never does |
|---|---|---|
| `AppRoot` (existing) + `AppPolicyGate` (proposed) | API config, services, foreground refetch, app-version policy fetch and blocking states, version headers on every request | request permissions, start background work, evaluate driver modules |
| `AccountGate` (existing) | session ⇒ sign-in; `requiredActions` ⇒ pinned screens; locale sync | decide mode or capabilities |
| `ModeProvider` (proposed, `src/core/mode/`) | active mode, persisted preference, availability from server, mode switch, mode-home resolution | authorise anything; cache driver capability |
| Intent router (proposed, `src/core/intents/`) | allowlisted intent → route or refusal | trust a payload; route without fresh account state |
| Shared account hub `/home` | profile, sessions, security, deletion, legal, language, sign-out, mode switch entry | rider booking or driver work |
| Rider graph | search, pin, quote, fare | import driver code; request driver permissions |
| Driver graph | readiness, eligibility display, health, rationale | go online (Phase 4); background location; FGS |

---

## 4. ModeController design (ADR-048, PROPOSED)

### 4.1 State

```
ModeState = {
  active: 'RIDER' | 'DRIVER',
  preference: { v: 1, accountId, mode: 'RIDER' | 'DRIVER', savedAt } | null,   // persisted hint only
  availability: ModeAvailability                                             // derived from server AccountState
}
```

- **Persisted preference:** `STORAGE_KEYS.modePreference = 'wayvro.mode-preference.v1'` through the existing `KeyValueStore` port (OS secure storage; no new storage module; architecture test unchanged). Non-sensitive; stored with the account id so a different account on the same phone ignores it; deleted by a new `session.onWipe` hook (sign-out/expiry).
- **Never persisted:** capability, eligibility, restriction or KYC state. Every launch re-derives availability from `GET /v1/account/state`.

### 4.2 Additive server contract sketch (`AccountState.modes`, PROPOSED)

```
modes: {
  rider:  { available: boolean,
            blockers: Array<'ACCOUNT_RESTRICTED' | 'DELETION_PENDING'> },
  driver: { entry: 'NONE' | 'ONBOARDING' | 'HUB',
            available: boolean,             // may the Driver/Partner AREA be shown (not "may earn")
            blockers: Array<'ONBOARDING_UNAVAILABLE' | 'APPLICATION_PENDING' | 'APPLICATION_REJECTED'
                           | 'DOCUMENTS_EXPIRED' | 'PROFILE_REVERIFICATION_DUE' | 'ROLE_RESTRICTED'
                           | 'ACCOUNT_RESTRICTED' | 'DELETION_PENDING'> }
}
```

- Additive field on an existing response (CLAUDE.md §4): the client schema marks it optional for one release window and falls back to deriving the same values from the existing `driver` and `restrictions` sections (the derivation already exists in `home.ts`/`status.ts`). Contract test + oasdiff gate (F-P3-09) prove no breaking change.
- `driver.entry = HUB` when a driver profile exists (any profile state); `ONBOARDING` when no profile and onboarding is available or an application exists; `NONE` otherwise.
- `blockers` explain; they never authorise. Going online does not exist in Phase 3; Phase 4 adds `canGoOnline` and `presence` additively.

### 4.3 Transitions

| From | Event | Result |
|---|---|---|
| any | cold start / foreground / account refetch | recompute availability; if `active` mode is no longer available ⇒ `router.replace` to the other mode home with a one-line banner ("Driver/Partner area isn't available right now — see Account") |
| RIDER | `switchTo('DRIVER')` | refetch account state (fresh) → `entry=HUB` ⇒ `router.replace('/drive')`, persist DRIVER · `entry=ONBOARDING` ⇒ `router.push('/earn')`, preference stays RIDER · `entry=NONE` ⇒ stay, info banner |
| DRIVER | `switchTo('RIDER')` | Phase 3: always allowed unless `rider.available=false`; `router.replace('/ride')`; persist RIDER. Phase 4 extension point (documented, no code now): if server presence is `ONLINE_*` ⇒ confirm "go offline first"; if `ASSIGNED…ON_TRIP` ⇒ refused with `DRIVER_OBLIGATION_ACTIVE` (role model §5, INV-06) |
| any | sign-out / session expiry | preference wiped; next sign-in starts in RIDER |

What the server re-checks regardless of mode: every `/v1/driver/*` and `/v1/driver-onboarding/*` call (existing capability/ownership checks), every quote/geo call (session, account restriction, rate limits), every staff-visible effect. The client sends **no mode header** in Phase 3 (mode segmentation of telemetry is V12, Phase 4, low-cardinality, never an authorisation input).

### 4.4 Mode-switch matrix for Phase 3

Phase 3 has no trips and no online state, so the "active obligation" rows of the Phase 0 matrix (`docs/phase0/PHASE0_UNIFIED_APP_ROLE_MODEL.md` §5) are out of scope and stay Phase 4.

| Server state (account) | Rider entry shows | Driver entry shows | Allowed navigation | Server re-check |
|---|---|---|---|---|
| Rider-only (no application, onboarding available) | `/ride` full rider home | Account hub + rider home show "Earn with Wayvro" → `/earn` intro (K14) | rider graph, account hub, `earn/*` onboarding | onboarding endpoints check flag + account state |
| Rider-only, onboarding unavailable (`driver.onboarding` OFF) | `/ride` | no driver entry | rider graph, account hub | — |
| Pending application (DRAFT…MANUAL_REVIEW, NEEDS_INFO, APPEALED) | `/ride` + small status chip "Application in review" | `/earn` hub status/overview (existing) | rider graph; `earn/*` per application state | application ownership + state machine |
| Approved driver (profile VERIFIED/ACTIVE_ELIGIBLE, docs valid) | `/ride` | ModeSwitch → `/drive` readiness | both graphs; `/drive/*`, `earn/compliance`, `earn/renewal` | `/v1/driver/compliance` eligibility |
| Driver role restricted (DRIVER_ROLE restriction) | `/ride` unaffected (V13, INV-09) | `/drive` with health card at top → `/drive/health` (appeal via existing `/earn/appeal?restriction=`) | both graphs; readiness shows "Earning paused" | driver endpoints return blockers; rider endpoints unaffected |
| Documents expired / re-verification due | `/ride` unaffected | `/drive` readiness lists expired documents → `earn/renewal` | both graphs | compliance blockers `DOCUMENT_EXPIRED`, `PROFILE_REVERIFICATION_DUE` |
| Account-wide restricted (ACCOUNT scope, `affectsRiderUse`) | `/ride` shows restriction notice; Where-to disabled with reason + appeal link (`/account/appeal`) | `/drive` (if HUB) shows the same restriction, nothing actionable | account hub, legal, appeal, deletion, support info | quotes/geo refuse `WAYVRO_E_ACCOUNT_RESTRICTED`; driver endpoints refuse |
| Deletion pending (`account.status=DELETION_PENDING`) | `/ride` shows deletion banner + "Cancel deletion"; Where-to disabled (PROPOSED: no new quotes during grace — founder may relax) | driver area view-only status | account hub, `/account/delete`, legal | server refuses quote creation (PROPOSED) |
| Required actions pending | not reachable — `AccountGate` pins the action screen (existing) | not reachable | action screen (+ legal while accepting policies/age) | existing required-action enforcement |

---

## 5. Back-stack rules

| Situation | Rule |
|---|---|
| Mode switch | `router.replace` to that mode's home; the stack is reset; screens of the other mode are never underneath |
| Hardware back on `/ride` or `/drive` | leaves the app (Android default); never switches modes |
| Account hub `/home` | pushed on top of the current mode home; back returns to that mode home |
| Quote flow `/ride` → `/ride/search` → `/ride/quote` → `/ride/fare` | back from fare → quote; back from quote → search with pickup and drop-off still filled (draft lives in the rider flow provider, in memory) |
| Pin `/ride/pin` | back returns to search without applying the pin; "Use this point" applies and pops |
| Rationale screens `/ride/location`, `/drive/location` | replaced by the result screen after the decision; back never re-opens the OS dialog |
| Required action appears mid-flow | `AccountGate` redirects (existing); after completion the restoration resolver chooses the mode home (in-memory draft may be lost; acceptable, no server state lost) |
| Intent-driven navigation | lands on the mode home first, then pushes the target, so back always reaches a home of the right mode |
| Blocking app-policy states | rendered above the router; back does nothing except on the legal sub-view |

---

## 6. Restoration precedence and process death

On cold start, after process death, on foreground after > 30 min, after sign-in and after any intent:

1. **App policy** (`GET /v1/app/config`, §9): HARD_UPDATE or MAINTENANCE ⇒ blocking state; nothing below runs.
2. **Session** (existing): signed out ⇒ `/sign-in`.
3. **Required actions** (existing `AccountGate`).
4. **Server account state** ⇒ `ModeAvailability`.
5. *(Phase 4/5 extension point, no code in Phase 3: `activeDriverJob` ⇒ driver job screen; `activeRiderTrip` ⇒ rider trip screen — ahead of the preference, per role model §6.)*
6. **ModePreference** if that mode is available and `driver.entry=HUB` for DRIVER; else Rider home.
7. **Pending quote group** (rider only): if `wayvro.last-quote-group.v1` (id + server `expiresAt`, no coordinates) exists and is younger than 30 min ⇒ `GET /v1/quotes/{quoteGroupId}` (owner-only). PRICED and not expired ⇒ offer "Continue with your last price check"; EXPIRED/SUPERSEDED ⇒ "Prices have been updated — get a new price" (re-quotes with the coordinates the server returns to the owner); 404/403 ⇒ forget silently.

Process-death specifics: the search draft (typed text, chosen places, device fix) is memory-only and is lost by design (no persistent recent places in Phase 3 until a retention decision); only the quote-group id survives. Android may restart the process when the user downgrades location precision in Settings (Android 12+); this is handled by the same cold-start path.

The resolver is a pure function `resolveStartRoute(appPolicy, session, account, preference, lastQuote)` with table-driven unit tests and SP-08 process-kill flows.

---

## 7. Intent router (V08; ADR-048; CON-P3-07; F-P3-01)

### 7.1 Contract

```
type Intent =
  | { kind: 'OPEN_RIDER_HOME' }
  | { kind: 'OPEN_QUOTE'; quoteGroupId: uuid }
  | { kind: 'OPEN_DRIVER_HOME' }
  | { kind: 'OPEN_DRIVER_APPLICATION' }
  | { kind: 'OPEN_DRIVER_COMPLIANCE' }
  | { kind: 'OPEN_DOCUMENT_RENEWAL'; documentId: uuid }
  | { kind: 'OPEN_RESTRICTION_APPEAL'; restrictionId: uuid }
  | { kind: 'OPEN_ACCOUNT_SECURITY' }
  | { kind: 'OPEN_LEGAL'; policyKey?: string; version?: string }

resolveIntent(raw: unknown, ctx: { appPolicy, session, account: AccountState | null, mode }) →
  | { kind: 'route'; mode: 'RIDER' | 'DRIVER'; home: '/ride' | '/drive'; target: Href | null }
  | { kind: 'defer'; until: 'SIGN_IN' | 'REQUIRED_ACTION' | 'APP_POLICY' }
  | { kind: 'refuse'; reason: RefusalReason }
```

- Input is validated with a strict zod schema (ids are uuids; strings bounded; unknown keys rejected). Payloads carry **ids only**, never routes, URLs, amounts, roles or modes.
- `RefusalReason` (Phase 3): `INTENT_UNKNOWN`, `INTENT_MALFORMED`, `MODE_NOT_AVAILABLE` (e.g. driver intent for a rider-only account), `ACCOUNT_RESTRICTED`, `NOT_FOUND_OR_NOT_OWNED` (server 403/404 after the target screen's fetch). Phase 4 adds `DRIVER_OBLIGATION_ACTIVE` and `RIDER_TRIP_ACTIVE` additively (not declared earlier — no unused enum values).
- A deferred intent is held in memory only (never persisted) and replayed once after sign-in / required action / policy gate clears; it is dropped after 10 min.
- A driver intent while in Rider mode switches mode visibly (banner "Opened Driver/Partner area") only when `driver.entry=HUB`; Phase 4 adds the obligation checks before any switch. A rider intent never pulls an active driver out of work (Phase 4 refusal).
- Ownership is always proven by the target screen's own server call; the router only chooses where to look.

### 7.2 Sources in Phase 3

| Source | Phase 3 status |
|---|---|
| Restoration resolver (§6) | uses the router |
| In-app links/banners (e.g. "Document renewal due" on `/drive`, "Last price check" on `/ride`) | use the router |
| System path delivery (`+native-intent`, PROPOSED) | every path is parsed by `parseWayvroPath` (length ≤ 512 before any decoding — decode-uri-component gate from ADR-043 — path allowlist, then `resolveIntent`); anything else ⇒ mode home. In release there is **no external scheme** (F-P3-01 removes `exp+wayvro`; CON-P3-07), so this hook only sees app-internal launches; in development builds the dev-client scheme exercises it |
| Push notifications | **not in Phase 3** (no expo-notifications; architecture ban kept). A future notification payload is the same `Intent` envelope + `v` field; the handler only calls `resolveIntent` |
| External deep links / App Links / universal links | blocked until EG-15 identifiers clear and the decode-uri-component exception is resolved; then a reviewed link plan adds the scheme/hosts and the CI intent-filter gate allowlist (P3.0) is updated |

Tests: table-driven vitest over every (intent × account state × mode × policy) combination; SP-08 flows for in-app intents and restoration; a release-manifest gate proving no unapproved intent filter (P3.0).

---

## 8. Rider screens

Copy keys live in the main catalogue under new namespaces (`rider.home.*`, `rider.search.*`, `rider.pin.*`, `rider.quote.*`, `rider.fare.*`, `rider.area.*`, `rider.hours.*`, `rider.degraded.*`, `rider.location.*`, `mode.*`, `lite.*`, `app.update.*`, `app.maintenance.*`). Each screen renders only view-state adapter output (`ViewState<T>`); business rules (expiry, eligibility, totals) come from the server and pure adapters, never from components.

Common state vocabulary: **loading**, **empty**, **error** (retry), **offline** (retry, cached content kept), **retry**, **permission-denied**, **partial** (some products unavailable), **disabled** (switch/flag/restriction), **stale** (data older than its threshold, `StaleIndicator`).

### 8.1 Rider home `/ride`

Content: greeting line; "Where to?" field (opens `/ride/search` with drop-off focused); pickup card ("Pickup: current location" when a fix exists, else "Set pickup"); "Use current location" button (location state machine, permission doc §4); last price-check card (restoration); status chips (driver application status if any); ModeSwitch (only if `driver.entry ≠ NONE`); Account button (→ `/home`); Lite toggle; "Booking opens soon" note (no request CTA; flag `rider.ride-request` OFF; no fake dispatch).

| State | Behaviour |
|---|---|
| loading | skeleton text rows (static, no shimmer animation) |
| offline | banner "You're offline"; Where-to still opens (search will show offline) |
| permission-denied | pickup card says "Set pickup by search or pin"; no nagging re-prompt |
| disabled (account restriction, deletion pending, `rider.quotes` switch off, maintenance) | Where-to disabled with reason text + action (appeal / cancel deletion / try later) |
| degraded (geo SKU budget or breaker open, from `/v1/app/config` hints or last error) | banner "Address search is limited right now — type the full address or use a pin" |
| stale | `StaleIndicator` on the last price-check card |

Data: `GET /v1/account/state` (existing), `GET /v1/app/config` (proposed), `GET /v1/quotes/{id}` (restore, proposed), product display data (`GET /v1/catalog/products?cityCode=LHR`, proposed; `docs/phase3/PHASE3_ARCHITECTURE.md` §3.2).
Accessibility: Where-to is the first focus target after the heading; ModeSwitch announces "Switch to Driver/Partner mode, button"; the pickup card reads as one element.

```
+--------------------------------------+
| Wayvro                  [Account]    |
| Good evening                         |
| +----------------------------------+ |
| | Where to?                    >   | |
| +----------------------------------+ |
| Pickup: Set pickup by search or pin  |
| [ Use current location ]             |
| -- Last price check (12 min ago) --  |
|  Economy  Rs 640   prices updated >  |
| Booking opens soon.                  |
| [Lite mode: off]  [Rider | Driver]   |
+--------------------------------------+
```

### 8.2 Where-to search `/ride/search`

Content: two fields (Pickup, Drop-off; the focused one from the param); suggestions list (`PlaceRow`: primary landmark line + secondary area line, Urdu-script line when supplied); "Use current location" row (pickup only); "Choose on map" row (→ `/ride/pin`); session recents (in memory, max 10, cleared on sign-out/process death); Roman-Urdu hint text ("Try 'Liberty Market' or 'Gulberg 3'").
Behaviour: debounce 300 ms, min 3 characters, at most one in-flight request (older cancelled); opaque `placeRef` resolved server-side on selection.

| State | Behaviour |
|---|---|
| empty (no query) | recents + current location + pin rows |
| loading | inline "Searching…" row (polite live region) |
| empty (no results) | "No matches. Try a nearby landmark, or choose on map." |
| error / offline | inline message + Retry; pin row still available |
| degraded (429 / budget refusal) | "Search is busy. Type the full address or choose on map." |
| stale | suggestions marked when `cacheStatus=STALE_SERVED` (no user-facing provider names) |

Data: `GET /v1/geo/autocomplete` and place resolution (proposed; `docs/phase3/PHASE3_ARCHITECTURE.md`). Bias sent at 2 decimals.
Accessibility: results list announces count ("5 suggestions"); each row label "Primary, secondary"; fields have explicit labels, not placeholders only.

### 8.3 Pin / map `/ride/pin`

Until P3.7 (text-first): current-location fix + reverse-geocoded address ("Is this your pickup?"), designated pickup points list when the zone requires one, landmark search. Drag-to-place pin arrives with the renderer at P3.7 (B01 manual pin closes then).
After P3.7: map with centre pin, camera-idle → reverse geocode (debounce 600 ms), "Use this point" button; approximate-only permission ⇒ map centres on the coarse area and the user must confirm a pin (never auto-used as pickup).

| State | Behaviour |
|---|---|
| loading address | "Finding address…" under the pin (polite live region) |
| no address | "Pinned location" + coordinates hidden; user may add a pickup note (local only) |
| PICKUP_RESTRICTED zone | list of designated pickup points; choosing one is required |
| permission-denied / services off | search + pickup points only; "Turn on location in Settings" link |
| map renderer failure (P3.7+) | falls back to text-first view automatically |

Accessibility: the map is not the only way — every action exists as a button or list; a text summary of the selected point is always shown.

### 8.4 Text-first route + quote options `/ride/quote`

Content: route summary text ("From A to B · 7.4 km · about 22 min"), `ConfidenceBadge` (High / Medium / Low / Unknown — text, not colour only), map preview after P3.7 (not in Lite), list of `QuoteOptionCard`s (product name, seats, luggage class, total price, expiry countdown, toll disclosure line when `EXCLUDED_DISCLOSED`), unavailable products listed with plain reasons, "See fare details" per option, "Booking opens soon" (no request CTA).
Expiry: countdown from server `expiresAt` using the existing server-clock offset; at expiry the card switches to the expired state; the server re-validates anyway.

| State | Behaviour |
|---|---|
| loading | "Getting prices…" (polite live region), cards as static placeholders |
| partial | priced options + unavailable rows ("Comfort isn't available here yet") |
| **Quote expired** | "Prices have been updated" + "Get new price" (new POST with a new Idempotency-Key); old values greyed and labelled expired, never silently replaced |
| **Outside service area** (`WAYVRO_E_SERVICE_AREA`, reason ZONE_NOT_SERVED) | "Wayvro doesn't serve this pickup/destination yet" + which end failed + change-location buttons |
| **Pickup restricted** (PICKUP_RESTRICTED) | "Pickup here is from set points" → pickup point list |
| **Outside hours** (OUTSIDE_SERVICE_HOURS) | "Rides here run from {opens} to {closes}" (server-supplied local times, Asia/Karachi) |
| **Route too long** | plain message + change destination |
| **Degraded / outage** (503 ROUTING_UNAVAILABLE, maintenance, switch off) | "We can't calculate prices right now. No price is shown rather than a guess." + Retry with backoff; never an invented ETA or fare (E07, CON-P3-08) |
| rate-limited (QUOTE_RATE_LIMITED) | existing `error.rateLimited` copy with seconds |
| offline | "You're offline — prices need a connection" + Retry |
| disabled | restriction/deletion reason |

```
+--------------------------------------+
| < Back            Prices             |
| From: Liberty Market (synthetic)     |
| To:   Model Town Park (synthetic)    |
| 7.4 km · about 22 min   [Medium]     |
| +----------------------------------+ |
| | ECONOMY   4 seats · small bags   | |
| | Rs 640              valid 4:32   | |
| | Tolls not included   Details >   | |
| +----------------------------------+ |
| +----------------------------------+ |
| | COMFORT   not available here yet | |
| +----------------------------------+ |
| Booking opens soon.                  |
+--------------------------------------+
```

Data: `POST /v1/quotes`, `GET /v1/quotes/{quoteGroupId}` (proposed, `docs/phase3/PHASE3_PRICING_QUOTE_MODEL.md`).
Accessibility: each card is one focusable element whose label reads product, seats, luggage, price ("640 rupees"), validity ("valid for 4 minutes"), toll note; the countdown announces only at 60 s and at expiry (assertive once), never every second; prices change ⇒ polite announcement "Prices updated".

### 8.5 Fare breakdown `/ride/fare`

Content (`FareBreakdown`): ordered server components (Base, Distance, Time, Booking fee, Airport fee, Minimum-fare adjustment, Tolls/disclosure, Tax, Rounding) with amounts exactly as sent; total; quote expiry; rate-card version reference (small text for support); "Prices are calculated by Wayvro's servers" note. Discount never shown in Phase 3 (not emitted).
States: loading, expired (header banner + "Get new price"), offline (cached quote shown with `StaleIndicator`), error.
Accessibility: rendered as a list with "label, amount" pairs; amounts right-aligned (left in RTL rows) with tabular figures; total announced last.

### 8.6 Version / update / maintenance — see §9.

---

## 9. Version, update and maintenance (A01, Q31; ADR-049 PROPOSED)

- Every request carries `X-Wayvro-App-Version`, `X-Wayvro-App-Build`, `X-Wayvro-Platform` (header names PROPOSED). Build-number source must be confirmed at implementation (version is `0.0.0` today; no native build number is configured; adding expo-application needs its own review).
- `AppPolicyGate` (inside `AppRoot`, above the router) fetches `GET /v1/app/config` on start and on foreground (max once per 15 min), caches the last policy in memory and in `wayvro.app-policy.v1` (non-sensitive, installation-scoped, not wiped on sign-out).

| State | UI | Escape hatches |
|---|---|---|
| OK | nothing | — |
| SOFT_UPDATE | dismissible info banner on mode homes, at most once per 24 h | — |
| HARD_UPDATE (or any 426 `WAYVRO_E_APP_UPDATE_REQUIRED`) | blocking screen: reason class (security / data / compatibility), "Update Wayvro" button only when a store URL key is configured (no store id exists yet ⇒ "Update from the store where you installed Wayvro") | legal policies (public endpoints), sign out, account deletion (in-app endpoints exempt from 426 + web path), support contact text |
| MAINTENANCE (or 503 `WAYVRO_E_MAINTENANCE`) | blocking screen with server message key + expected end + Retry (backoff 30 s → 5 min) | legal, sign out |
| offline, no cached policy | proceed; server enforces on the next call | — |

- Mid-flow 426/503 maintenance from any call flips the gate immediately; in-memory drafts are discarded.
- No OTA (`updates.enabled=false`, CON-P3-12). The policy design stays compatible with a later ADR-031 decision.

---

## 10. Driver mode Phase-3 screens (K19, H10 display, A07 informational)

No "Go online", no online state, no background location, no FGS, no offer UI. The readiness copy says "You're ready for when driving opens" — no promise of a date.

### 10.1 Driver home / readiness `/drive` (lazy)

Checklist rows (each a `LinkRow` with status):
1. Driver/Partner profile status (existing `profileState.*` copy) → `earn/compliance`.
2. Documents: valid / expiring soon / expired (existing compliance data) → `earn/renewal`.
3. Vehicle and service eligibility per product → `/drive/eligibility`.
4. Restrictions → `/drive/health` (appeal via existing `/earn/appeal?restriction=`).
5. Location readiness (informational): reads the foreground permission status without prompting; "Location will be needed when driving opens. You'll be asked then." → `/drive/location`.

Data: `GET /v1/account/state`, `GET /v1/driver/compliance` (existing), product-level eligibility (PROPOSED additive field on the compliance response, from `catalog.vehicle_eligibility_rules`).
States: loading, error/retry, offline (cached with stale indicator), partial (eligibility unavailable but documents shown).

```
+--------------------------------------+
| Driver/Partner        [Rider|Driver] |
| You're ready for when driving opens. |
|  [ok]  Profile: Active             > |
|  [!]   Licence expires in 12 days  > |
|  [ok]  Car: Economy eligible       > |
|  [x]   Comfort: vehicle too old    > |
|  [i]   Location: asked when needed > |
| No restrictions on Driver/Partner.   |
| Riding with Wayvro is not affected.  |
+--------------------------------------+
```
(Status marks are text glyphs with full text labels for screen readers; never colour alone.)

### 10.2 Eligibility per product `/drive/eligibility`
Per vehicle × product: eligible / not eligible with plain reasons (model year, seats, AC, body type, legal gate). BIKE/RICKSHAW show "Not offered in Lahore yet" (DISABLED_LEGAL_GATE; FA-11). Display only; dispatch eligibility is Phase 4.

### 10.3 Restriction / health `/drive/health`
Lists DRIVER_ROLE, VEHICLE, SERVICE_CAPABILITY and CITY_CATEGORY restrictions with existing `driverRestriction.*` copy, effective-until, appeal button when appealable. Always states "Booking rides as a rider is not affected" unless an ACCOUNT restriction exists.

### 10.4 Location rationale `/drive/location` (informational)
Explains foreground and future background use, the "Allow all the time" settings step that Phase 4 will need, battery and privacy. **No permission request on this screen in Phase 3.**

### 10.5 K19 onboarding state coverage

| K19 state | Server state (existing contract) | Existing screen | Phase-3 gap to close |
|---|---|---|---|
| pending | application DRAFT / CONSENTED / DOCUMENTS_PENDING | `/earn` consent/overview, `earn/details`, `earn/vehicle`, `earn/documents`, `earn/document`, `earn/capture` | device offline-resume proof (upload queue exists; device run NOT RUN in Phase 2); TalkBack labels audit |
| failed | upload failure in queue; NEEDS_INFO decision | documents/queue rows; overview with reasons | explicit "upload failed, will retry" copy audit; offline resume on device |
| review | SUBMITTED / AUTO_CHECK_PENDING / MANUAL_REVIEW (+ in-person) | `/earn` status view | none functional; a11y + native review |
| approved | profile VERIFIED / ACTIVE_ELIGIBLE | `earn/compliance` | new `/drive` readiness entry (§10.1) |
| rejected | REJECTED / APPEALED / REJECTED_FINAL | `/earn` status + `earn/appeal` | none functional; native review of reason copy |
| expired | EXPIRED_DRAFT; profile EXPIRED / REVERIFY_DUE; document EXPIRED | status view; `earn/compliance`, `earn/renewal` | readiness surfacing on `/drive` |
| suspended | no SUSPENDED profile state exists — "suspended" = a DRIVER_ROLE restriction (rider use unaffected unless an ACCOUNT restriction also exists) | `earn/compliance` restriction list + `/earn/appeal` | `/drive/health` makes it first-class; copy says "earning paused", rider unaffected |

Plus: camera guidance copy review, Urdu/Roman-Urdu native review (FA-09), dynamic type at 200 % on capture screens.

---

## 11. Lite mode UX (L08; ADR-019 PROPOSED in-app; CON-P3-11)

- **Trigger:** manual toggle on rider home and account hub; auto-suggest (never auto-enable) when 3 of the last 5 API calls took > 4 s or timed out (request-timing heuristic in the HTTP layer; NetInfo is not installed). Preference persisted as `wayvro.lite-mode.v1` (non-sensitive).
- **What changes:** no map renderer mounted (text-first everywhere); quote requests ask for `detail=lite` (no polyline); autocomplete debounce 500 ms and min 4 characters; reverse geocode only on explicit "Use this point"; no automatic refetch of quotes (manual "Refresh prices"); no images beyond icons; existing foreground refetch kept for account state only.
- **Stale indicators:** every data block shows age when older than its threshold (account 5 min, quote options by expiry, suggestions when STALE_SERVED).
- **Resume/retry:** in-flight failures keep the draft in memory and offer Retry; the last quote group restores per §6; nothing is queued for blind replay.
- Lite never hides safety/legal text or error reasons.

---

## 12. Map-renderer-agnostic UI (ADR-046 PROPOSED / OPEN-SPIKE)

- All rider screens depend on a proposed `src/platform/maps/` interface, never on a vendor SDK:

```
interface WayvroMapProps {
  style: MapStyleDescriptor            // from GET /v1/app/config; no vendor URLs/keys hard-coded
  camera: { center: LatLng; zoomBand: 'CITY' | 'AREA' | 'STREET' }
  markers: ReadonlyArray<{ id: string; kind: 'PICKUP' | 'DROPOFF' | 'PICKUP_POINT'; position: LatLng; label: string }>
  route?: { polyline: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' }
  interactive: boolean
  onCameraIdle?(center: LatLng): void
  onReady?(): void
  onError?(reason: 'STYLE_UNAVAILABLE' | 'RENDER_FAILED' | 'UNSUPPORTED'): void
  testID?: string
}
```

- Phase 3 order: the text-first implementation ships first (P3.5); a renderer is plugged in at P3.7 after SP-04 + SP-02 (renderer and geo provider are chosen as a bundle because of licence coupling). Candidates kept generic here: MapLibre React Native, react-native-maps, expo-maps, @rnmapbox/maps — none installed; versions recorded in `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md`. The renderer module is evaluated only when a map screen mounts and never in Lite mode or driver screens in Phase 3.
- Map display is presentation; pricing distance/duration come only from the server route snapshot.
- **Accessibility alternative:** the map view is hidden from screen readers; an adjacent text summary (route summary, pickup/drop-off labels, pickup point instructions) carries all information, and every map action has a button equivalent.
- Gestures: renderer-native pan/zoom only; no gesture-handler/reanimated bottom sheets (F-P3-08) — panels are static views and `ScrollView`s.

---

## 13. Design-system additions (tokens + primitives; no new package)

Tokens (extend `core/ui/tokens.ts`, still provisional; AA contrast verified by a unit test over token pairs):

| Group | Additions |
|---|---|
| colours | `mapPickup`, `mapDropoff`, `routeLine`, `confidenceHigh/Medium/Low` (+ text pairs), `successBackground/Text`, `staleBackground/Text`, `offlineBackground/Text`, `focusRing`, `cardBorder`, `priceText` |
| radii | `sm 6`, `md 8`, `lg 12` |
| elevation | `card` (border + subtle shadow; Android elevation 1) |
| typography | `price` (20, 700, tabular figures), `captionStrong` |
| motion | `durationShort 150`, `none 0` — used only for opacity; 0 when reduced motion is on |

Primitives (in `core/ui/`, presentational, no business rules):

| Primitive | Purpose | Notes |
|---|---|---|
| `PlaceRow` | primary + secondary address lines, optional Urdu line, leading kind glyph | one accessible element; RTL-aware row |
| `QuoteOptionCard` | product, seats, luggage, price, expiry, toll disclosure, unavailable variant | full spoken label assembled by adapter |
| `FareBreakdown` | ordered label/amount rows + total | tabular figures; amounts from server only |
| `ConfidenceBadge` | High/Medium/Low/Unknown | text + shape, not colour alone |
| `StaleIndicator` | "Updated 12 min ago" / "Couldn't refresh" | polite live region on change |
| `Countdown` | server-offset countdown | announces at thresholds only |
| `ModeSwitch` | two-segment Rider / Driver control | `accessibilityRole="tab"`-like semantics; never implies permission; disabled state with reason |
| `Banner` variants | existing info/warning/error + `success`, `offline`, `stale` | variants only in primitives |
| `Card`, `Section`, `SkeletonRow` | layout | skeletons are static (no shimmer) |

Visual language: original Wayvro palette and composition; no incumbent layouts, icons or colours copied (`docs/08_DESIGN_SYSTEM_AND_ACCESSIBILITY.md`). A `packages/mobile-ui` package is created only if a second consumer appears.

---

## 14. Localization (P18, A06; native review FA-09)

- Catalogue namespaces added to `core/i18n/strings.ts` (rider + shared) and `features/driver/i18n/driver-strings.ts` (driver), all three locales, same keys (compile-time completeness, existing tests for placeholders and forbidden wording). If the main file grows too large, split per namespace with the same typed `Record<Locale, …>` contract.
- **PKR display (PROPOSED, pending native review):** "Rs 640", "Rs 1,250" in all locales with Western digits; paisa shown only when non-zero; formatting implemented in-house from the server `{currency, minor}` string (bigint), not via `Intl` currency (Hermes `Intl` behaviour unverified, ADR-043). Thousands vs lakh grouping (1,25,000) is a native-review decision.
- **Urdu RTL per component** (existing approach, no global `I18nManager.forceRTL`): rows reverse, text aligns right; prices, distances and times are LTR runs inside RTL text; mixed-direction addresses use separate `Text` runs with explicit `writingDirection`.
- **Text expansion:** layouts tolerate +40 % length (Urdu/Roman-Urdu often longer); buttons wrap to two lines rather than truncate; tested with a pseudo-locale in unit snapshots of adapters (string length checks) and screenshots in SP-08 nightly.
- **Roman-Urdu search:** hints in the search field; server landmark aliases (`geo.landmark_aliases`) map common Roman-Urdu spellings; the client never transliterates.
- **No machine-translation-only safety/legal text:** new ur/ur-Latn strings are marked pending review (`TranslationPendingNote`); safety/legal/price-explanation strings are blocked from P18/A06/K19 exit until FA-09 signs off. Implementation proceeds; exit does not.

---

## 15. Accessibility requirements (A08)

| Area | Requirement | Verification |
|---|---|---|
| Labels | every interactive element has a label; cards read as one sentence; decorative glyphs hidden | adapter unit tests for spoken labels; TalkBack manual pass (FA-14) |
| Focus order | heading → primary action → content → secondary actions; after navigation focus moves to the heading | manual TalkBack/VoiceOver |
| Dynamic type | layouts usable at 200 % font scale; no clipped prices or CTAs | SP-08 nightly screenshots at `font_scale 2.0` + manual |
| Touch targets | ≥ 48 dp (`MIN_TOUCH_TARGET`) | primitive tests |
| Contrast | WCAG AA for all token pairs, including confidence/stale banners | token contrast unit test |
| Reduced motion | no animation required for meaning; durations 0 when reduced motion is on | manual |
| Live regions | polite: search results count, price updates, stale changes; assertive once: quote expired, blocking policy states | manual + adapter tests |
| Maps | text alternative always present (§12) | manual |
| Driver glanceability | readiness rows short, large targets; Phase 4 adds in-motion rules | manual |

Device accessibility evidence is EXTERNAL (FA-14 tester optional, FA-13 iPhone later); until then results are reported NOT RUN.

---

## 16. Proposed architecture-test changes (mobile)

1. `drive/_layout.tsx` may not import `features/driver/` at all; driver route files keep `lazyScreen(import())`.
2. `features/rider/` may import `platform/maps` and `platform/location` (request API); `features/driver/` may import only the read-only status entry of `platform/location`.
3. expo-location importable only under `src/platform/location/` (details in `docs/phase3/PHASE3_PERMISSION_LOCATION_MODEL.md` §5); the map renderer package importable only under `src/platform/maps/` (P3.7).
4. `core/mode` and `core/intents` import nothing from `features/*`.
5. expo-notifications, expo-task-manager, expo-background-fetch, expo-media-library, reanimated and gesture-handler remain banned.

---

## 17. Open points carried to the founder / later checkpoints

- Quote browsing during deletion grace (PROPOSED: disabled).
- PKR grouping style and Urdu wording for prices (FA-09).
- Build-number source for the version headers (P3.4).
- `src/platform/` as a new top-level app directory vs `src/core/platform/` (PROPOSED: new `src/platform/` for vendor adapters, as the rider README already describes; `core/platform/` stays for crypto/ids).
