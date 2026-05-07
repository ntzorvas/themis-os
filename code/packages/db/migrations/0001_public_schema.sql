-- Migration: 0001_public_schema.sql
-- Created: 2026-04-29
-- Purpose: Global public schema (firms, users, subscriptions, audit, KMS metadata)
-- Spec ref: docs/v03/data-model-v03.md §2, §3.0
-- Architecture: public schema holds ONLY cross-tenant global tables.
--   Per-tenant tables live in firm_<slug> schemas (see 0002_tenant_schema.sql).
--   This file is idempotent: safe to re-run on an existing DB.
--
-- 2026-04-29 fix-pass: C1 (schema_migrations), C6 (PG14 guard + index ordering),
--   M4 (email lowercase), M5 (audit PK), N3 (email regex), M6 (password length),
--   mfa_secret encoding documented.

-- ---------------------------------------------------------------------------
-- 0. SCHEMA + MIGRATION REGISTRY + VERSION GUARD
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS public;

-- C1: Migration version registry. Single source of truth for the migration
-- runner (Day 5 Hermes). Replaces the broken INSERT INTO system_health at EOF.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version     text        PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  checksum    text,
  description text
);
COMMENT ON TABLE public.schema_migrations IS
  'Migration version registry. Single source of truth for migration runner '
  '(Day 5 hermes). One row per applied migration file. Re-run is idempotent '
  'via ON CONFLICT DO NOTHING.';

