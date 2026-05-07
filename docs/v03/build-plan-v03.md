# ΘΕΜΙΣ OS — Build Plan v0.3 (30-Day Aggressive)

**Status:** PROPOSED — gating Niko approval
**Author:** Δαίδαλος (Master Coding Architect)
**Date:** 2026-04-29
**Predecessor:** v0.2 build plan (90-day, human-team) — SUPERSEDED
**Mandate:** Sunday FINAL Recommendation §2.D — Agent-first build, no human dev team

---

## 0. Executive Posture

**Goal:** Production-grade ΘΕΜΙΣ OS Phase 1 in **30 calendar days**, deployable to first paying pilot (ΔΣΘ Θεσσαλονίκης) by Day 31.

**Non-negotiables:**
1. Multi-tenant safe (schema-per-tenant + RLS + envelope encryption)
2. GDPR-compliant by Day 22 (audit log encrypted, retention matrix enforced, party-erasure flow)
3. Greek-first UI/UX (zero English in user-facing strings)
4. Mobile-first responsive (Solo Practitioner Mode validated on iPhone SE viewport)
5. Five-minute onboarding from signup → first matter created
6. **Zero shipping a broken citation:** `citation-validator` MUST run synchronously on every Aegis output before display

**Build philosophy:** Agents do the work. Δαίδαλος architects + reviews. Niko approves gates only. Sunday observes + escalates.

**Velocity assumption:** 1 agent-day = 1 senior-dev-week (validated on PsyCreate Phase 0). 30 agent-days ≈ 6 dev-months equivalent.

---

## 1. Decision Gates (Niko approval required)

| Gate | Day | Decision | Blocks if NO |
|------|-----|----------|--------------|
| **G0** | Day 0 | Approve build plan + open questions resolution | Entire build |
| **G1** | Day 3 | Approve foundation skeleton + tenant provisioning POC | Day 4-10 |
| **G2** | Day 10 | Approve auth + parties + matters working end-to-end | Day 11-17 |
| **G3** | Day 17 | Approve billing + myDATA + Γραμμάτιο integrated | Day 18-22 |
| **G4** | Day 22 | Approve Aegis 4 agents + citation validator + portal lite | Day 23-26 |
| **G5** | Day 26 | Approve QA + security audit pass | Day 27-30 |
| **G6** | Day 30 | Approve production launch | First customer |

**Gate cadence:** Niko gets a 1-page status report at each gate. Binary GO/NO-GO. NO-GO triggers replan within 24h.

---

## 2. Agent Roster + Assignments

| Agent | Tier | Role on ΘΕΜΙΣ OS |
|-------|------|------------------|
| **Δαίδαλος** | opus | Architect, code reviewer, hard-bug fixer, gate prep |
| **Περικλής** | opus | Master coordinator, daily standups, blocker escalation |
| **app-specialist** | sonnet | UI components, Next.js pages, forms, Greek labels |
| **tool-specialist** | sonnet | Backend utilities, Fastify routes, integrations (myDATA, ΔΣΑ, Stripe) |
| **gg-sdk-agent** | sonnet | Anthropic SDK integration for Aegis agents |
| **Δοκιμασία** | sonnet | QA gate (TypeScript, a11y, smoke tests) |
| **Νινούρτα** | sonnet | Security audit, OWASP checks, secrets, GDPR |
| **Ερμής** | sonnet | Deploy pipeline (5-phase) |
| **Αριστοτέλης** | opus | Deep critique pre-ship (Day 25 + Day 29) |
| **Άργος** | sonnet | Multi-tenant isolation audit (Day 9 + Day 26) |
| **Ηρόδοτος** | sonnet | Research on edge cases (myDATA quirks, ΚΠολΔ ambiguities) |
| **κτησίβιος** | sonnet | Qdrant ingestion on PC for legal corpus (Ερευνητικός agent) |

**Daily ritual:**
- 09:00 — Περικλής posts Day-N plan to GG4 todos + HUB chat
- 18:00 — Δαίδαλος reviews completed work, files Day-N+1 plan
- Async — agents run in background, Niko sees only blockers + gate reports

---

## 3. Day-by-Day Plan

### **PHASE A — FOUNDATION (Days 1-3)**

