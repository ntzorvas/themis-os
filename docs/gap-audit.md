# ΘΕΜΙΣ OS — Competitor Gap Audit
**Date:** 2026-04-28
**Auditor:** Άργος (System Auditor)
**Mode:** audit (full 6-step methodology)
**Scope:** ΘΕΜΙΣ OS specs (7 files, 34 modules, 54 tables, ~150 endpoints, 8 AI agents) vs. global + Greek competitor stack (Clio, Smokeball, PracticePanther, MyCase, LEAP, Perfex, Odoo, ORBIT, Thesis, Alma, Harvey, CoCounsel, iManage, 3E)
**Target persona:** Enterprise ελληνικά γραφεία 20-50+ δικηγόρων (KG Law, Karatzas, Zepos & Yannopoulos tier-out, mid-market sweet spot)

---

## 1. EXECUTIVE SUMMARY

**Total gaps identified:** 38
- **High-impact (must add to Phase 1 lock):** 9
- **Medium-impact (Phase 2 acceptable):** 14
- **Low-impact (nice-to-have / Phase 3):** 9
- **Overscoped / candidate for cut or defer:** 6

**Σύντομη κρίση:** Το spec είναι **80% ώριμο** και **20% λείπει ή είναι misplaced**. Καλύπτει εξαιρετικά το Greek-specific stack (myDATA, ΔΣΑ Γραμμάτιο, ΚΠολΔ, SOLON-ready, ΑΠΕΔ). Παραλείπει 9 enterprise table-stakes που ο ανταγωνισμός θεωρεί δεδομένα και που οι 50-lawyer ελληνικοί πελάτες θα ζητήσουν ως **deal breakers**: settlement/PI calculator absence (acceptable for non-PI focus), automatic time capture (Smokeball killer feature), LEDES export (in-scope but unscheduled), three-way reconciliation moved to Phase 2 (risky), email 2-way sync deferred (risky), structured **invariant inconsistency** (Unified Party Model declared αλλά ο `matter` πίνακας ακόμα έχει `client_id` και υπάρχει legacy `client` table reference στο `aml_check`).

**Το πιο σοβαρό architectural finding:** Τα invariants `#1` και `#2` (Unified Party Model + Matter↔Party M2M) δηλώνονται "FOUNDATIONAL" αλλά **το ίδιο data-model.md παραβιάζει και τα δύο**. Αν αυτό προχωρήσει στο build χωρίς διόρθωση, θα προκύψει refactor cost σε Sprint 13+ που θα χτυπήσει billing ↔ matter ↔ party scope.

**Κρίσιμη χρονική παρατήρηση:** Ν.5221/2025 ισχύει ΗΔΗ από 1.1.2026. Το spec τοποθετεί **SOLON e-filing σε Phase 2** (Sprints 23-24, ~6 μήνες μετά Phase 1 GA). Αυτό σημαίνει ότι κατά τη διάρκεια pilot το feature που "πρέπει να αγοράσει ο πελάτης" δεν θα είναι έτοιμο. **Πιθανό P0 re-scope.**

---

## 2. PURPOSE CHECK

**Stated purpose** (από docs):
> Premium enterprise legal practice management platform για ελληνικά γραφεία 20-50+ δικηγόρων, με native AI που γνωρίζει ελληνικό δίκαιο, full Greek compliance (myDATA, ΔΣΑ, ΚΠολΔ, SOLON, ΑΠΕΔ), single-tenant DB per firm, premium pricing €89-149/user/month.

**Actual specification behavior:**
- 34 modules planned, 16 σε Phase 1, 11 σε Phase 2, 7 σε Phase 3
- 54 PostgreSQL tables, ~150 REST endpoints, 8 AI agents
- 9-month MVP (€250K Phase 1 budget)
- AI = Aegis hub-and-spoke, Claude-based, με PII anonymization

**Gap (stated vs. actual):**
- Stated **"premium enterprise"** αλλά Phase 1 παραλείπει 4 features που πραγματικά enterprise firms θεωρούν deal-breaker: trust accounting, full GL accounting, advanced reporting, client portal
- Stated **"AI-native"** αλλά Aegis αποκαλείται "AI nervous system" ενώ ταυτόχρονα ο spec λέει «AI failure must NEVER block core operations» — fine αρχιτεκτονικά, αλλά αυτό σημαίνει ότι το πραγματικό value proposition (AI ως διαφοροποιητής) είναι **optional layer**, όχι core
- Stated **"single-tenant per firm"** αλλά infrastructure περιγράφει `tenant_id` σε όλους τους πίνακες (που είναι multi-tenant pattern). Σύγχυση: είτε per-firm DB (όπως λέει tech-stack.md) είτε row-level isolation με tenant_id (όπως δείχνει το schema). Πρέπει να διευκρινιστεί.

---

## 3. USER JOURNEY MAP

