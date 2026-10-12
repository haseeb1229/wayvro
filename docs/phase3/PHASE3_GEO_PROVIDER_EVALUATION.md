# PHASE3_GEO_PROVIDER_EVALUATION — Geo provider evaluation per SKU, licence-coherent bundles and SP-04 scoring (PROPOSED)
**Date:** 2026-10-12 · **Branch:** `docs/phase-3-planning` (from `main` @ `058fcea`) · **Status:** PLAN ONLY — founder/ChatGPT plan review recorded 2026-10-12 (targeted fixes applied, `docs/phase3/PHASE3_PLAN.md` §11); no Phase 3 product code, migration, dependency, provider account or credential exists. · **Agent:** Claude Code (self-audit, not independent verification).

## 0. Purpose, scope and authority

This document prepares the ADR-006 decision ("maps/geocode/routing provider per SKU") without making it. It lists the SKUs Wayvro needs, what each candidate vendor offers per SKU, which vendor combinations are licence-compatible, what each combination is estimated to cost, how results may be cached, what each vendor learns about Wayvro users, and how SP-04 evidence (see `docs/phase3/PHASE3_SP04_LAHORE_FIELD_BENCHMARK.md`) will be scored. **No provider is chosen here.**

| Item | Value |
|---|---|
| Requirement IDs fed | E06 (route provider abstraction), E07 (cache/cost protection, no invented ETAs), B01 (map, geolocation, manual pin, landmark address), B02 (autocomplete, reverse geocode, pin fallback), B03 (route, distance/ETA with confidence), I11 (quotas, circuit breakers, budgets), A06 (Urdu/Roman-Urdu-aware search), L08 (Lite mode), U04 (SDK inventory, see `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md`) |
| Founder decisions | FD-04 hybrid provider abstraction (locked), FD-01 pilot volume ~500 trips/day, FD-14 provisional pilot envelope USD 250–300/month total infrastructure, FD-03 Singapore provisional region |
| Contradictions resolved here | CON-P3-03 (provider preference differs across Phase-0 docs), CON-P3-04 (Google pilot cost vs FD-14), CON-P3-16 (licence coupling — new, see §6) |
| Related plan docs | `docs/phase3/PHASE3_ARCHITECTURE.md` (ports, gateway, cache), `docs/phase3/PHASE3_SECURITY_COST_THREAT_MODEL.md`, `docs/phase3/PHASE3_PERFORMANCE_BUDGETS.md`, `docs/phase3/PHASE3_ADR_AND_DEPENDENCY_PROPOSALS.md`, `docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` |
| Phase-0 grounding | `docs/phase0/PHASE0_COST_PROVIDER_MATRIX.md`, `docs/phase0/research/R5_PROVIDER_COST_RESEARCH_2026-10-09.md` §5, `docs/phase0/PHASE0_ADR_BACKLOG.md` (ADR-006, SP-04) |

**Confidence legend.** V = verified on the vendor's primary page, seen 2026-10-12. S = secondary source or vendor page not fully read, seen 2026-10-12. NF = not found; must be verified before it is relied on. Phase-0 figures are dated 2026-10-09 and cited as R5. **Every price and term must be re-verified at the SP-04 freeze (P3.7)**; vendor pages change without notice and no price below is a quote. FX is not applied (all USD). Prices exclude taxes.

**Free tier is not a reliability strategy** (Phase-0 cost matrix; RSK-010). A free quota can make an evaluation cheap; it never satisfies the production availability gate in §12.

## 1. ADR-006 status

| Part | Status | Meaning |
|---|---|---|
| Hybrid provider abstraction: vendor-neutral ports, adapters behind them, provider choice per SKU | **FOUNDER-LOCKED** (FD-04) | Not reopened by Phase 3. All Phase-3 code is written against ports, never against a vendor. |
| Which vendor serves which SKU (and therefore which map renderer) | **OPEN-SPIKE** (SP-04, NOT RUN) | Decided only at checkpoint P3.7 on SP-04 evidence, recorded in the future ADR-006 file as ACCEPTED-ON-EVIDENCE. |
| Licence-coherent bundle constraint (CON-P3-16) | **PROPOSED** | Narrows "per SKU" to combinations every vendor's terms allow. Final licence reading = founder + counsel (EXTERNAL). |
| External-app navigation handoff for drivers (M23/S22) | FOUNDER-LOCKED (direction approved in the Phase-0 backlog, parameters open) | Not Phase 3. Noted because Google terms restrict building in-app navigation substantially similar to Google Maps (§5.5). |

## 2. SKUs Wayvro needs (evaluated separately)

| SKU | Phase-3 use | Port (proposed, `packages/provider-interfaces`) | Called from | Phase |
|---|---|---|---|---|
| Tiles / map rendering | rider map, pin screen, route preview | `mapStyle` descriptor (server config) + client renderer behind `src/platform/maps/` | **device** (only client-side vendor surface) | 3 (P3.7) |
| Autocomplete | pickup/drop search, Roman-Urdu/Urdu queries | `placesAutocomplete` | server | 3 |
| Place resolution (selected suggestion → coordinate) | after a suggestion is chosen | `placesAutocomplete` (resolve) | server | 3 |
| Forward geocode | free-text address that is not a suggestion | `geocoding` | server | 3 |
| Reverse geocode | pin / current location → landmark-first address | `reverseGeocoding` | server | 3 |
| Directions / route geometry | quote route snapshot + polyline for preview | `routing` | server | 3 |
| Distance | from the route (pricing input) | `routing` | server | 3 |
| ETA (trip duration) | from the route (pricing input, display) | `routing` | server | 3 |
| Matrix (driver→pickup many-to-many) | dispatch | not in Phase 3 | server | 4 |
| Navigation | driver turn-by-turn | not in Phase 3; external-app handoff direction | device | later |

Evaluation dimensions applied to each SKU: accuracy, coverage/failure behaviour, landmark/address usefulness, Pakistan/Lahore quality, response time, price, cacheability, terms/licensing, rate limits, privacy. Lahore quality for **every** vendor is NF today: that gap is exactly what SP-04 measures.

## 3. Candidate summary per SKU

### 3.1 Tiles / rendering

