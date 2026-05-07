# THEMIS OS — Data Model (v0.2)

**Spec version:** v0.2 (2026-04-28). v0.1 → v0.2 changes documented in `changelog.md`.

## Overview

**Single-tenant PostgreSQL database per firm.** Each firm deploys a dedicated DB + dedicated Qdrant collection + dedicated KMS keys + dedicated R2 bucket prefix. Shared legal corpus lives in a separate read-only Qdrant + PostgreSQL instance, queried but never written by per-firm DBs.

**Conventions:**
- All tables have `id` (UUID v7), `created_at`, `updated_at`, and (where applicable) `soft_deleted_at` (soft delete) — see "Soft-delete convention" below.
- PII fields marked with `[PII]` — encrypted with AES-256-GCM, per-firm key from KMS.
- Audit trail via `audit_log` table (append-only, immutable). See **Invariant #8** in the master architecture doc.
- All monetary values stored as `BIGINT` (cents/lepta) to avoid floating-point errors.
- Timestamps are `TIMESTAMPTZ` (UTC stored, displayed in Europe/Athens).
- **No `tenant_id` column on per-tenant tables (v0.2).** Isolation is enforced at the deployment level: each firm has its own DB. The `tenant` table is the single self-referential meta record (1 row per DB).

### Soft-delete convention

All tenant tables that support soft-delete use a column named **`soft_deleted_at TIMESTAMPTZ`** (NULL = live row, non-NULL = soft-deleted at that timestamp). The shorter name `deleted_at` is **NOT** used for soft-delete in any tenant table.

Rationale:
- The longer name disambiguates from the audit-only "deletion timestamp" in append-only logs (`audit_log.created_at` of a `delete` action).
- A grep for `soft_deleted_at` reliably enumerates every soft-delete column. `deleted_at` would collide with audit fields and hard-delete tombstones.
- Filtered indexes follow the pattern: `CREATE INDEX <name>_idx ON <table> (<cols>) WHERE soft_deleted_at IS NULL;`

**Migration history:**
- v0.1 → v0.2: original migration `0002_template_schema.sql` shipped with `matter.deleted_at` (single table, drift from convention). Migration `0008_normalize_soft_delete.sql` (2026-04-29) renamed `matter.deleted_at` → `matter.soft_deleted_at` across all already-provisioned firm schemas and dropped/recreated the affected partial indexes. The source `0002_template_schema.sql` was patched at the same time so newly provisioned firms are correct from creation.

**Exception:** If a future table needs a hard-delete tombstone with different semantics (e.g. an audit-only "deletion event" log), name that column explicitly (e.g. `tombstoned_at`, `purged_at`) — never reuse `deleted_at`.

### Migration convention (per-tenant DDL)

Tenant DDL lives in `packages/db/migrations/0002_template_schema.sql` (the canonical "tenant template"). The runtime provisioning code (`apps/api/src/routes/auth/index.ts → provisionFirm`) reads this file, rewrites identifiers (`tenant_template.<x>` → `<firm_schema>.<x>`, preserving ENUM types `<x>_t` in `tenant_template`), and applies it inside the new firm schema.

Consequence: **every schema-changing migration that targets per-tenant tables MUST patch `0002_template_schema.sql` in the same PR**, otherwise newly provisioned firms will be born with the old shape. The follow-up numbered migration (e.g. `0008_normalize_soft_delete.sql`) handles already-provisioned firms; the patch to `0002_template_schema.sql` handles future firms.

Enforcement:
- Pre-merge check: `scripts/check-migration-touches-template.sh` (compares migrations introduced in the PR against changes to `0002_template_schema.sql`).
- Code review: any new tenant DDL migration without a corresponding `0002_template_schema.sql` diff is auto-rejected.

---

## ARCHITECTURAL INVARIANTS

These architectural decisions are FOUNDATIONAL and SHALL NEVER CHANGE. All schema, code, APIs, UIs, migrations, integrations, and reports must conform. Any proposal that violates an invariant is rejected by default.

### INVARIANT #1 — Unified Party Model

There is exactly **one** record per real-world person or organization in the system: the `party`. There is **no** separate `client`, `supplier`, `partner`, `vendor`, `opposing_party`, or `witness` table as a top-level entity.

A `party` carries roles via `party_role` (multi-valued, time-bounded). The same physical person may simultaneously and historically be: `client` for one matter, `opposing_party` for another, `witness` for a third, and `referral_source` throughout. All of these are the same row in `party`.

Relationships between parties (spouse, employer, shareholder, legal representative, etc.) are first-class via `party_relationship`.

**Rationale:**
- Conflict check is reduced to a `party_id` lookup that spans all roles automatically.
- AML/KYC, GDPR data subject requests, and PII encryption keys live in one place per real person.
- Real-world fluidity (today's opposing party is tomorrow's client) does not corrupt history or duplicate PII.
- Co-counsel, expert witnesses, judges, court clerks, bailiffs are reusable across the firm.

**v0.2 cleanup:** All residual `client_id` columns from v0.1 (`matter.client_id`, `aml_check.client_id`, `contract.client_id`, `retainer.client_id`, `invoice.client_id`, `trust_account.client_id`) are renamed to `party_id` with semantic role enforcement at the application layer. No `client` table exists.

### INVARIANT #2 — Matter ↔ Party Many-to-Many with Role and Side

A matter does **not** have a single `client_id`. A matter is connected to all involved parties through `matter_party`, which carries:
- `role` (primary_client, co_client, opposing, witness, expert, judge, opposing_counsel, ...)
- `side` (ours | opposing | neutral | unknown)
- `representation_status` (represented_by_us | represented_by_other | self_represented | unrepresented | unknown)
- `representing_counsel_party_id` — which attorney represents this party
- `joined_at` / `left_at` — temporal participation
- `billing_split_percentage` — for co-clients sharing costs
- `is_primary_contact` — exactly one primary contact per side

**Rationale:**
- Real matters routinely have co-clients, multiple opposing parties, mixed representation, and parties that join or withdraw mid-case.
- Billing splits, conflict checks, and notifications all need party+role+side context, not just an id.
- Hearings, communications, and disclosures must address the right side, not "the client."

**v0.2 cleanup:** `matter_party` no longer carries inline `name`, `tax_id`, `contact_info` columns. It is a strict M2M with `party_id` FK only — PII data is on `party`, not duplicated.

**Anything below that appears to contradict either invariant is to be read in light of these invariants and corrected.**

### INVARIANT #6 — Single-Tenant per Firm DEPLOYMENT (v0.2 explicit lock)

Each firm runs in a dedicated PostgreSQL database, dedicated Qdrant collection, dedicated KMS keys, dedicated R2 bucket prefix. There is no row-level multi-tenancy. The `tenant` table contains exactly one row in each per-firm DB and stores firm-wide meta (name, AFM, settings, encryption_key_ref). No application code may add a `WHERE tenant_id = ...` clause to per-tenant tables — that pattern would imply cross-firm data in the same DB, which is forbidden by construction.

**Migration impact:** v0.1 had `tenant_id` on every table. v0.2 removes it from all 50 per-tenant tables. It is retained only on `tenant` (self), `audit_log` (defensive, even though redundant), and shared/system tables (`court`, `legal_document`, `legal_article`, `case_law` — these live in the central read-only corpus DB, not per-firm).

---

## 1. TENANT & AUTH LAYER

### tenant
Self-referential firm record. **Exactly one row per database.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, also acts as firm identifier |
| name | VARCHAR(255) | Firm name |
| slug | VARCHAR(50) | Lowercase, used in subdomain (`{slug}.themis.gr`, `portal.{slug}.themis.gr`) |
| tax_id | VARCHAR(20) | `[PII]` AFM |
| tax_office | VARCHAR(100) | DOY |
| address | JSONB | `[PII]` street, city, postal, country |
| phone | VARCHAR(50) | `[PII]` |
| email | VARCHAR(255) | `[PII]` |
| logo_url | VARCHAR(500) | R2 path |
| bar_association | VARCHAR(50) | ΔΣΑ, ΔΣΘ, etc. |
| subscription_tier | ENUM | basic, professional, enterprise |
| encryption_key_ref | VARCHAR(255) | KMS key reference for this firm |
| qdrant_collection | VARCHAR(100) | This firm's Qdrant collection name |
| r2_bucket_prefix | VARCHAR(100) | R2 path prefix for this firm |
| settings | JSONB | Firm-wide settings (rate config, holiday overrides, etc.) |
| created_at | TIMESTAMPTZ | When firm was provisioned |