#### **Day 1 — Project Skeleton + Decisions Lock**
- **Owner:** Δαίδαλος + Περικλής
- **Output:**
  - `/root/projects/themis-os/app/` monorepo: `apps/web` (Next.js 16), `apps/api` (Fastify), `packages/shared`, `packages/db`, `packages/aegis`
  - `package.json` workspaces + `pnpm-workspace.yaml`
  - `.env.example` with PRODUCT_NAME, PRODUCT_SLUG, PRIMARY_DOMAIN, DATABASE_URL, REDIS_URL, R2_*, ANTHROPIC_API_KEY, AADE_*
  - `docker-compose.dev.yml` — Postgres 16 + Redis 7 + Qdrant pointer to PC
  - GitHub repo `mece-gr/themis-os` (private), main branch protected
  - Resolved decision log: all open questions from data-model + API specs resolved (Niko answers in G0)
- **Gating:** G0 approval (Niko answers Q-DM-1..5 + Q-API-1..6)
- **Verification:** `pnpm install && pnpm dev` boots web + api locally

#### **Day 2 — DB Foundation + Tenant Provisioning POC**
- **Owner:** Δαίδαλος (architect), tool-specialist (implement)
- **Output:**
  - `packages/db/migrations/0001_public_schema.sql` — `firms`, `firm_users`, `subscriptions`, `audit_global` in public
  - `packages/db/migrations/0002_template_schema.sql` — `template` schema with all 40 Phase 1 tables (DDL only, no data)
  - `packages/db/provision-tenant.ts` — script: clone template → `firm_<slug_short>` schema, generate DEK, wrap with KEK_ROOT, store wrapped DEK
  - `packages/db/rls-policies.sql` — RLS enabled per table (defense-in-depth even though schema isolates)
  - Envelope encryption module: `packages/shared/crypto/envelope.ts` (AES-256-GCM, HMAC-SHA256 blind index)
  - 2 test tenants provisioned: `firm_acme`, `firm_test`
- **Gating:** Δαίδαλος review, no Niko gate
- **Verification:** `psql -c "SELECT * FROM firm_acme.party"` returns empty result, no errors

#### **Day 3 — Deploy Pipeline + CI**
- **Owner:** Ερμής (deploy-specialist)
- **Output:**
  - GitHub Actions: lint + typecheck + test on PR
  - `scripts/deploy.sh` 5-phase: pre-deploy → Δοκιμασία QA → build → deploy → post-deploy
  - PM2 ecosystem file: `themis-web` (port 3110), `themis-api` (port 3111)
  - nginx config: `themis.gr` + `*.themis.gr` wildcard → upstream Fastify (subdomain → tenant resolution)
  - Cloudflare DNS: A records, wildcard cert via Let's Encrypt
  - **Staging env:** `staging.themis.gr` deployed with 2 test tenants
- **Gating:** **G1 — Niko approves foundation**
- **Verification:** `curl https://acme.staging.themis.gr/api/health` returns `{"status":"ok","firm":"acme"}`

---

### **PHASE B — CORE DOMAIN (Days 4-10)**

#### **Day 4 — Auth + Tenant Resolution Middleware**
- **Owner:** tool-specialist
- **Output:**
  - NextAuth setup: email/password + WebAuthn 2FA (TOTP fallback)
  - JWT issuer with `firm`, `firm_slug`, `tier`, `role`, `permissions` claims (per API spec §3)
  - Fastify middleware: `resolveTenant()` reads subdomain → looks up `public.firms` → sets `request.firm` + sets `SET search_path` on connection
  - Login flow: `POST /api/v1/auth/login` returns JWT, refresh token in httpOnly cookie
  - Password reset flow with email (Resend.com)
- **Verification:** Login on `acme.staging.themis.gr`, JWT contains `firm: "acme"`, queries scoped to `firm_acme` schema

#### **Day 5 — Party Module (Unified)**
- **Owner:** app-specialist + tool-specialist
- **Output:**
  - `GET/POST/PATCH /api/v1/parties` (filter by `role`, `kind`, `is_attorney`)
  - `GET/POST /api/v1/parties/:id/roles` (time-bounded role management)
  - PII encryption on write (envelope), blind index for AFM/email lookup
  - `GET /api/v1/parties/search?q=` — uses blind index for AFM, FTS for name
  - Next.js page `/parties` — list + filter by role chip + create modal
  - Greek labels: "Φυσικό Πρόσωπο", "Νομικό Πρόσωπο", "Δικηγόρος", "Αντίδικος"
  - **`/clients` returns 410 Gone** (per API spec §6)
