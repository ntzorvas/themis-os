# THEMIS OS — Spec Changelog

All spec-level (not code-level) changes are recorded here. Each transition documents:
- What changed and where
- Why (audit finding, business decision, regulatory event)
- Which invariants were preserved or extended
- Reversibility classification

---

## v0.2 — 2026-04-28 — Argos Audit Integration

**Trigger:** `gap-audit.md` (Άργος, 2026-04-28) — 38 gaps identified, 9 P1 blockers, 4 architectural invariant inconsistencies.
**Approver:** Niko (CEO MECE.gr)
**Author of v0.2:** Δαίδαλος (Master Coding Architect)

### A. Phase reallocation (build-plan.md)

**Eight modules promoted to Phase 1**, replacing six modules that were dropped:

| # | Module | v0.1 Phase | v0.2 Phase | Rationale |
|---|--------|------------|------------|-----------|
| 1 | SOLON e-filing (wrapper) | Phase 2 (Sprints 23-24) | **Phase 1 (Sprints 17-18)** | Ν.5221/2025 ήδη ενεργός 1.1.2026 — μη παραδοτέο = lost commercial wedge |
| 2 | Trust accounting (basic) | Phase 2 | **Phase 1 (Sprint 18)** | ΕΔΕ compliance, enterprise table-stake |
| 3 | Auto time capture (passive) | Phase 3 | **Phase 1 (Sprint 13)** | Smokeball killer feature, 30-60min/day savings per attorney |
| 4 | Email auto-filing (IMAP/Graph) | Phase 2 (manual Phase 1) | **Phase 1 (Sprint 17)** | Clio/Smokeball had it 5+ years; manual logging = deal-breaker |
| 5 | Client portal (lite) | Phase 2 (Sprints 25-26) | **Phase 1 (Sprint 19-20 bridge → embedded in 18)** | Enterprise pitch table-stake |
| 6 | Responsive web (mobile-first) | Phase 3 | **Phase 1 (cross-cutting Sprints 1-18)** | Court usability, no native app needed for v1 |
| 7 | Reports/BI baseline | Phase 2 | **Phase 1 (Sprint 18)** | Managing partner dashboard = enterprise sales blocker |
| 8 | ΑΠΕΔ qualified signatures | Phase 2 | **Phase 1 (Sprint 17)** | Cross-dependency with SOLON; portal.olomeleia.gr is free, integration is light |

**Six modules dropped or deferred to Phase 4+:**

| # | Module | Status | Rationale |
|---|--------|--------|-----------|
| 26 | Physical File Management | DROP | Cloud-native era, legacy |
| 27 | CLE Tracking | DROP | ΔΣΑ tracks centrally, not firm responsibility |
| 29 | HR/Payroll | DROP | Erganinet/SoftOne/Epsilon already cover; integration > duplication |
| 30 | Internal Comms (Slack-clone) | DROP | Teams/Slack universal; matter-linked notes only retained |
| 31 | Business Development CRM | MERGE → 11 (Intake) | Overlapping scope |
| 38 | PI Settlement Calculator | DROP | Not target market focus |

**Net module count:** 34 → 28 (-6 dropped, +8 promoted reuse same count + new). Critical path shortens by ~3 sprints.

### B. Architectural clarification (data-model.md, tech-stack.md)

**Tenant isolation contradiction RESOLVED.** v0.1 declared "single-tenant per firm" but every per-tenant table carried a `tenant_id` column (multi-tenant pattern). Decision:

- **Single-tenant per firm DEPLOYMENT confirmed:** each firm = dedicated PostgreSQL DB + dedicated Qdrant collection + dedicated KMS keys + dedicated R2 bucket prefix.
- **`tenant_id` column REMOVED** from all 50 per-tenant tables.
- **`tenant_id` retained only** in:
  - `tenant` table itself (1 row, meta info)
  - `audit_log` (kept for cross-DB log shipping safety, even if redundant)
  - Shared/system tables (`court`, `legal_document`, `legal_article`, `case_law`) — these live in the central read-only corpus DB, not per-firm.
