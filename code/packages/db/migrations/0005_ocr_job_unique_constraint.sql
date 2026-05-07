-- Migration: 0005_ocr_job_unique_constraint.sql
-- Created: 2026-04-29
-- Purpose: Add UNIQUE constraint on ocr_job.document_id to support
--          ON CONFLICT (document_id) upsert pattern used by document
--          processing queue (apps/api/src/queues/document-processing.ts).
--
-- Detected by: Δοκιμασία Day 7 QA gate — runtime failure risk.
-- Spec ref: docs/day7-dokimasia-report.md (Critical Finding C1)
--
-- Applies to: tenant_template.ocr_job (cloned to firm_<slug>.ocr_job
--             at provisioning).
-- Idempotent: uses IF NOT EXISTS guard via DO block.
--
-- Backward compat: replaces non-unique index ocr_job_document_id_idx
-- (UNIQUE constraint creates its own backing index, so the old one
-- becomes redundant — dropped here).

-- ============================================================
-- TARGET SCHEMA
-- ============================================================

SET LOCAL search_path TO tenant_template;

-- ============================================================
-- 1. DROP REDUNDANT NON-UNIQUE INDEX
-- ============================================================

DROP INDEX IF EXISTS tenant_template.ocr_job_document_id_idx;

-- ============================================================
-- 2. ADD UNIQUE CONSTRAINT
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ocr_job_document_id_uq'
      AND conrelid = 'tenant_template.ocr_job'::regclass
  ) THEN
    ALTER TABLE tenant_template.ocr_job
      ADD CONSTRAINT ocr_job_document_id_uq UNIQUE (document_id);
  END IF;
END $$;

COMMENT ON CONSTRAINT ocr_job_document_id_uq ON tenant_template.ocr_job IS
  'One OCR job per document. Required by document-processing queue '
  'ON CONFLICT (document_id) DO UPDATE upsert pattern.';
