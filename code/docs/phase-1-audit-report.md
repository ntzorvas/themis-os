# Phase 1 Full Audit Report — ΘΕΜΙΣ OS
## Άργος System Auditor — Day 10

**Date**: 2026-04-29
**Mode**: `audit` (full 6-step methodology)
**Scope**: 7 modules (Auth, Provisioning, Matters, Parties, Documents, Calendar+Rules, Billing) + 10 invariants
**Reviewer**: Άργος (Argos)
**Project root**: `/root/projects/themis-os/code/`

---

## Executive Summary

Phase 1 (Days 1-9) παρέδωσε λειτουργικό MVP με **σταθερή multi-tenant αρχιτεκτονική (schema-per-tenant + withTenantSchema)**, **invariant-aware design** (10 invariants τεκμηριωμένα), και **Greek-first UX** σε όλα τα 7 modules. Η συνολική ποιότητα κώδικα είναι υψηλή (8417 LOC σε API routes/rules-engine), με συστηματική χρήση Zod, audit logging σε ΟΛΑ τα mutations εκτός από auth (βλ. P0-1), και σωστό envelope encryption για documents.

**Εντούτοις**, ο audit εντόπισε **3 P0 blocking issues** που πρέπει να λυθούν πριν production:
1. **Audit log column mismatch στο auth route** (`ip_address` vs `ip`) — όλα τα login/logout/reset audit INSERTs αποτυγχάνουν σιωπηλά
2. **`/api/v1/auth/refresh` είναι exempt αλλά δεν έχει handler** — 404 + bypass tenant resolution
3. **API contract mismatch backend↔frontend** στο billing module (Day 9 verdict: REJECTED) — runtime deserialization failures

