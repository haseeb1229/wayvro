# ADR-049 — App version policy, maintenance and runtime kill switches

| Field | Value |
|---|---|
| Status | **PROPOSED — implemented in P3.4 (Phase 3 macro run); acceptance at the Phase 3 review** |
| Date | 2026-10-13 |
| Supersedes | `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md` ADR-049 (proposal) |
| Requirements / findings | A01, Q31, V10 (kill switches), I11; F-P3-03 (FLAG_REGISTRY is code-only); T3-24, T3-25, T3-26; PHASE3_SECURITY_COST_THREAT_MODEL §5 items 13 and 16 |
| Evidence | `packages/db/migrations/0013_platform_release_controls.sql` + `packages/db/test/release-controls.integration.test.ts`; `packages/config/src/{runtime-switches,release-guardrails}.ts` (+ tests; registry validated by `pnpm flags:check`); `apps/api/src/platform/release/**` + `apps/api/test/{app-config-policy,app-config-service}.test.ts`, `apps/api/test/{app-config,release-admin}.integration.test.ts`; `apps/worker/src/release/**` + `apps/worker/test/release*.test.ts`; `apps/web-ops/src/app/release/`, `tests/e2e-web/web-ops/release.spec.ts` |

## Context
The ONE Wayvro app needs a server-controlled way to tell installed builds to update (soft or hard), to stop serving them
during planned maintenance, and to stop individual capabilities (geo SKUs, quotes) in an emergency without a deploy.
Phase 2 had only the code-defined `FLAG_REGISTRY` (release toggles, no runtime override). Store-only update prompts
cannot block a build that corrupts data, and client-only remote config cannot be enforced. A mis-set policy can also
"brick" every install (T3-25), and a kill switch can itself be an insider DoS tool (T3-24).

## Options
1. Store-only update prompts — no enforcement, no maintenance, no kill switch. Rejected.
2. Client-only remote config — not enforceable; a client can ignore it. Rejected.
3. **Server-stored, maker-checked policies and switches, evaluated by one pure function for both the public app config
   and the server's own 426/503 enforcement (chosen).**

## Decision
1. **Data (migration 0013, platform schema).** `app_version_policies` (one ACTIVE per platform; maker-checker CHECK —
   approver never the drafter; `recommended_build >= min_supported_build`; `scheduled` activation on server time; guard
   trigger: no delete, values immutable after submission, only DRAFT→PENDING_APPROVAL→APPROVED/REJECTED,
   APPROVED→ACTIVE→RETIRED, APPROVED→RETIRED), `app_blocked_builds` (bounded `int4range` per policy with reason
   SECURITY/DATA_CORRUPTION/CONTRACT_BREAK; no overlap per policy enforced by a guard trigger — no `btree_gist`
   extension, DM-OPEN-03; writable only while the policy is DRAFT), `runtime_switches` (current state per
   key/scope/city, `UNIQUE NULLS NOT DISTINCT`) and the append-only `runtime_switch_changes` (database CHECK: a
   FROM_SAFE change is APPLIED only with an approver who is not the requester; one pending request per target).
