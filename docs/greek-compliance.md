# THEMIS OS — Greek Legal Compliance Module

**Spec version:** v0.2 (2026-04-28)
**Owner:** michalis (compliance)
**Predecessor:** v0.1 (2026-04-27)

---

## v0.2 changes at a glance

- §6 SOLON rewritten **from "Phase 2 ready" to full Phase 1 implementation spec** — TAXISnet OAuth, ZIP submission flow, status webhooks, certificate retrieval, retry/idempotency, ΑΠΕΔ pre-signing requirement.
- §7 ΑΠΕΔ rewritten **from "Phase 2" to full Phase 1 implementation spec** — portal.olomeleia.gr OAuth, signing API call, certificate verification, audit trail format, multi-signer flow.
- **NEW §10 Trust Accounting (ΕΔΕ)** — Greek bar requirements: separate bank account per client funds, two-way reconciliation Phase 1, three-way Phase 2.
- §1 ΔΣΑ Γραμμάτιο enriched with rate config table reference (`bar_rate_config` table).
- §8 Data Protection: explicit derogation noted for GDPR-vs-audit-log conflict (Ν.4624/2019 §31 — pseudonymization replaces deletion when legal-record retention is mandated).

---

## 1. ΔΣΑ Γραμμάτιο (Bar Association Stamp)

### What It Is

Every time an attorney appears in court (παράσταση), they must issue a "γραμμάτιο προκαταβολής" (prepayment stamp) to their Bar Association (ΔΣΑ for Athens, ΔΣΘ for Thessaloniki, etc.). This is a uniquely Greek requirement.

### Calculation Formula

```
Input: attorney_fee (the fee for this appearance)

ΔΣΑ Γραμμάτιο calculation:
  base_fee           = attorney_fee
  withholding_15pct  = base_fee * 0.15           # Παρακράτηση φόρου 15%
  efka_contribution  = base_fee * EFKA_RATE      # Varies by year/category
  eadd_contribution  = base_fee * EADD_RATE      # ΕΑΑΔ rate
  dsa_contribution   = base_fee * DSA_RATE       # ΔΣΑ own contribution

  total_stamp = base_fee + withholding_15pct + efka_contribution + eadd_contribution + dsa_contribution
```

Rates change annually. Stored in **`bar_rate_config`** table (NEW v0.2), one row per (bar_association, effective_from, effective_to). Admin updates yearly; effective dates make historical recalculation deterministic.

### Rate Configuration

| Parameter | Value (2026 example) | Source |
|-----------|---------------------|--------|
| Withholding tax | 15% | Set by law (immutable in code) |
| EFKA contribution | ~13.33% | `bar_rate_config.efka_rate` |
| EADD contribution | ~1% | `bar_rate_config.eadd_rate` |
| DSA contribution | Varies per association | `bar_rate_config.dsa_rate` |
| Minimum fee per case type | Per ΚΔ scales | `bar_rate_config.min_fees JSONB` |

### Data Flow

```
1. Attorney creates Hearing for Matter
2. Attorney specifies fee amount
3. System auto-calculates γραμμάτιο using active bar_rate_config row
4. System creates BarStamp record linked to Hearing + Matter
5. Attorney reviews calculation
6. On confirmation: BarStamp.status = "issued"
7. BarStamp amount appears as line item on client invoice
8. Monthly report: all γραμμάτια per attorney for ΔΣΑ submission
```

### Integration Points

- Hearing module: each hearing → ≤1 bar_stamp
- Billing module: bar stamp as invoice line item
- Reports module: monthly/annual γραμμάτια summary per attorney
- Settings: `bar_rate_config` admin-editable

### Validation Rules

- Fee >= minimum per case type (KΔ scales)
- One γραμμάτιο per hearing per attorney
- Cannot modify issued γραμμάτιο (only cancel + reissue, both audit-logged)
- Annual total per attorney (tax reporting view)

---

## 2. myDATA AADE Integration

### What It Is

myDATA is the mandatory electronic invoicing platform operated by AADE. Since 2021, all businesses in Greece must transmit invoices electronically.

### Document Types for Law Firms

| Type Code | Document | Greek Name | Usage |
|-----------|----------|-----------|-------|
| 1.1 | Sales Invoice | Τιμολόγιο Πώλησης | Rare for lawyers |
| 2.1 | Service Invoice | Τιμολόγιο Παροχής Υπηρεσιών (ΑΠΥ) | Primary for client billing |
| 2.1 | Fee Statement | Δελτίο Αμοιβής (ΔΑ) | Lawyer services specifically |
| 5.1 | Credit Invoice | Πιστωτικό Τιμολόγιο | Corrections/credit notes |

