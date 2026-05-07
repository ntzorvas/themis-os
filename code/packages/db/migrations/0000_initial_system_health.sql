-- Migration: 0000_initial_system_health
-- Σκοπός: Αρχική migration για επαλήθευση ότι το migration pipeline δουλεύει.
-- Αντικαθίσταται από 0001_public_schema.sql (Day 2) με το πλήρες public schema.
-- Αναφορά: docs/v03/data-model-v03.md §2

CREATE TABLE IF NOT EXISTS "system_health" (
  "key"        TEXT        NOT NULL PRIMARY KEY,
  "value"      TEXT        NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: επιβεβαίωση ότι η migration εκτελέστηκε
INSERT INTO "system_health" ("key", "value")
VALUES ('migration_version', '0000')
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = NOW();

-- Seed: product info (naming-neutral μέσω app_settings pattern)
INSERT INTO "system_health" ("key", "value")
VALUES ('product_slug', 'themisos')
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = NOW();