### Journey A — Νέος πελάτης → Κατάθεση αγωγής → Τιμολόγηση
1. Lead capture (web form) ✅
2. Conflict check ✅
3. Engagement letter + e-sig (✅ simple, ⚠️ ΑΠΕΔ qualified σε Phase 2)
4. Matter creation ✅
5. Document drafting (AI-assisted) ✅ Sprint 9-10
6. **e-Paravolo calculation + payment** ❌ Phase 2 — friction: manual entry
7. **SOLON e-filing** ❌ Phase 2 — friction: αρχικός χρήστης κάνει manual upload στο gov portal, αντιγράφει αρ. κατάθεσης πίσω στο matter
8. Hearing scheduling + ΔΣΑ Γραμμάτιο ✅
9. Time tracking ✅
10. Invoice + myDATA ✅
**Friction points:** Step 6+7 σπάνε το user journey ακριβώς στο feature που είναι το #1 selling point (Ν.5221/2025).

### Journey B — Daily attorney workflow
1. Open daily hearing list ✅
2. Run pre-hearing AI briefing ✅
3. Court appearance, log outcome ✅
4. **Auto time capture** ❌ Smokeball-style passive tracking ΟΧΙ στο spec
5. Manual time entry ✅
6. **Email auto-filing to matter** ❌ Sprint 17-18 «communication log (manual logging)» — αυτό είναι Clio/Smokeball table-stake, όχι "manual"
**Friction:** Manual time capture + manual email filing = 30-60 min/day χαμένου χρόνου ανά δικηγόρο

### Journey C — Partner / managing partner workflow
1. Financial dashboard ✅
2. WIP report ✅
3. **Trust account 3-way reconciliation** ❌ Phase 2
4. **Profitability per matter** ✅ (αλλά εξαρτάται από Phase 2 reports module)
5. **Industry benchmarking** ❌ Phase 4 (Clio Data competitor)
6. **Approval workflows (invoice, expense)** ✅ partial
**Friction:** Partner δεν έχει "control panel" σε Phase 1 — φαίνεται κενό για 50-lawyer firm

### Journey D — Client journey (external)
1. Receive invoice email ✅
2. **Client portal access** ❌ Phase 2 (Sprints 25-26)
3. **Online payment** ❌ Phase 2
4. **Document download from portal** ❌ Phase 2
**Friction:** Όλο το client portal = Phase 2. Για enterprise pitch, το portal είναι table-stake — κάθε ανταγωνιστής το έχει.

---

## 4. GAP INVENTORY (Module-by-Module Matrix)

Συμβολισμός: ✅ έχουμε / ❌ λείπει / 🟡 μερικά / ⭐ unique-to-us / ⏰ Phase 2-3

