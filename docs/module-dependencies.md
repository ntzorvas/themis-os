# THEMIS OS — Module Dependency Graph (v0.2)

**Spec version:** v0.2 (2026-04-28). v0.1 → v0.2 changes documented in `changelog.md`.

## Dependency Notation

```
A --> B  means "A depends on B" (B must exist for A to function)
A ..> B  means "A optionally integrates with B" (works without B)
```

---

## Core Dependency Tree (v0.2)

```
                        ┌──────────────────────────────┐
                        │   34. Settings &              │
                        │   Single-Tenant Provisioning  │
                        └────────────┬──────────────────┘
                                     │
                ┌────────────────────┼─────────────────────┐
                │                    │                     │
          ┌─────┴──────┐     ┌──────┴──────┐      ┌──────┴──────┐
          │ 17. Team   │     │  Auth /     │      │  Courts     │
          │ & Roles    │     │  Users      │      │  Database   │
          │ + Ethical  │     │  + MFA      │      │  (seed)     │
          │ Wall       │     │             │      │             │
          └─────┬──────┘     └──────┬──────┘      └──────┬──────┘
                │                   │                     │
                └─────────┬─────────┘                     │
                          │                               │
                ┌─────────┴──────────┐                    │
                │  1. Parties        │                    │
                │  (Unified Party    │◄───────────────────┘
                │   Model + Phonetic │
                │   + GDPR)          │
                └─────────┬──────────┘
                          │
                ┌─────────┴──────────┐
                │  2. Matters        │
                │  (M2M Party,       │
                │  Ethical Wall)     │
                └────┬───────┬───────┘
                     │       │
        ┌────────────┼───────┼────────────────────────────┐
        │            │       │                            │
   ┌────┴────┐  ┌───┴───┐ ┌─┴────┐  ┌────────┐  ┌──────┴──────┐
   │  3.     │  │  4.   │ │ 5.   │  │ 12.    │  │   23.       │
   │ Cal /   │  │ Docs  │ │ Time │  │ Comm + │  │ Hearings    │
   │ Deadl.  │  │ + DMS │ │ +    │  │ Email  │  │ + Daily     │
   │ + Daily │  │       │ │ Auto │  │ Auto-  │  │ List PDF    │
   │ List    │  │       │ │ Capt.│  │ filing │  │             │
   └────┬────┘  └───┬───┘ └─┬────┘  └────────┘  └──────┬──────┘
        │           │       │                          │
        │           │       │                     ┌────┴────┐
        │           │       │                     │  9.     │
        │           │       │                     │  Bar    │
        │           │       │                     │  Stamps │
        │           │       │                     └────┬────┘
        │           │       │                          │
        │           │  ┌────┴────┐                     │
        │           │  │  6.     │◄────────────────────┘
        │           │  │ Billing │
        │           │  │ +LEDES  │
        │           │  │ +Multi- │
        │           │  │ tier    │
        │           │  │ Approval│
        │           │  └────┬────┘
        │           │       │
        │           │  ┌────┴────┐  ┌─────────────┐
        │           │  │ TAXISnet│  │  myDATA     │
        │           │  │  OAuth  │──│  Integ.     │
        │           │  │  (lib)  │  │             │
        │           │  └────┬────┘  └─────────────┘
        │           │       │
        │           │       ├──────────┬──────────┐
        │           │       │          │          │
        │           │  ┌────┴───┐ ┌───┴───┐ ┌────┴────┐
        │           │  │ SOLON  │ │ ΑΠΕΔ  │ │ e-      │
        │           │  │ Wrapper│ │ Sign  │ │ Paravolo│
        │           │  └────────┘ └───┬───┘ │ (P2)    │
        │           │                 │     └─────────┘
        │           │  (ΑΠΕΔ pre-signs SOLON docs)
        │           │       ▲
        │           └───────┘
        │
        │      ┌──────────────────┐
        │      │  Aegis (AI)      │
        ├──────┤  11 Agents       │
        │      └──────┬───────────┘
        │             │
        │      ┌──────┴──────┐
        │      │   Qdrant    │
        │      │  Legal      │
        │      │  Corpus     │
        │      │  + Tenant   │
        │      │  Collection │
        │      └─────────────┘
        │
   ┌────┴────────┐
   │   24.       │
   │  Deadline   │
   │  Rules      │
   │  (KPolD     │
   │  Engine)    │
   └─────────────┘

   ┌─────────────┐    ┌─────────────┐    ┌──────────────┐
   │  8. Trust   │    │  18. Client │    │  20. Reports │
   │  Account.   │    │  Portal     │    │  + BI        │
   │  (basic 2-w │    │  (lite)     │    │  (6 fixed +  │
   │   reconcile)│    │             │    │   NL→SQL AI) │
   └─────────────┘    └─────────────┘    └──────────────┘
```