- **Verification:** Create party with role=client, list shows it, filter `role=opponent` excludes it

#### **Day 6 — Matter Module + Matter↔Party M2M**
- **Owner:** app-specialist + tool-specialist
- **Output:**
  - `matter` table CRUD endpoints
  - `matter_party` rich join: role, side (ours/theirs/neutral), is_primary_contact, billing_split_percentage
  - Postgres trigger: `validate_billing_split()` enforces SUM=100 for side='ours'
  - Partial unique index: only one `is_primary_contact=TRUE` per (matter_id, side) where left_at IS NULL
  - Next.js `/matters` list + `/matters/[id]` detail with party tabs
  - Greek labels: "Υπόθεση", "Δική μας πλευρά", "Αντίδικη πλευρά", "Πληρεξούσιος"
- **Verification:** Create matter, attach 2 clients with 60/40 split → trigger allows; attach with 60/30 → trigger rejects

#### **Day 7 — Documents + R2 EU + Versioning**
- **Owner:** tool-specialist
- **Output:**
  - `POST /api/v1/documents` multipart upload → R2 EU bucket prefix `firms/<firm_id>/documents/`
  - Server-side encryption with per-firm DEK before R2 upload
  - `document_version` table for immutable history
  - `GET /api/v1/documents/:id/download` returns signed R2 URL (5min TTL)
  - PDF text extraction queued to BullMQ `document-processing` queue
  - Next.js `/matters/[id]/documents` upload + list
- **Verification:** Upload 10MB PDF → R2 receives encrypted blob → download works → text extracted to `document.extracted_text`

#### **Day 8 — Calendar + ΚΠολΔ Rules Engine (top 30 rules)**
- **Owner:** Ηρόδοτος (research) → tool-specialist (implement)
- **Output:**
  - Ηρόδοτος produces `kpold-rules-top30.json`: 30 most-cited deadline rules from ΚΠολΔ + ΚΠΔ + ΚΔΔ
  - `deadline_rule` table seeded with 30 rules (formula JSONB: base_event + offset_days + business_days_only + holiday_calendar)
  - `event` table for calendar entries (court hearings, deadlines, meetings)
  - `POST /api/v1/deadlines/calculate` — input: rule_id + base_date → output: due_date with reasoning
  - Greek public holidays calendar (built-in)
  - Next.js `/calendar` month view + deadline list
- **Verification:** Calculate "Προθεσμία ανακοπής" from 2026-04-15 → returns 2026-04-30 (15 business days, skipping Πάσχα)

#### **Day 9 — Multi-Tenant Isolation Audit (Άργος)**
- **Owner:** Άργος
- **Output:**
  - Cross-tenant query attempts: forge JWT with firm_a, query firm_b — must 403 every endpoint
  - Schema isolation test: `SET search_path TO firm_a; SELECT * FROM firm_b.party;` — must fail
  - RLS bypass test: connect as `app_user`, attempt to read other schema — must fail
  - R2 prefix isolation test: signed URL for firm_a doc, try with firm_b token — must fail
  - Audit report: pass/fail per attack vector
- **Gating:** All vectors must be PASS or Day 10 blocks
- **Verification:** Άργος delivers `audit-day9.md` with 100% PASS

#### **Day 10 — Time Tracking + Billing Foundation**
- **Owner:** app-specialist + tool-specialist
- **Output:**
  - `time_entry` table with explicit `rate_amount` snapshot (Aristotle L17 fix)
  - `POST /api/v1/time-entries` with rate snapshot from `firm_user.default_rate` at insert time
  - Timer UI: start/stop, live counter, manual entry
  - `invoice` + `invoice_line` tables (no myDATA yet)
  - `POST /api/v1/invoices/draft` — aggregates time entries → draft invoice
  - Next.js `/time` daily entry view + `/invoices` draft list
- **Gating:** **G2 — Niko approves auth + parties + matters + time end-to-end**
- **Verification:** Full flow: create matter → log 2hr time → generate draft invoice with €200 line item

---

### **PHASE C — INTEGRATIONS + COMPLIANCE (Days 11-17)**