| # | Module | ΘΕΜΙΣ OS | Clio | Smokeball | PracticePanther | ORBIT | Thesis | GAP severity |
|---|--------|----------|------|-----------|-----------------|-------|--------|--------------|
| 1 | Clients/Parties | ✅⭐ Unified Party Model | ✅ | ✅ | ✅ | ✅ | ✅ | OK (architectural advantage IF invariant enforced) |
| 2 | Matters | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | OK |
| 3 | Calendar/Hearings | ✅ + ΚΠολΔ ⭐ | ✅ (US rules) | ✅ (AU/UK) | ✅ | 🟡 | 🟡 | OK |
| 4 | Documents/DMS | ✅ + Σχετικά ⭐ | ✅ unlimited | ✅ + auto-save | ✅ unlimited | 🟡 | 🟡 | OK |
| 5 | Time Tracking | ✅ manual | ✅ manual | ✅ **AUTO** | ✅ manual | ✅ | ✅ | **GAP: no auto capture** |
| 6 | Billing/Invoicing | ✅ + myDATA ⭐ | ✅ | ✅ + LEDES | ✅ + LEDES | ✅ | ✅ | OK (LEDES υπάρχει στο spec) |
| 7 | Accounting/GL | ⏰ Phase 2 | ❌ | ✅ | ✅ (Biz+) | ❌ | ❌ | OK (Phase 2 acceptable) |
| 8 | Trust Accounting | ⏰ Phase 2 | ✅ | ✅ | ✅ | ❌ | ❌ | **GAP: enterprise table-stake** |
| 9 | ΔΣΑ Bar Stamp | ✅⭐ | ❌ | ❌ | ❌ | 🟡 manual | ❌ | UNIQUE WIN |
| 10 | Court Fees / e-Paravolo | ⏰ Phase 2 | ❌ | ❌ | ❌ | 🟡 manual | ❌ | OK (no comp.) but Greek users will demand |
| 11 | Intake/CRM | ✅ | ✅ Grow | ❌ | ✅ | 🟡 | ❌ | OK |
| 12 | Correspondence/Πρωτόκολλο | ✅⭐ | 🟡 | ✅ email auto | 🟡 | ✅ | ✅ | **GAP: Phase 1 «manual logging»** |
| 13 | SOLON e-Filing | ⏰ Phase 2 | N/A | N/A | N/A | ❌ | ❌ | **CRITICAL GAP — Ν.5221/2025 ηδη ενεργός** |
| 14 | Digital Signatures (ΑΠΕΔ) | ⏰ Phase 2 | ✅ DocuSign | ✅ DocuSign | ✅ | ❌ | ❌ | **GAP: Phase 2 risky** |
| 15 | Legal Research | ⏰ Phase 2 (basic Phase 1) | ✅ Westlaw integ | ✅ LawY | ❌ | ❌ | ❌ | OK (corpus moat is real) |
| 16 | Workflow Engine | ⏰ Phase 2 | ✅ | ✅ Archie Apps | ✅ | ❌ | ❌ | **GAP: Phase 2 — competitors built-in** |
| 17 | Team & Roles | ✅ + Ethical Wall ⭐ | 🟡 | ❌ | ❌ | ❌ | ❌ | UNIQUE WIN |
| 18 | Client Portal | ⏰ Phase 2 | ✅ | ✅ | ✅ | ❌ | ❌ | **MAJOR GAP** |
| 19 | Expenses & Disbursements | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | OK |
| 20 | Reports/BI | ⏰ Phase 2 | ✅ + Clio Data | ✅ | ✅ | 🟡 basic | ❌ | **GAP** |
| 21 | Conflict Check | ✅ + AI fuzzy ⭐ | ✅ | ✅ | ✅ | ❌ | ❌ | OK (better than Greek comp.) |
| 22 | Contracts/Engagement | ✅ | ✅ | ✅ | ✅ | 🟡 | ❌ | OK |
| 23 | Hearings & Appearances | ✅ + Αντίκλητος ⭐ | ✅ | ✅ | ✅ | ✅ | ✅ | UNIQUE bits |
| 24 | Legal Deadlines (KPolD) | ✅⭐ | ✅ (US) | ✅ (AU/UK) | ✅ (US) | ❌ | ❌ | UNIQUE WIN |
| 25 | Judgments/Enforcement | ⏰ Phase 3 | ❌ | ❌ | ❌ | 🟡 | ❌ | OK (Phase 3 fine) |
| 26 | Physical File Mgmt | ⏰ Phase 3 | ❌ | ❌ | ❌ | ❌ | ❌ | OK — overscoped, can defer |
| 27 | CLE Tracking | ⏰ Phase 3 | ❌ | ❌ | ❌ | ❌ | ❌ | OVERSCOPED — drop or defer |
| 28 | Referrals | ⏰ Phase 3 | 🟡 | ❌ | ✅ | ❌ | ❌ | OK |
| 29 | HR/Payroll | ⏰ Phase 3 | ❌ | ❌ | ❌ | ❌ | ❌ | **OVERSCOPED — drop entirely, leave to Erganinet/εξωτερικό λογιστή** |
| 30 | Internal Comms | ⏰ Phase 2 | ❌ | ❌ | ❌ | 🟡 task assignment | ❌ | OVERSCOPED — Slack/Teams existent, defer |
| 31 | Business Development CRM | ⏰ Phase 3 | 🟡 | ❌ | 🟡 | ❌ | ❌ | OVERSCOPED — drop or defer |
| 32 | Integrations Hub | ✅ planned | ✅ 300+ | ✅ | ✅ | ❌ | ❌ | OK |
| 33 | Mobile App | ⏰ Phase 3 | ✅ | ✅ | ✅ | ❌ | ❌ | **GAP — Phase 3 too late for enterprise pitch** |
| 34 | Settings & Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | OK |
| -- | **AI Layer (Aegis)** | ✅⭐ Greek-native | ✅ Manage AI | ✅ Archie | ❌ | ❌ | ❌ | UNIQUE WIN |
| -- | **Legal Corpus (24K laws)** | ✅⭐ | ❌ | ❌ | ❌ | ❌ | ❌ | UNIQUE MOAT |

---

## 5. CRITICAL GAPS (Deal-breakers για enterprise)

### Gap Inventory Scoring Table

