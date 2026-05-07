# ΘΕΜΙΣ OS — Data Model v0.3

**Spec version:** v0.3 (2026-04-29)
**Author:** Δαίδαλος (Master Coding Architect)
**Predecessor:** v0.2 (2026-04-28, 68 tables, single-tenant per firm blanket policy)
**Status:** PROPOSED — awaits Niko sign-off on §0 Decisions Table
**Driver:** Sunday's Recommendation v1.0 (§2 Decisions A, B, F, G) + Aristotle Critical Inconsistencies L1+L2
**Naming neutrality:** Το όνομα προϊόντος (`THEMIS_OS`) εμφανίζεται σε ΟΛΟ τον κώδικα μέσω env var `PRODUCT_SLUG` και `PRODUCT_NAME`. Ο schema ενός firm: `firm_{firm_uuid_short}`, ΟΧΙ `themis_*`. Rename-friendly by design.

---

## 0. DECISIONS TABLE (τι αλλάζει vs v0.2 και γιατί)

| # | v0.2 | v0.3 | Driver | Aristotle ID |
|---|------|------|--------|--------------|
| D-DM-1 | Single-tenant DB per firm blanket | **Two-tier:** schema-per-tenant στο shared cluster (Starter/Pro), dedicated DB (Firm/Enterprise) | Sunday §2.A + Pericles §1 + margin math | L2 |
| D-DM-2 | `tenant_id UUID` σε κάθε πίνακα | **DROP** από όλους τους per-tenant πίνακες — schema παρέχει isolation | Aristotle L2 + DB-per-tenant logic | L2 |
| D-DM-3 | Application-enforced `is_primary_contact` uniqueness | **Postgres partial unique index** | Aristotle L5 (race condition) | L5 |
| D-DM-4 | Application-enforced `billing_split_percentage = 100` | **Postgres trigger** (AFTER INSERT/UPDATE/DELETE on `matter_party`) | Aristotle L6 | L6 |
| D-DM-5 | 68 tables (`portal_*`, `email_*`, `time_capture_*`, `aped_*`, `solon_filing`, `trust_*` σε Phase 1 schema) | **40 tables Phase 1**, υπόλοιπα 28 → Phase 1.5/2/3 migrations | Sunday §2.G (44% scope cut) + Pericles §2 | — |
| D-DM-6 | KMS per-tenant DEK υπονοούμενο | **Explicit envelope encryption table** `tenant_dek` με per-row key references σε όλα τα `[PII]` columns | Aristotle L11 + Sunday §2.F (Greek sovereignty) | L11 |
| D-DM-7 | `audit_log` immutable, no retention | **Retention matrix per data type** + pseudonymization στα 20 χρόνια για financial, 5 χρόνια για non-financial | Aristotle L11 + GDPR N.4624/2019 §31 | L11 |
| D-DM-8 | `referral_source_party_id` + `source ENUM` ταυτόχρονα | **CHECK constraint** που τα συνδέει + drop redundant ENUM όπου derivable | Aristotle L7 | L7 |
| D-DM-9 | `representing_counsel_party_id` validated at write (vague) | **`party.is_attorney BOOLEAN` + `party.bar_number`** + application validation at API layer | Aristotle L13 | L13 |
| D-DM-10 | `legal_form` ENUM κενό για government/nonprofit | **`org_form` polymorphic** με sub-types: `company_form`, `government_type`, `nonprofit_type` | Aristotle L14 | L14 |
| D-DM-11 | `protocol_entry.protocol_number` no uniqueness | **UNIQUE(protocol_number, direction, year)** + Postgres SEQUENCE per (direction, year) | Aristotle L16 | L16 |
| D-DM-12 | `time_entry.rate_amount` ambiguous (snapshot vs live) | **Explicit snapshot at INSERT** + `rate_changed_audit JSONB` αν αλλάξει | Aristotle L17 | L17 |
| D-DM-13 | `matter.status` + `closed_at` redundant | **Derive `closed_at` από state-transition log** ή drop one. Επιλογή: keep both, sync via trigger | Aristotle L12 | L12 |
| D-DM-14 | Single-rate per attorney Phase 1 | **`rate_card` keeps multi-rate schema** αλλά Phase 1 UI exposes only `firm_default + per_attorney`. Multi-rate per matter = Firm tier (Sprint 9-10) | Sunday §2.G + Pericles §3 | — |
| D-DM-15 | All matters = single firm scope | **`departments lite`** keeps `matter.department_id` nullable, soft-isolation | Sunday §2.G (Firm tier) | — |
| D-DM-16 | Single `document.privilege_tag ENUM`, application-enforced | **Cryptographic privilege:** `document_privilege` granular table + per-document data key (DDK) wrapped με tenant DEK (and optionally team sub-key) | Aristotle E9 (joint defense per-co-client) + Invariant #9 hardening | E9, F3 |
| D-DM-17 | KMS root assumed Hetzner shared, no custody model | **Tiered KMS hierarchy:** Hetzner KMS shared (Starter/Pro), Hetzner KMS dedicated key (Firm), BYOK με **Shamir 3-of-5 custody** opt-in (Enterprise) | Sunday §2.F (Greek sovereignty marketing) + Aristotle F3 (rotation/loss/custody chain) | F3 |
| D-DM-18 | `audit_log` carries privilege accesses inline | **`audit_privilege_access` separate partitioned table** (monthly), append-only, every read of `document_privilege.tag != 'none'` | Aristotle F3 (custody chain proof) + GDPR forensics | F3 |
| D-DM-19 | Privilege enforcement only at API/portal layer | **Defense-in-depth:** crypto layer (DDK unavailable → ciphertext) + application layer (RBAC + privilege ACL) + audit layer (every access logged) | Invariant #9 made cryptographically true | E9, F3 |

---

## 1. INVARIANTS — v0.3 Restated

### Invariant #1 — Unified Party Model (UNCHANGED)
Ένα `party` row per real-world person/organization. `party_role` carries time-bounded roles. Καμία `client` table.

### Invariant #2 — Matter ↔ Party M2M with Role+Side (UNCHANGED)
`matter` has NO `client_id`. Όλα τα involved parties στο `matter_party` με `role`, `side`, `representation_status`.

### Invariant #3 — All money in `BIGINT` cents/lepta (UNCHANGED)
No floating point. Currency `EUR` default.

### Invariant #4 — Audit log append-only + retention matrix (REVISED)
Append-only. Pseudonymization στα 20 χρόνια για financial entries, 5 χρόνια για non-financial. PII στο `changes JSONB` envelope-encrypted με tenant DEK — αν χαθεί το key (key-shredding), το PII αχρηστεύεται automatically.

### Invariant #5 — AI degraded-mode-safe (UNCHANGED + RENAMED)
Aegis είναι **AI Enhancement Layer**, ΟΧΙ "nervous system" (Aristotle L3 fix). Core ops (matters, billing, calendar, documents) λειτουργούν ΧΩΡΙΣ Aegis. AI features degrade σε manual workflows.

### Invariant #6 — Tier-dependent tenant isolation (REWRITTEN — Sunday §2.A)
> Tenant isolation is **tier-dependent**. Starter & Professional (€19/€39) deploy on **shared Postgres cluster + schema-per-tenant + Postgres RLS + envelope-encrypted PII με per-tenant DEK**. Firm & Enterprise (€59/€79+) deploy on **dedicated Postgres DB + dedicated Qdrant collection + dedicated KMS root + dedicated R2 prefix**. Migration shared→dedicated is automated (4h maintenance window, reversible 30 days).

### Invariant #7 — Greek-first, EU-only data residency (UNCHANGED + STRENGTHENED)
Postgres + Qdrant + R2 σε EU region (Hetzner Helsinki/Falkenstein, Cloudflare R2 EU, Qdrant στο PC node Αλμωπία). Marketing badge (Sunday §2.F).

