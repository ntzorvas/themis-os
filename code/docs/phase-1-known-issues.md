# ΘΕΜΙΣ OS — Phase 1 Known Issues (Consolidated)

**Source**: Άργος Phase 1 audit (`phase-1-gaps-ranked.json`) + Δοκιμασία Day 7/8/9 carry-overs + smoke test findings
**Date**: 2026-04-29
**Status**: Living document — update as fixes land

---

## Severity Legend
- **P0**: Blocks deploy
- **P1**: Should fix before pilot launch
- **P2**: Should fix in Phase 1.5
- **P3**: Polish / nice-to-have
- **P4**: Doc/cleanup only

---

## P0 — Deploy Blockers

### P1-1: Auth audit_log column mismatch (`ip_address` vs `ip`) ⏳ Day 10b
- **Files**: `apps/api/src/routes/auth/index.ts:470,542,887`
- **Symptom**: All auth events silently fail (login/logout/password_reset)
- **Fix ETA**: 5 min — in progress
- **Owner**: tool-specialist

### P1-2: greek-utils package missing dist/ ⏳ Day 10b
- **Symptom**: Next.js build fails with `Cannot resolve ./afm.js`
- **Fix ETA**: 30 min — in progress
- **Owner**: tool-specialist

### ~~P1-3: Frontend↔backend billing contract mismatch~~ ✅ FIXED Day 9.5
- **Status**: ✅ **FALSE POSITIVE in Άργος audit** — types/billing.ts already aligned
- **Verification**: `grep billable_rate_eur_cents apps/web/types/billing.ts` returns matches
- **Web typecheck**: exit 0

---

## P1 — Should Fix Before Pilot

### P1-4: r2_key exposed στο GET /documents/:id/versions ⏳ Day 10b
- **File**: `apps/api/src/routes/documents/index.ts:738-752`
- **Risk**: Internal R2 storage path leaked to client
- **Fix ETA**: 15 min — in progress

### P2-1: /api/v1/auth/refresh declared exempt αλλά no handler
- **Issue**: 404 endpoint, users hard logout after 8h
- **Decision needed**: Implement refresh token rotation OR document hard 8h sessions
- **Estimated**: 2.5 hours
- **Owner**: tool-specialist (after product owner decision)

### P2-3: OCR runs pdf-parse on encrypted ciphertext
- **File**: `apps/api/src/queues/document-processing.ts:140-162`
- **Symptom**: extracted_text always NULL για real PDFs
- **Fix**: Decrypt → extract → store. Combine με P3-11 (pdf-parse dep).
- **Estimated**: 2 hours

### P2-4: RLS policies absent — defense-in-depth gap
- **Risk**: Tenant isolation rests μόνο σε withTenantSchema discipline
- **Fix**: Migration 0008 ENABLE ROW LEVEL SECURITY + CREATE POLICY using app.firm_id GUC
- **Estimated**: 8 hours
- **Owner**: daedalus + ninurta

### P2-5: PII Encryption Sprint (afm, names, audit payload)
- **GG4 todo**: 4a5888eb (deferred from Day 5)
- **Scope**: Envelope encryption με tenant DEK; pgcrypto deterministic για AFM
- **Estimated**: 24 hours
- **Owner**: daedalus + tool-specialist

---

## P2 — Phase 1.5

### P2-2: DRAFT invoice number collision (Date.now() based) ⏳ Day 10b
- **Fix**: `DRAFT-${crypto.randomUUID()}` — 5 min, in progress

### P3-1: Soft-delete semantics inconsistent across 4 modules
- **Issue**: document/calendar = soft_deleted_at, time_entry = status='written_off', expense = no soft delete, party = valid_to
- **Fix**: ADR + Migration 0008 standardize on soft_deleted_at
- **Estimated**: 4 hours

### P3-6: Document download URL via query parameter (`?_firm=`)
- **Risk**: Firm slug leaks via Referer header
- **Fix**: Cookie-based firm resolution OR presigned URL
- **Estimated**: 3 hours

### P3-7: 9 ΚΠολΔ rules με requires_legal_review=true
- **Pending Themis review**: kpold-625, kpold-237, kpold-632, kpold-630a, kpold-518-katachristiki, kpold-564-katachristiki, +3
- **Estimated**: 8 hours legal review session

