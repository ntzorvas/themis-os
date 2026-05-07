# ΘΕΜΙΣ OS — v0.3 PROPOSAL (Pericles)

**Author:** Περικλής (Master Builder, opus)
**Date:** 2026-04-29
**Predecessors:** v0.1 (Periklis specs) → v0.2 (Daedalus + Argos audit) → **v0.3 (Pericles, market-driven re-anchor)**
**Status:** PROPOSED — awaits Niko GO/NO-GO
**Trigger:** Niko entole 2026-04-29 — «το καλύτερο σύστημα για νομικά γραφεία από 1 άτομο έως 30 άτομα»
**Spec scope expansion:** small firms (1-15) → **1-30** (συμπεριλαμβανομένων mid-market 15-30)

---

## 0. EXECUTIVE OPINION (διαβάζεται πρώτο)

Η v0.2 είναι **υπερσχεδιασμένη για first revenue**. 18 sprints / 9 μήνες / €340K για να φτάσουμε σε alpha είναι strategy που λειτουργεί όταν έχεις PMF certainty — δεν την έχουμε. Η αγορά (Herodotos data) λέει ότι **97% των γραφείων είναι 1-15 άτομα, 60-65% solo**. Με αυτή την πραγματικότητα, **κάθε μήνας πέρα από τον 5ο μέχρι το πρώτο paying customer είναι θάνατος** — όχι από burn rate, αλλά από windowing risk: η αγορά κινείται (Ν.5221/2025 ενεργός 1.1.2026, Νetcompany ψηφιοποίηση δικαιοσύνης τρέχει, Alma θα προσθέσει AI σε 12-18 μήνες).

Το v0.3 είναι **MVP-as-product**, όχι MVP-as-prototype. Στόχος: **paying customer #1 σε 16 εβδομάδες**, **paying #10 σε 32 εβδομάδες**, **ARR €100K μέσα στο πρώτο έτος**. Όχι «alpha pilot». Πραγματικά γραφεία που πληρώνουν με κάρτα ή ΣΕΠΑ.

Διαφωνώ με 4 v0.2 αποφάσεις και θα το πω ευθέως:

1. **Single-tenant per firm σαν blanket policy = margin death.** Για €19/μήνα solo δικηγόρο, ένα dedicated Postgres + Qdrant + KMS + R2 bucket κοστίζει €15-25/μήνα μόνο σε infra. Margin = αρνητικό. Invariant #6 πρέπει να γίνει **conditional** (βλ. §1).
2. **Aegis 11 agents σε Phase 1 = scope explosion.** 4 αρκούν για first revenue. Τα υπόλοιπα είναι Phase 2 ή Phase 3.
3. **SOLON wrapper σε Phase 1 = ψεύτικη urgency.** Το Herodotos research είναι ξεκάθαρο: full automation αδύνατη (hardware ΑΠΕΔ token), wrapper προσφέρει 30-min UX win που μπορεί να γίνει σε Phase 1.5. Δεν είναι revenue blocker — είναι nice-to-have πριν δίκη.
4. **Trust accounting + ΑΠΕΔ + Auto Time Capture όλα μαζί στο Phase 1 = θα σπάσουν τιμή ή χρόνο.** Trust = enterprise-only. ΑΠΕΔ = manual upload-and-sign Phase 1. Auto Time Capture = Phase 2.

Η v0.3 κρατάει τη ραχοκοκαλιά της v0.2 (data model, invariants 1-2-4, Greek compliance philosophy) αλλά **κόβει 60% του Phase 1 scope** και ξανασχεδιάζει τη σειρά για early monetization.

---

## 1. INVARIANT #6 RESOLUTION — Two-Tier Architecture

### Decision (oppinionated)

**Invariant #6 αλλάζει**, ρητά και τεκμηριωμένα. Νέα διατύπωση:

> **Invariant #6 (v0.3):** Tenant isolation is **tier-dependent**. Starter & Professional tiers (€19-39) deploy on **shared multi-tenant Postgres + per-tenant logical schemas + tenant-scoped Qdrant collections + envelope-encrypted PII with per-tenant data keys**. Firm & Enterprise tiers (€59-€79+) deploy on **dedicated single-tenant Postgres DB + dedicated Qdrant collection + dedicated KMS root key + dedicated R2 prefix**. Migration path is **automated** at tier upgrade.

### Why this is acceptable

- Με **logical schema isolation** (`tenant_a.parties`, `tenant_b.parties`), search path enforcement + Postgres RLS, data leak surface ≈ same as DB-per-tenant when implemented correctly. Production precedent: GitHub, Heroku Postgres, Notion (όλοι multi-tenant με logical isolation).
- **Envelope encryption** με per-tenant DEK (data encryption key) wrapped από shared KEK + per-tenant salt = κάθε row's PII είναι δίσκο-encrypted με unique key. Compromise ενός tenant ≠ compromise όλων.
- Margin math: solo €19/mo με shared infra ≈ €2-3/mo cost = ~85% gross margin. Solo €19/mo με dedicated infra ≈ €18-22/mo cost = ~10-15% margin (ή αρνητικό αν συμπεριλάβεις backups/monitoring/ops).
- ΟΥΤΕ ΕΝΑΣ Greek small firm δεν θα ζητήσει «θέλω dedicated DB» στα €19/μήνα. Είναι enterprise feature και η αγορά το ξέρει.

### Architecture details

