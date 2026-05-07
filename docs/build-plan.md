# THEMIS OS — Build Plan (v0.2)

**Spec version:** v0.2 (2026-04-28) — see `changelog.md` for v0.1 → v0.2 transitions.

## Phase 1: Enterprise MVP (18 Sprints = 36 Weeks = ~9 Months)

**Target:** Production-ready platform for first pilot firm (20-50 lawyers), pitch-ready for the next 5 enterprise prospects with all enterprise table-stakes shipped.

**v0.2 differs from v0.1 by:**
- 8 new modules promoted into Phase 1 (SOLON wrapper, ΑΠΕΔ, Trust, Auto Time Capture, Email Auto-filing, Client Portal lite, Reports BI, Mobile responsive web)
- 6 modules dropped or deferred (HR, CLE, Comms, Physical File, BD CRM, PI Calculator)
- Critical-path sprint sequence reordered to deliver Greek commercial wedge (SOLON, ΑΠΕΔ) before pilot
- Acceptance criteria tightened per module

---

### Sprint 1-2: Foundation + Mobile Shell (Weeks 1-4)

**Goal:** Project scaffold, auth, single-tenant deployment template, CI/CD, mobile-first responsive baseline.

**Deliverables:**
- Monorepo setup (Turborepo, shared packages: `ui`, `types`, `config`, `validators`)
- Next.js 16 app with App Router, Tailwind, shadcn/ui, **mobile-first responsive shell layout** (breakpoints: 360 / 768 / 1280)
- Fastify API scaffold with plugin architecture, Pino logging
- FastAPI Aegis scaffold with health check
- PostgreSQL schema: `tenant` (1-row meta), `user`, `role`, `permission`, `department`, `session`, `audit_log` partitioned by month
- Prisma setup with migrations, **no `tenant_id` columns on per-tenant tables** (single-tenant per firm DB)
- JWT auth flow (login, refresh, logout, MFA stub)
- RBAC middleware with built-in roles
- Docker Compose (dev environment, includes Qdrant, Redis, Postgres)
- GitHub Actions CI (lint, typecheck, test, prisma migrate validate)
- Redis setup for cache + BullMQ
- Audit log middleware (append-only)
- Landing page + login page UI
- **Single-tenant deployment template (Terraform/Ansible)** — provisioning a new firm = one command

**Acceptance criteria:**
- New firm provisioning <30 min from zero
- Mobile login + dashboard usable on iPhone 13-class device, no horizontal scroll
- CI green, all migrations idempotent
- Audit log captures every login + role assignment
- 100% TypeScript, Prisma types fully exposed

**Risks:** Single-tenant deployment automation under-tested. Mitigation: dry-run for 3 hypothetical firms in staging during Sprint 2.

**Team:** 2 full-stack devs + 1 DevOps + 1 designer (responsive shell)

---

### Sprint 3-4: Parties & Contacts (Weeks 5-8)

**Goal:** Full party management with GDPR compliance and Unified Party Model enforcement.

**Deliverables:**
- `party` CRUD (persons + companies + government + nonprofit)
- `party_role` + `party_relationship` + `party_group` + `party_group_member`
- Multi-valued contact (`emails`, `phones`, `addresses` JSONB)
- Party search (name, AFM, phone — with encrypted field blind indexes)
- Party profile page (canonical view across all roles a party plays)
- AFM validation (check digit algorithm)
- Greek phonetic library MVP (Ιωάννης = Γιάννης matching) — Sprint 4 deliverable
- GDPR consent recording with N.4624/2019 retention policy
- Party notes (encrypted)
- Custom fields system (definition + values, GIN-indexed JSONB)
- PII field-level encryption implementation (AES-256-GCM)
- KMS integration (per-firm key from Hetzner KMS or sealed-secrets)
- Party list with filters, sorting, pagination, role/side filters

**Acceptance criteria (architectural — locked at v0.2):**
- ZERO references to `client_id` anywhere in schema, code, or API
- All FKs to `party.id` semantically validated by app layer (e.g. invoice.bill_to_party_id requires active `party_role(role='client')`)
- Unified Party Model invariant enforced via Prisma layer + validator
- PII encrypted records query <50ms p95 with 100K synthetic records (load test deliverable)
- Greek phonetic match recall ≥85% on validation set of 50 name pairs

