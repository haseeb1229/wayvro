# Driver/Partner mode feature module

Lives inside the ONE Wayvro app (no separate driver app). P2.8 adds the Driver/Partner onboarding: explanation (K14),
driver policies and consent, claims, vehicle, document claims, guided capture/import of evidence, a resumable upload
queue, submission, review status, appeals (K05) and, for a verified driver, the compliance view with document renewals.

Rules:

- No import from `src/features/rider` (lint + dependency-cruiser + `architecture.test.ts`); shared code lives in `src/core`
  and `@wayvro/contracts`.
- Every screen is reached through a `lazyScreen(() => import(…))` route under `src/app/(session)/earn/`, so riders never
  evaluate this module at start-up. `expo-camera`, `expo-image-picker` and `expo-file-system` are imported ONLY here.
- The camera permission is requested just in time on the capture screen; the selfie is front-camera only and never
  importable; documents may be imported through the system Photo Picker (no storage/media permission).
- Local evidence files live only in `<cache>/wayvro-evidence` and are deleted after the server confirms an upload, on
  discard, when an application closes, and on sign-out/session expiry. Queue metadata (never image bytes or upload URLs)
  is kept in secure storage.
- The server decides everything (application state, requirements, capabilities, eligibility). The selfie is for manual
  review by a person; nothing here claims identity verification, liveness or face matching.
- Ride offers never depend on push or full-screen intents (M26/ADR-033); online state is a later phase.
