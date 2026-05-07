-- Migration: 0002_template_schema.sql
-- Created: 2026-04-29
-- Purpose: Tenant template schema (45 Phase-1 tables)
-- Usage: Cloned per firm via provisioning script
--
-- !!  TRANSACTION REQUIRED  !!
-- This migration MUST be run inside a transaction (psql -1 / migration runner).
-- SET LOCAL has no effect outside a transaction (N1 — Daedalus Day-2 review).
-- All migration runners (Atlas, Flyway, golang-migrate) wrap in BEGIN/COMMIT by
-- default. Direct psql usage: psql -1 -f 0002_template_schema.sql
--
-- This schema is NEVER used directly in production. The provisioning script
-- executes: CREATE SCHEMA firm_<slug>; SET search_path = firm_<slug>; then
-- runs this DDL verbatim (with search_path already set to the new schema).
--
-- ENUM OWNERSHIP MODEL — Option A (shared types, decided 2026-04-29):
--   All ENUMs live in the tenant_template namespace (tenant_template.*_t).
--   Column DDL explicitly qualifies every ENUM reference as tenant_template.<type>_t
--   so that cloned firm schemas (firm_<slug>) reference the shared type, not a local one.
--   Consequence: ALTER TYPE tenant_template.foo_t ADD VALUE 'x' is firm-global and
--   takes immediate effect for ALL tenants on the shared cluster.
--   Provisioning script MUST skip the CREATE TYPE blocks (lines after "ENUM TYPES")
--   when search_path is a firm schema — the types already exist in tenant_template.
--   New ENUM values: ALTER TYPE tenant_template.foo_t ADD VALUE 'new_value';
--   Per-firm ENUM isolation is NOT supported in Phase 1 (Option B deferred).
--
-- Spec: docs/v03/data-model-v03.md
-- Invariants enforced:
--   #1  Unified Party Model  (§4)
--   #2  Matter ↔ Party M2M  (§5)
--   #3  All money BIGINT cents
--   #4  Audit log append-only + retention matrix
--   #6  Tier-dependent tenant isolation (no tenant_id columns)
--   #9  Privilege enforcement — crypto + application + audit layers (§8)
--   #10 Greek compliance — myDATA, ΔΣΑ Γραμμάτιο
--
-- DEVIATIONS / INTERPRETATIONS vs task spec:
--   1. task spec §A uses "users" table with public.firm_users FK comment;
--      v0.3 data model uses "app_user" with richer columns. This file follows
--      the task spec layout (users, user_sessions, api_tokens, audit_log) but
--      aligns column names to v0.3 where the spec is more detailed.
--   2. party_natural / party_legal are separate extension tables per task spec
--      (vertical split); v0.3 collapses them into a single party table. This
--      file implements the task spec's vertical-split design since that is the
--      explicit deliverable for this migration.
--   3. matter_party adds billing_split trigger from v0.3 spec (Aristotle L6)
--      and partial unique index for is_primary_contact (Aristotle L5) as these
--      are DB-level constraints already required by v0.3.
--   4. audit_privilege_access is partitioned by range(occurred_at) as required;
--      current month + next 2 months partitions are created at migration time.
--   5. trust_account_entry is included here per task spec although v0.3 §6
--      defers trust tables to Phase 1.5. It is included as requested; a future
--      migration can drop or migrate it to Phase 1.5 schema.
--   6. document table retains storage_mode column from v0.3 §3.5 (r2_sse_c /
--      ddk_aes_gcm) in addition to the task spec columns — required by Invariant #9.
--   7. invoice.party_id is named bill_to_party_id to match v0.3 spec clarity.
--   8. All ENUMs are prefixed with the table name to avoid namespace collisions
--      when multiple firm schemas coexist in the same DB and pg_catalog is shared.
--      Pattern: <table>_<column>_t  (e.g. party_type_t, matter_status_t).
--      Column DDL qualifies all ENUM references as tenant_template.<type>_t (C5, Option A).
--   9. (C3, 2026-04-29) Added document_privilege table (Invariant #9 crypto layer),
--      restructured audit_privilege_access to match spec §8 column list, added
--      kms_custody_share table for Enterprise BYOK Shamir custody log.
--      Table count revised from 43 → 45.
--
-- CHANGELOG:
--   2026-04-29  Initial creation (43 tables).
--   2026-04-29  fix-pass: C3 (privilege crypto layer — document_privilege +
--               restructured audit_privilege_access + kms_custody_share),
--               C4 (billing_split trigger relaxed via billing_split_locked),
--               C5 (qualified ENUMs + Option A documented),
--               N6/N12 (bigint money columns),
--               M11 (representing_counsel TODO comment),
--               M12 (header count 43→45),
--               M13 (FK indexes),
--               N1 (transaction requirement documented).

-- ============================================================
-- SCHEMA
-- ============================================================

CREATE SCHEMA IF NOT EXISTS tenant_template;

SET LOCAL search_path TO tenant_template;

-- ============================================================
-- ENUM TYPES  (all scoped to tenant_template namespace)
-- Wrapped in DO blocks for idempotency.
-- ============================================================

-- ── A. Identity & Access ─────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE user_role_t AS ENUM (
    'partner', 'associate', 'paralegal', 'secretary', 'admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── B. Unified Party Model ────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE party_type_t AS ENUM ('natural', 'legal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE party_role_kind_t AS ENUM (
    'client', 'counterparty', 'witness', 'expert', 'judge', 'court',
    'supplier', 'employee', 'contact', 'opposing_counsel', 'mediator',
    'arbitrator', 'guarantor', 'notary', 'bailiff', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE party_relationship_t AS ENUM (
    'spouse', 'parent', 'child', 'sibling', 'business_partner',
    'employer', 'employee', 'representative', 'shareholder', 'director',
    'co_owner', 'legal_rep', 'counterparty', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE contact_type_t AS ENUM (
    'phone', 'email', 'address', 'website', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE address_type_t AS ENUM (
    'residence', 'business', 'correspondence', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── C. Matter Management ──────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE matter_type_t AS ENUM (
    'litigation', 'transactional', 'advisory', 'regulatory',
    'criminal', 'family', 'labor', 'admin', 'tax', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE matter_status_t AS ENUM (
    'prospective', 'active', 'dormant', 'closed', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE matter_privilege_t AS ENUM ('standard', 'privileged');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE billing_method_t AS ENUM (
    'hourly', 'fixed', 'contingency', 'retainer', 'pro_bono'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE matter_party_role_t AS ENUM (
    'client', 'counterparty', 'witness', 'expert', 'court', 'judge',
    'opposing_counsel', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE matter_party_side_t AS ENUM ('ours', 'opponent', 'neutral');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE representation_status_t AS ENUM (
    'representing', 'represented_by_other', 'not_represented'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE team_role_t AS ENUM (
    'lead', 'co_counsel', 'associate', 'paralegal', 'billing_only'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE deadline_type_t AS ENUM (
    'court_filing', 'statute_limitations', 'internal',
    'client_deliverable', 'regulatory'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE deadline_status_t AS ENUM (
    'pending', 'met', 'missed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── D. Documents ──────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE doc_type_t AS ENUM (
    'pleading', 'contract', 'correspondence', 'evidence',
    'court_decision', 'internal_note', 'template', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ocr_status_t AS ENUM (
    'pending', 'processing', 'completed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE storage_mode_t AS ENUM (
    'r2_sse_c',    -- non-privileged: R2-managed encryption with DEK_FIRM
    'ddk_aes_gcm'  -- privileged: content encrypted by app with per-doc DDK
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── E. Time & Billing ─────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE time_entry_status_t AS ENUM (
    'draft', 'posted', 'invoiced', 'written_off'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE expense_type_t AS ENUM (
    'court_fee', 'expert_fee', 'translation', 'travel', 'courier', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE expense_status_t AS ENUM ('draft', 'posted', 'invoiced');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status_t AS ENUM (
    'draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invoice_line_source_t AS ENUM (
    'time', 'expense', 'manual', 'grammatio'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method_t AS ENUM (
    'bank_transfer', 'viva', 'ethniki', 'cash', 'check', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trust_entry_type_t AS ENUM (
    'deposit', 'withdrawal', 'interest', 'fee', 'transfer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── F. Calendar & Tasks ───────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE calendar_event_type_t AS ENUM (
    'hearing', 'meeting', 'deadline', 'internal', 'personal'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_priority_t AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_status_t AS ENUM (
    'open', 'in_progress', 'blocked', 'done', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── G. AI / Aegis ─────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ai_request_type_t AS ENUM (
    'research', 'drafting', 'deadline_extract', 'summary',
    'conflict_check', 'email_classify'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ai_request_status_t AS ENUM ('success', 'error', 'timeout');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ai_review_decision_t AS ENUM (
    'accepted', 'rejected', 'modified'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE conflict_check_scope_t AS ENUM (
    'parties_only', 'full_history'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE conflict_check_status_t AS ENUM (
    'passed', 'manual_review', 'blocked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── H. Privilege & Compliance ────────────────────────────────

-- C3 (2026-04-29): privilege_tag_t — document privilege classification
DO $$ BEGIN
  CREATE TYPE tenant_template.privilege_tag_t AS ENUM (
    'attorney_client',
    'work_product',
    'joint_defense',
    'mediation',
    'settlement_negotiation'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- C3 (2026-04-29): privilege_access_action_t — replaces priv_access_action_t
-- Expanded to match spec §8 audit_privilege_access.access_method
DO $$ BEGIN
  CREATE TYPE tenant_template.privilege_access_action_t AS ENUM (
    'view', 'download', 'decrypt', 'share_attempt', 'export', 'print'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- C3 (2026-04-29): access_outcome_t
DO $$ BEGIN
  CREATE TYPE tenant_template.access_outcome_t AS ENUM (
    'granted', 'denied', 'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Retained for idempotency on pre-fix-pass DBs; new code uses privilege_access_action_t
DO $$ BEGIN
  CREATE TYPE tenant_template.priv_access_action_t AS ENUM (
    'view', 'download', 'decrypt', 'share', 'export'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mydata_status_t AS ENUM (
    'pending', 'accepted', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gdpr_request_type_t AS ENUM (
    'access', 'rectification', 'deletion', 'portability', 'objection'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gdpr_request_status_t AS ENUM (
    'received', 'in_progress', 'fulfilled', 'rejected', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── I. System ─────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE bg_job_status_t AS ENUM (
    'queued', 'running', 'completed', 'failed', 'retrying'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- A. IDENTITY & ACCESS  (4 tables)
-- ============================================================

-- ------------------------------------------------------------
-- A.1  users
-- Denormalized local cache of public.firm_users.
-- Actual user records live in public.firm_users (shared schema).
-- This table is a materialized projection kept in sync by the
-- provisioning layer and auth middleware.
-- FK to public.firm_users enforced at app layer (not DB level)
-- to allow this DDL to run cleanly in the template schema without
-- a dependency on the shared public schema at clone time.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK to public.firm_users(id) — enforced at app layer
  email           text          NOT NULL,
  role            tenant_template.user_role_t   NOT NULL DEFAULT 'associate',
  full_name       text          NOT NULL,
  bar_number      varchar(50),
  bar_association varchar(50),
  is_active       boolean       NOT NULL DEFAULT true,
  last_login      timestamptz,
  preferences     jsonb         NOT NULL DEFAULT '{}',
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS
  'Denormalized local cache of public.firm_users for this tenant schema. '
  'Source of truth is public.firm_users; this projection is kept in sync '
  'by auth middleware (SET LOCAL search_path) and provisioning scripts. '
  'FK to public.firm_users(id) enforced at application layer.';

CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- ------------------------------------------------------------
-- A.2  user_sessions
-- Active JWT sessions. Revoked at logout or security event.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,  -- FK → users(id) app-enforced
  jwt_jti      text        NOT NULL UNIQUE,
  ip           inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

COMMENT ON TABLE user_sessions IS
  'Active and recently-expired JWT sessions per user. '
  'jwt_jti is the JTI claim from the signed token. '
  'revoked_at IS NULL = session still valid (subject to expires_at).';

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_jwt_jti_idx ON user_sessions (jwt_jti);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at)
  WHERE revoked_at IS NULL;

-- ------------------------------------------------------------
-- A.3  api_tokens
-- Long-lived API tokens for integrations (myDATA, SOLON, etc.).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,  -- FK → users(id) app-enforced
  name         text        NOT NULL,
  token_hash   text        NOT NULL UNIQUE,  -- SHA-256 of raw token
  scopes       jsonb       NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz
);

COMMENT ON TABLE api_tokens IS
  'Long-lived API tokens for programmatic access and external integrations. '
  'Raw token is shown once at creation; only the SHA-256 hash is stored. '
  'scopes: JSON array of string scope names (e.g. ["invoices:read","matters:write"]).';

CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx   ON api_tokens (user_id);
CREATE INDEX IF NOT EXISTS api_tokens_revoked_idx   ON api_tokens (revoked_at)
  WHERE revoked_at IS NULL;

-- ------------------------------------------------------------
-- A.4  audit_log
-- Append-only general activity log. No UPDATE or DELETE permitted.
-- Partitioned monthly (current month + 2 forward months created below).
-- Retention: financial entries pseudonymized at 20 years,
--            non-financial at 5 years (N.4624/2019 §31, Invariant #4).
-- changes JSONB field should be envelope-encrypted with tenant DEK in
-- production (pgp_sym_encrypt / app-layer encryption). Phase 1 stores
-- plaintext summary only; PII in changes encrypted Phase 1.5.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id              bigserial   NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_user_id   uuid,        -- NULL for system/scheduled jobs
  action          text        NOT NULL,  -- e.g. 'matter.create', 'invoice.send'
  target_type     text        NOT NULL,  -- e.g. 'matter', 'party', 'invoice'
  target_id       text        NOT NULL,  -- UUID as text (flexible for composite keys)
  payload         jsonb       NOT NULL DEFAULT '{}',
  ip              inet,
  user_agent      text,
  outcome         text        NOT NULL DEFAULT 'success',  -- success | denied | error
  pseudonymized_at timestamptz,  -- set by retention cron when threshold reached
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE audit_log IS
  'Append-only activity log. INVARIANT #4: no UPDATE or DELETE permitted — '
  'enforced via REVOKE below. Partitioned monthly. '
  'Retention policy (cron, daily): financial resource_types pseudonymized at 20yr, '
  'non-financial at 5yr per N.4624/2019 §31. '
  'payload JSONB should be envelope-encrypted with tenant DEK (Phase 1.5).';

-- Forward partitions (current month + 2 ahead) created after table.
-- See partition creation block at end of this section.

CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx
  ON audit_log (target_type, target_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx
  ON audit_log (occurred_at DESC);

-- ============================================================
-- B. UNIFIED PARTY MODEL  (7 tables — Invariant #1)
-- One party row per real-world person/organisation.
-- No separate "client" table.
-- ============================================================

-- ------------------------------------------------------------
-- B.1  party
-- Master record. party_type determines which extension table
-- (party_natural or party_legal) holds the detail rows.
-- Invariant #1: no client_id anywhere in the schema.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type       tenant_template.party_type_t  NOT NULL,
  display_name     text          NOT NULL,
  -- [PII] tax_id stored as blind-indexed encrypted bytes in production;
  -- Phase 1 stores plaintext afm for search simplicity. Phase 1.5: encrypt.
  afm              varchar(20),
  doy              varchar(100),
  -- Attorney fields (Aristotle L13 fix from v0.3)
  is_attorney      boolean       NOT NULL DEFAULT false,
  bar_number       varchar(50),
  -- Soft delete / GDPR erasure
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  soft_deleted_at  timestamptz,
  -- GDPR consent tracking
  gdpr_consent_at   timestamptz,
  gdpr_consent_type varchar(50),
  gdpr_pseudonymized_at timestamptz,
  CONSTRAINT attorney_requires_bar CHECK (
    is_attorney = false OR bar_number IS NOT NULL
  )
);

COMMENT ON TABLE party IS
  'INVARIANT #1 — Unified Party Model. One row per real-world person or '
  'organisation. party_type determines the extension table (party_natural '
  'for persons, party_legal for organisations). Roles are in party_role. '
  'No separate client/counterparty tables.';

CREATE INDEX IF NOT EXISTS party_afm_idx
  ON party (afm) WHERE afm IS NOT NULL;
CREATE INDEX IF NOT EXISTS party_display_name_idx
  ON party USING gin (to_tsvector('simple', display_name));
CREATE INDEX IF NOT EXISTS party_soft_deleted_idx
  ON party (soft_deleted_at) WHERE soft_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS party_type_idx
  ON party (party_type);

-- ------------------------------------------------------------
-- B.2  party_natural
-- Extension table for natural persons (party_type = 'natural').
-- 1:1 with party via party_id PK.
-- [PII] columns marked — envelope-encrypt with tenant DEK (Phase 1.5).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party_natural (
  party_id       uuid        PRIMARY KEY,  -- FK → party(id) app-enforced
  first_name     text,         -- [PII]
  last_name      text,         -- [PII]
  father_name    text,         -- [PII]
  mother_name    text,         -- [PII]
  birth_date     date,         -- [PII]
  birth_place    text,         -- [PII]
  gender         varchar(20),
  marital_status varchar(30),
  adt_number     text,         -- [PII] ΑΔΤ number (encrypted Phase 1.5)
  adt_issuer     text,
  profession     text
);

COMMENT ON TABLE party_natural IS
  'Extension table for natural persons (party.party_type = ''natural''). '
  'Joined to party via party_id. All [PII] columns should be '
  'envelope-encrypted with tenant DEK in Phase 1.5.';

-- ------------------------------------------------------------
-- B.3  party_legal
-- Extension table for legal persons / organisations
-- (party_type = 'legal').
-- 1:1 with party via party_id PK.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party_legal (
  party_id        uuid        PRIMARY KEY,  -- FK → party(id) app-enforced
  legal_name      text        NOT NULL,
  legal_form      varchar(50),  -- ΑΕ, ΕΠΕ, ΙΚΕ, ΟΕ, ΕΕ, σωματείο, δήμος …
  gemi_number     varchar(20),
  established_date date,
  vat_status      varchar(50),
  website         varchar(255)
);

COMMENT ON TABLE party_legal IS
  'Extension table for legal persons / organisations '
  '(party.party_type = ''legal''). Joined to party via party_id.';

CREATE INDEX IF NOT EXISTS party_legal_gemi_idx
  ON party_legal (gemi_number) WHERE gemi_number IS NOT NULL;

-- ------------------------------------------------------------
-- B.4  party_role
-- Time-bounded roles a party holds. Multiple simultaneous + historical.
-- Append-only history: REVOKE UPDATE, DELETE enforced below.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party_role (
  id           uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id     uuid              NOT NULL,  -- FK → party(id) app-enforced
  role         tenant_template.party_role_kind_t NOT NULL,
  valid_from   date,
  valid_to     date,
  notes        text,
  created_at   timestamptz       NOT NULL DEFAULT now()
);

COMMENT ON TABLE party_role IS
  'Time-bounded roles a party holds (client, supplier, judge, etc.). '
  'Multiple simultaneous roles allowed. Historical rows are retained — '
  'UPDATE and DELETE are REVOKED to preserve audit trail (Invariant #4).';

CREATE INDEX IF NOT EXISTS party_role_party_id_idx
  ON party_role (party_id, role);
CREATE INDEX IF NOT EXISTS party_role_valid_idx
  ON party_role (party_id, valid_from, valid_to);

-- ------------------------------------------------------------
-- B.5  party_relationship
-- Directed relationships between two parties.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party_relationship (
  id                uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id_a        uuid                 NOT NULL,  -- FK → party(id) app-enforced
  party_id_b        uuid                 NOT NULL,  -- FK → party(id) app-enforced
  relationship_type tenant_template.party_relationship_t NOT NULL,
  valid_from        date,
  valid_to          date,
  notes             text,
  created_at        timestamptz          NOT NULL DEFAULT now()
);

COMMENT ON TABLE party_relationship IS
  'Directed relationships between two parties '
  '(e.g. spouse, employer/employee, legal representative). '
  'Direction: party_id_a → party_id_b (e.g. A is parent of B).';

CREATE INDEX IF NOT EXISTS party_relationship_a_idx
  ON party_relationship (party_id_a);
CREATE INDEX IF NOT EXISTS party_relationship_b_idx
  ON party_relationship (party_id_b);

-- ------------------------------------------------------------
-- B.6  party_contact
-- Multi-valued contact points (phone, email, website, other).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party_contact (
  id           uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id     uuid             NOT NULL,  -- FK → party(id) app-enforced
  contact_type tenant_template.contact_type_t   NOT NULL,
  value        text             NOT NULL,  -- [PII]
  label        text,
  is_primary   boolean          NOT NULL DEFAULT false,
  verified_at  timestamptz,
  created_at   timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE party_contact IS
  'Multi-valued contact points per party. '
  'value is [PII] — envelope-encrypt with tenant DEK Phase 1.5. '
  'Partial unique index ensures at most one primary per (party, type).';

CREATE INDEX IF NOT EXISTS party_contact_party_id_idx
  ON party_contact (party_id, contact_type);

-- Invariant: at most one primary contact per (party, type) — Aristotle L5 analog
CREATE UNIQUE INDEX IF NOT EXISTS party_contact_primary_uq
  ON party_contact (party_id, contact_type)
  WHERE is_primary = true;

-- ------------------------------------------------------------
-- B.7  party_address
-- Multi-valued addresses per party.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party_address (
  id           uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id     uuid             NOT NULL,  -- FK → party(id) app-enforced
  address_type tenant_template.address_type_t   NOT NULL,
  street       text,            -- [PII]
  number       varchar(20),     -- [PII]
  city         text,            -- [PII]
  region       text,
  postal_code  varchar(10),
  country      char(2)          NOT NULL DEFAULT 'GR',
  is_primary   boolean          NOT NULL DEFAULT false,
  created_at   timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE party_address IS
  'Multi-valued addresses per party. '
  'Address fields are [PII] — envelope-encrypt with tenant DEK Phase 1.5. '
  'Partial unique index ensures at most one primary address per party.';

CREATE INDEX IF NOT EXISTS party_address_party_id_idx
  ON party_address (party_id, address_type);

CREATE UNIQUE INDEX IF NOT EXISTS party_address_primary_uq
  ON party_address (party_id)
  WHERE is_primary = true;

-- ============================================================
-- C. MATTER MANAGEMENT  (8 tables — Invariant #2)
-- No client_id on matter. All parties via matter_party.
-- ============================================================

-- ------------------------------------------------------------
-- C.1  matter
-- Core case/project record.
-- INVARIANT #2: no client_id column.
-- INVARIANT #3: all monetary amounts in BIGINT cents.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter (
  id                       uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_number            text               NOT NULL,  -- unique within schema (index below)
  title                    text               NOT NULL,  -- [PII]
  matter_type              tenant_template.matter_type_t      NOT NULL,
  status                   tenant_template.matter_status_t    NOT NULL DEFAULT 'prospective',
  opened_at                timestamptz        NOT NULL DEFAULT now(),
  closed_at                timestamptz,       -- sync'd by trigger (Aristotle L12 fix)
  lead_attorney_user_id    uuid,              -- FK → users(id) app-enforced
  practice_area            text,
  court                    text,
  court_case_number        text,
  privilege_level          tenant_template.matter_privilege_t NOT NULL DEFAULT 'standard',
  -- Billing (Invariant #3: all cents)
  estimated_value_eur_cents bigint,
  billing_method           tenant_template.billing_method_t   NOT NULL DEFAULT 'hourly',
  retainer_balance_eur_cents bigint           NOT NULL DEFAULT 0,
  -- Compliance
  statute_of_limitations   date,
  legal_hold               boolean            NOT NULL DEFAULT false,
  ethical_wall             boolean            NOT NULL DEFAULT false,  -- Phase 1 always false; schema for forward-compat
  -- Metadata
  notes                    text,
  custom_fields            jsonb              NOT NULL DEFAULT '{}',
  tags                     text[]             NOT NULL DEFAULT '{}',
  department_id            uuid,              -- nullable, Firm tier soft-isolation
  created_at               timestamptz        NOT NULL DEFAULT now(),
  updated_at               timestamptz        NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

COMMENT ON TABLE matter IS
  'INVARIANT #2 — Matter ↔ Party M2M. No client_id column. '
  'All involved parties are recorded in matter_party with role+side. '
  'INVARIANT #3 — all monetary fields stored as BIGINT cents (EUR). '
  'closed_at is managed by sync_matter_closed_at() trigger (Aristotle L12).';

CREATE UNIQUE INDEX IF NOT EXISTS matter_number_uq
  ON matter (matter_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS matter_status_idx
  ON matter (status, lead_attorney_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS matter_court_case_idx
  ON matter (court_case_number) WHERE court_case_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS matter_lead_attorney_idx
  ON matter (lead_attorney_user_id);
CREATE INDEX IF NOT EXISTS matter_tags_idx
  ON matter USING gin (tags);

-- Trigger: keep closed_at in sync with status (Aristotle L12 fix)
CREATE OR REPLACE FUNCTION tenant_template.sync_matter_closed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'closed' AND NEW.closed_at IS NULL THEN
    NEW.closed_at := NOW();
  ELSIF NEW.status != 'closed' AND OLD.status = 'closed' THEN
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_matter_closed_at ON tenant_template.matter;
CREATE TRIGGER trg_sync_matter_closed_at
  BEFORE UPDATE OF status ON tenant_template.matter
  FOR EACH ROW EXECUTE FUNCTION tenant_template.sync_matter_closed_at();

-- ------------------------------------------------------------
-- C.2  matter_party
-- M2M junction: party ↔ matter with role, side, representation.
-- INVARIANT #2 implementation.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_party (
  id                         uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id                  uuid                    NOT NULL,  -- FK → matter(id) app-enforced
  party_id                   uuid                    NOT NULL,  -- FK → party(id) app-enforced
  role                       tenant_template.matter_party_role_t     NOT NULL,
  side                       tenant_template.matter_party_side_t     NOT NULL DEFAULT 'neutral',
  representation_status      tenant_template.representation_status_t NOT NULL DEFAULT 'not_represented',
  -- representing_counsel_party_id: app validates party.is_attorney = true (Aristotle L13)
  -- TODO Day 7-10: Add row-level trigger that validates representing_counsel_party_id
  -- references a party with party.is_attorney = true AND party.bar_number IS NOT NULL.
  -- For Phase 1, application layer enforces this at API boundary (M11 — Daedalus review).
  representing_counsel_party_id uuid,
  conflict_check_passed_at   timestamptz,
  billing_split_percentage   numeric(5,2),   -- 0-100, trigger enforces SUM=100 per matter (Aristotle L6)
  -- C4 (2026-04-29): billing_split_locked — trigger only validates SUM=100 when locked.
  -- Set true when the matter team allocations are finalised. Allows partial entry
  -- (e.g. first attorney split=50, second attorney split added later) without rolling back.
  billing_split_locked       boolean         NOT NULL DEFAULT false,
  is_primary_contact         boolean         NOT NULL DEFAULT false,
  valid_from                 timestamptz     NOT NULL DEFAULT now(),
  valid_to                   timestamptz,
  notes                      text,            -- [PII]
  CONSTRAINT matter_party_uniq UNIQUE (matter_id, party_id, role)
);

COMMENT ON TABLE matter_party IS
  'INVARIANT #2 — Matter ↔ Party M2M. Each row = one party playing one role '
  'in one matter. side: ours/opponent/neutral. representation_status tracks '
  'whether this firm represents the party or not. '
  'Constraints: billing_split trigger (Aristotle L6), '
  'primary contact partial unique index (Aristotle L5).';

CREATE INDEX IF NOT EXISTS matter_party_matter_id_idx
  ON matter_party (matter_id);
CREATE INDEX IF NOT EXISTS matter_party_party_id_idx
  ON matter_party (party_id);
CREATE INDEX IF NOT EXISTS matter_party_role_idx
  ON matter_party (matter_id, role, side);

-- Aristotle L5: at most one primary contact per (matter, side) when active
CREATE UNIQUE INDEX IF NOT EXISTS matter_party_primary_contact_uq
  ON matter_party (matter_id, side)
  WHERE is_primary_contact = true AND valid_to IS NULL;

-- Aristotle L6 + C4 fix: billing_split_percentage SUM = 100 for active 'ours' rows
-- Only enforces when at least one row has billing_split_locked = true AND
-- all active 'ours' rows have a non-NULL billing_split_percentage.
-- This allows partial entry (first attorney set, second to be filled in later)
-- without rolling back the transaction at commit time.
CREATE OR REPLACE FUNCTION tenant_template.validate_billing_split()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_matter_id         uuid;
  v_total             numeric;
  v_locked_count      int;
BEGIN
  v_matter_id := COALESCE(NEW.matter_id, OLD.matter_id);

  -- Count how many active 'ours' rows have billing_split_locked = true
  SELECT COUNT(*) FILTER (WHERE billing_split_locked = true)
    INTO v_locked_count
    FROM tenant_template.matter_party
   WHERE matter_id = v_matter_id
     AND side = 'ours'
     AND (valid_to IS NULL OR valid_to > now());

  -- Only validate when at least one row is locked AND no NULL splits remain
  IF v_locked_count > 0 AND NOT EXISTS (
    SELECT 1 FROM tenant_template.matter_party
     WHERE matter_id = v_matter_id
       AND side = 'ours'
       AND billing_split_percentage IS NULL
       AND (valid_to IS NULL OR valid_to > now())
  ) THEN
    SELECT SUM(billing_split_percentage)
      INTO v_total
      FROM tenant_template.matter_party
     WHERE matter_id = v_matter_id
       AND side = 'ours'
       AND (valid_to IS NULL OR valid_to > now());

    IF v_total IS NOT NULL AND v_total <> 100 THEN
      RAISE EXCEPTION 'BILLING_SPLIT_INVALID: SUM=% <> 100 for matter %',
                      v_total, v_matter_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_split ON tenant_template.matter_party;
CREATE CONSTRAINT TRIGGER trg_billing_split
  AFTER INSERT OR UPDATE OR DELETE ON tenant_template.matter_party
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tenant_template.validate_billing_split();

-- ------------------------------------------------------------
-- C.3  matter_team
-- Internal team members assigned to a matter.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_team (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id     uuid        NOT NULL,  -- FK → matter(id) app-enforced
  user_id       uuid        NOT NULL,  -- FK → users(id) app-enforced
  team_role     tenant_template.team_role_t NOT NULL DEFAULT 'associate',
  allocated_pct int         CHECK (allocated_pct BETWEEN 0 AND 100),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz
);

COMMENT ON TABLE matter_team IS
  'Internal firm users assigned to a matter (attorneys, paralegals, etc.). '
  'allocated_pct: estimated time allocation 0-100%. '
  'Historical rows kept when left_at IS NOT NULL.';

CREATE INDEX IF NOT EXISTS matter_team_matter_id_idx ON matter_team (matter_id);
CREATE INDEX IF NOT EXISTS matter_team_user_id_idx   ON matter_team (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS matter_team_active_uq
  ON matter_team (matter_id, user_id)
  WHERE left_at IS NULL;

-- ------------------------------------------------------------
-- C.4  matter_event
-- Generic timeline entries (hearings, meetings, filings, notes, etc.).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_event (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id            uuid        NOT NULL,  -- FK → matter(id) app-enforced
  event_type           text        NOT NULL,
  event_date           timestamptz NOT NULL,
  description          text,
  created_by_user_id   uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE matter_event IS
  'Generic matter timeline. Records any notable event '
  '(hearing scheduled, filing submitted, phone call, etc.). '
  'For rich deadline tracking use matter_deadline.';

CREATE INDEX IF NOT EXISTS matter_event_matter_id_idx
  ON matter_event (matter_id, event_date DESC);

-- ------------------------------------------------------------
-- C.5  matter_deadline
-- Tracked deadlines with reminder logic and KPolD rule reference.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_deadline (
  id                    uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id             uuid             NOT NULL,  -- FK → matter(id) app-enforced
  title                 text             NOT NULL,
  deadline_at           timestamptz      NOT NULL,
  deadline_type         tenant_template.deadline_type_t  NOT NULL,
  source_rule           text,            -- e.g. 'ΚΠολΔ §215'
  status                tenant_template.deadline_status_t NOT NULL DEFAULT 'pending',
  reminder_offsets_days int[]            NOT NULL DEFAULT '{14,7,3,1}',
  completed_at          timestamptz,
  completed_by_user_id  uuid,
  created_at            timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE matter_deadline IS
  'Legal and procedural deadlines per matter. '
  'source_rule: reference to KPolD article (e.g. ''ΚΠολΔ §215''). '
  'reminder_offsets_days: days before deadline_at to fire reminders '
  '(processed by background job). INVARIANT #10: ΚΠολΔ rule engine.';

CREATE INDEX IF NOT EXISTS matter_deadline_matter_id_idx
  ON matter_deadline (matter_id, deadline_at);
CREATE INDEX IF NOT EXISTS matter_deadline_status_idx
  ON matter_deadline (status, deadline_at)
  WHERE status = 'pending';

-- ------------------------------------------------------------
-- C.6  matter_note
-- Free-text notes attached to a matter, with privilege flag.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_note (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id         uuid        NOT NULL,  -- FK → matter(id) app-enforced
  author_user_id    uuid,
  content           text        NOT NULL,
  is_privileged     boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE matter_note IS
  'Free-text notes on a matter. is_privileged = true triggers '
  'visibility restriction (attorney-only, INVARIANT #9). '
  'Not a substitute for document versioning.';

CREATE INDEX IF NOT EXISTS matter_note_matter_id_idx
  ON matter_note (matter_id, created_at DESC);

-- ------------------------------------------------------------
-- C.7  matter_tag
-- Searchable tags on matters (practice area, client type, etc.).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_tag (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id  uuid        NOT NULL,  -- FK → matter(id) app-enforced
  tag        text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, tag)
);

COMMENT ON TABLE matter_tag IS
  'Arbitrary tags on matters for filtering and reporting. '
  'Unique per (matter_id, tag) — no duplicate tags on one matter.';

CREATE INDEX IF NOT EXISTS matter_tag_tag_idx ON matter_tag (tag);

-- ------------------------------------------------------------
-- C.8  matter_status_history
-- Immutable log of every status transition on a matter.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matter_status_history (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id           uuid            NOT NULL,  -- FK → matter(id) app-enforced
  from_status         tenant_template.matter_status_t,
  to_status           tenant_template.matter_status_t NOT NULL,
  changed_at          timestamptz     NOT NULL DEFAULT now(),
  changed_by_user_id  uuid,
  reason              text
);

COMMENT ON TABLE matter_status_history IS
  'Immutable log of matter status transitions. '
  'Populated by application on every matter.status change.';

CREATE INDEX IF NOT EXISTS matter_status_history_matter_id_idx
  ON matter_status_history (matter_id, changed_at DESC);

-- ============================================================
-- D. DOCUMENTS  (5 tables — Invariant #9)
-- ============================================================

-- ------------------------------------------------------------
-- D.1  document
-- Document metadata. Content stored in Cloudflare R2.
-- storage_mode determines encryption path (INVARIANT #9).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document (
  id                   uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id            uuid,           -- FK → matter(id) app-enforced (nullable)
  party_id             uuid,           -- FK → party(id) app-enforced (nullable)
  title                text            NOT NULL,
  doc_type             tenant_template.doc_type_t      NOT NULL,
  mime_type            text,
  size_bytes           bigint,
  r2_key               text            NOT NULL,  -- Cloudflare R2 object path
  sha256               text,
  version              int             NOT NULL DEFAULT 1,
  parent_document_id   uuid,           -- FK → document(id) app-enforced, for versioned docs
  is_privileged        boolean         NOT NULL DEFAULT false,
  -- INVARIANT #9: storage_mode determines decrypt path
  storage_mode         tenant_template.storage_mode_t  NOT NULL DEFAULT 'r2_sse_c',
  ocr_status           tenant_template.ocr_status_t    NOT NULL DEFAULT 'pending',
  ocr_quality_score    numeric(3,2),
  uploaded_by_user_id  uuid,
  created_at           timestamptz     NOT NULL DEFAULT now(),
  soft_deleted_at      timestamptz
);

COMMENT ON TABLE document IS
  'Document metadata. File content lives in Cloudflare R2 at r2_key. '
  'INVARIANT #9: storage_mode controls encryption path. '
  'r2_sse_c = non-privileged (R2-managed SSE-C with DEK_FIRM). '
  'ddk_aes_gcm = privileged (content pre-encrypted by app with per-doc DDK '
  'before upload; DDK wrapped in document_privilege table). '
  'is_privileged = true triggers privilege ACL checks at every access path.';

CREATE INDEX IF NOT EXISTS document_matter_id_idx
  ON document (matter_id) WHERE soft_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS document_party_id_idx
  ON document (party_id) WHERE soft_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS document_is_privileged_idx
  ON document (is_privileged) WHERE is_privileged = true;
CREATE INDEX IF NOT EXISTS document_r2_key_idx
  ON document (r2_key);

-- ------------------------------------------------------------
-- D.2  document_version
-- Immutable version history for a document.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_version (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id          uuid        NOT NULL,  -- FK → document(id) app-enforced
  version              int         NOT NULL,
  r2_key               text        NOT NULL,
  sha256               text,
  size_bytes           bigint,
  change_note          text,
  uploaded_by_user_id  uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

COMMENT ON TABLE document_version IS
  'Immutable version history. Each upload of a revised document creates '
  'a new version row. The latest version is mirrored on document.version.';

CREATE INDEX IF NOT EXISTS document_version_doc_id_idx
  ON document_version (document_id, version DESC);

-- ------------------------------------------------------------
-- D.3  document_share
-- Secure time-limited share links for client portal access.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_share (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           uuid        NOT NULL,  -- FK → document(id) app-enforced
  shared_with_party_id  uuid,       -- FK → party(id) app-enforced (nullable = link-only share)
  share_token           text        NOT NULL UNIQUE,
  expires_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  accessed_count        int         NOT NULL DEFAULT 0,
  revoked_at            timestamptz
);

COMMENT ON TABLE document_share IS
  'Secure share links for client portal access. '
  'share_token is a cryptographically random token (32 bytes, base64url). '
  'INVARIANT #9: privileged documents MUST NOT be shared via this mechanism '
  '— enforced at application layer before insert.';

CREATE INDEX IF NOT EXISTS document_share_document_id_idx
  ON document_share (document_id);
CREATE INDEX IF NOT EXISTS document_share_token_idx
  ON document_share (share_token);

-- ------------------------------------------------------------
-- D.4  document_template
-- Reusable document templates (pleadings, letters of authority, etc.).
-- Phase 1: 5 system templates pre-seeded by provisioning script.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_template (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text        NOT NULL,
  doc_type             tenant_template.doc_type_t  NOT NULL,
  content_md           text        NOT NULL,  -- Markdown with {{variable}} placeholders
  variables            jsonb       NOT NULL DEFAULT '{}',
  category             text,
  created_by_user_id   uuid,
  is_system            boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE document_template IS
  'Reusable document templates. content_md is Markdown with {{variable}} '
  'placeholders described in variables JSONB. '
  'is_system = true: shipped by THEMIS OS (αγωγή, εξώδικο, πληρεξούσιο, '
  'εντολή, αίτηση ασφαλιστικών). is_system = false: firm-created.';

CREATE INDEX IF NOT EXISTS document_template_doc_type_idx
  ON document_template (doc_type);

-- ------------------------------------------------------------
-- D.5  ocr_job
-- Async OCR extraction jobs per document.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ocr_job (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid          NOT NULL,  -- FK → document(id) app-enforced
  status         tenant_template.ocr_status_t  NOT NULL DEFAULT 'pending',
  started_at     timestamptz,
  completed_at   timestamptz,
  extracted_text text,
  error          text,
  page_count     int,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE ocr_job IS
  'Async OCR extraction job per document upload. '
  'Processed by background_job queue (job_type = ''ocr''). '
  'extracted_text stored here for FTS indexing (Phase 1.5: move to Qdrant).';

CREATE INDEX IF NOT EXISTS ocr_job_document_id_idx ON ocr_job (document_id);
CREATE INDEX IF NOT EXISTS ocr_job_status_idx
  ON ocr_job (status) WHERE status IN ('pending', 'processing');

-- ============================================================
-- E. TIME & BILLING  (6 tables — Invariant #3)
-- All monetary amounts in BIGINT cents (EUR).
-- ============================================================

-- ------------------------------------------------------------
-- E.1  time_entry
-- Attorney/paralegal billable time records.
-- rate snapshot at INSERT (Aristotle L17 fix from v0.3).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_entry (
  id                    uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id             uuid                  NOT NULL,  -- FK → matter(id) app-enforced
  user_id               uuid                  NOT NULL,  -- FK → users(id) app-enforced
  started_at            timestamptz           NOT NULL,
  ended_at              timestamptz,
  duration_minutes      int                   NOT NULL CHECK (duration_minutes >= 0),
  description           text,                 -- [PII]
  billable              boolean               NOT NULL DEFAULT true,
  -- INVARIANT #3: rate snapshot in cents/hr at time of INSERT (Aristotle L17)
  -- NOT a live lookup — rate_change_audit records any admin overrides
  billable_rate_eur_cents int                 NOT NULL DEFAULT 0,
  rate_change_audit     jsonb,                -- nullable; populated on post-INSERT override
  status                tenant_template.time_entry_status_t   NOT NULL DEFAULT 'draft',
  invoice_id            uuid,                 -- FK → invoice(id) app-enforced (set when invoiced)
  created_at            timestamptz           NOT NULL DEFAULT now()
);

COMMENT ON TABLE time_entry IS
  'Attorney/paralegal time records. INVARIANT #3: all money in BIGINT cents. '
  'billable_rate_eur_cents is a snapshot captured at INSERT time from the '
  'active rate card — NOT a live lookup (Aristotle L17 fix). '
  'rate_change_audit JSONB logs any admin override to existing entries.';

CREATE INDEX IF NOT EXISTS time_entry_matter_id_idx
  ON time_entry (matter_id, user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS time_entry_user_id_idx
  ON time_entry (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS time_entry_invoice_id_idx
  ON time_entry (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS time_entry_status_idx
  ON time_entry (status) WHERE status IN ('draft', 'posted');

-- ------------------------------------------------------------
-- E.2  expense
-- Disbursements and costs chargeable to a matter.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense (
  id                  uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id           uuid              NOT NULL,  -- FK → matter(id) app-enforced
  user_id             uuid              NOT NULL,
  expense_date        date              NOT NULL DEFAULT CURRENT_DATE,
  amount_eur_cents    bigint            NOT NULL CHECK (amount_eur_cents >= 0),  -- N6: bigint (Invariant #3)
  description         text              NOT NULL,
  expense_type        tenant_template.expense_type_t    NOT NULL,
  vat_pct             int               NOT NULL DEFAULT 24,
  billable            boolean           NOT NULL DEFAULT true,
  reimbursable        boolean           NOT NULL DEFAULT false,
  status              tenant_template.expense_status_t  NOT NULL DEFAULT 'draft',
  invoice_id          uuid,             -- FK → invoice(id) app-enforced
  receipt_document_id uuid,             -- FK → document(id) app-enforced
  created_at          timestamptz       NOT NULL DEFAULT now()
);

COMMENT ON TABLE expense IS
  'Billable and non-billable disbursements per matter. '
  'INVARIANT #3: amount_eur_cents in BIGINT-compatible cents. '
  'vat_pct: default 24% (Greek standard rate). '
  'reimbursable = true: client owes reimbursement (court fees, translations).';

CREATE INDEX IF NOT EXISTS expense_matter_id_idx   ON expense (matter_id);
CREATE INDEX IF NOT EXISTS expense_invoice_id_idx  ON expense (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- ------------------------------------------------------------
-- E.3  invoice
-- myDATA-compliant invoice. INVARIANT #10 (Greek compliance).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  -- myDATA-compliant sequential number, e.g. "INV-2026-001"
  -- Uniqueness enforced per (year, prefix) via Postgres SEQUENCE in app layer
  invoice_number      text            NOT NULL UNIQUE,
  matter_id           uuid,           -- FK → matter(id) app-enforced (nullable — standalone invoice)
  bill_to_party_id    uuid            NOT NULL,  -- FK → party(id) app-enforced
  issue_date          date            NOT NULL DEFAULT CURRENT_DATE,
  due_date            date,
  subtotal_eur_cents  bigint          NOT NULL DEFAULT 0,
  vat_eur_cents       bigint          NOT NULL DEFAULT 0,
  total_eur_cents     bigint          NOT NULL DEFAULT 0,
  status              tenant_template.invoice_status_t NOT NULL DEFAULT 'draft',
  -- myDATA fields (INVARIANT #10)
  mydata_mark         text,
  mydata_uid          text,
  mydata_qr_url       text,
  paid_at             timestamptz,
  payment_reference   text,
  notes               text,
  version             int             NOT NULL DEFAULT 1,  -- optimistic locking (Aristotle F7)
  created_at          timestamptz     NOT NULL DEFAULT now(),
  updated_at          timestamptz     NOT NULL DEFAULT now()
);

COMMENT ON TABLE invoice IS
  'myDATA-compliant invoice. INVARIANT #3: all amounts in BIGINT cents. '
  'INVARIANT #10: mydata_mark + mydata_uid + mydata_qr_url populated after '
  'successful AADE transmission (via mydata_submission table). '
  'version column provides optimistic locking (Aristotle F7 fix).';

CREATE INDEX IF NOT EXISTS invoice_status_idx
  ON invoice (status, due_date);
CREATE INDEX IF NOT EXISTS invoice_matter_id_idx
  ON invoice (matter_id) WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoice_bill_to_party_idx
  ON invoice (bill_to_party_id);

-- ------------------------------------------------------------
-- E.4  invoice_line
-- Individual line items on an invoice.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_line (
  id                  uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          uuid                    NOT NULL,  -- FK → invoice(id) app-enforced
  line_number         int                     NOT NULL,
  description         text                    NOT NULL,
  quantity            numeric(10,2)           NOT NULL DEFAULT 1,
  unit_price_eur_cents bigint                 NOT NULL,  -- N6: bigint (Invariant #3)
  vat_pct             int                     NOT NULL DEFAULT 24,
  total_eur_cents     bigint                  NOT NULL,  -- N6: bigint (Invariant #3)
  source_type         tenant_template.invoice_line_source_t   NOT NULL DEFAULT 'manual',
  source_id           text,                   -- UUID of source time_entry / expense
  UNIQUE (invoice_id, line_number)
);

COMMENT ON TABLE invoice_line IS
  'Line items on an invoice. source_type + source_id trace back to '
  'the originating time_entry or expense row for audit purposes. '
  'INVARIANT #3: all amounts in integer cents.';

CREATE INDEX IF NOT EXISTS invoice_line_invoice_id_idx
  ON invoice_line (invoice_id, line_number);

-- ------------------------------------------------------------
-- E.5  payment
-- Payments received against invoices.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment (
  id                   uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id           uuid               NOT NULL,  -- FK → invoice(id) app-enforced
  amount_eur_cents     bigint             NOT NULL CHECK (amount_eur_cents > 0),  -- N12: bigint (Invariant #3)
  payment_date         date               NOT NULL DEFAULT CURRENT_DATE,
  payment_method       tenant_template.payment_method_t   NOT NULL,
  reference            text,
  recorded_by_user_id  uuid,
  idempotency_key      varchar(64)        UNIQUE,  -- exactly-once guarantee
  created_at           timestamptz        NOT NULL DEFAULT now()
);

COMMENT ON TABLE payment IS
  'Payments received against invoices. INVARIANT #3: cents. '
  'idempotency_key: unique key from payment gateway for exactly-once semantics. '
  'Payment receipt triggers invoice.status update to ''paid'' (app logic).';

CREATE INDEX IF NOT EXISTS payment_invoice_id_idx ON payment (invoice_id);

-- ------------------------------------------------------------
-- E.6  trust_account_entry
-- Append-only ΕΔΕ client trust account ledger.
-- No UPDATE or DELETE permitted (append-only integrity).
-- INVARIANT #3: all amounts in BIGINT cents.
-- NOTE: v0.3 §6 defers trust tables to Phase 1.5 (Firm tier).
-- Included here per task spec; future migration may relocate.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trust_account_entry (
  id                  uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id           uuid              NOT NULL,  -- FK → matter(id) app-enforced
  party_id            uuid              NOT NULL,  -- FK → party(id) app-enforced
  entry_type          tenant_template.trust_entry_type_t NOT NULL,
  amount_eur_cents    bigint            NOT NULL,  -- positive = in, negative = out; bigint (Invariant #3)
  entry_date          date              NOT NULL DEFAULT CURRENT_DATE,
  description         text              NOT NULL,
  related_invoice_id  uuid,             -- FK → invoice(id) app-enforced
  created_by_user_id  uuid,
  created_at          timestamptz       NOT NULL DEFAULT now()
);

COMMENT ON TABLE trust_account_entry IS
  'ΕΔΕ client trust account ledger. Append-only — UPDATE and DELETE are '
  'REVOKED (see REVOKE statements below). '
  'amount_eur_cents: positive = deposit, negative = withdrawal. '
  'INVARIANT #3: cents. INVARIANT #10: Greek ΔΣΑ compliance. '
  'NOTE: v0.3 §6 assigns full trust tables to Phase 1.5 (Firm tier); '
  'this table is included here per task spec scope.';

CREATE INDEX IF NOT EXISTS trust_account_entry_matter_id_idx
  ON trust_account_entry (matter_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS trust_account_entry_party_id_idx
  ON trust_account_entry (party_id);

-- ============================================================
-- F. CALENDAR & TASKS  (3 tables)
-- ============================================================

-- ------------------------------------------------------------
-- F.1  calendar_event
-- Hearings, meetings, deadlines on the shared firm calendar.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_event (
  id                   uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id            uuid,                   -- FK → matter(id) app-enforced (nullable)
  title                text                    NOT NULL,
  event_type           tenant_template.calendar_event_type_t   NOT NULL,
  starts_at            timestamptz             NOT NULL,
  ends_at              timestamptz,
  location             text,
  attendee_user_ids    uuid[]                  NOT NULL DEFAULT '{}',
  related_party_ids    uuid[]                  NOT NULL DEFAULT '{}',
  description          text,
  created_by_user_id   uuid,
  created_at           timestamptz             NOT NULL DEFAULT now(),
  updated_at           timestamptz             NOT NULL DEFAULT now()
);

COMMENT ON TABLE calendar_event IS
  'Shared firm calendar. attendee_user_ids: UUIDs of internal team members. '
  'related_party_ids: UUIDs of external parties (opposing counsel, court, etc.). '
  'Court hearings should also create a corresponding matter_deadline row.';

CREATE INDEX IF NOT EXISTS calendar_event_matter_id_idx
  ON calendar_event (matter_id) WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calendar_event_starts_at_idx
  ON calendar_event (starts_at);
CREATE INDEX IF NOT EXISTS calendar_event_attendees_idx
  ON calendar_event USING gin (attendee_user_ids);

-- ------------------------------------------------------------
-- F.2  task
-- Lightweight task management linked to matters.
-- Phase 1: simple. Phase 2: workflow engine replaces.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task (
  id                   uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id            uuid,           -- FK → matter(id) app-enforced (nullable — firm-level task)
  assigned_to_user_id  uuid,
  created_by_user_id   uuid,
  title                text            NOT NULL,
  description          text,
  priority             tenant_template.task_priority_t NOT NULL DEFAULT 'normal',
  status               tenant_template.task_status_t   NOT NULL DEFAULT 'open',
  due_at               timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz     NOT NULL DEFAULT now(),
  updated_at           timestamptz     NOT NULL DEFAULT now()
);

COMMENT ON TABLE task IS
  'Lightweight task management. Phase 1: simple open/done workflow. '
  'Phase 2: replaced by workflow_definition + workflow_run engine. '
  'matter_id nullable: allows firm-level admin tasks.';

CREATE INDEX IF NOT EXISTS task_matter_id_idx
  ON task (matter_id) WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_assigned_to_idx
  ON task (assigned_to_user_id, status) WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX IF NOT EXISTS task_due_at_idx
  ON task (due_at) WHERE due_at IS NOT NULL AND status NOT IN ('done', 'cancelled');

-- ------------------------------------------------------------
-- F.3  task_comment
-- Comments / thread on a task.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_comment (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid        NOT NULL,  -- FK → task(id) app-enforced
  author_user_id  uuid,
  comment         text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE task_comment IS
  'Threaded comments on tasks. Phase 1: no edit/delete. '
  'Phase 2: soft-delete + edit history.';

CREATE INDEX IF NOT EXISTS task_comment_task_id_idx
  ON task_comment (task_id, created_at ASC);

-- ============================================================
-- G. AI / AEGIS  (4 tables — Invariant #5)
-- Aegis is AI Enhancement Layer, NOT core.
-- Core ops (matters, billing, calendar) work without Aegis.
-- ============================================================

-- ------------------------------------------------------------
-- G.1  ai_request
-- Log of every AI call made by the Aegis layer.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_request (
  id            uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type  tenant_template.ai_request_type_t   NOT NULL,
  user_id       uuid                NOT NULL,
  matter_id     uuid,               -- FK → matter(id) app-enforced (nullable)
  model         text                NOT NULL,  -- e.g. 'claude-sonnet-4-6'
  input_tokens  int                 NOT NULL DEFAULT 0,
  output_tokens int                 NOT NULL DEFAULT 0,
  cost_usd_cents int                NOT NULL DEFAULT 0,
  latency_ms    int,
  status        tenant_template.ai_request_status_t NOT NULL DEFAULT 'success',
  error         text,
  created_at    timestamptz         NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_request IS
  'INVARIANT #5 — Aegis is AI Enhancement Layer only. '
  'Every AI API call is logged here for cost tracking, audit, and '
  'rate-limit enforcement. Core operations NEVER block on Aegis.';

CREATE INDEX IF NOT EXISTS ai_request_user_id_idx
  ON ai_request (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_request_matter_id_idx
  ON ai_request (matter_id) WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_request_created_at_idx
  ON ai_request (created_at DESC);

-- ------------------------------------------------------------
-- G.2  ai_review
-- Human-in-the-loop review decisions on AI-generated drafts.
-- INVARIANT #8: every legal-actionable AI output requires human review.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_review (
  id                    uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_request_id         uuid                  NOT NULL,  -- FK → ai_request(id) app-enforced
  document_id           uuid,                 -- FK → document(id) app-enforced (nullable)
  reviewed_by_user_id   uuid                  NOT NULL,
  decision              tenant_template.ai_review_decision_t  NOT NULL,
  notes                 text,
  reviewed_at           timestamptz           NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_review IS
  'INVARIANT #8 — Human-in-the-loop on AI outputs. '
  'Every AI-generated legal document/draft requires an attorney review row '
  'before the document is considered final. '
  'Phase 1: ''AI Draft'' banner non-dismissable until accepted row exists.';

CREATE INDEX IF NOT EXISTS ai_review_request_id_idx
  ON ai_review (ai_request_id);
CREATE INDEX IF NOT EXISTS ai_review_reviewer_idx
  ON ai_review (reviewed_by_user_id, reviewed_at DESC);

-- ------------------------------------------------------------
-- G.3  conflict_check
-- Conflict-of-interest checks run at matter/party creation.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conflict_check (
  id                   uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id            uuid,                     -- FK → matter(id) app-enforced
  performed_by_user_id uuid                      NOT NULL,
  performed_at         timestamptz               NOT NULL DEFAULT now(),
  scope                tenant_template.conflict_check_scope_t    NOT NULL DEFAULT 'parties_only',
  results              jsonb                     NOT NULL DEFAULT '[]',
  hits_found           int                       NOT NULL DEFAULT 0,
  status               tenant_template.conflict_check_status_t   NOT NULL DEFAULT 'passed',
  override_reason      text
);

COMMENT ON TABLE conflict_check IS
  'Conflict-of-interest check log. results JSONB: array of '
  '{matched_party_id, score, reason, related_matter_ids}. '
  'status=blocked: matter CANNOT proceed without senior override. '
  'INVARIANT #10: Greek bar association conflict rules apply.';

CREATE INDEX IF NOT EXISTS conflict_check_matter_id_idx
  ON conflict_check (matter_id) WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conflict_check_performed_at_idx
  ON conflict_check (performed_at DESC);

-- ------------------------------------------------------------
-- G.4  email_classification
-- AI-classified incoming emails → matter/party routing.
-- Phase 1: manual forwarder. Phase 1.5: full IMAP integration.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_classification (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_message_id          text        NOT NULL,  -- IMAP/Gmail message-id header
  subject                   text,
  from_address              text,
  classified_to_matter_id   uuid,       -- FK → matter(id) app-enforced
  classified_to_party_id    uuid,       -- FK → party(id) app-enforced
  confidence_score          numeric(4,3) CHECK (confidence_score BETWEEN 0 AND 1),
  classified_at             timestamptz NOT NULL DEFAULT now(),
  accepted_by_user_id       uuid,
  accepted_at               timestamptz
);

COMMENT ON TABLE email_classification IS
  'AI classification of incoming emails to matters/parties. '
  'Phase 1: populated from manual forward-to address. '
  'Phase 1.5: full IMAP / Gmail OAuth integration. '
  'INVARIANT #8: accepted_by_user_id / accepted_at = human approval required.';

CREATE INDEX IF NOT EXISTS email_classification_matter_id_idx
  ON email_classification (classified_to_matter_id)
  WHERE classified_to_matter_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS email_classification_message_id_uq
  ON email_classification (email_message_id);

-- ============================================================
-- H. PRIVILEGE & COMPLIANCE  (3 tables — Invariant #9)
-- ============================================================

-- ------------------------------------------------------------
-- H.1  audit_privilege_access
-- Append-only forensic log of every access to a privileged document.
-- INVARIANT #9 audit layer — spec §8 column list (C3, 2026-04-29).
-- Partitioned monthly. Retention: 20 years per N.4194/2013 §38
-- (attorney professional records). No pseudonymization — full chain required.
-- No UPDATE or DELETE permitted (REVOKE enforced below).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_privilege_access (
  id                         bigserial   NOT NULL,
  occurred_at                timestamptz NOT NULL DEFAULT now(),
  document_privilege_id      uuid,                 -- FK → document_privilege(id) app-enforced (snapshot of privilege state)
  document_id                uuid        NOT NULL, -- FK → document(id) app-enforced
  matter_id                  uuid        NOT NULL, -- FK → matter(id) app-enforced (denormalised for forensic filter)
  accessor_user_id           uuid,                 -- nullable for system/scheduled jobs
  privilege_tag_at_access    tenant_template.privilege_tag_t NOT NULL,  -- denormalised snapshot of tag at access time
  action                     tenant_template.privilege_access_action_t NOT NULL,
  access_outcome             tenant_template.access_outcome_t NOT NULL,
  ddk_unwrap_performed       boolean     NOT NULL DEFAULT false,  -- true only if outcome=granted AND action IN (download, decrypt)
  acl_snapshot               jsonb       NOT NULL DEFAULT '{}',   -- {visible_to_party_ids:[...], visible_to_team_ids:[...]} at access time
  ip                         inet        NOT NULL,
  user_agent                 text        NOT NULL,
  justification              text,                 -- for break-glass overrides
  request_id                 text,                 -- correlate with API request log
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE audit_privilege_access IS
  'INVARIANT #9 — Audit layer. Append-only log of EVERY access to '
  'privileged documents. Spec §8 column list (C3 fix, 2026-04-29). '
  'Partitioned monthly. Retention: 20 years (N.4194/2013 §38). '
  'No pseudonymization — full forensic chain required for malpractice defence. '
  'UPDATE and DELETE REVOKED — append-only integrity enforced below.';

CREATE INDEX IF NOT EXISTS audit_priv_doc_time_idx
  ON audit_privilege_access (document_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_priv_accessor_idx
  ON audit_privilege_access (accessor_user_id, occurred_at DESC)
  WHERE accessor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_priv_outcome_idx
  ON audit_privilege_access (access_outcome)
  WHERE access_outcome <> 'granted';
CREATE INDEX IF NOT EXISTS audit_priv_matter_idx
  ON audit_privilege_access (matter_id, occurred_at DESC);

-- Partitions: current month + next 2 months
-- Uses DO block so dates are evaluated at migration runtime.
DO $$
DECLARE
  m0_start text := date_trunc('month', now())::date::text;
  m0_end   text := (date_trunc('month', now()) + interval '1 month')::date::text;
  m1_start text := (date_trunc('month', now()) + interval '1 month')::date::text;
  m1_end   text := (date_trunc('month', now()) + interval '2 months')::date::text;
  m2_start text := (date_trunc('month', now()) + interval '2 months')::date::text;
  m2_end   text := (date_trunc('month', now()) + interval '3 months')::date::text;
  suffix0  text := to_char(now(), 'YYYY_MM');
  suffix1  text := to_char(now() + interval '1 month', 'YYYY_MM');
  suffix2  text := to_char(now() + interval '2 months', 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS audit_privilege_access_%s '
    'PARTITION OF audit_privilege_access '
    'FOR VALUES FROM (''%s'') TO (''%s'')',
    suffix0, m0_start, m0_end
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS audit_privilege_access_%s '
    'PARTITION OF audit_privilege_access '
    'FOR VALUES FROM (''%s'') TO (''%s'')',
    suffix1, m1_start, m1_end
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS audit_privilege_access_%s '
    'PARTITION OF audit_privilege_access '
    'FOR VALUES FROM (''%s'') TO (''%s'')',
    suffix2, m2_start, m2_end
  );
END $$;

-- Also create audit_log partitions (same pattern: current + 2 forward)
DO $$
DECLARE
  m0_start text := date_trunc('month', now())::date::text;
  m0_end   text := (date_trunc('month', now()) + interval '1 month')::date::text;
  m1_start text := (date_trunc('month', now()) + interval '1 month')::date::text;
  m1_end   text := (date_trunc('month', now()) + interval '2 months')::date::text;
  m2_start text := (date_trunc('month', now()) + interval '2 months')::date::text;
  m2_end   text := (date_trunc('month', now()) + interval '3 months')::date::text;
  suffix0  text := to_char(now(), 'YYYY_MM');
  suffix1  text := to_char(now() + interval '1 month', 'YYYY_MM');
  suffix2  text := to_char(now() + interval '2 months', 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS audit_log_%s '
    'PARTITION OF audit_log '
    'FOR VALUES FROM (''%s'') TO (''%s'')',
    suffix0, m0_start, m0_end
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS audit_log_%s '
    'PARTITION OF audit_log '
    'FOR VALUES FROM (''%s'') TO (''%s'')',
    suffix1, m1_start, m1_end
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS audit_log_%s '
    'PARTITION OF audit_log '
    'FOR VALUES FROM (''%s'') TO (''%s'')',
    suffix2, m2_start, m2_end
  );
END $$;

-- ------------------------------------------------------------
-- H.2  mydata_submission
-- myDATA AADE transmission records per invoice.
-- INVARIANT #10: Greek compliance.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mydata_submission (
  id               uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid            NOT NULL,  -- FK → invoice(id) app-enforced
  submitted_at     timestamptz     NOT NULL DEFAULT now(),
  mydata_response  jsonb           NOT NULL DEFAULT '{}',
  status           tenant_template.mydata_status_t NOT NULL DEFAULT 'pending',
  mark             text,
  error            text,
  content_hash     varchar(64),    -- SHA-256 of XML payload for idempotency (Aristotle F8)
  retry_count      smallint        NOT NULL DEFAULT 0,
  CONSTRAINT mydata_submission_idempotent
    UNIQUE (invoice_id, content_hash)
    DEFERRABLE INITIALLY IMMEDIATE
);

COMMENT ON TABLE mydata_submission IS
  'INVARIANT #10 — Greek compliance. Each row records one AADE myDATA '
  'transmission attempt for an invoice. content_hash + UNIQUE constraint '
  'provides exactly-once semantics (Aristotle F8 fix). '
  'mark: AADE-issued MARK number on acceptance.';

CREATE INDEX IF NOT EXISTS mydata_submission_invoice_id_idx
  ON mydata_submission (invoice_id);
CREATE INDEX IF NOT EXISTS mydata_submission_status_idx
  ON mydata_submission (status) WHERE status IN ('pending', 'rejected');

-- ------------------------------------------------------------
-- H.3  gdpr_request
-- GDPR data subject rights requests (Art.15, 17, 20, 21).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gdpr_request (
  id                    uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id              uuid                  NOT NULL,  -- FK → party(id) app-enforced
  request_type          tenant_template.gdpr_request_type_t   NOT NULL,
  requested_at          timestamptz           NOT NULL DEFAULT now(),
  status                tenant_template.gdpr_request_status_t NOT NULL DEFAULT 'received',
  fulfilled_at          timestamptz,
  response_document_id  uuid,                 -- FK → document(id) app-enforced
  notes                 text
);

COMMENT ON TABLE gdpr_request IS
  'GDPR Art.15 (access), 17 (erasure/key-shredding), 20 (portability), '
  '21 (objection) requests from data subjects. '
  'Art.17 deletion triggers DEK key-shredding workflow (see provisioning docs). '
  'INVARIANT #10: N.4624/2019 §31 (Greek GDPR derogation for legal records).';

CREATE INDEX IF NOT EXISTS gdpr_request_party_id_idx
  ON gdpr_request (party_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS gdpr_request_status_idx
  ON gdpr_request (status) WHERE status IN ('received', 'in_progress');

-- ------------------------------------------------------------
-- H.4  document_privilege  (C3, 2026-04-29 — Invariant #9 crypto layer)
-- Per-document DDK ciphertext + granular ACL.
-- Replaces v0.2 document.privilege_tag ENUM column.
-- One row per privileged document (UNIQUE on document_id).
-- Unauthorized parties cannot decrypt — DDK is unavailable to them.
-- Spec: data-model-v03.md §8.3
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_privilege (
  id                     uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id            uuid      NOT NULL,  -- FK → document(id) app-enforced; UNIQUE (1:1 with document)
  tag                    tenant_template.privilege_tag_t NOT NULL,
  ddk_wrapped            bytea     NOT NULL,  -- per-document DDK wrapped by firm KEK (envelope encryption)
  ddk_version            smallint  NOT NULL DEFAULT 1,  -- rotation counter
  -- Granular ACL (Aristotle E9 fix — joint-defense per-co-client isolation)
  -- NULL = all matter_party(side='ours') can decrypt; explicit list restricts further
  visible_to_party_ids   uuid[]    NOT NULL DEFAULT '{}',
  visible_to_team_ids    uuid[]    NOT NULL DEFAULT '{}',
  -- Portal / AI controls (DB-level guards matching Invariant #9 application layer)
  portal_visible         boolean   NOT NULL DEFAULT false,
  ai_context_eligible    boolean   NOT NULL DEFAULT false,
  -- Classification provenance
  classified_at          timestamptz NOT NULL DEFAULT now(),
  classified_by_user_id  uuid,               -- nullable if AI-inferred
  -- DDK rotation tracking
  rotated_at             timestamptz,
  -- Unique: one privilege record per document
  CONSTRAINT document_privilege_unique_per_doc UNIQUE (document_id),
  -- DB guard: a tagged document cannot be portal-visible (Invariant #9)
  CONSTRAINT document_privilege_portal_block CHECK (
    NOT (portal_visible = true AND tag IS NOT NULL)
  ),
  -- DB guard: AI context eligibility requires portal_visible=false for tagged docs
  CONSTRAINT document_privilege_ai_block CHECK (
    NOT (ai_context_eligible = true AND tag IS NOT NULL AND portal_visible = true)
  )
);

COMMENT ON TABLE document_privilege IS
  'INVARIANT #9 crypto layer. Per-document DDK ciphertext + granular ACL. '
  'Parties NOT in visible_to_party_ids can never decrypt — DDK is unavailable. '
  'Replaces v0.2 document.privilege_tag ENUM (C3, 2026-04-29). '
  'portal_visible and ai_context_eligible enforced by DB CHECK constraints. '
  'Spec: data-model-v03.md §8.3.';

CREATE INDEX IF NOT EXISTS document_privilege_document_id_idx
  ON document_privilege (document_id);
CREATE INDEX IF NOT EXISTS document_privilege_tag_idx
  ON document_privilege (tag);
CREATE INDEX IF NOT EXISTS document_privilege_party_ids_idx
  ON document_privilege USING GIN (visible_to_party_ids);
CREATE INDEX IF NOT EXISTS document_privilege_team_ids_idx
  ON document_privilege USING GIN (visible_to_team_ids);

-- Privilege enforcement trigger: privileged documents cannot be inserted into
-- document_share (CHECK constraints cannot cross tables; trigger fills that gap).
-- Application layer must also verify before INSERT; this is the DB safety net.
CREATE OR REPLACE FUNCTION tenant_template.enforce_privilege_no_share()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tenant_template.document_privilege
     WHERE document_id = NEW.document_id
  ) THEN
    RAISE EXCEPTION 'PRIVILEGE_VIOLATION: document % is privileged and cannot be '
      'shared via document_share. Use document_privilege.visible_to_party_ids ACL.',
      NEW.document_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_privilege_no_share ON tenant_template.document_share;
CREATE TRIGGER trg_privilege_no_share
  BEFORE INSERT ON tenant_template.document_share
  FOR EACH ROW EXECUTE FUNCTION tenant_template.enforce_privilege_no_share();

-- Privilege enforcement trigger: AI drafting/summary/research blocked on matters
-- where privilege_level = 'privileged'. Metadata-only request types are allowed.
-- Blocked types: drafting, summary, research (ingest document content).
-- Allowed types: deadline_extract, conflict_check, email_classify (metadata only).
CREATE OR REPLACE FUNCTION tenant_template.enforce_privilege_no_ai()
RETURNS trigger AS $$
BEGIN
  IF NEW.matter_id IS NOT NULL
     AND NEW.request_type IN ('drafting', 'summary', 'research')
     AND EXISTS (
       SELECT 1 FROM tenant_template.matter m
        WHERE m.id = NEW.matter_id
          AND m.privilege_level = 'privileged'
     )
  THEN
    RAISE EXCEPTION 'PRIVILEGE_VIOLATION: AI request_type ''%'' is blocked on '
      'privileged matter %. Use deadline_extract, conflict_check, or email_classify '
      'for metadata-only operations on privileged matters.',
      NEW.request_type, NEW.matter_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_privilege_no_ai ON tenant_template.ai_request;
CREATE TRIGGER trg_privilege_no_ai
  BEFORE INSERT ON tenant_template.ai_request
  FOR EACH ROW EXECUTE FUNCTION tenant_template.enforce_privilege_no_ai();

-- ------------------------------------------------------------
-- H.5  kms_custody_share  (C3, 2026-04-29 — Enterprise BYOK Shamir custody log)
-- Tracks Shamir Secret Sharing custody without storing share material.
-- Share material is NEVER stored here — only fingerprints (hashes).
-- Phase 1: table ships read-only (no app writes); reconstruction is an
-- ops procedure documented in runbooks/kms-recovery.md.
-- Phase 2: add kms_custody_reconstruction table for reconstruction event log.
-- Spec: data-model-v03.md §8.2 (Enterprise BYOK, Shamir 5-of-9 custody).
-- Note: spec §8.2 describes Shamir 3-of-5 for Enterprise entry; this implementation
-- ships 5-of-9 as the default per the task spec (threshold/total are configurable).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kms_custody_share (
  id                   uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  share_holder_email   text      NOT NULL,
  share_holder_name    text      NOT NULL,
  share_index          smallint  NOT NULL,  -- 1..total_shares (e.g. 1-9 for Shamir 5-of-9)
  threshold            smallint  NOT NULL DEFAULT 5,   -- minimum shares for reconstruction
  total_shares         smallint  NOT NULL DEFAULT 9,   -- total shares distributed
  share_fingerprint    text      NOT NULL,  -- HMAC/hash of the share — NEVER the share itself
  distributed_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at      timestamptz,         -- share holder confirmed receipt
  notes                text,
  CONSTRAINT kms_custody_share_threshold_lte_total CHECK (threshold <= total_shares),
  CONSTRAINT kms_custody_share_index_valid CHECK (share_index BETWEEN 1 AND total_shares),
  UNIQUE (share_index)
);

COMMENT ON TABLE kms_custody_share IS
  'Shamir Secret Sharing custody log for customer-managed KEK (Enterprise BYOK). '
  'Stores ONLY share fingerprints — NEVER the actual share material. '
  'Share material lives with the share holder (hardware token / sealed envelope). '
  'Reconstruction requires threshold shares; process documented in runbooks/kms-recovery.md. '
  'Phase 1: read-only (no reconstruction event log). Phase 2: kms_custody_reconstruction. '
  'Spec: data-model-v03.md §8.2 (C3, 2026-04-29).';

-- ============================================================
-- I. SYSTEM  (3 tables)
-- ============================================================

-- ------------------------------------------------------------
-- I.1  setting
-- Per-firm key-value settings store.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS setting (
  key                text        PRIMARY KEY,
  value              jsonb       NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid
);

COMMENT ON TABLE setting IS
  'Per-firm configuration store. Common keys: '
  'timezone (e.g. "Europe/Athens"), working_hours ({start,end}), '
  'default_vat (24), default_billable_rate_eur_cents, '
  'invoice_prefix ("INV-"), bar_association ("ΔΣΑ"), '
  'efka_rates ({year, rates_json}), holiday_overrides ([dates]).';

-- ------------------------------------------------------------
-- I.2  notification
-- In-app notifications per user.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL,
  notification_type text        NOT NULL,
  title             text        NOT NULL,
  body              text,
  link              text,
  is_read           boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  read_at           timestamptz
);

COMMENT ON TABLE notification IS
  'In-app notifications delivered to individual users. '
  'Email / push delivery handled by BullMQ background jobs. '
  'Old read notifications pruned monthly by background_job (job_type=''notification_cleanup'').';

CREATE INDEX IF NOT EXISTS notification_user_id_idx
  ON notification (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_unread_idx
  ON notification (user_id)
  WHERE is_read = false;

-- ------------------------------------------------------------
-- I.3  background_job
-- Persistent async job queue (OCR, email, myDATA, reminders, etc.).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS background_job (
  id            uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type      text            NOT NULL,
  payload       jsonb           NOT NULL DEFAULT '{}',
  status        tenant_template.bg_job_status_t NOT NULL DEFAULT 'queued',
  attempts      int             NOT NULL DEFAULT 0,
  max_attempts  int             NOT NULL DEFAULT 3,
  scheduled_at  timestamptz     NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  error         text,
  created_at    timestamptz     NOT NULL DEFAULT now()
);

COMMENT ON TABLE background_job IS
  'Persistent async job queue. job_type examples: '
  'ocr, mydata_submit, email_send, reminder_dispatch, conflict_check, '
  'notification_cleanup, partition_maintenance. '
  'Workers poll WHERE status = ''queued'' AND scheduled_at <= now() '
  'ORDER BY scheduled_at ASC FOR UPDATE SKIP LOCKED.';

CREATE INDEX IF NOT EXISTS background_job_queue_idx
  ON background_job (status, scheduled_at)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS background_job_type_idx
  ON background_job (job_type, status);

-- ============================================================
-- APPEND-ONLY ENFORCEMENT
-- REVOKE UPDATE, DELETE on tables that must be immutable.
-- Applied to the schema owner role; adjust to your app role name
-- in the provisioning script (replace 'PUBLIC' with app role).
-- ============================================================

-- audit_log (Invariant #4)
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

-- audit_privilege_access (Invariant #9)
REVOKE UPDATE, DELETE ON audit_privilege_access FROM PUBLIC;

-- trust_account_entry (ΕΔΕ trust accounting integrity)
REVOKE UPDATE, DELETE ON trust_account_entry FROM PUBLIC;

-- party_role (historical role records must not be altered)
REVOKE UPDATE, DELETE ON party_role FROM PUBLIC;

-- ============================================================
-- M13 — MISSING FK INDEXES  (Daedalus Day-2 review, 2026-04-29)
-- Postgres does not auto-index FK columns. These are the spots
-- identified in the review pass. Added idempotently.
-- ============================================================

-- document.parent_document_id — version traversal
CREATE INDEX IF NOT EXISTS document_parent_doc_id_idx
  ON document (parent_document_id) WHERE parent_document_id IS NOT NULL;

-- document_share.shared_with_party_id — "docs shared with this client"
CREATE INDEX IF NOT EXISTS document_share_shared_with_party_idx
  ON document_share (shared_with_party_id);

-- email_classification.classified_to_party_id — party-centric email lookups
CREATE INDEX IF NOT EXISTS email_classification_party_id_idx
  ON email_classification (classified_to_party_id)
  WHERE classified_to_party_id IS NOT NULL;

-- expense.receipt_document_id — "show me the receipt for this expense"
CREATE INDEX IF NOT EXISTS expense_receipt_document_id_idx
  ON expense (receipt_document_id) WHERE receipt_document_id IS NOT NULL;

-- gdpr_request.response_document_id — response document lookups
CREATE INDEX IF NOT EXISTS gdpr_request_response_doc_idx
  ON gdpr_request (response_document_id) WHERE response_document_id IS NOT NULL;

-- payment.recorded_by_user_id — payments by attorney
CREATE INDEX IF NOT EXISTS payment_recorded_by_user_idx
  ON payment (recorded_by_user_id);

-- task.created_by_user_id — tasks created by user
CREATE INDEX IF NOT EXISTS task_created_by_user_idx
  ON task (created_by_user_id);

-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================
-- Table count summary:
--   A. Identity & Access      : 4  (users, user_sessions, api_tokens, audit_log)
--   B. Unified Party Model    : 7  (party, party_natural, party_legal, party_role,
--                                   party_relationship, party_contact, party_address)
--   C. Matter Management      : 8  (matter, matter_party, matter_team, matter_event,
--                                   matter_deadline, matter_note, matter_tag,
--                                   matter_status_history)
--   D. Documents              : 5  (document, document_version, document_share,
--                                   document_template, ocr_job)
--   E. Time & Billing         : 6  (time_entry, expense, invoice, invoice_line,
--                                   payment, trust_account_entry)
--   F. Calendar & Tasks       : 3  (calendar_event, task, task_comment)
--   G. AI / Aegis             : 4  (ai_request, ai_review, conflict_check,
--                                   email_classification)
--   H. Privilege & Compliance : 5  (audit_privilege_access [restructured C3],
--                                   mydata_submission, gdpr_request,
--                                   document_privilege [NEW C3],
--                                   kms_custody_share [NEW C3])
--   I. System                 : 3  (setting, notification, background_job)
--   ─────────────────────────────
--   TOTAL                     : 45 (43 original + 2 new: document_privilege + kms_custody_share)
--
-- C3 additions (2026-04-29 fix-pass):
--   + document_privilege    — Invariant #9 crypto layer; per-document DDK + ACL
--   + kms_custody_share     — Enterprise BYOK Shamir custody log (fingerprints only)
--
-- Note: party_natural + party_legal are the 2 extra tables vs the task spec's
-- count of 4 in group B. Total was 43 before C3 fix; now 45.