**Risks:** PII encryption performance at scale. Mitigation: blind index strategy benchmark in Sprint 4.

**Team:** 2 full-stack devs + 0.5 AI/ML dev (phonetic library)

---

### Sprint 5-6: Matters Core (Weeks 9-12)

**Goal:** Matter management, the central entity, with strict Matter↔Party M2M.

**Deliverables:**
- `matter` CRUD (no `client_id` column; primary client expressed in `matter_party`)
- `matter_party` rich M2M (role, side, representation_status, billing_split, joined/left timestamps)
- `matter_stage` (configurable per practice area)
- `matter_member` team assignment
- `related_matter` linking
- Matter dashboard page (shell — financial data layered later)
- Matter list with practice area / status / attorney filters
- Matter code auto-generation (configurable pattern, default `YYYY/NNN`)
- Court database (Greek courts — 400+ seed entries from solon.gov.gr authoritative source)
- Court selection in matter (type, city, section)
- Ethical wall implementation (per-matter access control, audit-logged)
- Legal hold flag
- Matter timeline (activity feed)

**Acceptance criteria:**
- Cannot create matter without ≥1 `matter_party` with `role='primary_client'` and `side='ours'`
- Cannot transfer client to opposing side without explicit waiver workflow
- Ethical wall blocks all reads (UI + API + AI search) for non-members
- Court database 100% covered for civil + criminal + administrative; ≥95% for special courts

**Risks:** Court database accuracy. Mitigation: cross-check against ΔΣΑ + dikastiko_ensimo source.

**Team:** 2 full-stack devs

---

### Sprint 7-8: Documents & DMS (Weeks 13-16)

**Goal:** Document management, templates, version control, OCR pipeline.

**Deliverables:**
- Document upload to R2 (presigned URLs, streaming, encrypted at rest)
- Document metadata CRUD with `party_id` FK (the party this document concerns)
- Version control (upload new version, view history)
- Folder structure per matter (auto-created from template)
- Σχετικά numbering (Σ.1, Σ.2, ...) per matter
- Document categories + privilege tags (`none`, `attorney_client`, `work_product`, `joint_defense`)
- Full-text search (PostgreSQL FTS on OCR text + Qdrant vector search via Aegis)
- Document template system (create templates, variables)
- Document generation from templates (auto-populate matter/party data)
- Document viewer (PDF preview in browser, mobile-friendly)
- Document download (signed R2 URLs, time-limited)
- BullMQ worker: OCR processing (pytesseract via Aegis)
- Greek OCR benchmark suite — **target ≥90% accuracy** on 50 real Greek legal docs (P1.5 from audit)
- Legal hold enforcement (prevent deletion)
- Document review workflow (draft → review → approved)
- **Privilege filter applied to AI search** (privileged docs excluded from cross-matter search unless user has matter membership)

**Acceptance criteria:**
- Upload 100MB document <30s from court hallway 4G
- OCR ≥90% accuracy benchmark passed; if not, fallback to AWS Textract Greek model
- Privilege tag enforcement test: create privileged doc, verify Aegis cross-matter search excludes it
- Σχετικά numbering immutable per matter (cannot renumber existing)

**Risks:** OCR quality for Greek text. Mitigation: dual-engine (pytesseract → Textract) selection logic.

**Team:** 2 full-stack devs + 1 AI/ML dev (OCR worker + benchmark)

---

### Sprint 9-10: AI Drafting Studio + Legal Research (Weeks 17-20)

**Goal:** AI-powered document drafting and Greek law corpus integration.

**Deliverables:**
- Aegis Drafting Agent (αγωγή, εξώδικο, αίτηση, πληρεξούσιο, εντολή templates)
- Aegis Document Summary Agent
- Aegis Document Q&A
- PII anonymization pipeline (Presidio + custom Greek model)
- Integration with shared legal corpus (24K laws, 236K articles, 538K vectors)
- Legal Research API (query → relevant articles + laws + case law)
- Legal Research UI (search, results, bookmarks, citation copy)
- Citation generation (AP 123/2024, ΕφΑθ 456/2024 formats)
- Research results linked to matter (`matter_research_link` join)
- AI summary on matter dashboard
- Document embedding pipeline (upload → OCR → embed → Qdrant per-firm collection)
- Per-firm Qdrant collection naming convention: `firm_{firm_slug}_documents`
- Prompt template system (versioned, per-agent, in `aegis/prompts/`)
- AI result caching (Redis, 24h TTL, cache key includes input hash)
- **Hard token budget per request (default 100K tokens)** with per-firm cap enforcement