### myDATA API Integration

**Environments:**
- Sandbox: `mydata-dev.azure-api.net`
- Production: `mydata.aade.gr/myDATA`

**Authentication:**
- API key (`aade-user-id` header)
- Subscription key (`ocp-apim-subscription-key` header)
- Keys stored in `/root/.secrets/mydata/{firmslug}/` per deployment (NOT in DB)

**Endpoints used:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/SendInvoices` | POST | Transmit invoice XML |
| `/RequestDocs` | GET | Query transmitted documents |
| `/CancelInvoice` | POST | Cancel transmitted invoice |
| `/RequestMyExpenses` | GET | Pull expense invoices |
| `/RequestMyIncome` | GET | Pull income records |

### XML Generation (canonical example)

```xml
<InvoicesDoc>
  <invoice>
    <issuer>
      <vatNumber>FIRM_AFM</vatNumber>
      <country>GR</country>
      <branch>0</branch>
    </issuer>
    <counterpart>
      <vatNumber>PARTY_AFM</vatNumber>
      <country>GR</country>
    </counterpart>
    <invoiceHeader>
      <series>A</series>
      <aa>1</aa>
      <issueDate>2026-04-28</issueDate>
      <invoiceType>2.1</invoiceType>
      <currency>EUR</currency>
    </invoiceHeader>
    <invoiceDetails>
      <lineNumber>1</lineNumber>
      <netValue>1000.00</netValue>
      <vatCategory>1</vatCategory>
      <vatAmount>240.00</vatAmount>
      <incomeClassification>
        <classificationType>E3_561_003</classificationType>
        <classificationCategory>category1_3</classificationCategory>
        <amount>1000.00</amount>
      </incomeClassification>
    </invoiceDetails>
    <invoiceSummary>
      <totalNetValue>1000.00</totalNetValue>
      <totalVatAmount>240.00</totalVatAmount>
      <totalWithheldAmount>150.00</totalWithheldAmount>
      <totalGrossValue>1090.00</totalGrossValue>
    </invoiceSummary>
  </invoice>
</InvoicesDoc>
```

### Income Classification Codes for Law Firms

| Code | Description |
|------|-------------|
| E3_561_003 | Παροχή νομικών υπηρεσιών |
| E3_561_001 | Πώληση αγαθών (rare) |
| category1_3 | Έσοδα από παροχή υπηρεσιών |

### Withholding Tax (Παρακράτηση)

```
For legal services:
  net      = fee_amount
  vat      = net * 0.24
  withhold = net * 0.15
  payable  = net + vat - withhold        # client pays
  receives = payable                       # attorney receives
```

Example €1,000 fee: client pays €1,090; €150 withheld submitted to AADE by client.

### Workflow in THEMIS OS

```
1. Attorney creates Invoice from time entries
2. System calculates net + 24% VAT - 15% withholding
3. Multi-step approval workflow (NEW v0.2 invoice_approval_chain)
4. Invoice finalized (locked, sequential number assigned)
5. BullMQ `mydata` worker generates XML
6. Worker calls AADE `/SendInvoices`
7. AADE returns MARK number
8. System stores MARK, UID, status in `mydata_record`
9. If rejected: log error, alert user, allow resubmission
10. PDF generated with MARK printed
11. Invoice sent to client with PDF
```

### Error Handling

| Error | Handling |
|-------|----------|
| AADE API down | Queue retry (exponential backoff, max 24h) |
| Invalid AFM | Alert user, block transmission |
| Duplicate MARK | Idempotency key prevents double-submit |
| XML validation error | Log full error, user-friendly message |
| Rate limit | 1-second delay between transmissions |

---

## 3. e-Παράβολο (Electronic Court Fees)

### What It Is

Electronic system for paying court fees (παράβολα), operated by GSIS.

### Phase 1 Approach

- Track παράβολο reference numbers (manual entry initially)
- Auto-calculate παράβολο amount based on claim value
- Link παράβολο to matter + expense
- Bill παράβολο cost to client as disbursement

### Phase 2 Automation

- GSIS API integration (when available)
- Auto-generation from matter data
- Status tracking (pending → paid → used → refunded)

### Calculation Rules

| Filing Type | Παράβολο Amount |
|------------|-----------------|
| Αγωγή | Sliding scale on claim value |
| Έφεση | Claim value + court level |
| Αναίρεση | Fixed amount per type |
| Αίτηση ασφαλιστικών μέτρων | Fixed (lower) |
| Certificate requests | Small fixed |

### Δικαστικό Ένσημο

```
Monetary claim > threshold:
  ensimo = claim_value * 0.008  (0.8%)
  Maximum caps per court level

