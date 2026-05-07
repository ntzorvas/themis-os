# ΘΕΜΙΣ OS — Phase 1 E2E Smoke Test Specification

**Αρχείο:** `scripts/smoke-test-phase1.mjs`  
**Έκδοση:** 1.0 (Day 10)  
**Σκοπός:** Εντοπισμός integration regressions πριν Phase 1.5

---

## Τι κάνει

Εκτελεί το πλήρες happy path του Phase 1 end-to-end κατά τρέχοντος API instance.
Κάθε βήμα αποτελεί ανεξάρτητο assertion block. Αποτυχία ενός βήματος δεν σταματά
τα επόμενα — το script συνεχίζει και εκτυπώνει συγκεντρωτικά αποτελέσματα στο τέλος.

---

## Προϋποθέσεις

- Node.js ≥ 22 (native `fetch` χωρίς flag) ή Node.js 18+ με `--experimental-fetch`
- Τρέχον API instance (default port 4000)
- PostgreSQL instance με initialized tenant_template schema
- (Προαιρετικό) `DATABASE_URL` για audit log verification + cleanup
- (Προαιρετικό) `THEMIS_ADMIN_TOKEN` για admin-protected endpoints

Δεν απαιτούνται external dependencies (axios, jest κλπ). Χρήση μόνο Node.js stdlib.

---

## Εκτέλεση

### Βασική εκτέλεση (κατά localhost:4000)

```bash
node scripts/smoke-test-phase1.mjs
```

### Με custom API URL

```bash
THEMIS_API_URL=http://localhost:4000 node scripts/smoke-test-phase1.mjs
```

### Με audit log verification + auto-cleanup

```bash
DATABASE_URL=postgres://app_user:password@localhost:5432/themisos_dev \
  node scripts/smoke-test-phase1.mjs
```

### Dry-run mode (χωρίς HTTP requests)

```bash
node scripts/smoke-test-phase1.mjs --dry-run
```

Εκτυπώνει τι θα έκανε χωρίς να εκτελέσει κανένα HTTP call. Χρήσιμο για
επαλήθευση παραμέτρων πριν LIVE εκτέλεση.

### Πλήρης εκτέλεση με όλες τις επιλογές

```bash
THEMIS_API_URL=http://localhost:4000 \
  THEMIS_ADMIN_TOKEN=<token> \
  DATABASE_URL=postgres://user:pass@localhost:5432/themisos_dev \
  node scripts/smoke-test-phase1.mjs
```

---

## Μεταβλητές περιβάλλοντος

| Μεταβλητή | Default | Περιγραφή |
|---|---|---|
| `THEMIS_API_URL` | `http://localhost:4000` | Base URL του API |
| `THEMIS_ADMIN_TOKEN` | (none) | Bearer token για admin endpoints / audit log |
| `DATABASE_URL` | (none) | Postgres URL για audit check + cleanup |

---

## Happy Path — 17 Βήματα

### Βήμα 1: Εγγραφή firm
`POST /api/v1/auth/register-firm`

Δημιουργεί νέο firm με slug `smoke_test_<timestamp>`. Αποθηκεύει `firmId`,
`ownerUserId`, `firmSlug` στο state για τα επόμενα βήματα.

**Assertions:** HTTP 201, παρουσία `firmId` + `ownerUserId` στο response.

---

### Βήμα 2: Σύνδεση
`POST /api/v1/auth/login` με header `x-firm-slug: smoke_test_<ts>`

Αποθηκεύει `token` στο state. Όλα τα επόμενα requests χρησιμοποιούν
`Authorization: Bearer <token>` + `x-firm-slug` header.

**Assertions:** HTTP 200, παρουσία `token` στο response.

---

### Βήμα 3: Δημιουργία matter + parties
Τρία sub-calls:
- `POST /api/v1/parties` × 2 (client natural party + opposing natural party)
- `POST /api/v1/matters` (matter_type=litigation, status=active)
- `POST /api/v1/matters/:id/parties` × 2 (attach client side=ours + opposing side=opposing)

