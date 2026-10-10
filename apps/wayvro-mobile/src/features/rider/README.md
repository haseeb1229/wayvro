# Rider mode feature module (empty in Phase 1)

Booking, quotes/offers, active trip, payments, history and rider safety live here from Phase 3. Rules (docs/28 §13,
CLAUDE.md §3, V06/V11): no import from `src/features/driver` (lint + dependency-cruiser enforce it); share only through
`src/core`, `src/platform`, `@wayvro/contracts` and `@wayvro/domain`; never initialise driver-only services.