**Acceptance criteria:**
- Greek PII detection recall ≥95% (Presidio + custom model)
- Drafted αγωγή passes review by Greek practicing attorney (at least 1 of 3 reviewed)
- LLM cost per firm-month within budget cap (alert at 80%, hard cutoff at 120%)
- All AI drafts marked with "AI Draft" yellow banner in UI

**Risks:** Greek PII detection gaps. LLM cost overruns. Mitigation: per-firm hard cutoff.

**Team:** 2 AI/ML devs + 1 full-stack dev

---

### Sprint 11-12: Calendar, Hearings & Deadlines + Daily List (Weeks 21-24)

**Goal:** Complete calendar with Greek deadline engine + court-ready daily list export.

**Deliverables:**
- Calendar CRUD (events, hearings, deadlines)
- Calendar UI (month/week/day, FullCalendar, mobile-responsive)
- Hearing management (create, outcome, adjournment, αντίκλητος tracking)
- **Hearing daily list per attorney + PDF export "ΗΜΕΡΗΣΙΑ ΔΙΚΑΣΙΜΟΣ"** (audit P1.8)
  - Includes: matter, court, courtroom, side, opponent, αντίκλητος, γραμμάτιο status, checklist
  - Printable, court-network-resilient (no live data needed once printed)
- Hearing checklist (γραμμάτιο, παράβολο, documents)
- ΚΠολΔ deadline rules engine (seed: 50+ rules)
  - **Pre-Sprint 11 deliverable: external practicing-attorney legal validation** of every rule (audit P1.1, €3-5K external counsel)
- Deadline auto-calculation from trigger events
- Court-recess awareness (KPolD 147: August + Christmas + Easter suspension)
- Greek public holiday calendar (fixed + variable Orthodox Easter)
- Deadline alerts (email + push + SMS at critical thresholds)
- Statute-of-limitations tracking
- Google Calendar sync (2-way, conflict-resolution last-write-wins)
- Outlook 365 sync (2-way)
- Reminder system (configurable per event type)
- AI deadline extraction from documents (via Aegis Deadline Agent)

**Acceptance criteria:**
- All 50+ ΚΠολΔ rules signed off by external attorney (document delivered before Sprint 11 start)
- Daily list PDF generates <2s for attorney with 10 hearings
- Deadline alert delivery rate ≥99.5% (BullMQ + retries)
- Calendar sync drift ≤5 min over 24h period

**Risks:** ΚΠολΔ rule accuracy is HIGH-impact (lost case = lawsuit against firm). Mitigation: legal sign-off blocking gate.

**Team:** 2 full-stack devs + 1 AI dev (deadline extraction) + external attorney (sign-off)

---

### Sprint 13-14: Time Tracking + Auto Capture + Billing (Weeks 25-28)

**Goal:** Complete time-to-invoice flow with passive auto-capture (Smokeball-style).

**Deliverables:**
- Time entry CRUD (manual, bulk)
- Timers (start/stop/pause, multiple per user)
- **Auto Time Capture (passive tracking)** — NEW v0.2:
  - Browser extension + desktop app (Electron) capture: active app, window title, document path, calendar event, matter context heuristic
  - Captured events stream to `time_capture_event` table via batched ingest endpoint
  - Aegis Time Capture Inferrer (Chronografos) clusters events into draft sessions
  - User reviews + approves draft sessions → promotes to `time_entry`
  - Privacy mode: user can blacklist apps/windows, opt-out per-firm
  - Local-first: events stored offline, sync when online
- Activity types + UTBMS task codes
- Rate cards (per-attorney, per-party-with-client-role, per-matter, per-activity)
- Rate card resolution logic (priority-based: matter override → party rate → attorney+practice → attorney → firm default)
- Billable/non-billable tracking
- Time entry approval workflow
- Invoice creation from time entries + expenses
- Invoice line items (time, expenses, flat fee, disbursements, bar_stamp)
- **Multi-tier invoice approval matrix** (audit P2.10):
  - Configurable approval chain per firm (associate → partner → accountant)
  - Phase 1: 2-tier configurable; full visual builder Phase 2