Non-monetary claims:
  Fixed amounts per case type
```

---

## 4. ΚΠολΔ Deadline Rules Engine

### Architecture

Deterministic (no AI for calculation). Rules in `deadline_rule` table.

### Core Rules (Initial Seed — 50+)

#### Έφεση Deadlines

| Rule | Basis | Trigger | Days | Type | Notes |
|------|-------|---------|------|------|-------|
| KPOLD_495_EIRIN | ΚΠολΔ 495 | Service of εirinodikio judgment | 30 | Calendar | Extends to next biz |
| KPOLD_518_PROTO | ΚΠολΔ 518 | Service of protodikio judgment | 30 | Calendar | |
| KPOLD_518_ERIMI | ΚΠολΔ 518 | Judgment issued (no service) | 60 | Calendar | If unserved |
| KPOLD_564_ANAER | ΚΠολΔ 564 | Service of efetio judgment | 30 | Calendar | Cassation |
| KPOLD_564_ERIMI | ΚΠολΔ 564 | Judgment issued (no service) | 3 yrs | Calendar | |

#### Προθεσμίες Κλητεύσεως

| Rule | Basis | Trigger | Days | Notes |
|------|-------|---------|------|-------|
| KPOLD_228_ELL | ΚΠολΔ 228 | Filing | 60 | Defendant in Greece |
| KPOLD_228_EU  | ΚΠολΔ 228 | Filing | 90 | Defendant in EU |
| KPOLD_228_INTL | ΚΠολΔ 228 | Filing | 120 | Defendant outside EU |

#### Προσωρινές Διαταγές

| Rule | Basis | Trigger | Days |
|------|-------|---------|------|
| KPOLD_691_PROSW | ΚΠολΔ 691 | Granting | 30 |

#### ΑΚ Statute of Limitations

| Rule | Basis | Trigger | Period |
|------|-------|---------|--------|
| AK_249_5Y  | ΑΚ 249 | Claim arising | 5 yrs |
| AK_250_20Y | ΑΚ 250 | Claim arising | 20 yrs |
| AK_937_5Y  | ΑΚ 937 | Tort event | 5 yrs |
| AK_937_20Y | ΑΚ 937 | Tort event (unknown) | 20 yrs |
| AK_250_PARA7 | ΑΚ 250 §7 | Contract breach | 20 yrs |

### Calculation Logic

```python
def calculate_deadline(trigger_date, rule):
    deadline = trigger_date + timedelta(days=rule.days)
    if rule.calendar_type == 'business_days':
        deadline = add_business_days(trigger_date, rule.days)
    if rule.excludes_holidays:
        while is_greek_holiday(deadline) or is_weekend(deadline):
            deadline += timedelta(days=1)
    if rule.extends_to_next_business:
        while is_greek_holiday(deadline) or is_weekend(deadline):
            deadline += timedelta(days=1)
    if rule.suspends_during_recess:
        deadline = adjust_for_court_recess(trigger_date, deadline)
    return deadline
```

### Greek Holidays (System Data)

| Holiday | Date | F/V |
|---------|------|-----|
| Πρωτοχρονιά | Jan 1 | Fixed |
| Θεοφάνεια | Jan 6 | Fixed |
| Καθαρά Δευτέρα | 48 days before Easter | Var |
| 25η Μαρτίου | Mar 25 | Fixed |
| Μ. Παρασκευή | -2 days from Easter | Var |
| Μ. Σάββατο | -1 day from Easter | Var |
| Πάσχα | Orthodox | Var |
| Δευτέρα Πάσχα | Easter Monday | Var |
| Πρωτομαγιά | May 1 | Fixed |
| Αγίου Πνεύματος | +50 days from Easter | Var |
| Κοίμηση Θεοτόκου | Aug 15 | Fixed |
| 28η Οκτωβρίου | Oct 28 | Fixed |
| Χριστούγεννα | Dec 25 | Fixed |
| Σύναξις Θεοτόκου | Dec 26 | Fixed |

**Court recess (per ΚΠολΔ 147):**
- Summer: Aug 1 – Aug 31 (προθεσμίες αναστέλλονται)
- Christmas: Dec 24 – Jan 6
- Easter: Holy Week (limited operations)

### Alert Schedule

| Time before | Type | Recipients |
|-------------|------|-----------|
| 30 days | Email | Assigned attorney |
| 15 days | Email + In-app | Assigned + lead |
| 7 days | Email + In-app + Push | + lead |
| 3 days | Email + In-app + Push | + partners |
| 1 day | Email + In-app + Push + SMS | All matter team |
| 0 (day of) | CRITICAL all channels | + firm admin |

---

## 5. Courts Database Schema

### Structure

```
court:
  id, name, short_name, court_type, city, region,
  address, phone, email, fax,
  solon_court_id, dikes_moj_id,
  sections (JSONB), operating_hours (JSONB),
  is_active

