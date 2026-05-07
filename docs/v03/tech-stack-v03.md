# ΘΕΜΙΣ OS — Tech Stack v0.3

**Status:** PROPOSED
**Author:** Δαίδαλος
**Date:** 2026-04-29
**Predecessor:** v0.2 stack (Next.js + Fastify + FastAPI + multiple infra) — CONSOLIDATED
**Mandate:** Sunday §2.F — TypeScript end-to-end, drop FastAPI, single backend

---

## 0. Decisions vs v0.2

| Layer | v0.2 | v0.3 | Rationale |
|-------|------|------|-----------|
| Frontend | Next.js 14 | **Next.js 16** (App Router, RSC) | Latest stable, server actions, partial prerendering |
| Backend (CRUD) | Fastify (Node) | **Fastify** (Node) | Keep |
| Backend (AI) | FastAPI (Python) | **DROPPED — Fastify plugin** | Single binary, single repo, no Python dep |
| Language | TS + Python | **TypeScript only** | Agent velocity, single mental model, shared types |
| DB | PostgreSQL 16 | **PostgreSQL 16** | Keep |
| Multi-tenancy | tenant_id columns | **Schema-per-tenant + RLS** | Aristotle L2 fix, defense-in-depth |
| Cache/Queue | Redis + BullMQ | **Redis + BullMQ** | Keep |
| Vectors | Self-hosted Weaviate | **Qdrant on PC (10.0.0.10)** | Existing infra, 1.46M legal points already loaded |
| Storage | AWS S3 | **Cloudflare R2 EU** | EU residency, no egress fees, MECE policy (R2 not S3) |
| Auth | Custom JWT | **NextAuth.js + WebAuthn** | Battle-tested, 2FA built-in |
| AI SDK | LangChain | **Anthropic SDK direct** | Strip indirection, full control over prompts/tools |
| Email | SendGrid | **Resend.com** | Better DX, modern templates |
| Payments | Stripe | **Stripe + Viva Wallet** | Greek market needs Viva for invoice payments |
| Hosting | AWS ECS | **Hetzner Bridge + PM2** | Existing infra, €/perf ratio, MECE policy |
| Edge/CDN | CloudFront | **Cloudflare** | Existing, cheaper, DNS+CDN+WAF unified |
| Monitoring | Datadog | **Grafana + Prometheus + Langfuse** | Self-hosted on Bridge, Langfuse for AI traces |
| CI/CD | CircleCI | **GitHub Actions** | Free tier sufficient, simpler |
| Error tracking | Sentry | **Sentry** | Keep |
| Search | Elasticsearch | **Postgres FTS + Qdrant hybrid** | Drop ES, simpler stack |

**Net effect:** -1 language (Python), -1 service (FastAPI), -1 infra component (Weaviate), -2 paid SaaS (Datadog, AWS) → leaner ops, faster builds, easier onboarding.

---

## 1. Frontend

### Core
- **Next.js 16** (App Router, Server Components, Server Actions)
- **TypeScript 5.5+** strict mode
- **React 19**
- **TailwindCSS 4** + **shadcn/ui** (Greek-translated component library)
- **next-intl** for i18n (Greek primary, English fallback for system messages)

### State + Data
- **TanStack Query 5** for server state
- **Zustand** for minimal client state (UI toggles)
- **React Hook Form + Zod** for forms + validation
- **Shared Zod schemas** between frontend and backend (`packages/shared/schemas/`)

### Mobile-First
- TailwindCSS breakpoints: mobile-first defaults, `md:`/`lg:` for larger
- Bottom-tab navigation on `<768px`
- Touch targets ≥44px
- Tested viewports: iPhone SE (375px), iPhone 14 Pro (393px), Galaxy S22 (360px), iPad (768px), Desktop (1280px+)
- PWA manifest + service worker for offline-capable basic browsing