---

## Detailed Dependency Matrix (v0.2)

### Layer 0: Infrastructure (No dependencies)
- PostgreSQL, Redis, Qdrant, Cloudflare R2, nginx
- These exist before any module.
- **Per-firm KMS key** (Hetzner KMS or sealed-secrets)

### Layer 1: Foundation (Depends only on infrastructure)

| Module | Depends On |
|--------|------------|
| **Auth/Users + MFA** | PostgreSQL, KMS |
| **34. Settings + Tenant Provisioning** | Auth/Users |
| **17. Team & Roles + Ethical Wall** | Auth/Users |
| **Courts Database** | PostgreSQL (seed data, solon.gov.gr authoritative) |
| **Mobile Responsive Shell** | Next.js infrastructure |

### Layer 2: Core Entities (Depends on Layer 1)

| Module | Hard Dependencies | Soft Dependencies |
|--------|-------------------|-------------------|
| **1. Parties (Unified Party Model)** | Auth, Roles, KMS (PII encryption) | Phonetic library |
| **2. Matters (M2M)** | Parties, Auth, Roles, Courts DB, Ethical Wall | -- |

### Layer 3: Matter-Bound Modules (Depends on Layer 2)

| Module | Hard Dependencies | Soft Dependencies |
|--------|-------------------|-------------------|
| **3. Calendar & Deadlines + Daily List** | Matters, Users | Google/Outlook sync |
| **4. Documents + DMS** | Matters, Parties, R2, Redis | Aegis (OCR, summary), Privilege filter |
| **5. Time + Auto Capture** | Matters, Users | Aegis (Time Inferrer), Browser/Desktop client |
| **12. Communication + Email Auto-filing** | Matters, Parties | Aegis (Email Classifier), Gmail/Graph OAuth |
| **21. Conflict Check** | Parties, Matters, Phonetic library | Aegis (relationship reasoning) |
| **23. Hearings** | Matters, Calendar, Courts | Bar Stamps |
| **24. Deadlines (KPolD)** | Calendar, Matters | Aegis (extraction) |

### Layer 4: Financial (Depends on Layer 3)

| Module | Hard Dependencies | Soft Dependencies |
|--------|-------------------|-------------------|
| **6. Billing + LEDES + Multi-tier Approval** | Time Entries, Expenses, Parties, Matters | myDATA, Payment gateway |
| **9. Bar Stamps (ΔΣΑ)** | Hearings, Matters, Users, EFKA rate config | Billing (line item) |
| **19. Expenses** | Matters, Users | Documents (receipts), Billing |
| **10. Court Fees** | Matters | e-paravolo API (Phase 2), Billing |
| **TAXISnet OAuth Library** (shared) | Auth | Used by myDATA, SOLON, ΑΠΕΔ, e-paravolo |
| **myDATA Integration** | Billing, TAXISnet OAuth | -- |

### Layer 5: Greek Commercial Wedge (Phase 1 — depends on Layer 4)

| Module | Hard Dependencies | Soft Dependencies |
|--------|-------------------|-------------------|
| **13. SOLON e-Filing (wrapper)** | Documents, Matters, Courts, TAXISnet OAuth, ΑΠΕΔ | -- |
| **14. ΑΠΕΔ Qualified Signatures** | Documents, TAXISnet OAuth (or portal.olomeleia.gr OAuth) | -- |
| **8. Trust Accounting (basic)** | Parties, Matters, Billing | -- |
| **20. Reports/BI (baseline)** | All financial modules, Matters | Aegis (Apologistis) |
| **18. Client Portal (lite)** | Parties, Documents, Billing, Auth (separate domain) | Stripe / Viva Wallet |
| **16. Workflow (lite)** | Matters, matter_stage.auto_tasks | Tasks |

### Layer 6: AI Layer (Cross-cutting, depends on Layer 0+1)

