-- =============================================================================
-- Migration 0006 — Calendar Events: extend schema for deadline rules engine
--
-- Context: Day 8 — rules engine + calendar API.
--   - Extends existing calendar_event table (0002_template_schema.sql) with:
--     * party_id column (nullable FK → party)
--     * deadline_rule_id (nullable — links to kpold rule)
--     * source_event_id (nullable FK self — recurrence source)
--     * soft_deleted_at (consistent with parties/documents soft-delete pattern)
--     * all_day flag
--     * title_gr (ελληνικός τίτλος — required for UI)
--     * description_gr (ελληνική περιγραφή)
--     * occurs_at (deadline-specific: single timestamptz, alias for starts_at logic)
--   - Adds 'court_holiday' + 'custom' values to calendar_event_type_t ENUM
--     (ALTER TYPE ... ADD VALUE is safe on Postgres 9.1+, IF NOT EXISTS on 12+)
--   - Adds deadline_rule_id index + soft_deleted_at index
--
-- All ALTER TABLE use ADD COLUMN IF NOT EXISTS (Postgres 9.6+).
-- All ALTER TYPE use ADD VALUE IF NOT EXISTS (Postgres 12+).
-- Idempotent: safe to run multiple times.
-- =============================================================================

-- ── 1. Extend ENUM with new values (tenant_template scope) ──────────────────

DO $$ BEGIN
  ALTER TYPE tenant_template.calendar_event_type_t ADD VALUE IF NOT EXISTS 'court_holiday';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE tenant_template.calendar_event_type_t ADD VALUE IF NOT EXISTS 'custom';
EXCEPTION WHEN others THEN NULL; END $$;

-- ── 2. Extend calendar_event table (runs in each tenant schema via clone) ───

-- We use DO blocks + IF NOT EXISTS so the migration is idempotent.
-- Each ADD COLUMN targets the table in the current search_path (tenant schema).

ALTER TABLE calendar_event
  ADD COLUMN IF NOT EXISTS party_id            uuid,
  ADD COLUMN IF NOT EXISTS deadline_rule_id    text,
  ADD COLUMN IF NOT EXISTS source_event_id     uuid,
  ADD COLUMN IF NOT EXISTS all_day             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS title_gr            text,
  ADD COLUMN IF NOT EXISTS description_gr      text,
  ADD COLUMN IF NOT EXISTS occurs_at           timestamptz,
  ADD COLUMN IF NOT EXISTS soft_deleted_at     timestamptz;

-- ── 3. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS calendar_event_party_id_idx
  ON calendar_event (party_id) WHERE party_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_event_deadline_rule_id_idx
  ON calendar_event (deadline_rule_id) WHERE deadline_rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_event_soft_deleted_idx
  ON calendar_event (soft_deleted_at) WHERE soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS calendar_event_occurs_at_idx
  ON calendar_event (occurs_at) WHERE occurs_at IS NOT NULL;

-- Source event FK-like index (FK enforced at app layer)
CREATE INDEX IF NOT EXISTS calendar_event_source_event_id_idx
  ON calendar_event (source_event_id) WHERE source_event_id IS NOT NULL;

-- ── 4. Comments ──────────────────────────────────────────────────────────────

COMMENT ON COLUMN calendar_event.party_id IS
  'Optional party reference (opposing counsel, court, etc.). FK enforced at app layer.';

COMMENT ON COLUMN calendar_event.deadline_rule_id IS
  'kpold rule ID used to auto-calculate occurs_at (e.g. "kpold-518-efesi-gnisia").';

COMMENT ON COLUMN calendar_event.source_event_id IS
  'Self-referential: original event for recurrences or continuations. FK enforced at app layer.';

COMMENT ON COLUMN calendar_event.occurs_at IS
  'For deadline events: the computed deadline timestamp (from rules engine). '
  'For hearings/meetings: same as starts_at. '
  'NULL if occurs_at not yet calculated.';

COMMENT ON COLUMN calendar_event.soft_deleted_at IS
  'Soft delete timestamp. NULL = active, NOT NULL = deleted. Consistent with party/document pattern.';