### A11y
- Radix UI primitives (via shadcn) → ARIA built-in
- axe-core CI scan on every PR
- Greek `lang="el"` on `<html>`
- Keyboard navigation tested

---

## 2. Backend (Single Fastify Binary)

### Core
- **Fastify 5** + **TypeScript 5.5+** strict mode
- **Node.js 22 LTS**
- **pnpm** workspaces (monorepo)
- **Zod** for request/response validation (shared schemas with frontend)
- **fastify-type-provider-zod** for typed routes

### Plugins
- `@fastify/jwt` — JWT auth
- `@fastify/cookie` — refresh token cookie
- `@fastify/rate-limit` — per-tier rate limiting
- `@fastify/multipart` — file uploads
- `@fastify/cors` — CORS for portal subdomain
- `@fastify/swagger` — auto OpenAPI from Zod schemas

### AI Integration (Aegis)
- **`@anthropic-ai/sdk`** v0.30+ direct
- **No LangChain** (cuts indirection, full control)
- Streaming responses via Fastify SSE plugin
- **Langfuse** for AI traces (self-hosted Docker on Bridge :3600)
- Citation validator: synchronous middleware on all Aegis responses

### Background Jobs
- **BullMQ 5** + Redis 7
- 7 queues Phase 1: `document-processing`, `aegis-anagnostis`, `aegis-prothesmias`, `aegis-erevnitikos`, `aegis-syngrammatos`, `mydata-submit`, `notifications-email`
- Worker process separate from API (`themis-worker` PM2 instance)

### Tenancy Layer
- Custom Fastify plugin `fastify-tenant`:
  - Reads subdomain from `request.hostname`
  - Looks up `public.firms` (cached 5min in Redis)
  - Sets `request.firm` + sets `SET search_path TO firm_<slug_short>` on connection acquired from pool

---

## 3. Database

### Postgres 16 on Hetzner Bridge
- **Schema-per-tenant** (shared cluster Phase 1)
- **`public` schema:** firms, firm_users, subscriptions, audit_global, retention_policy
- **`template` schema:** all 40 Phase 1 tables (DDL only) — cloned to new tenant on provision
- **`firm_<slug_short>` schemas:** one per tenant (truncated slug, max 32 chars)
- **RLS enabled** on all tables (defense-in-depth even with schema isolation)

### Connection Management
- **postgres.js** (single library, supports search_path per connection)
- Connection pool: 20 connections, per-pool search_path reset on release
- Migrations via **drizzle-kit** (apply to template + each tenant via `provision-tenant.ts`)

### Encryption
- **Envelope:** KEK_ROOT (Hetzner KMS API or self-hosted Vault) wraps per-tenant DEK
- **Algorithm:** AES-256-GCM for column encryption, HMAC-SHA256 for blind index
- **Key shredding** for GDPR erasure: per-party DEK fragment XOR'd into per-tenant DEK; erasure deletes fragment, rendering historical encrypted PII unreadable but preserving audit log structure

### Backups
- Daily 03:00 cron → R2 (encrypted, 30-day retention)
- Weekly 0:00 Sunday → cold backup to second R2 region
- **PITR** via WAL archiving → R2 (5-min RPO)
- **Restore drill:** monthly automated test restore on staging

### Migration to Dedicated DB (Firm+ tier)
- Phase 1 launches all firms on shared cluster
- When firm upgrades to Firm/Enterprise tier:
  - `pg_dump` of `firm_<slug>` schema
  - Restore to new dedicated cluster (Hetzner CX42)
  - Update `firms.db_connection_string` in public
  - Cutover during firm's off-hours window
- Triggered manually Phase 1, automated Phase 1.5

---

## 4. Vector Database (PC Compute Node)

