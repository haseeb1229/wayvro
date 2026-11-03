# ADR-019 — Lite mode (in-app)

| Field | Value |
|---|---|
| Status | **ACCEPTED on P3.5 unit evidence** — the data budget (PB-12a, Lite ≤ 150 KB per standard quote flow) and every device behaviour are **NOT RUN** (SP-02) |
| Date | 2026-10-13 |
| Supersedes | the ADR-019 backlog entry (`docs/phase0/PHASE0_ADR_BACKLOG.md`) and the proposal in `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md` §2 |
| Requirements | L08 (Lite mode for weak networks), Q26/Q27 (performance, low-end devices), V11; CON-P3-11 (no second app) |
| Evidence | `apps/wayvro-mobile/src/core/lite/lite-mode.ts` (+ test), `src/core/api/http.ts` timing observer (+ `http-p3.test.ts`), rider search/quote screens |

## Context
Many riders in Lahore use low-end Android phones on weak or metered networks. A separate "Lite" app would contradict ADR-026 (one public app). The client has no network-type library (NetInfo is not installed; ACCESS_NETWORK_STATE stays blocked).

## Decision
1. **In-app Lite mode**, toggled manually on the rider home and the Account hub; the choice is stored in `wayvro.lite-mode.v1` (secure KeyValueStore, installation-scoped like the UI language, kept on sign-out).
2. **Auto-SUGGEST, never auto-enable.** The HTTP layer reports each attempt's duration and outcome (no URL, body or header). When `autoSuggestAfterSlowRequests` (default 3) of the last 5 attempts were slower than `slowRequestMs` (default 4000) or hit the app-side timeout, a dismissible suggestion appears. Cancelled (superseded) requests and instant network failures (offline is its own state) are not samples. Thresholds come from `GET /v1/app/config`.
3. **What Lite changes:** quote calls ask `?detail=lite` (no polyline); search waits longer and needs more characters (max(500 ms, server) / max(4, server)); no automatic quote refresh — a manual "Refresh prices" re-reads the quote group; the pin screen does not start its location watch or reverse geocode until the rider asks ("Find the address"); no map renderer exists in this checkpoint anyway (text-first everywhere). Stale indicators show when data could not be refreshed.
4. **What Lite never changes:** safety, legal and error texts, refusal reasons, the app-policy gate, server enforcement.

## What the unit tests prove (2026-10-13, all PASS)
Sample classification (slow / timeout / not a sample), the 3-of-5 window and server threshold, suggestion vs enablement and dismissal, persistence and fail-closed loading, `detail=lite`, the Lite search tuning floor, the account-data stale threshold, and that the HTTP observer reports response / network / timeout / cancelled outcomes with the injected clock.

## Not verified (NOT RUN)
PB-12a data per Lite quote flow on REF-DEV under N2 shaping; real timing distribution on Pakistani networks (the 4 s / 3-of-5 values are UX-doc defaults, tunable server-side); SP-08 flow 24 (toggle persists across restart, no map, manual refresh).

## Consequences / reversal
Removing the toggle leaves standard mode untouched; the observer and `detail` query are additive. Every future map screen must keep a text-first equivalent (also an accessibility benefit, ADR-046).
