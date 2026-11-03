# ADR-030 — Web framework (Next.js) version line and framework-maturity policy

| Field | Value |
|---|---|
| Status | **ACCEPTED — founder review correction (2026-10-10)**; in force since Phase 1 review and merge (PR #1, merge commit `eaa1fcb`, 2026-10-10). **Amended 2026-10-29:** security move to the 16.4 line (see Amendment 1) |
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

## Amendment 1 (2026-10-29) — security move to Next.js 16.4.3
- **Reason (security fix required, as the policy above allows):** GHSA-2464-fhr4-w9xw (unauthenticated RCE in the Image Optimization API with SVG files, CVSS 9.5), GHSA-673q-mjm6-r5xr (unauthenticated RCE in `use cache` functions returning typed arrays, 9.5) and GHSA-p3m5-59mp-jv5r (App Router Server Actions DoS, 8.2), all published 2026-10-22, affect every 16.x release before **16.4.1**. No 16.3.x patch fixes them, so the 16.3 line can no longer be kept. CI's osv-scanner gate failed on them.
- **Version:** `next` **16.4.3** in both web apps and `@next/eslint-plugin-next` **16.4.3** at the root. Following the default rule above, this is the latest patch of the 16.4 minor; the line has had three follow-up patches since 16.4.0 (2026-10-06), and 16.4.3 was published 2026-10-23, after the advisories. React/ReactDOM stay at 19.2.3 (16.4.3 peer range `react ^18.2.0 || ^19.0.0`).
- **Validation:** full local suite (format, lint, typecheck, dependency-cruiser, Knip, syncpack, flags, unit tests, OpenAPI drift) and full CI on the branch, including the Web E2E job (Playwright + axe against production builds of both apps) and the security scan. Results are in the commit and in `docs/phase3/PHASE3_IMPLEMENTATION_RECORD.md`.
- The maturity policy itself is unchanged.

## Consequences / reversal path
Moving to 16.4.x later is a one-line change per app plus the lint plugin, followed by the full validation suite; the security-header and CSP code (`packages/web-security`, `src/proxy.ts`) is version-independent within Next 16.