### Qdrant on 10.0.0.10:6333 (existing infra)
- **Collection `themis_legal_corpus`:** existing 1.46M legal points (νόμοι, ΑΠ, ΣτΕ, ECHR, EUR-Lex)
- **Per-tenant collections** `themis_firm_<slug>`: own documents, drafts, communications
- **Embedding model:** BAAI/bge-m3 1024d (multilingual, Greek-optimized)
- **Embedding pipeline:** runs on PC GPU (RX 9060 XT 16GB VRAM), batch ingestion via κτησίβιος agent
- **Hybrid search:**
  1. Dense (Qdrant) top-50
  2. Sparse (Postgres FTS BM25) top-50
  3. RRF (Reciprocal Rank Fusion) merge
  4. Claude Haiku rerank top-10 → top-5

### Network
- **WireGuard tunnel** Bridge ↔ PC (existing)
- Bridge connects to PC Qdrant via VPN IP `10.0.0.10:6333`
- TLS termination at Qdrant (Caddy reverse proxy on PC)
- Auth: Bearer token (stored in `/root/.secrets/qdrant-token`)

---

## 5. Storage

### Cloudflare R2 (EU jurisdiction)
- **Buckets:**
  - `themis-firms-prod` — production firm documents, prefix `firms/<firm_id>/documents/`
  - `themis-firms-staging` — staging
  - `themis-backups-prod` — DB backups, prefix `daily/<date>/`
  - `themis-static-prod` — static assets (logos, generated PDFs cached)
- **Encryption:** server-side encryption with per-firm DEK (encrypt before R2 upload)
- **Access:** Bearer token (Cloudflare R2 API, NOT S3 SDK per MECE policy)
- **Signed URLs:** 5-minute TTL for downloads
- **Lifecycle:** auto-archive to R2 Infrequent Access after 90 days

---

## 6. Caching + Queues

### Redis 7 on Bridge
- **Cache:** firm metadata (5min TTL), session JWT blacklist, rate limit counters
- **BullMQ:** 7 queues Phase 1
- **Pub/Sub:** WebSocket fan-out for in-app notifications

### Cloudflare CDN
- Static assets cached at edge (immutable hashed filenames from Next.js build)
- API responses NOT cached (multi-tenant + auth)
- Per-tenant landing assets cached with `Cache-Tag: firm-<id>` for purge

---

## 7. Authentication + Authorization

### NextAuth.js v5
- **Providers:** Email/Password (primary), Magic Link (portal), Google OAuth (Phase 1.5)
- **2FA:** WebAuthn (passkeys) primary, TOTP (Google Authenticator) fallback
- **Session:** JWT in httpOnly secure SameSite=Lax cookie + access token in Authorization header
- **Refresh:** rolling refresh, 14-day session lifetime, 1-hour access token

### RBAC
- 4 roles Phase 1: `admin` / `partner` / `associate` / `paralegal` / `secretary` (5 actually, but admin is firm owner)
- Permission matrix in `packages/shared/permissions.ts`
- Permission check via Fastify hook on every protected route
- Fine-grained matter-level permissions: matter creator + assigned users see matter; partners see all firm matters

---

## 8. AI Stack (Aegis)

### Anthropic SDK
- `@anthropic-ai/sdk` v0.30+
- **Models Phase 1:**
  - **Sonnet 4.6** (`claude-sonnet-4-6-20260201`) for Συγγράμματος + Ερευνητικός
  - **Haiku 4.5** (`claude-haiku-4-5-20260201`) for Προθεσμίας + Αναγνώστης
- **Cost cap per firm:** Starter €5/month AI credit, Professional €15, Firm €50, Enterprise unlimited (with rate limit)
- **Cost monitoring:** every Anthropic API call logs tokens + cost to `aegis_usage` table

### Citation Validator (BLOCKER)
- **`packages/aegis/citation-validator.ts`**
- Pattern matchers: `ΑΠ \d+/\d{4}`, `ΣτΕ \d+/\d{4}`, `ν\.\s*\d+/\d{4}`, `αρθρ\. \d+`, etc.
- Cross-reference: Postgres FTS lookup in `nomos`/`apofasi`/`arthro` tables
- **Hard failure:** unvalidated citation → response blocked, error to user, alert to Δαίδαλος
- Synchronous wrapper around Aegis responses (NOT async)