| Module | Hard Dependencies | Soft Dependencies |
|--------|-------------------|-------------------|
| **Aegis (AI Orchestrator)** | Qdrant, Legal Corpus DB | All modules (provides AI to all) |
| **Aegis Agent 1: Research (Ερευνητικός)** | Qdrant legal_corpus | -- |
| **Aegis Agent 2: Drafting (Συγγράμματος)** | Document templates | -- |
| **Aegis Agent 3: Deadline (Προθεσμίας)** | KPolD rules, OCR text | -- |
| **Aegis Agent 4: Billing (Λογιστικός)** | Time entries, invoices | -- |
| **Aegis Agent 5: Conflict (Έλεγκτος)** | Parties, Matters, Phonetic library | -- |
| **Aegis Agent 6: Intake (Πρόσληψης)** | Leads, Parties | -- |
| **Aegis Agent 7: Summary (Περιληπτικός)** | All modules | -- |
| **Aegis Agent 8: OCR/Extraction (Αναγνώστης)** | Documents | pytesseract, AWS Textract fallback |
| **Aegis Agent 9: Email Classifier (Ταχυδρόμος)** — NEW v0.2 | Email integration, Parties, Matters | Gmail/Graph |
| **Aegis Agent 10: Time Inferrer (Χρονογράφος)** — NEW v0.2 | Time capture events | -- |
| **Aegis Agent 11: Report Generator (Απολογιστής)** — NEW v0.2 | Reports BI, read-only DB views | -- |
| **15. Legal Research** | Qdrant, Legal Corpus, Aegis Agent 1 | Matters |

### Layer 7: External Integration

| Module | Hard Dependencies | Soft Dependencies |
|--------|-------------------|-------------------|
| **32. Integrations Hub** | Auth | All external APIs |
| **Gmail OAuth + Microsoft Graph** | Email Auto-filing module | -- |
| **portal.olomeleia.gr OAuth** | ΑΠΕΔ module | -- |
| **TAXISnet OAuth (shared library)** | Phase 1 myDATA, SOLON, ΑΠΕΔ | -- |

### Layer 8: Phase 2 Depth (Depends on Phase 1 GA)

| Module | Hard Dependencies | Soft Dependencies |
|--------|-------------------|-------------------|
| **7. Full GL Accounting** | Billing, Payments | Xero/QuickBooks |
| **8. Trust 3-way reconciliation** | Trust basic, Bank API | -- |
| **13. SOLON full (no manual step)** | SOLON wrapper, ΑΠΕΔ | dikes.moj.gov.gr polling |
| **14. Signatures full multi-tier** | ΑΠΕΔ, Workflow lite | -- |
| **18. Client Portal full** | Portal lite, Documents, Privilege filter | Messaging |
| **20. Reports custom builder** | Reports baseline | -- |
| **10. e-Paravolo automation** | Court fees, GSIS API | -- |
| **dikes.moj.gov.gr polling** | Matters, Court IDs | -- |
| **Mobile Native (React Native)** | All API endpoints | Push notifications |

### Layer 9: Phase 3 (Deferred)

| Module | Status |
|--------|--------|
| **25. Judgments & Enforcement** | Phase 3 |
| **28. Referrals** | Phase 3 |
| **Multi-jurisdiction (Cyprus)** | Phase 3 |

### DROPPED (no longer in spec)

| Module | v0.2 Status |
|--------|-------------|
| ~~26. Physical File Mgmt~~ | DROP |
| ~~27. CLE Tracking~~ | DROP |
| ~~29. HR & Payroll~~ | DROP (use Erganinet/SoftOne integration) |
| ~~30. Internal Comms (Slack-clone)~~ | DROP (matter-linked notes only retained) |
| ~~31. Business Development CRM~~ | MERGED into 11. Intake |
| ~~PI Settlement Calculator~~ | DROP |

---

## Phase Mapping with Dependencies (v0.2)

```
Phase 1 (Enterprise MVP):
  Layer 0 → Layer 1 → Layer 2 → Layer 3 → Layer 4 → Layer 5 (Greek wedge) → Layer 6 (AI 8/11)

  Specifically:
  Auth → Parties → Matters → {Calendar+Daily, Documents+OCR, Time+AutoCapture, Hearings, Conflict, Email Auto-filing}
                            → {Billing+LEDES, Bar Stamps, Expenses, TAXISnet OAuth lib, myDATA}
                            → {SOLON wrapper, ΑΠΕΔ, Trust basic, Portal lite, Reports baseline, Workflow lite}
                            → {Intake, Contracts, Settings, Mobile responsive web}
  + Aegis (parallel from Sprint 7) with Agents 1-8 + 9-10 partial

Phase 2 (Enterprise Depth):
  Layer 5 (full) → Layer 8

  Specifically:
  {GL Accounting, Trust 3-way}
  {SOLON full, ΑΠΕΔ multi-tier, e-Paravolo automation}
  {Portal full, Workflow visual builder, Custom reports}
  {Mobile native, dikes.moj.gov.gr polling}

Phase 3 (Advanced):
  Layer 9
  {Judgments, Referrals, Multi-jurisdiction}
```