**Shared tier (Starter + Professional):**
- ΕΝΑ Postgres cluster (Hetzner cx41 αρχικά, scale up σε cx51)
- Schema-per-tenant: `tenant_{firm_uuid_short}.parties`, `.matters`, `.documents` κ.λπ.
- `search_path` set per session μέσω middleware (Fastify hook) → καμία cross-tenant query syntactically possible
- Postgres RLS policies σε kάθε table σαν **second line of defense** (όχι μόνο schema)
- ΕΝΑ Qdrant cluster, **collection-per-tenant** (`themis_{firm_uuid}_documents`) — ΟΧΙ shared collection με tenant filter (αδύναμο)
- ΕΝΑ R2 bucket με tenant prefix (`s3://themis-shared/{firm_uuid}/...`)
- KMS: shared KEK (Hetzner KMS ή sealed-secrets) + per-tenant DEK envelope-wrapped
- Audit log: shared table με `tenant_id` column + RLS

**Dedicated tier (Firm + Enterprise):**
- Provisioning Terraform module spawns: dedicated Postgres DB (initially σε shared cluster, optionally σε dedicated VM για €99+ tier), dedicated Qdrant collection σε dedicated namespace, dedicated R2 bucket, dedicated KMS root key
- Provisioning time target: <15 minutes
- Connection routing: API gateway reads `firm_id` → JWT → DSN από `tenant_registry` table

**Migration path (Shared → Dedicated):**
1. Trigger: Niko / firm admin clicks "Upgrade to Firm tier" OR firm exceeds 8 active users (auto-suggest)
2. Background job (BullMQ): `migrate_tenant_to_dedicated`
3. Steps: provision dedicated infra → `pg_dump --schema=tenant_X` → restore σε dedicated DB → Qdrant collection clone → R2 prefix sync → DNS subdomain swap → cutover (4-hour maintenance window, scheduled)
4. Reversible πρώτες 30 μέρες (rollback to shared)
5. Tested με synthetic 100-matter / 5GB tenant πριν enable σε production

**Πέρα από αυτό, Invariants 1-5, 7-10 παραμένουν αναλλοίωτοι** (Unified Party Model, M2M, PII encryption, audit log immutability, AI degraded-mode-safe, Greek-first, human-in-the-loop, privilege enforcement, EU-only).

---

## 2. MVP SCOPE — Lean v0.3 Phase 1

### Cut without hesitation (από v0.2 Phase 1)

| v0.2 Phase 1 module | v0.3 Decision | Why |
|----------------------|---------------|-----|
| **Trust accounting (basic 2-way)** | → Phase 2 | Solo/small don't need. €59 Firm tier feature. |
| **SOLON wrapper (Sprint 17)** | → Phase 1.5 (after first 5 customers) | Wrapper = nice UX. Manual SOLON upload works for 99% τώρα. |
| **ΑΠΕΔ qualified signatures (Sprint 17)** | → Manual link in Phase 1, full integration Phase 2 | Hardware token blocker. UX: «Click to open portal.olomeleia.gr» button αρκεί. |
| **Auto Time Capture (Sprint 13-14, Electron)** | → Phase 3 | Electron app = 6-8 weeks dedicated work. Manual time entry + browser extension Phase 2. |
| **Email auto-filing (Sprint 17)** | → Phase 2 | Manual email forward to `matter-X@firmslug.themis.gr` Phase 1 (simple inbox routing). |
| **Multi-tier invoice approval matrix** | → Phase 2 | Solo + Pro = single approver. Firm = simple 2-tier (associate→partner). |
| **LEDES 1998B export** | → Phase 3 | Greek market doesn't use LEDES (US-centric). Add only if enterprise pilot demands. |
| **Reports/BI baseline (6 dashboards + NL→SQL Aegis)** | → Phase 2 | Phase 1 = 3 hardcoded dashboards (Financial, Matter Status, Bar Stamps). NL→SQL = Phase 3. |
| **Client Portal lite (Sprint 18)** | → Phase 1.5 (post-first-revenue) | Differentiator για differentiation, αλλά not required για first paying customer. |
| **Workflow lite (auto_tasks JSONB)** | → Phase 2 | Hardcode 3 stage transitions για civil-claim flow only. |
| **Greek phonetic library (Sprint 4)** | → Phase 1 BUT minimal | Beider-Morse port + 200 transliteration pairs. No Greek NER training Phase 1. |
| **System-wide search** | → Phase 2 | Per-module search Phase 1 αρκεί. |

### Keep in MVP (v0.3 Phase 1)

| Module | Justification |
|--------|--------------|
| **Auth + RBAC (4 built-in roles)** | παρτνερ, συνεταίρος, συνεργάτης, γραμματεία |
| **Tenant provisioning (shared schema)** | New firm onboarding <5 min |
| **Mobile-first responsive web** | Cross-cutting from Sprint 1 |
| **Parties (Unified Party Model + GDPR)** | Invariants #1, #4 |
| **Matters (M2M, primary client + opposing party + witnesses)** | Invariant #2 |
| **Calendar + ΚΠολΔ Deadline Engine (top 30 rules, externally signed off)** | Lawsuit-prevention critical |
| **Documents + R2 storage + version control + Greek OCR ≥85%** | DMS = table stake |
| **Time tracking (manual + timer)** | Revenue prerequisite |
| **Billing + myDATA + ΔΣΑ Γραμμάτιο calculation** | Invariant #10 + Greek law mandate |
| **AFM validation + courts seed (300 most common)** | Greek essentials |
| **3 hardcoded dashboards** | Financial / Matter Status / Bar Stamps |
| **Aegis Phase 1: 4 agents only** (βλ. §4) | AI as differentiator, not replacement |
| **Conflict check (basic + phonetic)** | Bar requirement, not optional |
| **Settings (firm profile, users, courts, EFKA rates)** | Admin minimum |
| **Audit log append-only + GDPR derogation policy** | Invariant #4 |
| **Backup/DR tested (4h RTO / 15min RPO)** | Pre-launch gate |