Client party επισυνάπτεται με `billing_split_percentage=100`, `is_primary_contact=true`.

**Assertions:** Όλα 201, παρουσία IDs.

---

### Βήμα 4: Επαλήθευση billing split
`GET /api/v1/matters/:id/parties`

Επαληθεύει ότι ο client party έχει `billing_split_percentage=100`.

**Assertions:** HTTP 200, `billing_split_percentage == 100` για client.

---

### Βήμα 5: Upload document (mock PDF)
`POST /api/v1/documents` (multipart/form-data)

Δημιουργεί minimal valid PDF buffer (256 bytes) και το αποστέλλει ως
`application/pdf` με `doc_type=pleading` + `matter_id`.

**Σημείωση:** Χωρίς dev Vault/R2 config, αναμένεται HTTP 500 `ENCRYPTION_ERROR`
ή 502 `R2_UPLOAD_ERROR`. Αυτό θεωρείται **αποδεκτό** — ο κώδικας εκτέλεσε
τον έλεγχο ως το σωστό σημείο. Το βήμα marked as partial pass.

**Assertions:** HTTP 201 (πλήρης) ή 500/502 με αναμενόμενο error code.

---

### Βήμα 6: Calendar event με ΚΠολΔ 237
`POST /api/v1/calendar/events`

Δημιουργεί deadline event με `deadline_rule_id=kpold-237` +
`deadline_trigger_date=2026-05-15T00:00:00Z`. Ο server υπολογίζει
αυτόματα το `occurs_at` μέσω του rules engine.

**Assertions:** HTTP 201, παρουσία `id`.

---

### Βήμα 7: Deadline calculation (pure computation)
`POST /api/v1/calendar/calculate-deadline`

Δοκιμάζει το pure computation endpoint (χωρίς DB, χωρίς tenant context).
Επαληθεύει ότι `rule_id=kpold-237` + `trigger_date=2026-05-15` επιστρέφει
`deadline_date`.

**Assertions:** HTTP 200, παρουσία `data.deadline_date`.

---

### Βήμα 8: Start time entry (timer)
`POST /api/v1/time-entries`

Δημιουργεί time entry χωρίς `ended_at` (ενεργός timer). 
`billable_rate_eur_cents=15000` (€150/h).

**Assertions:** HTTP 201, `ended_at === null`, παρουσία `id`.

---

### Βήμα 9: Stop timer
`POST /api/v1/time-entries/:id/stop`

Σταματά τον ενεργό timer. Ο server υπολογίζει `duration_minutes`.
Μικρή αναμονή 1.1s ώστε `duration_minutes > 0`.

**Assertions:** HTTP 200, `ended_at !== null`.

---

### Βήμα 10: Expense (court_fee)
`POST /api/v1/expenses`

Δημιουργεί δαπάνη `expense_type=court_fee`, `amount_eur_cents=5000` (€50),
`vat_pct=0`, `billable=true`.

**Assertions:** HTTP 201, παρουσία `id`.

---

### Βήμα 11: Invoice draft
`POST /api/v1/invoices/draft`

Δημιουργεί draft invoice από τα unbilled time entries + expenses της υπόθεσης.
Χρησιμοποιεί `vat_rate=24`. Ο server βρίσκει αυτόματα τον client party
μέσω `billing_split_percentage`.

**Assertions:** HTTP 201, array με ≥1 invoice, `status=draft`.

---

### Βήμα 12: Finalize invoice
`POST /api/v1/invoices/:id/finalize`

Μεταβαίνει το invoice από `draft` σε `issued`. Ο server παράγει
sequential `invoice_number` με μορφή `ΤΘ-YYYY-NNNN`.

**Assertions:** HTTP 200, `status=issued`, regex `/^ΤΘ-\d{4}-\d{4,}$/` στο `invoice_number`.

---

### Βήμα 13: Send invoice
`POST /api/v1/invoices/:id/send`

Μεταβαίνει σε `sent`. Email delivery deferred to Phase 1.5.

**Assertions:** HTTP 200, `status=sent`.

---

