# PHASE0_COST_PROVIDER_MATRIX — Free/paid limits and the production transition

**Date:** 2026-10-09 · **Status:** Phase 0 deliverable (plan-only) · **Evidence:** `docs/phase0/research/R5_PROVIDER_COST_RESEARCH_2026-10-09.md` (official pricing pages where fetched; third-party trackers marked 3P), R3 (payments), R4 (mobile). FX assumption ~PKR 280/USD (UNVERIFIED). **Free tier is not a reliability strategy** (docs/00 hard stop; RSK-010). No provider account is created or billed in Phase 0 (docs/13).

This document supersedes the figures in `docs/09_INFRA_BUDGET_AND_PROVIDERS.md` where they differ; docs/09 keeps the principles and the laptop/budget caveats.

## 1. Environment separation (requirement I01)

| Tier | Purpose | Data | Providers | Monthly estimate |
|---|---|---|---|---|
| **Local** | developer laptop (HP EliteBook 1040 G8, 16 GB) | synthetic only (I02) | Docker: Postgres 17 + PostGIS 3.5, Redis 7, S3-compatible local server, mail catcher, signed-webhook mocks, deterministic OTP mock (test-only build) | $0 |
| **Dev/staging (shared)** | integration/E2E, device testing, founder/ChatGPT review | synthetic | Neon Free (Singapore) or Supabase Free; Upstash Free; R2 Free; Render Free web service (sleeps — acceptable only for staging) or Hetzner EU CX23 (€5.49); OpenFreeMap tiles + self-hosted OSRM; Resend Free; Sentry Dev; Grafana Cloud Free; EAS Free; GitHub Free; Cloudflare Free; UptimeRobot Free | **$0–20** |
| **Production (pilot, Phase 7–8)** | 50 drivers, ~500 trips/day | real, minimal | see §3 | **≈ $250–300** (≈ $100–120 fixed + OTP + KYC); + ≈ $360 if Google Maps |
| **Production (5,000 trips/day)** | city growth | real | see §3 | **≈ $2.0–2.9 K** (open-maps stack) / ≈ $6.5 K+ (Google Maps) |

Paid provider accounts stay in founder/company custody (T06/Q43); nothing is provisioned before founder authorisation.

## 2. Provider matrix

| Need | Dev/free | Production candidate | Free quota (official unless 3P) | Commercial OK? | Sleeps? | Region | Breakpoint / exit |
|---|---|---|---|---|---|---|---|
| **Postgres + PostGIS** | Neon Free (100 CU-h, 1 GB/project; suspends after 5 min, cannot be disabled) | **Neon Launch** with scale-to-zero disabled (~$20–30/mo at 0.25 CU, AWS Singapore) or **Supabase Pro** ($25, Mumbai/Singapore) or DO Managed ($15.15) or self-managed on VPS | as stated | not prohibited | Free tiers yes; paid no | SIN / BOM | Exit: pg_dump/logical replication; PostGIS is standard everywhere. **Never** Neon Free/Supabase Free/Render Free/Aiven Free in production |
| **Redis** | Upstash Free (256 MB, 500 K cmds/mo) | self-hosted Redis on the API VPS (recommended at pilot) or Upstash Fixed 250 MB $10 | 500 K cmds/mo is exhausted by ~50 drivers pinging every 5 s (≈ 26 M/mo) | n/s | no | BOM/SIN | Exit: RDB/AOF dump |
| **API + worker + WebSocket** | Render Free (sleeps 15 min) / Railway trial | **Hetzner Cloud VPS** SIN CPX22 €26.49 → CPX32 €48.99 (stock-limited on 2026-10-09) or EU CPX22 €19.49 (+latency); DigitalOcean $12–24; Fly.io sin ~$8.50 (no free tier) | n/a | yes | Render Free yes — **unsuitable for dispatch/SOS** | SIN1 / BLR1 / FRA | Docker images; ADR-028 decides VPS-compose vs PaaS |
| **Object storage (KYC evidence)** | Cloudflare R2 Free (10 GB, egress $0) | R2 ($0.015/GB) or Backblaze B2 | as stated | yes | no | global (APAC hint) | S3 API; **MinIO upstream reportedly archived (3P) — use another S3-compatible local server (ADR-010)** |
| **Map tiles / geocode / routing** | MapLibre + OpenFreeMap tiles + self-hosted OSRM/Valhalla + Nominatim/Photon | **Spike SP-04 decides:** Mapbox (25 K MAU, 100 K Directions free; ≈ $0 pilot, ≈ $950/mo at scale) vs Google (10 K free calls/SKU; ≈ $360 pilot, ≈ $4.5 K at scale) vs open stack (≈ $0 marginal) | per SKU | Google/Mapbox yes; MapTiler/Stadia free are **non-commercial**; OSM public tiles prohibited | n/a | edge | Provider adapter (E06); ≈ 8 calls/trip assumption |
| **OTP SMS** | mock only; Firebase test numbers | **Local PK gateway shortcode** (≈ Rs 4.7–4.8/OTP, mask registration Rs 5,000, 2–4 weeks, needs company + NTN) **+ WhatsApp authentication template** (≈ $0.015/msg reported) as fallback; Twilio PK $0.4734/segment is a non-starter | none | yes (PTA sender registration) | n/a | n/a | Multi-provider adapter (ADR-007); ≈ $135–155/mo pilot, ≈ $1.35–1.55 K at scale |
| **Masked calling** | in-app VoIP (WebRTC) mock | in-app VoIP + local licensed CPaaS; Twilio PK numbers UNVERIFIED | — | PTA LDI rules | n/a | n/a | EXTERNAL (P02) |
| **KYC / liveness** | vendor sandbox; manual review tooling | manual review first (ADR-017); optional Shufti Pro (PK-founded, ~$0.95/check) / Didit (500 free/mo claimed) / Sumsub / Veriff; NADRA via Nishan Pakistan only if eligible (R2 §D) | vendor-specific | yes (DPA required) | n/a | EU/US hosted — residency review Q44 | ≈ $0–95 pilot, $165–700 at scale |
| **Email** | Resend Free (3 K/mo, 100/day) | Resend Pro $20 or SES | as stated | yes | n/a | global | SMTP swap |
| **Observability** | Sentry Dev + Grafana Cloud Free (10 K series, 50 GB logs) | same → ~$50–100/mo | as stated | yes | n/a | Grafana AP | OTel-native |
| **Mobile builds** | EAS Free (15+15 builds/mo, 1 000 Update MAU) | EAS Starter $19 / Production $199; Apple $99/yr; Google Play $25 once | as stated | n/s | n/a | n/a | local Android builds; Codemagic 500 macOS min |
| **CI / security scanning** | GitHub Free (2 000 min/mo), Dependabot, Semgrep CE, gitleaks, Trivy, Knip | same; GHAS CodeQL $30/committer if needed | as stated | yes | n/a | n/a | standard |
| **Domain / DNS / CDN / WAF** | Cloudflare Free; .pk via PKNIC Rs 2,100/yr; .com ~$10–15 | same | as stated | yes | n/a | global | DNS export |
| **Status page / uptime** | UptimeRobot / Better Stack / Instatus Free | same | as stated | UptimeRobot commercial status conflicting (3P) | n/a | n/a | trivial |
| **Payments (Phase 9)** | signed-webhook mocks; PSP sandboxes | Safepay (cards 2.9 %+Rs 30, wallets 1.5 %, Raast 1.5 %) or PayFast; or direct JazzCash (QR 0.25 %, wallet 1.25–2.32 %) / Easypaisa (~1 %, UNVERIFIED) + bank Raast (0–1 %) | sandbox | yes (merchant KYB needs company docs) | n/a | PK | ADR-022; **cards' fixed fee ≈ 6 % of a Rs 500 trip** |
| **Driver payouts** | mock | JazzCash bulk Rs 10/txn, Raast via bank (often free), Safepay payouts free | — | yes | n/a | PK | ADR-022 |