#### **Day 11 — myDATA Integration (AADE)**
- **Owner:** Ηρόδοτος (research current API quirks) → tool-specialist
- **Output:**
  - AADE myDATA REST client: `packages/integrations/mydata/`
  - XML schema validator for ΤΠΥ (Τιμολόγιο Παροχής Υπηρεσιών)
  - `POST /api/v1/invoices/:id/submit-mydata` with idempotency key (per API spec §11)
  - MARK retrieval + storage on `invoice.mydata_mark`
  - Test mode (AADE sandbox) + production toggle per firm
  - BullMQ retry policy: 5 attempts, exponential backoff
- **Verification:** Submit test invoice to AADE sandbox → MARK returned → stored on invoice

#### **Day 12 — ΔΣΑ Γραμμάτιο Integration**
- **Owner:** Ηρόδοτος (current ΔΣΑ API state) → tool-specialist
- **Output:**
  - ΔΣΑ Γραμμάτιο calculator (rates table for civil/criminal/admin matters)
  - PDF generation with Γραμμάτιο template (signed via firm cert)
  - `POST /api/v1/grammatia` with matter_id + court_type → PDF stored in R2
  - Next.js `/grammatia` list + generate flow
  - Optional: ΟΛΟΜΕΛΕΙΑ submission API if available (Day 12.5 if API down)
- **Verification:** Generate Γραμμάτιο for civil matter at Πρωτοδικείο Αθηνών → PDF correct, amount matches table

#### **Day 13 — Payments (Stripe + Viva Wallet)**
- **Owner:** tool-specialist
- **Output:**
  - Stripe Checkout for SaaS subscriptions (Starter/Professional/Firm/Enterprise tiers)
  - Viva Wallet for client payment of invoices (Greek market preferred)
  - Webhook handlers: `subscription.updated`, `payment.succeeded`, `payment.failed`
  - `POST /api/v1/invoices/:id/payment-link` returns Viva Wallet checkout URL
  - Subscription gating middleware: blocks endpoints if `subscriptions.status != 'active'`
- **Verification:** End-to-end: signup → Stripe checkout (test card) → tier=Professional → access granted

#### **Day 14 — Search + Qdrant Bootstrap (PC)**
- **Owner:** κτησίβιος (PC ops) + tool-specialist
- **Output:**
  - Qdrant collection `themis_legal_corpus` on PC (10.0.0.10:6333) — points to existing 1.46M legal points
  - Per-tenant collection: `themis_firm_<slug>` for firm's own documents (matters, drafts)
  - Embedding pipeline on PC: `BAAI/bge-m3` 1024d for Greek legal text
  - `GET /api/v1/search?q=` hybrid: dense (Qdrant) + sparse (BM25 in Postgres FTS) + Claude Haiku rerank
  - Next.js `/search` global search bar in topnav
- **Verification:** Search "ανακοπή κατά διαταγής πληρωμής" → returns ΑΠ decisions + own matter drafts ranked

#### **Day 15 — Audit Log + GDPR Retention Matrix**
- **Owner:** tool-specialist + Δαίδαλος (review)
- **Output:**
  - `audit_log` table with envelope-encrypted `changes` JSONB
  - Fastify hook: every `PATCH/DELETE/POST` writes audit row with actor + before/after
  - Retention matrix table: financial 20yr, non-financial 5yr, audit 10yr
  - `POST /api/v1/parties/:id/erase` — GDPR Art. 17 erasure: shreds party DEK fragment, audit row preserved (encrypted, unreadable post-erasure = "key shredding")
  - Cron job: daily retention sweep, soft-deletes past-retention rows
- **Verification:** Edit party, audit row appears encrypted; erase party, party fields nulled, audit unreadable

#### **Day 16 — Notifications + Email Templates**
- **Owner:** app-specialist
- **Output:**
  - Resend.com integration for transactional email
  - Templates (Greek): welcome, password reset, deadline reminder (T-3 days), invoice issued, payment received
  - In-app notifications: `notification` table + WebSocket push
  - User preference UI: per-channel toggle (email/in-app/SMS-future)
- **Verification:** Create deadline 3 days out → cron triggers reminder → email + in-app notification