Επίσης **9 P1 issues** σχετικά με: missing RLS policies (defense-in-depth gap), encryption deferred (PII plaintext per Invariant #4 carry-over), greek-utils build broken, OCR runs σε ciphertext, expense soft-delete undefined, debug logs σε production paths, download auth via query string (S2 από Day 7), και r2_key exposure στο versions endpoint.

**Recommended first action**: Fix P0-1 (audit ip column) — 5 λεπτά work, αποκαθιστά compliance Invariant #2 για auth events.

---

## STEP 1 — Purpose Check (per module)

| Module | Stated Purpose (από docs/comments) | Actual Behavior | Gap |
|--------|-----------------------------------|-----------------|-----|
| **Auth** | Register firm, login με JWT 8h, logout (jti revoke), /me, password reset με sha256(token) + 1h TTL, argon2id hashing | Όλα implemented + sound. Αλλά: refresh endpoint declared exempt χωρίς handler, και audit INSERTs αποτυγχάνουν σιωπηλά λόγω column name | P0-1, P0-2 |
| **Provisioning** | Schema-per-tenant με 0001-0007 migrations, RLS όπου χρειάζεται, FIRM_SCHEMA_REGEX validation | Schemas isolated μόνο μέσω application-level `withTenantSchema`. **Καμία RLS policy** στο tenant_template — defense-in-depth gap | P1-1 |
| **Matters** | M2M Matter↔Party με billing_split (Invariant #5), DEFERRABLE trigger για SUM=100, status transitions audited | Σωστή υλοποίηση. trg_billing_split χρησιμοποιεί billing_split_locked flag (relaxed C4 fix). | OK |
| **Parties** | Unified Party Model (Invariant #1), AFM checksum, time-bounded roles, FTS + AFM exact search | Σωστά implemented. **PII (afm, display_name) plaintext** — Invariant #4 deferred (GG4 todo `4a5888eb`) | P1-2 |
| **Documents** | R2 EU με encryptDocumentForR2 (Invariant #9), versioning, soft-delete, OCR queue async | Encryption σωστά **server-side**, never plaintext σε R2. ALLA: OCR runs σε ciphertext (decrypt-first deferred Phase 2), versions endpoint εκθέτει r2_key | P1-3, P1-4 |
| **Calendar+Rules** | 34 rules με versioning Ν.5221/2025, August suspension, weekend rollover, 6 BETA flagged rules pending legal review | Excellent — Day 8 APPROVED. 16/16 unit tests pass. requires_legal_review=true για 9 rules σε JSON | P2-1 (legal review backlog) |
| **Billing** | Time-entries, expenses, invoices με ΤΘ-{YYYY}-{NNNN} numbering, billing_split scaling, BIGINT cents, 5 audit hooks | Backend solid (Day 9 functional PASS). **API contract mismatch με frontend** σε 3+ field names — REJECTED στο Day 9 verdict | P0-3 |

---

## STEP 2 — User Journey Map

### Journey J1: New firm onboarding (happy path)
1. Visit `themisos.gr/register` → `RegisterFirmSchema.safeParse`
2. POST /api/v1/auth/register-firm (rate limit 3/h) → argon2 hash → `provisionFirm` (DB tx: firms + firm_users + CREATE SCHEMA)
3. Email πρέπει να σταλεί με login URL — **TODO comment, όχι implemented** (`actions.ts` line 734-748)
4. Friction: user ποτέ δεν λαμβάνει email confirmation → must navigate to `<slug>.themisos.gr/login` manually

### Journey J2: Login + matter creation
1. POST /login (rate limit 5/15min) → argon2.verify (constant-time even for missing user)
2. JWT signed, session row INSERT, audit_log INSERT — **audit INSERT throws σιωπηλά (P0-1)**
3. Frontend storeSessionAction → httpOnly cookie `themisos_session`
4. POST /matters → withTenantSchema → INSERT + audit (works)
5. POST /matters/:id/parties με billing_split → trg_billing_split fires at COMMIT
6. Friction: matter selector είναι plain `<select>` (Day 9 S7.5 known)

### Journey J3: Document upload + retrieval
1. multipart POST /documents (≤50MB) → mime validation → encryptDocumentForR2 → R2 upload
2. document + document_version + audit INSERT inside withTenantSchema
3. Async enqueueDocumentProcessing (BullMQ ή mock)
4. **OCR worker downloads ciphertext, attempts pdf-parse, fails σιωπηλά** (P1-3)
5. GET /documents/:id/content → server-side decrypt → stream plaintext με Content-Disposition attachment
6. Friction: download from `<a href>` tag bypasses x-firm-slug header → fallback `?_firm=` query param (Day 7 S2)

### Journey J4: Deadline calculation
1. POST /calendar/calculate-deadline (no tenant required) με rule_id + trigger_date
2. calculator.ts: select variant → addBusinessDays/addCalendarMonths → August suspension → weekend rollover → exterior extension
3. Returns DeadlineResult με warnings_gr + requires_legal_review flag
4. UI displays BETA banner για 6 flagged rules
5. Friction: 9 rules με `requires_legal_review=true` περιμένουν Themis review (P2-1)

### Journey J5: Time entry → invoice → payment (BLOCKING)
1. POST /time-entries → INSERT με status='draft', billable_rate_eur_cents
2. POST /invoices/draft (matter_id) → query unbilled entries + expenses → split by matter_party.billing_split_percentage → CREATE 1 invoice per party με scaled amounts
3. **DRAFT-{Date.now()}-{party_id.slice(0,8)}** placeholder invoice number → collision risk
4. POST /:id/finalize → nextInvoiceNumber() (advisory lock) → mark time/expenses invoiced
5. POST /:id/payments → idempotency_key → auto-mark 'paid'
6. **BLOCKING**: Frontend types/billing.ts uses `hourly_rate_eur_cents`, `party_id`, `time_entry_id` — backend returns `billable_rate_eur_cents`, `bill_to_party_id`, `source_type+source_id` (P0-3)

---

## STEP 3 — Friction Measurement

| Friction Point | Cost | Aναπόφευκτη; |
|----------------|------|--------------|
| User ποτέ δεν λαμβάνει register email | High (no onboarding completion signal) | Όχι — Resend integration TODO ήδη commented out |
| Audit log silently fails για auth events | Critical compliance gap (GDPR Art. 32) | Όχι — typo |
| OCR runs σε encrypted PDF, fails για ALL real docs | High (search/fulltext broken Phase 1) | Σχεδιασμένη deferral, αλλά extracted_text=NULL για όλα |
| `/api/v1/auth/refresh` declared exempt αλλά returns 404 | Medium (μπερδεύει frontend, dead config) | Όχι |
| Frontend↔backend field mismatch | Critical (D9 REJECTED) | Όχι — process gap |
| Greek-utils δεν έχει dist/ → web build broken | High (Next.js cannot compile) | Όχι — pnpm script missing |
| RLS όχι enabled στο public/tenant_template | Medium (defense-in-depth) | Όχι — schema isolation works αλλά shallow |
| Soft-delete inconsistency (expense vs time vs party) | Medium (UI confusion) | Όχι — design decision pending |
| Debug `console.log` σε queues/r2-client | Low (log pollution prod) | Όχι |
| TimerWidget shown σε login pages (Day 9 S7.4) | Low UX | Όχι |

---

## STEP 4 — Gap Categorization

### Missing (10)
- `/auth/refresh` handler (declared exempt, no route)
- Resend email send για register-firm + forgot-password (TODOs)
- RLS policies στο public.firms, firm_users, audit_log
- BullMQ rate limiting σε POST /invoices/draft + /payments
- Encryption για PII columns (afm, display_name) — Invariant #4 ungated
- Encryption για audit_log.payload JSONB
- pdf-parse dependency (`PENDING` comment line 151 queues/document-processing.ts)
- API contract mapping layer (backend response transformer)
- Combobox για matter selector (Day 9 S7.5)
- CurrencyInput dedup component (Day 9 finding)

### Broken (4)
- Auth audit_log INSERTs (column `ip_address` δεν υπάρχει στο schema)
- greek-utils workspace package (no dist/ build)
- Frontend↔backend billing schema (3 field name mismatches)
- OCR text extraction σε όλα τα έγγραφα (runs on ciphertext)

### Inefficient (3)
- DRAFT invoice numbering με `Date.now()` (collision risk + non-deterministic)
- TenantCache LRU absent (Map μπορεί να μεγαλώσει χωρίς όριο)
- Documents content endpoint loads πλήρες ciphertext στη μνήμη πριν decrypt (50MB max αλλά no streaming)

### Inconsistent (5)
- Soft-delete: time_entry χρησιμοποιεί status='written_off', expense δεν έχει column καθόλου, document χρησιμοποιεί `soft_deleted_at`, party uses... TBD
- Audit log: routes 5/8 χρησιμοποιούν `ip` column, auth route χρησιμοποιεί `ip_address` (broken)
- Invoice status enum: backend έχει 'sent', frontend δεν τo έχει; frontend έχει 'partial', backend δεν τo έχει
- Expense type enum: 5 διαφορές μεταξύ frontend/backend
- Payment method enum: frontend έχει 'card'/'pos', backend έχει 'viva'/'ethniki'

### Undocumented (4)
- Refresh token strategy (καθόλου spec, μόνο route exempt)
- TimerWidget mount lifecycle (mounted στο root layout, no auth guard)
- billing_split_locked semantics (trigger only fires when locked=true — αν false, καμία enforcement)
- Migration ordering / how `0007` πρέπει να εφαρμοστεί per-tenant (no provisioning script reference)

### Security Risk (4)
- Auth audit silent failure → no forensic trail σε breach
- PII plaintext (afm, full names, doc titles) σε όλα τα tenant schemas
- r2_key exposed στο /documents/:id/versions response (S3 από Day 7) — internal storage path leak
- Download URL με `?_firm=` query parameter (S2 από Day 7) — Bearer auth bypass via referrer leakage

---

## STEP 5 — Prioritization Matrix

(Πλήρης πίνακας στο `phase-1-gaps-ranked.json`. Top 10 inline:)

| # | Gap | Category | Impact | Effort | Urgency | Score |
|---|-----|----------|--------|--------|---------|-------|
| 1 | Auth audit_log column `ip_address` does not exist | Broken+Security | 5 | 1 | 5 | **25.0** |
| 2 | Frontend↔backend billing contract mismatch (3 fields) | Broken | 5 | 2 | 5 | **12.5** |
| 3 | `/auth/refresh` exempt αλλά no handler | Missing | 4 | 2 | 4 | **8.0** |
| 4 | greek-utils δεν έχει dist/ → web build broken | Broken | 5 | 1 | 4 | **20.0** |
| 5 | RLS policies missing στο public + tenant_template | Missing+Security | 4 | 4 | 3 | **3.0** |
| 6 | Encryption Sprint (afm, display_name, audit payload) | Missing+Security | 5 | 5 | 3 | **3.0** |
| 7 | OCR runs on ciphertext (decrypt-first absent) | Broken | 4 | 3 | 3 | **4.0** |
| 8 | DRAFT invoice number collision (Date.now) | Inefficient | 3 | 1 | 2 | **6.0** |
| 9 | r2_key leaked στο /versions response | Security | 3 | 1 | 3 | **9.0** |
| 10 | Soft-delete semantics inconsistent across modules | Inconsistent | 3 | 2 | 2 | **3.0** |

Formula: **Priority Score = (Impact × Urgency) / Effort**

---

## STEP 6 — Ranked Backlog (Top 30)

### **P1 — Auth audit_log column mismatch (`ip_address` → `ip`)** (Score: 25.0)
- **Problem**: 3 INSERT statements στο `apps/api/src/routes/auth/index.ts:470, 542, 887` χρησιμοποιούν column `ip_address`. Schema (`packages/db/migrations/0002_template_schema.sql:474`) δηλώνει column ως `ip inet`. Postgres throws `column "ip_address" of relation "audit_log" does not exist`.
- **Evidence**:
  - `apps/api/src/routes/auth/index.ts:470` — `(actor_user_id, action, target_type, target_id, ip_address, user_agent, outcome)`
  - `packages/db/migrations/0002_template_schema.sql:474` — `ip inet,`
  - All other 5 routes (calendar, documents, expenses, invoices, matters, parties, time-entries) χρησιμοποιούν σωστά `ip` (15+ correct INSERTs)
  - Auth route wraps σε try/catch (line 476: `// Non-fatal: JWT already issued; log and continue`) — silent failure
- **Recommended action**: Replace `ip_address` με `ip` (και προσθήκη `payload` column με `'{}'::jsonb` αν θες consistency) σε auth/index.ts:470, 542, 887. ~5 minutes work.
- **Assigned to**: tool-specialist

### **P1 — Greek-utils package missing dist/ build** (Score: 20.0)
- **Problem**: `packages/greek-utils/dist/` δεν υπάρχει. Day 7 verdict B1 conditions notes "greek-utils .ts/.js mismatch" blocking Next.js build. `packages/greek-utils/src/` έχει 3 .ts files (afm.ts, normalize.ts, index.ts) αλλά no compiled output.
- **Evidence**: `ls /root/projects/themis-os/code/packages/greek-utils/dist/` → "No such file or directory". `apps/api/src/routes/parties/index.ts:34` imports `validateAFM` from `@themisos/greek-utils`.
- **Recommended action**: Add `"build": "tsc"` σε greek-utils/package.json + run `pnpm --filter @themisos/greek-utils build` πριν web build. Add prepublish hook ή pnpm postinstall trigger.
- **Assigned to**: tool-specialist

### **P1 — Frontend↔backend billing API contract mismatch** (Score: 12.5)
- **Problem**: 3 critical field name mismatches + 3 enum mismatches. Day 9 verdict REJECTED. Runtime deserialization failures καθώς frontend types δεν αντιστοιχούν με backend response shape.
- **Evidence**: Day 9 report sections 2 + 7. Specific: `apps/web/types/billing.ts:34` (hourly_rate_eur_cents) vs backend `billable_rate_eur_cents`; line 213 (party_id) vs `bill_to_party_id`; lines 203-204 (time_entry_id/expense_id) vs `source_type/source_id`.
- **Recommended action**: **Option 1 (preferred)**: Add response transformer στο `apps/api/src/routes/{time-entries,invoices}/index.ts` που maps internal columns → public API shape. **Option 2**: Update `apps/web/types/billing.ts` + όλα τα consumers σε backend names. Estimated: 2-4h.
- **Assigned to**: tool-specialist + app-specialist (synchronized)

### **P1 — r2_key exposure στο /documents/:id/versions** (Score: 9.0)
- **Problem**: GET /api/v1/documents/:id/versions επιστρέφει `DocumentVersionRow[]` που includes `r2_key`. Internal storage path leak (firms/{firmId}/documents/{uuid}.bin).
- **Evidence**: `apps/api/src/routes/documents/index.ts:738-746` — SELECT lists r2_key; line 752 returns `{data: versions}` χωρίς sanitization. Single document endpoint χρησιμοποιεί `sanitizeDocument()` (line 762) που strips r2_key — versions endpoint δεν.
- **Recommended action**: Apply same sanitization σε versions response — strip r2_key + add download_url per version.
- **Assigned to**: tool-specialist

### **P2 — `/api/v1/auth/refresh` declared exempt αλλά handler missing** (Score: 8.0)
- **Problem**: `apps/api/src/plugins/fastify-tenant.ts:193` declares `/api/v1/auth/refresh` σε EXEMPT_ROUTES, αλλά καμία fastify route registered γι' αυτό σε `auth/index.ts`. Frontend δεν έχει refresh logic — JWT lifetime hardcoded 8h χωρίς refresh.
- **Evidence**: `grep refresh apps/api/src/routes/auth/index.ts` → 0 matches. Frontend cookie maxAge=8h (lib/auth.ts:89).
- **Recommended action**: Δύο επιλογές: (a) Remove `/auth/refresh` από EXEMPT_ROUTES μέχρι να implementhei refresh token rotation, ή (b) Implement refresh handler με sliding window (rotate jti, update user_sessions).
- **Assigned to**: tool-specialist (decision needed από product owner)

### **P2 — DRAFT invoice number collision με Date.now()** (Score: 6.0)
- **Problem**: `apps/api/src/routes/invoices/index.ts:336` — `DRAFT-${Date.now()}-${party_id.slice(0, 8)}`. 1ms parallel collision risk + non-deterministic ordering.
- **Evidence**: Day 9 verdict N4. Code at line 336.
- **Recommended action**: Replace με `DRAFT-${crypto.randomUUID()}` ή `DRAFT-${nanoid(12)}`. ~2 minutes.
- **Assigned to**: tool-specialist

### **P2 — OCR runs on ciphertext** (Score: 4.0)
- **Problem**: `apps/api/src/queues/document-processing.ts:153` calls pdf-parse στο raw R2 download (encrypted bytes). Fails silently για όλα τα real PDFs. extracted_text always NULL → no full-text search.
- **Evidence**: Code lines 140-162; comment line 144: "Phase 2: decrypt first, then extract".
- **Recommended action**: Insert `await decryptDocumentFromR2(ciphertext, envelope, firm_slug, classification)` πριν το pdf-parse call. Requires fetching envelope_metadata από DB inside processJobReal. Estimated 1-2h.
- **Assigned to**: tool-specialist

### **P2 — RLS policies absent στο public + tenant_template** (Score: 3.0)
- **Problem**: 0 RLS policies σε καμία migration. Tenant isolation rests εξ ολοκλήρου σε application-level `withTenantSchema` discipline. Αν developer ξεχάσει wrap, cross-tenant query.
- **Evidence**: `grep -i "ROW LEVEL SECURITY|CREATE POLICY" packages/db/migrations/*.sql` → 0 matches.
- **Recommended action**: Add defense-in-depth RLS policies στο tenant_template για κρίσιμα tables (matter, party, document, audit_log, invoice). Use `current_setting('app.firm_id')::uuid` set by withTenantSchema. Phase 1.5 sprint.
- **Assigned to**: daedalus + ninurta (security review)

### **P2 — Encryption Sprint για PII** (Score: 3.0)
- **Problem**: afm, display_name, audit_log.payload JSONB stored plaintext. Invariant #4 explicitly deferred (parties/index.ts:23-25 comment + GG4 todo `4a5888eb`).
- **Evidence**: `packages/db/migrations/0002_template_schema.sql:486` — "payload JSONB should be envelope-encrypted with tenant DEK (Phase 1.5)". `parties/index.ts` comment: "afm, display_name stored as plaintext in Phase 1 for search simplicity".
- **Recommended action**: Phase 1.5 sprint όπως τεκμηριωμένο. Vault KMS already wired (packages/crypto). Need: (1) tenant DEK provisioning hook (already exists), (2) envelope encrypt afm before INSERT, (3) decrypt για search OR pgcrypto deterministic encryption για AFM exact-match.
- **Assigned to**: daedalus + tool-specialist

### **P3 — Soft-delete semantics inconsistent** (Score: 3.0)
- **Problem**: 4 διαφορετικές προσεγγίσεις: (a) document/calendar_event έχουν `soft_deleted_at` column, (b) time_entry χρησιμοποιεί `status='written_off'`, (c) expense δεν έχει column καθόλου (κωδικός suggests soft-delete αλλά no schema support), (d) party χρησιμοποιεί valid_to σε party_role + matter_party.
- **Evidence**: Day 9 anomalies A7.2, A7.3. Schema 0002 + 0006.
- **Recommended action**: Decide canonical pattern (recommend `soft_deleted_at timestamptz` σε όλα τα business entities). Migration 0008 για να προσθέσει column σε expense/time_entry/party. Update routes να χρησιμοποιούν consistent column.
- **Assigned to**: daedalus (ADR needed)

### **P3 — Debug console.log σε production paths** (Score: 2.5)
- **Problem**: `apps/api/src/queues/document-processing.ts` lines 45-47, 52-54, 105-107, 111-113, 121, 158-161, 166 — 11 console.log/warn/error calls. Day 7 S1 acknowledged.
- **Recommended action**: Replace με `fastify.log.info`, ή gate με `if (process.env.DEBUG === '1')`.
- **Assigned to**: tool-specialist

### **P3 — Combobox για matter selector (Day 9 S7.5 carry-over)** (Score: 2.5)
- **Problem**: Spec calls for combobox με search; Day 9 output is plain `<select>`. Doesn't scale με 100+ matters per firm.
- **Recommended action**: Use existing UI primitive (radix combobox ή cmdk). Replace στα Time Entries, Expenses, Invoices forms.
- **Assigned to**: app-specialist

### **P3 — TimerWidget auth gate (Day 9 S7.4 carry-over)** (Score: 2.5)
- **Problem**: TimerWidget mounted στο root layout (`apps/web/app/layout.tsx`) — appears σε login/register pages όπου user not authenticated.
- **Recommended action**: Move mount inside authenticated layout group (e.g. `(app)/layout.tsx`) ή add `await getSession()` guard.
- **Assigned to**: app-specialist

### **P3 — CurrencyInput component dedup** (Score: 2.5)
- **Problem**: `parseFloat(val.replace(',', '.'))` + `Math.round(euros * 100)` pattern repeated σε payment-dialog.tsx:144-146, expenses-client.tsx:112-114, new-time-entry-dialog.tsx:187. DRY violation.
- **Recommended action**: Extract `<CurrencyInput value={cents} onChange={cents => ...}/>` component σε `apps/web/components/ui/`.
- **Assigned to**: app-specialist

### **P3 — Download URL via query parameter (Day 7 S2 carry-over)** (Score: 3.0)
- **Problem**: `documents-table.tsx:84-85` falls back to `?_firm=firmSlug` because `<a href>` cannot send headers. Bypassable + leaks via Referer header.
- **Recommended action**: Use cookie-based firm resolution (already implemented σε middleware για session) OR generate presigned download URL με short-lived JWT.
- **Assigned to**: tool-specialist + app-specialist

### **P3 — 9 rules με requires_legal_review=true awaiting Themis** (Score: 2.0)
- **Problem**: `docs/research/kpold-rules-top30-v2.json` έχει 9 rules με requires_legal_review=true. UI shows BETA banner αλλά rules calculate normally. Risk of incorrect deadline.
- **Evidence**: `grep "requires_legal_review.*true"` → 9 matches σε kpold-rules-top30-v2.json. Day 8 conditions list 6 rule IDs.
- **Recommended action**: Themis (legal counsel) review session — confirm/correct duration, deadline_kind, edge_cases. Document outcomes σε migration commit message.
- **Assigned to**: themis (legal agent) + michalis (regulatory check)

### **P3 — Rate limiting σε POST /invoices/draft + /payments** (Score: 2.0)
- **Problem**: Global rate limit 120/min applied; no per-endpoint stricter limit για heavy operations. Day 9 6.4 acknowledged.
- **Recommended action**: Add `config.rateLimit: { max: 30, timeWindow: '1 minute' }` σε draft/finalize/payments handlers.
- **Assigned to**: tool-specialist

### **P3 — billing_split_locked enforcement gap** (Score: 2.0)
- **Problem**: `trg_billing_split` constraint trigger fires ΜΟΝΟ όταν `billing_split_locked=true` σε τουλάχιστον μία row. Default false → καμία SUM=100 enforcement κατά την δημιουργία ενός matter με splits.
- **Evidence**: 0002_template_schema.sql:843-878.
- **Recommended action**: Document explicitly στο matters routes ότι billing_split_locked must be set μόλις finalized; enforce σε application code OR change trigger να always validate.
- **Assigned to**: daedalus

### **P3 — Resend email integration TODO** (Score: 2.0)
- **Problem**: register-firm + forgot-password έχουν Resend integration commented out (auth/index.ts:734-748). User experience broken — no confirmation emails.
- **Recommended action**: Implement Resend client wrapper + uncomment block. Niko-pending RESEND_API_KEY env var.
- **Assigned to**: tool-specialist (after Niko provides API key)

### **P3 — pdf-parse not in package.json** (Score: 2.0)
- **Problem**: `apps/api/src/queues/document-processing.ts:151` — "PENDING: pnpm --filter @themisos/api add pdf-parse @types/pdf-parse". Comment βγαίνει είτε σε dynamic import error.
- **Recommended action**: Add dependency ή remove the import. After P2 OCR fix, decide if pdf-parse, mupdf, ή tesseract is the long-term choice.
- **Assigned to**: tool-specialist

### **P3 — Tenant cache unbounded growth** (Score: 1.5)
- **Problem**: `firmCache` Map (fastify-tenant.ts:211) δεν έχει LRU eviction. 10K+ unique slugs over time → memory bloat.
- **Recommended action**: Replace με `lru-cache` package, max=10000.
- **Assigned to**: tool-specialist

### **P3 — Documents content endpoint loads πλήρες ciphertext** (Score: 1.5)
- **Problem**: `documents/index.ts:613-665` — `r2.getObject()` returns full Buffer, decrypted into another Buffer, then `reply.send(plaintext)`. 50MB doc → 100MB+ peak memory per request.
- **Recommended action**: Stream R2 download → stream decrypt → stream to client. Requires refactor of decryptDocumentFromR2 to support streaming AES-GCM.
- **Assigned to**: daedalus (architecture decision)

### **P3 — Invoice 'sent' και 'partial' enum coverage** (Score: 2.0)
- **Problem**: Backend έχει 'sent', frontend δεν τo έχει. Frontend έχει 'partial', backend δεν έχει partial logic.
- **Recommended action**: Align enums + add 'partial' computation στο payments handler (totalPaid > 0 AND < invoiceTotal).
- **Assigned to**: tool-specialist + app-specialist

### **P3 — Versioning endpoint missing change_note display** (Score: 1.5)
- **Problem**: document_version.change_note column populated από `description` field στο upload, αλλά UI δεν το εμφανίζει σε versions list.
- **Recommended action**: Frontend versions UI: render change_note + uploader name + timestamp.
- **Assigned to**: app-specialist

### **P3 — Provisioning σε register-firm είναι synchronous** (Score: 1.5)
- **Problem**: `apps/api/src/routes/auth/index.ts:178-186` — CREATE SCHEMA inline σε request transaction. 5+ table creates · indexes · constraints σε 1 request → slow + lock contention.
- **Evidence**: TODO comment line 183: "replace with queue job — provisionTenantSchema(firm.id, schemaName)".
- **Recommended action**: Move to BullMQ queue. Return 202 Accepted with provisioning_job_id; frontend polls /api/v1/firms/:id/provisioning-status.
- **Assigned to**: daedalus + tool-specialist

### **P4 — `any` type casts σε rules-engine και r2-client** (Score: 1.0)
- **Problem**: 4 instances of `any` type assertions στο `r2-client.ts` (Day 7 verdict acknowledged) + 1 σε `rules.ts:158`.
- **Recommended action**: Type the AWS SDK responses + raw JSON. Low priority — code is correct.
- **Assigned to**: tool-specialist

### **P4 — Invoice line description fallback uses Greek string** (Score: 0.8)
- **Problem**: `invoices/index.ts:380` — `te.description ?? 'Χρόνος εργασίας'` — hardcoded Greek string (good!) αλλά not centralized σε i18n.
- **Recommended action**: Extract σε `apps/api/src/lib/messages.ts` for future EN/EL switching.
- **Assigned to**: tool-specialist

### **P4 — Audit log `payload` column not used σε auth route** (Score: 1.0)
- **Problem**: Auth INSERTs δεν περνάνε payload (column NOT NULL DEFAULT '{}'). Other routes σωστά περνάνε JSON context.
- **Recommended action**: Add payload με `{firmSlug, jti}` info για forensic trail.
- **Assigned to**: tool-specialist (combine με P1 fix)

### **P4 — Migration ordering not documented** (Score: 1.0)
- **Problem**: 0007 prerequisite "0002_template_schema.sql" mentioned σε comment μόνο. No migration runner detected (pure SQL files).
- **Recommended action**: Add `scripts/migrate.sh` με ordered apply + a README in packages/db/migrations/.
- **Assigned to**: daedalus

### **P4 — Docs scripts dir minimal** (Score: 0.8)
- **Problem**: `/root/projects/themis-os/code/scripts/` exists αλλά no migration / seed / smoke-test scripts visible. Day 8 conditions reference "BETA banner visible" — no automated check.
- **Recommended action**: Add smoke-test script that hits all 8 routes με sample tenant + asserts 200/201.
- **Assigned to**: dokimasia

---

## Summary Statistics

- **Total gaps found**: 30 (top backlog)
- **Blocking (P0/P1)**: 4 (audit ip column, billing contract, greek-utils build, r2_key leak)
- **Quick wins (Effort=1, Impact≥3)**: 5 (P1-1, P1-4, P2-DRAFT, P3-r2_key, P3-Resend env wiring)
- **Carry-overs from Days 7-9**: 11 verified και ranked
- **Phase 1.5 deferred items**: 3 (Encryption Sprint, ΔΠ από δικηγόρο module, presigned URLs)

### Recommended first action
**Fix P1-1 (auth audit_log column `ip_address` → `ip`)** — 5 minutes, restores Invariant #2 compliance για auth events. Blocking γιατί GDPR Art. 32 απαιτεί logging όλων των authentication events.

### Recommended Day 10-11 sprint (in order)
1. P1-1 audit ip column (5min) → P1-4 greek-utils build (30min) → P2-DRAFT UUID (5min) → P3-r2_key sanitize (15min)
2. P1-3 billing contract (Option 1: response mappers) — 2-4h
3. P2-`/auth/refresh` decision (remove ή implement) — 30min decision + 2h impl αν chosen
4. Run full QA gate (Δοκιμασία) → expect APPROVED
5. Then Phase 1.5 planning (Encryption Sprint, RLS, OCR decrypt-first)

---

## Appendix A — Files inspected

- `apps/api/src/server.ts` (197 LOC)
- `apps/api/src/plugins/fastify-tenant.ts` (649 LOC)
- `apps/api/src/routes/{auth,parties,matters,documents,calendar,time-entries,expenses,invoices,reports}/index.ts` (~6,500 LOC)
- `apps/api/src/queues/document-processing.ts` (233 LOC)
- `apps/api/src/lib/{r2-client,greek-vat,invoice-numbering}.ts`
- `packages/db/src/{client,provisioning,tenant-resolver,index}.ts`
- `packages/db/migrations/0000-0007*.sql`
- `packages/rules-engine/src/{calculator,rules,business-days,august-suspension,holidays,index}.ts` (1,051 LOC)
- `packages/crypto/src/*.ts`
- `packages/greek-utils/src/{afm,normalize,index}.ts`
- `apps/web/lib/{auth,jwt-verify,api-client,currency,calendar-rules-static}.ts`
- `apps/web/app/(auth)/{login,register,forgot-password,reset-password}/*`
- `apps/web/app/{matters,parties,documents,calendar,time-entries,expenses,invoices,reports}/*`
- `apps/web/components/{calendar,documents,invoices,matters,parties,time}/*`
- `docs/day{2-9}*.{md,json}` (audit + verdicts)

## Appendix B — Reviewer notes

- Code quality is **above average for an MVP at Day 9**: comprehensive comments, Zod everywhere, audit hooks systematic, multi-tenant pattern crisp.
- Main risk surface: **defense-in-depth gaps** (no RLS, plaintext PII, silent audit failures).
- The team's `dokimasia` QA process is producing detailed verdicts — process gap is *contract synchronization* (frontend types drift). Recommend OpenAPI spec + codegen σε Phase 1.5.
- Hephaestus / Daedalus / Ninurta engagement εκκρεμεί για: RLS design, encryption sprint, secret rotation policy.