### Phase 1 module count

**v0.2 Phase 1:** 25 modules + 8 AI agents
**v0.3 Phase 1:** **14 modules + 4 AI agents** (44% reduction)

This is the price of shipping in 4-5 months instead of 9.

---

## 3. 30-PERSON EDGE — Mid-Market Additions

Για να δουλεύει «άνετα» γραφείο 15-30 ατόμων με 2-3 πρακτικές περιοχές, το v0.3 πρέπει να προσθέσει συγκεκριμένα features στο **Firm tier (€59)** και **Enterprise tier (€79+)**, διαφορετικά το tier είναι κενό περιεχομένου:

### Firm tier (15-30 lawyers) — Phase 1.5 hardening

| Feature | Why |
|---------|-----|
| **Departments lite (2-3 per firm)** | Π.χ. «Αστικό», «Ποινικό», «Εμπορικό». Soft labels, όχι hard isolation. Reports filter by department. |
| **Role-based access επεκτεταμένο** | 7 roles: managing partner / partner / senior associate / associate / paralegal / γραμματεία / accountant. Permissions matrix per resource (matter, document, financial, settings). |
| **Conflict check at scale** | Algorithmic optimization: trigram + phonetic + GIN indexes. Target: <2s p95 σε 50K-party dataset. Caching layer (Redis) για frequent searches. |
| **Multiple rates per matter** | Junior associate €80/hr, senior €150/hr, partner €250/hr στην ίδια υπόθεση. Time entry resolves rate per attorney+matter+date snapshot. |
| **Trust accounting basic (2-way reconciliation)** | Required by ΕΔΕ for firms που χειρίζονται client funds (μεσιτείες, εξώδικες ρυθμίσεις, αποζημιώσεις). |
| **Multi-tier invoice approval (configurable 2-3 levels)** | Associate drafts → Partner approves → Accountant transmits to myDATA. |
| **Team analytics dashboard** | Utilization %, billable hours per attorney, realization rate, AR per partner. Read-only Phase 1.5. |
| **Bulk operations (matters, parties, time entries)** | Bulk close 50 matters at year-end. Bulk reassign on lawyer departure. |
| **Document templates library + variables** | Firm-shared templates with merge fields (party name, AFM, matter number). |
| **Granular notification preferences** | Per-user: only my matters / department / firm-wide. |

### Enterprise tier (30+ lawyers) — Phase 2

| Feature | Why |
|---------|-----|
| **Hard ethical walls (per-matter access lockdown)** | Litigation conflict isolation, audit-logged. |
| **Custom workflows (no-code builder)** | Phase 2D from v0.2. |
| **Custom reports + scheduled delivery** | Phase 2E. |
| **API + webhooks** | Integration with firm's own ERP / DMS. |
| **Dedicated infra + SLA 99.9%** | Contractual. |
| **Single-Sign-On (SAML/OIDC)** | Enterprise IT requirement. |
| **Custom branding + white-label client portal** | Firm identity preservation. |

### Anti-feature (intentionally omitted)

- **Multi-office** (γραφεία με branches σε Αθήνα + Θεσσαλονίκη + Πάτρα) → Phase 3. <2% of firms 1-30 actually need this.
- **HR/Payroll** → integrate με Erganinet (read-only export).
- **Internal chat/Slack-clone** → universal Teams/Slack adoption.

---

## 4. AEGIS PHASE 1 — Only 4 Agents

Από τα 11 agents της v0.2, **Phase 1 παίρνει μόνο 4**. Όλα τα υπόλοιπα είναι Phase 2 ή Phase 3.

### Phase 1 Aegis (4 agents)

| # | Agent | Role | Justification (γιατί Phase 1) |
|---|-------|------|-------------------------------|
| 1 | **Συγγράμματος (Drafting)** | Generate εξώδικο, αγωγή draft, πληρεξούσιο, εντολή από matter context + party data | Single-biggest selling point. «Γράψε μου εξώδικο κατά Παπαδόπουλου για €5000 χρέος» → 80% ready draft σε 30s. ΟΥΔΕΙΣ Greek competitor το έχει. |
| 2 | **Προθεσμίας (Deadline Extractor)** | Read incoming court document (ΟCR text) → extract trigger event + suggest ΚΠολΔ deadline | Lawsuit-prevention. Συνδυάζεται με ΚΠολΔ engine για auto-deadline suggestion με attorney confirm. |
| 3 | **Ερευνητικός (Legal Research)** | Query Greek legal corpus (24K νόμοι, 236K άρθρα, 1.46M Qdrant points από existing legal-platform) → return relevant articles + ΑΠ jurisprudence με citations | Unfair advantage. Έχουμε ήδη το corpus. Competitors θα χρειαστούν 1-2 χρόνια. |
| 4 | **Αναγνώστης (OCR + PII anonymization)** | Document upload → pytesseract Greek (≥85% accuracy gate) → Presidio + custom Greek regex anonymization πριν LLM call | Foundation for #1, #2, #3. Invariant #5 (no PII to LLM) prerequisite. |