### Langfuse
- Self-hosted Docker on Bridge :3600 (existing)
- Every Aegis call traced: prompt, response, tokens, latency, cost
- Per-firm dashboard: AI usage, top queries, validator rejection rate

---

## 9. Integrations

### Greek Compliance
- **AADE myDATA REST API** (production + sandbox)
- **ΔΣΑ Γραμμάτιο** (calculator + PDF, submission API if available)
- **AFM validation** via AADE public web service

### Payments
- **Stripe** for SaaS subscriptions (international cards)
- **Viva Wallet** for invoice payments (Greek market preferred)
- Webhook handlers idempotent (idempotency key on `invoice_payment.external_id`)

### Email
- **Resend.com** for transactional email
- React Email for templates (Greek-first)
- DKIM/SPF/DMARC configured for `themis.gr`

### Calendar Sync (Phase 1.5)
- iCal export per matter/per user (Phase 1)
- Google Calendar 2-way sync (Phase 1.5)
- Outlook 2-way sync (Phase 2)

---

## 10. Hosting + Infrastructure

### Hetzner Bridge (37.27.211.14) — Production Phase 1
- **Spec:** CX52 16GB RAM 4 vCPU 240GB SSD (current MECE Bridge, shared with GG4/HUB/MemPalace)
- **PM2 processes:**
  - `themis-web` (Next.js, port 3110)
  - `themis-api` (Fastify, port 3111)
  - `themis-worker` (BullMQ workers, no port)
- **nginx:** TLS termination, subdomain routing `<firm>.themis.gr` → upstream Fastify
- **Cloudflare:** DNS + CDN + WAF + DDoS protection

### PC Compute Node (10.0.0.10) — Vectors + AI Embeddings
- Qdrant Docker container (port 6333)
- Embedding pipeline (Python, GPU-accelerated)
- Connected to Bridge via WireGuard

### Migration Plan (post-50 customers)
- Move Postgres to dedicated Hetzner CX42 (32GB RAM)
- Add second Bridge for high-availability (active-passive)
- Add Cloudflare Load Balancing
- **Trigger:** when API p95 latency >500ms OR DB CPU >70% sustained for 1 week

---

## 11. Monitoring + Observability

- **Grafana** (Bridge :3003): dashboards for API latency, error rate, DB connection pool, queue depth, AI cost per firm
- **Prometheus**: metrics scraping from Fastify (`/metrics` endpoint via `fastify-metrics`)
- **Langfuse** (Bridge :3600): AI traces
- **Sentry**: frontend + backend error tracking
- **Status page**: `status.themis.gr` powered by Uptime Kuma (self-hosted)
- **Synthetic monitoring**: every 60s, ping `/api/health` from 3 regions (free tier of UptimeRobot)

---

## 12. CI/CD

### GitHub Actions
- **PR checks:**
  - `pnpm install --frozen-lockfile`
  - `pnpm lint` (ESLint + Prettier)
  - `pnpm typecheck` (`tsc --noEmit`)
  - `pnpm test` (Vitest unit + integration)
  - `pnpm test:e2e` (Playwright critical paths)
  - axe-core a11y scan
  - **Citation validator integration test** (must pass)
- **Main branch deploys:** auto-deploy to staging on merge
- **Production deploy:** manual workflow_dispatch trigger by Niko/Δαίδαλος (with approval gate)

### Έρμης 5-Phase Deploy
1. **Pre-deploy:** lock check, migration plan, rollback plan
2. **Δοκιμασία QA Gate:** typecheck + smoke + a11y
3. **Build + Deploy:** Next.js build, Fastify build, PM2 reload (zero-downtime)
4. **Post-deploy:** health check, synthetic monitoring, error rate sampling
5. **Rollback:** instant rollback (~3s) if metrics regression

---

## 13. Naming Neutrality (rename-friendly)

