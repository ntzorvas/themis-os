# Contributing to ΘΕΜΙΣ OS

This document captures the **load-bearing conventions** that must be followed by every contributor (human or agent). It is not a style guide. It is a list of rules whose violation will silently produce broken databases, broken tenants, or broken audits.

For architecture, see `docs/data-model.md`, `docs/api-architecture.md`, `docs/aegis-spec.md`. For invariants, see the master architecture doc and the 10 invariants enforced by Pericles.

---

## 1. Tenant DDL convention (CRITICAL)

The runtime provisioner (`apps/api/src/routes/auth/index.ts → provisionFirm`) reads `packages/db/migrations/0002_template_schema.sql` as the **canonical source of truth** for every new firm's schema. It rewrites identifiers (`tenant_template.<x>` → `<firm_schema>.<x>`, preserving ENUM types `<x>_t` in `tenant_template`) and applies the result inside the new firm's schema.

Consequence:

> **Every schema-changing migration that targets per-tenant tables MUST patch `packages/db/migrations/0002_template_schema.sql` in the same change set.**

Otherwise:
- The numbered migration (e.g. `0009_add_foo.sql`) updates only the firms that already exist when you ship it.
- Every firm registered **after** your ship date will be born with the OLD schema (provisioner reads the un-patched template).
- The drift is silent until a code path hits the missing column / table / index, which is usually a customer-facing error.

### Workflow

For a per-tenant DDL change:

1. Write the numbered migration (e.g. `0009_add_foo.sql`):
   - Target `tenant_template` first.
   - Loop over `information_schema.schemata WHERE schema_name LIKE 'firm\_%' ESCAPE '\'` to apply the same change to every existing firm schema.
   - Make it idempotent (`IF EXISTS` / `IF NOT EXISTS` checks).
   - See `0008_normalize_soft_delete.sql` for the canonical pattern.
2. Patch `0002_template_schema.sql`:
   - Find the affected `CREATE TABLE` / `CREATE INDEX` / `CREATE TYPE` block.
   - Apply the equivalent DDL **in place** (so a fresh `psql -f 0002_template_schema.sql` produces the new shape).
3. Run the convention check (see section 2).
4. Test by provisioning a fresh firm via the smoke test (`scripts/smoke-test-phase1.mjs`) — verify the new firm's schema has the change.

### Why we do not use `pg_dump`

A natural alternative is "let the provisioner dump the live `tenant_template` schema instead of reading the SQL file." We deliberately do NOT do this:

- The current code maintains an **ENUM-sharing strategy**: ENUM types live in `tenant_template` and are referenced by tenant tables as `tenant_template.<name>_t`. They are NOT duplicated per firm. A naive `pg_dump --schema=tenant_template` would dump the ENUMs alongside tables, requiring the same rewriting logic on top — same coupling, more moving parts, plus a binary dependency.
- The SQL file is hand-curated for readable ordering, comments, and grouping. `pg_dump` output is mechanical and loses this.
- Source-controlled SQL is reviewable in PRs; a runtime dump is not.

The "necessary architectural coupling" between provisioner and `0002_template_schema.sql` is **load-bearing**. The convention check (section 2) makes the coupling visible at PR time.

---

## 2. Migration convention check

Run before every PR that adds a numbered migration:

```bash
# vs HEAD~1 (last commit)
scripts/check-migration-touches-template.sh

# vs explicit base ref
scripts/check-migration-touches-template.sh main

# vs staged index (pre-commit hook)
scripts/check-migration-touches-template.sh --staged
```

Exit code 0 = OK. Exit code 1 = violation, fix before merge.

Override (rare — only for infra-only migrations that genuinely do not touch tenant DDL):

```bash
THEMIS_SKIP_TEMPLATE_CHECK=1 scripts/check-migration-touches-template.sh
```

Pre-commit hook (suggested local install):

```bash
cat > .git/hooks/pre-commit <<'HOOK'
#!/usr/bin/env bash
exec scripts/check-migration-touches-template.sh --staged
HOOK
chmod +x .git/hooks/pre-commit
```

---

## 3. Soft-delete convention

All tenant tables that support soft-delete use the column name **`soft_deleted_at TIMESTAMPTZ`** (NULL = active row, non-NULL = soft-deleted timestamp). The shorter name `deleted_at` is **NOT** used.

Filtered indexes follow the pattern:

```sql
CREATE INDEX <name>_idx ON <table> (<cols>) WHERE soft_deleted_at IS NULL;
```

History: migration `0008_normalize_soft_delete.sql` (2026-04-29) renamed the lone outlier `matter.deleted_at` → `matter.soft_deleted_at` across `tenant_template` and all already-provisioned firm schemas, and patched `0002_template_schema.sql` so newly provisioned firms are correct from creation. See `docs/data-model.md` → "Soft-delete convention" for full rationale.

---

## 4. Audit log immutability

`audit_log` is `INSERT`-only. Migrations that issue `UPDATE`, `DELETE`, `TRUNCATE`, or destructive `ALTER` against `audit_log` are rejected (Invariant #8). Schema additions (new columns, new indexes) are allowed; data mutation is not.

If you need to "delete" audit entries (e.g. GDPR right-to-be-forgotten), the correct pattern is **redaction in place** via a UPDATE that sets PII columns to a tombstone marker, recorded in a separate audit row that documents the redaction. Never `DELETE`.

---

## 5. Other constants

- **No `npm install` in `gg4-pm`** — breaks GG4 pipeline deps (Invariant #9, MECE-wide rule).
- **No raw PII to external LLMs** — anonymize first (Invariant #5). Pipeline lives in the AI/Aegis service.
- **No `tenant_id` column on per-tenant tables** — Invariant #6 (single-tenant per firm). Isolation is at the deployment level, not the row level.
- **Money in `BIGINT` cents/lepta** — never `FLOAT`/`NUMERIC` for currency.
- **Timestamps in `TIMESTAMPTZ`** — UTC stored, Europe/Athens displayed.

---

## 6. Smoke test before merge

For any change touching the API, run the Phase 1 smoke test against your local or preview environment:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/themisos_preview \
THEMIS_API_URL=http://localhost:4100 \
node scripts/smoke-test-phase1.mjs
```

Target: 17/17 passing. Steps 16 and 17 require `DATABASE_URL` to be set (audit log query + cleanup). The host needs `psql` installed (`apt install postgresql-client`).

If the rate limiter blocks a re-run (3 firms / hour / IP on `register-firm`), restart the API to clear in-memory state: `pm2 restart themis-api`.
