# ADR-030 — Web framework (Next.js) version line and framework-maturity policy

| Field | Value |
|---|---|
| Status | **ACCEPTED — founder review correction (2026-10-10)**; pending merge of Phase 1 |
| Date | 2026-10-10 |
| Supersedes | the framework part of `docs/phase0/PHASE0_ADR_BACKLOG.md` ADR-030 (PROPOSED: "Next.js"); hosting remains PROPOSED there and in ADR-028 |
| Applies to | `apps/web-public`, `apps/web-ops`, root `@next/eslint-plugin-next`; the maturity rule applies to every framework/runtime in the workspace |

## Decision
1. **Next.js is pinned to the mature 16.3 line: `next` 16.3.8** in both web apps, with **`@next/eslint-plugin-next` 16.3.8** at the root. React/ReactDOM stay at **19.2.3** (the version also pinned by Expo SDK 57 / React Native 0.86); Next 16.3.8's peer range `react ^19.0.0` covers it, so no React change was needed.
2. Phase 1 had adopted `next` 16.4.0, published 2026-10-06 — three days before the foundation was built. 16.3.8 (published 2026-09-30) is the latest patch of the previous minor line, is not deprecated, and carries the 16.3 line's security fixes. This is a **deliberate maturity/stability choice, not a finding against Next.js 16.4**: Phase 1 used no 16.4-specific capability, and the 16.4 build and runtime checks had passed.

## Rationale
- Wayvro does not currently require any 16.4-specific feature; the web apps are shells (CSP proxy, a page, a health route).
- 16.4 was released only days before the foundation was created; a slightly seasoned stable line with current security fixes is preferred when functionality is equivalent.
- Framework upgrades must be bounded, tested changes — not automatic latest-version adoption.

## Framework-maturity policy (binding for future sessions)
- **Do not upgrade Next.js (or any framework/runtime: NestJS, Expo/React Native, React, TypeScript, Node, Socket.IO, drizzle) to a newer major or minor during unrelated work.** CLAUDE.md §12 already forbids major upgrades inside unrelated feature phases; this ADR extends the same discipline to minor lines of user-facing frameworks.
- Default choice for a framework line: the **latest patch of the newest minor that has been generally available for a while and has had at least one follow-up patch**, unless a needed feature or a security fix requires something newer. No canary, beta, RC or prerelease versions.
- Patch releases within the pinned line (e.g. 16.3.x) may be taken as **bounded, reviewed changes** when they fix security or correctness issues; each one must pass the full CI (quality, integration, security, Android) and be recorded in the commit message.
- A move to a new minor/major (e.g. Next 16.4+ or 17) is its own scoped change with: reason (feature or fix needed), release notes reviewed, full validation, and an update to this ADR.
- pnpm's `minimumReleaseAge` (24 h, ADR-034) remains the floor, not the target: it blocks brand-new publishes; this policy governs which line we choose.

## Evidence (2026-10-10, after the change)
Lockfile change limited to `next`, `@next/env`, `@next/eslint-plugin-next` and the eight `@next/swc-*` platform binaries (16.4.0 → 16.3.8). Full local validation and CI results are listed in the Phase 1 review-correction report (commit message and chat handoff); both web apps build and pass the boot smoke (nonce CSP, security headers, noindex for web-ops).

## Consequences / reversal path
Moving to 16.4.x later is a one-line change per app plus the lint plugin, followed by the full validation suite; the security-header and CSP code (`packages/web-security`, `src/proxy.ts`) is version-independent within Next 16.