```typescript
// packages/shared/branding.ts
export const PRODUCT_NAME = process.env.PRODUCT_NAME || 'ΘΕΜΙΣ OS';
export const PRODUCT_SLUG = process.env.PRODUCT_SLUG || 'themis-os';
export const PRIMARY_DOMAIN = process.env.PRIMARY_DOMAIN || 'themis.gr';
export const PRODUCT_TAGLINE = process.env.PRODUCT_TAGLINE || 'Λογισμικό για Ελληνικά Δικηγορικά Γραφεία';
```

- Schemas use `firm_<slug_short>` (NOT `themis_firm_*`)
- Tables use generic names (NOT `themis_party`)
- DB role names: `app_user`, `tenant_admin` (NOT `themis_user`)
- R2 bucket prefix uses env var
- Rename effort estimate: **~2 hours** (env vars + landing copy + meta tags + email templates)

---

## 14. Secrets Management

### `/root/.secrets/` (per MECE policy)
- `themis-postgres.env`: DATABASE_URL, KEK_ROOT_KMS_KEY_ID
- `themis-anthropic.env`: ANTHROPIC_API_KEY
- `themis-aade.env`: AADE_USER, AADE_KEY, AADE_PROD_USER, AADE_PROD_KEY
- `themis-stripe.env`: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
- `themis-viva.env`: VIVA_CLIENT_ID, VIVA_CLIENT_SECRET
- `themis-r2.env`: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (Bearer token format)
- `themis-resend.env`: RESEND_API_KEY
- `themis-qdrant.env`: QDRANT_URL=https://10.0.0.10:6333, QDRANT_API_KEY

### Loading
- PM2 ecosystem file references `env_file: '/root/.secrets/themis-*.env'`
- Local dev: `.env.local` git-ignored, populated from secrets manager
- **NEVER hardcoded** in code or committed

---

## 15. Phase 1 Cost Estimate (operational)

| Component | Monthly Cost (€) |
|-----------|------------------|
| Hetzner Bridge (existing, shared) | 0 (allocated) |
| Hetzner Postgres backup storage | ~5 |
| Cloudflare R2 (10TB storage + egress) | ~150 |
| Cloudflare DNS+CDN+WAF | 20 (Pro plan) |
| Anthropic API (50 firms × avg) | ~800 |
| Resend (100k emails/month) | 20 |
| Stripe fees | % of revenue (~3%) |
| Viva Wallet fees | % of revenue (~1.5%) |
| Sentry team plan | 26 |
| Domain + TLS (Cloudflare) | ~2 |
| **Total fixed monthly** | **~1,025** |
| **Per firm marginal** | **~16-20** (mostly AI) |

At 50 firms × €30 ARPU = €1,500 MRR → break-even ~30 firms.

---

## 16. Open Questions

1. **Q-TS-1:** Hetzner KMS available, or use self-hosted Vault for KEK_ROOT?
   - Δαίδαλος rec: Self-hosted Vault on Bridge (existing infra), Hetzner KMS Phase 1.5

2. **Q-TS-2:** Next.js 16 stable enough for Day 1, or pin Next.js 15?
   - Δαίδαλος rec: Next.js 15.4 (latest 15.x stable) for Day 1, upgrade to 16 in Day 30 retro if stable

3. **Q-TS-3:** Postgres on shared Bridge cluster or dedicated VM Day 1?
   - Δαίδαλος rec: Shared cluster Phase 1 (existing pg_primary), dedicated CX42 trigger at 50 firms

4. **Q-TS-4:** Self-host Sentry vs paid plan?
   - Δαίδαλος rec: Paid plan Phase 1 (€26/mo trivial vs ops burden), self-host Phase 2

5. **Q-TS-5:** Use existing PC Qdrant Docker or dedicated `themis_qdrant` instance?
   - Δαίδαλος rec: Existing instance with separate collections; isolation by collection naming + Bearer token scopes

---

