# Phase 0 research evidence R5 — Infrastructure / vendor cost research (observed 2026-10-09)

**Provenance:** produced by a Claude research subagent during Phase 0. "Official" = vendor pricing/docs page fetched directly; "3P" = third-party pricing trackers (several conflict). FX assumption ~PKR 280/USD (UNVERIFIED). Prices exclude VAT/taxes. Feeds `PHASE0_COST_PROVIDER_MATRIX.md`, ADR-006/007/010/024/028.

## Master table

| Need | Dev/free option | Production option | Free quota | Commercial OK? | Sleeps? | Nearest region | Pilot (50 drivers, 500 trips/day) | 5,000 trips/day | Exit path | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| Postgres+PostGIS | Neon Free | Neon Launch (scale-to-zero disabled) or Supabase Pro or DO Managed PG | Neon: 100 CU-h/project/mo, 1 GB/project, 20 GB acct; Supabase: 2 projects, 500 MB | Not addressed on pricing pages (no prohibition seen) | Neon Free: suspends after 5 min, "cannot be turned off"; Supabase Free: paused after 1 week inactivity; paid plans don't pause | Neon: AWS Singapore; Supabase: Mumbai/Singapore (3P); DO: Bangalore (UNVERIFIED) | Neon ~$20–30 (0.25 CU always-on); Supabase Pro $25; DO $15.15 | $60–150 | pg_dump/logical replication | neon.com/pricing; supabase.com/pricing (official) |
| Redis | Upstash Free | Self-hosted on VPS, or Upstash Fixed 250 MB | 256 MB, 500K cmds/mo, 10 GB BW | Not stated | No | Mumbai/Singapore | Self-host $0; Upstash Fixed $10/mo (location pings blow through 500K/mo) | Self-host $0; Upstash PAYG ≈ $60 | RDB/AOF dump | upstash.com/pricing/redis (official) |
| Backend (API+worker+WS) | Render Free / Railway trial / Fly trial | Hetzner Cloud VPS (SIN or EU), DO droplet, or Railway Hobby | Render: 750 inst-h/mo, sleeps 15 min; Railway: $5 trial; Fly: trial only | Render free sleeps; Hetzner/DO yes | Render Free yes; others no | Hetzner SIN1, DO BLR1, Fly bom/sin, Render Singapore | Hetzner SIN CPX22 (2 vCPU/4 GB) €26.49 (~$31); EU CX23 €5.49/CPX22 €19.49 | 2× CPX32 SIN €48.99 each ≈ $115 | Docker images | docs.hetzner.com price-adjustment (eff. 15 Jun 2026); render.com/docs/free |
| Object storage (KYC docs) | Cloudflare R2 Free | R2 (or B2) | R2: 10 GB-mo, 1M Class A, 10M Class B, egress $0 | Yes | No | Cloudflare global (APAC hint) | $0 | ~$1–5 | S3 API → rclone | developers.cloudflare.com/r2/pricing (official) |
| Maps/routing | MapLibre + OpenFreeMap tiles + self-hosted OSRM/Valhalla | Same, or Mapbox; Google only if budget | Google: 10K free calls/SKU/mo (Essentials); Mapbox: 25K MAU, 100K Directions, 100K Matrix elements | Google/Mapbox yes; MapTiler & Stadia free = non-commercial; OpenFreeMap unlimited (donation-run, no SLA) | n/a | global edge | Self-host ~$0 (VPS €8–16); Mapbox ≈ $0; Google ≈ $360/mo | Self-host ~$20 VPS; Mapbox ≈ $950; Google ≈ $4,500 (+Nav SDK ≈ $3,600) | Vendor behind adapter | mapsplatform.google.com/pricing (official); Mapbox 3P |
| OTP SMS | Firebase phone auth (Blaze) / Twilio trial | Local PK gateway (shortcode) or WhatsApp auth template | Twilio: none; WhatsApp: none; Firebase: 10 SMS/day test numbers | Yes (sender-ID registration needed) | n/a | n/a | ~9K OTP/mo: WhatsApp ≈ $135; SendPK shortcode Rs 4.8 ≈ PKR 43K (~$155); Twilio $0.4734×9K ≈ $4,260 (avoid) | ~90K/mo: WhatsApp ≈ $1,350; local ≈ PKR 430K (~$1,550) | Multi-provider adapter | twilio.com/en-us/sms/pricing/pk (official); sendpk.com/price.php (vendor); Meta pricing docs |
| KYC/liveness (CNIC) | Didit free tier (500/mo claimed) / vendor sandboxes | Shufti Pro (PK-founded) or Sumsub/Veriff/iDenfy | Didit 500/mo; Shufti 10/mo free (3P) | Yes | n/a | Vendor cloud (EU/UK/US); PK residency UNVERIFIED | <$50 | $165–$700 | Adapter | 3P comparisons; didit.me |
| Email | Resend Free | Resend Pro $20 / Brevo / SES | Resend 3,000/mo (100/day); SES 12-mo free tier ended for new accounts 21 Jul 2026 (3P) | Yes | n/a | global | $0 | $20 | SMTP/API swap | resend.com/blog/new-free-tier |
| Observability | Sentry Dev + Grafana Cloud Free | same + paid | Sentry: 5K errors, 5M spans, 50 replays; Grafana: 10K series, 50 GB logs/traces, 14-day retention; Axiom 500 GB/mo | Yes | n/a | Grafana AP region available | $0 | ~$50–100 | OTel-native | 3P |
| Mobile builds | Expo EAS Free | EAS Starter $19 / Production $199 | 15 Android + 15 iOS builds/mo, 1,000 Update MAU | Not stated | n/a | n/a | $0–19; Apple $99/yr; Google $25 once | $19–199 | Local/GitHub-Actions builds | expo.dev/pricing (official) |
| CI/security | GitHub Free | GitHub Free + OSS tools | 2,000 Actions min/mo private; Dependabot free; CodeQL private needs GHAS ($30/committer/mo) | Yes | n/a | n/a | $0 (Semgrep CE, gitleaks, Trivy, Knip) | $0–30 | Standard workflows | docs.github.com (3P-relayed) |
| Domain/DNS/CDN | Cloudflare Free | same | DNS, CDN, WAF basics, Workers 100K req/day | Yes | n/a | global | .pk Rs 2,100/yr (PK registrant) via PKNIC; .com ~$10–15/yr | same | DNS export | pknic.net.pk (official, +Rs 300 on 1 Aug 2026) |
| Status/uptime | UptimeRobot / Better Stack / Instatus Free | same | UptimeRobot 50 monitors @5 min + 1 status page; Better Stack 10 monitors; Instatus 15 monitors | UptimeRobot free: commercial allowed since May 2026 (3P, conflicting) | n/a | n/a | $0 | $0–20 | trivial | 3P |