### Invariant #8 — Human-in-the-loop στα legal-actionable AI outputs (UNCHANGED)
Πάντα yellow "AI Draft" banner non-dismissable. Citation validator real-time vs `case_law` table.

### Invariant #9 — Privilege enforcement at every access path (REWRITTEN — crypto-enforced)
Privilege enforcement = **3 layers**:
1. **Crypto layer** — Privileged document content encrypted με per-document DDK; DDK wrapped με matter-team-scoped key. Unauthorized parties literally cannot decrypt — ciphertext useless.
2. **Application layer** — RBAC + `document_privilege` ACL + portal scope guard. Pre-decrypt rejection.
3. **Audit layer** — Every privileged-doc access (read, download, AI-context-include, portal-attempt) writes row σε `audit_privilege_access` (separate partitioned table). Forensic chain.

Documents με any `document_privilege` row WHERE `tag != 'none'` ΠΟΤΕ visible σε portal (D-API hard block), ΠΟΤΕ in Aegis AI search context outside explicit ACL, ΠΟΤΕ exported in tenant data-takeout χωρίς explicit attorney unlock.

### Invariant #10 — Greek compliance non-negotiable (UNCHANGED)
myDATA, ΔΣΑ Γραμμάτιο, ΚΠολΔ rule engine με attorney sign-off, GDPR derogation per N.4624/2019 §31.

---

## 2. TENANT ISOLATION ARCHITECTURE

### 2.1 Shared Tier (Starter + Professional)

**Single Postgres cluster** (Hetzner cx41 αρχικά → cx51 σε scale).

**Schema layout:**
```
postgres database: themis_shared
├── public.tenant_registry      -- 1 row per firm: {firm_uuid, slug, schema_name, tier, dek_ref, created_at, ...}
├── public.tenant_dek           -- envelope-encrypted DEKs (KEK = Hetzner KMS root)
├── public.shared_courts        -- read-only seed (300 most common)
├── public.shared_legal_corpus  -- read-only reference (24K νόμοι, μέσω Qdrant)
├── public.session              -- shared auth sessions με tenant scope σε JWT claim
├── firm_a1b2c3d4.party
├── firm_a1b2c3d4.matter
├── firm_a1b2c3d4.matter_party
├── firm_a1b2c3d4.document
├── firm_a1b2c3d4.invoice
├── firm_a1b2c3d4.audit_log
├── firm_e5f6g7h8.party         -- δεύτερο firm, ΟΛΟΚΛΗΡΩΣ ξεχωριστό schema
├── firm_e5f6g7h8.matter
└── ...
```

**Isolation enforcement (3 layers):**

1. **Schema-per-tenant + `search_path` middleware**
   - Fastify auth hook reads JWT → resolves `firm_uuid` → `SET LOCAL search_path = firm_<slug>, public;`
   - Καμία cross-tenant query syntactically possible — ο query optimizer βλέπει μόνο το current schema.

2. **Postgres RLS (defense-in-depth)**
   - Κάθε per-tenant table έχει RLS policy:
     ```sql
     CREATE POLICY tenant_isolation ON party
       USING (current_setting('app.firm_uuid')::uuid = '00000000-0000-0000-0000-000000000000'::uuid
              OR true);  -- ενεργοποιείται με dual session var
     ```
   - Στην πράξη, με schema-per-tenant το RLS είναι redundant στις τοπικές tables ΑΛΛΑ ενεργοποιείται για shared tables όπως `audit_log` αν επιλέξουμε hybrid.

3. **Envelope encryption per-tenant DEK**
   - Κάθε `[PII]` column wrapped: `pgp_sym_encrypt(value, dek)` όπου `dek = unwrap(tenant_dek.dek_ciphertext, KEK_ROOT)`.
   - Cross-tenant data access ΧΩΡΙΣ key compromise = ciphertext.

**Firm provisioning script (`scripts/provision_tenant.sh`):**
```
1. Generate firm_uuid (UUID v7)
2. Compute slug from firm name (kebab-case)
3. Generate per-tenant DEK, wrap με KEK_ROOT, store σε public.tenant_dek
4. Create schema firm_<slug_short>
5. Run migration set σε νέο schema (40 tables Phase 1)
6. Apply RLS policies
7. INSERT row σε public.tenant_registry
8. Provision Qdrant collection: firm_<slug_short>_documents (shared cluster)
9. R2 prefix: themis-shared-eu/<firm_uuid>/
10. Subdomain: <slug>.themis.gr (Cloudflare DNS API)
Target: <5 min end-to-end
```

### 2.2 Dedicated Tier (Firm + Enterprise)

**Provisioning Terraform module:**
- Dedicated Postgres DB: `firm_<slug>_db` σε shared cluster αρχικά (€59 tier), dedicated VM στο €99+ tier
- Dedicated Qdrant collection σε dedicated namespace
- Dedicated R2 bucket: `themis-firm-<slug>-eu`
- Dedicated KMS root key
- Dedicated nginx server_block
- DNS subdomain `<slug>.themis.gr`

**Schema:** ΙΔΙΟ structure με shared tier, αλλά **το `tenant_id` ξανά ΑΠΟΥΣΙΑΖΕΙ** (DB-per-tenant παρέχει isolation).

### 2.3 Migration Shared → Dedicated

```
Trigger: tier upgrade (manual button OR auto-suggest @ 8 active users)
1. Provision dedicated infra (Terraform)
2. pg_dump --schema=firm_<slug> --format=custom
3. Restore σε dedicated DB
4. Qdrant collection clone (snapshot API)
5. R2 prefix sync (rclone)
6. DNS swap (Cloudflare API)
7. 4h maintenance window: read-only mode στο shared, copy-and-verify, cutover
8. Reversible πρώτες 30 μέρες
```

---

## 3. PHASE 1 SCHEMA (40 TABLES)

### 3.0 Tenant infrastructure (3 tables, shared schema)

#### `public.tenant_registry`
| Column | Type | Notes |
|--------|------|-------|
| firm_uuid | UUID v7 | PK |
| slug | VARCHAR(50) | UNIQUE, lowercase, kebab-case |
| display_name | VARCHAR(255) | |
| schema_name | VARCHAR(63) | `firm_<slug_short>` (Postgres limit 63) |
| tier | ENUM | starter, professional, firm, enterprise |
| dek_ref | VARCHAR(255) | KMS reference για unwrap |
| qdrant_collection | VARCHAR(100) | |
| r2_prefix | VARCHAR(255) | |
| status | ENUM | provisioning, active, suspended, migrating, archived |
| created_at | TIMESTAMPTZ | |
| migrated_to_dedicated_at | TIMESTAMPTZ | nullable |

#### `public.tenant_dek`
| Column | Type | Notes |
|--------|------|-------|
| firm_uuid | UUID | PK FK |
| dek_ciphertext | BYTEA | wrapped με KEK_ROOT |
| dek_version | SMALLINT | rotation tracking |
| wrapped_at | TIMESTAMPTZ | |
| previous_dek_ciphertext | BYTEA | nullable, για rotation transition |

#### `public.shared_courts`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name_el | VARCHAR(255) | π.χ. "Πρωτοδικείο Αθηνών" |
| court_type | ENUM | πρωτοδικείο, εφετείο, αρειος_παγος, στε, ειρηνοδικείο, διοικητικό |
| city | VARCHAR(100) | |
| address | TEXT | |
| postal_code | VARCHAR(10) | |
| sections | JSONB | sections με schedules |
| solon_code | VARCHAR(50) | για future SOLON integration |

### 3.1 Auth & Users (per-firm schema, 4 tables)

