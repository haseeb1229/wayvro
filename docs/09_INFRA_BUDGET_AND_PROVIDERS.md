# 09 — Provider Matrix, Free-Tier Facts, Hosting and Cost Control

**Important:** verified snapshot 2026-10-09. Always check official pricing/terms and account-specific availability before integrating or signing. Do not infer unrestricted production rights from 'free'.

**Phase 0 update (2026-10-09):** refreshed, sourced figures and the pilot/scale budgets are in `docs/phase0/PHASE0_COST_PROVIDER_MATRIX.md` (evidence `docs/phase0/research/R5`), which supersedes rows below where they differ. Notable corrections: Firebase Auth phone verification has been a paid (Blaze) feature since 2024 and its Pakistan per-SMS price is unverified; Twilio Pakistan SMS costs ≈ $0.47/segment, so a PTA-registered local gateway plus WhatsApp authentication templates are the OTP candidates (ADR-007); Neon Free scale-to-zero cannot be disabled; MinIO's upstream repository is reported archived (choose another S3-compatible local server under ADR-010).

| Need | Local/internal development | Candidate production | Caveat |
|---|---|---|---|
| PostgreSQL+PostGIS | Docker local | Managed Postgres with confirmed PostGIS or properly operated VPS | Neon free 1 GB/project as of 2026-10-02 is an experiment choice; validate PostGIS availability, uptime and support terms |
| Redis | Docker local | Small dedicated instance or managed Redis | Memory, persistence, availability and background workers must be budgeted |
| Map tiles | Local test with compliant/provider tokens | Mapbox/Google or licensed OSM-based host | OSM public tile servers not suitable as guaranteed ride-hailing backend |
| Route/geocode | Fixtures/provider sandbox | Google/Mapbox/provider with Pakistan accuracy tests | Calls billed per SKU, travel-time and matrix counts can rise rapidly |
| Mobile build | Android SDK local, EAS free quota | EAS Build / self-hosted signing CI | 2026 Expo Free: up to 15 Android + 15 iOS builds monthly, cloud queue; store fees separate |
| Push | FCM/APNs test | FCM/APNs | FCM no-cost; platform rate/availability apply |
| OTP/SMS | Provider test accounts + mock deterministic OTP | Contracted gateway (or Firebase Auth phone) | Verify Pakistan deliverability, sender approval, per-SMS charges, throttling and abuse; do NOT presume free production OTP |
| Email | Local mail catcher | Resend/transactional vendor | Resend Free advertised 3k/month and 100/day |
| Object storage | MinIO local | Cloudflare R2/compatible managed bucket | R2 Standard 10 GB-month included, operations billed after tier; sensitive docs require access controls |
| Telemetry | Structured local logs + OTel | Sentry/managed dashboards | Free quotas and privacy review |
| Frontend web | Local | Vercel-compatible paid commercial plan or VPS/container host | Check Vercel Hobby commercial-use eligibility before any commercial site |
| Backend + socket | Local Docker | Always-on cloud VM/container / managed app | A platform that sleeps is not suitable for dispatch, safety and SOS |
| Payments | Mock signed webhooks/cash ledger | Bank/EMI/PSP with written merchant terms | Onboarding/KYC and transaction fees unavoidable |
| Support/SOS | Tested mocked flows | Real staffed support and approved emergency contacts | Human resource cost is NOT a cloud free-tier problem |

## Official pricing/terms references
- Neon: https://neon.com/blog/neon-free-plan-1-gb-per-project
- Mapbox: https://www.mapbox.com/pricing
- Google Maps: https://developers.google.com/maps/billing-and-pricing/overview
- Expo: https://expo.dev/pricing
- Firebase phone/FCM: https://firebase.google.com/docs/auth/limits and https://firebase.google.com/pricing
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing/
- Resend: https://resend.com/pricing
- OpenStreetMap tiles: https://operations.osmfoundation.org/policies/tiles/
- GitHub Pack changelog: https://github.com/github-education-resources/Student-Developer-Pack-Current-Partners-FAQ/blob/main/SDP-changelog.md (DigitalOcean credits sunset July/Aug 2026)

## Cost model to build before pilot (spreadsheet/report)
**One-time:** incorporation, compliance/legal, branding/domain/trademark review, app accounts, insurance, driver checks, devices, initial marketing, training, support setup, contingency.
**Monthly fixed:** hosted always-on backend, DB/Redis/backups/storage, observability, domain, support/on-call, employees/contractors, insurance and accounting.
**Per activity:** OTP, geocode/route/map/navigation, payment gateway, chargebacks, SMS/calls, map impressions, support case, promotion, driver payout, field verification, fraud and incident costs.

Define a cost-per-successful-trip formula using actual production probes. Set budget alerts at 50/80/100%, per-user/IP quotas, and rate-limiting. Budget alerts are not hard spend caps; set actual API quotas and provider account restrictions. All third-party accounts and payment methods remain in founder/company custody.

## Local laptop
HP EliteBook 1040 G8 i5, 16 GB RAM, ~300 GB free: acceptable for incremental coding, one Android device / constrained emulator plus API/PostGIS/Redis, and small CI tasks. Avoid spinning up resource-intensive load tools, heavy iOS simulators, many docker profiles at once. Windows + WSL2 disk/memory tuning; real Android hardware strongly recommended. iOS releases can use cloud macOS builds; App Store requires Apple program membership and review.

## Public launch budget caveat
Free cloud quota may cover initial prototypes and some services, but public ride-hailing demands reliable hosted availability, proper testing, staffed support, legal approvals and money for customer/driver acquisition. Separate 'zero software license' from 'zero operating cost'.

## Additional official provider caveats verified October 2026
- **Vercel Hobby is explicitly personal/non-commercial only** (https://vercel.com/docs/plans/hobby and https://vercel.com/docs/limits/fair-use-guidelines). Do not use for a monetized production company site even at zero customers.
- **GitHub Student Pack currently advertises** Azure for Students $100 credit and selected services (subject to eligibility and commercial/service terms) and Heroku $13 monthly credits for up to 24 months; these are temporary discounts, not lifetime production infrastructure entitlements. Source: https://education.github.com/pack . Check commercial eligibility and the developer's own account before relying on benefits.
- **Google Play developer registration:** USD $25 one-time, subject to identity/application review; https://support.google.com/googleplay/android-developer/answer/6112435 . Organisation account may involve D-U-N-S verification.
- **Apple Developer Program:** USD $99 per membership year in many regions (local pricing varies), https://developer.apple.com/programs/ . Organisation enrollment needs verified legal identity and may require D-U-N-S.