- **Migration impact:** zero data, schema-time only. All Prisma models updated, all queries simplified (no `WHERE tenant_id = ...` clauses), reduces attack surface for cross-tenant leak (impossible by construction now).

This change is **point-of-no-return after Sprint 3**. Locked here at v0.2 to avoid Sprint 13+ refactor cost.

### C. Architectural invariant cleanup (data-model.md)

The audit identified 4 specific schema rows that contradicted Invariants #1 and #2 (Unified Party Model, Matter↔Party M2M):

- `matter.client_id UUID` → REMOVED. Primary client expressed via `matter_party WHERE role='primary_client' AND side='ours'`.
- `matter_party` had inline `name`, `tax_id`, `contact_info` → REPLACED with strict `party_id` FK; PII duplication eliminated.
- `aml_check.client_id` → renamed to `party_id`.
- `contract.client_id`, `retainer.client_id`, `invoice.client_id`, `trust_account.client_id` → all renamed to `party_id` (with `party_role.role='client'` semantically enforced at app layer).

This is **architectural housekeeping**, not new invariants. The invariants themselves remain unchanged.

### D. New tables added (data-model.md)

Introduced for Phase 1 promoted modules:

- `email_account` — IMAP/Gmail/Outlook OAuth credentials per user
- `email_message` — Auto-filed emails linked to matter/party
- `email_attachment` — Email attachments, optionally promoted to `document`
- `time_capture_event` — Passive activity events for auto time entry inference
- `time_capture_session` — Aggregated capture sessions, draft → time_entry
- `portal_user` — Client-side users (separate auth domain from firm users)
- `portal_session` — Portal session tokens (different lifecycle from firm JWT)
- `portal_invitation` — Email invitation flow
- `report_dashboard` — User-saved dashboard configurations
- `saved_query` — Custom report builder queries (Phase 1: read-only library)
- `aped_signature_request` — Qualified e-sig flow (separate from generic `signature_request` for legal traceability)
- `solon_filing` — Renamed from `e_filing`, expanded with TAXISnet OAuth state, certificate handling

**Total tables:** 55 → 65. Per-tenant: 51 → 61. Shared: 4 (unchanged).

### E. New AI flows (aegis-spec.md)

Three new Aegis agents added to the hub-and-spoke roster:

- **Agent 9: Email Classifier (Tachydromos)** — classifies inbound emails to (matter, party, category, privilege) tuple. Claude Haiku.
- **Agent 10: Time Capture Inferrer (Chronografos)** — infers what an attorney was doing from screen/app passive events. Claude Haiku + rules.
- **Agent 11: Report Generator (Apologistis)** — natural-language → SQL → chart pipeline for managing partner dashboard. Claude Sonnet.

### F. Greek compliance expansion (greek-compliance.md)

Sections rewritten from "Phase 2 ready" to "Phase 1 implementation spec":

- §6 SOLON — full integration spec: TAXISnet OAuth, document submission flow, status webhooks, certificate retrieval, retry/idempotency, ΑΠΕΔ pre-signing requirement.
- §7 ΑΠΕΔ — full implementation spec: portal.olomeleia.gr OAuth, signing API call, certificate verification, audit trail format, multi-signer flow.
- **NEW §10 Trust Accounting (ΕΔΕ)** — Greek bar requirements: separate bank account per client funds, three-way reconciliation deferred to Phase 2 but basic 2-way reconciliation in Phase 1.

### G. New API surfaces (api-architecture.md)

~40 new endpoints across:

- `/api/v1/solon/*` — submission, status, certificate
- `/api/v1/trust-accounts/*`, `/api/v1/trust-transactions/*`
- `/api/v1/time-capture/*` — events ingestion, sessions, draft promotion
- `/api/v1/email/*` — accounts, messages, classification triggers
- `/api/v1/portal/*` — separate API surface (different auth scope)
- `/api/v1/reports/*` (expanded) — dashboards, saved queries
- `/api/v1/aped/*` — qualified signature flow
- `/aegis/v1/email/classify`, `/aegis/v1/time/infer`, `/aegis/v1/reports/nl-to-sql`