| # | Gap | Category | Impact | Effort | Urgency | Priority Score |
|---|-----|----------|--------|--------|---------|----------------|
| G1 | SOLON e-filing → Phase 1 (Ν.5221/2025 ήδη ενεργός) | Missing/Misplaced | 5 | 4 | 5 | 6.25 |
| G2 | Architectural invariant violation: matter.client_id + legacy client table refs | Broken | 5 | 2 | 5 | 12.5 |
| G3 | Trust accounting → Phase 1 (ΕΔΕ compliance) | Missing | 4 | 3 | 4 | 5.33 |
| G4 | Client portal → Phase 1 (table-stake για enterprise pitch) | Missing | 4 | 4 | 3 | 3.0 |
| G5 | Email 2-way auto-sync (Gmail/Outlook → matter auto-file) | Inefficient | 5 | 3 | 4 | 6.67 |
| G6 | Automatic time capture (Smokeball-style) | Missing | 4 | 4 | 2 | 2.0 |
| G7 | Reports/BI dashboard → Phase 1 (partner control panel) | Missing | 4 | 3 | 3 | 4.0 |
| G8 | LEDES 1998B export — βρίσκεται στο spec αλλά χωρίς sprint allocation | Undocumented | 3 | 2 | 3 | 4.5 |
| G9 | Workflow engine → Phase 1 lite (matter stage triggers) | Missing | 4 | 3 | 3 | 4.0 |
| G10 | ΑΠΕΔ qualified e-sig → Phase 1 (Greek e-filing requires it) | Missing | 5 | 3 | 5 | 8.33 |
| G11 | Mobile app → Phase 2 (currently Phase 3, εξαιρετικά αργά) | Missing | 4 | 5 | 2 | 1.6 |
| G12 | Hearing daily list view + offline mode (court usability) | Inefficient | 4 | 2 | 4 | 8.0 |
| G13 | Phase 1 Risk Register δεν αναφέρει Ν.5221/2025 ως risk | Undocumented | 3 | 1 | 4 | 12.0 |
| G14 | matter_party schema duplicates party data instead of FK to party | Broken | 4 | 2 | 4 | 8.0 |
| G15 | Document privilege tag exists but no enforcement spec for AI search | Inconsistent | 4 | 2 | 3 | 6.0 |
| G16 | aml_check.client_id → πρέπει να είναι party_id (invariant violation) | Broken | 3 | 1 | 3 | 9.0 |
| G17 | tenant_id σε όλα τα tables αλλά spec λέει "single-tenant DB per firm" | Inconsistent | 3 | 2 | 2 | 3.0 |
| G18 | Greek phonetic matching (Ιωάννης/Γιάννης) — no algorithm specified | Undocumented | 3 | 3 | 3 | 3.0 |
| G19 | Court database 400+ courts seed source not identified | Undocumented | 3 | 4 | 3 | 2.25 |
| G20 | EFKA/EADD rate update mechanism (annual changes) — no admin UI plan | Undocumented | 3 | 2 | 2 | 3.0 |
| G21 | KPolD rules engine: 50+ rules listed but no validation by practicing attorney scheduled | Inefficient | 5 | 1 | 5 | 25.0 |
| G22 | Sxetiko numbering: per-matter sequence, but no spec for cross-matter document references | Undocumented | 2 | 1 | 2 | 4.0 |
| G23 | Audit log GDPR right-to-erasure conflict (immutable vs. erasure) — no policy | Missing | 4 | 2 | 4 | 8.0 |
| G24 | dikes.moj.gov.gr status pull → Phase 2 (matter timeline value lost) | Inefficient | 3 | 3 | 3 | 3.0 |
| G25 | GEMI integration για company data lookup — listed Phase 1 (Module 1 AI) but no Sprint allocation | Undocumented | 3 | 3 | 2 | 2.0 |
| G26 | TAXISnet OAuth flow — no Phase 1 plan even though SOLON requires it | Missing | 4 | 3 | 4 | 5.33 |
| G27 | Approval matrix για invoices: 1-step approval defined, multi-tier για enterprise (managing partner + accountant) | Inefficient | 3 | 2 | 2 | 3.0 |
| G28 | OCR Greek language pack quality — no benchmark target % accuracy | Undocumented | 3 | 1 | 3 | 9.0 |
| G29 | Backup & DR: pg_dump + WAL αναφέρεται, αλλά no RTO/RPO target | Undocumented | 4 | 1 | 3 | 12.0 |
| G30 | PII encryption blind index strategy — performance untested at scale | Undocumented | 4 | 2 | 3 | 6.0 |
| G31 | LLM hallucination "mitigated by human-in-the-loop" — no UX pattern spec | Inefficient | 3 | 2 | 2 | 3.0 |
| G32 | Per-tenant LLM cost cap enforcement — alerts only, no hard cutoff | Inefficient | 3 | 2 | 2 | 3.0 |
| G33 | Module 29 HR/Payroll: overscoped vs. ERP, no firm uses legal SaaS for payroll | Overscoped | 1 | 5 | 1 | 0.2 |
| G34 | Module 30 Internal Comms (Slack-clone): overscoped, every firm uses Teams/Slack | Overscoped | 1 | 4 | 1 | 0.25 |
| G35 | Module 26 Physical File Mgmt: overscoped for cloud-native era | Overscoped | 1 | 3 | 1 | 0.33 |
| G36 | Module 27 CLE Tracking: ΔΣΑ-side function, not firm-side | Overscoped | 1 | 2 | 1 | 0.5 |
| G37 | Module 31 BD CRM: overlaps with Module 11 Intake/CRM | Overscoped | 2 | 3 | 1 | 0.67 |
| G38 | Settlement calculator + medical records (PI features) — Clio has, ΘΕΜΙΣ skips. Acceptable IF target excludes PI | Missing | 2 | 4 | 1 | 0.5 |

---

## 6. RANKED BACKLOG (P1 → P3)

### P1 — MUST FIX BEFORE v1.0 LOCK

**P1.1 — KPolD Rules Engine Legal Validation** (Score 25.0)
- **Problem:** 50+ deadline rules σχεδιάζονται. Λάθος τιμή = lost case = lawsuit κατά της εταιρείας.
- **Evidence:** `greek-compliance.md:262-294`. Risk Register `build-plan.md:464` λέει "Probability: Low" — UNDERESTIMATED.
- **Action:** Πριν ξεκινήσει Sprint 11, ανάθεση σε practicing Greek attorney (κατά προτίμηση ΑΠ-level) να κάνει validation κάθε rule. Sign-off έγγραφο. Budget: €3,000-5,000.
- **Assigned to:** Niko (engagement) → external counsel + michalis-engineer για review