- Invoice PDF generation (bilingual EL/EN)
- Invoice numbering (sequential, per firm)
- Invoice send via email
- Credit notes
- Payment recording
- Partial payments + payment plans
- AR aging report
- Collection tracking
- ΔΣΑ minimum fee check (Κώδικας Δικηγόρων scales)
- **LEDES 1998B export** (audit P2.3) — Sprint 14 deliverable, 2-3 days effort

**Acceptance criteria:**
- Auto-capture covers ≥80% of attorney's billable activity (validated against 5-day pilot with 3 attorneys)
- Privacy opt-out works at user + firm level
- Time entry promote → time_entry has full audit trail (raw events kept 90 days)
- LEDES export validates in standard parser

**Risks:** Auto-capture privacy concerns in Greek market (audit G6 marked Score 2.0). Mitigation: opt-in by default at firm level, transparent UI showing exactly what's captured.

**Team:** 2 full-stack devs + 0.5 desktop app dev (Electron)

---

### Sprint 15-16: Greek Compliance — myDATA + ΔΣΑ + TAXISnet OAuth (Weeks 29-32)

**Goal:** myDATA AADE integration, ΔΣΑ bar stamps, expenses, **TAXISnet OAuth as shared library** for downstream SOLON/ΑΠΕΔ.

**Deliverables:**
- myDATA AADE integration
  - ΔΑ (Δελτίο Αμοιβής) type 2.1
  - ΑΠΥ (Απόδειξη Παροχής Υπηρεσιών) type 2.1
  - XML generation per AADE spec
  - REST API calls to myDATA (sandbox + production)
  - MARK/UID tracking
  - Transmission status monitoring
  - Error handling + retry (exponential backoff, 24h max)
  - Cancellation flow
- 15% withholding auto-calculation
- VAT 24% calculation
- ΔΣΑ/ΔΣΘ bar stamp management
  - Auto-calculate: fee + 15% withholding + ΕΦΚΑ + ΕΑΑΔΗΣΥ (configurable rates per ΔΣΑ)
  - Link to hearing + matter
  - Stamp history per attorney
  - Monthly/annual reports for ΔΣΑ submission
  - **EFKA/EAAΔ rate update admin UI** (audit G20) — settings page allows annual rate edit
- Expense tracking (categories: court fees, travel, postage, expert fees)
- Expense receipt upload + OCR extraction
- Expense approval workflow
- Expense billing to client (disbursements)
- Court fee tracking (παράβολα, ένσημα)
- Invoice template customization (firm branding)
- **TAXISnet OAuth shared library** (audit P2.5) — used by myDATA + SOLON (Sprint 17) + ΑΠΕΔ (Sprint 17) + e-paravolo (future)

**Acceptance criteria:**
- myDATA sandbox: 100 test invoices transmitted, all MARK numbers received
- 15% withholding calculation matches AADE published formula 100%
- TAXISnet OAuth library reusable by 3 downstream modules without modification
- EFKA rate change applied via UI without code deploy

**Risks:** myDATA API instability + AADE sandbox availability. Mitigation: robust retry + offline queue.

**Team:** 2 full-stack devs (1 focused on myDATA, 1 on TAXISnet shared lib)

---

### Sprint 17: SOLON Wrapper + Email Auto-filing + ΑΠΕΔ + Intake/Conflicts (Weeks 33-34)

**Goal:** Greek commercial wedge complete (SOLON + ΑΠΕΔ) + Smokeball-killer email auto-filing + intake pipeline.

**Deliverables:**

**SOLON e-filing (wrapper, audit P1.3 Option B):**
- TAXISnet OAuth (reuses Sprint 16 library)
- Document submission flow (matter + documents → SOLON-format ZIP)
- Phase 1 mode: hybrid — system generates SOLON ZIP, attorney uploads via SOLON portal in browser, system polls for filing number, auto-populates `matter.court_case_number`
- Status check polling
- Certificate request flow
- Audit trail of every SOLON interaction

