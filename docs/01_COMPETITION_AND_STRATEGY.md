# 01 — Market, Competitor Coverage and Positioning

## Competitor feature synthesis — current/public capabilities change by city
| Competitor | Publicly observed patterns relevant to Wayvro | What to learn, not copy |
|---|---|---|
| inDrive | City rides, negotiated/counter-offer model, driver choice, intercity, delivery/courier; current app distribution supports riding, driving and delivery-partner use in one public app | Unified multi-role app precedent, transparent offer lifecycle, user choice, driver flexibility, role-switching UX and abuse controls |
| Yango Pakistan | Rider app with upfront pricing, multiple ride classes, scheduling/prebooking, safety tooling and support; separate `Yango Pro` driver app | Fast fixed-price booking, dispatch simplicity, driver operations, safety centre, low-data access and partner/fleet model |
| Bykea Pakistan | Local ride/delivery breadth; separate customer and Partner app; CNIC/licence/photo onboarding for partners | Pakistan-local vehicle mix, cash/partner operations, delivery/COD economics, driver onboarding/support |
| Uber (international benchmark) | Mature rider and separate Driver apps, scheduled rides, multi-stop, guest/business rides, pooled products in some markets, safety/incident systems | Marketplace reliability, lifecycle discipline, safety operations, business booking patterns, scalable experimentation |
| Careem (regional/historical Pakistan benchmark) | Multi-category rides, scheduled/on-demand concepts, captain operations, payments and super-app patterns | Regional UX, service-class packaging, operations and lessons from high-cost ride-hailing execution |
| Pakistan/local niche products | Women-focused rides/carpooling and corridor/shared-mobility ideas exist in smaller products | Do not claim novelty; win on trust, verified supply, reliability, pricing and support |

**Important topology conclusion:** there is no universal industry rule that passenger and driver functions must be separate apps. inDrive currently demonstrates a unified rider/driver/delivery-partner app, while Yango/Bykea/Uber use separate driver distributions. Wayvro therefore treats app topology as a deliberate founder/product decision. The founder has chosen **one unified Wayvro public app** with Rider and Driver/Partner modes; v5 adds explicit safeguards for permissions, security, performance, active-trip conflicts and cross-mode release regression.

Careem's Pakistan ride-hailing service was suspended in 2025; use it as a historical/regional product benchmark rather than assuming active Pakistan ride supply. **Phase 0 refresh (2026-10-09):** the current sourced capability matrix, topology evidence and "what changed" log are in `docs/phase0/PHASE0_COMPETITOR_MATRIX.md` (evidence `docs/phase0/research/R1`); it supersedes the table above for currency. All city-specific competitor availability and prices must be field-verified before product claims or launch decisions.

## Suggested market wedge
Start with a controlled Lahore zone, tightly bounded vehicle classes and a small number of pricing/service modes. Win first on pickup reliability, transparent fares/cancellations, driver economics, safety response and support. Differentiation comes from measurable service quality and trust, not animation volume or a long feature checklist.

## Product differentiation hypotheses
- **H1 Pickup certainty:** riders may prefer a dependable nearby match and honest ETA over a small discount.
- **H2 Driver economics:** transparent commissions, predictable settlement, fair cancellation treatment and fast support may improve driver retention.
- **H3 Unified role ecosystem:** one account/app can lower friction for users who both ride and earn, provided permissions and role isolation are handled cleanly.
- **H4 Smart shared rides:** university/office corridors may support pooled seats if detour, seat, safety and fare allocation are predictable.
- **H5 Women-focused mobility:** verified supply, clear eligibility/privacy rules and real incident response may create trust, but supply density must be proven before promises.
- **H6 Cash + digital:** Pakistan launch likely needs both cash and digital settlement without creating accounting leakage or unlicensed stored value.
- **H7 Low-data access:** weak-network and low-end Android support can be a meaningful local advantage only if the core booking flow still behaves reliably.

All hypotheses require field validation; none are launch claims.

## Evidence plan
Before broad paid acquisition:
- structured rider/driver interviews and usability sessions;
- on-device competitor walkthroughs using normal public flows and terms;
- zone-level supply/demand observation;
- dispatch/ETA and cancellation experiments using test/pilot cohorts;
- women-safety and incident-response table-top exercises;
- driver onboarding shadow runs;
- low-end Android and poor-network testing;
- contribution-margin model per service class.

Initial sample sizes may be modest for discovery but must not be presented as statistically representative market proof.

## Economics sanity checks
For each service/vehicle segment track: gross booking value, taxes/fees, rider subsidies, driver gross/net earnings, platform take, payment/chargeback costs, incentives, support/fraud/insurance/claims, map/OTP/KYC infrastructure cost, CAC, repeat frequency, cohort retention, refunds, no-shows and contribution margin. Reject growth plans that only work while permanently subsidized.

## Do not claim without proof
Do not market Wayvro as “Pakistan's safest”, “cheapest”, “first carpooling app”, “100% verified women-only”, “zero commission forever”, “guaranteed pickup” or “better than every competitor” unless evidence, legal review and operations can sustain the claim.