#### `firm_X.app_user`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID v7 | PK |
| email | VARCHAR(255) | UNIQUE, `[PII]` envelope-encrypted ή blind-indexed (HMAC) |
| password_hash | VARCHAR(255) | argon2id |
| first_name | VARCHAR(100) | `[PII]` |
| last_name | VARCHAR(100) | `[PII]` |
| bar_number | VARCHAR(50) | nullable |
| bar_association | VARCHAR(50) | ΔΣΑ, ΔΣΘ, etc. |
| role | ENUM | partner, associate, paralegal, secretary, admin (4 roles Phase 1) |
| department_id | UUID | nullable, FK → department |
| hourly_rate_default | BIGINT | cents/hr |
| is_active | BOOLEAN | |
| webauthn_credential | BYTEA | nullable, για 2FA (WebAuthn) |
| totp_secret | BYTEA | nullable, fallback 2FA |
| last_login_at | TIMESTAMPTZ | |
| preferences | JSONB | |
| created_at, updated_at, deleted_at | TIMESTAMPTZ | |

#### `firm_X.session`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK |
| refresh_token_hash | VARCHAR(255) | one-time-use, family invalidation |
| ip_address | INET | |
| user_agent | TEXT | |
| created_at, expires_at | TIMESTAMPTZ | |

#### `firm_X.department`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR(100) | π.χ. "Αστικό", "Ποινικό", "Εμπορικό" |
| head_user_id | UUID | nullable FK |

#### `firm_X.firm_settings`
1 row per firm (denormalized εδώ αντί για shared `tenant.settings`).
| Column | Type | Notes |
|--------|------|-------|
| singleton_id | SMALLINT | PK CHECK = 1 |
| firm_name | VARCHAR(255) | |
| firm_afm | VARCHAR(20) | `[PII]` |
| firm_doy | VARCHAR(100) | |
| address | JSONB | `[PII]` |
| phone | VARCHAR(50) | `[PII]` |
| email | VARCHAR(255) | `[PII]` |
| logo_r2_key | VARCHAR(500) | |
| bar_association | VARCHAR(50) | |
| efka_rates | JSONB | configurable, annual update reminder (Aristotle A8) |
| holiday_overrides | JSONB | |
| invoice_prefix | VARCHAR(10) | π.χ. "INV-" |
| onboarding_completed_at | TIMESTAMPTZ | |

### 3.2 Parties (per-firm schema, 4 tables)

#### `firm_X.party`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID v7 | PK |
| type | ENUM | person, company, government, nonprofit |
| display_name | VARCHAR(255) | computed/manual canonical label |
| status | ENUM | active, inactive, deceased, dissolved |
| source | VARCHAR(100) | referral, direct, walk_in, website, lateral_hire |
| referral_source_party_id | UUID | nullable FK → party (self) |
| risk_score | SMALLINT | 0-100, AI-computed |
| is_attorney | BOOLEAN | NEW v0.3 — for `representing_counsel_party_id` validation (Aristotle L13) |
| bar_number | VARCHAR(50) | nullable, only if `is_attorney=true` |
| tags | JSONB | |
| notes | TEXT | `[PII]` |
| custom_fields | JSONB | |
| gdpr_consent_at | TIMESTAMPTZ | `[PII]` |
| gdpr_consent_type | VARCHAR(50) | |
| gdpr_pseudonymized_at | TIMESTAMPTZ | nullable, set @ erasure request |
| -- Identity | | |
| tax_id_encrypted | BYTEA | `[PII]` envelope |
| tax_id_blind_index | VARCHAR(64) | HMAC-SHA256(tax_id, blind_index_key) για searchable encryption |
| tax_office | VARCHAR(100) | |
| -- Multi-valued contact | | |
| emails | JSONB | `[PII]` array |
| email_blind_indexes | TEXT[] | HMACs για lookup |
| phones | JSONB | `[PII]` |
| addresses | JSONB | `[PII]` |
| preferred_communication_channel | ENUM | email, sms, postal, phone (Aristotle A4) |
| -- Person-specific | | |
| first_name | VARCHAR(100) | `[PII]` |
| last_name | VARCHAR(100) | `[PII]` |
| father_name | VARCHAR(100) | `[PII]` |
| birth_date | DATE | `[PII]` |
| id_number_encrypted | BYTEA | `[PII]` ΑΔΤ/passport |
| amka_encrypted | BYTEA | `[PII]` |
| -- Org-specific | | |
| org_form | VARCHAR(20) | NEW v0.3 polymorphic — discriminator |
| company_form | ENUM | AE, EPE, IKE, OE, EE, atomiki, other (only if type='company') |
| government_type | VARCHAR(50) | δήμος, περιφέρεια, υπουργείο (only if type='government') |
| nonprofit_type | VARCHAR(50) | σωματείο, ΑΜΚΕ, ΚΟΙΝΣΕΠ (only if type='nonprofit') |
| gemi_number | VARCHAR(20) | |
| vat_eligible | BOOLEAN | |
| website | VARCHAR(255) | |
| created_at, updated_at, deleted_at | TIMESTAMPTZ | |

**Indexes:**
- `(type, status)`
- `(tax_id_blind_index)` — searchable encryption pattern
- `(last_name, first_name) WHERE type='person'`
- `(gemi_number) WHERE gemi_number IS NOT NULL`
- GIN on `tags`, `custom_fields`

**Constraints (DB-level, not application):**
```sql
ALTER TABLE party ADD CONSTRAINT person_or_org CHECK (
  (type='person' AND first_name IS NOT NULL) OR
  (type='company' AND company_form IS NOT NULL) OR
  (type='government' AND government_type IS NOT NULL) OR
  (type='nonprofit' AND nonprofit_type IS NOT NULL)
);

-- Aristotle L13: bar_number requires is_attorney
ALTER TABLE party ADD CONSTRAINT attorney_has_bar CHECK (
  is_attorney = false OR bar_number IS NOT NULL
);
```

#### `firm_X.party_role`
Roles a party plays. Multiple simultaneous + historical.
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| party_id | UUID | FK |
| role | ENUM | client, supplier, partner, referral_source, opposing_party, opposing_counsel, witness, expert_witness, judge, court_clerk, mediator, arbitrator, guarantor, interpreter, bailiff, notary, attorney, other |
| active_from | DATE | nullable |
| active_until | DATE | nullable (NULL = currently active) |
| notes | TEXT | |

#### `firm_X.party_relationship`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| party_a_id, party_b_id | UUID | FKs |
| relationship_type | ENUM | spouse, parent, child, sibling, employer, employee, shareholder, director, legal_rep, co_owner, business_partner, counterparty, other |
| active_from, active_until | DATE | |
| notes | TEXT | |

#### `firm_X.party_group` + `party_group_member`
Lite version (Phase 1 read-only UI; full editor Phase 1.5).

### 3.3 Matters (per-firm schema, 5 tables)

#### `firm_X.matter`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID v7 | PK |
| code | VARCHAR(50) | UNIQUE per firm, π.χ. "2026/001" |
| title | VARCHAR(500) | `[PII]` |
| description | TEXT | `[PII]` |
| practice_area | VARCHAR(100) | civil, criminal, administrative, commercial, labor, family |
| matter_type | VARCHAR(100) | lawsuit, appeal, advisory, transactional |
| status | ENUM | intake, active, on_hold, closed, archived |
| stage_id | UUID | FK → matter_stage, nullable |
| priority | ENUM | low, normal, high, urgent |
| responsible_user_id | UUID | FK |
| department_id | UUID | nullable FK (Firm tier feature, soft-isolation) |
| billing_method | ENUM | hourly, flat_fee, contingency, mixed, pro_bono |
| flat_fee_amount | BIGINT | cents |
| contingency_pct | DECIMAL(5,2) | |
| budget_amount | BIGINT | nullable |
| court_id | UUID | nullable FK → public.shared_courts |
| court_case_number | VARCHAR(100) | |
| court_filing_date | DATE | |
| statute_of_limitations | DATE | |
| sol_type | VARCHAR(100) | AK_249, AK_250 |
| ethical_wall | BOOLEAN | Phase 1 = always false (Enterprise feature). Schema present για forward-compat |
| legal_hold | BOOLEAN | |
| opened_at | TIMESTAMPTZ | |
| closed_at | TIMESTAMPTZ | nullable. **Trigger** keeps in sync με `status='closed'` (Aristotle L12) |
| custom_fields | JSONB | |
| tags | TEXT[] | |
| created_at, updated_at, deleted_at | TIMESTAMPTZ | |