**P1.2 — Architectural Invariant Enforcement** (Score 12.5)
- **Problem:** `data-model.md:20-50` δηλώνει Invariant #1 (Unified Party Model) και Invariant #2 (Matter↔Party M2M). Αλλά:
  - `matter.client_id UUID FK -> client (primary client)` (line 244) — direct FK σε `client`, που δεν υπάρχει ως table — προφανώς residual από παλιό schema
  - `matter_party` έχει `name`, `tax_id`, `contact_info` αντί για `party_id` FK — duplicates PII
  - `aml_check.client_id` (line 686) — πρέπει να είναι `party_id`
  - `contract.client_id` (line 707), `retainer.client_id` (line 728), `payment` references → όλα παραβιάζουν invariant
- **Action:** Πριν Sprint 3 (Clients), refactor schema:
  - Drop `matter.client_id` → use `matter_party WHERE role='primary_client' AND side='ours'`
  - `matter_party` → FK σε `party_id`, drop `name/tax_id/contact_info`
  - All `client_id` references → rename σε `party_id` με explicit role filter
- **Assigned to:** kostas-engineer + claude-engineer για schema review

**P1.3 — Risk Register Update: Ν.5221/2025** (Score 12.0)
- **Problem:** Risk Register (`build-plan.md:458-470`) δεν αναφέρει το #1 commercial risk: SOLON e-filing είναι Phase 2, αλλά ο Ν.5221/2025 ισχύει ήδη.
- **Evidence:** `greek-enterprise-competitor-stack.md:126-132` confirms νόμος ενεργός 12 Ιαν 2026.
- **Action:** Άμεση re-prioritization. Εναλλακτικές:
  - (A) Move SOLON e-filing to Phase 1 Sprint 17-18 (drops Polish/Hardening time)
  - (B) Build "SOLON-ready" wrapper σε Phase 1 (export of SOLON-format ZIP, manual upload by user) → Full automation Phase 2
  - (C) Stay Phase 2, αλλά market το ως "Phase 1 = γραφείο efficiency, Phase 2 = SOLON" — riskier sales pitch
- **Recommended:** Option B (αρχιτεκτονικά ίδιο effort, marketing intact)
- **Assigned to:** Niko approval + planner

**P1.4 — Backup/DR RTO/RPO targets** (Score 12.0)
- **Problem:** `tech-stack.md:107` λέει "Daily full + continuous WAL". No RTO (recovery time) or RPO (recovery point) target. Enterprise sales blocker.
- **Action:** Define RTO=4h, RPO=15min. Document σε tech-stack.md. Test recovery procedure σε staging πριν alpha.
- **Assigned to:** ops-monitor + claude-engineer

**P1.5 — Greek OCR accuracy benchmark** (Score 9.0)
- **Problem:** `aegis-spec.md:368-385` references pytesseract για Greek. Real-world Greek legal docs (αποφάσεις, εξώδικα από fax) έχουν 60-75% accuracy ranges. Spec δεν θέτει target.
- **Action:** Sprint 7 deliverable: benchmark suite με 50 πραγματικά Greek legal docs, target ≥90%. Αν δεν επιτυγχάνεται, fallback Tesseract → AWS Textract Greek model.
- **Assigned to:** claude-engineer + qa-specialist

**P1.6 — aml_check.client_id → party_id refactor** (Score 9.0)
- **Problem:** Sub-finding του P1.2. Specific table.
- **Action:** included στο P1.2 refactor.

**P1.7 — ΑΠΕΔ qualified signature → Phase 1** (Score 8.33)
- **Problem:** SOLON e-filing απαιτεί ΑΠΕΔ. Αν SOLON πάει σε Phase 2, ΑΠΕΔ μπορεί να μείνει Phase 2. Αν SOLON έρθει σε Phase 1 (P1.3 Option B), ΑΠΕΔ πρέπει επίσης. Cross-dependency.
- **Action:** Conditional. Αν P1.3 = Option B, ΑΠΕΔ επίσης Phase 1 (Sprint 17). portal.olomeleia.gr παρέχει FREE qualified signatures στους δικηγόρους — integration is OAuth + sign API call, not heavy.
- **Assigned to:** claude-engineer

**P1.8 — Hearing daily list view + offline mode** (Score 8.0)
- **Problem:** Δικαστήρια έχουν patchy connectivity. Δικηγόρος χρειάζεται printable/PDF daily list με όλα τα hearings + checklist + αντίκλητος + γραμμάτιο status. Spec αναφέρεται αλλά δεν specifies offline.
- **Action:** Sprint 12 deliverable: PDF export "ΗΜΕΡΗΣΙΑ ΔΙΚΑΣΙΜΟΣ" με όλα τα fields. Mobile cache (Phase 3) θα έρθει αργότερα — προς το παρόν PDF αρκεί.
- **Assigned to:** app-specialist

**P1.9 — Email 2-way sync auto-filing → Phase 1** (Score 6.67)
- **Problem:** `build-plan.md:248` αναφέρει "Communication log (email, phone, SMS — manual logging)". Αυτό είναι **deal-breaker** για enterprise. Clio/Smokeball το έχουν εδώ και 5+ χρόνια.
- **Action:** Sprint 17 deliverable: Gmail OAuth + Microsoft Graph API integration, auto-file emails by matter (subject/sender heuristic + ML classifier optional). Αν time tight, ξεκινάμε με Gmail-only, Outlook Phase 2.
- **Assigned to:** app-specialist