### H. Documentation infrastructure

- **NEW** `docs/README.md` — navigation index for all 8 spec files
- **NEW** `docs/changelog.md` (this file) — version history with rationale

### Invariants preserved (unchanged across v0.1 → v0.2)

The 10 invariants from Periklis remain inviolate:

1. **Unified Party Model** (Invariant #1) — strengthened, not weakened, by removing residual `client_id` columns
2. **Matter ↔ Party M2M** (Invariant #2) — strengthened by `matter_party` PII deduplication
3. **PII encryption at rest** — extended to all new tables (email_message body, time_capture_event app/window text)
4. **Audit log immutability** — extended to all new entities
5. **AI failure must never block core ops** — preserved; new agents (Email Classifier, Time Capture, Reports) are degraded-mode-safe
6. **Single-tenant per firm DEPLOYMENT** — explicitly clarified, schema cleaned up
7. **Greek-first localization** — extended to portal UI, mobile responsive views
8. **Human-in-the-loop for AI legal output** — extended to ΑΠΕΔ signing (always attorney-approved), email classification (suggestions only)
9. **Privilege tag enforcement** — extended to portal access (privileged docs never auto-shared)
10. **No PII leaves EU** — extended to email auto-filing (IMAP/Graph servers must be EU-region)

### Budget impact

| Item | v0.1 (€) | v0.2 (€) | Δ |
|------|----------|----------|---|
| Phase 1 engineering (5.5 FTE × 9 mo) | 225,000 | 305,000 | +80,000 (+1 FTE × 6 mo for promoted modules) |
| Infrastructure | 1,800 | 2,400 | +600 (extra staging for SOLON sandbox) |
| LLM API (dev/test) | 4,500 | 6,500 | +2,000 (3 new agents) |
| External legal review | 13,500 | 18,000 | +4,500 (SOLON + ΑΠΕΔ practitioner sign-off) |
| Security audit | 5,000 | 7,500 | +2,500 (portal external surface) |
| Design tools | 900 | 900 | 0 |
| **Phase 1 total** | **~250,000** | **~340,000** | **+90,000** |

### Pricing realignment

v0.1 target: €89-149/user/month (entry).
v0.2 target: **€100-120/user/month** for tier 20-50 lawyers (justified by SOLON + ΑΠΕΔ + AI + portal + reports bundled in Phase 1, none of which Greek competitors offer combined).

### Reversibility

| Decision | Reversible? | Cost if reversed post-Sprint 3 |
|----------|-------------|-------------------------------|
| `tenant_id` removal | NO | 6+ weeks refactor |
| Module promotions | YES (slip to Phase 1.5) | 0-2 weeks slip |
| Module drops (HR/CLE/etc.) | YES (re-add Phase 4) | New module spec effort only |
| Pricing change | YES | Marketing iteration only |
| New AI agents | YES (defer to Phase 2) | Schema retained, agent code deferred |

---

## v0.1 — 2026-04-27 — Initial Lock

**Author:** Periklis (specs lead)
**Files locked:** 7
- `tech-stack.md` (Next.js 16 + Fastify + FastAPI + PostgreSQL + Qdrant + R2)
- `build-plan.md` (Phase 1 = 18 sprints, €250K)
- `module-dependencies.md` (34 modules, 8 layers)
- `api-architecture.md` (~150 endpoints, 8 AI agents)
- `data-model.md` (54 tables, 2 invariants)
- `aegis-spec.md` (hub-and-spoke AI orchestrator)
- `greek-compliance.md` (myDATA, ΔΣΑ, ΚΠολΔ, SOLON-ready, ΑΠΕΔ-ready)

Inputs: competitor research (Clio, Smokeball, PracticePanther, ORBIT, Thesis), Greek legal stack research, Niko strategic input.

---

*Maintained by: Spec authors as part of every change. New rows go on top, oldest at bottom.*