#### **Day 17 — Solo Practitioner Mode + Onboarding Flow**
- **Owner:** app-specialist
- **Output:**
  - Onboarding wizard (5-min target): firm name → AFM → ΔΣΑ chamber → first matter → done
  - Solo Mode toggle in settings: hides "team", "billing splits", "approval workflows", simplifies nav to 5 top items
  - Sample data seed: 3 demo matters, 2 demo parties, 1 demo invoice (deletable on first real action)
  - Mobile-first nav: bottom tab bar on <768px (Dashboard / Υποθέσεις / Ημερολόγιο / Χρόνος / Περισσότερα)
- **Gating:** **G3 — Niko approves billing + myDATA + Γραμμάτιο + onboarding**
- **Verification:** Stopwatch test: signup → first matter created in ≤5min on iPhone SE viewport

---

### **PHASE D — AI AGENTS (AEGIS) + PORTAL (Days 18-22)**

#### **Day 18 — Citation Validator (BLOCKER for Day 19)**
- **Owner:** Δαίδαλος + tool-specialist
- **Output:**
  - `packages/aegis/citation-validator.ts`
  - Cross-references AI-generated citation against legal corpus (Postgres `nomos`/`arthro`/`apofasi` tables + Qdrant lookup)
  - Returns `{valid: true, source_url}` or `{valid: false, reason: "Δεν βρέθηκε ΑΠ 1234/2018"}`
  - **HARD RULE:** Aegis output containing unvalidated citation → response blocked, error to user, alert to Δαίδαλος
- **Verification:** Feed fictional "ΑΠ 9999/2026" → validator rejects; feed real "ΑΠ 1024/2018" → validator accepts

#### **Day 19 — Αναγνώστης (OCR + PII Extraction)**
- **Owner:** gg-sdk-agent
- **Output:**
  - Haiku 4.5 agent: input PDF/image → output structured JSON (parties, AFMs, dates, amounts)
  - PII flagging: highlights detected PII for user confirmation before storing
  - `POST /api/v1/aegis/anagnostis/extract` async (BullMQ)
  - UI: doc upload → "Ανάγνωση σε εξέλιξη..." → review extracted entities → confirm/edit → save to party/matter
- **Verification:** Upload εξώδικο PDF → returns sender AFM + recipient AFM + date + amount, all correct

#### **Day 20 — Προθεσμίας (Deadline Extractor)**
- **Owner:** gg-sdk-agent
- **Output:**
  - Haiku 4.5 agent: input court document text → output `{rule_id, base_date, suggested_deadline}`
  - Maps to ΚΠολΔ rules engine (Day 8) for calculation
  - `POST /api/v1/aegis/prothesmias/extract`
  - UI: doc detail → "Εξαγωγή Προθεσμίας" button → review suggested deadline → save to calendar
- **Verification:** Feed διαταγή πληρωμής → returns "ανακοπή 15 εργάσιμες ημέρες από επίδοση 2026-04-20" → calendar entry 2026-05-12

#### **Day 21 — Ερευνητικός (Legal Research)**
- **Owner:** gg-sdk-agent
- **Output:**
  - Sonnet 4.6 agent: input legal question → searches Qdrant corpus → drafts answer with citations
  - **MANDATORY:** every citation passes through Day-18 validator BEFORE response shown
  - `POST /api/v1/aegis/erevnitikos/ask` streaming response
  - UI: chat interface in `/research` page, conversation history per matter
- **Verification:** Ask "Πότε παραγράφεται η αξίωση από αδικοπραξία;" → answer with ΑΚ 937 citation, validator confirms

#### **Day 22 — Συγγράμματος (Document Drafting) + Client Portal Lite**
- **Owner:** gg-sdk-agent (agent) + app-specialist (portal)
- **Output:**
  - **Συγγράμματος:** Sonnet 4.6 agent for εξώδικα/αγωγές/προτάσεις from template + matter context
  - `POST /api/v1/aegis/syngrammatos/draft` returns DOCX + PDF
  - Templates: top 10 most-used (εξώδικο, αγωγή χρηματική, ανακοπή, προτάσεις, κλπ)
  - **Client Portal lite (read-only):** `portal.themis.gr/<firm_slug>` — magic link login → matters timeline + documents (read), no upload, no chat
- **Gating:** **G4 — Niko approves Aegis 4 agents + portal**
- **Verification:** Draft εξώδικο from matter context → DOCX downloads, contains real party names, citations validated

---