## 17. PRIVILEGE ARCHITECTURE STACK ADDENDUM (NEW v0.3 — D-DM-16..19)

> **Driver:** data-model-v03 §8 + api-architecture-v03 §3.15. Stack-level implementation details for the cryptographic privilege layer. Awaits Niko sign-off (Q-DM-6, Q-DM-7).

### 17.1 Vault Setup (mandatory, supersedes Q-TS-1)

| Aspect | Decision |
|--------|----------|
| Service | HashiCorp Vault Community 1.18+ |
| Hosting | **Dedicated Hetzner CX22 VM** (Helsinki), €7/μήνα. NOT co-located on Bridge (security boundary) |
| Storage backend | Postgres (shared with Bridge cluster, separate DB `vault_storage`) |
| Unseal | Shamir 5-of-9 manual + AWS KMS Frankfurt auto-unseal as recovery seal |
| Network | Reachable only via WireGuard from Bridge `themis-api` PM2 process; mTLS |
| Audit | Vault native audit → Postgres `vault_audit` partition (Bridge), append-only |
| Ops procedure | `runbooks/vault-recovery.md` (Day 2 deliverable) |

**Vault unseal share holders (Shamir 5-of-9 — Q-DM-6 followup):**
1. Niko (1 share, hardware token YubiKey)
2. Δαίδαλος ops escrow (1 share, encrypted in `/root/.secrets/vault-share-escrow.gpg` με Niko-only GPG key)
3. Pericles (1 share)
4. Niko's wife / trusted family (1 share, sealed envelope)
5. Niko's accountant office (1 share, sealed envelope)
6-9. Four additional rotation-only shares for future addition (sealed, time-locked)

**Reconstruction quorum:** 5 of 9. Time-locked rotation drill: every 6 months.

### 17.2 Per-Document Data Key (DDK) Crypto Module

| Aspect | Decision |
|--------|----------|
| Library | Node.js native `crypto` (AES-256-GCM, no external deps) |
| Key generation | `crypto.randomBytes(32)` — CSPRNG |
| Wrap algorithm | AES-256-GCM-Wrap (RFC 5649 style: KEK wraps DDK + AAD = document_uuid + tier + matter_id) |
| IV | First 12 bytes of `document_uuid` (deterministic, no IV reuse risk because keys are unique per doc) |
| AAD | `tier || firm_uuid || document_uuid || matter_id` (binds key usage context) |
| Caching | In-process LRU `lru-cache` 100 entries / 15min TTL; **NEVER persisted**, **NEVER swapped** (mlock if possible) |
| Rotation | Background BullMQ `kms-rotation` queue, throttled ≤1000 docs/sec |

**Why not envelope library (e.g., Tink)?** Custom because:
- Tink requires Java/Go interop or KMS plugin; we want pure Node.js for monolith
- Node native `crypto` is FIPS-140-2 capable, audited, mature
- Custom keeps key derivation explicit and auditable

### 17.3 Audit Privilege Access — Storage Sizing

Worst-case Phase 1: 30 users × 100 doc accesses/day × 30 days × 12 months × 5 years (initial) = **5.4M rows / firm / 5yr**.

- Row size: ~512 bytes (UUID + timestamps + JSONB acl_snapshot)
- 5.4M × 512B = ~2.7 GB / firm / 5yr (acceptable on shared cluster for Pro tier)
- Monthly partition + GIN indexes on `(document_id, timestamp DESC)` + `(accessor_user_id, timestamp DESC)`

20-year retention for Enterprise: ~10 GB / firm — acceptable on dedicated DB.

### 17.4 BYOK Shamir Custody (Enterprise opt-in, Phase 1.5 implementation)