### user
All humans who access the system as firm staff. Client-side users live in `portal_user` (separate domain — see §23).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| email | VARCHAR(255) | `[PII]` unique login |
| password_hash | VARCHAR(255) | argon2id |
| first_name | VARCHAR(100) | `[PII]` |
| last_name | VARCHAR(100) | `[PII]` |
| bar_number | VARCHAR(50) | ΔΣΑ registration number |
| role_id | UUID | FK → role |
| department_id | UUID | FK → department, nullable |
| hourly_rate | BIGINT | Default rate in cents |
| is_active | BOOLEAN | |
| last_login_at | TIMESTAMPTZ | |
| mfa_secret | VARCHAR(255) | `[PII]` TOTP secret |
| preferences | JSONB | UI preferences, locale |

### role

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(100) | e.g. partner, associate, paralegal, secretary, admin |
| permissions | JSONB | Granular permission map |
| approval_chain | JSONB | Multi-tier approval chain config (e.g. invoice approval matrix) |
| is_system | BOOLEAN | Built-in roles cannot be deleted |

### permission
Granular permission definitions.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| resource | VARCHAR(100) | e.g. matter, party, invoice, document, portal |
| action | VARCHAR(50) | create, read, update, delete, export, approve |
| scope | ENUM | own, department, all |

### department

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(100) | e.g. Litigation, Corporate, Tax |
| head_user_id | UUID | FK → user, nullable |

### session / refresh_token
Standard JWT session management. Not detailed here — standard pattern.

---

## 2. PARTY MANAGEMENT

> Implements **INVARIANT #1**. Every person or organization the firm interacts with is a `party`. Roles (client, supplier, opposing party, witness, etc.) are attached via `party_role` and may be multiple and time-bounded.

### party
The single canonical record of a person or organization. No `client` table exists.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| type | ENUM | person, company, government, nonprofit |
| display_name | VARCHAR(255) | Computed or manual; canonical label |
| status | ENUM | active, inactive, deceased, dissolved |
| source | VARCHAR(100) | e.g. referral, direct, walk_in, website, lateral_hire |
| referral_source_party_id | UUID | FK → party, nullable (the referring party itself is a party) |
| risk_score | SMALLINT | 0-100, AI-computed |
| tags | JSONB | Free tags |
| notes | TEXT | `[PII]` |
| custom_fields | JSONB | |
| gdpr_consent_at | TIMESTAMPTZ | `[PII]` |
| gdpr_consent_type | VARCHAR(50) | |
| -- Identity (common) | | |
| tax_id | VARCHAR(20) | `[PII]` AFM (persons and companies) |
| tax_office | VARCHAR(100) | DOY |
| -- Multi-valued contact | | |
| emails | JSONB | `[PII]` array of {address, label, is_primary, verified_at} |
| phones | JSONB | `[PII]` array of {number, label, is_primary, type:mobile/landline/fax} |
| addresses | JSONB | `[PII]` array of {street, city, postal, country, label, is_primary} |
| -- Person-specific (NULL for company) | | |
| first_name | VARCHAR(100) | `[PII]` |
| last_name | VARCHAR(100) | `[PII]` |
| father_name | VARCHAR(100) | `[PII]` patronymic |
| birth_date | DATE | `[PII]` |
| id_number | VARCHAR(50) | `[PII]` ΑΔΤ / passport |
| amka | VARCHAR(20) | `[PII]` Social security |
| -- Company-specific (NULL for person) | | |
| legal_form | ENUM | AE, EPE, IKE, OE, EE, atomiki, other |
| gemi_number | VARCHAR(20) | |
| vat_eligible | BOOLEAN | Affects invoicing |
| website | VARCHAR(255) | |

**Indexes:** type + status, tax_id (blind index for encrypted lookup), last_name + first_name (blind index), gemi_number, GIN on tags, GIN on `custom_fields` (audit P2.12).
**Constraint:** `(type='person' AND first_name IS NOT NULL) OR (type IN ('company','government','nonprofit') AND legal_form IS NOT NULL)` enforced at application layer.

**v0.2 changes:** removed redundant `afm` column (was alias for `tax_id`). Added `amka` for Greek-specific identity.

### party_role
Roles a party plays. Multiple simultaneous and historical roles per party are allowed.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| party_id | UUID | FK → party |
| role | ENUM | client, supplier, partner, referral_source, opposing_party, opposing_counsel, witness, expert_witness, judge, court_clerk, mediator, arbitrator, guarantor, interpreter, bailiff, notary, authority_contact, other |
| active_from | DATE | nullable (open-start) |
| active_until | DATE | nullable (open-end = currently active) |
| notes | TEXT | |

**Indexes:** (party_id, role), (role, active_until), partial index `WHERE active_until IS NULL` for currently-active roles.
**Note:** `client` is just a role. There is no separate `client` table.

### party_relationship
Graph of relationships between parties (kinship, business, legal representation).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| party_a_id | UUID | FK → party |
| party_b_id | UUID | FK → party |
| relationship_type | ENUM | spouse, parent, child, sibling, employer, employee, shareholder, director, legal_rep, co_owner, business_partner, counterparty, other |
| active_from | DATE | nullable |
| active_until | DATE | nullable |
| notes | TEXT | |

**Indexes:** (party_a_id), (party_b_id), (relationship_type).

### party_group
Logical grouping of parties (e.g. corporate group, family unit, joint venture).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(100) | |
| group_type | ENUM | corporate_group, family, joint_venture, other |

### party_group_member
M2M: party ↔ party_group

| Column | Type | Notes |
|--------|------|-------|
| party_id | UUID | FK → party |
| group_id | UUID | FK → party_group |
| role_in_group | VARCHAR(100) | e.g. parent_company, subsidiary, head_of_household |

---

## 3. MATTER (CASE) MANAGEMENT

### matter
Central entity — everything revolves around matters.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| code | VARCHAR(50) | Unique matter code (e.g. 2026/001) |
| title | VARCHAR(500) | `[PII]` |
| description | TEXT | `[PII]` |
| practice_area | VARCHAR(100) | e.g. civil, criminal, administrative, commercial, labor, family |
| matter_type | VARCHAR(100) | e.g. lawsuit, appeal, advisory, transactional |
| status | ENUM | intake, active, on_hold, closed, archived |
| stage_id | UUID | FK → matter_stage, nullable |
| priority | ENUM | low, normal, high, urgent |
| responsible_user_id | UUID | FK → user (lead attorney) |
| billing_method | ENUM | hourly, flat_fee, contingency, mixed, pro_bono |
| flat_fee_amount | BIGINT | If flat_fee, amount in cents |
| contingency_pct | DECIMAL(5,2) | If contingency |
| budget_amount | BIGINT | Budget in cents, nullable |
| court_id | UUID | FK → court, nullable |
| court_case_number | VARCHAR(100) | Αριθμός κατάθεσης (auto-populated by SOLON wrapper when filed) |
| court_filing_date | DATE | |
| statute_of_limitations | DATE | SOL expiry |
| sol_type | VARCHAR(100) | e.g. AK_249 (5 year), AK_250 (20 year) |
| ethical_wall | BOOLEAN | If true, restricted access |
| legal_hold | BOOLEAN | Document preservation flag |
| opened_at | TIMESTAMPTZ | |
| closed_at | TIMESTAMPTZ | nullable |
| custom_fields | JSONB | |
| tags | TEXT[] | |

> **v0.2:** No `client_id` and no `opposing_counsel` columns. All party participation — including the primary client and opposing counsel — is expressed in `matter_party`. See **INVARIANT #2**.