Seed: ~400+ courts covering all of Greece (shared corpus DB, read-only)
```

### Court Types Taxonomy

```
Πολιτικά:
  - Ειρηνοδικείο
  - Πρωτοδικείο (Μονομελές / Πολυμελές)
  - Εφετείο
  - Άρειος Πάγος

Διοικητικά:
  - Διοικητικό Πρωτοδικείο
  - Διοικητικό Εφετείο
  - Συμβούλιο της Επικρατείας

Ποινικά:
  - Πταισματοδικείο
  - Πλημμελειοδικείο
  - Μονομελές / Τριμελές Εφετείο Κακουργημάτων
  - Άρειος Πάγος (αναίρεση)

Ειδικά:
  - Ελεγκτικό Συνέδριο
  - Ανώτατο Ειδικό Δικαστήριο
```

### Sections Per Court

Each court has τμήματα with specific schedules (JSONB on `court.sections`):

```json
{
  "sections": [
    {"number": 1, "type": "τακτική", "hearing_days": ["mon","wed"], "notes": "Ενοχικό"},
    {"number": 2, "type": "τακτική", "hearing_days": ["tue","thu"], "notes": "Εμπράγματο"},
    {"number": "A", "type": "ασφαλιστικά", "hearing_days": ["fri"], "notes": "Ασφαλιστικά μέτρα"}
  ]
}
```

---

## 6. SOLON E-Filing — FULL Phase 1 Spec (NEW — replaces v0.1 §6 stub)

### Regulatory context

- **Ν.5221/2025** active since **1 January 2026** mandates SOLON e-filing for civil court submissions.
- **portal.solon.gov.gr** is the single submission portal.
- Authentication via TAXISnet OAuth2 (GSIS).
- Submissions of certain document classes must carry an **ΑΠΕΔ qualified e-signature** (see §7).
- A submission is acknowledged with a **πρωτόκολλο** (protocol number) + downloadable certificate.

### Phase 1 strategy: WRAPPER mode

THEMIS OS Phase 1 ships a **wrapper**, not full automation:

1. System assembles the SOLON-compliant submission package (a `.zip` with PDF/A-2 documents, metadata XML, and required ΑΠΕΔ signatures already applied).
2. Attorney uploads the `.zip` manually via `portal.solon.gov.gr` UI.
3. After submission, attorney records the SOLON submission ID + protocol number into THEMIS OS.
4. Subsequent status / certificate retrieval is manual or done via the SOLON status-check screen.

This approach **eliminates the regulatory blocker** while deferring full TAXISnet OAuth + REST integration to Phase 2 (when SOLON's documented API stabilizes).

### Phase 2: full automation

- TAXISnet OAuth2 login of the responsible attorney
- Direct REST submission to SOLON
- Inbound status webhooks
- Auto-fetch of certificate PDF

### Required capabilities (Phase 1)

| Capability | Phase | Notes |
|-----------|-------|-------|
| TAXISnet OAuth2 | Phase 2 | OAuth2 flow via GSIS |
| ZIP package builder | Phase 1 | PDF/A-2 + metadata XML |
| ΑΠΕΔ pre-signing | Phase 1 | All required documents signed before zip |
| SOLON submission ID intake | Phase 1 | Manual entry by attorney |
| Status tracking | Phase 1 (manual) / Phase 2 (auto) | |
| Certificate storage | Phase 1 | Manual upload; auto in Phase 2 |
| Court fees pre-validation | Phase 1 | Παράβολο linked to filing |

### Data Model (relevant, see data-model.md §17)

- **`solon_filing`** (renamed from `e_filing`) — one row per submission attempt
- Columns: `matter_id`, `court_id`, `filing_type`, `submission_id` (from SOLON), `protocol_number`, `submitted_at`, `status`, `certificate_document_id`, `aped_signature_request_ids[]`, `zip_package_document_id`, `taxisnet_user_id`, `idempotency_key`, `last_error`, `created_by`, `created_at`

### Submission flow (Phase 1 wrapper)

```
1. Attorney creates filing draft in matter cockpit
   POST /api/v1/solon/filings  {matter_id, court_id, type, document_ids:[]}
   -> solon_filing row in status='draft'

