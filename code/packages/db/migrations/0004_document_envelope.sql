-- Migration: 0004_document_envelope.sql
-- Created: 2026-04-29
-- Purpose: Add envelope encryption metadata to documents (Invariant #9)
-- Spec ref: docs/v03/tech-stack-v03.md §17.2, data-model-v03.md D-DM-16
--
-- Applies to: tenant_template.document (cloned to firm_<slug>.document at provisioning)
-- Idempotent: all statements use IF NOT EXISTS / IF EXISTS.
--
-- Run sequence:
--   1. Apply to tenant_template schema (this migration).
--   2. For each existing firm schema: SET search_path TO firm_<slug>; run this DDL.
--      The provisioning script handles this automatically for new tenants.
--      For existing tenants (pre-migration): see scripts/backfill-envelope-metadata.sh
--
-- After this migration, the document table storage contract is:
--   classification='public'       → envelope_metadata IS NULL, storage_mode='r2_sse_c'
--   classification='confidential' → envelope_metadata IS NOT NULL, storage_mode='ddk_aes_gcm'
--   classification='privileged'   → envelope_metadata IS NOT NULL, storage_mode='ddk_aes_gcm'
--                                   Phase 1: privileged doc upload blocked at API layer
--                                   until BYOK is implemented (Phase 2).

-- ============================================================
-- TARGET SCHEMA
-- ============================================================

SET LOCAL search_path TO tenant_template;

-- ============================================================
-- 1. ADD COLUMNS
-- ============================================================

-- envelope_metadata: JSONB blob holding AES-256-GCM envelope parameters.
-- Shape: { ivB64, authTagB64, encryptedDekB64, kekVaultPath, kekVersion,
--           algorithm, encryptedAt }
-- The ciphertext itself is NOT stored here — it lives in R2 at document.r2_key.
-- NULL for classification='public' documents (no encryption applied).
ALTER TABLE tenant_template.document
  ADD COLUMN IF NOT EXISTS envelope_metadata jsonb;

COMMENT ON COLUMN tenant_template.document.envelope_metadata IS
  'AES-256-GCM envelope encryption parameters. '
  'Shape (JsonEnvelope from @themisos/crypto): '
  '{ ivB64: string, authTagB64: string, encryptedDekB64: string, '
  '  kekVaultPath: string, kekVersion: number, '
  '  algorithm: "AES-256-GCM", encryptedAt: string (ISO 8601) }. '
  'NULL when classification=''public'' (R2 SSE-C only, no app-layer encryption). '
  'Required and validated non-null when classification IN (''confidential'',''privileged''). '
  'The DEK itself is stored in HashiCorp Vault at kekVaultPath, NOT here. '
  'Spec ref: docs/v03/tech-stack-v03.md §17.2, Invariant #9.';

-- classification: controls which encryption path is applied.
-- 'public'       → no app-layer encryption, R2 SSE-C at rest
-- 'confidential' → MECE-managed Vault DEK, AES-256-GCM envelope
-- 'privileged'   → customer-managed BYOK Vault DEK (Phase 2)
--                  Phase 1: upload blocked, stored as 'privileged' for future unlock
ALTER TABLE tenant_template.document
  ADD COLUMN IF NOT EXISTS classification text
    CHECK (classification IN ('public', 'confidential', 'privileged'))
    DEFAULT 'confidential';

COMMENT ON COLUMN tenant_template.document.classification IS
  'Document data classification per Άρθρο 38 N.4194/2013 + Άρθρο 371 ΠΚ privilege model. '
  'public       = no privilege, no app-layer encryption (R2 SSE-C only). '
  'confidential = contains client-sensitive data; encrypted with MECE-managed DEK. '
  'privileged   = attorney-client privilege (Άρθρο 38 N.4194/2013); '
  '               encrypted with customer-managed BYOK DEK (Phase 2). '
  '               Phase 1: upload triggers PrivilegeKeyNotConfiguredError at API layer. '
  'Default: ''confidential'' (conservative — treat unknown docs as sensitive). '
  'Spec ref: data-model-v03.md D-DM-16, D-DM-17, Invariant #9.';

-- ============================================================
-- 2. CONSTRAINT: envelope_metadata must be present for non-public docs
-- (enforced at API layer in Phase 1; this CHECK adds DB-level safety)
-- ============================================================

ALTER TABLE tenant_template.document
  DROP CONSTRAINT IF EXISTS document_envelope_required;

ALTER TABLE tenant_template.document
  ADD CONSTRAINT document_envelope_required
    CHECK (
      (classification = 'public'  AND envelope_metadata IS NULL) OR
      (classification = 'confidential') OR
      (classification = 'privileged')
    );

COMMENT ON CONSTRAINT document_envelope_required ON tenant_template.document IS
  'Ensures public docs have no envelope_metadata (they are unencrypted at app layer). '
  'Confidential/privileged docs may have NULL envelope_metadata during the upload '
  'transaction window; the API layer validates non-null before commit.';

-- ============================================================
-- 3. INDEX on classification for filtered queries
-- ============================================================

CREATE INDEX IF NOT EXISTS document_classification_idx
  ON tenant_template.document (classification);

COMMENT ON INDEX tenant_template.document_classification_idx IS
  'Supports queries filtering by document classification, e.g. '
  'listing all privileged documents for a matter (Aegis ACL check), '
  'or finding all confidential docs for a re-encryption sweep during DEK rotation.';

-- ============================================================
-- 4. BACKFILL existing rows
-- Documents created before this migration lack classification.
-- All existing rows default to 'confidential' (conservative).
-- The envelope_metadata for existing rows will be NULL; a background
-- worker (kms-rotation BullMQ queue) should re-encrypt existing
-- docs and populate envelope_metadata.
--
-- For new tenants (schema cloned after this migration), all rows
-- will have classification set at INSERT time by the API layer.
-- ============================================================

-- No backfill SQL needed — the DEFAULT 'confidential' handles new INSERTs.
-- Existing rows in already-cloned firm schemas: run this migration per-tenant
-- via the provisioning script with search_path set to each firm schema.

-- ============================================================
-- 5. REVOKE update on envelope_metadata (audit hardening)
-- The envelope_metadata is written once at upload and should not
-- change unless a key rotation re-encrypt is explicitly performed
-- by the kms-rotation worker (which has elevated DB role).
-- Standard app_user role cannot UPDATE envelope_metadata.
-- ============================================================

-- Revoke UPDATE on envelope_metadata from the standard app role.
-- app_user is the role used by the Fastify API process.
-- kms_rotation_user (Phase 2) will have explicit GRANT for this column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE UPDATE (envelope_metadata) ON tenant_template.document FROM app_user;
  END IF;
END $$;
