# ΘΕΜΙΣ OS — Module List v0.3

**Status:** PROPOSED
**Author:** Δαίδαλος
**Date:** 2026-04-29
**Predecessor:** v0.2 module-list (40 modules) — REDUCED by 26
**Mandate:** Sunday §2 Decision G — 14 Phase 1 modules + 4 AI agents

---

## 0. Summary

| | v0.2 | v0.3 | Δ |
|---|------|------|---|
| Phase 1 modules | 40 | **14** | -26 |
| Phase 1 AI agents | 11 | **4** | -7 |
| DB tables | 68 | **40** | -28 |
| API endpoints | ~180 | **~80** | -100 |
| Build effort | 90 days (4 devs) | **30 days (agents)** | -60 |

**Cut philosophy:** Anything not strictly required for a 1-15 lawyer firm to run end-to-end (intake → matter → calendar → time → invoice → tax submission → archive) was deferred to Phase 1.5 or Phase 2.

---

## 1. Phase 1 Modules (14)

### **Tier 1: Foundation (4 modules) — Days 1-7**

#### **M1 — Tenancy + Auth + Users**
- **Owner:** tool-specialist
- **Days:** 1-4
- **Deliverables:**
  - Firm provisioning (schema-per-tenant)
  - User management (4 roles: admin/partner/associate/paralegal/secretary)
  - NextAuth + WebAuthn 2FA + TOTP fallback
  - JWT with `firm` claim, subdomain → tenant resolution
  - Password reset flow
- **Endpoints:** ~12
- **Tables:** `firms`, `firm_users`, `subscriptions`, `auth_session` + per-tenant `user_role`, `user_preference`
- **Critical invariant:** All non-public tables prefixed by tenant schema; zero `tenant_id` columns