> **NO `client_id`, NO `tenant_id`** (Invariants #1, #2, #6).

**Trigger για L12 fix:**
```sql
CREATE FUNCTION sync_matter_closed_at() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'closed' AND NEW.closed_at IS NULL THEN
    NEW.closed_at := NOW();
  ELSIF NEW.status != 'closed' AND OLD.status = 'closed' THEN
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### `firm_X.matter_party`
Implements Invariant #2.
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK |
| party_id | UUID | FK |
| role | ENUM | primary_client, co_client, opposing, witness, expert, judge, opposing_counsel, court_clerk, mediator, guarantor, beneficiary, heir, other |
| side | ENUM | ours, opposing, neutral, unknown |
| representation_status | ENUM | represented_by_us, represented_by_other, self_represented, unrepresented, unknown |
| representing_counsel_party_id | UUID | nullable FK → party. **CHECK** ref party `is_attorney=true` (Aristotle L13) |
| joined_at | TIMESTAMPTZ | |
| left_at | TIMESTAMPTZ | nullable |
| billing_split_percentage | DECIMAL(5,2) | nullable, 0-100 |
| is_primary_contact | BOOLEAN | DEFAULT false |
| notes | TEXT | `[PII]` |

**DB-level constraints (Aristotle L5, L6):**
```sql
-- L5: partial unique index για is_primary_contact
CREATE UNIQUE INDEX uq_matter_party_primary_contact
  ON matter_party (matter_id, side)
  WHERE is_primary_contact = TRUE AND left_at IS NULL;

-- L6: trigger για billing_split_percentage SUM = 100
CREATE FUNCTION validate_billing_split() RETURNS TRIGGER AS $$
DECLARE
  total DECIMAL;
  matter_id_check UUID;
BEGIN
  matter_id_check := COALESCE(NEW.matter_id, OLD.matter_id);
  SELECT SUM(billing_split_percentage) INTO total
  FROM matter_party
  WHERE matter_id = matter_id_check
    AND side = 'ours'
    AND billing_split_percentage IS NOT NULL
    AND left_at IS NULL;

  IF total IS NOT NULL AND total != 100 THEN
    RAISE EXCEPTION 'BILLING_SPLIT_INVALID: sum=% != 100 for matter %', total, matter_id_check;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_billing_split
  AFTER INSERT OR UPDATE OR DELETE ON matter_party
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_billing_split();
```

#### `firm_X.matter_stage`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| practice_area | VARCHAR(100) | |
| name | VARCHAR(100) | |
| order_index | INTEGER | |
| color | VARCHAR(7) | |

> **`auto_tasks JSONB` REMOVED** (Aristotle L10) — Phase 1 hardcodes 3 stage transitions για civil-claim flow only. Phase 2 reintroduces με workflow engine.

#### `firm_X.matter_member`
M2M user ↔ matter.
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id, user_id | UUID | FKs |
| role | ENUM | lead, associate, paralegal, reviewer |
| hourly_rate_override | BIGINT | nullable |
| assigned_at | TIMESTAMPTZ | |

#### `firm_X.related_matter`
| matter_id | UUID | FK |
| related_matter_id | UUID | FK |
| relation_type | VARCHAR(50) | appeal_of, consolidated, related |

### 3.4 Calendar & Deadlines (4 tables)

#### `firm_X.calendar_event`
Events. Deadlines + hearings αναφέρονται εδώ optionally για display unification (Aristotle S4 fix).

#### `firm_X.hearing`
Court hearings. **`anticletoi_party_ids UUID[]`** (Aristotle E13 fix — multiple anticletoi support). `bar_stamp_id` nullable.

#### `firm_X.deadline`
Legal deadlines.

#### `firm_X.deadline_rule`
KPolD rules (top 30 Phase 1, externally signed off — Aristotle Top-10 fix #5).
| Column | Type | Notes |
|--------|------|-------|
| ... | ... | ως v0.2 |
| validated_by_attorney | VARCHAR(255) | NOT NULL |
| validated_at | DATE | NOT NULL |
| validated_signature_r2_key | VARCHAR(500) | scanned PDF προσαρτημένος ως evidence |
| revalidation_due | DATE | annual re-validation |

### 3.5 Documents (3 tables)

#### `firm_X.document`
Files σε R2, metadata σε Postgres.
| Column | Type | Notes |
|--------|------|-------|
| ... | ως v0.2 ... | |
| ocr_quality_score | DECIMAL(3,2) | NULL αν δεν έχει OCR-αριθεί |
| ocr_status | ENUM | pending, processing, succeeded, failed_low_quality, failed_error (Aristotle A2) |
| ~~privilege_tag~~ | — | **REMOVED v0.3** — superseded by `document_privilege` table (D-DM-16, see §8) |
| ~~visible_to_party_ids~~ | — | **REMOVED v0.3** — moved to `document_privilege.visible_to_party_ids` (granular ACL) |
| storage_mode | ENUM | NEW v0.3: `r2_sse_c` (non-privileged, R2-managed encryption με DEK_FIRM), `ddk_aes_gcm` (privileged, content encrypted by us με DDK before R2 upload). Determines decrypt path |

#### `firm_X.document_version`
Version history.

#### `firm_X.document_template`
Phase 1: 5 system templates (αγωγή, εξώδικο, πληρεξούσιο, εντολή, αίτηση ασφαλιστικών). Firm-shared. Variables JSONB.

### 3.6 Time & Billing (5 tables)

#### `firm_X.time_entry`
| Column | Type | Notes |
|--------|------|-------|
| ... | ... | |
| rate_amount | BIGINT | **snapshot at INSERT** (Aristotle L17). Comment: "Computed from rate_card resolution at create time. NOT live lookup." |
| rate_change_audit | JSONB | nullable, αν admin override σε existing entry |

#### `firm_X.timer`
| Column | Type | Notes |
|--------|------|-------|
| ... | ... | |
| status | ENUM | running, paused, stopped |

**Aristotle E16 fix — single active timer per user:**
```sql
CREATE UNIQUE INDEX uq_active_timer_per_user
  ON timer (user_id) WHERE status IN ('running', 'paused');
```

#### `firm_X.rate_card`
Phase 1 UI exposes only `firm_default + per_attorney`. Schema supports per-matter override (Firm tier).

#### `firm_X.invoice`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID v7 | PK |
| invoice_number | VARCHAR(50) | UNIQUE per (year, prefix), Postgres SEQUENCE |
| version | INTEGER | DEFAULT 1, optimistic locking (Aristotle F7) |
| bill_to_party_id | UUID | FK. **Application validation:** party must hold active `client` role (Aristotle L15) |
| matter_id | UUID | nullable FK |
| type | ENUM | invoice, credit_note, proforma |
| doc_type | ENUM | da, apy |
| ... | ... | |

#### `firm_X.payment`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| invoice_id | UUID | FK |
| amount | BIGINT | cents |
| received_at | TIMESTAMPTZ | |
| method | ENUM | bank_transfer, cash, card_stripe, card_viva, other |
| external_ref | VARCHAR(255) | Stripe charge ID, IBAN ref |
| idempotency_key | VARCHAR(64) | UNIQUE, για exactly-once |

### 3.7 Greek Compliance (3 tables)

#### `firm_X.mydata_record`
Each invoice transmission to AADE.
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| invoice_id | UUID | FK |
| content_hash | VARCHAR(64) | SHA-256 του XML payload, για idempotency (Aristotle F8) |
| mark | VARCHAR(50) | nullable, set when AADE returns MARK |
| status | ENUM | pending, transmitted, accepted, rejected |
| rejection_reason | TEXT | |
| transmitted_at, acknowledged_at | TIMESTAMPTZ | |
| retry_count | SMALLINT | |

**UNIQUE constraint** για exactly-once: `UNIQUE(invoice_id, content_hash) WHERE status != 'rejected'`.

#### `firm_X.bar_stamp`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| matter_id | UUID | FK |
| hearing_id | UUID | nullable FK |
| amount_cents | BIGINT | |
| status | ENUM | issued, used, refunded, cancelled (Aristotle E12) |
| issued_at | DATE | |
| dsa_receipt_number | VARCHAR(50) | |

#### `firm_X.bar_rate_config`
Schema present, Phase 1 hardcoded to ΔΣΑ Athens rates. UI editor Phase 1.5.

### 3.8 Conflict Check (1 table)

#### `firm_X.conflict_check`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| triggered_by | ENUM | new_party, new_matter, role_change, lateral_hire, post_engagement_discovery (Aristotle E3) |
| matter_id | UUID | nullable |
| party_id | UUID | nullable |
| performed_at | TIMESTAMPTZ | |
| performed_by_user_id | UUID | |
| matches | JSONB | array of {matched_party_id, score, reason, related_matter_ids} |
| outcome | ENUM | clear, conflict_blocking, conflict_waivable, waived |
| waiver_document_id | UUID | nullable |
| waived_by_user_id | UUID | nullable |
| waived_at | TIMESTAMPTZ | nullable |

### 3.9 Audit & Compliance (3 tables)

#### `firm_X.audit_log`
Append-only. Partitioned monthly.
| Column | Type | Notes |
|--------|------|-------|
| id | UUID v7 | PK |
| timestamp | TIMESTAMPTZ | partition key |
| actor_id | UUID | nullable (system) |
| actor_type | ENUM | user, system, aegis, scheduled_job |
| action | VARCHAR(100) | create, update, delete, export, login, ... |
| resource_type | VARCHAR(100) | |
| resource_id | UUID | |
| changes | BYTEA | **envelope-encrypted** JSONB με tenant DEK (Aristotle L11). Αν χαθεί DEK → key-shredding erasure |
| changes_summary | TEXT | redacted, no PII (για quick admin review) |
| ip_address | INET | |
| user_agent | TEXT | |
| outcome | ENUM | success, denied, error |
| pseudonymized_at | TIMESTAMPTZ | nullable, set @ retention threshold |

**Retention policy (cron job, daily):**
- Financial audit entries (resource_type IN invoice, payment, mydata_record, bar_stamp): pseudonymize at 20 years
- Non-financial: pseudonymize at 5 years
- Pseudonymization = NULL out `actor_id`, set `changes` = NULL, `changes_summary` = '[pseudonymized per N.4624/2019 §31]'

#### `firm_X.gdpr_request`
Tracks Article 15 (access), 17 (erasure), 20 (portability) requests.

#### `firm_X.kms_audit`
Every DEK unwrap operation logged. Detects abnormal access patterns.

### 3.10 Misc Phase 1 essentials (2 tables)

#### `firm_X.task`
Lite tasks linked to matters. Phase 1 simple. Workflow engine = Phase 2.

#### `firm_X.notification`
In-app notifications. Email delivery via BullMQ.

---

## 4. PII ENCRYPTION DETAIL

### 4.1 Envelope encryption flow

```
KEK_ROOT (per-tier):
  Shared tier: shared Hetzner KMS root key (1 key for entire shared cluster)
  Dedicated tier: per-firm KMS root key

DEK (per firm):
  Generated at provisioning
  Stored wrapped: dek_ciphertext = AES-256-GCM-Wrap(DEK, KEK_ROOT)
  Cached in process memory after unwrap (TTL 15 min)

Per-row encryption:
  ciphertext = AES-256-GCM-Encrypt(plaintext, DEK, IV=row_uuid_first_12_bytes)
  Stored as BYTEA

Lookup pattern (searchable encryption):
  blind_index = HMAC-SHA256(plaintext.lowercase(), BLIND_INDEX_KEY)
  Stored alongside ciphertext
  Search: WHERE field_blind_index = HMAC(query)
  ONLY exact match. No prefix/range search σε encrypted fields.
```

### 4.2 PII columns inventory

| Table | Columns |
|-------|---------|
| `app_user` | email, first_name, last_name, password_hash (already hashed), webauthn_credential, totp_secret |
| `firm_settings` | firm_afm, address, phone, email |
| `party` | tax_id_encrypted, emails, phones, addresses, first_name, last_name, father_name, birth_date, id_number_encrypted, amka_encrypted, notes |
| `matter` | title, description |
| `matter_party` | notes |
| `document` | (file content σε R2 — non-privileged: SSE-C με DEK_FIRM; privileged: AES-256-GCM με per-doc DDK, see §8) |
| `document_privilege` | ddk_wrapped (BYTEA, key material — never log) |
| `time_entry` | description |
| `audit_log` | changes |
| `audit_privilege_access` | acl_snapshot (JSONB carries party UUIDs — encrypted at table level Phase 1.5) |

### 4.3 Key shredding for GDPR Article 17

Όταν firm cancels:
1. Move firm to `archived` status
2. After 30-day grace period (reversible cancellation): destroy DEK
3. Όλα τα ciphertext fields γίνονται μηδενικά (cannot decrypt)
4. Audit log entry για destruction
5. Schema παραμένει για 5 years (statute of limitations για malpractice claims), αλλά practically anonymized

---

## 5. INDEXES & PERFORMANCE

### 5.1 Critical indexes

```sql
-- Conflict check at scale (Aristotle H4 — Greek phonetic)
CREATE INDEX idx_party_phonetic ON party USING gin (
  to_tsvector('simple', last_name || ' ' || first_name)
);
CREATE INDEX idx_party_lastname_trigram ON party USING gin (last_name gin_trgm_ops);

-- Matter lookup
CREATE INDEX idx_matter_responsible ON matter (responsible_user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_matter_court_case ON matter (court_case_number) WHERE court_case_number IS NOT NULL;

-- Time entry billing aggregation
CREATE INDEX idx_time_entry_matter_billing ON time_entry (matter_id, billing_status, date);

-- Audit log time range queries
CREATE INDEX idx_audit_log_resource ON audit_log (resource_type, resource_id, timestamp DESC);
```

### 5.2 Partitioning

- `audit_log`: monthly partitions, retain hot 12 months, archive cold
- `time_entry`: yearly partitions
- `notification`: monthly partitions, drop after 90 days
- `mydata_record`: NOT partitioned Phase 1 (low volume)

### 5.3 Scale targets Phase 1

| Tier | Max users | Max parties | Max matters | DB size estimate |
|------|-----------|-------------|-------------|-------------------|
| Starter | 1 | 5K | 200 | <50 MB |
| Professional | 8 | 20K | 2K | <500 MB |
| Firm | 30 | 50K | 10K | <5 GB |
| Enterprise | 100 | 200K | 50K | <50 GB |

Aristotle E14 (1TB scale) is Phase 3 concern.

---

## 6. REMOVED FROM v0.2 (cut σε Phase 1)

| Table | v0.3 fate | Reason |
|-------|-----------|--------|
| `portal_user`, `portal_session`, `portal_invitation`, `portal_message`, `portal_signature_request` | **Phase 1.5 Sprint 11-12 (read-only lite), Phase 2 full** | Sunday §2.G addition (back in Sprint 11-12) — BUT only `portal_user` + minimal read views Phase 1 |
| `email_account`, `email_message`, `email_classification` | Phase 1.5 (manual forwarder Phase 1) | Sunday §2.G |
| `time_capture_event`, `time_capture_session` | Phase 3 (Electron app) | Pericles §2 + Sunday §2.G |
| `aped_signature_request`, `aped_oauth_token` | Phase 1.5 (manual link Phase 1) | Sunday §2.G |
| `solon_filing`, `solon_oauth_token` | Phase 1.5 wrapper | Sunday §2.G |
| `trust_account`, `trust_transaction`, `trust_reconciliation` | Phase 1.5 (Firm tier) | Sunday §2.G |
| `report_dashboard`, `saved_query`, `nl_query_run` | Phase 1 = 3 hardcoded dashboards (no schema). Schema Phase 2 | Sunday §2.G + Pericles §2 |
| `workflow_definition`, `workflow_run` | Phase 2 | Pericles §2 |
| `lead`, `consultation`, `engagement_letter` | Phase 1.5 (full intake CRM) | Pericles §2 |
| `expense` | Phase 1 keeps minimal table (only essentials) | — |

**Net Phase 1: 40 tables** (από 68).

> **Note:** Με την προσθήκη §8 (Privilege Architecture, D-DM-16..19), ο πραγματικός Phase 1 count = **43 tables** (+3: `document_privilege`, `audit_privilege_access`, `kms_custody_share`). Δομικά παραμένει "40 core" + 3 cross-cutting privilege tables. Δεν αλλάζει η scope-cut λογική.

---

## 8. PRIVILEGE ARCHITECTURE (NEW v0.3)

> **Driver:** Aristotle E9 (joint defense per-co-client granularity), F3 (KMS rotation/loss/custody chain), Sunday §2.F (Greek sovereignty as marketing differentiator), Invariant #9 hardening from "enforcement at access paths" → "cryptographically enforced".
> **Spec authority:** D-DM-16, D-DM-17, D-DM-18, D-DM-19. Awaits Niko sign-off.
> **Scope:** Phase 1 ships crypto layer + application layer + audit layer for Pro+. Starter tier ships application+audit only (DDK skipped, document encrypted at column level only) — explicit downgrade τεκμηριωμένο σε ToS.

### 8.1 Threat model

| Threat | v0.2 mitigation | v0.3 mitigation |
|--------|-----------------|------------------|
| Insider (paralegal) reads partner-only privileged doc | RBAC | RBAC + DDK wrap excludes paralegal team key (cryptographic) |
| Co-client A's lawyer-only memo accidentally exposed σε co-client B | `joint_defense` ENUM (coarse) | `document_privilege.visible_to_party_ids[]` ACL + DDK wrap excludes B (cryptographic) |
| DB compromise (Postgres ciphertext exfiltration) | Plaintext PII column-encrypted | Document content + privilege tags + audit changes ALL envelope-encrypted; no plaintext privilege metadata at rest |
| KMS root key compromise (insider, Hetzner staff, lawful intercept) | Single shared root | Tier-dependent: shared root (Pro), dedicated key (Firm), **BYOK Shamir 3-of-5** (Enterprise — Hetzner alone cannot decrypt) |
| Forced disclosure / lawful intercept of tenant data | Implicit | Audit chain proves what was accessed; Shamir custody requires firm-side share holders → defense in court |
| Subpoena requesting "all privileged docs" | Manual review | `audit_privilege_access` provides forensic export; firm controls DDK release |
| GDPR Art.17 erasure σε privileged matter | Full schema delete | DDK destruction = cryptographic erasure (key shredding); audit row preserved (encrypted, unreadable) |

### 8.2 Key hierarchy

```
TIER: STARTER (€19) + PROFESSIONAL (€39)
  KEK_ROOT_SHARED  (Hetzner KMS, Helsinki region)
        ↓ wraps
  DEK_FIRM_<uuid>  (per-tenant, public.tenant_dek)
        ↓ wraps (column-level for [PII] fields)
  ciphertext fields in BYTEA columns
        ↓ wraps (NEW v0.3 for documents only)
  DDK_DOC_<uuid>   (per-document data key, document_privilege.ddk_wrapped)
        ↓ AES-256-GCM encrypts
  document content blob in R2 (SSE-C-style with our DDK)

TIER: FIRM (€59)
  KEK_ROOT_DEDICATED_<firm>  (Hetzner KMS, dedicated key per firm)
        ↓ wraps DEK_FIRM_<uuid>
  [rest identical to Pro tier]

TIER: ENTERPRISE (€79+) — BYOK opt-in
  KEK_ROOT_BYOK_<firm>  (firm-supplied master, never plaintext on Hetzner)
        Custody: Shamir Secret Sharing 3-of-5
          Share #1: firm managing partner (hardware token / sealed envelope)
          Share #2: firm IT/operations lead
          Share #3: external trusted party (e.g., firm's outside counsel)
          Share #4: ΘΕΜΙΣ OS escrow (sealed, time-locked)
          Share #5: Greek notary (sealed envelope)
        Reconstruction: any 3 shares; logged σε kms_custody_share + Greek notary timestamp
  Online operations: KEK held in HSM-backed Hetzner KMS bound to firm's BYOK; rotation = firm initiated
  ↓ wraps DEK_FIRM_<uuid>
  [rest identical]
```

### 8.3 Schema additions (3 new tables)

#### `firm_X.document_privilege`
Replaces v0.2 `document.privilege_tag` ENUM. Granular per-document privilege ACL + DDK wrap.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID v7 | PK |
| document_id | UUID | FK, UNIQUE (1:1 με document) |
| tag | ENUM | none, attorney_client, work_product, joint_defense, common_interest, mediation_privileged |
| classification_basis | ENUM | manual, ai_inferred, template_default |
| ddk_wrapped | BYTEA | per-document data key wrapped με DEK_FIRM (Pro+) ή matter-team key (Firm+) |
| ddk_version | SMALLINT | rotation tracking |
| visible_to_party_ids | UUID[] | nullable. NULL = all matter_party (side='ours'); set = restrict (Aristotle E9 fix) |
| visible_to_user_ids | UUID[] | nullable. Override για restricted internal access (e.g., partner-only memo) |
| visible_to_team_ids | UUID[] | nullable. Phase 1.5 — team-scoped privilege |
| portal_visible | BOOLEAN | DEFAULT false. Hard NEVER true if tag != 'none' (DB CHECK) |
| ai_context_eligible | BOOLEAN | DEFAULT false. Aegis MUST exclude unless explicit ACL grant |
| classified_at | TIMESTAMPTZ | |
| classified_by_user_id | UUID | nullable (system if AI-inferred) |
| review_required | BOOLEAN | DEFAULT false. Pending attorney review for AI-inferred classifications |
| reviewed_by_user_id | UUID | nullable |
| reviewed_at | TIMESTAMPTZ | nullable |

**DB-level constraints:**
```sql
ALTER TABLE document_privilege ADD CONSTRAINT privilege_portal_block CHECK (
  NOT (portal_visible = TRUE AND tag != 'none')
);

ALTER TABLE document_privilege ADD CONSTRAINT privilege_ai_block CHECK (
  NOT (ai_context_eligible = TRUE AND tag != 'none' AND classification_basis = 'ai_inferred' AND review_required = TRUE)
);

CREATE UNIQUE INDEX uq_document_privilege ON document_privilege (document_id);
```

> **Migration note:** v0.2 `document.privilege_tag` column is dropped. Phase 1 documents auto-create `document_privilege` row με `tag='none'` for non-privileged docs (no DDK overhead). Privileged docs get DDK at upload time.

#### `firm_X.audit_privilege_access`
Append-only, partitioned monthly. Separate από `audit_log` για:
- Faster forensic queries χωρίς full audit_log scan
- Different retention (privilege access = 20 years per N.4194/2013 attorney professional records)
- Subpoena-ready export format

| Column | Type | Notes |
|--------|------|-------|
| id | UUID v7 | PK |
| timestamp | TIMESTAMPTZ | partition key (monthly) |
| document_id | UUID | FK |
| document_privilege_id | UUID | FK (snapshot of privilege state at access time) |
| privilege_tag_at_access | VARCHAR(50) | denormalized snapshot |
| accessor_user_id | UUID | nullable |
| accessor_type | ENUM | user, aegis_agent, portal_user, system, scheduled_job, api_client |
| access_method | ENUM | read_metadata, download, ai_context_include, portal_attempt_blocked, export_attempt, share_link_generated |
| access_outcome | ENUM | granted, denied_acl, denied_crypto, denied_portal, denied_review_pending |
| ddk_unwrap_performed | BOOLEAN | TRUE only if outcome=granted AND access_method ∈ (download, ai_context_include) |
| ip_address | INET | |
| user_agent | TEXT | |
| trace_id | VARCHAR(64) | correlation με audit_log |
| matter_id | UUID | denormalized για forensic filter |
| acl_snapshot | JSONB | snapshot των visible_to_* arrays at access time |

**Indexes:**
```sql
CREATE INDEX idx_apa_doc_time ON audit_privilege_access (document_id, timestamp DESC);
CREATE INDEX idx_apa_accessor ON audit_privilege_access (accessor_user_id, timestamp DESC);
CREATE INDEX idx_apa_outcome ON audit_privilege_access (access_outcome) WHERE access_outcome != 'granted';
CREATE INDEX idx_apa_matter ON audit_privilege_access (matter_id, timestamp DESC);
```

**Retention:** 20 years (N.4194/2013 §38 — δικηγορικό απόρρητο). NO pseudonymization on this table — full audit chain required for malpractice defense + bar association inquiries. Pseudonymization μόνο επί firm cancellation + key-shredding (cryptographic erasure).

#### `public.kms_custody_share` (Enterprise BYOK only)
Tracks Shamir custody shares without storing the share material. Storage of share material = OUT OF SCOPE (firm responsibility, sealed envelopes / hardware tokens).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| firm_uuid | UUID | FK → tenant_registry |
| share_index | SMALLINT | 1-5 |
| share_holder_type | ENUM | firm_partner, firm_it, external_trusted, themis_escrow, greek_notary |
| share_holder_identity | VARCHAR(255) | name + role (no contact PII) |
| share_holder_contact_hash | BYTEA | HMAC of contact (recovery only) |
| custody_method | ENUM | sealed_envelope, hardware_token, escrow_service, notary_seal |
| activated_at | TIMESTAMPTZ | |
| revoked_at | TIMESTAMPTZ | nullable |
| last_recovery_drill_at | TIMESTAMPTZ | nullable. Quarterly drill recommended |
| greek_notary_act_number | VARCHAR(100) | nullable, for notary-held shares |

**Reconstruction event log:** ξεχωριστό `kms_custody_reconstruction` table (Phase 2 — Phase 1 hardcoded process: manual + Niko approval gate). Phase 1 ships table σε read-only state, reconstruction is ops procedure documented στο `runbooks/kms-recovery.md`.

### 8.4 Write path (privileged document upload)

```
1. Client uploads document (multipart) → POST /api/v1/documents/upload
2. Server detects classification (manual flag OR Αναγνώστης AI inference)
3. IF privileged:
   a. Generate DDK = AES-256-GCM 256-bit key (CSPRNG)
   b. Determine wrap key:
      - Pro tier: wrap_key = DEK_FIRM (cached unwrapped 15min)
      - Firm tier: wrap_key = matter_team_subkey (derived: HKDF(DEK_FIRM, matter_id || team_id))
      - Enterprise BYOK: wrap_key = matter_team_subkey derived from BYOK-rooted DEK
   c. ddk_wrapped = wrap(DDK, wrap_key)
   d. Encrypt content: ciphertext = AES-256-GCM-Encrypt(content, DDK, IV=document_uuid_first_12)
   e. Upload ciphertext σε R2 (NO server-side encryption needed — already encrypted)
   f. INSERT document_privilege με tag, ddk_wrapped, visible_to_*, classification_basis
   g. INSERT audit_privilege_access με access_method='write', outcome='granted', ddk_unwrap_performed=false
4. ELSE (non-privileged):
   a. Standard column-level encryption για [PII] fields
   b. Document content uploaded με R2 SSE-C using DEK_FIRM
   c. INSERT document_privilege με tag='none', ddk_wrapped=NULL
```

### 8.5 Read path (privileged document download)

```
1. GET /api/v1/documents/:id/download
2. Application layer:
   a. Resolve user → user_id, role, team_ids
   b. Load document_privilege WHERE document_id = :id
   c. IF tag = 'none' → standard download path (R2 SSE-C decrypt)
   d. IF tag != 'none':
      i.   IF portal_user → 403 PORTAL_PRIVILEGE_BLOCKED + audit row (denied_portal)
      ii.  IF visible_to_user_ids set AND user_id NOT IN list → 403 PRIVILEGE_ACL_DENIED + audit (denied_acl)
      iii. IF visible_to_party_ids set AND user's matter_party.party_id NOT IN list → 403 + audit
      iv.  IF review_required = TRUE AND user is not classifier+approver → 403 PRIVILEGE_REVIEW_PENDING
3. Crypto layer:
   a. Determine wrap key (per tier — see §8.4)
   b. DDK = unwrap(document_privilege.ddk_wrapped, wrap_key)
   c. IF unwrap fails (key rotated, tier downgrade) → 503 PRIVILEGE_KEY_UNAVAILABLE + audit (denied_crypto)
4. Fetch ciphertext from R2
5. Decrypt: plaintext = AES-256-GCM-Decrypt(ciphertext, DDK, IV)
6. INSERT audit_privilege_access με outcome='granted', ddk_unwrap_performed=true
7. Stream plaintext σε client (server-side temp buffer destroyed post-stream)
```

### 8.6 AI context inclusion path

Aegis agents (especially Ερευνητικός + Συγγράμματος) MUST query `document_privilege.ai_context_eligible` before including any document chunk σε LLM prompt:

```python
def build_context(matter_id, query):
    docs = qdrant.search(query, filter={"matter_id": matter_id})
    eligible = []
    for doc in docs:
        privilege = db.fetch("SELECT * FROM document_privilege WHERE document_id = %s", doc.id)
        if privilege.tag == 'none' or privilege.ai_context_eligible:
            eligible.append(doc)
            audit_privilege_access.insert(
                document_id=doc.id, accessor_type='aegis_agent',
                access_method='ai_context_include', outcome='granted'
            )
        else:
            audit_privilege_access.insert(
                document_id=doc.id, accessor_type='aegis_agent',
                access_method='ai_context_include', outcome='denied_acl'
            )
    return eligible
```

**Embedding policy:** Privileged documents (tag != 'none') are embedded σε per-firm Qdrant collection με metadata `privilege=true`, αλλά NEVER returned για search outside owner team. Vector itself does not leak content (BAAI/bge-m3 768d → ~irreversible), αλλά policy: **opt-in encryption of vectors at rest** (Phase 1.5) για zero-trust posture.

### 8.7 Key rotation procedure (Aristotle F3 fix)

**Trigger scenarios:**
1. Scheduled rotation (annual, configurable per tier)
2. Suspected compromise (immediate)
3. Personnel change (BYOK Shamir share holder departure)
4. Tier upgrade/downgrade

**Rotation flow (DEK level):**
```
1. Generate DEK_NEW
2. Wrap DEK_NEW με KEK_ROOT (current)
3. UPDATE public.tenant_dek SET previous_dek_ciphertext = dek_ciphertext, dek_ciphertext = wrap(DEK_NEW, KEK)
4. Background job (BullMQ queue: kms-rotation):
   For each row in [PII] columns + each document_privilege.ddk_wrapped:
     a. Decrypt με DEK_OLD (from previous_dek_ciphertext)
     b. Re-encrypt με DEK_NEW
     c. Update row
5. Verification pass: random 1% sample re-decrypt
6. CLEAR previous_dek_ciphertext after 7-day grace period
7. INSERT audit_log entry per resource type (aggregate counts)
```

**Estimated rotation time:** 50K parties + 10K matters + 100K documents (Firm tier) ≈ 4-6 hours background job. Online (no downtime).

**Rotation flow (KEK level — BYOK Enterprise):**
1. Reconstruct old BYOK from 3-of-5 Shamir shares (operational)
2. Firm generates new BYOK
3. Re-wrap DEK_FIRM με KEK_NEW
4. Distribute new Shamir shares (custody chain repeats §8.2 process)
5. INSERT kms_custody_share rows (mark old SET revoked_at)
6. NOTARY notarized event (Greek notary act for forensic trail)

### 8.8 Tier degradation matrix

| Tier | Crypto privilege | App privilege | Audit | Notes |
|------|------------------|---------------|-------|-------|
| Starter (€19) | No (skip DDK) | Yes (RBAC + ACL) | Yes (audit_privilege_access) | Solo, single-user, low risk; documented in ToS |
| Professional (€39) | Yes (DDK wrapped με DEK_FIRM) | Yes | Yes | Default for 2-8 user firms |
| Firm (€59) | Yes + matter_team subkeys | Yes + per-team ACL | Yes | Departments + ethical walls |
| Enterprise (€79+) | Yes + BYOK Shamir 3-of-5 | Yes | Yes + notary timestamping option | High-stakes firms, sovereignty marketing |

### 8.9 Marketing claim validation (Sunday §2.F)

Public claim: **"Crypto-enforced attorney-client privilege — your privileged docs encrypted με keys που ούτε εμείς δεν μπορούμε να ξεκλειδώσουμε χωρίς εσάς (Enterprise BYOK)."**

Validation:
- Pro tier: TRUE within trust boundary (Hetzner KMS shared root). FALSE absolute (Hetzner can theoretically unlock). ToS discloses.
- Firm tier: TRUE within trust boundary (dedicated KMS root). Same caveat.
- Enterprise BYOK: TRUE absolute. Hetzner alone cannot reconstruct without 3 of 5 shares which firm controls.

Marketing must distinguish tiers explicitly. NO "your data is mathematically yours" blanket claim.

---

## 9. OPEN QUESTIONS FOR NIKO/SUNDAY

1. **Q-DM-1: Searchable encryption tradeoff.** Blind-index με HMAC επιτρέπει μόνο exact match. Για phonetic conflict check σε 50K parties, χρειάζεται plaintext index σε `last_name`/`first_name` (acceptable risk;) ή delegated search σε external secure enclave (overkill);
   **Δαίδαλος recommendation:** Phase 1 keep `last_name`/`first_name` plaintext-indexed (encrypted at column level still, αλλά indexed plaintext) με risk acceptance σε ToS. Revisit Phase 2 αν enterprise client requires.

2. **Q-DM-2: `org_form` polymorphic.** Πραγματικά χρειαζόμαστε `government_type` και `nonprofit_type` σε Phase 1; Σπάνια firms χειρίζονται government clients, και όταν το κάνουν "other" αρκεί.
   **Δαίδαλος recommendation:** Keep schema (cheap). Hide UI dropdown για government/nonprofit Phase 1. Re-enable Phase 1.5.

3. **Q-DM-3: Audit log encryption performance.** Encrypt-on-write στο `changes JSONB` adds ~5-10ms per write. Σε high-volume firms (50 users × 100 actions/day = 5K writes/day), 25-50s total daily overhead. Acceptable, αλλά worth confirming.
   **Δαίδαλος recommendation:** Keep encrypted Phase 1. Bench at Sprint 4.

4. **Q-DM-4: Multi-region failover.** Hetzner Helsinki + Falkenstein για redundancy; Cost ~2x. Phase 1 single-region acceptable;
   **Δαίδαλος recommendation:** Single-region Phase 1 (Helsinki). Document RPO 15min, RTO 4h. Add multi-region σε Phase 1.5 αν first 10 firms request.

5. **Q-DM-5: Naming.** Τα schemas ονομάζονται `firm_<slug_short>`. Αν renaming product (π.χ. ΛΥΚΟΥΡΓΟΣ), το schema name παραμένει `firm_*` (όχι `lykourgos_*`). OK;
   **Δαίδαλος recommendation:** YES — `firm_*` είναι rename-safe. Product name μόνο σε env vars + UI labels.

6. **Q-DM-6: Hetzner KMS readiness.** Hetzner Cloud δεν έχει native managed KMS service (όπως AWS KMS / GCP KMS / Azure Key Vault). Phase 1 options:
   (a) Self-host **HashiCorp Vault** σε dedicated Hetzner CX VM (€7/μήνα) με Postgres backend + auto-unseal via cloud-init secret;
   (b) Use **AWS KMS Frankfurt region** (EU residency satisfied, αλλά Sunday §2.F sovereignty story αλλάζει — "EU but US vendor");
   (c) Defer Enterprise BYOK σε Phase 1.5, ship Pro/Firm με Vault Phase 1.
   **Δαίδαλος recommendation:** Path (a) — self-hosted Vault σε dedicated VM. Cost €7/μήνα, full sovereignty story intact, Shamir support native (Vault `vault operator init -key-shares=5 -key-threshold=3`). Sprint 1 ops investment: ~1 day setup + auto-unseal hardening. **Risk:** if we lose Vault root unseal keys, all tenants down. Mitigation: 5-of-9 Shamir for Vault unseal itself (different from per-tenant BYOK), shares distributed Niko + 4 Shamir guardians.

7. **Q-DM-7: Shamir custody opt-in flow UX.** Enterprise tier sales conversation: "your firm holds 4 of 5 shares, we hold 1 escrow share". Process:
   - Onboarding wizard step (5-15 min addition for Enterprise)
   - Generate 5 shares offline στο firm's browser (WebCrypto), never transmitted
   - Firm prints/exports 4 shares σε sealed envelopes + hardware tokens
   - Greek notary witnesses 1 share sealing (separate appointment, +€80-150 cost to firm)
   - Themis receives only encrypted escrow share (decryption requires reconstructing 3-of-5)
   - Quarterly recovery drill reminder
   **Question:** Is this ops complexity acceptable for €79/μήνα tier; Or do we make BYOK = €149+ "Sovereign tier" upsell;
   **Δαίδαλος recommendation:** Opt-in σε Enterprise (€79+) με clear UX. Default = Hetzner KMS dedicated key (no Shamir). BYOK Shamir = "Sovereign Add-on" +€40/μήνα bundled με quarterly drill + notary fee covered first time. Niko + Pericles validate pricing με 2-3 large firm prospects Sprint 5-6.

---

*Δαίδαλος v0.3 data-model spec, filed 2026-04-29 (rev. §8 added).*
*Awaits Niko sign-off on Q-DM-1..7 + Decisions Table §0 (16 decisions including D-DM-16..19).*