### Phase 2 Aegis (3 agents added)

5. **Περιληπτικός (Summary)** — matter summary, document Q&A
6. **Έλεγκτος (Conflict)** — fuzzy + phonetic + relationship graph
7. **Ταχυδρόμος (Email Classifier)** — auto-file inbound emails to matter

### Phase 3 Aegis (4 agents added)

8. **Πρόσληψης (Intake)** — lead scoring, engagement letter
9. **Λογιστικός (Billing)** — invoice draft, time polish
10. **Χρονογράφος (Time Inferrer)** — passive capture clustering (requires Electron app)
11. **Απολογιστής (NL→SQL Reports)** — natural language analytics

### Cost projection (v0.3)

| Tier | Active firms × users avg | LLM calls/firm/month | Cost/firm/month |
|------|--------------------------|----------------------|-----------------|
| Starter (1 user) | ~50 calls (light use) | $5-10 |
| Professional (4 users) | ~300 calls | $35-50 |
| Firm (12 users) | ~1500 calls | $120-180 |
| Enterprise (25 users) | ~4000 calls | $300-450 |

**Per-firm hard cap** (alert at 80%, hard cutoff at 120% of tier-included quota) — implemented Sprint 6.

---

## 5. PRICING RECALIBRATION

Διατηρώ τη δομή της v0.2 αλλά **προσθέτω volume discounts** για 15-30 range και **annual incentive**.

| Tier | Monthly/user | Annual/user (2 mo free) | Target | Architecture |
|------|--------------|------------------------|--------|--------------|
| **Starter** | **€19** | €190 (€15.83/mo equiv) | Solo | Shared |
| **Professional** | **€39** | €390 (€32.50/mo equiv) | 2-8 lawyers | Shared |
| **Firm** | **€59** | €590 (€49.17/mo equiv) | 8-15 lawyers | Dedicated |
| **Firm 15+** | **€49** (volume discount) | €490 (€40.83/mo equiv) | 15-30 lawyers | Dedicated |
| **Enterprise** | **€79+** custom | Custom | 30+ ή special needs | Dedicated + SLA |

### Volume discount logic (v0.3 NEW)

- Firm tier base €59/user
- 15+ users: 17% discount (€49/user) — **incentivizes mid-market sale**
- 25+ users: 25% discount (€44/user) — **enterprise gateway**
- 30+ users: triggers Enterprise tier (custom pricing με SLA)

### AI usage included per tier

- Starter: 100 AI calls/month per user (≈ 5 drafts + 20 deadline extractions)
- Professional: 500 AI calls/month per user
- Firm: 1500 AI calls/month per user
- Enterprise: unlimited within fair use

Overages: €0.05 per LLM call (Sonnet) or €0.01 (Haiku). Visible in Settings → Usage.

### Free trial

- 30-day free trial **μόνο σε Professional tier** (no credit card)
- Starter tier: lifetime €0 για first 100 signups (acquisition hack via ΔΣΘ partnership)

### Revenue projection (3 years)

| Year | Active firms | Avg ARPU | ARR |
|------|-------------|----------|-----|
| Y1 | 50 | €38 | **€95K** |
| Y2 | 250 | €42 | **€630K** |
| Y3 | 800 | €45 | **€1.95M** |

Break-even: ~120 paying users at avg €40 ARPU = €58K MRR vs ~€55K monthly burn (4.5 FTE post-launch). Year 1.5-2.

---

## 6. TECH STACK FINAL CALL — Simplified

### Decision: **Drop FastAPI. Consolidate σε Next.js + Fastify only.**

v0.2 stack: Next.js 16 + Fastify (business APIs) + FastAPI (Aegis Python) + Postgres + Qdrant + R2 + Redis.

**Πρόβλημα**: FastAPI σαν ξεχωριστό service για Aegis προσθέτει:
- 1 deployment surface
- 1 inter-service contract να maintain
- 1 set of monitoring/logging dashboards
- Python ↔ TypeScript type-mapping overhead
- 50-100ms additional latency per AI call

**v0.3 simplification**:
- **Frontend**: Next.js 16 (App Router, RSC, TypeScript, Tailwind, shadcn/ui)
- **API**: Fastify (Node.js, modular monolith)
- **AI/Aegis**: Native TypeScript service **inside Fastify** (separate plugin: `@themis/aegis`), calls Anthropic SDK directly
- **Anonymization**: TypeScript port of Presidio core OR call Anthropic Constitutional AI for PII redaction (test both σε Sprint 6)
- **OCR**: Worker service με `node-tesseract-ocr` + Greek language pack. Fallback σε AWS Textract για low-confidence pages.
- **DB**: Postgres 17 (Hetzner managed) + Prisma ORM
- **Vector**: Qdrant 1.10+ (existing PC node 10.0.0.10, share with legal-platform)
- **Cache/Queue**: Redis + BullMQ
- **Storage**: Cloudflare R2 (NOT S3)
- **Auth**: NextAuth v5 + JWT για API
- **Hosting**: Hetzner cx41 (1 box) until 50 firms, then cx51 + read replica
- **CDN**: Cloudflare

### What we lose by dropping FastAPI

- Python ML ecosystem (sklearn, transformers) — but we don't need them in Phase 1; LLM does the work
- Presidio Python (mature) — port to TS or use LLM-based PII redaction
- spaCy Greek models — defer to Phase 2 if classifier accuracy demands