## Per-category notes

### 1. Managed Postgres + PostGIS
- **Neon** (official): Free = 100 CU-hours/project, 1 GB/project, 20 GB account; scale-to-zero after 5 min "cannot be turned off" on Free; Launch $0.106/CU-hour, $0.35/GB-month, scale-to-zero can be disabled. PostGIS via `CREATE EXTENSION postgis`. Region AWS Singapore; cannot be changed after creation. Launch with scale-to-zero disabled is a credible low-cost production DB (~$20–30/mo at 0.25 CU).
- **Supabase** (official): Free projects paused after 1 week inactivity, 2 active projects, 500 MB; Pro from $25/month, not paused. Mumbai/Singapore. PostGIS available.
- **Render**: free Postgres expires 30 days after creation. Not for production. **Railway**: Hobby $5/mo incl. $5 usage; Singapore region. **Fly.io Managed Postgres**: Basic $38/mo. **DigitalOcean Managed PG**: from $15.15/mo. **Crunchy Bridge**: Hobby not for production. **Aiven Free**: shut down after inactivity. **AWS RDS** db.t4g.micro Mumbai ≈ $15/mo; new AWS accounts get credits instead of 12-month free tier.
- **Suitable for production dispatch (no sleeping):** Neon Launch (scale-to-zero off), Supabase Pro, DO Managed, RDS, self-managed on Hetzner/DO. **Not suitable:** Neon Free, Supabase Free, Render Free, Aiven Free.