-- C6: Postgres 14+ required (partitioned-table PRIMARY KEY + propagated indexes).
DO $$ BEGIN
  IF current_setting('server_version_num')::int < 140000 THEN
    RAISE EXCEPTION 'ΘΕΜΙΣ OS requires PostgreSQL 14+, found %',
      current_setting('server_version');
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 1. ENUM TYPES
--    All wrapped in DO blocks for idempotency (re-run safe).
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.firm_status AS ENUM (
    'trial',       -- within trial_ends_at window, no billing required
    'active',      -- paying subscription, all features available
    'suspended',   -- payment past-due or manual admin hold; read-only access
    'cancelled'    -- soft-deleted; data retained per retention policy, no login
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.firm_tier AS ENUM (
    'starter',       -- €19/mo, schema-per-tenant on shared cluster, up to ~3 seats
    'professional',  -- €39/mo, schema-per-tenant on shared cluster, up to ~8 seats
    'firm',          -- €59/mo, dedicated Postgres DB + dedicated KMS root key
    'enterprise'     -- €79+/mo, dedicated VM + BYOK Shamir 3-of-5 custody option
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM (
    'owner',      -- firm account owner (1 per firm, non-removable)
    'partner',    -- full access, can invite/remove users
    'associate',  -- full matter/billing access, cannot manage firm settings
    'paralegal',  -- limited matter access, cannot see financial summaries
    'staff',      -- calendar + task access only
    'viewer'      -- read-only across all permitted resources
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_period AS ENUM (
    'monthly',
    'annual'  -- 15% discount applied at invoice generation
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM (
    'trialing',   -- within trial window, no charge yet
    'active',     -- current period paid
    'past_due',   -- payment failed, grace period (72h) before suspension
    'cancelled',  -- cancellation scheduled; access until current_period_end
    'expired'     -- period ended without renewal; firm status → suspended
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_provider AS ENUM (
    'viva',     -- Viva Wallet (primary, Greek acquirer, myDATA-compliant)
    'ethniki',  -- Εθνική Τράπεζα acquiring (enterprise contracts)
    'manual'    -- invoice-based (enterprise / pilot agreements)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.audit_actor_type AS ENUM (
    'system',     -- automated process (cron, migration runner, provisioner)
    'admin',      -- super-admin console action
    'firm_user',  -- authenticated firm user (actor_id = firm_users.id::text)
    'api'         -- machine-to-machine API key (actor_id = api_key prefix)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.kms_key_type AS ENUM (
    'data_encryption',      -- DEK: encrypts [PII] columns (pgp_sym_encrypt)
    'privilege_encryption'  -- PEK: wraps per-document DDKs for privileged docs
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.kms_key_status AS ENUM (
    'active',   -- current key version in use for encrypt + decrypt
    'rotating', -- new version generated; old version still decrypts (transition window)
    'retired'   -- decrypt-only for archived ciphertext; no new encrypts
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 2. TABLE: firms
--    Tenant registry. One row per law firm (regardless of tier).
--    Shared-tier firms: schema_name resolves to firm_<slug_underscored> in
--    the shared Postgres cluster. Dedicated-tier firms: schema_name is the
--    schema in their own dedicated DB (same format, different host).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.firms (
  id            uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-facing identifier, used in subdomains and API paths.
  -- Format: lowercase kebab-case, 3–32 chars, no consecutive hyphens.
  slug          text        NOT NULL UNIQUE
                  CONSTRAINT firms_slug_format
                    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),

  legal_name    text        NOT NULL,

  -- Greek tax registration number (ΑΦΜ). Exactly 9 digits, no spaces.
  afm           text        NOT NULL
                  CONSTRAINT firms_afm_9digits
                    CHECK (afm ~ '^[0-9]{9}$'),

  -- State machine: trial → active → suspended → cancelled (terminal).
  -- trial → cancelled is also allowed (firm never converted).
  status        public.firm_status  NOT NULL DEFAULT 'trial',

  tier          public.firm_tier    NOT NULL DEFAULT 'starter',

  -- Postgres schema name for this firm's tenant tables.
  -- Format: firm_ followed by the slug with hyphens replaced by underscores.
  -- Shared tier: schema exists in shared cluster DB (themis_shared).
  -- Dedicated tier: schema exists in the firm's dedicated DB.
  -- Max 63 chars (Postgres identifier limit). Must start with 'firm_'.
  schema_name   text        NOT NULL UNIQUE
                  CONSTRAINT firms_schema_name_format
                    CHECK (schema_name ~ '^firm_[a-z0-9_]+$'),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- NULL once converted to active; set at firm creation for trial period.
  trial_ends_at timestamptz NULL,

  -- Where billing receipts and dunning emails are sent.
  -- N3: \s is not whitespace in Postgres POSIX regex; use [^@[:space:]] instead.
  billing_email text        NOT NULL
                  CONSTRAINT firms_billing_email_format
                    CHECK (billing_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

COMMENT ON TABLE public.firms IS
  'Tenant registry. One row per law firm. Shared-tier and dedicated-tier '
  'firms both appear here. schema_name resolves to the Postgres schema that '
  'holds the firm''s per-tenant tables (party, matter, document, …).';

COMMENT ON COLUMN public.firms.slug IS
  'URL-safe identifier used in subdomains (<slug>.themis.gr) and API paths. '
  'Kebab-case, 3–32 chars. Immutable after provisioning — changing it '
  'invalidates all external bookmarks and Cloudflare DNS entries.';

COMMENT ON COLUMN public.firms.afm IS
  'Greek ΑΦΜ (tax ID). 9 digits, validated at registration against AADE GSIS. '
  'Stored plaintext here (not [PII] at global scope); per-tenant PII is '
  'envelope-encrypted inside the firm schema.';

COMMENT ON COLUMN public.firms.status IS
  'State machine: '
  'trial → active (first payment); '
  'active → suspended (payment failure or manual hold); '
  'suspended → active (payment recovered); '
  'active|suspended → cancelled (explicit cancellation). '
  'Cancelled is terminal — firm data moves to retention limbo.';

COMMENT ON COLUMN public.firms.schema_name IS
  'Postgres schema name for this tenant. Format: firm_<slug_underscored>. '
  'Example: slug=alpha-law → schema_name=firm_alpha_law. '
  'Max 63 chars (Postgres identifier limit enforced at provisioning).';

COMMENT ON COLUMN public.firms.trial_ends_at IS
  'Timestamp when the 14-day trial expires. NULL after first successful payment. '
  'Scheduler job checks daily and transitions status to suspended if unpaid.';

CREATE INDEX IF NOT EXISTS firms_slug_idx        ON public.firms (slug);
CREATE INDEX IF NOT EXISTS firms_schema_name_idx ON public.firms (schema_name);
CREATE INDEX IF NOT EXISTS firms_status_idx      ON public.firms (status);


-- ---------------------------------------------------------------------------
-- 3. TABLE: firm_users
--    Global user registry. Phase 1 = one user belongs to exactly one firm
--    (UNIQUE on email+firm_id). Architecture preserves future multi-firm
--    membership: email is unique only within a firm, not globally.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.firm_users (
  id             uuid                 NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  firm_id        uuid                 NOT NULL
                   REFERENCES public.firms (id)
                   ON DELETE RESTRICT,  -- cannot delete firm while users exist

  -- Unique per firm, not globally (future: one email in multiple firms).
  -- Stored here as plaintext for login lookup; [PII] encryption applied
  -- inside per-tenant schemas where full profile is stored.
  email          text                 NOT NULL,

  -- argon2id hash (libsodium). Never bcrypt or md5.
  -- M6: length guard catches empty/garbage values; argon2id is 95-97 chars,
  --     bcrypt is 60. Range 60-200 rejects obvious bugs without being fragile.
  password_hash  text                 NOT NULL
                   CONSTRAINT firm_users_password_hash_length
                     CHECK (length(password_hash) BETWEEN 60 AND 200),

  role           public.user_role     NOT NULL DEFAULT 'associate',

  full_name      text                 NOT NULL,

  -- Greek ΑΦΜ of the individual lawyer. Nullable (staff/paralegal may not have one).
  afm            text                 NULL
                   CONSTRAINT firm_users_afm_9digits
                     CHECK (afm IS NULL OR afm ~ '^[0-9]{9}$'),

  -- ΑΜ ΔΣ: bar association membership number. Nullable for non-lawyers.
  bar_id         text                 NULL,

  created_at     timestamptz          NOT NULL DEFAULT now(),
  last_login_at  timestamptz          NULL,

  is_active      boolean              NOT NULL DEFAULT true,

  -- TOTP (RFC 6238) enabled flag. Secret stored encrypted below.
  mfa_enabled    boolean              NOT NULL DEFAULT false,

  -- TOTP base32 secret, pgp_sym_encrypt'd with the firm's DEK.
  -- NULL until user completes MFA enrollment.
  mfa_secret     text                 NULL,

  -- M4: email stored lowercase-only to prevent duplicate accounts.
  -- (Niko@MECE.GR vs niko@mece.gr would otherwise be two distinct rows.)
  -- The UNIQUE expression index below enforces uniqueness on lower(email).
  -- This CHECK ensures the stored value is already lowercased at write time.
  CONSTRAINT firm_users_email_lowercase
    CHECK (email = lower(email))
);

COMMENT ON TABLE public.firm_users IS
  'Global user registry for all firm members. Stores authentication credentials '
  'and role. Full profile (PII: names, phone, address) lives in the per-tenant '
  'schema (firm_X.app_user) to maintain tenant isolation. Phase 1: one user '
  'belongs to exactly one firm.';

COMMENT ON COLUMN public.firm_users.email IS
  'Login email. Unique per firm (not globally). Used as login identifier across '
  'all tiers. Stored plaintext here to allow cross-firm login disambiguation; '
  'full PII profile is envelope-encrypted inside the tenant schema.';

COMMENT ON COLUMN public.firm_users.role IS
  'Coarse-grained role for global auth decisions. Fine-grained permissions '
  '(matter ACL, billing visibility, document access) are enforced by the '
  'per-tenant RBAC layer inside the firm schema.';

COMMENT ON COLUMN public.firm_users.bar_id IS
  'Bar association membership number (ΑΜ Δικηγορικού Συλλόγου). '
  'Required for attorneys; nullable for paralegals and staff.';

COMMENT ON COLUMN public.firm_users.mfa_secret IS
  'TOTP secret encrypted via pgcrypto pgp_sym_encrypt(secret_bytes, kms_password). '
  'Stored as base64-encoded ciphertext (text). '
  'Decrypt with pgp_sym_decrypt(decode(value, ''base64''), kms_password). '
  'NULL until MFA enrollment is completed by the user. '
  'Decryption requires unwrapping the firm DEK from firm_kms_keys / Vault.';

-- Login lookup: fast email match across firms (e.g. "which firm does x@y.com belong to?")
CREATE INDEX IF NOT EXISTS firm_users_email_idx     ON public.firm_users (email);
CREATE INDEX IF NOT EXISTS firm_users_firm_id_idx   ON public.firm_users (firm_id);
CREATE INDEX IF NOT EXISTS firm_users_is_active_idx ON public.firm_users (firm_id, is_active);

-- M4: Unique per-firm email enforced on lower(email) expression, not the raw column.
-- Replaces the removed table-level CONSTRAINT firm_users_firm_email_unique UNIQUE (firm_id, email).
CREATE UNIQUE INDEX IF NOT EXISTS firm_users_firm_id_email_lower_uq
  ON public.firm_users (firm_id, lower(email));


-- ---------------------------------------------------------------------------
-- 4. TABLE: subscriptions
--    Billing state per firm. One active subscription per firm at any time
--    (enforced by UNIQUE on firm_id). Historical rows possible if firm
--    cancels and re-subscribes — use created_at for ordering.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                       uuid                        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One active subscription per firm. UNIQUE here means at most one row per firm;
  -- cancelled/expired rows must be archived or the constraint relaxed for history.
  -- Phase 1: single row per firm, status tracks lifecycle.
  firm_id                  uuid                        NOT NULL UNIQUE
                             REFERENCES public.firms (id)
                             ON DELETE RESTRICT,

  -- Mirrors firms.tier at subscription creation; source of truth for billing.
  -- Tier upgrade: UPDATE this row + trigger firm_users/feature flags.
  tier                     public.firm_tier            NOT NULL,

  billing_period           public.billing_period       NOT NULL DEFAULT 'monthly',

  -- Per-seat monthly price in Euro cents (e.g. 3900 = €39.00).
  -- Annual billing: stored as monthly equivalent, invoiced ×12 upfront.
  price_per_user_eur_cents integer                     NOT NULL
                             CONSTRAINT subscriptions_price_positive
                               CHECK (price_per_user_eur_cents > 0),

  -- Number of licensed seats. Overage enforcement handled at app layer.
  seat_count               integer                     NOT NULL DEFAULT 1
                             CONSTRAINT subscriptions_seat_positive
                               CHECK (seat_count >= 1),

  status                   public.subscription_status  NOT NULL DEFAULT 'trialing',

  current_period_start     timestamptz                 NOT NULL DEFAULT now(),
  current_period_end       timestamptz                 NOT NULL,

  payment_provider         public.payment_provider     NOT NULL DEFAULT 'viva',

  -- Provider-side subscription/agreement ID for webhook correlation.
  -- NULL for manual/invoice billing.
  provider_subscription_id text                        NULL,

  created_at               timestamptz                 NOT NULL DEFAULT now(),
  updated_at               timestamptz                 NOT NULL DEFAULT now(),

  -- If true, subscription will not renew at current_period_end.
  -- Access continues until end of period; status transitions to cancelled.
  cancel_at_period_end     boolean                     NOT NULL DEFAULT false,

  CONSTRAINT subscriptions_period_order
    CHECK (current_period_end > current_period_start)
);

COMMENT ON TABLE public.subscriptions IS
  'Billing state for each firm. Tracks tier, pricing, seat count, and payment '
  'provider references. Phase 1: one row per firm (UNIQUE firm_id). Future: '
  'relax unique constraint and use status+created_at for subscription history.';

COMMENT ON COLUMN public.subscriptions.price_per_user_eur_cents IS
  'Per-seat monthly price in Euro cents at time of subscription creation. '
  'Immutable snapshot — price changes create a new subscription row. '
  'Annual billing: stored as monthly equivalent (e.g. €39/mo → 3900 cents), '
  'invoice multiplied by 12 at billing cycle start.';

COMMENT ON COLUMN public.subscriptions.seat_count IS
  'Licensed seat count. Adding seats mid-cycle triggers a prorated charge '
  'via the payment provider. Reducing seats takes effect at next renewal.';

COMMENT ON COLUMN public.subscriptions.provider_subscription_id IS
  'Opaque ID from the payment provider (Viva Wallet subscription_id, '
  'Εθνική agreement_ref, or NULL for manual invoicing). Used to correlate '
  'incoming webhooks (payment.succeeded, payment.failed, subscription.cancelled).';

COMMENT ON COLUMN public.subscriptions.cancel_at_period_end IS
  'Cancellation flag set when firm submits cancellation request. '
  'Access continues until current_period_end; at that point a cron job '
  'transitions status → cancelled and firms.status → cancelled.';

CREATE INDEX IF NOT EXISTS subscriptions_firm_id_idx ON public.subscriptions (firm_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx  ON public.subscriptions (status);


-- ---------------------------------------------------------------------------
-- 5. TABLE: audit_global
--    Append-only audit log for cross-tenant operations: firm provisioning,
--    schema migrations, payment events, super-admin actions.
--    Partitioned by month (RANGE on occurred_at).
--    UPDATE and DELETE are REVOKED to enforce immutability.
--
--    Per-tenant audit (matter events, document access, billing items) lives
--    in the firm schema as audit_log and audit_privilege_access.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_global (
  id           bigserial,  -- bigserial for high-throughput insert; UUID unnecessary here
  occurred_at  timestamptz NOT NULL DEFAULT now(),

  -- Who triggered the action.
  actor_type   public.audit_actor_type NOT NULL,
  actor_id     text                    NULL,  -- UUID or key prefix; NULL for 'system'

  -- Structured action code. Convention: '<entity>.<verb>'
  -- Examples: 'firm.created', 'firm.suspended', 'subscription.renewed',
  --           'tenant_schema.migrated', 'admin.login', 'firm.deleted'
  action       text        NOT NULL,

  -- What the action targeted.
  target_type  text        NULL,  -- e.g. 'firm', 'subscription', 'firm_user'
  target_id    text        NULL,  -- UUID or slug of the target entity

  -- Structured before/after state, event metadata, or error details.
  -- PII in payload must be envelope-encrypted before INSERT.
  payload      jsonb       NULL,

  -- Network context for security forensics.
  ip_address   inet        NULL,
  user_agent   text        NULL,

  -- M5: PRIMARY KEY required for ON CONFLICT, logical replication, and row-level
  -- references. Must include the partition key (occurred_at) per PG requirement.
  -- bigserial sequence is shared across all partitions (no duplicate IDs by
  -- sequence allocation), but without a PK the uniqueness is not enforced at DB level.
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE public.audit_global IS
  'Append-only audit log for cross-tenant and super-admin operations. '
  'Partitioned monthly by occurred_at. UPDATE/DELETE revoked on all roles '
  'to enforce immutability. Per-tenant events (matters, documents) live in '
  'the firm schema audit_log table. Retention: 7 years (financial events), '
  '5 years (non-financial), per GDPR N.4624/2019 §31.';

COMMENT ON COLUMN public.audit_global.action IS
  'Structured action code using <entity>.<verb> convention. '
  'Standard codes: firm.created, firm.suspended, firm.reactivated, '
  'firm.cancelled, subscription.created, subscription.renewed, '
  'subscription.past_due, subscription.cancelled, tenant_schema.migrated, '
  'firm_user.created, firm_user.deactivated, admin.login, admin.impersonate.';

COMMENT ON COLUMN public.audit_global.payload IS
  'Free-form JSONB for event-specific metadata. Convention: '
  '{"before": {...}, "after": {...}} for state changes; '
  '{"reason": "..."} for manual admin actions; '
  '{"provider_event_id": "..."} for payment webhooks. '
  'Any PII must be envelope-encrypted with the relevant firm DEK before INSERT.';

COMMENT ON COLUMN public.audit_global.actor_id IS
  'Identifies the actor within their type. '
  'system: NULL (no actor). '
  'admin: super-admin user ID. '
  'firm_user: firm_users.id as text. '
  'api: first 8 chars of the API key (never the full key).';

-- C6: Indexes MUST be created on the parent BEFORE partition bootstrap.
-- PG14+ propagates parent indexes to existing partitions at CREATE INDEX time,
-- and to future partitions at CREATE TABLE ... PARTITION OF time.
-- IF NOT EXISTS is safe on PG14+ (the PG13 child-partition bug is irrelevant:
-- the version guard above already aborts on PG < 14). Retained for re-run safety.
-- NOTE: Postgres 14+ assumed (CREATE INDEX propagates to existing partitions automatically).
-- TODO Day 7-10: Implement partition_maintenance worker that creates next 3 months'
--   audit_global partitions daily. Reference: docs/day2-daedalus-review.md C6.
CREATE INDEX IF NOT EXISTS audit_global_occurred_at_idx
  ON public.audit_global (occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_global_action_idx
  ON public.audit_global (action);

CREATE INDEX IF NOT EXISTS audit_global_target_idx
  ON public.audit_global (target_type, target_id);

-- Partitions: current month + next month (bootstrap; cron/worker adds future partitions).
-- C6: Partition maintenance gap — only current+next month seeded here.
--   A daily partition_maintenance worker (tenant_template.background_job type
--   'partition_maintenance') must create the next 3 months' partitions each day.
--   Without it, INSERT will fail on the 1st of the month after next with
--   "no partition of relation found for row". P0 production outage risk.
DO $$
DECLARE
  this_month_start  text := date_trunc('month', now())::date::text;
  next_month_start  text := date_trunc('month', now() + interval '1 month')::date::text;
  after_next_start  text := date_trunc('month', now() + interval '2 months')::date::text;
  this_part_name    text;
  next_part_name    text;
BEGIN
  this_part_name := 'audit_global_' || to_char(now(), 'YYYY_MM');
  next_part_name := 'audit_global_' || to_char(now() + interval '1 month', 'YYYY_MM');

  -- Current month partition
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = this_part_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.audit_global '
      'FOR VALUES FROM (%L) TO (%L)',
      this_part_name, this_month_start, next_month_start
    );
  END IF;

  -- Next month partition
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = next_part_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.audit_global '
      'FOR VALUES FROM (%L) TO (%L)',
      next_part_name, next_month_start, after_next_start
    );
  END IF;
END $$;

-- Append-only enforcement: revoke mutating privileges from all non-superuser roles.
-- Application roles (themis_app, themis_api) must only have INSERT + SELECT.
-- Superuser retains UPDATE/DELETE for emergency compliance erasure (requires 2-person approval).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT grantee
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'audit_global'
      AND privilege_type IN ('UPDATE', 'DELETE')
      AND grantee NOT IN ('postgres', 'rdsadmin', 'cloudsqladmin')
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON public.audit_global FROM %I', r.grantee);
  END LOOP;
END $$;

-- Static revoke for known application roles (idempotent; REVOKE on non-granted = no-op)
REVOKE UPDATE, DELETE ON public.audit_global FROM PUBLIC;


-- ---------------------------------------------------------------------------
-- 6. TABLE: firm_kms_keys
--    Encryption key metadata. Stores Vault path references and key versioning.
--    The actual key material NEVER appears in Postgres — only Vault paths.
--    Key hierarchy (D-DM-17):
--      Starter/Pro: Hetzner KMS shared root → per-tenant DEK
--      Firm:        Hetzner KMS dedicated root → per-tenant DEK
--      Enterprise:  BYOK + Shamir 3-of-5 custody opt-in
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.firm_kms_keys (
  id           uuid                  NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  firm_id      uuid                  NOT NULL
                 REFERENCES public.firms (id)
                 ON DELETE RESTRICT,  -- key metadata must outlive firm for erasure audit

  key_type     public.kms_key_type   NOT NULL,

  -- Vault KV path to the KEK-wrapped DEK for this version.
  -- Convention: 'kv/themisos/firms/<slug>/dek' (data key)
  --             'kv/themisos/firms/<slug>/pek' (privilege key)
  -- For BYOK Enterprise: 'kv/themisos/firms/<slug>/byok/dek'
  vault_path   text                  NOT NULL,

  -- Monotonically increasing. Version 1 = initial provisioning.
  -- Rotation: insert new row (version N+1, status=active),
  --           update old row to status=rotating, then retired after transition.
  key_version  integer               NOT NULL DEFAULT 1
                 CONSTRAINT firm_kms_keys_version_positive
                   CHECK (key_version >= 1),

  created_at   timestamptz           NOT NULL DEFAULT now(),

  -- NULL until first rotation has occurred.
  rotated_at   timestamptz           NULL,

  status       public.kms_key_status NOT NULL DEFAULT 'active',

  CONSTRAINT firm_kms_keys_firm_type_version_unique
    UNIQUE (firm_id, key_type, key_version)
);

COMMENT ON TABLE public.firm_kms_keys IS
  'Encryption key metadata for per-tenant DEKs and privilege encryption keys. '
  'Stores Vault path references ONLY — no key material ever stored in Postgres. '
  'Key hierarchy: Starter/Pro use shared Hetzner KMS root; Firm tier uses '
  'dedicated KMS root key; Enterprise supports BYOK with Shamir 3-of-5 custody. '
  'Spec ref: D-DM-17, Invariant #9.';

COMMENT ON COLUMN public.firm_kms_keys.vault_path IS
  'HashiCorp Vault KV path to the KEK-wrapped DEK for this key version. '
  'Convention: kv/themisos/firms/<slug>/dek (data encryption key), '
  'kv/themisos/firms/<slug>/pek (privilege encryption key). '
  'Enterprise BYOK: kv/themisos/firms/<slug>/byok/dek. '
  'Path is immutable per version — rotation creates a new row with new path.';

COMMENT ON COLUMN public.firm_kms_keys.key_version IS
  'Monotonically increasing version number. Version 1 = initial provisioning. '
  'During rotation: new row inserted (version N+1, status=active); '
  'old row updated to status=rotating (still decrypts in-flight requests); '
  'old row updated to status=retired after re-encryption sweep completes.';

COMMENT ON COLUMN public.firm_kms_keys.status IS
  'Key lifecycle state: '
  'active = current version, used for all new encryptions. '
  'rotating = previous version, decrypts existing ciphertext during transition. '
  'retired = obsolete, decrypt-only for archived ciphertext, no new encrypts.';

COMMENT ON COLUMN public.firm_kms_keys.rotated_at IS
  'Timestamp of the most recent key rotation that produced this row. '
  'NULL for the initial version 1 key created at firm provisioning. '
  'Used by compliance reports to verify annual rotation policy adherence.';

CREATE INDEX IF NOT EXISTS firm_kms_keys_firm_id_idx    ON public.firm_kms_keys (firm_id);
CREATE INDEX IF NOT EXISTS firm_kms_keys_status_idx     ON public.firm_kms_keys (firm_id, status);


-- ---------------------------------------------------------------------------
-- 7. UPDATED_AT TRIGGER (shared helper)
--    Fires on firms and subscriptions to keep updated_at current.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Generic trigger function that sets updated_at = now() before any UPDATE. '
  'Attach to any table with an updated_at column using a BEFORE UPDATE trigger.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'firms_set_updated_at'
  ) THEN
    CREATE TRIGGER firms_set_updated_at
      BEFORE UPDATE ON public.firms
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'subscriptions_set_updated_at'
  ) THEN
    CREATE TRIGGER subscriptions_set_updated_at
      BEFORE UPDATE ON public.subscriptions
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 8. MIGRATION METADATA
--    C1: Replaced broken INSERT INTO public.system_health (table did not exist)
--    with INSERT INTO public.schema_migrations (table created at top of file).
--    ON CONFLICT DO NOTHING ensures idempotency on re-run.
-- ---------------------------------------------------------------------------

INSERT INTO public.schema_migrations (version, description)
VALUES ('0001', 'Public schema: firms, users, subscriptions, audit, KMS metadata')
ON CONFLICT (version) DO NOTHING;