2. Attorney runs validation
   POST /api/v1/solon/filings/:id/validate
   Checks:
     - all required documents present (per filing_type schema)
     - all documents are PDF/A-2 (or convertible)
     - all required ΑΠΕΔ signatures present (see §7)
     - court fees (παράβολο) linked
     - matter has primary client + opposing party
     - attorney has bar membership active
   -> status='validated' if pass, else 'validation_failed' with reasons

3. Attorney completes ΑΠΕΔ signatures (§7) for any unsigned required documents
   -> status remains 'validated'

4. Attorney triggers ZIP build
   POST /api/v1/solon/filings/:id/build-zip
   -> BullMQ `solon` worker:
       a. Renders metadata XML (per SOLON 1.0 schema)
       b. Converts/validates each document to PDF/A-2
       c. Embeds ΑΠΕΔ signatures (already in PDFs)
       d. Bundles into .zip
       e. Encrypts zip with per-firm KMS
       f. Stores zip as documents row, links via solon_filing.zip_package_document_id
       g. Sets status='zip_ready'

5. Attorney downloads zip + uploads manually to portal.solon.gov.gr

6. Attorney records SOLON submission ID
   POST /api/v1/solon/filings/:id/mark-submitted {solon_submission_id, submitted_at}
   -> status='submitted'
   -> writes audit_log entry with submission ID
   -> creates deadline reminder for status check (3 business days)

7. (Manual Phase 1 / Auto Phase 2) Attorney records status update
   POST /api/v1/solon/filings/:id/refresh-status (manual: user uploads SOLON status PDF)
   -> status updates to 'accepted' | 'rejected' | 'withdrawn'

8. Certificate retrieval
   POST /api/v1/solon/filings/:id/certificate {pdf_upload}  (Phase 1 manual)
   -> stores certificate as document, links to filing
```

### Submission flow (Phase 2 auto)

```
1-3. Same as above

4. POST /api/v1/solon/filings/:id/submit
   Idempotency-Key required
   -> Aegis pre-flight checks (ΑΠΕΔ valid, fees paid)
   -> BullMQ `solon` worker calls SOLON REST API with TAXISnet token
   -> Returns submission_id + status

5. Inbound status webhooks
   POST /api/v1/solon/webhooks/status
   HMAC-signed payload from SOLON
   -> updates solon_filing.status, fires `solon.filing.accepted` / `rejected` event