**Indexes:** status, responsible_user_id, court_case_number, practice_area, GIN on `custom_fields`.

### matter_party
Implements **INVARIANT #2**. The connection between a matter and every party involved (primary client, co-clients, opposing parties, witnesses, experts, judges, opposing counsel, etc.).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter |
| party_id | UUID | FK → party |
| role | ENUM | primary_client, co_client, opposing, witness, expert, judge, opposing_counsel, court_clerk, mediator, guarantor, beneficiary, heir, other |
| side | ENUM | ours, opposing, neutral, unknown |
| representation_status | ENUM | represented_by_us, represented_by_other, self_represented, unrepresented, unknown |
| representing_counsel_party_id | UUID | FK → party, nullable. Which attorney/firm represents this party (the attorney is itself a party). |
| joined_at | TIMESTAMPTZ | When the party entered the matter |
| left_at | TIMESTAMPTZ | When the party withdrew/was removed, nullable |
| billing_split_percentage | DECIMAL(5,2) | 0-100. For co-clients sharing matter costs. NULL for non-billed roles. |
| is_primary_contact | BOOLEAN | At most one TRUE per (matter_id, side). |
| notes | TEXT | `[PII]` |

> **v0.2:** No inline `name`, `tax_id`, `contact_info` columns. PII data is on `party`. The audit P1.2 / G14 fix.

**Indexes:** (matter_id, side, role), (party_id) — critical for conflict checks across matters, partial index `(matter_id) WHERE is_primary_contact = TRUE`.
**Constraints:**
- Exactly one `role='primary_client'` with `side='ours'` per active matter (application-enforced).
- `billing_split_percentage` summed across `side='ours'` clients must equal 100 when set.
- `representing_counsel_party_id` must reference a party with an attorney role (validated at write).

### matter_stage
Configurable workflow stages per practice area.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| practice_area | VARCHAR(100) | |
| name | VARCHAR(100) | e.g. "Filing", "Discovery", "Trial", "Appeal" |
| order_index | INTEGER | Sequence |
| auto_tasks | JSONB | Tasks to auto-create on entering stage (used by Workflow lite, audit P2.1) |
| color | VARCHAR(7) | Hex color |

### matter_member
M2M: matter ↔ user (team assignment).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter |
| user_id | UUID | FK → user |
| role | ENUM | lead, associate, paralegal, reviewer |
| hourly_rate_override | BIGINT | Per-matter rate override, nullable |
| assigned_at | TIMESTAMPTZ | |

### related_matter

| Column | Type | Notes |
|--------|------|-------|
| matter_id | UUID | FK → matter |
| related_matter_id | UUID | FK → matter |
| relation_type | VARCHAR(50) | e.g. appeal_of, consolidated, related |

---

## 4. CALENDAR, HEARINGS & DEADLINES

### calendar_event
General calendar events.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter, nullable |
| user_id | UUID | FK → user (owner) |
| title | VARCHAR(255) | |
| description | TEXT | |
| event_type | ENUM | meeting, deadline, hearing, task_due, reminder, other |
| start_at | TIMESTAMPTZ | |
| end_at | TIMESTAMPTZ | |
| all_day | BOOLEAN | |
| location | VARCHAR(255) | |
| recurrence_rule | VARCHAR(255) | iCal RRULE format |
| external_calendar_id | VARCHAR(255) | Google/Outlook sync ID |
| reminder_minutes | INTEGER[] | e.g. {1440, 60, 15} |

### hearing
Court hearing — linked to matter and calendar.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter |
| calendar_event_id | UUID | FK → calendar_event |
| court_id | UUID | FK → court |
| courtroom | VARCHAR(50) | Αίθουσα |
| hearing_date | DATE | |
| hearing_time | TIME | |
| hearing_type | ENUM | main, preliminary, interim, sentencing |
| outcome | ENUM | heard, adjourned, settled, judgment_issued, not_heard, null |
| adjournment_date | DATE | If adjourned, new date |
| adjournment_reason | VARCHAR(255) | |
| bar_stamp_id | UUID | FK → bar_stamp, nullable |
| checklist | JSONB | Pre-hearing checklist status |
| notes | TEXT | `[PII]` |
| attending_user_id | UUID | FK → user |
| anticletos_party_id | UUID | FK → party, nullable. Process agent (αντίκλητος) — the agent is a party with an attorney role. |

**v0.2 change:** `anticletos_name` + `anticletos_bar_number` removed; replaced by FK to `party` per Invariant #1.

### deadline
Legal deadlines with auto-calculation.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter |
| deadline_rule_id | UUID | FK → deadline_rule, nullable |
| title | VARCHAR(255) | |
| description | TEXT | |
| due_date | DATE | Calculated or manual |
| trigger_date | DATE | Date from which deadline is calculated |
| status | ENUM | pending, completed, expired, extended |
| priority | ENUM | low, normal, high, critical |
| assigned_user_id | UUID | FK → user |
| completed_at | TIMESTAMPTZ | |
| extension_date | DATE | If extended |
| extension_reason | VARCHAR(255) | |
| alert_days | INTEGER[] | e.g. {30, 15, 7, 1} |
| calendar_event_id | UUID | FK → calendar_event, nullable |

### deadline_rule
Reusable deadline calculation rules (primarily KPolD-based). External attorney sign-off required (audit P1.1).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| code | VARCHAR(50) | e.g. KPOLD_495, KPOLD_518 |
| name | VARCHAR(255) | e.g. "Έφεση - 30 ημέρες από επίδοση" |
| description | TEXT | |
| legal_basis | VARCHAR(255) | Article reference (e.g. "AK 249, KPolD 518") |
| trigger_event | VARCHAR(100) | e.g. service_of_judgment, filing_date |
| days | INTEGER | Number of days |
| calendar_type | ENUM | calendar_days, business_days |
| direction | ENUM | after, before |
| excludes_holidays | BOOLEAN | |
| extends_to_next_business | BOOLEAN | |
| suspends_during_recess | BOOLEAN | KPolD 147 — August + Christmas + Easter recess |
| practice_area | VARCHAR(100) | |
| validated_by_attorney | VARCHAR(255) | Attorney name + bar number who signed off |
| validated_at | DATE | |
| is_system | BOOLEAN | Built-in rules |

---

## 5. DOCUMENT MANAGEMENT

