# ADR-048 — Unified-app mode, navigation, restoration and intent routing

| Field | Value |
|---|---|
| Status | **ACCEPTED on P3.5 unit evidence** — device/E2E evidence (SP-08 Maestro flows, SP-02 module-evaluation trace) **NOT RUN** |
| Date | 2026-10-13 |
| Supersedes | the ADR-048 proposal in `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md` §2 |
| Requirements | V08 (mode navigation, restoration, intents), V05/A07 (just-in-time permissions in the rider graph), V11 (driver modules dormant for riders), A01/Q31 (app-policy gate precedes everything), L08 (Lite), INV-05/06/07; threats T3-17 (malicious deep links), T3-18 (wrong-mode navigation) |
| Evidence | `apps/wayvro-mobile/src/core/mode/*`, `src/core/intents/*`, `src/core/account/account-route.ts` and their tests; `src/architecture.test.ts` |

## Context
ONE public app (CLAUDE.md §2, ADR-026) holds Rider mode for everyone and a Driver/Partner mode after server approval. The mode switch is never a security boundary. Phase 3 adds the first rider screens (`/ride/*`) and a Driver/Partner readiness shell (`/drive/*`), so navigation, restoration after process death and any system-delivered path must converge on server truth without letting a stale client state open the wrong mode.

## Decision
1. **Route graphs, not separate apps or navigators.** `/ride/*` (eager; rider is the default path) and `/drive/*` (driver screens lazy via `lazyScreen(import())`) are plain directories inside the existing `(session)` group with thin layouts. `drive/_layout.tsx` imports nothing from `features/driver` (evaluated at start-up). `/home` stays the shared Account hub (its rides banner became a link to `/ride`); `earn/*` is unchanged.
2. **Server-derived availability.** `AccountState.modes` (additive, optional for one release window) decides; without it the client derives the same values from `driver` + `restrictions` (`deriveModes`). Availability is presentation only. A driver HOME exists only for a driver profile (entry `HUB`) the server lets the app show.
3. **Mode preference is a hint.** `wayvro.mode-preference.v1` (secure KeyValueStore) stores `{accountId, mode, savedAt}`; a different account ignores it; it is wiped on sign-out/expiry. No capability, restriction or KYC state is persisted. No mode header is sent.
4. **Switching.** `switchTo` refetches the account state first, then `planSwitch`: HUB ⇒ `router.replace('/drive')` + persist; onboarding ⇒ `router.push('/earn')` (preference stays RIDER); otherwise stay with a one-line notice. Driver → Rider is allowed unless the server marks Rider unavailable. Phase 4 adds the go-offline / active-obligation refusal (documented extension point, no code).
5. **Restoration precedence** (`resolveStartRoute`, pure): app policy (HARD_UPDATE/MAINTENANCE block) → session → required actions → server availability → permitted preference else Rider home → last quote group (`wayvro.last-quote-group.v1`: id + server expiry only, ≤ 30 min, rider home only; the owner-only GET decides what is shown, 404/403 forget silently). `account-route.ts` now sends "no pending action" users to this mode home instead of `/home`.
6. **Intent router.** A strict zod `Intent` union (ids only — never routes, URLs, amounts, roles or modes) resolved by `resolveIntent(raw, ctx)` → route / defer (`SIGN_IN`, `REQUIRED_ACTION`, `APP_POLICY`) / refuse (`INTENT_UNKNOWN`, `INTENT_MALFORMED`, `MODE_NOT_AVAILABLE`, `ACCOUNT_RESTRICTED`, `NOT_FOUND_OR_NOT_OWNED`). Routing lands on the mode home first, then pushes the target. Deferred intents live in memory only and expire after 10 min.
7. **System paths.** `src/app/+native-intent.tsx` re-exports `redirectSystemPath({ path, initial })` (hook name and signature verified in expo-router 57.0.25 `build/types.d.ts`/`getLinkingConfig.js`; with no redirects configured the raw path arrives unmodified). `parseWayvroPath` caps input at 512 characters BEFORE anything else and never percent-decodes (the allowed character set has no `%`/`+`), maps an allowlist of paths with id-shaped params to intents, and the router always receives `/` (the entry route) — so expo-router never parses an external path (decode-uri-component gate, ADR-043). Release builds still register no external scheme (P3.0 CI gate).
8. **Guards.** `/drive/*` is wrapped by `DriveModeGuard`: the account state is refetched on focus; while it loads a neutral cover hides possibly stale driver content; without a driver home the route is replaced by `/ride` with a notice.

## What the unit tests prove (2026-10-13, all PASS)
- EXH-RESTORE: every app policy (4) × session (3) × account (A, B, D, E, F, G, H, I, N with and without server `modes`, plus "not loaded") × preference (none / RIDER / DRIVER / DRIVER of another account) × last quote (none / 10 min / exactly 30 min / > 30 min / future) against an independent oracle, plus invariants (a DRIVER home only with a driver profile; never with a pending required action).
- EXH-INTENT: every allowlisted intent × all accounts (± modes, ± required action) × mode × policy × session: blocked ⇒ APP_POLICY, signed out ⇒ SIGN_IN, required action ⇒ REQUIRED_ACTION (gate never bypassed), never a DRIVER route or driver-only target without a driver home; strict-schema refusals.
- `parseWayvroPath`: allowlist mapping, rejection of unknown/extra/duplicate params, traversal, > 512 characters, and a 5,000-input malformed-percent-encoding fuzz set that completes in bounded time and never yields an intent.
- `planSwitch` / `driveGuard` / ModeController persistence, account binding and sign-out wipe; `account-route` with both mode homes.
- Architecture: layouts never import `features/driver`; `/drive` screens are lazy; `core/mode`, `core/intents`, `core/release`, `core/lite` import nothing from `features/*`.

## Not verified (NOT RUN)
SP-08 Maestro flows (process kill, mode switch back stack, intent-driven navigation), real `router.replace` back-stack behaviour across the nested stacks, SP-02 evidence that rider start-up evaluates 0 driver modules, dev-client launches through `+native-intent`, TalkBack/VoiceOver, RTL and 200 % font on device.

## Consequences / reversal
`AccountState.modes` is additive; the preference can be removed without data migration (the resolver then always opens Rider home). The intent router is the single place to extend for notifications (Phase 4) — payloads stay ids only. Removing the `/drive` graph returns the driver entry to `/earn` without touching the server.
