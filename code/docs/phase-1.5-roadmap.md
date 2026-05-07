# ΘΕΜΙΣ OS — Phase 1.5 Roadmap (Hardening)

**Date**: 2026-04-29
**Trigger**: Post Phase 1 completion + Άργος audit
**Goal**: Production-readiness για ΔΣΘ pilot launch
**Estimated**: ~50 hours (4 sprint cycles ~12.5h each)

---

## Sequencing Logic

Άργος recommended order (από `phase-1-gaps-ranked.json`):
1. ✅ Day 10b quick wins (P1-1, P1-2, P1-4, P2-2, P3-11) — ~1h
2. P1-3 verification + ΟΧΙ άλλο work (already fixed Day 9.5)
3. Phase 1.5 sprints όπως κάτω

---

## Sprint 1.5.1 — Security Hardening (16h)

**Goal**: Close security gaps πριν pilot

### Tickets
1. **P2-4 RLS policies** (8h) — daedalus + ninurta
   - Migration 0008: ENABLE ROW LEVEL SECURITY
   - CREATE POLICY using `current_setting('app.firm_id')` GUC
   - Update `withTenantSchema` to set GUC
   - Tables: matter, party, document, audit_log, invoice, time_entry, expense

2. **P3-6 Document download cookie auth** (3h) — tool + app specialist
   - Reuse session cookie middleware
   - Drop `?_firm=` query param
   - Update `apps/web/components/documents/documents-table.tsx:84-85`

3. **P3-8 Per-endpoint rate limits** (0.5h) — tool-specialist
   - 30/min σε /invoices/draft, /finalize, /payments

4. **P3-2 Debug logs cleanup** (0.5h) — tool-specialist
   - Replace console.log/warn με fastify.log.* σε queues + r2-client

5. **Smoke test integration σε CI** (4h) — dokimasia
   - Add `scripts/smoke-test-phase1.mjs` σε deploy pipeline
   - Tenant teardown admin endpoint (non-prod only)

**Sprint exit**: Ninurta security gate ✅

---

## Sprint 1.5.2 — Encryption Sprint (24h)

**Goal**: PII encryption at rest για GDPR compliance

**GG4 todo**: 4a5888eb (deferred from Day 5)

### Tickets
1. **P2-5 PII envelope encryption** (24h) — daedalus + tool-specialist
   - Tenant DEK provisioning (Vault KMS already wired)
   - Encrypt: party.afm, party.display_name, document.title, audit_log.payload
   - pgcrypto deterministic encryption για AFM exact-match queries
   - Migration 0009 (column type changes + backfill script)
   - Update all reads/writes σε affected routes

2. **P2-3 + P3-11 OCR decrypt-first** (2h combined) — tool-specialist
   - Insert `decryptDocumentFromR2` πριν pdf-parse
   - Already have pdf-parse dep από Day 10b
   - Backfill: re-OCR existing documents (background job)

**Sprint exit**: Themis legal review ✅ + GDPR self-assessment ✅

---

## Sprint 1.5.3 — UX Polish (12h)

**Goal**: Pilot-ready UX

### Tickets
1. **P3-3 Matter selector combobox** (3h) — app-specialist
2. **P3-4 TimerWidget auth gate** (0.5h) — app-specialist
3. **P3-5 CurrencyInput dedup** (1h) — app-specialist
4. **P3-14 Invoice status enum alignment + partial computation** (2h)
5. **P3-15 Versions list change_note display** (1h)
6. **Mobile-first responsive pass** (4h) — app-specialist
   - Solo lawyer beachhead requirement
   - Critical screens: matter list, time entry, invoice send, calendar

**Sprint exit**: Designer + Niko UX review ✅

---

## Sprint 1.5.4 — Operational Maturity (8h)

**Goal**: Async + observable

### Tickets
1. **P3-16 Async provisioning** (6h) — daedalus + tool-specialist
   - BullMQ queue για schema clone DDL
   - 202 Accepted + polling endpoint
   - Reduces login route p95 από ~5s → <100ms

2. **P3-12 Tenant cache LRU** (0.5h) — tool-specialist
3. **P4-3 Migration runner + README** (2h) — daedalus
4. **P3-9 billing_split_locked decision + impl** (2h) — daedalus
5. **P3-13 Streaming document download** (8h, deferred to 1.6 αν time pressure)

**Sprint exit**: Hermes preview deploy readiness ✅

---

## Phase 1.5 Pre-Conditions (Niko)

⏳ **Required before Sprint 1.5.1**:
- Επιβεβαίωση RLS strategy (defense-in-depth approach OK?)
- ΔΣΘ pilot kickoff date target

⏳ **Required before Sprint 1.5.2**:
- Vault KMS production credentials
- Backfill maintenance window approval (αν pilot data exists)

⏳ **Required before Sprint 1.5.3**:
- UX feedback από 1-2 ΔΣΘ pilot lawyers

⏳ **Required before pilot launch**:
- RESEND_API_KEY (P3-10)
- R2 EU production bucket
- Redis production URL για BullMQ
- Domain DNS (themisos.gr / themis.legal pending)

---

## Themis Legal Review Backlog

**P3-7**: 9 ΚΠολΔ rules με `requires_legal_review=true`:
- kpold-625 (καταχρηστική ένσταση)
- kpold-237 (ολιγομερής δικάσιμος)
- kpold-632 (ανακοπή ερημοδικίας)
- kpold-630a (αναψηλάφηση)
- kpold-518-katachristiki (καταχρηστική προθεσμία)
- kpold-564-katachristiki (καταχρηστική φάση κανονισμού)
- +3 από Ν.5221/2025 patches

**Owner**: Themis legal agent + michalis (SOP review)
**Estimated**: 8 hours legal review session
**Blocker**: None — rules calculate normally με BETA banner

---

## Phase 1.5 Backlog Items Carried Forward

### `docs/backlog/phase-1.5-dp-from-attorney.md`
**ΔΠ από Δικηγόρο Module** (activation 16/9/2026 per Ν.5221/2025)
- New endpoint set, UI, billing integration
- Pre-implementation: Themis review of attorney-stamped DP requirements
- Estimated: ~20 hours (separate from above sprints)

---

## Phase 2 Preview (Post 1.5)

- Workflow automation (matter lifecycle FSM)
- AI advisor (RAG over νομοθεσία 1.46M Qdrant points)
- Client portal (subdomain pattern)
- WhatsApp integration
- Mobile app (React Native consideration vs PWA)
- Multi-firm dashboards για enterprise edge case (Niko firm 1000+ cases)

---

## Total Phase 1.5 Estimate

| Sprint | Hours | Cumulative |
|--------|-------|------------|
| 1.5.1 Security | 16 | 16 |
| 1.5.2 Encryption | 26 | 42 |
| 1.5.3 UX Polish | 12 | 54 |
| 1.5.4 Ops Maturity | 8 | 62 |
| **Total** | **62** | — |

Plus Themis legal review: 8h
Plus ΔΠ από δικηγόρο: ~20h (parallel track)

**Critical path to pilot**: Sprint 1.5.1 + 1.5.2 minimum (42h) + Niko credentials.