## 3. Minimum credible production stack (pilot)

| Item | Choice | Monthly |
|---|---|---|
| Compute | Hetzner SIN CPX32 (4 vCPU/8 GB): API, worker, WebSocket, Redis, OSRM in Docker Compose + backups | ≈ $58 + $12 |
| Database | Neon Launch always-on (SIN) **or** Supabase Pro (BOM) | ≈ $25 |
| Object storage | R2 | $0–5 |
| OTP | local shortcode or WhatsApp auth (~9 K OTP/mo) | ≈ $135–155 |
| Maps | open stack or Mapbox free tier (Google adds ≈ $360) | $0 |
| KYC | manual review; vendor optional | $0–95 |
| Email, observability, uptime, CI, DNS | free tiers | ≈ $2 |
| Mobile build | EAS Free/Starter | $0–19 |
| **Total** | | **≈ $250–300/mo** (+ one-off: Play $25, Apple $99/yr, SMS mask Rs 5,000, test devices ≈ PKR 120–150 K) |

Dominant variable costs at scale are OTP/WhatsApp and maps; compute stays <10 %. Budget alerts at 50/80/100 % plus hard provider quotas (I11/Q35).

## 4. Hosting region and data residency (ADR-028 / Q44)

- No major cloud has a Pakistan region. Lahore latency estimates (UNVERIFIED, measure before commit): Bahrain 40–60 ms, Singapore 80–120 ms, Mumbai 100–150 ms (often via Singapore), Frankfurt 130–180 ms. 100–150 ms is acceptable for dispatch WebSockets.
- The draft PDP Bill (not enacted) would localise "critical" personal data in Pakistan. **Founder decision FD-03 (provisional):** Singapore may remain the early-region choice, but sensitive KYC/biometric/location storage must stay migratable behind an adapter with a documented path to a Pakistan-hosted store; data-residency/legal review is **not closed**.
- **FD-14:** ≈ USD 250–300/month is accepted as a provisional pilot planning envelope only — not permission to purchase paid infrastructure now and not a guarantee of actual production cost.

## 5. Free-tier traps recorded (do not repeat)
- Vercel Hobby is non-commercial (docs/09) — public site must be on a commercial plan, Cloudflare Pages, or the VPS (W08).
- MapTiler/Stadia free tiers are non-commercial; OSM public tile servers are prohibited for apps.
- Oracle Always Free ARM capacity/reclamation makes it unsuitable for dispatch.
- Twilio PK SMS pricing (~$0.47/segment) is unusable for OTP volume.
- GitHub Student Pack DigitalOcean credits ended Jul/Aug 2026; remaining offers are temporary and educational.
- Neon Free scale-to-zero cannot be disabled; Supabase Free pauses after a week; Render Free sleeps.
- MinIO upstream archival (3P) — choose the local S3-compatible test server in ADR-010.

## 6. Provider migration paths (requirement E06/G02/K11 adapters)
Every vendor sits behind an interface in `packages/provider-interfaces`: maps (tiles, geocode, directions, matrix, navigation), OTP (SMS, WhatsApp), KYC (document, liveness, manual), payments (intent, capture, refund, payout, webhook verification), storage (presign, lifecycle), push, email, telemetry. Switching a vendor is a configuration + adapter change, never a domain change. Each adapter ships with a contract test suite that runs against the vendor sandbox where one exists and against the signed mock locally.