### **PHASE E — QA + SECURITY + HARDENING (Days 23-26)**

#### **Day 23 — Δοκιμασία QA Sweep**
- **Owner:** Δοκιμασία
- **Output:**
  - TypeScript strict mode: 0 errors
  - a11y axe scan: 0 critical violations
  - Smoke tests: 50 critical user paths automated (Playwright)
  - Greek string audit: 0 English in user-facing UI
  - Mobile viewport test: all pages on iPhone SE + Galaxy S22
- **Verification:** QA report: pass rate ≥98%, critical bugs filed to GG4 todos

#### **Day 24 — Bug Fix Sprint #1**
- **Owner:** Δαίδαλος + app-specialist + tool-specialist (parallel)
- **Output:** All P0/P1 bugs from Day 23 closed
- **Verification:** Δοκιμασία re-runs critical paths, all green

#### **Day 25 — Αριστοτέλης Deep Critique**
- **Owner:** Αριστοτέλης
- **Output:**
  - Logical consistency review across data model + API + UX
  - Edge case enumeration (e.g., what if ΑΦΜ shared across firms? what if matter has 0 parties?)
  - Critique report with severity-ranked issues
- **Gating:** P0 issues must be fixed in Day 26

#### **Day 26 — Νινούρτα Security Audit + Άργος Re-Audit**
- **Owner:** Νινούρτα + Άργος
- **Output:**
  - **Νινούρτα:** OWASP Top 10 scan, secrets scan, dependency CVE scan, GDPR compliance checklist (DPA, retention, erasure, export)
  - **Άργος:** Re-runs Day 9 isolation tests + new endpoints from Days 10-22
  - Penetration attempt: forged JWT, SQL injection, XSS, CSRF, IDOR
- **Gating:** **G5 — All HIGH/CRITICAL findings resolved or risk-accepted in writing by Niko**

---

### **PHASE F — PRODUCTION LAUNCH (Days 27-30)**

#### **Day 27 — Αριστοτέλης Final Critique + Production Config**
- **Owner:** Αριστοτέλης + Ερμής
- **Output:**
  - Aristotle final pass: any v0.3-spec drift? any inconsistency introduced in fix sprints?
  - Production secrets in `/root/.secrets`: AADE prod creds, Stripe live keys, Viva Wallet live, R2 prod bucket
  - Production DB on Hetzner Bridge: backup cron 03:00 daily to R2
  - Monitoring: Grafana dashboard (request rate, error rate, AI latency, queue depth)