### 2. Redis
- **Upstash** (official): Free 256 MB, 500K commands/mo; PAYG $0.20/100K commands; Fixed 250 MB $10/mo. Mumbai + Singapore. Driver location pings at 50 drivers × every 5 s ≈ 26M commands/mo → PAYG ≈ $52/mo; use Fixed or self-host.
- **Redis Cloud Free**: 30 MB, 30 connections. Dev only. **Self-host** on the API VPS recommended at pilot.

### 3. Always-on hosting + latency
- **Hetzner** (official, effective 15 Jun 2026, excl. VAT & IPv4): EU: CX23 €5.49, CX33 €8.49, CX43 €15.99, CPX22 €19.49, CPX32 €35.49, CAX11 (ARM) €5.99, CCX13 €42.99. **Singapore:** CPX12 €15.49, CPX22 €26.49, CPX32 €48.99, CCX13 €53.99; SIN included traffic small (0.5–1 TB), overage ~€7.40/TB. Product page showed CX/CPX "currently unavailable" on 2026-10-09 — stock-limited.
- **DigitalOcean**: $4/$6/$12/$24 droplets; flat across regions. **Lightsail**: $5; Mumbai half transfer allowance. **Fly.io**: no free tier; shared-cpu-1x 1 GB in sin ≈ $8.50/mo. **Oracle Always Free**: ARM allowance reportedly halved mid-2026; idle reclamation; Mumbai ARM capacity chronically exhausted — **not credible for production dispatch.** **Azure for Students**: $100 credit (12 months).
- **Latency (estimates):** Bahrain ~40–60 ms; Singapore ~80–120 ms; Mumbai often routed via Singapore at 100–150 ms from Lahore; Frankfurt 130–180 ms (UNVERIFIED). Measure from Lahore before committing. No major provider lists a Pakistan region.

### 4. Object storage
- **R2** (official): 10 GB-month, 1M Class A, 10M Class B free; then $0.015/GB-mo; no egress charges.
- **Backblaze B2**: $6.95/TB-mo (May 2026, 3P), 10 GB free. **Hetzner Object Storage**: EU locations only. **MinIO**: AGPLv3; upstream repo reportedly archived in 2026 (3P) — avoid for new deployments; use an alternative S3-compatible local server for tests.
- **KYC suitability**: private bucket, pre-signed short-TTL URLs, SSE + application-layer encryption of CNIC/selfie objects, separate bucket per data class. PK has no enacted cloud residency law confirmed (see R2 §B).

### 5. Maps
- **Google** (official): 10K free calls per SKU monthly (Essentials). Per-1K: Dynamic Maps $7; Geocoding $5; Compute Routes Essentials $5; Route Matrix same; Autocomplete $2.83; Navigation SDK $25/1K destinations. Mobility Services pricing not public.
- **Mapbox** (3P): 25K MAU free Maps SDK; Directions 100K free then $2/1K; Matrix 100K elements free; Geocoding 100K free then $0.75/1K; Navigation SDK 100 MAU + 1,000 trips free, then $0.30/MAU + $0.08/trip.
- **Open stack**: OpenFreeMap (unlimited, donation-run, self-hostable), Protomaps self-hosted PMTiles, MapTiler Free and Stadia Free are **non-commercial**. OSRM/Valhalla/GraphHopper self-host on a Pakistan extract; Lahore OSM road completeness not quantified — run Osmose/Kontur checks. Geocoding = self-host Nominatim/Photon (POI coverage risk).
- **HERE**: ~30K transactions/mo free (3P). **TomTom**: 2,500 non-tile + 50K tile req/day. **OSM tile policy**: tile.openstreetmap.org is not for production apps.
- **Per-trip estimate (8 events):** Google ≈ $0.034/trip above free (≈ $360/mo at 15K trips, ≈ $4,460/mo at 150K); Mapbox ≈ $0 at pilot, ≈ $0.006/trip at scale; self-hosted ≈ $0 marginal + VPS.