**P1.10 — Audit log vs. GDPR right-to-erasure** (Score 8.0)
- **Problem:** `data-model.md:1053-1071` λέει "append-only, immutable". GDPR Article 17 (right to erasure) απαιτεί διαγραφή PII σε ορισμένες περιπτώσεις. Συγκρούονται.
- **Action:** Document Greek N.4624/2019 derogation: legal records exempt από erasure για statute-of-limitations period (typically 5y για general, 20y για contractual). Audit log retention policy: PII pseudonymization μετά retention period αντί για deletion. Spec it explicitly σε `greek-compliance.md`.
- **Assigned to:** michalis (compliance review)

---

### P2 — SHOULD ADD POST-PILOT FEEDBACK

**P2.1 — Workflow engine → Phase 1 lite (matter stage triggers)** (Score 4.0)
- **Problem:** Module 16 = Phase 2. Αλλά `matter_stage.auto_tasks` (line 290) ήδη exists στο Phase 1 schema. Disconnect.
- **Action:** Phase 1 deliverable = read `auto_tasks` JSONB και create tasks on stage transition. Visual workflow builder = Phase 2.
- **Assigned to:** kostas-engineer

**P2.2 — Reports dashboard partial → Phase 1** (Score 4.0)
- **Problem:** Phase 1 χρειάζεται τουλάχιστον: WIP, AR aging, billable hours per attorney. Custom report builder fine για Phase 2.
- **Action:** Sprint 17 deliverable: 3 fixed reports (Financial Summary, Matter Status, Productivity). Custom builder = Phase 2.
- **Assigned to:** app-specialist

**P2.3 — LEDES 1998B export sprint allocation** (Score 4.5)
- **Problem:** `build-plan.md:264` lists "LEDES" σε feature list αλλά δεν φαίνεται σε sprint deliverables.
- **Action:** Add explicit Sprint 14 deliverable: LEDES 1998B export. Effort: 2-3 days.
- **Assigned to:** kostas-engineer

**P2.4 — Trust accounting → Phase 1** (Score 5.33)
- **Problem:** Module 8 = Phase 2. Schema ήδη exists. ΔΣΑ Επιτροπή Δεοντολογίας απαιτεί separate fund tracking. Greek SMB γραφεία ίσως δεν το έχουν, αλλά **20-50 lawyer firm = Yes**.
- **Action:** Μετακίνηση basic deposit/withdrawal/balance σε Phase 1 Sprint 18. Three-way reconciliation = Phase 2.
- **Assigned to:** kostas-engineer + michalis review

**P2.5 — TAXISnet OAuth integration** (Score 5.33)
- **Problem:** SOLON, e-paravolo, myDATA όλα χρησιμοποιούν TAXISnet OAuth. No central plan.
- **Action:** Sprint 16 deliverable: TAXISnet OAuth library (shared). Used by myDATA Sprint 16, SOLON Phase 2, e-paravolo Phase 2.
- **Assigned to:** claude-engineer

**P2.6 — Document privilege AI enforcement** (Score 6.0)
- **Problem:** `data-model.md:421` defines `privilege_tag` ENUM but `aegis-spec.md` Search Flow doesn't filter privileged docs from cross-matter AI search.
- **Action:** Aegis must add privilege filter σε embeddings/search endpoints. Privileged docs only included if user has matter access.
- **Assigned to:** ai/ml engineer

**P2.7 — Client portal → Phase 1.5 (Sprint 19-20 bridge)** (Score 3.0)
- **Problem:** Phase 2 = Sprints 25-26 = Month 13-14. Enterprise pitch needs portal day-1.
- **Action:** Phase 1.5 mini-sprint between Phase 1 GA and Phase 2: invoice viewing + payment only (Stripe/Viva Wallet). Document sharing = Phase 2 full portal.
- **Assigned to:** site-specialist

**P2.8 — PII encryption blind index performance test** (Score 6.0)
- **Problem:** `tech-stack.md:135` describes blind index. Performance unproven at scale (50K+ parties, encrypted search).
- **Action:** Sprint 4 deliverable: load test με 100K synthetic encrypted records, target query latency <50ms p95.
- **Assigned to:** kostas-engineer + qa-specialist

**P2.9 — dikes.moj.gov.gr status polling → Phase 1.5** (Score 3.0)
- **Problem:** Sprint 5-6 has Greek courts seed data, but `dikes_moj_id` field is unused until Phase 2. Easy win missed.
- **Action:** Sprint 18 polish: simple status polling worker (no auth needed for public ekthema lookup).
- **Assigned to:** kostas-engineer

**P2.10 — Multi-tier invoice approval matrix** (Score 3.0)
- **Problem:** `data-model.md:551` has `approved_by` UUID. Single approver. Enterprise needs: associate→partner→accountant chains.
- **Action:** Phase 2 enhancement. Add `invoice_approval` table with chain definition.