**ΑΠΕΔ qualified signatures (audit P1.7):**
- portal.olomeleia.gr OAuth (free for Greek attorneys)
- Document signing API call
- Multi-signer flow (sequential or parallel)
- Signed document storage with signature metadata
- Signature verification view for recipients
- Audit trail (who signed when, IP, certificate fingerprint)

**Email auto-filing (audit P1.9):**
- Gmail OAuth + Microsoft Graph API integration
- IMAP fallback (for self-hosted email)
- Inbox scanner BullMQ worker (every 5 min per active account)
- Aegis Email Classifier (Tachydromos): incoming email → (matter_id, party_id, category, privilege_flag)
- Auto-create `email_message` record + link to matter
- Attachments auto-promote to `document` table on user confirm
- Privacy: per-user opt-in, blacklist domains/senders
- "Sent on behalf of matter X" outbound stamp

**Intake pipeline:**
- Lead intake pipeline (kanban view)
- Lead capture forms (embeddable web forms)
- Lead source tracking + conversion analytics
- Consultation scheduling (calendar integration)
- Lead → Party + party_role(client) + Matter conversion flow
- **Lead is NOT a separate person record** (party created at intake; conversion adds role only)

**Conflict checking:**
- Full conflict check across all parties + roles + matters
- Greek phonetic matching (using Sprint 4 library)
- Tax ID matching
- Related party graph search (party_relationship traversal)
- Audit trail for all checks
- Waiver workflow (partner approval gate)

**Acceptance criteria:**
- SOLON wrapper successfully files 5 test αγωγές through pilot firm
- ΑΠΕΔ signs 50 documents in load test, 100% verification success
- Email classifier accuracy ≥85% on validation set of 200 real emails
- Conflict check completes <500ms p95 against 10K-party DB

**Risks:** SOLON portal UI changes. Mitigation: wrapper isolates change to ZIP format only; manual upload step is human-resilient.

**Team:** 3 full-stack devs (parallel streams: 1 SOLON, 1 Email, 1 Intake/Conflicts) + 0.5 AI dev (Email Classifier)

---

### Sprint 18: Trust Accounting + Reports BI + Client Portal Lite + Polish (Weeks 35-36)

**Goal:** Three remaining enterprise table-stakes + system hardening.

**Deliverables:**

**Trust accounting (basic, audit P2.4):**
- `trust_account` per party-with-client-role + matter
- Deposit / withdrawal / transfer recording
- Running balance calculation
- 2-way reconciliation (bank statement vs. internal ledger) — full 3-way deferred to Phase 2
- Low-balance alerts
- ΕΔΕ compliance: separate bank account per client funds enforced at app layer
- Audit trail (immutable, all transactions)

**Reports/BI baseline (audit P2.2):**
- 6 fixed dashboards:
  1. Financial Summary (revenue, WIP, AR aging, billed vs. collected)
  2. Matter Status (open/closed by practice area, by stage)
  3. Productivity (utilization %, billable hours per attorney, realization rate)
  4. Collections (AR aging, days outstanding, write-off rate)
  5. Bar Stamps Summary (γραμμάτια per attorney, monthly/annual)
  6. Trust Summary (balances per client, recent activity)
- Aegis Report Generator Agent (Apologistis) for natural-language → SQL → chart (Phase 1: read-only library, no DDL)
- Export to CSV/Excel/PDF
- Saved query library (per firm)

**Client portal (lite, audit P2.7):**
- Separate API surface (`/api/v1/portal/*`)
- Separate auth domain (portal_user, portal_session — different lifecycle)
- Branded subdomain per firm (portal.{firm_slug}.themis.gr)
- Login (email + password, MFA optional)
- View invoices + online payment (Stripe + Viva Wallet)
- Download approved documents (signed R2 URLs, privilege-tag-filtered)
- Matter status read-only
- Document sharing + secure messaging deferred to Phase 2 full portal

**Workflow lite (audit P2.1):**
- Stage-transition triggers using `matter_stage.auto_tasks` JSONB
- Auto-create tasks on stage entry
- Visual workflow builder deferred to Phase 2

