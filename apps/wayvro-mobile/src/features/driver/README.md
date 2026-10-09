# Driver/Partner mode feature module (empty in Phase 1)

Onboarding/KYC, online state, offers, navigation hand-off, earnings and compliance live here from Phase 2/3. Rules: no
import from `src/features/rider`; driver-only permissions (background location, camera for KYC) and background
workers are requested/started just in time inside approved driver flows only, never at app start (CLAUDE.md §9);
ride offers never depend on push or full-screen intents (M26/ADR-033). Server capability state, not this module,
decides what the account may do.