**P2.11 — Greek phonetic matching algorithm** (Score 3.0)
- **Problem:** `aegis-spec.md:309` lists names but no algorithm. Custom needed (no existing Greek Soundex).
- **Action:** Sprint 17 deliverable: Greek phonetic library (port of Beider-Morse + Greek transliteration rules). Open-source it as marketing asset.
- **Assigned to:** ai/ml engineer

**P2.12 — Custom field per-entity type → query/index plan** (Score 3.0)
- **Problem:** `custom_field_definition` (line 1077) supports custom fields. But no plan for indexing/querying JSONB custom values at scale.
- **Action:** Add GIN indexes on `custom_fields` JSONB columns Sprint 4. Document query patterns.

**P2.13 — Mobile app → Phase 2 from Phase 3** (Score 1.6)
- **Problem:** Currently Phase 3 (Month 19+). Δικαστήρια usage = mobile-critical. Phase 3 = too late.
- **Action:** Move to Phase 2C (Months 13-15). React Native shell with read-only matter + hearing list + push notifications. Full feature parity = Phase 3.
- **Assigned to:** app-specialist

**P2.14 — Court database authoritative source** (Score 2.25)
- **Problem:** "400+ courts seed data" — no source identified.
- **Action:** Use `solon.gov.gr` court list + dikastiko_ensimo source as ground truth. Cross-check με ΔΣΑ. Document seed methodology.

---

### P3 — NICE TO HAVE / DEFER

- **P3.1** — Settlement calculator (PI-specific) — drop unless target market includes PI (Score 0.5)
- **P3.2** — CLE tracking (Module 27) — drop, ΔΣΑ already tracks (Score 0.5)
- **P3.3** — Internal Slack-clone (Module 30) — drop, every firm uses Teams (Score 0.25)
- **P3.4** — Physical File Mgmt (Module 26) — defer Phase 4 or drop (Score 0.33)
- **P3.5** — HR/Payroll (Module 29) — drop entirely; integrate to Erganinet/SoftOne instead (Score 0.2)
- **P3.6** — BD CRM (Module 31) — merge into Module 11 Intake (Score 0.67)
- **P3.7** — Automatic time capture (Smokeball-style) — Phase 3 OK, technically complex with privacy concerns σε Greek market (Score 2.0)
- **P3.8** — Settlement calculator + medical records (PI features) — IF Niko targets PI firms specifically, otherwise drop (Score 0.5)
- **P3.9** — Sxetiko cross-matter references — niche, defer (Score 4.0)

---

## 7. HIDDEN GEMS — UNIQUE DIFFERENTIATORS

Αυτά είναι τα features που **κανένας competitor δεν έχει** και πρέπει να προβληθούν στο marketing:

| Differentiator | Source | Marketing Headline |
|----------------|--------|--------------------|
| **Greek Law AI (24K νόμοι, 236K άρθρα, 538K vectors)** | Existing legal-platform corpus | "Το πρώτο AI που γνωρίζει ελληνικό δίκαιο" |
| **ΚΠολΔ Deadline Engine (50+ rules, court recess-aware)** | greek-compliance.md §4 | "Καμία προθεσμία δεν χάνεται — ΚΠολΔ-aware" |
| **ΔΣΑ Γραμμάτιο Native** | greek-compliance.md §1 | "Αυτόματος υπολογισμός γραμματίου ανά παράσταση" |
| **myDATA ΔΑ/ΑΠΥ Native + παρακράτηση 15%** | greek-compliance.md §2 | "myDATA ready out-of-box. Λογιστής χαρούμενος" |
| **Unified Party Model** (αν enforced) | data-model.md Invariants | "Conflict check σε 1ms — όχι 5 ξεχωριστές αναζητήσεις" |
| **Σχετικά Numbering (Σ.1...Σ.Ν)** | data-model.md §5 | "Greek legal document conventions native" |
| **Αντίκλητος tracking per hearing** | data-model.md §4 | "Ποτέ ξανά «δεν είχαμε αντίκλητο»" |
| **Ethical Wall (per-matter access)** | api-architecture.md §132 | "Compliance με ΚΔ άρθρο 40 αυτόματα" |
| **PII anonymization pipeline (Greek-aware)** | aegis-spec.md §2 | "AFM, AMKA, ΑΔΤ κρυπτογραφημένα πριν φτάσουν στο LLM" |
| **Single-tenant DB per firm** (αν διευκρινιστεί) | tech-stack.md §99 | "Τα δεδομένα σου δεν αναμιγνύονται με κανέναν" |

**Πρόταση marketing:** 3 από τα παραπάνω αρκούν για landing page. Recommended trio: Greek Law AI + ΚΠολΔ Engine + myDATA Native.

---

## 8. OVERSCOPED — CANDIDATES FOR CUT