**Polish:**
- Settings page (firm profile, users, roles, templates, courts, EFKA rates)
- Notification system (email + in-app + push)
- System-wide search (parties, matters, documents, contacts)
- Performance optimization pass
- Security audit (OWASP top 10, external)
- GDPR + N.4624/2019 compliance review (audit P1.10):
  - Document retention policy: legal records exempt from erasure for SOL period (5y general, 20y contractual)
  - Audit log: PII pseudonymization after retention period (not deletion)
- Load testing (50 concurrent users)
- Documentation (user guide basics)
- **Backup/DR procedure tested** (audit P1.4):
  - RTO target: 4 hours
  - RPO target: 15 minutes
  - Recovery test executed in staging before alpha

**Acceptance criteria:**
- Trust account reconciliation report matches bank statement within €0.01 over 100-transaction test
- Reports load <3s for firm with 1 year of data
- Client portal accessible from mobile, branded per firm
- OWASP audit: no high-severity findings
- DR test: full restore within 4h RTO target

**Risks:** Phase 1 scope creep. Mitigation: strict Sprint 18 scope freeze, anything not done by week 36 = Phase 1.5.

**Team:** 3 full-stack devs + 1 security reviewer + 1 designer (portal branding)

---

## Phase 1 Summary (v0.2)

| Sprint | Focus | Key Milestone |
|--------|-------|---------------|
| 1-2 | Foundation + Mobile Shell + Single-tenant template | Auth + responsive scaffold |
| 3-4 | Parties (Unified Party Model) + GDPR | All party data encrypted, phonetic library MVP |
| 5-6 | Matters + Court DB + Ethical Wall | Matter↔Party M2M enforced |
| 7-8 | Documents + DMS + OCR | Greek OCR ≥90% benchmark |
| 9-10 | AI Drafting + Legal Research | Aegis 4 agents live |
| 11-12 | Calendar + KPolD Engine + Daily List PDF | Legal sign-off + court-resilient export |
| 13-14 | Time + Auto Capture + Billing + LEDES | Time-to-invoice complete |
| 15-16 | myDATA + ΔΣΑ + TAXISnet OAuth library | Greek tax compliance live |
| 17 | SOLON wrapper + ΑΠΕΔ + Email auto-filing + Intake/Conflicts | Greek commercial wedge complete |
| 18 | Trust + Reports BI + Portal Lite + Workflow Lite + Polish | Enterprise table-stakes complete |

**Phase 1 modules delivered (v0.2):** 1 (Parties), 2 (Matters), 3 (Calendar), 4 (Documents), 5 (Time), 6 (Billing), 7 (Accounting basic via reports), 8 (Trust basic), 9 (Bar Stamps), 11 (Intake/CRM with BD merged), 12 (Correspondence + Email auto-filing), 13 (SOLON wrapper), 14 (ΑΠΕΔ), 15 (Legal Research), 16 (Workflow lite), 17 (Team/Roles/Ethical Wall), 18 (Client Portal lite), 19 (Expenses), 20 (Reports BI baseline), 21 (Conflict Check), 22 (Contracts), 23 (Hearings), 24 (Deadlines KPolD), 32 (Integrations: TAXISnet, Gmail/Graph, GSIS read-ahead), 33 (Mobile responsive web), 34 (Settings) + AI layer (8 agents in Phase 1, 3 deferred)

**Total: 25 modules + AI layer with 8 agents (out of 11 specified).**

**Modules deferred to Phase 2:** 7 (Full GL Accounting), 8 (Trust 3-way reconciliation), 10 (e-Paravolo automation), 14 (Signatures full multi-tier), 18 (Portal full document sharing), 20 (Reports custom builder), 13 (SOLON full automation no-manual-step).

**Modules deferred to Phase 3:** 25 (Judgments & Enforcement), 28 (Referrals).

**Modules dropped:** 26 (Physical File), 27 (CLE), 29 (HR/Payroll), 30 (Internal Comms — only matter-linked notes kept), 31 (BD CRM — merged into 11).

---

## Phase 2: Enterprise Depth (Months 10-18)

### 2A: Trust Accounting Full + GL Accounting (Sprints 19-22)
- Three-way reconciliation
- Retainer management with auto-replenish
- Full GL accounting (P&L, balance sheet)
- Advanced financial reports
- Xero/QuickBooks sync
- Operating accounting

