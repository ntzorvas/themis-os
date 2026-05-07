-- Migration: 0003_auth_password_reset.sql
-- Created: 2026-04-29
-- Purpose: Add password_reset_tokens to tenant_template schema
-- Spec ref: docs/day4-auth-notes.md §forgot-password
-- Architecture: table lives in each firm's per-tenant schema (cloned from tenant_template).
--   Token raw value NEVER stored — only sha256 hash.
--   Provisioning script must run this against tenant_template BEFORE new firm signups.

-- ---------------------------------------------------------------------------
-- TABLE: password_reset_tokens
-- Single-use tokens for the forgot-password → reset-password flow.
-- Token raw value emailed to user; only sha256 stored here.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_template.password_reset_tokens (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK enforced at application layer (not DB FK) because firm_users lives in
  -- public schema while this table lives in the per-tenant schema.
  -- Query: SELECT * FROM public.firm_users WHERE id = user_id to verify.
  user_id             uuid        NOT NULL,

  -- sha256(raw_token_hex) — never the raw token itself.
  -- Comparison: encode(digest(submitted_token, 'sha256'), 'hex') = token_hash
  token_hash          text        NOT NULL,

  expires_at          timestamptz NOT NULL,

  -- Set when token is consumed. NULL = unused.
  -- Tokens where used_at IS NOT NULL must be rejected.
  used_at             timestamptz NULL,

  -- IP address of the reset request for security forensics.
  ip_requested_from   inet        NULL,

  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenant_template.password_reset_tokens IS
  'Single-use tokens for password reset flow. '
  'Token raw value is emailed to the user; only sha256 hash stored here. '
  'Expired (expires_at < now()) or used (used_at IS NOT NULL) tokens are rejected. '
  'Retention: rows pruned by maintenance cron after 24h (regardless of expiry).';

COMMENT ON COLUMN tenant_template.password_reset_tokens.token_hash IS
  'sha256 hash of the 32-byte hex token sent in the reset link. '
  'Compute as: encode(digest(submitted_token, ''sha256''), ''hex'') and compare. '
  'Raw token NEVER stored — prevents credential leak via DB read.';

COMMENT ON COLUMN tenant_template.password_reset_tokens.user_id IS
  'FK to public.firm_users.id — enforced at application layer. '
  'Cross-schema FK (public ↔ per-tenant) is not possible in Postgres; '
  'application must validate the user still exists and is_active=true.';

-- Lookup by user to enforce rate-limiting at application level
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
  ON tenant_template.password_reset_tokens (user_id);

-- Primary lookup path: find token record by hash for verification
CREATE INDEX IF NOT EXISTS password_reset_tokens_token_hash_idx
  ON tenant_template.password_reset_tokens (token_hash);

-- Partial index for maintenance cron and rate-limit queries (unused tokens only)
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
  ON tenant_template.password_reset_tokens (expires_at)
  WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- MIGRATION METADATA
-- ---------------------------------------------------------------------------

INSERT INTO public.system_health ("key", "value")
VALUES ('migration_version', '0003')
ON CONFLICT ("key") DO UPDATE
  SET "value"      = EXCLUDED."value",
      "updated_at" = now();