#### **Day 28 — Έρμης Production Deploy (Phase 1: dark launch)**
- **Owner:** Ερμής
- **Output:**
  - Deploy to `themis.gr` (production), DNS cutover
  - Tenant `firm_pilot01` provisioned for ΔΣΘ pilot firm (no traffic yet)
  - Synthetic monitoring: every 60s ping `/api/health` from 3 regions
  - Smoke test on prod with internal firm (Niko's firm if Niko opts in, else `firm_demo`)

#### **Day 29 — Pilot Onboarding + Final Pre-Launch Critique**
- **Owner:** Niko (relationship) + Δαίδαλος (technical) + Αριστοτέλης (final critique)
- **Output:**
  - First pilot firm onboarded (manual white-glove)
  - 5-min onboarding test with real Greek lawyer (timed)
  - Aristotle final critique pass on production
  - Landing page `themis.gr/pricing` live with Stripe checkout

#### **Day 30 — General Availability + Post-Launch Monitoring**
- **Owner:** Ερμής + ops-monitor
- **Output:**
  - Public signup enabled
  - Status page `status.themis.gr`
  - On-call rotation: Δαίδαλος primary, Περικλής secondary, Niko escalation
  - Day-30 retrospective: what worked, what didn't, Phase 1.5 backlog
- **Gating:** **G6 — Niko approves GA**

---

## 3.5 Sprint Impact — Privilege Architecture v0.3 (D-DM-16..19, D-API-13..17)

**Status:** PROPOSED, awaits Niko approval. Affects Days 2, 7, 11, 15, 22, 26.

**Cross-cutting additions vs original 30-day plan:**

| Day | Original scope | v0.3 privilege addition | Δ effort | Owner |
|-----|----------------|------------------------|----------|-------|
| **Day 2** | DB foundation + tenant provisioning POC | + Self-host **HashiCorp Vault** σε dedicated CX VM (Q-DM-6 path a) με Postgres backend + Shamir 5-of-9 unseal για Vault root + cloud-init auto-unseal hardening | **+0.5 day** (~4hr ops) | tool-specialist + Νινούρτα review |
| **Day 2** | 40-table template schema | +3 tables: `document_privilege` (per-firm), `audit_privilege_access` (per-firm, **monthly partitioned από Day 1**), `kms_custody_share` (public, Enterprise stub) | **+0.25 day** | tool-specialist |
| **Day 7** | Documents + R2 + versioning | + DDK envelope encryption module (`packages/shared/crypto/ddk.ts`), write path branch `r2_sse_c` vs `ddk_aes_gcm`, read path με Vault-cached unwrap (TTL 15min) | **+0.5 day** | tool-specialist + Δαίδαλος review |
| **Day 11** | myDATA integration | (no privilege impact, but verify audit_privilege_access partition Mar 2026 exists) | 0 | — |
| **Day 15** | Audit + GDPR retention | + retention matrix entry για `audit_privilege_access` (20yr per N.4194/2013 §38, NO pseudonymization), + key-shredding flow για GDPR Art.17 destroys per-doc DDKs first then DEK | **+0.25 day** | tool-specialist |
| **Day 18** | Citation validator | (no direct impact) | 0 | — |
| **Day 21** | Ερευνητικός agent | + `document_privilege.ai_context_eligible` filter στο context builder + `AI_PRIVILEGE_BLOCKED` error wiring + audit row write per excluded doc | **+0.25 day** | gg-sdk-agent |
| **Day 22** | Συγγράμματος + Portal lite | + Portal hard-block check (HTTP 403 PORTAL_PRIVILEGE_BLOCKED) at route middleware level (defense-in-depth, even though `portal_visible=true AND tag != 'none'` is DB CHECK) | **+0.1 day** | app-specialist |
| **Day 26** | Νινούρτα + Άργος security audit | + Privilege-specific test vectors: cross-team DDK leak, BYOK Shamir reconstruction simulation, audit_privilege_access tamper detection, AI context bleed-through | **+0.5 day** (parallel within Day 26) | Νινούρτα + Άργος |

**Total Δ:** ~2.4 days of effort distributed across Days 2-26. **No critical-path slip** — Day 2 buffer absorbs Vault setup; Day 7 absorbs DDK module; Day 26 audit expansion stays within day boundary by parallelization (Νινούρτα + Άργος already running concurrently).

**Phase 1 deferrals (explicit):**
- Enterprise BYOK endpoints (`/admin/kms/byok/*`): stub-return `501 Not Implemented` Day 22; full Sprint 13-14 (Phase 1.5 Q3)
- Shamir custody opt-in flow UI (Q-DM-7): wireframes Day 24, full UX Phase 1.5
- Vector encryption at rest για privileged Qdrant points: Phase 1.5 (Q-DM-7 follow-up)
- Quarterly recovery drill automation: Phase 1.5 cron job
- Greek notary timestamping integration: Phase 2

**New gating consideration για G3 (Day 17):**
Add to G3 checklist: "Privileged document upload + download end-to-end works με DDK wrap/unwrap. Vault Shamir unseal documented σε runbook. audit_privilege_access partition rolling correctly."

**New gating consideration για G5 (Day 26):**
Add to G5 checklist: "Privilege ACL bypass attempts: 0 PASS. AI context inclusion of privileged docs: 0 PASS. KMS rotation dry-run: PASS."

**Risk additions to Risk Register (§4):**

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Vault unseal keys lost (Niko + Shamir guardians) | Low | **Catastrophic** (all tenants offline) | 5-of-9 Shamir με geographic distribution; quarterly drill; encrypted offsite backup |
| DDK rewrap performance bottleneck σε 100K+ docs firm | Medium | Medium | Throttled `kms-rotation` queue ≤1000 rows/sec; benchmark Day 26 |
| AI context leak of privileged doc (Aegis bug) | Low | **Catastrophic** (privilege waiver) | Day 21 hard guard + Day 26 Άργος specific test vector + audit_privilege_access alert webhook |

---

## 4. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| myDATA API changes mid-build | Medium | High | Ηρόδοτος re-validates Day 11 morning; sandbox-only fallback if prod unstable |
| ΔΣΑ Γραμμάτιο API undocumented/down | High | Medium | PDF generation works standalone; submission deferred to Phase 1.5 if API unavailable |
| Aegis hallucinated citation slips through | Low | Catastrophic | Day 18 validator + integration test in CI blocks deploy on validator failure |
| Schema-per-tenant scaling >100 firms | Low | Medium | Connection pooling per schema; switch to connection-per-firm at 100+ |
| GDPR DPA template not legally reviewed | Medium | High | Niko engages external lawyer Day 20-25 for DPA review |
| Pilot firm unhappy → public failure | Medium | High | White-glove onboarding Day 29; daily check-in first 2 weeks; SLA 99.5% |
| Greek tax law change during build | Low | Medium | Subscribe to AADE bulletins; Ηρόδοτος monitors weekly |
| Agent velocity slower than 1-day-=-1-week | Medium | High | Weekly velocity check at gates; replan trigger if 2 days behind |

---

## 5. Out of Scope (Phase 1.5 / Phase 2)

Explicit cuts from v0.2 deferred:
- Bulk operations module (Phase 1.5)
- Multi-firm collaboration (Phase 2)
- Advanced reporting/BI (Phase 2)
- Mobile native app (Phase 2 — Phase 1 = PWA)
- ΕΣΠΑ workstream (separate project, Sunday §3)
- Conflict-of-interest engine (Phase 1.5 — manual check Phase 1)
- Trust accounting (Phase 1.5)
- Document automation marketplace (Phase 2)

---

## 6. Open Questions (need Niko answers Day 0 — G0 gate)

1. **Q-BP-1:** Pilot firm contract signed before Day 30? If no → delay GA?
2. **Q-BP-2:** Stripe vs Viva Wallet primary? Sunday recommended Viva for Greek market — confirm?
3. **Q-BP-3:** Internal firm (Niko's) used as smoke-test tenant on Day 28? Read-only or full?
4. **Q-BP-4:** External legal review of DPA + ToS before launch? Who? (Pericles' firm?)
5. **Q-BP-5:** Domain confirmation: `themis.gr` available? If not, fallback?
6. **Q-BP-6:** Marketing site copy + brand identity — who writes? Athena-designer?
7. **Q-BP-7:** Day-30 GA = soft launch (waitlist) or hard launch (open signup)?

**Δαίδαλος recommendations:**
- Q-BP-1: GA proceeds even if pilot delays (de-risks revenue dependency on single pilot)
- Q-BP-2: Viva Wallet for Greek invoice payments, Stripe for SaaS subscriptions (international cards)
- Q-BP-3: Use `firm_demo` tenant, NOT Niko's real firm (avoid dogfooding risk on Day 28)
- Q-BP-4: Engage external lawyer Day 20 (Pericles' firm or external counsel)
- Q-BP-5: Verify Day 1 morning; fallback `themisos.gr` or `themislegal.gr`
- Q-BP-6: Athena-designer Day 27-29 for landing + pricing pages
- Q-BP-7: Soft launch with 50-firm waitlist, hard launch Day 45 after monitoring stable

---

## 7. Daily Status Format (posted to GG4 todos + HUB chat)

```
## Day-N Status — YYYY-MM-DD
**Owner:** [agent]
**Planned:** [bullet list]
**Completed:** [bullet list]
**Blockers:** [list or "None"]
**Tomorrow:** [Day-N+1 plan summary]
**Velocity:** [On track / +1 day ahead / -1 day behind]
```

---

## 8. Definition of Done — Day 30

- [ ] All 14 Phase 1 modules deployed to `themis.gr`
- [ ] All 4 Aegis agents working, citation validator on
- [ ] Multi-tenant isolation: 100% Άργος pass
- [ ] Security: 0 HIGH/CRITICAL Νινούρτα findings unresolved
- [ ] Compliance: GDPR DPA reviewed, retention matrix enforced
- [ ] Performance: p95 API <500ms, AI agents p95 <8s
- [ ] Onboarding: 5-min target validated with real lawyer
- [ ] Pilot firm onboarded OR signed contract for Day 31
- [ ] Public pricing page live with Stripe checkout
- [ ] Monitoring: Grafana + status page live
- [ ] On-call rotation defined and acknowledged
- [ ] Day-30 retrospective document published