### 2B: SOLON Full Automation (Sprints 23-24)
- Direct SOLON API integration (no manual ZIP upload)
- Status webhooks (replace polling)
- Bulk filing
- Endiko meso e-filing full
- Aitisi e-filing full
- Certificate auto-renewal

### 2C: Client Portal Full (Sprints 25-26)
- Document sharing + version history visible to client
- Secure messaging (client ↔ attorney)
- Calendar view (hearings, meetings)
- Matter status real-time updates
- Client dashboard
- Custom branding + white-label option

### 2D: Advanced AI & Research (Sprints 27-28)
- Jurisprudence RAG (ΑΠ, ΣτΕ, ΕφΑθ decisions)
- AI case law analysis
- AI case outcome prediction (experimental)
- AI workflow suggestions
- AI workload balancing
- Advanced matter analytics

### 2E: Workflow Builder + Custom Reports (Sprints 29-30)
- Visual workflow builder (drag-and-drop)
- Trigger-action automation engine
- Conditional logic in workflows
- SLA tracking
- Custom report builder (full)
- Scheduled report delivery
- Practice area profitability analytics
- Attorney performance dashboards
- Client LTV analytics

### 2F: e-Paravolo Automation + dikes.moj.gov.gr (Sprints 31-32)
- e-paravolo GSIS integration (auto-generate)
- Court fee auto-calculation refinement
- Dikastiko ensimo / megarosimo calculation
- dikes.moj.gov.gr status polling worker (audit P2.9)
- Auto-update matter timeline from court status

### 2G: Mobile Native (Sprints 33-34)
- React Native shell (iOS + Android)
- Read-only matter + hearing list + push notifications
- Offline mode (local SQLite cache)
- Document viewer
- Time entry quick-add

---

## Phase 3: Advanced Platform (Months 19-30)

### 3A: Mobile Native Full
- Full feature parity with web
- Voice time entry
- Camera receipt capture

### 3B: Judgment & Enforcement
- Judgment recording + tracking
- Enforcement workflows (κατάσχεση, πλειστηριασμός)
- ΚΕΔΕ tracking
- Settlement management

### 3C: Referrals & Fee Splits
- Referral pipeline
- Fee-sharing tracking
- Cross-firm collaboration

### 3D: Multi-Jurisdiction Prep
- Cyprus law corpus extension
- Multi-currency support
- Multi-language UI (English, French)

---

## Phase 4: Market Expansion (Months 24-36)

### 4A: Multi-Tenant Management Platform
- Central admin for managing all firm deployments
- Automated provisioning
- Legal corpus update distribution
- Usage monitoring + billing

### 4B: Integration Marketplace
- Public REST API + API keys
- Zapier integration
- Webhook marketplace
- Third-party app directory

### 4C: Industry Benchmarking (Anonymized)
- Cross-firm benchmarks (anonymized, opt-in)
- Industry trends dashboard
- AI-powered KPI recommendations

---

## Resource Requirements (v0.2)

### Phase 1 Team (9 months)

| Role | Count (v0.1) | Count (v0.2) | Allocation |
|------|--------------|--------------|------------|
| Full-stack Engineer (TS) | 2 | **3** | 100% (1 added Sprint 9 onwards for promoted modules) |
| AI/ML Engineer (Python) | 1 | 1 | 100% from Sprint 7 |
| DevOps Engineer | 1 | 1 | 50% (75% Sprints 1-2 + 17-18) |
| Product Designer (UI/UX) | 1 | 1 | 75% |
| Legal Domain Expert | 1 | 1 | 25% (review, validation) + €5K external for KPolD sign-off |
| QA Engineer | 1 | 1 | 50% from Sprint 9 |
| Desktop App Dev (Electron, time capture) | 0 | 0.5 | Sprints 13-14 |
| **Total FTE** | **~5.5** | **~6.75** | |

### Key Milestones (v0.2)

| Date (from start) | Milestone |
|-------------------|-----------|
| Month 1 | KPolD external attorney engagement signed |
| Month 2 | Internal demo: auth + party management |
| Month 4 | Internal demo: matters + documents working |
| Month 5 | AI drafting first demo |
| Month 6 | Internal demo: full time-to-invoice flow with auto capture |
| Month 7 | myDATA integration testing with AADE sandbox + TAXISnet OAuth library |
| Month 8 | SOLON wrapper + ΑΠΕΔ + Email auto-filing demo |
| Month 9 | Phase 1 feature freeze, alpha release to pilot firm |
| Month 10 | Beta (3-5 firms) |
| Month 12 | Phase 1 General Availability |
| Month 18 | Phase 2 complete |
| Month 30 | Phase 3 complete |