2. **Pure evaluation.** `evaluateAppPolicy` returns OK / SOFT_UPDATE / HARD_UPDATE / MAINTENANCE. Precedence: HARD_UPDATE
   (build below the minimum, or inside a blocked range — that range's reason wins) > MAINTENANCE > SOFT_UPDATE > OK.
   The same function shapes `GET /v1/app/config` and the enforcement hook, so the app and the server never disagree.
3. **Server enforcement.** One Fastify `onRequest` hook after the request-id hook (before body parsing, Idempotency-Key
   and authorisation): 426 `WAYVRO_E_APP_UPDATE_REQUIRED` (`details.reasonCodes` = reason class) when the request
   carries `x-wayvro-platform` + `x-wayvro-app-build` and the build is below the minimum or blocked; 503
   `WAYVRO_E_MAINTENANCE` (`retryAfterSeconds` + `Retry-After` from the expected end) while `platform.maintenance` is
   in its safe state. Always reachable: `GET /v1/app/config`, health, every legal read, sign-out and token refresh, the
   in-app deletion path (request, status, cancellation and the account step-up it requires), the public web deletion
   path, and every staff `/v1/admin/*` route (staff end maintenance). No support-contact route exists yet; it joins the
   list when it exists.
4. **Missing headers = allow + log signal** until the first public release: web surfaces and Phase-2 builds send none.
   The access log of a gated request carries `appClient` (ABSENT/INVALID/PRESENT) and ABSENT carries the signal
   `APP_CLIENT_HEADERS_MISSING`, so the switch to "require" at the first public release is measurable. Partial or
   malformed headers are never trusted (treated as unidentified; `GET /v1/app/config` answers 400).
5. **Compatibility control, never authorisation.** The headers only change the 426/SOFT evaluation; every business rule
   stays server-authoritative (test: a spoofed build header changes nothing else).
6. **Released-build source (guardrail, T3-25).** No store build exists yet, so the latest RELEASED build per platform is
   validated configuration: `APP_LATEST_RELEASED_BUILD_ANDROID` / `APP_LATEST_RELEASED_BUILD_IOS` (default 0 = nothing
   released), read by the API and by the worker's scheduled activation. A release-process registry replaces it at
   Phase 7. Guardrails (`appPolicyGuardrailProblems`, checked at submit, approval, manual activation and again at
   scheduled activation): minimum <= latest released (so with nothing released only soft updates are possible);
   blocked ranges well-formed, non-overlapping and never covering the latest released build; staging/production: any
   policy able to produce HARD_UPDATE needs a store URL key; never activate a policy older than the ACTIVE one.
7. **Dry-run preview** (`GET /v1/admin/release/policies/{id}/preview`): guardrail verdict plus ACTIVE sessions per
   recorded app version. Phase-2 sessions record the app VERSION string, not the build, so the preview says so
   (`buildsRecorded: false`) instead of inventing an affected-install count; hourly build counters are a later addition.
8. **Runtime switches.** Keys exist only in the code registry `RUNTIME_SWITCH_REGISTRY` (validated in CI by
   `pnpm flags:check`; no `securityControl` switch may exist; unknown keys are refused by the API and throw in the
   reader). A switch can only REDUCE capability: the base target (ALL scope, no city) is its row or the registry default
   for the environment; narrower rows (RIDER/DRIVER scope, city) can only stop more. Moving TO the safe state: one
   authorised staff member (`platform.switch.disable`) with step-up and a reason code, optional `effective_until`
   (the worker returns the target to its registry default then, recorded as an EXPIRY change by SYSTEM). Moving AWAY:
   request (`platform.switch.enable_request`) + approval by a different staff member (`platform.switch.enable_approve`).
   Each change: audit, change history, outbox `platform.runtime-switch.changed.v1`, alert-level log signal
   `RUNTIME_SWITCH_CHANGED`. Evaluation is server-side only through an in-process cache refreshed at most every
   `RUNTIME_SWITCH_CACHE_SECONDS` (default 10 s); a local staff change invalidates the local cache at once.
9. **Maintenance** is the switch `platform.maintenance` (safe state ENABLED): start = one person (message key + expected
   end), end = maker-checker.
10. **Deliberate fail-open (checklist item 16).** No ACTIVE policy ⇒ no update enforcement (an empty policy must never
    brick installs); the release-control store unreachable at boot ⇒ registry defaults for every switch and no policy
    (sensitive capabilities default OFF in the registry); later outages keep the last-known state. `GET /v1/app/config`
    serves the last-known state at most 10 minutes (flagged `x-wayvro-config-stale`, not cacheable), then 503.
11. **Public app config.** `Cache-Control: public, max-age=APP_CONFIG_CACHE_SECONDS` (60), `ETag` (body without
    `serverTime`; 304 on revalidation), `Vary: x-wayvro-platform, x-wayvro-app-build`, per-IP-prefix limit in Valkey with
    an in-process fallback bucket when Valkey is down (no provider cost sits behind it). `WAYVRO_E_FEATURE_DISABLED`
    keeps HTTP 404 (switch-disabled features look like absent features to clients; unchanged contract).
12. **Scheduled activation** (`config.scheduled-activation`, worker, every minute) runs a small activator registry (app
    policies and switch expiry now; rate cards/zone sets/eligibility rules register theirs). Same protocol as the staff
    path: advisory lock per (kind, scope) + compare-and-set on `status = 'APPROVED' AND scheduled`; a refused policy is
    unscheduled (stays APPROVED), audited as SYSTEM and alerted.
13. **OTA compatibility.** No OTA layer exists (CON-P3-12). A later ADR-031 OTA layer would add its own JS-bundle
    policy beside the native build policy; nothing here assumes the native build is the only version dimension.

## Not implemented (reported)
- **SECURITY expedited path** (one RELEASE_MANAGER with step-up activates a SECURITY-only blocked range, auto-reverting
  unless a different staff member confirms within 24 h): NOT IMPLEMENTED. It needs a revert model (re-instating the
  previous policy with its carried approval, worker INSERT rights on policies) that is a design change of its own and a
  deliberate single-person bypass of maker-checker. Until it is designed and reviewed, a SECURITY block follows the
  normal maker-checker path (two release managers, minutes not hours).
- **"Undo within 15 minutes"** of one's own disable without a checker (T3-24 residual-risk proposal): founder decision
  pending; not implemented (restore stays maker-checker).

## Consequences
- A deploy is not needed to block a broken build, start maintenance or stop a costly SKU; doing so leaves an audit,
  history and outbox trail.
- Two distinct RELEASE_MANAGER identities must exist before any policy can be activated.
- The 426 gate does not stop a determined user from running a blocked build against the API (accepted, T3-26);
  security fixes rely on server-side checks.

## Reversal
No ACTIVE policy = no enforcement; switch rows return to registry defaults via restore or `effective_until`. Schema
rollback only before any staff entry (DROP the four tables and guard functions); afterwards forward-fix only.