| Module | Overscope reason | Recommendation |
|--------|------------------|----------------|
| **29 — HR & Μισθοδοσία** | Legal SaaS δεν είναι ERP. Erganinet, SoftOne, Epsilon ήδη το κάνουν. Integration > duplication. | **DROP** — leave to integration with payroll provider |
| **30 — Internal Comms (Slack-clone)** | Κάθε γραφείο έχει ήδη Teams ή Slack. Building 4th-class messaging = waste. | **DROP** — focus σε matter-linked notes/comments only |
| **27 — CLE Tracking** | ΔΣΑ τηρεί records. Δεν είναι firm responsibility. | **DROP** |
| **31 — Business Development CRM** | Overlaps με Module 11 Intake. Duplicate scope. | **MERGE σε Module 11** |
| **26 — Physical File Management** | Cloud-native era. Φυσικά αρχεία = legacy. | **DEFER Phase 4 or DROP** |
| **38 — Settlement Calculator (PI-specific feature ref)** | Greek PI market είναι μικρότερο από US. Δεν είναι core. | **DEFER** |

**Total spec reduction: 6 modules.** 28 modules instead of 34. Critical path shortens by ~3 sprints.

---

## 9. RECOMMENDATIONS ΓΙΑ v1.0 LOCK

### 9.1 ΠΡΕΠΕΙ να προστεθεί ΠΡΙΝ build (P1)
1. **KPolD legal validation** by practicing attorney (€3-5K external)
2. **Architectural invariant enforcement** — refactor schema BEFORE Sprint 3
3. **SOLON e-filing wrapper σε Phase 1** (Option B από P1.3) — manual ZIP export
4. **ΑΠΕΔ qualified e-sig σε Phase 1** (cross-dep με SOLON)
5. **Email 2-way auto-sync σε Phase 1 Sprint 17**
6. **Audit log GDPR policy clarification**
7. **Backup RTO/RPO targets**
8. **Risk Register update with Ν.5221/2025**

### 9.2 ΜΠΟΡΕΙ να μπει Phase 1.5 (post-pilot feedback, Months 10-12)
1. Trust accounting basic
2. Reports dashboard (3 fixed reports)
3. Workflow engine lite (matter stage triggers)
4. Client portal (invoice + payment only)
5. dikes.moj.gov.gr status polling
6. Multi-tier invoice approval

### 9.3 Μπορεί να ΚΟΠΕΙ από spec
1. Module 29 HR/Payroll
2. Module 30 Internal Comms (keep matter-linked notes only)
3. Module 27 CLE Tracking
4. Module 31 BD CRM (merge to 11)
5. Module 26 Physical File (defer)
6. Settlement calculator (PI-specific)

### 9.4 Pricing strategy alignment
Από `greek-enterprise-competitor-stack.md:251-258`:
- Greek SMB legacy: €5-15/user/month
- Global enterprise: €100-150+/user/month
- **ΘΕΜΙΣ OS sweet spot με τις προσθήκες P1**: €100-120/user/month for tier 20-50 lawyers
- Justification: SOLON + ΑΠΕΔ + AI + portal + reports = κανένας ελληνικός competitor δεν τα έχει όλα μαζί

### 9.5 Sprint re-allocation πρόταση

| Sprint | Original | Proposed |
|--------|----------|----------|
| 1-16 | (unchanged) | (unchanged) |
| 17 | Intake + Conflicts + Polish | Intake + Conflicts + **Email auto-sync** + **SOLON wrapper** |
| 18 | (continues 17) | Reports lite + **ΑΠΕΔ integration** + **Trust basic** |
| 19-20 | Phase 2A Trust | **Client portal lite** + Workflow lite |
| 21+ | Phase 2 starts | Phase 2 SOLON full + signatures full + portal full |

Net effect: Phase 1 still 18 sprints, but sequence shifts to deliver Greek-specific commercial features faster.

---

## 10. SUMMARY

| Metric | Value |
|--------|-------|
| **Total gaps found** | 38 |
| **Architectural defects (invariant violations)** | 4 (P1.2, G14, G16, G17) |
| **Critical commercial gaps** | 3 (SOLON, ΑΠΕΔ, Email auto-sync) |
| **Quick wins (Effort=1, Impact≥3)** | 5 (G16, G21, G28, G29, G13) |
| **Overscoped modules to drop/defer** | 6 (29, 30, 27, 31, 26, 38) |
| **Unique differentiators to highlight** | 10 |
| **Phase 1 blocking issues** | 9 (P1.1-P1.10) |

### Recommended first action
**ΠΡΙΝ Sprint 3 ξεκινήσει**, εκτέλεσε P1.2 (Architectural Invariant Refactor). Είναι Effort=2, Impact=5, Urgency=5 (Score 12.5) και μπλοκάρει sound delivery όλων των downstream modules. Cost μετακίνησης μετά Sprint 13 = 4-6 weeks rework.

**Δευτερεύουσα πρώτη ενέργεια:** Niko approval για P1.3 Option B (SOLON wrapper σε Phase 1). Αυτό είναι commercial-critical — αν δεν εγκριθεί, sales pitch χάνει το #1 wedge (Ν.5221/2025 mandatory e-filing).

---

**END OF AUDIT**

*Generated by Άργος — System Auditor | MECE.gr | 2026-04-28*
*Methodology: 6-step audit (Purpose → Journey → Friction → Gap → Prioritize → Backlog)*
*Inputs reviewed: 7 spec files (~145KB), 2 research files (~85KB), competitor matrix 11 platforms*