```

### Idempotency

`/submit` requires `Idempotency-Key` header (UUID v4). Server stores `(idempotency_key, payload_hash, response)` for 24h. Repeat with same key + body → returns stored response. Different body → 409.

### Retry policy

- Network errors: exponential backoff (1m, 5m, 30m, 2h, max 24h)
- 4xx from SOLON (validation): no retry; surface to user
- 5xx: retry up to 5x
- After exhaustion: alert firm admin + responsible attorney

### Audit trail format

Every SOLON state transition writes to `audit_log` with:
```
actor: user_id | system | aegis
action: solon.filing.{validate|build_zip|mark_submitted|status_update|certificate_received}
resource_type: solon_filing
resource_id: filing_uuid
metadata: {
  submission_id, status_before, status_after,
  zip_hash, certificate_hash,
  aped_signature_request_ids: [...],
  taxisnet_session_id (Phase 2)
}
```

---

## 7. ΑΠΕΔ Qualified Signatures — FULL Phase 1 Spec (NEW — replaces v0.1 §7 stub)

### What ΑΠΕΔ is

ΑΠΕΔ (Αρχή Πιστοποίησης Ελληνικού Δημοσίου) issues qualified electronic signatures to Greek lawyers via **portal.olomeleia.gr** (free of charge, mandatory for ΔΣΑ members). Qualified signatures (eIDAS Art. 25) are legally equivalent to handwritten signatures.

### Why Phase 1

Cross-dependency with SOLON: certain SOLON document classes require ΑΠΕΔ signatures. Without ΑΠΕΔ, SOLON wrapper is incomplete.

### Capabilities (Phase 1)

- OAuth2 link of attorney's portal.olomeleia.gr account to firm
- Initiate signature requests for documents
- Multi-signer flow (sequential or parallel)
- Verification of received ΑΠΕΔ signatures on inbound documents
- Audit trail of every signing event with chain of custody
- Cancellation / expiration handling

### Integration architecture

```
THEMIS OS                 ΑΠΕΔ portal              Attorney's browser
   │
   │ 1. Attorney clicks "Sign with ΑΠΕΔ"
   │
   │ 2. POST /api/v1/aped/signature-requests
   │    -> aped_signature_request row, status='draft'
   │
   │ 3. POST /api/v1/aped/signature-requests/:id/sign-init
   │    -> Generates portal.olomeleia.gr signing URL
   │    -> Returns URL to client
   │
   │ 4. Attorney clicks URL ──────────────────────────► browser redirect
   │                                                     │
   │                                                     │ 5. ΑΠΕΔ login + cert select
   │                                                     │ 6. ΑΠΕΔ signs document
   │                                                     │ 7. ΑΠΕΔ POSTs back
   │                                                     │
   │ 8. POST /api/v1/aped/signature-requests/:id/sign-callback
   │    HMAC-signed payload from ΑΠΕΔ
   │    Body: {signed_pdf_url, signer_cert, timestamp}
   │
   │ 9. BullMQ `aped` worker:
   │    - Downloads signed PDF
   │    - Verifies signature (cert chain to ΑΠΕΔ root)
   │    - Stores signed document
   │    - Updates aped_signature_request row
   │    - Fires `aped.signature_request.signer_completed` event
```

### Data model

`aped_signature_request` (NEW v0.2):
- id, document_id (input PDF), matter_id, requested_by_user_id, reason
- signers (JSONB): `[{user_id?, party_id?, role, sequence_order, signed_at, signed_document_id, signer_cert_thumbprint, status}]`
- status: `draft | initiated | partially_signed | fully_signed | cancelled | expired`
- expires_at (default 30 days)
- audit_chain (JSONB array of events)
- created_at, updated_at

### Multi-signer flow

- **Sequential:** signer 1 must complete before signer 2 receives invitation
- **Parallel:** all signers receive invitation simultaneously; final signed document only generated when all complete
- The application enforces sequence order; ΑΠΕΔ portal does not natively support multi-party flows

### Verification of inbound ΑΠΕΔ signatures

When a firm receives a PDF claiming to be ΑΠΕΔ-signed:

```
POST /api/v1/aped/verify {document_id}
->
1. Extract embedded ΑΠΕΔ signature from PDF
2. Verify cert chain to ΑΠΕΔ root (Hellenic Public CA)
3. Check revocation (OCSP / CRL)
4. Validate signature timestamp
5. Return: {
     valid: bool,
     signer_name, signer_cert_thumbprint,
     signed_at, validity_status,
     warnings: [...]
   }