### 6. OTP/SMS Pakistan
- **Twilio** (official PK page): outbound $0.4734/segment; no local PK numbers; "two-way SMS supported: No". Prohibitively expensive for OTP.
- **Plivo**: ~$0.34–0.47/SMS. **Vonage/Bird/Infobip/Telesign**: PK rates not retrieved — UNVERIFIED.
- **Local gateways**: SendPK lists Branded SMS Rs 3.80–3.90, Short-code OTP Rs 4.70–4.80, mask registration Rs 5,000 (vendor pages). Eocean/BrandName/Jazz Business rates not published. Branded sender ID: Jazz/Zong honour alphanumeric; Telenor/Ufone overwrite to shortcode; registration 2–4 weeks, needs PK company + NOC docs.
- **Firebase phone auth**: Blaze required since Sep 2024; PK per-SMS price not found — UNVERIFIED; 3P catch-all $0.06.
- **WhatsApp auth template**: Meta per-message since 1 Jul 2025; PK authentication reportedly $0.015 (Meta page shows an increase; effective date conflict between sources — use Meta CSV rate card). Authentication-International $0.075 for PK.
- **Call masking**: Twilio PK voice numbers availability UNVERIFIED; aggregators quote PK DIDs ~$42.50/mo with 10–15 day KYC (3P); PTA requires LDI-licensed termination. Practical path: in-app VoIP (WebRTC) + fallback to a local licensed CPaaS.

### 7. KYC with CNIC
Published list prices (3P/vendor): Didit $0.33 bundle (500 free/mo, claims CNIC/NICOP Urdu OCR); Shufti Pro Essentials $0.95/check; Veriff $0.80–1.89 + monthly; iDenfy $1.35; Sumsub $1.35 ($149/mo min); Onfido/Jumio/HyperVerge/Regula quote-only; Persona from $250/mo. CNIC OCR support confirmed in marketing only for Didit and Shufti — verify with sandbox. NADRA Verisys accessible only via licensed institutions. All are EU/US-hosted; get DPA in writing.

### 8. Email
Resend Free 3,000/mo capped 100/day (official); Postmark 100/mo; Brevo 300/day; SES $0.10/1K, 12-month free tier closed to new accounts from 21 Jul 2026 (3P). Use Resend free → Pro $20.

### 9. Observability
Sentry Developer: 1 user, 5K errors, ~5M spans, 50 replays (3P). Grafana Cloud Free: 10K series, 50 GB logs/traces/profiles, 14-day retention, 3 users. Better Stack Free: 10 monitors, 1 status page. Axiom: 500 GB/mo ingest. Highlight.io acquired by LaunchDarkly — avoid. All OTel-compatible except Sentry (SDK-based; has OTel bridge).

### 10. Mobile builds
Expo (official): Free 15 Android + 15 iOS builds, low priority, 45-min timeout, 1,000 Update MAU; Starter $19; Production $199; overage $1–4/build. Codemagic: 500 macOS M2 min/mo free. GitHub Actions: 2,000 min/mo private (macOS = 10× multiplier). Apple $99/yr; Google Play $25 one-time (+12 testers/14-day closed test for personal accounts). TestFlight/Firebase App Distribution free.

