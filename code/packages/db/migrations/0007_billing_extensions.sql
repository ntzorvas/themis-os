-- Migration: 0007_billing_extensions.sql
-- Created: 2026-04-29
-- Purpose: Indexes and extensions for Day-9 billing engine
--
-- Prerequisites: 0002_template_schema.sql (Section E tables must exist)
--
-- Changes:
--   1. Composite index on time_entry for unbilled-billable lookup (draft invoice creation)
--   2. Composite index on expense for unbilled-billable lookup
--   3. Partial index on invoice for draft invoice number uniqueness guard
--   4. Index on invoice_line.source_id for finalize step (UPDATE time_entry/expense)
--   5. Composite index on matter_party for billing_split queries
--
-- Note: invoice_number UNIQUE constraint already on invoice table (0002).
--       DRAFT- prefix invoices are replaced atomically on finalize.
--       No new tables — all Section E tables complete in 0002.

SET LOCAL search_path TO tenant_template;

-- 1. Unbilled time entries lookup (POST /invoices/draft hot path)
CREATE INDEX IF NOT EXISTS time_entry_unbilled_billable_idx
  ON time_entry (matter_id, billable, status)
  WHERE billable = true AND status = 'draft' AND invoice_id IS NULL;

-- 2. Unbilled expenses lookup (POST /invoices/draft hot path)
CREATE INDEX IF NOT EXISTS expense_unbilled_billable_idx
  ON expense (matter_id, billable, status)
  WHERE billable = true AND status = 'draft' AND invoice_id IS NULL;

-- 3. Invoice by matter + status (GET /invoices and finalize guard)
CREATE INDEX IF NOT EXISTS invoice_matter_status_idx
  ON invoice (matter_id, status)
  WHERE matter_id IS NOT NULL AND status NOT IN ('cancelled');

-- 4. invoice_line.source_id for finalize UPDATE queries
-- source_id is text (UUID stored as text per 0002 comment)
CREATE INDEX IF NOT EXISTS invoice_line_source_id_idx
  ON invoice_line (invoice_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

-- 5. matter_party billing split lookup
CREATE INDEX IF NOT EXISTS matter_party_billing_split_idx
  ON matter_party (matter_id, side, billing_split_percentage)
  WHERE side = 'ours'
    AND billing_split_percentage IS NOT NULL
    AND valid_to IS NULL;
