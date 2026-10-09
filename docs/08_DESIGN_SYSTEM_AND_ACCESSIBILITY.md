# 08 — Real Product Design, Mobile UX and Accessibility

## Principle
Original, professional product identity and visual system. Modern but restrained animation; prioritize booking speed, trust and readability over wow effects. Do not reproduce competitor logos, brand colors, copyrighted illustrations or near-identical screen compositions.

## Brand / design research
The founder has locked the product name as **Wayvro** (pronounced **WAY-VRO**). Do not rename it or restart naming exploration unless the founder explicitly changes that decision. Before final public branding or launch, still search SECP company-name, IPO Pakistan trademark, domain, app-store and social-handle collisions; document legal/brand-clearance evidence; design original visual references; run moodboard/usability validation with riders/drivers. Name lock does **not** imply trademark or company-name clearance.

## Visual system requirements
- Tokenized light/dark colors, elevation, borders, radii, spacing, type scale, iconography, responsive grid and empty/skeleton/error styles.
- Minimum WCAG AA contrast where applicable, 44px+ touch hit areas, safe areas, Android/iOS native behaviors, screenreader descriptive labels and dynamic text.
- Focus on map clarity, bottom sheets, vehicle cards, fare breakdown, estimated arrival, progress indicator, status chronology and safety button.
- Urdu script font and fallback testing, Roman Urdu search hints, PKR formatting, 12/24-hour local display, Celsius if relevant, city landmark address readability.
- Driver interface optimized for short glances, large hit areas, disabled unsafe actions while moving; avoid interaction-intensive UI while driving.
- Poor 2G/3G connectivity, offline/reconnect, GPS disabled, no drivers, provider outage, rider safety incident, payment pending, expired docs: ALL need designed states.


## Unified app mode-switch UX
- One shared account shell exposes Rider mode and, when available, Driver/Partner status/mode without making the app feel like two unrelated products glued together.
- A rider who has never applied to drive sees an `Earn with Wayvro` entry, not inaccessible driver controls.
- Pending/rejected/suspended/expired driver states show clear status and next action while preserving lawful Rider-mode access.
- The mode switch cannot visually imply that switching grants authorization; server state decides.
- Active ride/driver obligations visibly constrain switching and explain why.
- Shared visual tokens/brand stay consistent, but Rider and Driver/Partner navigation can be optimized for their different tasks.

## Rider-mode screen map
Splash/version -> welcome/consent -> auth/OTP -> home map -> pickup/drop -> quote vehicle choice -> confirm -> driver search -> offer acceptance -> driver en route -> arrived / verify PIN -> live trip -> safety/contact -> receipt/rating -> history/help. Optional nav: profile, places, payments, promotions, preferences, trips, support.

## Driver/Partner-mode screen map
Auth -> application/identity -> document upload/review -> training -> approved home -> online/offline -> offer -> pickup route -> arrived/PIN -> live trip navigation -> trip complete -> earnings/settlement -> account/safety/support. Explicit pending/rejected/suspended/expired screens.

## Staff web screen map
Login/MFA -> role dashboard -> action queues -> filtered live rides -> drilldown/audit -> escalation -> action/approval. Separate identity vault views with re-auth where warranted. Finance/payout actions require confirmation/dual approval and fully auditable evidence.

## Interaction specification template per screen
Purpose, actor, preconditions, visual hierarchy, data contract, loading/empty/offline/error/retry/permission variants, success/transitions, analytics events, accessibility assertions, screen shots/snapshot tests and performance budget.

## Performance targets (proposed SLO, to ratify after baselines)
Fast first meaningful frame and request feedback on supported low-midrange Androids; screen transitions without blocking; throttled location redraw; no map rerender on every raw GPS sample; background battery benchmark; app cold/warm launch and crash-free sessions monitored. Use measurement, not invented benchmarks.