### Βήμα 14: Record payment
`POST /api/v1/invoices/:id/payments`

Φέρνει πρώτα `GET /api/v1/invoices/:id` για το ακριβές `total_eur_cents`.
Πληρώνει ακριβώς το σωστό ποσό με `payment_method=bank_transfer`.
Αναμένεται ο server να μεταβάλει το invoice σε `paid`.

**Assertions:** HTTP 201, `amount_eur_cents` ταιριάζει με `total_eur_cents`.

---

### Βήμα 15: VAT verification
`GET /api/v1/invoices/:id`

Επαληθεύει:
- `subtotal + vat = total`
- `vat ≈ subtotal × 0.24` (±1 cent για στρογγυλοποίηση)
- `status = paid`

**Assertions:** Αριθμητικός έλεγχος VAT 24% + συνέπεια totals.

---

### Βήμα 16: Audit log verification
Επαλήθευση ότι `audit_log` έχει ≥15 entries.

Στρατηγική (με σειρά προτεραιότητας):
1. `GET /api/v1/audit/log` με `THEMIS_ADMIN_TOKEN` (αν υπάρχει endpoint)
2. Direct DB query μέσω `psql $DATABASE_URL` (αν `DATABASE_URL` ορίστηκε)
3. Soft skip με προειδοποίηση (αν τίποτα δεν είναι διαθέσιμο)

---

### Βήμα 17: Cleanup
Διαγράφει το test tenant schema.

Στρατηγική (με σειρά προτεραιότητας):
1. `DROP SCHEMA firm_smoke_test_<ts> CASCADE` + DELETE firm_users + firms μέσω `psql $DATABASE_URL`
2. `DELETE /api/v1/admin/firms/:id` με `THEMIS_ADMIN_TOKEN` (αν υπάρχει endpoint)
3. Manual instructions εκτυπώνονται στο console

---

## Exit codes

| Code | Σημασία |
|---|---|
| `0` | Όλα τα non-skipped βήματα πέρασαν |
| `1` | ≥1 βήμα απέτυχε |

---

## Canonical field names (post Day 9.5)

| Field | Route | Σημείωση |
|---|---|---|
| `billable_rate_eur_cents` | time-entries | int, cents |
| `bill_to_party_id` | invoices | set αυτόματα από server (billing_split) |
| `source_type` / `source_id` | invoice_lines | `'time'` ή `'expense'` |
| `billing_split_percentage` | matter_party | decimal, 100 = πλήρης |
| `invoice_number` | invoices | `ΤΘ-YYYY-NNNN` μορφή |

---

## Γνωστές περιορισμοί

1. **Document upload (Βήμα 5):** Χωρίς dev Vault + R2 credentials, το βήμα
   αναμένεται να επιστρέψει 500/502. Το smoke test χειρίζεται αυτό gracefully.

2. **Audit log (Βήμα 16):** Δεν υπάρχει public `GET /api/v1/audit/log` endpoint
   στο Phase 1. Απαιτείται DATABASE_URL ή admin endpoint για πλήρη επαλήθευση.

3. **Cleanup (Βήμα 17):** Χωρίς DATABASE_URL ή admin endpoint, η διαγραφή
   εκτυπώνει manual instructions. Τα test firms με slug `smoke_test_*` μπορούν
   να διαγραφούν batch με:
   ```sql
   DELETE FROM public.firms WHERE slug LIKE 'smoke_test_%';
   ```

4. **AFM validation:** Το registration χρησιμοποιεί dummy AFM `123456789`.
   Αν ο server ενεργοποιήσει strict ΑΑΔΕ checksum validation, το βήμα 1
   θα αποτύχει. Αντικαταστήστε με valid AFM.

---

## Σχέση με άλλα tests

- **Unit tests** (packages/): δεν καλύπτονται εδώ
- **Playwright E2E** (Phase 1.5): frontend testing
- **Encryption sprint** (Phase 1.5): βήμα 5 θα απαιτεί full Vault + R2 setup
- **Multi-tenant isolation tests**: separate exercise (δεν καλύπτονται)