### Budget Estimate (Phase 1, v0.2)

| Item | Monthly | Total (9 months) |
|------|---------|------------------|
| Engineering team (6.75 FTE avg) | EUR 33,000 | EUR 297,000 |
| Infrastructure (dev + staging + sandbox) | EUR 270 | EUR 2,400 |
| LLM API costs (dev/testing, 3 new agents) | EUR 720 | EUR 6,500 |
| Design tools | EUR 100 | EUR 900 |
| Security audit (external, including portal) | -- | EUR 7,500 |
| Legal review (domain expert) | EUR 1,500 | EUR 13,500 |
| KPolD external attorney sign-off | -- | EUR 4,500 |
| ΑΠΕΔ + SOLON practitioner review | -- | EUR 4,000 |
| **Total Phase 1 (v0.2)** | | **~EUR 336,000** |

**v0.1 → v0.2 delta: +€86K** (+34%) for +8 modules and architectural cleanup.

---

## Risk Register (v0.2)

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Ν.5221/2025 SOLON requirement (audit P1.3)** | Critical | High | Phase 1 wrapper (this build plan); manual fallback always available |
| myDATA API instability | High | Medium | Robust retry + offline queue |
| ΚΠολΔ rule accuracy | Critical | Low | External attorney sign-off Sprint 11 (gating) |
| Greek PII detection gaps | Medium | High | Custom Greek NER model if Presidio insufficient |
| LLM hallucination in legal docs | Critical | Medium | Human-in-the-loop mandatory |
| LLM cost overruns | Medium | Medium | Per-firm hard cutoff + alerts |
| Court database incompleteness | Medium | Medium | Crowdsource from pilot firms + solon.gov.gr ground truth |
| Calendar sync conflicts | Low | High | Last-write-wins + notification |
| Auto time capture privacy pushback (Greek market) | Medium | Medium | Opt-in by default at firm level, transparent UI |
| Email classifier accuracy < target | Medium | Medium | Fallback to manual filing UI; classifier suggests not auto-files for first 2 weeks |
| Performance at 50+ concurrent users | Medium | Low | Load test Sprint 18 |
| SOLON portal UI changes | Medium | Medium | Wrapper isolates impact to ZIP format only |
| ΑΠΕΔ portal.olomeleia.gr availability | Medium | Low | Cache certificates, queue signing requests |
| Backup/DR not tested before alpha | Critical | Low | Mandatory DR test Sprint 18 (gating) |
| Audit log GDPR conflict | High | Low | N.4624/2019 derogation documented in greek-compliance.md |
| Competitor launch (Harvey GR, Clio Greek) | Medium | Low | Greek corpus moat + speed advantage |
| Tenant isolation refactor cost (audit P1.2) | Critical | LOCKED | Done at Sprint 3 (irreversible after) |

---

## Phase Gate Process (v0.2)

For Phase 1, three explicit gates with Niko approval:

**Gate A — End of Sprint 4 (Week 8):**
- Architecture invariant enforcement verified (no `client_id` columns; tenant_id removed)
- PII encryption performance benchmark passed
- Phonetic library MVP working
- → GO/NO-GO decision for Sprint 5

**Gate B — End of Sprint 11 (Week 22):**
- KPolD external attorney sign-off received
- All 50+ rules implemented and unit-tested
- Greek OCR benchmark passed
- → GO/NO-GO decision for Sprint 12

**Gate C — End of Sprint 16 (Week 32):**
- myDATA sandbox 100 invoices passed
- TAXISnet OAuth library reusable verified
- Phase 1.5 scope freeze confirmed
- → GO/NO-GO decision for Sprint 17 (highest-risk sprint)

**Gate D — End of Sprint 18 (Week 36):**
- All Phase 1 modules feature-complete
- Security audit clean (no high-severity)
- DR test passed
- → GO/NO-GO for alpha pilot deployment

If any gate is NO-GO, escalate to Niko for re-scope decision (slip to Phase 1.5 or kill specific module).