### What we gain

- 1 deployment, 1 monitoring, 1 language
- 30-50% latency reduction on Aegis calls
- 1 fewer FTE for Python/TS interop maintenance
- Faster onboarding for new devs (single codebase)

**This is reversible**: αν Phase 2 conflict checker ή time inferrer χρειαστούν Python ML, spin up FastAPI service τότε. Don't pay the tax up front.

---

## 7. SPRINT SEQUENCE — Lean MVP Plan

### Target: Paying customer #1 σε Sprint 6 (Week 12), #10 σε Sprint 12 (Week 24)

**v0.2:** 18 sprints / 9 months / €340K → alpha
**v0.3:** **12 sprints / 6 months / €185K → first 10 paying customers**

Phase 1.5 (sprints 13-18) brings Phase 1 to commercial maturity for ARR €100K+.

### Sprint 1-2 (Weeks 1-4): Foundation + Mobile Shell + Shared-Tenant

**Goal:** Project scaffold, multi-tenant schema architecture, mobile-first responsive baseline, auth.

- Monorepo (Turborepo)
- Next.js 16 + Tailwind + shadcn/ui mobile-first shell
- Fastify with plugin architecture
- Postgres schema-per-tenant (NEW v0.3): provisioning script `create_tenant.sh` που spawns `tenant_X` schema με όλα τα 14 module tables
- Prisma με `multi-schema` preview feature
- search_path middleware (Fastify hook reads JWT → sets `SET search_path`)
- Postgres RLS policies σε όλους τους tables (defense-in-depth)
- JWT auth + 4 built-in roles
- Audit log table (shared, partitioned monthly, RLS by tenant_id)
- Docker Compose dev env
- GitHub Actions CI
- Landing page + login

**Acceptance:** New firm provisioning <5 min. Mobile login works on iPhone 13. Schema-per-tenant tested με 3 hypothetical firms. RLS prevents cross-tenant query in pen-test.

**Team:** 2 full-stack + 1 designer

---

### Sprint 3-4 (Weeks 5-8): Parties + Matters + Greek Essentials

**Goal:** Unified Party Model, Matter↔Party M2M, AFM validation, Greek phonetic MVP, courts seed.

- `party` CRUD (persons + companies + government)
- `party_role` + `party_relationship`
- AFM check-digit validation
- Greek phonetic library MVP (Beider-Morse port + 200-pair lookup table)
- PII envelope encryption (per-tenant DEK)
- `matter` CRUD (NO `client_id` — only `matter_party` M2M)
- `matter_party` rich M2M (role, side, primary_client validation)
- Courts seed: 300 most common (πρωτοδικεία, εφετεία, ΑΠ, ΣτΕ — όχι ειρηνοδικεία πλήρως)
- GDPR consent at intake
- Custom fields (JSONB)
- Conflict check basic (name + AFM + phonetic)

**Acceptance:** Cannot create matter without primary client. Phonetic recall ≥80% σε 30-pair test. Conflict check <500ms σε 5K-party DB.

**Team:** 2 full-stack + 0.5 designer

---

### Sprint 5 (Weeks 9-10): Documents + OCR + Calendar + ΚΠολΔ Engine

**Goal:** DMS, Greek OCR, calendar with ΚΠολΔ deadlines.

- Document upload to R2 (presigned URLs, encrypted)
- Document metadata + version control
- Folder per matter + Σχετικά numbering
- Privilege tags (none, attorney_client, work_product)
- BullMQ OCR worker (Tesseract Greek)
- OCR ≥85% gate (lower than v0.2 90% for shipping speed)
- Document viewer (PDF preview)
- Calendar CRUD + month/week/day views
- ΚΠολΔ rules engine (top 30 rules — not all 50+)
- External attorney sign-off **gating** Sprint 5 close (€2K external counsel)
- Greek holidays (fixed + Orthodox Easter variable)
- Court recess (KPolD 147)
- Deadline alerts (email + in-app, no SMS Phase 1)

**Acceptance:** Deadline external sign-off completed. OCR ≥85% on 30 Greek docs. Calendar mobile-usable.

**Team:** 2 full-stack + 1 AI/ML for OCR worker

---

### Sprint 6 (Weeks 11-12): Time + Billing + myDATA + ΔΣΑ + Aegis Drafting → **PAYING CUSTOMER #1**

**Goal:** Time-to-invoice complete, myDATA live, first AI agent shipped.

- Manual time entry + start/stop timer
- Rate cards (single rate per attorney Phase 1)
- Invoice creation from time + expenses
- Invoice PDF generation (bilingual EL/EN)
- myDATA AADE integration (ΔΑ + ΑΠΥ types 2.1)
- 15% withholding + 24% VAT auto-calculation
- ΔΣΑ Γραμμάτιο calculator
- TAXISnet OAuth library (FOR myDATA only Phase 1)
- Settings: EFKA/EAAΔ rates editable
- **Aegis Agent #1: Συγγράμματος (Drafting)** — εξώδικο + αγωγή draft templates
- **Aegis Agent #4: Αναγνώστης (OCR + PII anonymization)** — feeds Drafting