```

### Audit trail format

Every state transition writes to `audit_log`:

```
action: aped.signature_request.{created | initiated | signer_completed | fully_signed | cancelled | expired | verified}
metadata: {
  signature_request_id,
  signer_user_id, signer_party_id,
  signer_cert_thumbprint, signer_cert_serial,
  signed_at, document_hash_before, document_hash_after,
  signer_ip, signer_user_agent,
  aped_session_id
}
```

### Human-in-the-loop (Invariant #8)

ΑΠΕΔ signatures are ALWAYS initiated by an attorney action; the system never signs autonomously. Drafted documents flagged "AI Draft" must be reviewed and explicitly sent for signing by a human attorney.

### Types of Electronic Signatures

| Type | Legal Status | Use Case |
|------|-------------|----------|
| Simple (click-to-sign) | Limited | Client portal approvals |
| Advanced (PKI-based) | Moderate | Internal workflows |
| **Qualified (ΑΠΕΔ)** | Full equivalence to handwritten | **SOLON court filings, εξώδικα, official documents** |

---

## 8. Data Protection Compliance

### GDPR + Ν.4624/2019

| Requirement | Implementation |
|-------------|---------------|
| Lawful basis | Consent at intake + legitimate interest for matter management |
| Right to access | Client portal: download all personal data |
| Right to erasure | Soft delete + **pseudonymization** (cannot delete legal records — see derogation below) |
| Right to rectification | Client portal: request data update |
| Data breach notification | Audit log monitoring, 72-hour notification workflow |
| DPO | DPO contact in Settings |
| Records of processing | Audit log = processing register |
| Data minimization | Only necessary fields, PII encryption |
| Storage limitation | Configurable retention per document type |
| International transfers | No PII leaves EU (Hetzner DE/FI) |

### Erasure-vs-Audit derogation (NEW v0.2 explicit)

**Conflict:** Invariant #4 requires immutable audit logs; GDPR Art. 17 grants right to erasure.

**Resolution:** Per **Ν.4624/2019 §31** (Greek DPA implementation derogation), legal-record retention obligations supersede the right to erasure for the duration of the obligation. THEMIS OS implements:
- Active period: PII held in plaintext (encrypted at rest)
- After retention period (default: 20 years for matter records, 10 for accounting): PII fields are **pseudonymized** (replaced with stable hashes), not deleted. Audit log entries remain intact, but reverse-lookup to plain identity is impossible.
- Pseudonymization uses HMAC-SHA256 with per-firm rotating salt; salts retained for 1 year then destroyed (rendering pseudonymization irreversible).
- Users may request acceleration of pseudonymization where legally permissible (e.g., closed matters with no pending litigation, no tax obligations).

This satisfies both Invariant #4 (audit immutability) and GDPR (de-facto erasure of identity).

### Attorney-Client Privilege

| Feature | Implementation |
|---------|---------------|
| Privilege tagging | Document-level flag (`attorney_client | work_product | joint_defense | none`) |
| Privilege review workflow | Before any document sharing/portal exposure, check privilege tag |
| Ethical wall | Per-matter access control |
| Legal hold | Prevent deletion in active litigation |
| AI access control | Privileged documents excluded from general AI search unless explicitly included |
| Audit trail | All access to privileged documents logged |
| **Portal exposure (NEW v0.2)** | Documents with privilege != none are **NEVER** visible to portal_user, even if matter is shared (Invariant #9) |

### Ν.4624/2019 Specific

- DPA notification (Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα)
- DPIA for AI features (Aegis)
- Consent management for automated decision-making (AI lead scoring, time inference)
- Employee data separated from client data
- Processor agreements for sub-processors (Anthropic for LLM, Hetzner for hosting, Cloudflare for R2/CDN)

---

## 9. Tax Compliance Summary

### Law Firm Tax Obligations Covered

| Obligation | Module | Automation |
|-----------|--------|-----------|
| myDATA invoice transmission | Billing | Full auto |
| 15% withholding calculation | Billing | Full auto |
| VAT 24% calculation | Billing | Full auto |
| ΔΣΑ γραμμάτιο management | Bar Stamps | Semi-auto (attorney confirms) |
| EFKA contributions tracking | Bar Stamps + Reports | Auto calculation |
| Annual E3 preparation data | Reports | Export (manual submission) |
| Party AFM validation | Parties | Auto (check digit) |
| Income classification (ΕΣΦΑ codes) | Billing | Auto |

### AFM Validation Algorithm

```
AFM = 9 digits: d1..d9
check = (d1*256 + d2*128 + d3*64 + d4*32 + d5*16 + d6*8 + d7*4 + d8*2) mod 11
if check == 10: check = 0
valid = (check == d9)
```

Implemented at input validation level for all AFM fields on `party`, `tenant`, party-related forms.

---

## 10. Trust Accounting (ΕΔΕ) — NEW v0.2

### What it is

Greek bar association rules (ΕΔΕ — Ειδική Διαχείριση Εμπιστευτικών) require that **client funds held by attorneys (e.g., escrow, deposits, settlement proceeds) be segregated from firm operational funds**. This is enforced via:

1. **Separate bank account(s)** for client funds (one or more "trust accounts").
2. **Per-matter sub-ledger** — internal accounting tracks how much each matter/client owns within a trust account.
3. **Periodic reconciliation** between bank statement and internal ledger.

### Phase 1 scope: 2-way reconciliation

THEMIS OS Phase 1 implements:
- Multiple `trust_account` rows per firm (one per real bank account)
- `trust_transaction` rows for deposits, withdrawals, transfers, fee draws
- Per-matter sub-ledger (computed view: balance per (trust_account, matter))
- **2-way reconciliation:** monthly process matching bank statement against internal ledger
- Reconciliation lock: once finalized, transactions in that period cannot be edited
- Audit log of every transaction + reconciliation finalization

### Phase 2 scope: 3-way reconciliation

Phase 2 adds:
- Direct bank API connection (Open Banking — PSD2 Greek banks)
- Auto-import of bank statement lines
- Three-way reconciliation: bank statement ↔ internal ledger ↔ per-matter client sub-ledgers

### Data Model (relevant; see data-model.md §X)

- `trust_account`: id, name, bank_name, iban (encrypted), party_id (firm — owner), currency, opening_balance, opened_at, status
- `trust_transaction`: id, account_id, matter_id, party_id (client), tx_type (deposit|withdrawal|transfer|fee_draw|interest), amount, currency, occurred_at, description, reference, reconciliation_id (NULL if unreconciled), voided (boolean), void_reverses_id, created_by, created_at
- `trust_reconciliation`: id, account_id, period_start, period_end, statement_balance, ledger_balance, discrepancy, status (in_progress|finalized), finalized_at, finalized_by, statement_document_id, notes

### Reconciliation flow

```
1. Accountant starts reconciliation
   POST /api/v1/trust-accounts/:id/reconciliation
   {period_start, period_end, statement_url?}
   -> trust_reconciliation row, status='in_progress'