### document
Files stored in R2, metadata in PostgreSQL.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter, nullable |
| party_id | UUID | FK → party, nullable. The party this document principally concerns. |
| title | VARCHAR(500) | |
| description | TEXT | |
| file_type | VARCHAR(20) | pdf, docx, xlsx, jpg, etc. |
| file_size | BIGINT | Bytes |
| storage_path | VARCHAR(500) | R2 object key (under firm's bucket prefix) |
| storage_encrypted | BOOLEAN | Always true |
| mime_type | VARCHAR(100) | |
| sxetiko_number | VARCHAR(20) | Σχετικό numbering (Σ.1, Σ.2, ...) |
| category | ENUM | pleading, contract, correspondence, evidence, court_order, id_document, financial, template, other |
| privilege_tag | ENUM | none, attorney_client, work_product, joint_defense |
| legal_hold | BOOLEAN | Cannot be deleted if true |
| version | INTEGER | Current version number |
| uploaded_by | UUID | FK → user |
| ocr_text | TEXT | Extracted text for search |
| ocr_quality_score | DECIMAL(3,2) | 0.00-1.00, set by OCR pipeline |
| ai_summary | TEXT | AI-generated summary |
| custom_fields | JSONB | |
| tags | TEXT[] | |
| portal_visible | BOOLEAN | Visible in client portal — false by default; never auto-true for `privilege_tag != 'none'` |

**v0.2 additions:** `ocr_quality_score` (audit G28), `portal_visible` (Phase 1 portal lite).

### document_version
Version history per document.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| document_id | UUID | FK → document |
| version | INTEGER | |
| storage_path | VARCHAR(500) | R2 object key for this version |
| file_size | BIGINT | |
| change_notes | TEXT | |
| uploaded_by | UUID | FK → user |

### document_template
Reusable document templates with variable placeholders.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(255) | |
| category | VARCHAR(100) | e.g. αγωγή, εξώδικο, σύμβαση, πληρεξούσιο |
| practice_area | VARCHAR(100) | |
| content_template | TEXT | Template with {{placeholders}} |
| variables | JSONB | Variable definitions with types |
| is_system | BOOLEAN | Built-in templates |
| language | ENUM | el, en |

---

## 6. TIME TRACKING & BILLING

### time_entry

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter |
| user_id | UUID | FK → user |
| date | DATE | |
| duration_minutes | INTEGER | |
| description | TEXT | `[PII]` |
| activity_type | ENUM | research, drafting, hearing, meeting, travel, review, admin, phone_call |
| task_code | VARCHAR(20) | UTBMS code, nullable |
| is_billable | BOOLEAN | |
| billing_status | ENUM | draft, approved, billed, written_off |
| rate_amount | BIGINT | Rate used (cents per hour) |
| total_amount | BIGINT | Computed: (duration/60) * rate |
| invoice_id | UUID | FK → invoice, nullable |
| timer_id | UUID | FK → timer, nullable |
| capture_session_id | UUID | FK → time_capture_session, nullable. If promoted from auto-capture. |
| approved_by | UUID | FK → user, nullable |
| approved_at | TIMESTAMPTZ | |

### timer
Active timers (start/stop).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → user |
| matter_id | UUID | FK → matter, nullable |
| started_at | TIMESTAMPTZ | |
| paused_at | TIMESTAMPTZ | nullable |
| elapsed_seconds | INTEGER | Accumulated before pause |
| status | ENUM | running, paused, stopped |
| description | TEXT | |

### time_capture_event — NEW v0.2
Passive activity events captured by browser extension or desktop app.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → user |
| captured_at | TIMESTAMPTZ | When the event occurred (client clock) |
| received_at | TIMESTAMPTZ | When server received (after sync) |
| source | ENUM | browser_extension, desktop_app, mobile_app |
| event_type | ENUM | window_focus, window_blur, document_opened, calendar_event, manual_marker |
| app_name | VARCHAR(255) | `[PII]` e.g. "Microsoft Word", "Chrome" |
| window_title | VARCHAR(500) | `[PII]` Title bar text (may contain matter clue) |
| document_path | VARCHAR(500) | `[PII]` File path or URL (may contain matter slug) |
| inferred_matter_id | UUID | FK → matter, nullable. Set by Aegis Time Inferrer. |
| confidence_score | DECIMAL(3,2) | 0.00-1.00, inference confidence |
| duration_seconds | INTEGER | Computed when next event arrives |
| capture_session_id | UUID | FK → time_capture_session, nullable. Assigned during clustering. |

**Retention:** Raw events kept 90 days then pseudonymized (truncate window_title, app_name → category). Privacy by design.
**Indexes:** (user_id, captured_at), (capture_session_id).

### time_capture_session — NEW v0.2
Aggregated draft session, output of Aegis Time Inferrer (Χρονογράφος).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → user |
| date | DATE | |
| start_at | TIMESTAMPTZ | |
| end_at | TIMESTAMPTZ | |
| duration_minutes | INTEGER | |
| inferred_matter_id | UUID | FK → matter, nullable. Best-guess matter. |
| inferred_activity_type | VARCHAR(50) | research / drafting / etc. |
| inferred_description | TEXT | AI-drafted (subject to attorney edit) |
| status | ENUM | draft, reviewed, promoted_to_time_entry, dismissed |
| promoted_time_entry_id | UUID | FK → time_entry, nullable |
| reviewed_at | TIMESTAMPTZ | |
| reviewed_by | UUID | FK → user, nullable |

**Privacy gate:** A session is never auto-promoted to `time_entry`. Attorney must approve.

### rate_card

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(100) | |
| user_id | UUID | FK → user, nullable (per-attorney) |
| party_id | UUID | FK → party, nullable. Per-client rate — the party must hold an active `party_role` of `client`. |
| matter_id | UUID | FK → matter, nullable. Per-matter override. |
| practice_area | VARCHAR(100) | nullable (per-practice) |
| activity_type | VARCHAR(50) | nullable (per-activity) |
| rate_amount | BIGINT | Cents per hour |
| currency | VARCHAR(3) | EUR |
| effective_from | DATE | |
| effective_to | DATE | nullable |
| priority | INTEGER | Higher priority wins in conflict |

**Resolution order**: matter override > party (client) rate > attorney+practice > attorney > firm default

---

## 7. INVOICING & PAYMENTS

### invoice

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| invoice_number | VARCHAR(50) | Sequential (e.g. INV-2026-001) |
| bill_to_party_id | UUID | FK → party. The party being billed (must hold active `client` role). |
| matter_id | UUID | FK → matter, nullable (can span matters) |
| type | ENUM | invoice, credit_note, proforma |
| doc_type | ENUM | da, apy | myDATA document type |
| status | ENUM | draft, pending_approval, approved, sent, paid, partially_paid, overdue, cancelled, written_off |
| issue_date | DATE | |
| due_date | DATE | |
| subtotal | BIGINT | Cents |
| vat_rate | DECIMAL(5,2) | 24% standard |
| vat_amount | BIGINT | Cents |
| withholding_rate | DECIMAL(5,2) | 15% παρακράτηση |
| withholding_amount | BIGINT | Cents |
| total | BIGINT | Cents (subtotal + vat - withholding) |
| amount_paid | BIGINT | Cents |
| balance_due | BIGINT | Cents |
| currency | VARCHAR(3) | EUR |
| language | ENUM | el, en |
| notes | TEXT | |
| payment_terms | VARCHAR(255) | |
| mydata_mark | VARCHAR(50) | AADE MARK number after transmission |
| mydata_uid | VARCHAR(50) | AADE UID |
| mydata_transmitted_at | TIMESTAMPTZ | |
| approval_chain_id | UUID | FK → invoice_approval_chain, nullable. Multi-tier approval (audit P2.10). |
| current_approval_step | INTEGER | Current step in chain |
| approved_at | TIMESTAMPTZ | When fully approved (chain complete) |
| sent_at | TIMESTAMPTZ | |
| template_id | UUID | FK → invoice_template, nullable |
| portal_visible | BOOLEAN | Visible in client portal once `status='sent'` |

**v0.2 additions:** `approval_chain_id` + `current_approval_step` for multi-tier approval. `portal_visible` for portal lite.

### invoice_approval_chain — NEW v0.2
Configurable approval chain definition (per firm or per role).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(100) | e.g. "Standard 2-tier", "Partner direct" |
| applies_to | JSONB | Conditions: practice_area, amount_threshold, party type |
| steps | JSONB | Array of {step_number, role_id, escalation_after_hours} |
| is_default | BOOLEAN | |

### invoice_approval_step_log — NEW v0.2
Audit trail of every approval step.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| invoice_id | UUID | FK → invoice |
| step_number | INTEGER | |
| approver_user_id | UUID | FK → user |
| action | ENUM | approved, rejected, escalated |
| reason | TEXT | nullable |
| acted_at | TIMESTAMPTZ | |

### invoice_line_item

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| invoice_id | UUID | FK → invoice |
| line_type | ENUM | time, expense, flat_fee, disbursement, bar_stamp |
| description | TEXT | |
| quantity | DECIMAL(10,2) | Hours or units |
| unit_price | BIGINT | Cents |
| amount | BIGINT | Cents |
| time_entry_id | UUID | FK → time_entry, nullable |
| expense_id | UUID | FK → expense, nullable |
| bar_stamp_id | UUID | FK → bar_stamp, nullable |
| tax_category | VARCHAR(50) | myDATA income classification |
| ledes_task_code | VARCHAR(20) | LEDES 1998B task code (audit P2.3) |
| ledes_activity_code | VARCHAR(20) | LEDES 1998B activity code |
| ledes_expense_code | VARCHAR(20) | LEDES 1998B expense code |

**v0.2 additions:** LEDES fields for export.

### payment

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| invoice_id | UUID | FK → invoice |
| amount | BIGINT | Cents |
| payment_date | DATE | |
| payment_method | ENUM | bank_transfer, credit_card, cash, check, sepa, stripe, viva_wallet |
| reference | VARCHAR(255) | Transaction reference |
| notes | TEXT | |
| receipt_document_id | UUID | FK → document, nullable |
| portal_initiated | BOOLEAN | True if paid via client portal |

**v0.2 additions:** `stripe`, `viva_wallet` enum values + `portal_initiated` flag for portal payments.

### expense

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter, nullable |
| user_id | UUID | FK → user |
| date | DATE | |
| category | ENUM | court_fee, travel, postage, expert_fee, translation, copy, courier, filing_fee, paravolo, other |
| description | TEXT | |
| amount | BIGINT | Cents |
| is_billable | BOOLEAN | |
| markup_pct | DECIMAL(5,2) | Markup percentage, nullable |
| receipt_document_id | UUID | FK → document, nullable |
| billing_status | ENUM | pending, billed, written_off |
| invoice_id | UUID | FK → invoice, nullable |
| approved_by | UUID | FK → user, nullable |

---

## 8. GREEK-SPECIFIC: BAR STAMPS & COURT FEES

### bar_stamp
ΔΣΑ/ΔΣΘ Γραμμάτιο — one per court appearance.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| hearing_id | UUID | FK → hearing |
| matter_id | UUID | FK → matter |
| user_id | UUID | FK → user (attorney appearing) |
| bar_association | VARCHAR(10) | ΔΣΑ, ΔΣΘ, ΔΣΠ, etc. |
| fee_amount | BIGINT | Attorney fee in cents |
| withholding_15_pct | BIGINT | 15% withholding in cents |
| efka_contribution | BIGINT | ΕΦΚΑ in cents |
| eadd_contribution | BIGINT | ΕΑΑΔΗΣΥ in cents |
| dsa_contribution | BIGINT | ΔΣΑ own contribution in cents |
| total_stamp | BIGINT | Total γραμμάτιο amount in cents |
| stamp_number | VARCHAR(50) | ΔΣΑ stamp reference |
| issued_at | TIMESTAMPTZ | |
| status | ENUM | pending, issued, paid, cancelled |
| pdf_document_id | UUID | FK → document, nullable |

### bar_rate_config — NEW v0.2
Annual rate config for ΕΦΚΑ, ΕΑΑΔΗΣΥ, ΔΣΑ contributions (audit G20).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| year | SMALLINT | e.g. 2026 |
| bar_association | VARCHAR(10) | ΔΣΑ, ΔΣΘ, ΔΣΠ, ... |
| efka_rate | DECIMAL(5,4) | e.g. 0.1333 |
| eadd_rate | DECIMAL(5,4) | e.g. 0.0100 |
| dsa_rate | DECIMAL(5,4) | varies per ΔΣΑ |
| min_fee_table | JSONB | KD minimum fees per case type |
| effective_from | DATE | |
| effective_to | DATE | nullable |

### court_fee
Court fees and παράβολα.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter |
| fee_type | ENUM | paravolo, dikastiko_ensimo, megarosimo, other |
| amount | BIGINT | Cents |
| e_paravolo_code | VARCHAR(50) | e-παράβολο reference number |
| e_paravolo_status | ENUM | pending, paid, used, refunded |
| claim_value | BIGINT | Value of claim (for calculation) |
| receipt_document_id | UUID | FK → document, nullable |
| paid_at | TIMESTAMPTZ | |
| billed_to_client | BOOLEAN | |
| expense_id | UUID | FK → expense, nullable |

---

## 9. CONFLICT CHECK & AML/KYC

> Under **INVARIANT #1**, conflict checks pivot on `party_id`.

### conflict_check

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| triggered_by | ENUM | new_party, new_matter, role_change, lateral_hire, manual |
| subject_party_id | UUID | FK → party, nullable. The party being checked (when known). |
| subject_search_terms | JSONB | `[PII]` Free-text fallback when no `party_id` yet: {names[], tax_ids[], aliases[]} |
| proposed_role | ENUM | The role being proposed (client, opposing, etc.) — determines what counts as a conflict |
| proposed_side | ENUM | ours, opposing, neutral |
| searched_at | TIMESTAMPTZ | |
| searched_by | UUID | FK → user |
| status | ENUM | clear, conflict_found, waived |
| waiver_reason | TEXT | If status=waived |
| waiver_approved_by | UUID | FK → user, nullable |

### conflict_result
Individual matches found during a conflict check. Always pivots on `party_id`.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| conflict_check_id | UUID | FK → conflict_check |
| match_type | ENUM | same_party, phonetic_name, tax_id_match, company_officer, related_party |
| matched_party_id | UUID | FK → party. The party that triggered the conflict. |
| matched_via_relationship_id | UUID | FK → party_relationship, nullable. If matched indirectly (spouse, director, etc.). |
| matched_in_matter_id | UUID | FK → matter, nullable. The matter where the conflict exists. |
| matched_role | ENUM | The role the matched party held in that matter |
| matched_side | ENUM | ours, opposing, neutral, unknown |
| match_score | DECIMAL(3,2) | 0.00-1.00 |
| notes | TEXT | |

**Indexes:** (matched_party_id), (conflict_check_id, match_type).

### aml_check
Anti-Money Laundering / KYC check records. v0.2 fix: column renamed `client_id` → `party_id` (audit G16).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| party_id | UUID | FK → party |
| check_type | ENUM | kyc, pep_screening, sanctions, adverse_media |
| provider | VARCHAR(100) | External service used |
| result | ENUM | clear, hit, pending_review |
| risk_level | ENUM | low, medium, high |
| checked_at | TIMESTAMPTZ | |
| checked_by | UUID | FK → user |
| details | JSONB | Full check results |
| next_review_date | DATE | |
| document_ids | UUID[] | Supporting documents |

---

## 10. CONTRACTS & ENGAGEMENT

### contract

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| party_id | UUID | FK → party. Counterparty (typically holding `client` role). v0.2: renamed from `client_id`. |
| matter_id | UUID | FK → matter, nullable |
| contract_type | ENUM | engagement_letter, power_of_attorney, service_agreement, retainer, nda |
| title | VARCHAR(255) | |
| start_date | DATE | |
| end_date | DATE | nullable |
| auto_renew | BOOLEAN | |
| renewal_alert_days | INTEGER | Days before expiry to alert |
| fee_arrangement | JSONB | Rate card / flat fee / retainer terms |
| status | ENUM | draft, sent, signed, active, expired, terminated |
| document_id | UUID | FK → document |
| signed_at | TIMESTAMPTZ | |
| signed_document_id | UUID | FK → document, nullable |
| template_id | UUID | FK → document_template, nullable |
| aped_signature_request_id | UUID | FK → aped_signature_request, nullable |

### retainer

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contract_id | UUID | FK → contract |
| party_id | UUID | FK → party. The party (client) under retainer. v0.2: renamed from `client_id`. |
| amount | BIGINT | Monthly retainer in cents |
| frequency | ENUM | monthly, quarterly, annual |
| balance | BIGINT | Current balance in cents |
| low_balance_alert | BIGINT | Alert threshold in cents |
| auto_replenish | BOOLEAN | |

---

## 11. COMMUNICATION & EMAIL AUTO-FILING

### communication_log

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter, nullable |
| party_id | UUID | FK → party, nullable. The party this communication is with. |
| channel | ENUM | email, phone, sms, letter, fax, in_person, portal_message |
| direction | ENUM | inbound, outbound |
| subject | VARCHAR(500) | `[PII]` |
| body | TEXT | `[PII]` |
| from_address | VARCHAR(255) | `[PII]` |
| to_addresses | TEXT[] | `[PII]` |
| external_id | VARCHAR(255) | Email message-id, etc. |
| email_message_id | UUID | FK → email_message, nullable. Link to auto-filed email if applicable. |
| logged_by | UUID | FK → user |
| logged_at | TIMESTAMPTZ | |
| attachment_ids | UUID[] | FK → document |

### protocol_entry
Greek office protocol (incoming/outgoing correspondence numbering).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| protocol_number | VARCHAR(30) | e.g. Π.ΕΙΣ.001/2026, Π.ΕΞ.001/2026 |
| direction | ENUM | incoming, outgoing |
| date | DATE | |
| subject | VARCHAR(500) | |
| sender | VARCHAR(255) | `[PII]` |
| recipient | VARCHAR(255) | `[PII]` |
| matter_id | UUID | FK → matter, nullable |
| document_id | UUID | FK → document, nullable |
| communication_id | UUID | FK → communication_log, nullable |
| delivery_method | ENUM | email, registered_mail, courier, hand_delivery, fax |
| tracking_number | VARCHAR(100) | Courier tracking |

### email_account — NEW v0.2
Per-user OAuth-connected email accounts for auto-filing.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → user |
| email_address | VARCHAR(255) | `[PII]` |
| provider | ENUM | gmail, microsoft_graph, imap |
| oauth_token_ref | VARCHAR(255) | KMS-encrypted token reference |
| imap_host | VARCHAR(255) | Only for `imap` provider |
| imap_port | INTEGER | |
| auto_filing_enabled | BOOLEAN | User opt-in |
| blacklist_domains | TEXT[] | Domains to never auto-file |
| blacklist_senders | TEXT[] | Specific senders to skip |
| last_sync_at | TIMESTAMPTZ | |
| sync_status | ENUM | active, paused, error |
| last_error | TEXT | |

**Constraint:** Provider must be EU-region. Microsoft Graph: tenant must be in EU. Gmail: workspace in EU.

### email_message — NEW v0.2
Auto-filed emails linked to matter/party.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| email_account_id | UUID | FK → email_account |
| message_id_external | VARCHAR(500) | Provider message-id |
| direction | ENUM | inbound, outbound |
| sent_at | TIMESTAMPTZ | |
| received_at | TIMESTAMPTZ | |
| from_address | VARCHAR(255) | `[PII]` |
| to_addresses | TEXT[] | `[PII]` |
| cc_addresses | TEXT[] | `[PII]` |
| bcc_addresses | TEXT[] | `[PII]` |
| subject | VARCHAR(500) | `[PII]` |
| body_text | TEXT | `[PII]` |
| body_html | TEXT | `[PII]` |
| inferred_matter_id | UUID | FK → matter, nullable. Set by Aegis Email Classifier. |
| inferred_party_id | UUID | FK → party, nullable. Counterparty inference. |
| inferred_category | VARCHAR(50) | e.g. "client_correspondence", "court_notice", "internal" |
| inferred_privilege | BOOLEAN | Defaults false; classifier sets true if attorney-client content detected. |
| confidence_score | DECIMAL(3,2) | 0.00-1.00 |
| status | ENUM | pending_review, classified, manual_filed, dismissed |
| reviewed_at | TIMESTAMPTZ | |
| reviewed_by | UUID | FK → user, nullable |

**Privacy:** `body_text`/`body_html` encrypted at rest. Classifier accesses anonymized version (PII placeholders).
**Indexes:** (email_account_id, received_at), (inferred_matter_id), partial `WHERE status='pending_review'`.

### email_attachment — NEW v0.2

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| email_message_id | UUID | FK → email_message |
| filename | VARCHAR(255) | `[PII]` |
| mime_type | VARCHAR(100) | |
| file_size | BIGINT | Bytes |
| storage_path | VARCHAR(500) | R2 object key (under firm prefix) |
| promoted_document_id | UUID | FK → document, nullable. If user promoted to DMS. |

---

## 12. TASKS & NOTES

### task

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter, nullable |
| title | VARCHAR(500) | |
| description | TEXT | |
| assigned_to | UUID | FK → user |
| created_by | UUID | FK → user |
| due_date | DATE | nullable |
| priority | ENUM | low, normal, high, urgent |
| status | ENUM | todo, in_progress, review, done, cancelled |
| parent_task_id | UUID | FK → task, nullable (subtasks) |
| checklist | JSONB | Array of {text, completed} |
| completed_at | TIMESTAMPTZ | |
| created_by_workflow_id | UUID | FK → workflow, nullable. Auto-created via Workflow lite. |

### note

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter, nullable |
| party_id | UUID | FK → party, nullable. The party this note concerns. |
| content | TEXT | `[PII]` |
| note_type | ENUM | general, strategy, privileged, internal |
| created_by | UUID | FK → user |
| is_privileged | BOOLEAN | Attorney-client privileged |

---

## 13. COURTS DATABASE (Shared / Read-Only)

### court
Database of Greek courts. Lives in central read-only DB. Per-firm DBs reference by `court_id`.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(255) | e.g. "Πρωτοδικείο Αθηνών" |
| short_name | VARCHAR(50) | e.g. "ΠΠρΑθ" |
| court_type | ENUM | eirinodikio, protodikio, efetio, areios_pagos, diikitiko_protodikio, diikitiko_efetio, symvoulio_epikrateias, elegktiko_synedrio |
| city | VARCHAR(100) | |
| region | VARCHAR(100) | |
| address | VARCHAR(255) | |
| phone | VARCHAR(50) | |
| email | VARCHAR(255) | |
| solon_court_id | VARCHAR(50) | SOLON system court identifier |
| dikes_moj_id | VARCHAR(50) | dikes.moj.gov.gr identifier |
| sections | JSONB | Array of {section_number, section_type, schedule} |
| operating_hours | JSONB | |
| is_active | BOOLEAN | |
| seed_source | VARCHAR(100) | "solon.gov.gr 2026-01" — provenance (audit P2.14) |
| seed_verified_at | DATE | When ground-truthed |

---

## 14. LEGAL CORPUS (Shared / Read-Only)

These tables exist in the shared legal corpus database (read-only from per-firm perspective).

### legal_document

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| doc_type | ENUM | law, presidential_decree, ministerial_decision, regulation, eu_regulation, eu_directive |
| number | VARCHAR(50) | e.g. "4624/2019" |
| title | TEXT | |
| fek_number | VARCHAR(50) | ΦΕΚ reference |
| fek_date | DATE | |
| effective_date | DATE | |
| status | ENUM | active, amended, repealed |
| full_text | TEXT | |

### legal_article

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| legal_document_id | UUID | FK → legal_document |
| article_number | VARCHAR(20) | |
| title | VARCHAR(500) | |
| content | TEXT | |
| is_active | BOOLEAN | |

### case_law
Jurisprudence database.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| court_type | VARCHAR(50) | ΑΠ, ΣτΕ, ΕφΑθ, etc. |
| case_number | VARCHAR(50) | e.g. "123/2024" |
| date | DATE | |
| subject | TEXT | |
| summary | TEXT | |
| full_text | TEXT | |
| cited_articles | JSONB | Array of article references |
| keywords | TEXT[] | |

**Qdrant collections:**
- `legal_corpus` — 538K+ vectors (shared, read-only)
- `case_law` — jurisprudence vectors (shared, read-only)
- `firm_{firm_slug}_documents` — per-firm document vectors (private to that firm's deployment)

---

## 15. INTAKE / CRM

> A `lead` is a prospective engagement, **not** a separate person record. The prospect is created as a `party` from intake.

### lead

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| party_id | UUID | FK → party. The prospect's canonical record. |
| source | ENUM | website, referral, ad, walk_in, phone, social_media |
| referral_source_party_id | UUID | FK → party, nullable. The referring party. |
| practice_area | VARCHAR(100) | |
| description | TEXT | `[PII]` What the prospect is asking for |
| status | ENUM | new, contacted, consultation_scheduled, conflict_check, proposal_sent, retained, lost |
| assigned_to | UUID | FK → user |
| score | SMALLINT | AI lead qualification score 0-100 |
| converted_at | TIMESTAMPTZ | |
| converted_matter_id | UUID | FK → matter, nullable |
| gdpr_consent | BOOLEAN | |
| follow_up_at | TIMESTAMPTZ | |

### consultation

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| lead_id | UUID | FK → lead |
| user_id | UUID | FK → user |
| scheduled_at | TIMESTAMPTZ | |
| duration_minutes | INTEGER | |
| status | ENUM | scheduled, completed, cancelled, no_show |
| notes | TEXT | `[PII]` |
| calendar_event_id | UUID | FK → calendar_event, nullable |

---

## 16. WORKFLOW ENGINE

### workflow

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(255) | |
| trigger_type | ENUM | matter_created, stage_changed, deadline_approaching, document_uploaded, invoice_paid, manual |
| trigger_config | JSONB | Conditions |
| actions | JSONB | Array of {action_type, params} |
| is_active | BOOLEAN | |
| practice_area | VARCHAR(100) | nullable (all if null) |

### workflow_log

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| workflow_id | UUID | FK → workflow |
| matter_id | UUID | FK → matter, nullable |
| triggered_at | TIMESTAMPTZ | |
| actions_executed | JSONB | |
| status | ENUM | success, partial, failed |
| error_message | TEXT | nullable |

---

## 17. myDATA INTEGRATION

### mydata_record
AADE myDATA transmission log.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| invoice_id | UUID | FK → invoice |
| direction | ENUM | outbound, inbound |
| doc_type | VARCHAR(10) | 1.1 (DA), 2.1 (APY), etc. |
| mark | VARCHAR(50) | AADE MARK |
| uid | VARCHAR(50) | AADE UID |
| auth_code | VARCHAR(50) | AADE auth code |
| xml_payload | TEXT | Full XML sent |
| response_payload | TEXT | AADE response |
| status | ENUM | pending, transmitted, accepted, rejected, cancelled |
| transmitted_at | TIMESTAMPTZ | |
| error_details | TEXT | |

---

## 18. SOLON E-FILING (Phase 1 — wrapper, audit P1.3 Option B)

### solon_filing
Renamed from `e_filing` in v0.2; expanded for wrapper flow.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK → matter |
| filing_type | ENUM | agogi, efesi, aitisi, antirrisi, anapsylafisi, certificate_request |
| court_id | UUID | FK → court |
| document_ids | UUID[] | FK → document |
| zip_storage_path | VARCHAR(500) | R2 path of generated SOLON-format ZIP |
| zip_generated_at | TIMESTAMPTZ | |
| solon_submission_id | VARCHAR(100) | SOLON tracking number (entered by attorney after manual upload) |
| solon_status | ENUM | draft, zip_ready, submitted_manually, accepted, rejected, processing, certificate_issued |
| filing_number | VARCHAR(100) | Αριθμός κατάθεσης from SOLON (auto-poll or manual) |
| filed_at | TIMESTAMPTZ | |
| filed_by | UUID | FK → user |
| response_payload | JSONB | SOLON response data |
| certificate_id | VARCHAR(100) | If certificate request |
| aped_signature_request_id | UUID | FK → aped_signature_request, nullable. Pre-signing flow. |
| poll_attempts | INTEGER | Status poll count |
| last_polled_at | TIMESTAMPTZ | |
| error_log | JSONB | Any errors during ZIP gen or polling |

**v0.2 changes:** added `zip_storage_path`, `zip_generated_at`, `aped_signature_request_id`, `poll_attempts`. Status enum expanded to support wrapper hybrid flow.

---

## 19. DIGITAL SIGNATURES (Phase 1 ΑΠΕΔ + Phase 2 advanced)

### signature_request
General-purpose signature request (simple click-to-sign for portal, advanced for internal).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| document_id | UUID | FK → document |
| signature_type | ENUM | simple, advanced, qualified_aped |
| status | ENUM | pending, signed, declined, expired |
| signers | JSONB | Array of {name, email, role, signed_at, ip_address} |
| requested_by | UUID | FK → user |
| requested_at | TIMESTAMPTZ | |
| expires_at | TIMESTAMPTZ | |
| signed_document_id | UUID | FK → document, nullable |
| audit_trail | JSONB | Full signing audit |

### aped_signature_request — NEW v0.2 (Phase 1)
Specialized table for ΑΠΕΔ qualified signatures via portal.olomeleia.gr (audit P1.7).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| document_id | UUID | FK → document |
| matter_id | UUID | FK → matter, nullable |
| solon_filing_id | UUID | FK → solon_filing, nullable. If signing for SOLON submission. |
| requesting_user_id | UUID | FK → user (the attorney who initiated) |
| signing_user_id | UUID | FK → user (the attorney whose ΑΠΕΔ certificate is used; can be different) |
| oauth_session_ref | VARCHAR(255) | Reference to portal.olomeleia.gr session |
| status | ENUM | pending_oauth, oauth_completed, signing, signed, failed, expired |
| certificate_fingerprint | VARCHAR(255) | ΑΠΕΔ certificate fingerprint (for verification) |
| signed_at | TIMESTAMPTZ | |
| signed_document_id | UUID | FK → document. The signed PDF. |
| verification_url | VARCHAR(500) | Public verification link |
| audit_trail | JSONB | {oauth_initiated_at, oauth_completed_at, signing_initiated_at, signed_at, ip, user_agent, certificate_serial, ...} |
| failure_reason | TEXT | If status=failed |

---

## 20. TRUST ACCOUNTING (Phase 1 basic — audit P2.4)

### trust_account
v0.2: column renamed `client_id` → `party_id`.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| party_id | UUID | FK → party. The party (client) for whom funds are held. |
| matter_id | UUID | FK → matter, nullable |
| account_name | VARCHAR(255) | |
| bank_name | VARCHAR(100) | |
| iban | VARCHAR(34) | `[PII]` |
| bank_separate_account | BOOLEAN | ΕΔΕ requirement: must be true (separate from operating funds) |
| balance | BIGINT | Current balance in cents |
| status | ENUM | active, closed |

### trust_transaction

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| trust_account_id | UUID | FK → trust_account |
| type | ENUM | deposit, withdrawal, transfer, interest |
| amount | BIGINT | Cents (positive=in, negative=out) |
| balance_after | BIGINT | Running balance |
| description | TEXT | |
| reference | VARCHAR(100) | |
| recorded_by | UUID | FK → user |
| recorded_at | TIMESTAMPTZ | |
| invoice_id | UUID | FK → invoice, nullable |
| reconciled_with_bank | BOOLEAN | True if matched against bank statement (2-way reconcile) |
| reconciled_at | TIMESTAMPTZ | |

### trust_reconciliation — NEW v0.2
Bank statement reconciliation log (Phase 1: 2-way; Phase 2: 3-way with client ledger).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| trust_account_id | UUID | FK → trust_account |
| period_start | DATE | |
| period_end | DATE | |
| internal_balance | BIGINT | Cents per internal ledger |
| bank_balance | BIGINT | Cents per bank statement |
| difference | BIGINT | Cents (should be 0 for clean reconcile) |
| status | ENUM | draft, reconciled, discrepancy_found |
| reconciled_by | UUID | FK → user |
| reconciled_at | TIMESTAMPTZ | |
| notes | TEXT | |
| bank_statement_document_id | UUID | FK → document, nullable |

---

## 21. AUDIT LOG (Append-Only, Immutable)

### audit_log

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | PK, sequential |
| tenant_id | UUID | Retained for cross-DB log shipping safety; defensive |
| user_id | UUID | |
| action | VARCHAR(50) | create, update, delete, login, export, view_pii |
| entity_type | VARCHAR(100) | Table name |
| entity_id | UUID | |
| changes | JSONB | {field: {old, new}} |
| ip_address | INET | |
| user_agent | VARCHAR(500) | |
| created_at | TIMESTAMPTZ | |

**Partitioned by month** for performance. Write-only table (no UPDATE/DELETE allowed).

**v0.2 GDPR clarification (audit P1.10):** Per N.4624/2019 derogation, legal records are exempt from erasure for SOL period (5y general, 20y contractual). Audit log retention policy: PII pseudonymization after retention period (replace name/AFM/ID with hash) instead of deletion. Spec'd in `greek-compliance.md` §8.

---

## 22. SETTINGS & CONFIGURATION

### custom_field_definition
User-defined custom fields per entity type.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| entity_type | ENUM | party, matter, hearing, document |
| field_name | VARCHAR(100) | |
| field_type | ENUM | text, number, date, select, multi_select, boolean |
| options | JSONB | For select/multi_select |
| is_required | BOOLEAN | |
| order_index | INTEGER | |

### notification_preference

| Column | Type | Notes |
|--------|------|-------|
| user_id | UUID | FK → user |
| event_type | VARCHAR(100) | |
| channel | ENUM | email, push, sms, in_app |
| enabled | BOOLEAN | |

### referral_source
Classifier for **non-party** referral channels only (websites, ad campaigns, directories).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(255) | |
| type | ENUM | website, ad_campaign, directory, other |
| contact_info | VARCHAR(255) | |

### invoice_template

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(100) | |
| language | ENUM | el, en |
| html_template | TEXT | Rendered with data |
| is_default | BOOLEAN | |

---

## 23. CLIENT PORTAL (Phase 1 lite — NEW v0.2)

> Separate auth domain from firm-staff `user` table. Clients access portal at `portal.{firm_slug}.themis.gr`.

### portal_user — NEW v0.2

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| party_id | UUID | FK → party. The party this portal user represents. Must hold active `client` role. |
| email | VARCHAR(255) | `[PII]` Login email; may differ from party.emails |
| password_hash | VARCHAR(255) | argon2id |
| first_name | VARCHAR(100) | `[PII]` (mirror of party for display) |
| last_name | VARCHAR(100) | `[PII]` |
| mfa_secret | VARCHAR(255) | `[PII]` Optional TOTP |
| is_active | BOOLEAN | |
| invited_at | TIMESTAMPTZ | |
| activated_at | TIMESTAMPTZ | |
| last_login_at | TIMESTAMPTZ | |
| preferred_language | ENUM | el, en |

**Constraint:** A `portal_user` cannot exist without `party_role(party_id, role='client', active_until IS NULL)`.

### portal_session — NEW v0.2

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| portal_user_id | UUID | FK → portal_user |
| token_hash | VARCHAR(255) | Hashed session token |
| ip_address | INET | |
| user_agent | VARCHAR(500) | |
| issued_at | TIMESTAMPTZ | |
| expires_at | TIMESTAMPTZ | |
| revoked_at | TIMESTAMPTZ | nullable |

### portal_invitation — NEW v0.2

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| party_id | UUID | FK → party |
| email | VARCHAR(255) | `[PII]` |
| invited_by_user_id | UUID | FK → user |
| token | VARCHAR(255) | One-time signup token |
| status | ENUM | sent, accepted, expired, revoked |
| sent_at | TIMESTAMPTZ | |
| accepted_at | TIMESTAMPTZ | |
| expires_at | TIMESTAMPTZ | |

---

## 24. REPORTS & DASHBOARDS (Phase 1 baseline — NEW v0.2)

### report_dashboard — NEW v0.2

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(255) | |
| user_id | UUID | FK → user, nullable. NULL = firm-wide dashboard. |
| widgets | JSONB | Array of {widget_type, query_id, position, size} |
| is_default | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

### saved_query — NEW v0.2
Phase 1: read-only library of pre-built queries; Phase 2 adds custom builder.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(255) | |
| description | TEXT | |
| query_type | ENUM | financial_summary, matter_status, productivity, collections, bar_stamps_summary, trust_summary, custom |
| sql_template | TEXT | Parameterized SQL (DB views only; no DDL) |
| nl_prompt | TEXT | If generated by Aegis Apologistis |
| parameters | JSONB | Required parameters definition |
| is_system | BOOLEAN | Built-in queries |
| created_by | UUID | FK → user, nullable |

**Security gate:** All `saved_query.sql_template` runs against read-only DB views; no direct table access. Aegis Apologistis output is sanitized (no DDL, no joins outside whitelist).

### report_run_log — NEW v0.2

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| saved_query_id | UUID | FK → saved_query |
| user_id | UUID | FK → user |
| parameters | JSONB | |
| executed_at | TIMESTAMPTZ | |
| duration_ms | INTEGER | |
| row_count | INTEGER | |
| status | ENUM | success, error, timeout |

---

## ENTITY COUNT SUMMARY (v0.2)

| Category | Tables | Per-Firm DB | Shared (Central RO) |
|----------|--------|-------------|---------------------|
| Auth & Tenant | 5 | Yes | -- |
| Party (Unified Model) | 5 | Yes | -- |
| Matter | 5 | Yes | -- |
| Calendar & Hearings | 4 | Yes | -- |
| Documents | 3 | Yes | -- |
| Time & Capture (NEW) | 4 | Yes | -- |
| Invoicing & Payments | 5 | Yes | -- |
| Greek Specifics (Bar+Court) | 3 | Yes | -- |
| Conflict & AML | 3 | Yes | -- |
| Contracts | 2 | Yes | -- |
| Communication & Email Auto-filing | 5 | Yes | -- |
| Tasks & Notes | 2 | Yes | -- |
| Intake/CRM | 2 | Yes | -- |
| Workflow | 2 | Yes | -- |
| myDATA | 1 | Yes | -- |
| SOLON E-Filing | 1 | Yes | -- |
| Signatures (general + ΑΠΕΔ) | 2 | Yes | -- |
| Trust Accounting | 3 | Yes | -- |
| Audit | 1 | Yes | -- |
| Settings | 4 | Yes | -- |
| Client Portal (NEW) | 3 | Yes | -- |
| Reports & Dashboards (NEW) | 3 | Yes | -- |
| Courts | 1 | -- | Yes |
| Legal Corpus | 3 | -- | Yes |
| **TOTAL** | **68** | **64** | **4** |

**Delta from v0.1 (55 tables):** +13 net.

**Tables added in v0.2:**
- `time_capture_event`, `time_capture_session` (auto time capture)
- `email_account`, `email_message`, `email_attachment` (email auto-filing)
- `invoice_approval_chain`, `invoice_approval_step_log` (multi-tier approval)
- `bar_rate_config` (annual EFKA/EAAΔ rates)
- `aped_signature_request` (ΑΠΕΔ flow)
- `trust_reconciliation` (2-way bank reconcile)
- `portal_user`, `portal_session`, `portal_invitation` (client portal)
- `report_dashboard`, `saved_query`, `report_run_log` (reports BI)

**Tables renamed/restructured in v0.2:**
- `e_filing` → `solon_filing` (expanded)
- `matter_party` (no more inline PII)

**Tables modified in v0.2 (column changes only):**
- All `*_id → client` FKs renamed to `party_id` (matter, aml_check, contract, retainer, invoice, trust_account)
- `matter` lost `client_id` and `opposing_counsel`
- `hearing` replaced `anticletos_name`/`anticletos_bar_number` with `anticletos_party_id`
- `document` added `ocr_quality_score`, `portal_visible`
- `invoice` added `approval_chain_id`, `current_approval_step`, `portal_visible`
- `invoice_line_item` added LEDES fields
- `payment` enum extended with stripe/viva_wallet, added `portal_initiated`
- `time_entry` added `capture_session_id`
- `communication_log` added `email_message_id`
- `solon_filing` (was `e_filing`) added wrapper flow fields
- `court` added `seed_source`, `seed_verified_at`
- `party` removed redundant `afm`, added `amka`
- `deadline_rule` added `validated_by_attorney`, `validated_at`, `suspends_during_recess`

**Tables losing `tenant_id` column (50 tables):**
All per-firm tables. The single source of truth for "which firm is this DB for" is now the `tenant` row. v0.2 makes this irrevocable — point-of-no-return after Sprint 3.

**Tables retaining `tenant_id`:**
- `tenant` (self-reference, single row)
- `audit_log` (defensive, even though redundant in single-tenant DB)
- Shared `court`, `legal_document`, `legal_article`, `case_law` (these live in shared DB; `tenant_id` is N/A there)