### P3-8: Rate limiting absent σε POST /invoices/draft + /payments
- **Risk**: Global 120/min only; expensive endpoints unprotected
- **Fix**: Per-endpoint rateLimit config — 30 min

### P3-9: billing_split_locked enforcement gap
- **Issue**: Default unlocked → no SUM=100 enforcement at create time
- **Decision needed**: Always-validate vs lock-after-finalize pattern
- **Estimated**: 2 hours

---

## P3 — Polish

### P3-2: Debug console.log/warn σε queues + r2-client (Day 7 carry-over)
- **Fix**: Replace με fastify.log.* — 30 min

### P3-3: Matter selector plain HTML select (Day 9 S7.5)
- **Fix**: Replace με cmdk/radix combobox — 3 hours

### P3-4: TimerWidget shown σε login/register (Day 9 S7.4)
- **Fix**: Move mount inside authenticated layout group — 30 min

### P3-5: CurrencyInput pattern duplicated σε 3+ components
- **Fix**: Extract σε `apps/web/components/ui/currency-input.tsx` — 1 hour

### P3-10: Resend email integration TODO
- **Blocker**: Niko-pending RESEND_API_KEY
- **Fix ETA**: 2 hours after credential

### P3-11: pdf-parse dependency missing ⏳ Day 10b
- **Fix**: `pnpm --filter @themisos/api add pdf-parse @types/pdf-parse` — 5 min

### P3-12: Tenant cache unbounded growth (no LRU)
- **Fix**: Replace Map με lru-cache, max=10000 — 30 min

### P3-13: Documents content endpoint loads πλήρες ciphertext σε memory
- **Risk**: 50MB doc → 100MB+ peak per request
- **Fix**: Refactor decryptDocumentFromR2 για streaming AES-GCM — 8 hours

### P3-14: Invoice 'sent'/'partial' enum coverage gaps
- **Fix**: Add 'sent' to frontend enum + partial computation logic — 2 hours

### P3-15: Versions endpoint missing change_note display
- **Fix**: Update `apps/web/components/documents/versions-list.tsx` — 1 hour

### P3-16: Provisioning σε register-firm είναι synchronous DDL
- **Fix**: Move to BullMQ queue + 202 Accepted + polling endpoint — 6 hours

---

## P4 — Doc/Cleanup

### P4-1: any type assertions σε r2-client + rules-engine (5 places, low priority)
### P4-2: Invoice line description Greek string not centralized (i18n catalog future)
### P4-3: Migration ordering not documented (add scripts/migrate.sh + README)
### P4-4: No automated smoke test ✅ **DONE Day 10** (`scripts/smoke-test-phase1.mjs`)
### P4-5: Audit log payload not used σε auth route ⏳ Day 10b (combined με P1-1 fix)

---

## Smoke Test Findings (Day 10)

From `scripts/smoke-test-phase1.mjs` design:

1. **API port = 4000** (όχι 3500) — document σε deployment guides
2. **Login χρειάζεται `x-firm-slug` header** — frontend cookie middleware handles, document για external clients
3. **Invoice draft endpoint = `POST /api/v1/invoices/draft`** (όχι base path) — document
4. **Deadline endpoint = `POST /api/v1/calendar/calculate-deadline`** (POST not GET) — document
5. **No public audit log endpoint** — needed για forensic queries (Phase 1.5)
6. **No tenant cleanup endpoint** — needed για test teardown (Phase 1.5 admin module)

---

## Niko-Pending (External)

- ⏳ Domains: themisos.gr + themis.legal
- ⏳ Trademark: ΘΕΜΙΣ OS Class 9+42
- ⏳ RESEND_API_KEY (blocks P3-10)
- ⏳ R2 EU credentials (blocks document upload smoke testing)
- ⏳ Redis URL για BullMQ (blocks queue testing)

---

## Total Estimates

- **P0/P1 quick wins (Day 10b)**: ~1 hour
- **Phase 1.5 sprint (P1+P2 high)**: ~50 hours
- **All Phase 1 backlog**: ~95 hours