**Acceptance:** myDATA sandbox: 50 test invoices succeed. Drafting agent passes 1-of-3 review by Greek attorney. **First firm onboarded as paying customer (Niko's network — friendly user).**

**Team:** 2 full-stack + 1 AI/ML

---

### Sprint 7-8 (Weeks 13-16): Polish + Phase 1.5 Bridge + Customer #2-5

**Goal:** Stabilize, fix top 20 bugs from Customer #1 feedback, onboard 4 more.

- 3 hardcoded dashboards (Financial, Matter Status, Bar Stamps)
- Conflict check polish (graph traversal)
- Bulk import (parties from CSV, matters from Excel)
- Email integration: forward `matter-{code}@firm.themis.gr` → auto-attach to matter (NO classification yet)
- AI Drafting templates expansion (πληρεξούσιο, εντολή, αίτηση ασφαλιστικών)
- **Aegis Agent #3: Ερευνητικός (Legal Research)** — Greek corpus integration via existing legal-platform
- Notification system (email + in-app)
- Performance pass (queries, indexes)

**Acceptance:** Customer #1 NPS ≥7. Customers #2-5 onboarded. Aegis Research agent answers «βρες μου ΑΠ αποφάσεις για άρθρο 281 ΑΚ» με citations.

**Team:** 2 full-stack + 1 AI/ML

---

### Sprint 9-10 (Weeks 17-20): Hearings + Bar Stamps + Aegis #2 + Customer #6-10

**Goal:** Hearings module, AI deadline extraction, mid-market readiness.

- Hearings CRUD (date, court, courtroom, side, opponent, αντίκλητος)
- **Daily List PDF "ΗΜΕΡΗΣΙΑ ΔΙΚΑΣΙΜΟΣ"** (court-resilient export)
- Bar stamp issuance flow (link to hearing + matter)
- ΔΣΑ monthly report export
- **Aegis Agent #2: Προθεσμίας (Deadline Extractor)** — read OCR'd court doc → suggest ΚΠολΔ deadline
- Conflict check at scale (5K → 50K parties optimization)
- Multiple rates per matter (Firm tier feature)

**Acceptance:** Daily list PDF prints on court network <2s. Customer #10 onboarded. Aegis deadline extractor 70% accurate on 50-doc test set.

**Team:** 2 full-stack + 1 AI/ML

---

### Sprint 11-12 (Weeks 21-24): Hardening + Security + Compliance Sign-off

**Goal:** Production-ready, security-audited, compliance-blessed.

- Backup/DR test (4h RTO, 15min RPO)
- ninurta security audit (full)
- GDPR + N.4624/2019 compliance review
- Pseudonymization for closed matters
- Departments lite (Firm tier)
- Role-based permissions matrix expansion
- Document templates library + variables (firm-shared)
- Settings polish (firm profile, users, courts, rates)
- Stripe + Viva Wallet payment integration (subscription billing)
- Self-service signup flow (Starter tier)
- 30-day free trial mechanism

**Acceptance:** ninurta: no high-severity. DR test passed. Self-service signup → first matter <5 min. Stripe webhook tested.

**Team:** 2 full-stack + 1 ninurta + 1 designer

---

### Phase 1.5 (Sprints 13-18, Months 7-9) — Commercial Maturity

| Sprint | Focus |
|--------|-------|
| 13 | Client Portal lite (read-only invoice + status) |
| 14 | SOLON wrapper (ZIP package + manual upload UX) |
| 15 | Email auto-classification (Aegis #7 Tachydromos) |
| 16 | Aegis #5 Summary + Aegis #6 Conflict (advanced) |
| 17 | Trust accounting basic (2-way recon) — Firm tier |
| 18 | Multi-tier invoice approval + team analytics |

**Target end of Phase 1.5:** ARR €100K+, 50 paying firms, NPS ≥8.

---

### Sprint summary table

| Sprint | Weeks | Milestone | Customers |
|--------|-------|-----------|-----------|
| 1-2 | 1-4 | Foundation + multi-tenant + auth | 0 |
| 3-4 | 5-8 | Parties + Matters + Greek essentials | 0 |
| 5 | 9-10 | Documents + Calendar + ΚΠολΔ | 0 |
| 6 | 11-12 | Time + Billing + myDATA + Aegis Drafting | **#1** |
| 7-8 | 13-16 | Polish + Aegis Research + onboard | #2-5 |
| 9-10 | 17-20 | Hearings + Bar Stamps + Aegis Deadline | #6-10 |
| 11-12 | 21-24 | Hardening + security + self-service signup | Public launch |
| 13-18 | 25-36 | Phase 1.5 commercial maturity | 50 firms / €100K ARR |

---

## 8. RISK REGISTER — Top 5 Project-Killers

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| 1 | **PMF miss: built wrong product, no one buys at €19-39** | Medium | Critical | (a) Onboard Customer #1 by Sprint 6 (10 weeks of dev, then real $$). (b) Niko network lead conversion = friendly user feedback. (c) ΔΣΘ partnership pre-secured before Sprint 1 (warm pipeline). (d) Ready to pivot pricing or scope after Customer #5 if ARR/MRR signals weak. |
| 2 | **ΚΠολΔ rule incorrect → client loses case → malpractice lawsuit** | Low | Catastrophic | (a) Top 30 rules only Phase 1 (less surface). (b) External practicing-attorney sign-off **gating** Sprint 5 close (€2-3K). (c) UI banner: «Επαληθεύστε την προθεσμία — η εφαρμογή είναι βοηθητική, όχι αυθεντική». (d) Liability disclaimer in ToS. (e) Annual rule re-validation. |
| 3 | **myDATA / TAXISnet API instability blocks billing** | Medium | High | (a) Robust retry queue (exponential backoff, 24h max). (b) Manual transmission UI as fallback. (c) Status dashboard for firm admin. (d) Pre-launch: 100 test invoices in AADE sandbox. (e) Idempotency keys με content hash to prevent duplicates. |
| 4 | **AI hallucination σε νομικό κείμενο → reputational damage** | Medium | High | (a) Mandatory «AI Draft» yellow banner non-dismissable. (b) Citation validator: every case-law reference real-time verified against `case_law` table; fictional → red banner block submit. (c) Human-in-the-loop Invariant #8 enforcement at API level. (d) Per-firm AI usage cap. (e) Customer education at onboarding: «AI is junior associate, not partner». |
| 5 | **Tenant isolation breach (cross-firm data leak in shared tier)** | Low | Catastrophic | (a) Schema-per-tenant + search_path enforcement + Postgres RLS = 3 layers of defense. (b) ninurta penetration test before Sprint 12 close. (c) Automated test suite: 100 cross-tenant query attempts must all return 0 rows. (d) Data leak = €20M GDPR fine + immediate end-of-business; treat as P0 always. (e) Quarterly external pen-test post-launch. |

### Secondary risks (monitored but not P0)

- Greek OCR <85% on legacy fax docs → fallback Textract OK
- Alma adds AI in 12-18 months → speed-to-market is our moat
- Hetzner downtime → multi-region R2 + Postgres standby Phase 1.5
- Niko's firm not pilot-able (1000+ εξωδικαστικός cases) → pilot με ΔΣΘ contacts as planned

---

## 9. GO / NO-GO CRITERIA — €185K Commitment Gate

Before Niko commits €185K, **ALL** of the following must be TRUE. Any single FALSE = NO-GO.

### Architectural readiness

- [ ] Invariant #6 v0.3 (two-tier) **explicitly approved** by Niko in writing
- [ ] Daedalus reviewed schema-per-tenant approach + RLS policy + envelope encryption design
- [ ] Tech stack simplification (drop FastAPI) approved
- [ ] Aegis 4-agent Phase 1 list approved
- [ ] All 10 invariants (1-5, 7-10 unchanged + 6 new) documented and accepted

### Market readiness

- [ ] ΔΣΘ Θεσσαλονίκης partnership **at least verbally agreed** (warm contact secured)
- [ ] At least 3 friendly Sprint 6 pilot candidates identified by name
- [ ] Pricing €19/€39/€59/€49(15+)/€79+ approved
- [ ] Self-service signup Phase 1.5 plan approved (NOT enterprise-only)

### Compliance readiness

- [ ] External practicing attorney engaged for ΚΠολΔ sign-off (€2-3K reserved)
- [ ] DPO consultation scheduled for GDPR/N.4624/2019 review
- [ ] myDATA sandbox access confirmed for AADE testing

### Team readiness

- [ ] 2 full-stack TypeScript devs identified (hire or assign from MECE pool)
- [ ] 1 AI/ML engineer identified (TS-comfortable, can do prompt engineering + RAG)
- [ ] 0.5 DevOps for Hetzner + Cloudflare ops
- [ ] 0.5 designer for mobile-first responsive
- [ ] dokimasia QA gate process committed
- [ ] hermes deployment process committed

### Financial readiness

- [ ] €185K Phase 1 budget committed (vs €340K v0.2 — 46% reduction)
- [ ] ~€55K/month burn from Sprint 1 acceptable
- [ ] Year 1 ARR target €95K acceptable (recovers ~50% of dev cost; remainder = strategic investment)
- [ ] Year 2 break-even acceptable (~120 paying users at €40 ARPU)

### Risk acceptance

- [ ] Niko accepts that Customer #1 = Niko's network friendly user, not arms-length ΔΣΘ pilot
- [ ] Niko accepts SOLON wrapper deferred to Phase 1.5 (manual SOLON workflow Phase 1)
- [ ] Niko accepts ΑΠΕΔ deferred to Phase 1.5 (manual «click to portal.olomeleia.gr» Phase 1)
- [ ] Niko accepts Trust accounting deferred to Phase 1.5 (Firm tier only)
- [ ] Niko accepts NO Auto Time Capture in Phase 1 (Phase 3)

**If even one box unchecked: NO-GO. Period.**

---

## 10. BUDGET — Phase 1 (€185K) and Phase 1.5 (+€110K)

### Phase 1 (Sprints 1-12, 6 months)

| Item | Monthly | Total (6 mo) |
|------|---------|--------------|
| Engineering (4 FTE: 2 full-stack + 1 AI/ML + 0.5 designer + 0.5 DevOps) | €25,000 | €150,000 |
| Infrastructure (Hetzner cx41 + Cloudflare + Qdrant on PC) | €350 | €2,100 |
| LLM API (dev + testing + first 10 customers) | €600 | €3,600 |
| Design tools | €100 | €600 |
| External attorney (ΚΠολΔ sign-off + 3 review checkpoints) | — | €3,500 |
| myDATA AADE sandbox + production test invoices | — | €500 |
| Payment integration (Stripe + Viva Wallet setup) | — | €1,500 |
| Security audit (ninurta external, Sprint 11) | — | €4,000 |
| GDPR/N.4624 DPO consultation | — | €2,500 |
| Domain + SSL + monitoring (Sentry + Grafana) | €150 | €900 |
| Buffer (15%) | — | €15,800 |
| **Phase 1 Total** | | **~€185,000** |

### Phase 1.5 (Sprints 13-18, +3 months)

| Item | Total (3 mo) |
|------|--------------|
| Engineering continued (4 FTE) | €75,000 |
| Infra scale (cx51 + read replica) | €1,500 |
| LLM API (50 firms scale) | €4,500 |
| SOLON external practitioner review | €2,500 |
| ΑΠΕΔ practitioner review | €2,000 |
| Marketing (ΔΣΘ partnership activation, Athens Legal Tech sponsor) | €15,000 |
| Customer success (1 part-time hire) | €6,000 |
| Buffer | €3,500 |
| **Phase 1.5 Total** | **~€110,000** |

### Total Phase 1 + 1.5 = €295K

vs v0.2 Phase 1 = €340K. **v0.3 saves €45K AND ships 6 months earlier AND has paying customers from Month 3.**

---

## 11. WHAT v0.3 INHERITS UNCHANGED FROM v0.2

To be explicit — these v0.2 decisions are **kept**:

- Data model: 65 tables, Unified Party Model, Matter↔Party M2M (although only 14 modules' tables built Phase 1)
- All architectural cleanup from v0.2.B-C (no `client_id`, no residual `tenant_id` ambiguity)
- New tables added in v0.2: `email_*`, `time_capture_*`, `portal_*`, `report_dashboard`, `saved_query`, `aped_*`, `solon_filing`, `bar_rate_config`, `trust_*` — schema **kept** (idle Phase 1) so Phase 2 doesn't need migrations
- Greek compliance philosophy: myDATA, ΔΣΑ, ΚΠολΔ, GDPR derogation per N.4624/2019 §31
- KMS per-tenant DEK + envelope encryption pattern
- Audit log append-only, partitioned monthly
- Mobile-first responsive (NOT mobile-friendly)
- Aegis hub-and-spoke architecture (just 4 spokes Phase 1 instead of 8-11)
- 11 AI agents **named** (just 4 built Phase 1)

---

## 12. WHAT NIKO MUST DECIDE NEXT (in order)

1. **GO / NO-GO on §9 criteria** — binary, today
2. **Approve Invariant #6 v0.3 rewrite** — written confirmation
3. **Approve tech stack simplification (drop FastAPI)** — written confirmation
4. **Identify ΔΣΘ contact for partnership outreach** — Niko's network
5. **Identify 3 Sprint 6 friendly pilot candidates by name** — Niko's network
6. **Approve €185K Phase 1 budget commitment** — financial
7. **Confirm Pericles authority to dispatch Daedalus for v0.3 spec rewrite** — orchestration
8. **Schedule weekly Niko sync** — accountability rhythm

After all 8: Pericles dispatches:
- **Daedalus** → v0.3 detailed spec rewrite (data-model.md additions for schema-per-tenant; tech-stack.md FastAPI removal; build-plan.md 12-sprint rewrite)
- **themis** → ΚΠολΔ external attorney engagement
- **ninurta** → security audit plan for Sprint 11
- **prometheus** → evaluate if new specialist needed for «multi-tenant Postgres expert»

---

## 13. CLOSING (Pericles voice)

Νίκο,

Η v0.2 ήταν στρατιωτική παρέλαση: επιβλητική, πλήρης, υπερασπίσιμη σε κάθε CFO. Η v0.3 είναι μάχη: γρήγορη, στοχευμένη, σχεδιασμένη να κατακτήσει το πρώτο λόφο πριν ο εχθρός (Alma + AI σε 12 μήνες) προλάβει.

Η αλλαγή που κάνω **δεν είναι downgrade**. Είναι **focus**. Όλα τα features της v0.2 παραμένουν στο roadmap — μετακινούνται απλώς σε Phase 1.5, 2, 3, ώστε να μην πεθάνει το project περιμένοντας SOLON wrapper που θα χρησιμοποιήσουν 3 γραφεία τον πρώτο χρόνο.

Το single-tenant blanket policy θα μας σκότωνε. Το two-tier είναι **τεχνικά υγιές** (Postgres schema isolation + RLS + envelope encryption είναι production-grade pattern, όχι hack) και **οικονομικά απαραίτητο** για €19/μήνα solo πελάτες.

4 AI agents αντί 11 = εστιασμένη παράδοση. Ο Συγγράμματος μόνος του δικαιολογεί το PROFESSIONAL tier. Το έχουμε ξανακάνει: legal-platform έχει ήδη το corpus, ξέρουμε τι μπορεί ο Sonnet σε ελληνικά νομικά.

12 sprints αντί 18, με paying customer στον 3ο μήνα, σημαίνει ότι **η αγορά μας λέει αν είμαστε σωστά** πριν κάψουμε όλο το capital. Αν Customer #1-#5 πει «δεν αξίζει €39/μήνα», pivot. Αν πει «ναι, αλλά λείπει X», prioritize X. Αν πει «εξαιρετικό», scale.

Θεμέλια που αντέχουν αιώνες χτίζονται με σωστή μέτρηση και υπομονή. Αλλά πρέπει πρώτα να επιβιώσει το κτίριο μέχρι να φτάσει στα θεμέλια. Η v0.3 είναι το «επιβίωσε στον πρώτο σεισμό» στρατήγημα.

Περιμένω τη GO/NO-GO απάντησή σου στα 8 σημεία του §12.

— Περικλής

---

*End of v0.3 Proposal. Filed by Pericles. Awaits Niko approval.*
*Next document upon GO: `v0.3-detailed-spec/` directory authored by Daedalus.*