| Vendor / option | Renderer | Price / free (conf.) | Key terms (conf.) | Notes |
|---|---|---|---|---|
| Google Maps SDK (Android/iOS) | react-native-maps with the Google provider on both platforms (Expo SDK 57 pins 1.27.2); expo-maps (~57.0.4) only on Android — it renders **Apple Maps on iOS** (TECHNICAL), so it is not an S1 renderer there | Maps SDK mobile native dynamic maps: Essentials, no charge listed (V, https://developers.google.com/maps/billing-and-pricing/pricing, page "Last updated 2026-10-08", seen 2026-10-12) | Google Places/Routes content must be shown on a Google map (V, §6) | SDK collects device/SDK metadata, IP, pseudonymous ID, interaction events (V, §10). API key on device, restricted by package/signature. |
| Mapbox Maps SDK | @rnmapbox/maps 10.3.7 (2026-10-05, MIT, Maps SDK v11; V npm, seen 2026-10-12) | 25,000 MAU free then USD 4.00 per 1,000 MAU (V, https://www.mapbox.com/pricing, seen 2026-10-12) | access token on device; telemetry on by default, in-app opt-out mandatory (V) | Required if any Mapbox geocoding is used (§6). |
| OpenFreeMap (public) | MapLibre RN 11.5.0 (2026-10-04, MIT, New-Arch only; V) | free, no key, commercial use OK (V) | **no SLA** (V); OpenMapTiles + OSM attribution | Good for dev/SP-04; production needs a fallback host (§12 gate G3). |
| Protomaps PMTiles self-hosted | MapLibre RN | storage cost only (S3-compatible, e.g. R2 already in Phase-0 stack) | code BSD-3, spec CC0, data OSM ODbL (V) | Single archive over HTTP Range; Wayvro controls host and logs. |
| MapTiler | MapLibre RN | Free: 5,000 sessions / 100K requests per month, "testing/PoC/personal/non-commercial", pauses at quota (V); Flex USD 30/month, 25K sessions (V) | free plan not for commercial production | Paid fallback host candidate only. |
| OSM public tiles | — | — | strict policy, no SLA, commercial access may be withdrawn, no offline/prefetch/bulk (V) | **Excluded.** |
| TomTom tiles | MapLibre RN (style compatibility NF) | 200K vector + 200K raster tiles/month free (V, https://docs.tomtom.com/pricing, seen 2026-10-12); paid price NF | commercial use on free tier NF | Only relevant inside an S4 bundle. |
| HERE tiles | MapLibre RN (NF) | ~30K free transactions/month per service (S); payment method required (S) | NF | Only inside S4. |

### 3.2 Autocomplete and place resolution

| Vendor | Product | Price / free (conf.) | Terms / cache (conf.) | Lahore (Roman-Urdu) |
|---|---|---|---|---|
| Google | Places Autocomplete + Place Details | Autocomplete Requests 10K free then USD 2.83/1K; Autocomplete Session Usage unlimited, no charge; Place Details Essentials USD 5/1K (Essentials 10K free) (V, pricing page above). Exact session-termination billing semantics NF — verify | predictions TTL 0 unless terms allow; `place_id` storable indefinitely; must not be displayed on a non-Google map (V) | NF — SP-04 |
| Mapbox | Search Box API, or Geocoding (temporary) with autocomplete | Search Box has two billing models that must not be conflated (V, https://www.mapbox.com/pricing, accessed 2026-10-12, page undated): **sessions** (/suggest + /retrieve; a session = up to 50 /suggest + 1 /retrieve, expiring after 2 min of inactivity) — standard 2,500 free then USD 11.50/1K (introductory preview pricing: 500 free then USD 3.00/1K, not assumed to remain available); **requests** (/category and /reverse only) — standard 25,000 free then USD 1.70/1K (preview: 50,000 free then USD 1.00/1K); temporary geocoding 100K free then USD 0.75/1K (V) | temporary geocoding results must not be cached and may be used only with a Mapbox map (V, https://docs.mapbox.com/api/search/geocoding/, seen 2026-10-12); Search Box map-coupling terms NF | NF |
| Open stack | Photon (Apache-2.0, 1.3.0, 2026-08-07; V) self-hosted | infra only | own data; ODbL attribution | NF; POI completeness is the known risk (R5) |
| Open stack | Nominatim public server | — | **autocomplete prohibited**, 1 req/s, systematic reverse prohibited (V) | **Excluded**; self-hosted Nominatim (GPL-3.0, v5.3.2) possible but not built for type-ahead |
| TomTom | Search | 2.5K search/month free (V); paid NF | map coupling NF | NF |
| HERE | Autosuggest | ~30K/month free per service (S); price +6 % from 2026-04-01 (S) | NF | NF |

### 3.3 Forward and reverse geocode

| Vendor | Price / free (conf.) | Terms / cache (conf.) |
|---|---|---|
| Google Geocoding | USD 5/1K, 10K free (Essentials) (V). Reverse geocoding has no separate SKU on the page (NF; assumed Geocoding) | lat/lng cacheable max 30 consecutive days then delete; indefinite caching only per end user, logically isolated, not shared, not a call replacement (V, https://cloud.google.com/maps-platform/terms/maps-service-terms, 2026-06-10, and https://developers.google.com/maps/documentation/geocoding/policies, seen 2026-10-12); not with a non-Google map |
| Mapbox Geocoding | temporary 100K free then USD 0.75/1K; permanent no free tier, USD 5.00/1K (V) | temporary: no caching, Mapbox map only; permanent: storable, card on file (V) |
| Photon / Nominatim self-hosted | infra only | own data; freshness-based TTL |
| TomTom | 20K geocoding + 20K reverse/month free (V); paid NF | NF |
| HERE | ~30K/month free per service (S) | NF |

### 3.4 Directions / distance / ETA

| Vendor | Price / free (conf.) | Terms (conf.) | Traffic |
|---|---|---|---|
| Google Compute Routes | Essentials USD 5/1K (10K free), Pro USD 10/1K (5K free), Enterprise USD 15/1K (1K free) (V). Which features (e.g. traffic-aware) map to Pro: NF on the pricing page | results displayed on a map must be on a Google map (V); pricing-only use without display: treat as **not allowed with a non-Google map** unless counsel/vendor confirms (CON-P3-16) | yes (tier NF) |
| Mapbox Directions | 100K free then USD 2.00/1K (V); rate limit 300 requests/min (V) | map coupling for Directions NF — verify | traffic profile exists (tier/terms NF) |
| OSRM self-hosted | infra only; BSD-2, v26.10.0 (2026-10-01) (V) | own; ODbL attribution | **no live traffic**; ETA from road-speed profile only |
| Valhalla self-hosted | infra only; MIT, 3.9.1 (2026-10-06) (V) | own; ODbL attribution | no live traffic |
| TomTom Routing | 20K/month free (V); paid NF | NF | yes (NF detail) |
| HERE Routing | ~30K/month free (S) | NF | NF |

Phase-3 constraint: matrix is not used; the route used for pricing is fetched once per quote group and stored as `pricing.route_snapshots` (server truth); the map renderer never computes pricing distance.

### 3.5 Terms that affect product design (not only provider choice)

- Google 3.2.3(d)(iv): no building navigation substantially similar to the Google Maps app with Directions + Maps SDK (V, https://cloud.google.com/maps-platform/terms, last modified 2026-08-26, seen 2026-10-12). Consistent with the external-app navigation handoff direction; Phase 3 builds no navigation.
- Google 3.2.3(b): no caching except as the Service Specific Terms permit (V). Drives §8.
- Mapbox: in-app telemetry opt-out is mandatory if the Mapbox SDK ships (V). Drives the inventory row in `docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md`.
- ODbL (OSM Foundation attribution guidelines, 2026-09-10, V): "© OpenStreetMap" plus ODbL link visible on interactive maps (may collapse after 5 s); geocoders/routers credit OSM at app level; a Derivative Database triggers share-alike.

## 4. What is unknown for every vendor (NF list feeding SP-04)

| Unknown | Why it matters | How it is closed |
|---|---|---|
| Lahore address/POI coverage, especially society/block/phase plot addresses | top-1 geocode hit rate | SP-04 categories C02/C03 |
| Roman-Urdu and Urdu-script query handling | A06 | SP-04 query variants |
| Landmark usefulness of reverse geocode inside societies | B01 landmark-first address | SP-04 rubric 0–3 |
| Lahore road graph quality (one-ways, U-turn restrictions, underpasses, service roads) | route distance and plausibility | SP-04 categories C06/C07/C12 |
| ETA quality without live traffic (open stack) vs with traffic | ETA error | SP-04 off-peak and peak drives |
| Latency from the production region (Singapore provisional, FD-03) | performance budgets | SP-04 measures from Lahore; region re-measure when hosting exists |
| TomTom/HERE map-coupling and commercial terms, TomTom paid prices | S4 feasibility | founder reads terms/asks vendor (FA-06) |
| Google reverse-geocode SKU naming, traffic tier mapping, volume tiers | cost model | re-read pricing page at P3.7 |

## 5. Lahore-specific quality expectations (hypotheses, not findings)

From `docs/phase0/research/R6_SAFETY_OPS_MARKET_RESEARCH_2026-10-09.md` and the Phase-0 product implications: Lahore riders describe places landmark-first (market, chowk, gate, hospital), societies use block/phase/plot formats, Roman Urdu is a first-class input language, and networks are 4G-dominant but degraded. Expected but **unverified** patterns SP-04 must test:

- Commercial vendors may cover POIs and landmarks better; open data may cover society internal roads well where community-mapped but POI names unevenly (R5: "Lahore OSM road completeness not quantified").
- No vendor is expected to geocode "Plot N, Block X, Phase Y" formats reliably; Wayvro's curated `geo.landmark_aliases` and the manual pin remain the safety net regardless of vendor.
- Without live traffic (OSRM/Valhalla), peak-hour ETA error will be larger; off-peak ETA is the gating comparison and peak is recorded informationally.

## 6. Licence coupling (CON-P3-16) and licence-coherent bundles

**Finding (from V terms, seen 2026-10-12).** "Provider per SKU" cannot be chosen freely:

1. Google Places content must not be displayed on a non-Google map, and Google Core Services must not be used with or near a non-Google map; Geocoding/Routes/Places may be used without a Google map (with Google attribution) but **must not be used in conjunction with a non-Google map**; Routes results displayed on a map must be on a Google map (V; CONTRACTUAL, §6.1).
2. Mapbox temporary geocoding results may be used only with a Mapbox map and must not be cached (V; CONTRACTUAL, §6.1).
3. Open-stack components carry ODbL attribution/share-alike obligations but no map-vendor coupling.
4. TomTom/HERE coupling terms: NF.

### 6.1 Nature of each vendor restriction (CONTRACTUAL vs TECHNICAL)

CONTRACTUAL = a term, policy or licence obligation that the API/SDK does not itself enforce (compliance is Wayvro's responsibility and an enforcement risk: suspension, termination, damages). TECHNICAL = a limit the API/SDK enforces or a property of the software itself. All sources accessed 2026-10-12; re-verify at the SP-04 freeze (P3.7).

| Restriction | Nature | Source (accessed 2026-10-12) |
|---|---|---|
| Google Places/Geocoding/Routes content must not be used with or near a non-Google map; Routes results shown on a map must be on a Google map | CONTRACTUAL | https://cloud.google.com/maps-platform/terms (§3.2.3(e), last modified 2026-08-26); https://cloud.google.com/maps-platform/terms/maps-service-terms (2026-06-10) |
| Google: no caching except as the Service Specific Terms permit; lat/lng ≤ 30 consecutive days; `place_id` storable; Geocoding indefinite caching only per end user | CONTRACTUAL | same two URLs (§3.2.3(b)); https://developers.google.com/maps/documentation/geocoding/policies |
| Google: no in-app navigation substantially similar to the Google Maps app | CONTRACTUAL | https://cloud.google.com/maps-platform/terms (§3.2.3(d)(iv)) |
| Google free caps per SKU/month and per-API quotas | TECHNICAL (billing/quota enforced by the platform) | https://developers.google.com/maps/billing-and-pricing/pricing (page "Last updated 2026-10-08") |
| Mapbox temporary geocoding results must not be cached and may only be used with a Mapbox map; permanent geocoding is a separate paid SKU | CONTRACTUAL | https://docs.mapbox.com/api/search/geocoding/ |
| Mapbox **Commercial Application License** "for vehicle, B2B, and internal business applications": required "for vehicle usage (including ground, aerial, manned and unmanned vehicles)" and for "applications primarily intended for use within vehicles or use in any vehicle system or component thereof"; it "consists of an annual subscription and, where applicable, a per-user or seat-based component" | CONTRACTUAL; **applicability to Wayvro Rider/Driver use = EXTERNAL — Mapbox commercial/legal confirmation (FA-19)**; not decided by this plan; no fee assumed | https://www.mapbox.com/pricing (Licensing section; accessed 2026-10-12; page undated) |
| Mapbox Search Box billed by **sessions** (/suggest + /retrieve) or by **requests** (/category, /reverse), each with introductory preview and standard pricing | TECHNICAL/commercial billing semantics (the billing mode decides cost; preview pricing is not assumed to persist) | https://www.mapbox.com/pricing (accessed 2026-10-12) |
| Mapbox Directions limited to 300 requests/min by default | TECHNICAL (API rate limit; higher limit on request) | https://docs.mapbox.com/api/navigation/directions/ |
| Mapbox mobile SDK telemetry must be user-opt-out-able in the app | CONTRACTUAL obligation, implemented through an SDK setting | https://docs.mapbox.com/api/search/geocoding/ and https://www.mapbox.com/pricing (as summarised in the 2026-10-12 research; exact clause to re-cite at P3.7) |
| expo-maps renders Apple Maps on iOS (Google Maps on Android) | TECHNICAL (SDK property; makes it incompatible with the CONTRACTUAL Google-map-only rule on iOS) | https://docs.expo.dev/versions/latest/sdk/maps/ |
| Public Nominatim: no autocomplete, no systematic (e.g. grid) reverse queries, max 1 request/s | CONTRACTUAL usage policy (violations are banned operationally) | https://operations.osmfoundation.org/policies/nominatim/ |
| OSM public tiles: no SLA, access may be withdrawn, no bulk/prefetch download | CONTRACTUAL usage policy | https://operations.osmfoundation.org/policies/tiles/ |
| OSM data: visible attribution; ODbL share-alike for a Derivative Database | CONTRACTUAL (licence) | OSM Foundation attribution guidelines (2026-09-10, per research notes; URL re-cited at P3.7) |
| MapTiler free plan: testing/PoC/personal/non-commercial, pauses at quota | CONTRACTUAL (plan terms) + TECHNICAL (quota pause) | MapTiler pricing page (per research notes; URL re-cited at P3.7) |
| OSRM/Valhalla: no live traffic | TECHNICAL (engine capability) | project releases (OSRM v26.10.0, Valhalla 3.9.1) |
| Nominatim GPL-3.0 | CONTRACTUAL (licence; unmodified separate service only) | project licence |

### 6.2 Consequence: licence-coherent bundles

Wayvro always shows a map (or a text-first Lite view) on the same screens where search results and the route appear, so any Google geo content implies a Google renderer on both Android and iOS, and any Mapbox geocoding implies a Mapbox renderer. **Pricing-only server use** of Google routing (polyline never drawn on a non-Google map) is treated as NOT allowed unless counsel or Google confirms in writing.

**Consequence.** The FD-04 abstraction is unchanged; SP-04 evaluates **bundles**, and per-SKU choices only inside a bundle whose every vendor permits the combination.

| Bundle | Renderer + tiles | Autocomplete / resolve | Geocode / reverse | Routing | Licence status |
|---|---|---|---|---|---|
| **S1 Google** | react-native-maps with the Google provider on **both** platforms (Android Google Maps SDK; iOS requires the Google Maps iOS SDK — Expo config support: verify). expo-maps is **not** S1-compatible on iOS because it renders Apple Maps there (analysis; counsel to confirm) | Google Places | Google Geocoding | Google Routes | coherent per V terms; attribution/logo duties |
| **S2 Mapbox** | @rnmapbox/maps + Mapbox tiles | Mapbox Search Box or temporary geocoding | Mapbox temporary geocoding (permanent only if paid and storage is needed) | Mapbox Directions | coherent per V geocoding terms; Directions/Search Box map-coupling NF (likely satisfied anyway because the map is Mapbox) |
| **S3 Open** | MapLibre RN + OpenFreeMap (dev) / self-hosted Protomaps on S3-compatible storage (production candidate) | self-hosted Photon | self-hosted Photon (reverse) and/or Nominatim | self-hosted OSRM or Valhalla | coherent; ODbL attribution in app; share-alike analysis for any Derivative Database (counsel) |
| **S4 Mixed (only where every vendor's terms allow)** | MapLibre RN + open tiles (or TomTom tiles) | TomTom or HERE search (if their terms permit any map — NF) | TomTom/HERE or Photon | OSRM/Valhalla or TomTom/HERE routing | **NOT ADMISSIBLE until terms are verified** (FA-06) |
| S4c (variant) | Google renderer (react-native-maps, Google provider) | Google Places | Google Geocoding | OSRM/Valhalla polyline drawn on the Google map | permissibility of non-Google route overlay on a Google map and OSM attribution placement: NF — **not admissible until verified**; exists only to test whether Google search quality can be kept with lower routing cost |

Forbidden combinations (examples): Google geocoding/places/routes with MapLibre, Mapbox or Apple Maps rendering; Mapbox temporary geocoding with MapLibre/Google rendering; any use of the public Nominatim server for autocomplete; OSM public tile servers in the app.

Lite mode (L08, text-first, no tiles) does not remove the coupling: Lite is a mode of the same app whose standard mode shows the bundle's map, and terms reading of "display without a map" (Google allows it with attribution) must not be used as a loophole for mixing vendors across modes. Counsel confirms.

## 7. Cost model (ESTIMATE)

### 7.1 Assumptions

| # | Assumption | Source |
|---|---|---|
| A1 | Pilot ≈ 500 trips/day ≈ **15,000 trips/month**; scale case 5,000 trips/day ≈ 150,000 trips/month | FD-01, Phase-0 cost matrix |
| A2 | **≈ 8 billable geo calls per completed trip** | Phase-0 assumption (R5 §5) |
| A3 | Proposed split of the 8 calls (ESTIMATE, includes Phase-4+ calls so the steady-state pilot cost is visible): 2 place resolutions (pickup + drop, one autocomplete session each), 2 reverse geocodes (pin/current location, drop confirmation), 4 route calls (quote route, driver→pickup ETA, trip route, one re-route/refresh) | this plan |
| A4 | Autocomplete keystroke requests are not billed separately when a session ends in a place resolution (Google session model; V that session usage is no-charge, NF exact semantics) — abandoned sessions shown as sensitivity | pricing page |
| A5 | MAU (Mapbox) at pilot ≤ 25,000 | ESTIMATE; unknown until pilot |
| A6 | No cache benefit assumed (worst case); cache effects in §7.5 | conservative |
| A7 | List prices at the first volume tier only unless a tiered calculation is shown; volume discounts NF | facts file |
| A8 | **Google** is modelled two ways: pay-as-you-go (PAYG, per-SKU free caps) and **subscription** (Starter USD 100 / 50,000, Essentials USD 275 / 100,000, Pro USD 1,200 / 250,000 combined calls per month; one combined limit for all included SKUs; no-cost SKUs such as Maps SDK do not count; calls above the limit are billed at standard PAYG prices and are not blocked; change or cancel anytime; not available to India-PAYG customers). Starter includes only Geocoding and Dynamic Maps; Essentials includes Geocoding, Autocomplete, Place Details Essentials, Compute Routes Essentials, Route Matrix Essentials, Maps SDK; Pro adds the Pro SKUs incl. Routes Pro; Navigation SDK is in no plan. Whether per-SKU PAYG free caps still apply alongside a subscription is **NF** (modelled both ways). | https://mapsplatform.google.com/pricing/ and https://developers.google.com/maps/billing-and-pricing/subscriptions ("Last updated 2026-10-08"), accessed 2026-10-12 |
| A9 | **Mapbox Search Box** autocomplete is billed by **sessions** (one session per place resolution); request billing applies only to /category and /reverse. The planning figure uses **standard** pricing; introductory preview pricing is shown as a lower bound only and is not assumed available at pilot or production. Any Commercial Application License cost (FA-19) is **not** included and is unknown. | https://www.mapbox.com/pricing, accessed 2026-10-12 |

Monthly billable calls at pilot: resolutions 2 × 15,000 = **30,000**; reverse 2 × 15,000 = **30,000**; routes 4 × 15,000 = **60,000**; total 120,000 = 8 × 15,000. At scale: ×10.

### 7.2 Pilot (15,000 trips/month), per bundle

| Bundle | Arithmetic (ESTIMATE) | USD/month |
|---|---|---|
| S1 Google (Essentials routes) | Maps SDK mobile: 0 · Place Details: (30,000 − 10,000) × 5/1,000 = 100 · Geocoding (reverse): (30,000 − 10,000) × 5/1,000 = 100 · Routes Essentials: (60,000 − 10,000) × 5/1,000 = 250 | **≈ 450** |
| S1 Google (routes need Pro tier) | as above but routes (60,000 − 5,000) × 10/1,000 = 550 | **≈ 750** |
| S1 sensitivity: abandoned search sessions | e.g. 1 abandoned session/trip × 4 requests = 60,000 Autocomplete Requests: (60,000 − 10,000) × 2.83/1,000 = 141.50 (PAYG) | +0 to ≈ 142 |
| S1 Google — **subscription Starter** (USD 100, 50,000; Geocoding + Dynamic Maps only) | reverse Geocoding 30,000 inside the plan; Place Details 100 + Routes Essentials 250 stay PAYG | **≈ 450** (no saving vs PAYG) |
| S1 Google — **subscription Essentials** (USD 275, 100,000 combined; Essentials routes suffice) | Place Details 30,000 + Geocoding 30,000 + Compute Routes Essentials 60,000 = 120,000 combined → 20,000 over the limit at standard PAYG prices: 0 (if per-SKU free caps still apply — NF) to 20,000 × 5/1,000 = 100 | **≈ 275–375** |
| S1 subscription sensitivity: abandoned search sessions | 60,000 Autocomplete Requests count against the combined pool → + up to 60,000 × 2.83/1,000 ≈ 170 over the limit | +0 to ≈ 170 |
| S1 Google — routes need the Pro tier | Essentials subscription for Place Details + Geocoding (60,000 ≤ 100,000) 275 + Routes Pro PAYG (60,000 − 5,000) × 10/1,000 = 550 → ≈ 825; or **subscription Pro** (USD 1,200, 250,000 combined incl. Routes Pro) → ≈ 1,200; PAYG-only ≈ 750 (row above) | **≈ 750–1,200** |
| S2 Mapbox — Search Box **sessions, standard pricing** (planning figure) | MAU ≤ 25,000 → 0 · sessions (30,000 − 2,500) × 11.50/1,000 = 316.25 · reverse via temporary geocoding 30,000 ≤ 100,000 → 0 (or Search Box /reverse requests, standard: (30,000 − 25,000) × 1.70/1,000 = 8.50) · Directions 60,000 ≤ 100,000 → 0 | **≈ 316–325** + Commercial Application License (FA-19, unknown) |
| S2 lower bound — Search Box sessions, **introductory preview** pricing (not assumed available) | (30,000 − 500) × 3.00/1,000 = 88.50 | ≈ 89 + licence (unknown) |
| S2 variant — autocomplete via **temporary geocoding** (request-billed) | autocomplete 120,000 + reverse 30,000 = 150,000 temporary geocodes: (150,000 − 100,000) × 0.75/1,000 = 37.50 | ≈ 38 + licence (unknown) |
| S3 Open | OSRM + Photon on the pilot VPS already in the Phase-0 stack (CPX32 SIN ≈ USD 58 + 12 backups, R5 2026-10-09, not re-verified) → marginal 0; or a dedicated geo VPS (Hetzner EU CX33 €8.49 / CX43 €15.99, R5, not re-verified) + tiles on R2 (USD 0–5) | **≈ 0–25** (+ operations time, §13) |
| S4 Mixed | TomTom/HERE paid prices NF; TomTom free search 2,500/month is far below 30,000 resolutions | **NF** — vendor quote needed |
| S4c | Place Details 100 + Geocoding 100 + routes on own OSRM 0 | ≈ 200 (+ terms NF) |

Reconciliation with Phase 0: R5 estimated Google ≈ USD 360/month at pilot (≈ USD 0.034/trip above free, blended across four 10K free buckets). This plan's ≈ USD 450 differs only by the explicit split in A3 (60,000 route calls against a single 10K free bucket). Both are ESTIMATES; neither is a quote.

### 7.3 FD-14 envelope check (pilot)

The Phase-0 pilot stack totals **≈ USD 250–300/month with maps at USD 0** (compute ≈ 70, database ≈ 25, OTP ≈ 135–155, KYC 0–95, other ≈ 2–21; `docs/phase0/PHASE0_COST_PROVIDER_MATRIX.md` §3). The envelope therefore has **≈ USD 0 of planned geo headroom**; any recurring geo cost is only absorbable if another line comes in below estimate.

| Bundle | Pilot geo ESTIMATE | Fits FD-14 without FA-08? |
|---|---|---|
| S1 | ≈ 275–1,200 (+0 to ≈ 170 abandoned-session sensitivity), depending on PAYG vs subscription and Essentials vs Pro routes; lowest modelled ≈ 275–375 (Essentials subscription, Essentials routes) | **Not without FA-08** — every modelled variant exceeds the ≈ USD 0 geo headroom; no model alone declares Google affordable or unaffordable (CON-P3-04) |
| S2 | ≈ 38–325 by explicit billing mode (standard Search Box sessions ≈ 316–325; preview ≈ 89; temporary-geocoding autocomplete ≈ 38) **plus an unknown Commercial Application License cost if applicable** | **Not determinable** until the billing mode is fixed and FA-19 (Mapbox commercial/legal confirmation) is answered; no pilot/production S2 freeze before that |
| S3 | ≈ 0–25 + ops time | Yes (if the shared VPS has capacity — measure in SP-04 geo-bench profile) |
| S4 / S4c | NF / ≈ 200 | S4 unknown; S4c no |

FD-14 is a provisional planning envelope, not a purchase authorisation and not a guarantee of actual cost.

### 7.4 Scale (150,000 trips/month), per bundle

| Bundle | Arithmetic (ESTIMATE, first-tier list prices; volume tiers NF) | USD/month |
|---|---|---|
| S1 Google (Essentials, PAYG) | Place Details (300,000 − 10,000) × 5/1,000 = 1,450 · Geocoding (300,000 − 10,000) × 5/1,000 = 1,450 · Routes (600,000 − 10,000) × 5/1,000 = 2,950 | **≈ 5,850** (Pro routes: routes (600,000 − 5,000) × 10/1,000 = 5,950 → ≈ 8,850) |
| S1 Google (subscription) | Essentials USD 275 covers 100,000 of 1,200,000 calls; 1,100,000 over the limit at standard PAYG first-tier prices ≈ 5,500 → ≈ 5,775; Pro USD 1,200 covers 250,000; 950,000 over ≈ 4,750 (Essentials-priced) → ≈ 5,950 | **≈ 5,775–5,950** — subscriptions do not materially change the scale estimate at list prices; volume discounts / Enterprise pricing NF (sales) |
| S2 Mapbox (standard pricing) | MAU example 60,000: (60,000 − 25,000) × 4/1,000 = 140 · Search Box sessions 300,000, tiered: 97,500 × 11.50 + 100,000 × 10.00 + 100,000 × 8.40 (per 1,000) = 2,961.25 · temporary reverse (300,000 − 100,000) × 0.75/1,000 = 150 · Directions tiered: 400,000 × 2.00 + 100,000 × 1.60 (per 1,000) = 960 | **≈ 4,211** + licence (FA-19); preview session pricing (99,500 × 3.00 + 200,000 × 2.75 per 1,000 = 848.50) → ≈ 2,099; temporary-geocoding autocomplete variant (1,500,000 temporary geocodes, tiered = 825) → ≈ 1,925 |
| S3 Open | dedicated geo instance(s), ≥ 2 for availability (R5 Hetzner range €16–49 each, not re-verified) + tile storage/ops | **≈ 40–110** + operations time |
| S4 | NF | NF |

Phase-0 R5 scale estimates were Google ≈ USD 4,460–4,500 and Mapbox ≈ USD 950; the differences come from the call split (A3), the corrected Search Box session pricing (A9, plan-review closure 2026-10-12: the earlier draft wrongly applied the request-row allowance and rate to sessions) and are within the uncertainty of an unmeasured call mix. SP-04 does not measure production call mix; the pilot's own usage rollups (`geo.provider_usage`) will.

### 7.5 Levers that change the estimate

- **Quote-to-trip ratio.** Riders who check prices and do not book add route calls. At 2 quotes per trip, pilot route calls rise by 15,000/month (S1 +USD 75; S2/S3 ≈ 0).
- **Caching** (bounded by §8). Popular destinations (airport, major markets, hospitals) repeat; Google allows a 30-day temporary coordinate cache, Mapbox temporary geocoding allows none, open stack allows all.
- **Session discipline.** Debounce 300 ms, minimum 3 characters, session tokens (Google), resolve only on selection.
- **Hard caps.** Per (provider, SKU) daily/monthly budgets in Valkey counters with 50/80/100 % signals and refusal at 100 %, plus vendor-console hard quotas (founder action FA-06).

## 8. Cacheability per vendor (terms-derived TTL)

The configured TTLs are **maxima**. Each adapter declares a terms-derived TTL ≤ the configured maximum; where terms forbid or are unknown, TTL = 0.

| SKU | Configured maximum | Google | Mapbox | Open stack (own data) | TomTom / HERE |
|---|---|---|---|---|---|
| Autocomplete predictions | 24 h | **0** (predictions not cacheable unless terms allow; V) | **0** for temporary geocoding (V); Search Box NF → 0 | 24 h (freshness only) | NF → 0 |
| Place resolution (coordinates) | 7 days | ≤ 30 days shared temporary cache permitted for lat/lng (V) → cap at the configured 7 days; `place_id` storable indefinitely (V) | 0 (temporary); permanent geocoding storable but paid (V) | 7 days | NF → 0 |
| Forward geocode | 7 days | ≤ 30 days → 7 days; indefinite only per-user isolated (6.3.2), never shared (V) | 0 (temporary) | 7 days | NF → 0 |
| Reverse geocode | 7 days, key rounded to 4 dp | same as forward (V reading; reverse SKU naming NF) | 0 (temporary) | 7 days | NF → 0 |
| Route | 10 min, 15-min time bucket | lat/lng ≤ 30 days (V); route-result caching specifics NF → **0 until the Routes terms are read at P3.7** | NF → 0 | 10 min | NF → 0 |
| Tiles (device) | SDK cache ≤ 50 MB (budgets doc) | SDK-managed per Google terms (NF detail) | SDK-managed (NF detail) | SDK cache; self-hosted HTTP cache headers | NF |
| Stale-serve | autocomplete/reverse only, ≤ 2× TTL | not allowed beyond terms (TTL 0 ⇒ no stale) | not allowed (TTL 0) | allowed (configured maximum) | not allowed |

Route snapshots stored on a quote (`pricing.route_snapshots`, purged after 30 days) are a **pricing record**, not a reusable cache. The snapshot keeps the Wayvro-derived `distance_m`/`duration_s` used for pricing; its polyline is stored only when the geometry is open-licensed (S3) or the bound vendor's terms permit storing it. Storing Google- or Mapbox-derived route geometry in the 30-day snapshot is a **COUNSEL/terms item** (CONTRACTUAL; Google lat/lng 30-day limit is compatible on its face; polyline storage NF) decided at P3.7; until confirmed, that vendor's geometry follows its terms-derived TTL (NULL at insert when the TTL is 0). Re-deriving or "simplifying" vendor geometry to escape a storage restriction is **not** an acceptable workaround.

## 9. Rate limits

| Vendor | Known limits (conf.) | Wayvro control |
|---|---|---|
| Google | per-API quotas configurable in Cloud Console (defaults NF); billing caps via quotas, not hard spend caps (S) | founder sets daily quotas ≈ free tier during evaluation (FA-06) |
| Mapbox | Directions 300 requests/min (V); geocoding/Search Box limits NF | adapter-side token bucket below vendor limit |
| OpenFreeMap public | no SLA; rate policy NF | do not depend on it in production |
| Nominatim public | 1 req/s per app, autocomplete prohibited (V) | not used |
| Self-hosted OSRM/Photon | own capacity (measure in geo-bench) | same gateway limits |
| TomTom / HERE | NF | — |
| Wayvro gateway (all vendors) | proposed: quotes 20/min/account, 200/day/account, 60/min/IP-prefix; autocomplete 60/min/account; reverse 30/min/account; geo endpoints require a session | Valkey fixed-window limiter (existing `packages/server-runtime` RateLimiter) |

## 10. Privacy and data flows per vendor

Principles: providers are called by the **server**; no account id, phone or name is sent; autocomplete bias uses a coarse cell (~1.1 km); reverse-geocode coordinates sent at ≤ 5 dp; coordinates are never logged (existing pino redaction + new test). The device talks to a vendor **only** for map tiles/style (renderer).

| Vendor | Server-side calls: vendor learns | Client renderer/tiles: vendor learns | Telemetry / control | Data location |
|---|---|---|---|---|
| Google | Wayvro server IP, query text, coordinates (≤ 5 dp), session token, API key | device IP, device/SDK metadata, crash data, pseudonymous ID, map-interaction events (V, Google Maps SDK Android Play data disclosure 2026-10-08, seen 2026-10-12); tile requests reveal viewport (approximate user location) | SDK collection not user-configurable (NF for opt-out); must be declared in Play Data safety | Google global (NF per region); EG-12 review |
| Mapbox | server IP, query text, coordinates, access token | device IP, viewport tiles, **telemetry on by default** (V) | in-app telemetry opt-out mandatory (V) — Wayvro would default it OFF if technically allowed (NF) | NF; EG-12 |
| OpenFreeMap (public) | — | device IP, viewport tiles, user agent | logging policy NF | NF |
| Protomaps self-hosted on R2 | — | Cloudflare (already a planned Wayvro processor) sees device IP + byte ranges | Wayvro controls logs | Cloudflare global; EG-12 |
| Self-hosted OSRM/Photon | none (Wayvro infrastructure) | — | — | Wayvro host region (FD-03) |
| TomTom / HERE | server IP, query, coordinates | depends on renderer/tile choice | NF | NF |

Additional rules: geo route logs use route templates only (no query strings); autocomplete query text is not logged; harness raw responses never leave the founder's machine (SP-04 doc); vendor DPAs and subprocessor lists are founder/counsel items (EXTERNAL; `docs/phase0/PHASE0_SECURITY_PRIVACY.md` vendor/DPA rows, K22/Q44).

## 11. Adapter boundary — provider-specific type leakage rules

1. Vendor SDK/HTTP client packages and vendor response types exist **only** in the proposed server-only `packages/geo-adapters` (real adapters) and dev-only `@wayvro/provider-test-doubles` (synthetic doubles). Port types live in `packages/provider-interfaces` and are vendor-neutral.
2. Port results return Wayvro-normalised data with `GeoSourceMeta {providerKey (opaque, e.g. "geo-a"), sku, fetchedAt (server time), cacheStatus HIT|MISS|STALE_SERVED, latencyMs, confidence HIGH|MEDIUM|LOW|UNKNOWN, coverageNote code}`. No vendor enum, status string, place type or error message crosses the port.
3. Place references returned to clients are opaque AEAD-sealed `placeRef` tokens (provider id + expiry), never raw `place_id`s or Mapbox ids; the server rejects expired or foreign tokens.
4. Vendor errors map to stable Wayvro codes (e.g. ROUTING_UNAVAILABLE → 503 WAYVRO_E_DEPENDENCY_UNAVAILABLE); raw vendor messages are never returned or logged with user data.
5. Contracts (zod RouteContract) contain no vendor field names; OpenAPI regeneration (`packages/contracts/openapi/wayvro-api.v1.json`) must show no vendor names — a contract test greps the generated document for a vendor-name denylist.
6. The mobile app imports no geo vendor package outside `src/platform/maps/`; an architecture test (extending the existing banned-import test) enforces it. The renderer receives style/tile URLs and any client token from `GET /v1/app/config`, never hard-coded beyond what the chosen SDK unavoidably needs.
7. dependency-cruiser / eslint-plugin-boundaries rules (ADR-027) forbid `apps/*` domain/feature code importing `packages/geo-adapters`; only composition roots bind adapters (ADR-045 pattern; unbound routing port in production ⇒ quote refused, never invented values).
8. Price tables per adapter (micro-USD per call, dated, with source URL) are configuration, used only for usage metering — never for user-facing pricing.

## 12. SP-04 scoring rubric (APPROVED 2026-10-12 as pre-measurement values, FA-07)

### 12.1 Hard gates (a bundle failing any gate is not eligible, whatever its score)

| Gate | Rule | Evidence |
|---|---|---|
| G1 Terms compatibility | every SKU in the bundle is licence-coherent (§6); commercial use permitted; attribution implementable in the UI; **for S2, written Mapbox commercial/legal confirmation on whether the Commercial Application License (vehicle usage) applies to Wayvro Rider/Driver use (FA-19) — unresolved ⇒ no pilot/production S2 freeze** (SP-04 evaluation may still use a permitted evaluation/free account under its terms) | founder + counsel reading, dated |
| G2 Cost | pilot ESTIMATE within the FD-14 envelope, **unless FA-08** explicitly approves the extra spend for a demonstrated quality need; the estimate must name its billing mode (Google PAYG vs subscription plan; Mapbox Search Box sessions vs requests, standard vs preview) and include any applicable commercial licence (S2: FA-19) — public pay-as-you-go pricing is not treated as the complete production cost while FA-19 is open | §7 arithmetic re-run with prices re-verified at P3.7 |
| G3 Production reliability | a production path with an SLA or a Wayvro-operated, monitored, redundant host; **a free tier or no-SLA public instance is not a reliability strategy** (OpenFreeMap public, MapTiler free, vendor free tiers are acceptable for development and SP-04 only) | written SLA / hosting plan |
| G4 Accuracy floor and route safety | meets the SP-04 thresholds (benchmark doc §7; approved as pre-measurement thresholds, FA-07) or the founder accepts a documented shortfall with mitigation (aliases, pin); **and has no unresolved CRITICAL route invalidity** (benchmark doc §7.1: wrong-way on a one-way road, private/inaccessible segment used as normal routing, prohibited/closed passage, unsafe or physically impossible manoeuvre, systematic severe defect) — a critical case is cleared only by ground-truth correction, an evidence-backed provider/config/map-data correction followed by a re-run, or a founder-signed product mitigation proving the route is never presented or used; a high weighted score never offsets it | SP-04 evidence |
| G5 Privacy | no client SDK telemetry that cannot be disclosed or disabled as required; no account identifiers sent to vendors | inventory + adapter review |
| G6 Size/performance | renderer fits the SP-02 size budget (≤ 30.0 MB arm64-v8a download, PROPOSED) | SP-02 re-measure (P3.7) |

### 12.2 Weighted score (eligible bundles only)

| Criterion | Weight (PROPOSED) | Metrics (definitions in the benchmark doc §6) |
|---|---|---|
| Accuracy | **40** | geocode top-1/top-3 within 50 m (12), autocomplete correct place in top-5 incl. Roman-Urdu (10), route distance error (8), ETA error off-peak (8), route constraint plausibility (2) |
| Coverage / landmark usefulness | **20** | reverse-geocode usefulness ≥ 2 rate (12), empty/failure rate (5), Urdu-script result handling (3) |
| Cost | **20** | pilot ESTIMATE vs envelope (12), scale ESTIMATE (8) |
| Latency | **10** | p95 per SKU vs budgets |
| Terms / operational risk | **10** | caching freedom, lock-in/exit cost, ops burden for a one-person team, vendor stability |

Normalisation: each metric scores 0–100 as `100 × clamp((value − floor) / (target − floor), 0, 1)` where target = the approved threshold's ideal end and floor = an unacceptable value (e.g. geocode top-1: floor 50 %, target 90 %; distance error median: floor 25 %, target 3 %). The floors/targets are listed in the benchmark doc §7 and approved with FA-07.

Why these weights: accuracy dominates because a wrong pickup is a safety and trust failure, not a cosmetic one; landmark usefulness is weighted separately because Lahore addressing is landmark-first; cost has real weight because FD-14 is tight for a pre-revenue pilot; latency is mostly controllable by caching/region; ops risk matters for a solo-founder team. **Justification for a possible adjustment** (offered, not applied): if the founder prefers, raise terms/ops risk to 15 and reduce cost to 15 — the open stack's operational burden on one person is a real reliability risk that G3 only partly captures.

Tie rule: bundle score differences < 5 points, or accuracy differences not significant in a paired test (benchmark doc §9), are treated as ties and decided by G2 cost then terms/ops risk.

Per-SKU within a bundle: if a coherent bundle allows a choice (e.g. S2 Search Box vs temporary geocoding for autocomplete; S3 OSRM vs Valhalla; S3 Photon vs Nominatim for reverse), the same metrics choose the component.

## 13. Open-stack operational burden (S3, and S4 open components)

| Task | Burden | Notes |
|---|---|---|
| Pakistan OSM extract | download a regional extract (source and its licence terms to verify), checksum, version-stamp | ODbL data; record extract date in `GeoSourceMeta.coverageNote` |
| OSRM preprocessing | extract → partition → customize (MLD) per update; RAM/CPU sizing for a Pakistan extract NF — measure in the geo-bench compose profile (CON-P3-14) | rebuild off-box, swap atomically |
| Photon index | build/import a Pakistan-limited index (procedure and size NF) | Apache-2.0; JVM service |
| Update cadence | proposed monthly (weekly if field reports show stale roads); each update re-runs the SP-04 regression subset | automated job + manual approval |
| Tiles | OpenFreeMap public (dev) or self-hosted Protomaps PMTiles regenerated per extract; style JSON hosting | Cloudflare R2 range requests |
| Monitoring | health checks, latency, error-rate, disk; circuit breaker already in gateway | structured log signals (no metrics SDK, F-P3-05) |
| Availability | ≥ 2 instances or a documented degraded mode (autocomplete → "type full address / drop pin"; route refused ⇒ quote refused) | G3 |
| Security | patching, network exposure only to API host, no public endpoint | same as other infra |
| Attribution | "© OpenStreetMap" + ODbL link on the map; app-level credit for geocoder/router | ODbL guidelines (V) |
| Share-alike | Wayvro-curated `geo.landmark_aliases` combined with OSM data may form a Derivative Database — counsel reading before any alias data is derived from OSM | keep aliases founder/field-sourced |

## 14. What is frozen when

| Checkpoint | Frozen | Not frozen |
|---|---|---|
| P3.2 | vendor-neutral ports, `GeoSourceMeta`, `placeRef` format, gateway (rate limit, cache with per-adapter TTL ≤ configured maximum, budgets, circuit breaker, usage), synthetic doubles, SP-04 harness and capture tooling | any vendor |
| P3.5 | text-first/Lite rider search → quote flow on doubles (local/test only; MOCK refused outside local/test by ADR-045) | renderer |
| **P3.7** | **ADR-006 file created** with bundle + per-SKU choice as ACCEPTED-ON-EVIDENCE **only if** SP-04 evidence exists and gates G1–G6 pass; ADR-046 renderer freeze in the same step (coupled by CON-P3-16); production candidate adapters; SDK inventory regenerated | if SP-04 data is missing: **BLOCKED-EXTERNAL**; no adapter is bound in staging/production; quotes there return 503 ROUTING_UNAVAILABLE (never invented values) |
| P3.10 | inventory final, closure record | pilot volume pricing (Phase 7–8 re-verification) |

Re-opening: any later vendor change is a new ADR-006 revision with a re-run of the same SP-04 case list (benchmark doc §10).

## 15. Recommendation framing (hypotheses to test — NOT a decision)

- **H1.** Because the FD-14 envelope has ≈ USD 0 planned geo headroom, **S3 (Open)** is the cost baseline every other bundle must beat on quality. **S2 (Mapbox)** is no longer a low-cost default: at standard Search Box session pricing it is ≈ USD 316–325/month at pilot (≈ 38–89 only under a request-billed or preview variant), and it cannot be frozen for pilot/production until Mapbox confirms in writing whether the Commercial Application License for vehicle usage applies (FA-19).
- **H2.** **S1 (Google)** is selected only if SP-04 shows a quality gap on accuracy/landmark criteria large enough to justify its cost — ≈ USD 275–375/month at pilot on the Essentials subscription with Essentials routes, ≈ USD 450–1,200 under PAYG or Pro-route variants (≈ USD 5.8–8.9K at scale at list prices) — **and** the founder approves the spend (FA-08). Neither the PAYG nor the subscription model alone decides affordability.
- **H3.** S4/S4c are considered only if their terms are verified in writing; otherwise they are dropped without scoring.
- **H4.** Whatever wins, manual pin, landmark aliases and the landmark-first formatter remain required because no vendor is expected to resolve society plot addresses reliably (to be confirmed or refuted by C03 cases).

These are hypotheses. Writing them down does not bias scoring: the founder rates reverse-geocode usefulness blind to the vendor (benchmark doc §6).

## 16. Founder / external items from this document

| Item | Owner | Blocks |
|---|---|---|
| FA-06 evaluation accounts (Google billing account with hard quotas ≈ free tier; Mapbox free account; optional TomTom/HERE); keys only in local untracked env | founder | SP-04 candidate comparison |
| FA-07 weights, gates, floors/targets — **APPROVED 2026-10-12** as pre-measurement values, plus the route-critical hard gate (G4); changeable only through evidence + reviewed ADR update | founder | — (decided) |
| FA-19 Mapbox Commercial Application License (vehicle usage) applicability to Wayvro Rider/Driver use — written Mapbox sales/legal confirmation; no fee assumed | founder (+ counsel) | pilot/production S2 freeze (not SP-04 evaluation, not implementation) |
| FA-08 any paid geo spend beyond free tiers | founder | S1/S4c selection |
| Terms reading of the final bundle (map coupling, caching, snapshot retention, attribution, ODbL share-alike) | founder + counsel | ADR-006 ACCEPTED-ON-EVIDENCE |
| EG-12 data-location review for chosen vendors (`docs/phase2/PHASE2_EXTERNAL_GATES.md`) | counsel | real data (Phase 7) |