---

## Critical Path (v0.2)

The longest dependency chain (determines minimum timeline):

```
Infrastructure
  → Auth (Sprint 1)
    → Parties (Sprint 3)
      → Matters (Sprint 5)
        → Time Entries (Sprint 13)
          → Billing/Invoicing (Sprint 13-14)
            → TAXISnet OAuth library (Sprint 16)
              → myDATA Integration (Sprint 16)
                → SOLON Wrapper (Sprint 17, requires ΑΠΕΔ)
                  → Phase 1 GA (Sprint 18)
```

**Critical path length: 9 sprints (18 weeks) for full Greek-commercial-wedge billing flow.**

**Cross-dependency:** SOLON wrapper requires ΑΠΕΔ for document signing before submission. Both are Sprint 17 → parallel streams within sprint.

AI path (parallel):
```
Qdrant + Legal Corpus (exists)
  → Aegis scaffold (Sprint 7)
    → Document AI (Sprint 9)
      → Research AI (Sprint 9)
        → Deadline AI (Sprint 11)
          → Email Classifier (Sprint 17)
            → Time Inferrer (Sprint 13-14)
              → Report Generator (Sprint 18)
```

**AI path length: 7 sprints (from Sprint 7 to Sprint 18).**

---

## Module Independence (Can Be Built in Parallel)

These module pairs can be developed simultaneously by different team members:

| Stream A | Stream B | Shared Dependency |
|----------|----------|-------------------|
| Parties + Phonetic library | Auth + Roles + Ethical Wall | PostgreSQL, KMS |
| Calendar + Hearings | Documents + DMS | Matters |
| Time Tracking + Auto Capture | Expenses | Matters |
| Billing + LEDES | Bar Stamps | Matters + Hearings |
| Conflict Check | Intake/CRM | Parties |
| AI/Aegis (all agents) | Business Logic (all) | Only at integration points |
| **SOLON wrapper** | **ΑΠΕΔ + Email auto-filing + Intake/Conflicts** | TAXISnet OAuth lib |
| **Trust basic** | **Reports BI** | Billing |
| **Client Portal lite** | **Workflow lite + Polish** | Existing Phase 1 modules |
| **Mobile responsive views** | All other (cross-cutting from Sprint 1) | Next.js shell |

---

## Hard Dependency Constraints (Sequencing Locks)

These constraints CANNOT be parallelized — strict sequence:

1. **Auth → everything else.** No module can ship before Auth is complete.
2. **Tenant provisioning template → all subsequent firm onboarding.** Locked at Sprint 2.
3. **Architectural invariant cleanup (no `client_id`, no `tenant_id`) → Sprint 3.** This is point-of-no-return per audit P1.2 / changelog v0.2.B-C.
4. **Parties → Matters.** Matters cannot exist without Parties.
5. **TAXISnet OAuth library (Sprint 16) → SOLON + ΑΠΕΔ (Sprint 17).** Cannot ship Greek wedge without OAuth.
6. **ΑΠΕΔ → SOLON full automation.** SOLON requires ΑΠΕΔ-signed documents (Phase 1 wrapper allows manual ΑΠΕΔ as fallback, but Phase 2 full requires automation).
7. **KPolD external attorney sign-off → Sprint 11.** Sprint 11 cannot start without sign-off (audit P1.1).
8. **Greek OCR benchmark ≥90% → Sprint 8 close.** Sprint 9 AI work assumes this.
9. **PII encryption performance load test → Sprint 4 close.** Sprint 5 Matters depends on this.
10. **Backup/DR test → Sprint 18 close.** Cannot release alpha without DR proven (audit P1.4).

---

## Soft Dependency Notes

- **Mobile responsive web is cross-cutting.** Every module from Sprint 3 onwards must ship with mobile breakpoints. Designer allocates 25% to mobile review per sprint.
- **Aegis is degraded-mode-safe.** Every module functions without AI; AI failure never blocks core ops (Invariant #5).
- **Portal lite is read-only in Phase 1.** Document sharing + messaging are Phase 2 to keep portal scope tight.
- **Email auto-filing is opt-in per user.** Default off until user authorizes Gmail/Graph OAuth.
- **Auto Time Capture is opt-in per firm.** Default off; firm admin enables, user can blacklist apps.
- **Privilege filter on AI search is non-negotiable.** Audit G15 P2.6 mandates Phase 1 enforcement.