| Aspect | Decision |
|--------|----------|
| Share generation | Browser-side WebCrypto + `shamirs-secret-sharing` npm lib; never transmitted |
| Share format | Mnemonic 24-word (BIP39-style) + QR code for hardware token storage |
| Custody types | Sealed envelope, hardware token (YubiKey/Nitrokey), notary seal, escrow service |
| Reconstruction UX | 3-of-5 wizard, multi-session (each holder uploads independently within 7-day window) |
| Notary integration | Greek notary act (συμβολαιογραφική πράξη) optional, generates `kms_custody_share.greek_notary_act_number` |
| Drill cadence | Quarterly auto-reminder; tracked in `kms_custody_share.last_recovery_drill_at` |
| Phase 1 stub | Endpoints return `501 Not Implemented` με sunset header `X-Themis-Available: 2026-Q3` |

### 17.5 Embedding Pipeline Privilege Awareness

- **Privileged docs:** embedded into per-firm Qdrant collection με metadata `{privilege: true, privilege_acl_hash: <sha256>}`
- **Default search filter:** `privilege == false OR privilege_acl_hash IN <user_acl_hashes>`
- **Aegis hard guard:** `document_privilege.ai_context_eligible` checked before EVERY context inclusion (in-process, no cache); audit row written
- **Phase 1.5 hardening:** opt-in vector encryption at rest (Qdrant payload encryption + per-firm keys)

### 17.6 New CI/CD Gates (mandatory)

```
After existing CI pipeline (§11):
6.1 Privilege ACL bypass tests (Άργος suite) — must pass 100%
6.2 DDK round-trip tests (encrypt → store → unwrap → decrypt → verify) — must pass 100%
6.3 audit_privilege_access partition rollover test — must pass
6.4 Vault unseal recovery drill simulation — quarterly cron, alerts on failure
6.5 Citation validator (already in §11) — must pass 100%
```

Failure of 6.1, 6.2, 6.3, or 6.5 = deploy BLOCKED (Hermes pipeline halt).

### 17.7 Updated cost estimate (delta vs §15)

| Item | Monthly cost | Notes |
|------|--------------|-------|
| Vault dedicated CX22 VM | +€7 | Q-TS-2 supersedes — mandatory now |
| AWS KMS Frankfurt (recovery seal only) | +€1 | Pay-per-use, ~$1/μήνα |
| **New total fixed monthly** | **~€1,033** | Was €1,025 |

Marginal per-firm cost unchanged — privilege crypto adds CPU but no infra.

### 17.8 New Open Questions (supplement Q-TS-1..5)

6. **Q-TS-6: BYOK pricing strategy.** Bundle BYOK Shamir custody με Enterprise tier (€79+) OR sell as add-on (+€40/μήνα Sovereign Add-on)?
   - Δαίδαλος rec: Add-on. Default Enterprise = Hetzner KMS dedicated key (no Shamir). BYOK Sovereign Add-on bundles quarterly drill + 1 free notary act/year. Validates pricing sensitivity με 2-3 large firm prospects Sprint 5-6.

7. **Q-TS-7: Vault auto-unseal vendor lock-in.** AWS KMS Frankfurt as recovery seal creates partial AWS dependency. Acceptable for "EU data sovereignty" marketing?
   - Δαίδαλος rec: ACCEPTABLE because (a) AWS KMS Frankfurt is EU jurisdiction, (b) recovery seal is operational convenience NOT data encryption, (c) Shamir manual fallback always works without AWS, (d) ToS discloses. Switch to Hetzner KMS native όταν available (~Q3 2026).

8. **Q-TS-8: DDK key cache size.** 100 keys / 15min TTL. For Firm tier (30 users × 50 doc reads/hour = 1500 unwraps/hour) cache hit rate?
   - Δαίδαλος rec: 100 entries probably too low for Firm tier; benchmark Day 26 Άργος. Initial config: 500 entries Phase 1, monitor cache hit rate via Prometheus, tune.

---

*Δαίδαλος v0.3 tech-stack §17 addendum, filed 2026-04-29.*
*Awaits Niko sign-off on Q-TS-6..8 + Vault Shamir guardian list (Q-TS-1 supersession).*