#### **M2 — Party (Unified) + Roles**
- **Owner:** app-specialist + tool-specialist
- **Days:** 5
- **Deliverables:**
  - Single `party` table for all entities (clients, opponents, attorneys, courts, etc.)
  - Time-bounded `party_role` (Invariant #1)
  - PII envelope encryption + AFM blind index
  - `/api/v1/parties?role=...` filter pattern
  - **`/clients` returns 410 Gone**
- **Endpoints:** ~10
- **Tables:** `party`, `party_role`, `party_address`, `party_communication`
- **Greek labels:** Φυσικό Πρόσωπο, Νομικό Πρόσωπο, Πελάτης, Αντίδικος, Δικηγόρος, Δικαστήριο

#### **M3 — Matter + Matter↔Party M2M**
- **Owner:** app-specialist + tool-specialist
- **Days:** 6
- **Deliverables:**
  - Matter CRUD with court hierarchy + procedure type
  - Rich M2M `matter_party` with role/side/billing_split/is_primary_contact
  - Trigger-enforced billing split sum=100
  - Partial unique index for primary contact
- **Endpoints:** ~10
- **Tables:** `matter`, `matter_party`, `matter_status_history`, `matter_tag`
- **Greek labels:** Υπόθεση, Δική μας πλευρά, Αντίδικη πλευρά, Ποσοστό χρέωσης

#### **M4 — Documents + R2 + Versioning**
- **Owner:** tool-specialist
- **Days:** 7
- **Deliverables:**
  - Multipart upload → R2 EU with per-firm prefix
  - Server-side encryption with per-firm DEK
  - Immutable version history
  - Signed download URLs (5min TTL)
  - Text extraction (queued)
- **Endpoints:** ~8
- **Tables:** `document`, `document_version`, `document_link` (matter↔doc M2M)

---

### **Tier 2: Operations (4 modules) — Days 8-12**

#### **M5 — Calendar + ΚΠολΔ Rules Engine**
- **Owner:** Ηρόδοτος + tool-specialist
- **Days:** 8
- **Deliverables:**
  - 30 most-cited deadline rules (ΚΠολΔ + ΚΠΔ + ΚΔΔ)
  - Greek public holidays (built-in)
  - Business-day deadline calculator
  - Calendar UI (month/week/day views)
- **Endpoints:** ~10
- **Tables:** `event`, `deadline_rule`, `deadline_calculation_log`
- **Phase 1.5 deferred:** Full 200+ rule corpus, court-specific calendars

#### **M6 — Time Tracking**
- **Owner:** app-specialist + tool-specialist
- **Days:** 10
- **Deliverables:**
  - Live timer + manual entry
  - **Explicit rate snapshot** at insert time (Aristotle L17)
  - Per-matter time aggregation
  - Mobile-first quick-entry UI
- **Endpoints:** ~6
- **Tables:** `time_entry`

#### **M7 — Invoicing**
- **Owner:** app-specialist + tool-specialist
- **Days:** 10-11
- **Deliverables:**
  - Draft invoice from time entries
  - Invoice line items + VAT calculation (24% / 13% / 6% / 0%)
  - PDF generation (Greek invoice format)
  - Status workflow: draft → issued → paid / overdue / cancelled
- **Endpoints:** ~8
- **Tables:** `invoice`, `invoice_line`, `invoice_payment`

#### **M8 — myDATA Integration (AADE)**
- **Owner:** Ηρόδοτος + tool-specialist
- **Days:** 11
- **Deliverables:**
  - AADE myDATA REST client
  - XML schema validator
  - Idempotent submission with MARK retrieval
  - Sandbox + production toggle
- **Endpoints:** ~4 (under M7 invoice namespace)
- **Tables:** Extends `invoice` with `mydata_mark`, `mydata_status`, `mydata_submitted_at`

---

### **Tier 3: Greek Legal Specifics (3 modules) — Days 12-14**

#### **M9 — ΔΣΑ Γραμμάτιο Generator**
- **Owner:** Ηρόδοτος + tool-specialist
- **Days:** 12
- **Deliverables:**
  - Γραμμάτιο calculator (rates per court type/matter type)
  - PDF generation with firm signature
  - Optional ΔΣΑ submission (if API available, else PDF-only)
- **Endpoints:** ~4
- **Tables:** `grammatio`

#### **M10 — Payments (Stripe + Viva Wallet)**
- **Owner:** tool-specialist
- **Days:** 13
- **Deliverables:**
  - Stripe Checkout for SaaS subscriptions
  - Viva Wallet for invoice payments (Greek market)
  - Webhook handlers (idempotent)
  - Subscription gating middleware
- **Endpoints:** ~6
- **Tables:** Extends `subscriptions` (public), `invoice_payment` per-tenant

#### **M11 — Search (Hybrid Qdrant + Postgres FTS)**
- **Owner:** κτησίβιος + tool-specialist
- **Days:** 14
- **Deliverables:**
  - Qdrant collection for legal corpus (existing 1.46M points)
  - Per-tenant Qdrant collection for own documents
  - Hybrid: dense + BM25 + Claude Haiku rerank
  - Global search bar in topnav
- **Endpoints:** ~3
- **Tables:** No new (uses existing Qdrant + Postgres FTS indexes)

---

### **Tier 4: Compliance + UX (3 modules) — Days 15-17**

#### **M12 — Audit Log + GDPR Engine**
- **Owner:** tool-specialist + Δαίδαλος
- **Days:** 15
- **Deliverables:**
  - Encrypted audit log with key-shredding for erasure
  - Retention matrix enforcement
  - GDPR Art. 17 erasure flow
  - Data export (Art. 15) per party
- **Endpoints:** ~5
- **Tables:** `audit_log`, `retention_policy`, `erasure_request`

#### **M13 — Notifications + Email**
- **Owner:** app-specialist
- **Days:** 16
- **Deliverables:**
  - Resend.com transactional email
  - Greek templates (welcome / reminder / invoice / payment)
  - In-app notifications via WebSocket
  - Per-channel preference UI
- **Endpoints:** ~5
- **Tables:** `notification`, `notification_preference`, `email_log`

#### **M14 — Onboarding + Solo Practitioner Mode + Client Portal Lite**
- **Owner:** app-specialist
- **Days:** 17 + 22
- **Deliverables:**
  - 5-min onboarding wizard
  - Solo Mode toggle (hides team features, simplifies nav)
  - Sample data seed (deletable)
  - Mobile-first bottom-tab nav <768px
  - **Client Portal lite** (read-only): magic link, matters timeline, doc download
- **Endpoints:** ~6
- **Tables:** `onboarding_progress`, `firm_settings`, `portal_session`

---

## 2. Phase 1 AI Agents (4 — Aegis Stack)

Per Sunday §2.E. All agents use Anthropic SDK direct, integrated as Fastify plugin in single backend (no FastAPI). All citations pass through synchronous `citation-validator` before display.

### **A1 — Αναγνώστης (Reader)**
- **Model:** Claude Haiku 4.5
- **Day:** 19
- **Purpose:** OCR + entity extraction from uploaded PDFs/images
- **Input:** Document binary
- **Output:** `{parties: [{kind, name, afm}], dates: [], amounts: [], pii_flags: []}`
- **Endpoint:** `POST /api/v1/aegis/anagnostis/extract` (async, BullMQ)
- **UX:** Upload → "Ανάγνωση σε εξέλιξη..." → review extracted entities → confirm → save to party/matter

### **A2 — Προθεσμίας (Deadline Extractor)**
- **Model:** Claude Haiku 4.5
- **Day:** 20
- **Purpose:** Parse court documents → identify deadline rule + base date
- **Input:** Document text
- **Output:** `{rule_id, base_date, suggested_due_date, reasoning}`
- **Endpoint:** `POST /api/v1/aegis/prothesmias/extract`
- **UX:** Doc detail → button "Εξαγωγή Προθεσμίας" → review → save to calendar (M5)

### **A3 — Ερευνητικός (Researcher)**
- **Model:** Claude Sonnet 4.6
- **Day:** 21
- **Purpose:** Legal Q&A with grounded citations from corpus (1.46M Qdrant points)
- **Input:** Question text
- **Output:** Streaming answer with validated citations
- **Endpoint:** `POST /api/v1/aegis/erevnitikos/ask` (SSE streaming)
- **UX:** Chat interface in `/research`, conversation history per matter
- **Critical:** Every citation passes through validator BEFORE response shown to user

### **A4 — Συγγράμματος (Drafter)**
- **Model:** Claude Sonnet 4.6
- **Day:** 22
- **Purpose:** Generate εξώδικα/αγωγές/προτάσεις from template + matter context
- **Input:** Template type + matter_id
- **Output:** DOCX + PDF in R2
- **Endpoint:** `POST /api/v1/aegis/syngrammatos/draft`
- **Templates Phase 1:** Top 10 — εξώδικο γενικό, εξώδικο όχληση, αγωγή χρηματική, ανακοπή κατά διαταγής πληρωμής, προτάσεις πολιτικές, αίτηση ασφαλιστικών, διαθήκη ολόγραφη draft, διαβιβαστικό προς δικαστήριο, παραίτηση από δικόγραφο, εξώδικη απάντηση
- **Critical:** Drafts containing AI-generated citations pass through validator

---

## 3. Cuts from v0.2 (26 modules → Phase 1.5 / 2 / cancelled)

### **Phase 1.5 (Days 31-60 post-launch)**
- Conflict-of-interest engine (manual check Phase 1)
- Trust accounting (client funds management)
- Bulk operations (mass party update, bulk invoicing)
- Advanced reporting / BI dashboards
- Court hearing scheduler with court calendar sync
- Document templates marketplace
- Approval workflows (multi-step)
- ΚΠολΔ rules expansion (30 → 200+)

### **Phase 2 (Days 61-180)**
- Multi-firm collaboration (case sharing across firms)
- Native mobile app (Phase 1 = PWA only)
- Document automation marketplace (template store)
- Custom workflow builder
- E-signature integration (DocuSign / EU equivalent)
- Court e-filing (when Greek courts support API)
- Practice analytics + benchmarking
- Client billing portal with online payment history
- Multi-language support (English UI for international firms)

### **Cancelled (out of MECE scope)**
- ΕΣΠΑ workstream (separate product per Sunday §3)
- Notary integration (target market mismatch)
- General accounting (out of scope vs Softone/Epsilon)
- HR/payroll (out of scope)
- CRM features beyond party management (use Hubspot)

---

## 4. Module Dependency Graph

```
M1 (Tenancy/Auth) ──┬──> M2 (Party) ──> M3 (Matter) ──> M4 (Documents)
                    │                          │
                    │                          ├──> M5 (Calendar)
                    │                          │
                    │                          ├──> M6 (Time) ──> M7 (Invoice) ──> M8 (myDATA)
                    │                          │                        │
                    │                          │                        └──> M10 (Payments)
                    │                          │
                    │                          └──> M9 (Γραμμάτιο)
                    │
                    ├──> M11 (Search) ──> A3 (Ερευνητικός)
                    ├──> M12 (Audit/GDPR)
                    ├──> M13 (Notifications)
                    └──> M14 (Onboarding/Solo/Portal)

M4 ──> A1 (Αναγνώστης) ──> M2/M3 (auto-fill parties/matters)
M4 ──> A2 (Προθεσμίας) ──> M5 (auto-create calendar entry)
M3 + M4 ──> A4 (Συγγράμματος) ──> M4 (output stored as document)
```

---

## 5. Open Questions

1. **Q-ML-1:** Is M9 (Γραμμάτιο) Phase 1 hard requirement, or acceptable as PDF-only without ΔΣΑ submission?
   - Δαίδαλος rec: PDF-only Phase 1, submission Phase 1.5 (depends on ΔΣΑ API availability)

2. **Q-ML-2:** Top-10 template list for A4 (Συγγράμματος) — Niko/Pericles confirm priority?
   - Δαίδαλος rec: Niko + 1 pilot lawyer to validate top-10 by Day 18

3. **Q-ML-3:** Solo Mode default or opt-in?
   - Δαίδαλος rec: Default ON for Starter tier, OFF for Professional+

4. **Q-ML-4:** Client Portal lite scope — read-only doc list confirmed, or also matter timeline?
   - Δαίδαλος rec: Both, but no chat / no upload Phase 1

5. **Q-ML-5:** A1/A2 (Haiku agents) — auto-trigger on doc upload or manual button?
   - Δαίδαλος rec: Manual button Phase 1 (cost control + user trust); auto-trigger Phase 1.5 with opt-in toggle