### 11. CI/security
GitHub Free private: 2,000 Actions min, Dependabot alerts; CodeQL on private repos needs Team/Enterprise + Code Security $30/committer/mo. Free substitutes: Semgrep CE, Snyk Free (5 projects), gitleaks, Trivy, Knip — all OSS/free.

### 12. GitHub Student Developer Pack
DigitalOcean withdrew; credits expired 31 Jul/1 Aug 2026. Still listed: Azure for Students $100, Heroku $13/mo × 24 months, Namecheap .me 1 year, Copilot. Partner offers carry partner terms; community guidance says non-commercial/educational — do not build production billing on it.

### 13. Domain/DNS/CDN
Cloudflare Free: DNS, CDN, basic WAF, Workers 100K req/day, Pages 500 builds/mo. PKNIC (official): .pk Rs 2,100/yr for PK registrants from 1 Aug 2026, $15.99/yr overseas, billed biennially. .com ~$10–15. DMARC: Cloudflare DMARC Management (free).

### 14. Status page/on-call
UptimeRobot Free: 50 monitors @ 5 min, 1 status page. Instatus Free: 15 monitors @ 2 min. Better Stack Free: 10 monitors, 1 status page. Phone/SMS paging is paid everywhere.

## Two-tier budget

**(a) Dev/staging ≈ $0–20/mo.** Neon Free (Singapore) + Upstash Free + R2 Free + Render Free web service (accept sleeping) or Railway trial + OpenFreeMap/MapLibre + self-hosted OSRM on a Hetzner EU CX23 (€5.49, optional) + Resend Free + Sentry Dev + Grafana Free + EAS Free + GitHub Free + Cloudflare Free + UptimeRobot Free. One-off: Google Play $25; Apple $99/yr. No real SMS (test numbers), KYC vendor sandbox only.

**(b) Minimum credible production (pilot: 50 drivers, 500 trips/day ≈ 15K trips/mo):**
- Compute: Hetzner SIN CPX32 (4 vCPU/8 GB) €48.99 ≈ $58 — runs API, worker, WebSocket, Redis, OSRM in Docker; +20% backups ≈ $12. (EU CPX22 at €19.49 saves ~$35 if 150 ms latency acceptable.)
- Postgres: Supabase Pro $25 (Mumbai) or Neon Launch ~$25 always-on (Singapore).
- Storage: R2 $0. Email $0. Observability/uptime $0. CI $0. Domain/DNS ~$2. EAS $0–19.
- OTP: ~9K/mo via WhatsApp auth ≈ $135 or local shortcode ≈ $155 (sender-ID registration Rs 5,000 one-off).
- Maps: $0 self-hosted (or Mapbox ≈ $0; Google ≈ $360).
- KYC: 50–100 drivers ≈ $0–95.
- **Fixed ≈ $100–120/mo; with OTP + KYC ≈ $250–300/mo; add ~$360 if Google Maps.**

**At 5,000 trips/day (≈150K trips/mo):** compute ≈ $115–130; DB ≈ $60–150; R2 ≈ $5; Mapbox ≈ $950 (or Google ≈ $4,500, or self-host ≈ $40); OTP ≈ $1,350–1,550; KYC ≈ $165–700; EAS/obs/email ≈ $70–150. **≈ $2.0–2.9K/mo on the open-maps stack; ≈ $6.5K+/mo on Google Maps.** SMS/WhatsApp and maps dominate; compute stays under 10%.

**Key cautions:** (1) Hetzner CX/CPX showed "currently unavailable" on 2026-10-09; (2) Twilio SMS at $0.47 is a non-starter for PK OTP; (3) Oracle free ARM unsuitable for dispatch; (4) MapTiler/Stadia free tiers are non-commercial; (5) PK call masking has no confirmed Twilio path; (6) Firebase PK SMS, Infobip/Vonage PK, DO Bangalore, EC2 Mumbai/Bahrain, and Lahore→region latency figures are UNVERIFIED.