2. Accountant uploads bank statement (CSV/PDF) and matches lines
   POST /api/v1/trust-accounts/:id/reconciliation/:recId/match-statement
   {statement_lines: [{date, amount, ref}]}
   -> Each match links a trust_transaction.reconciliation_id

3. System computes:
   ledger_balance = SUM(trust_transaction.amount) WHERE account_id AND occurred_at IN [period]
   statement_balance = sum from uploaded statement
   discrepancy = ledger - statement

4. Accountant resolves discrepancies (manual entries, voids, etc.)

5. Accountant finalizes
   POST /api/v1/trust-accounts/:id/reconciliation/:recId/finalize
   -> status='finalized', finalized_at, finalized_by
   -> All trust_transactions in period become read-only
   -> Audit log entry with snapshot of opening/closing balances
   -> Fires `trust.reconciliation.finalized` event
   -> If discrepancy != 0, fires `trust.reconciliation.discrepancy` event AND blocks finalize unless explicit override (with reason)
```

### ΕΔΕ-specific rules enforced

- A withdrawal from a trust account cannot exceed the matter's sub-ledger balance (no commingling)
- Fee draws (firm taking earned fees from trust) require an associated invoice marker linking to the time/expense being paid
- Interest earned on trust accounts (if any) handled per ΔΣΑ rules — currently flagged as an income type that must be disclosed to the client
- Trust accounts cannot be deleted; they can only be closed (`status='closed'`) once balance is zero and no open matters reference them

### Reporting

| Report | Content |
|--------|---------|
| Trust ledger by account | All transactions chronologically |
| Per-matter sub-ledger | Per-matter balance + history |
| Unreconciled transactions | Flagged for accountant action |
| Reconciliation history | All finalized + in-progress reconciliations |
| 3-way (Phase 2) | Bank ↔ ledger ↔ sub-ledger triple reconciliation |

### Audit trail

Every transaction + reconciliation event writes to `audit_log` with snapshot of balances before/after. Discrepancies write a high-severity `audit_log` row.

---

## 11. Compliance verification & external review

### v0.2 Phase 1 sign-off requirements

Before pilot launch (Sprint 18 → Phase Gate D), the following sign-offs are mandatory:

| Item | Reviewer | Status target |
|------|---------|---------------|
| ΔΣΑ γραμμάτιο rate config + workflow | External tax accountant + ΔΣΑ liaison | Sign-off |
| myDATA XML format | AADE sandbox successful submission | Pass |
| ΚΠολΔ deadline rules engine | External procedural-law practitioner | Sign-off |
| **SOLON wrapper output (zip format, ΑΠΕΔ embedding)** | External SOLON practitioner | Sign-off |
| **ΑΠΕΔ flow + cert verification** | External eIDAS / portal.olomeleia.gr practitioner | Sign-off |
| **Trust accounting ΕΔΕ rules** | External law firm bookkeeper + ΔΣΑ ΕΔΕ liaison | Sign-off |
| GDPR / Ν.4624/2019 | External DPO + Ninurta security audit | Pass |

External legal review budget: €18,000 (v0.2) — see `build-plan.md` and `changelog.md` §B.

---

*v0.2 lock 2026-04-28. Next review: post-Sprint 17 (SOLON + ΑΠΕΔ pilot dry-run) and post-Sprint 18 (Phase Gate D).*
