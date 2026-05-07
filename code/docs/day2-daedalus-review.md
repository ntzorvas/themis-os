# Day 2 Architectural Review — Δαίδαλος

**Reviewer:** Δαίδαλος (Master Coding Architect)
**Date:** 2026-04-29
**Artifacts under review:**
- `/root/projects/themis-os/code/packages/db/migrations/0001_public_schema.sql` (632 lines)
- `/root/projects/themis-os/code/packages/db/migrations/0002_template_schema.sql` (1,777 lines)
- `/root/projects/themis-os/code/apps/api/src/plugins/fastify-tenant.ts` (494 lines)

---

## VERDICT

**RED — must fix before Gate G1.**

The work is structurally sound and demonstrates deep understanding of the domain. However there are **6 critical defects** that either (a) make the migrations un-runnable as written, (b) break Invariant #9 (cryptographic privilege), or (c) undermine multi-tenant isolation. None are show-stoppers in design — all are 1-2 hour fixes — but they are non-negotiable before G1.

---

## 1. CRITICAL ISSUES (must fix before Gate G1)

### C1 — `0001` references `public.system_health` which does not exist

**File:** `0001_public_schema.sql:628-632`

```sql
INSERT INTO public.system_health ("key", "value")
VALUES ('migration_version', '0001')
ON CONFLICT ("key") DO UPDATE
  SET "value"      = EXCLUDED."value",
      "updated_at" = now();
```

**Problem:** The migration's final statement writes to `public.system_health` but no `CREATE TABLE system_health` exists anywhere in `0001` (verified by grep). The migration will hard-error on first run with `relation "public.system_health" does not exist` and roll back the entire transaction (or leave a half-applied migration depending on runner).

**Fix direction:** Either (a) drop the stamping statement and replace it with a dedicated `schema_migrations` table created at the top of `0001`, or (b) add a `CREATE TABLE IF NOT EXISTS public.system_health (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())` before line 628. Decide once — Hermes/migration runner needs a stable schema versioning table anyway.

**Test:** `psql -d themis_shared -f 0001_public_schema.sql` against a fresh DB. Must complete with exit code 0. Re-run must also succeed (idempotency).

---

### C2 — `withTenantSchema` SQL is invalid: `SET LOCAL search_path` cannot be parameterised by `tx(identifier)`

**File:** `fastify-tenant.ts:420-424`

```ts
return pool.begin(async (tx) => {
  await tx`SET LOCAL search_path TO ${tx(schemaName)}, tenant_template, public`;
  return queryFn();
});
```

**Problem:** `SET` in PostgreSQL is a utility statement, **not** a normal DML statement; `postgres.js` `tx(identifier)` works inside SQL contexts that allow placeholders, but `SET ... TO <ident_list>` historically requires a literal identifier list — `postgres.js` will emit `SET LOCAL search_path TO $1, tenant_template, public` and Postgres will reject it with `ERROR: syntax error at or near "$1"`. Even if `postgres.js` substitutes inline (it does for `tx(...)`), it will quote it as `"firm_acme_legal"` which works — **but** the second issue is worse: `queryFn()` returns a promise whose internal queries run on the **outer pool**, not on `tx`. So `SET LOCAL` is set on `tx`'s connection, while the actual query lands on a different pool connection where `search_path` is still `public`. Tenant isolation silently fails.

**Fix direction:**
1. Validate `schemaName` against the same regex used at line 416 (already present — good).
2. Build the SET as a static string after whitelist validation: `await tx.unsafe(\`SET LOCAL search_path TO "\${schemaName}", tenant_template, public\`)`. (`unsafe` is acceptable here only because the input is whitelisted.)
3. Change the `queryFn` signature to receive `tx` as an argument: `(tx) => Promise<T>` — and update all call-sites. Otherwise the helper provides false safety.

**Test:** Integration test that (a) inserts into `firm_acme.matter` via `withTenantSchema(req, tx => tx\`INSERT INTO matter ...\`)`, (b) opens a second connection on the bare pool, (c) verifies `SELECT count(*) FROM firm_acme.matter` from the bare pool returns 1 and `SELECT count(*) FROM tenant_template.matter` returns 0. Repeat 50 times concurrently to catch pool-leak.

---

### C3 — Missing `document_privilege` table breaks Invariant #9 (D-DM-16/19)

**File:** `0002_template_schema.sql` — no `document_privilege` table exists.

**Problem:** The v0.3 spec (`data-model-v03.md` §8 + D-DM-16 row in §3.0 mandate-table) specifies:
- `document_privilege` table with `ddk_wrapped BYTEA`, `tag ENUM`, `visible_to_party_ids UUID[]`, `visible_to_team_ids UUID[]`, `ddk_version SMALLINT`.
- v0.2 `document.privilege_tag` column is dropped; replaced by this table.
- Without `document_privilege`, there is no place to store the per-document DDK ciphertext, no granular ACL, and no DDK rotation tracking. The crypto layer of Invariant #9 ("Defense in depth, layer 1") **does not exist**.

The migration instead carries `document.is_privileged BOOLEAN` and `document.storage_mode ENUM ('r2_sse_c','ddk_aes_gcm')`. That is the v0.2 design, not v0.3. The reviewer's self-reported deviation (#6) frames this as "retains storage_mode column from v0.3" — but storage_mode without a DDK store is a pointer to nowhere.

The migration also lacks the spec's `audit_privilege_access` columns: `document_privilege_id`, `privilege_tag_at_access`, `accessor_user_id`, `access_outcome`, `ddk_unwrap_performed`, `acl_snapshot`. The current table has `user_id`, `action`, `justification` — a flat reduction that loses the forensic chain the spec demands.

**Fix direction:**
1. Add `document_privilege` table per `data-model-v03.md` §8.3 (full DDL is in the spec, lines ~822-855).
2. Restructure `audit_privilege_access` to match spec §8 column list: rename `user_id→accessor_user_id`, add `document_privilege_id`, `privilege_tag_at_access`, `access_outcome`, `ddk_unwrap_performed`, `acl_snapshot`.
3. Add the two CHECK constraints from spec lines 846-852 (`privilege_portal_block`, `privilege_ai_block`) — these are crypto-enforced invariants.
4. Add `kms_custody_share` table mentioned in §6 footnote (Phase 1 enterprise BYOK).

**Test:** SQL-level: `INSERT INTO document_privilege (document_id, tag, ddk_wrapped, ...)` succeeds; `INSERT INTO document_share (document_id, ...)` against a privileged doc must be rejected (or audit-logged) by the application layer — add a smoke test.

---

### C4 — `DEFERRABLE` constraint trigger on `matter_party` will fire after every statement, not at COMMIT

**File:** `0002_template_schema.sql:788-792`

```sql
DROP TRIGGER IF EXISTS trg_billing_split ON matter_party;
CREATE CONSTRAINT TRIGGER trg_billing_split
  AFTER INSERT OR UPDATE OR DELETE ON matter_party
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_billing_split();
```

The function checks `SUM(billing_split_percentage) <> 100`. **Problem:** any partial INSERT (e.g. inserting the first row of a new matter team where SUM is currently 25%) will violate the check until all rows are inserted. With `DEFERRABLE INITIALLY DEFERRED` Postgres will defer to commit-time — that's correct in design — **but** the function uses `RAISE EXCEPTION` which aborts the transaction at commit if total is non-100. This breaks any matter that does **not yet have any 'ours' rows with billing_split set** (e.g. pro-bono, contingency, or matters where billing_split is intentionally NULL). The query `SUM(... WHERE billing_split_percentage IS NOT NULL) IS NOT NULL AND <> 100` saves only the all-NULL case but breaks the case "I have 1 attorney with split=100, then I add a 2nd attorney with NULL split" — SUM=100, valid; "1 attorney 50, 1 attorney NULL" — SUM=50, INVALID, transaction rolls back at commit even though the user intended to fill in the second split next.

Also: the trigger fires on **every** matter_party row but checks a **matter-wide** invariant. On bulk import of 100 matters with 5 parties each, the trigger runs 500 times computing the same SUM. Performance cliff at scale.

**Fix direction:**
1. Make the constraint matter-scoped: only enforce when ALL active 'ours' rows for that matter have non-NULL billing_split (i.e. don't fail when split is "not yet decided"). Or: add a `billing_split_locked` column and only validate when locked.
2. Aggregate-level enforcement is better done as a check in the API service layer with a `SELECT ... FOR UPDATE` lock on the matter row, or via a periodic data-quality job — not as an immediate constraint trigger.
3. If keeping the trigger, switch to `STATEMENT`-level rather than `ROW`-level and dedupe by matter_id to amortise.

**Test:** Insert one matter_party with split=50, COMMIT. Expect: (current code) ROLLBACK with BILLING_SPLIT_INVALID; (correct behaviour) COMMIT succeeds, billing flagged as "incomplete" in app reporting.

---

### C5 — ENUMs created in `tenant_template` will be **shared** across cloned tenant schemas (collision + isolation risk)

**File:** `0002_template_schema.sql:48-50, 59-305` (all `CREATE TYPE ... AS ENUM` blocks)

The migration uses `CREATE SCHEMA IF NOT EXISTS tenant_template; SET LOCAL search_path TO tenant_template;` then `CREATE TYPE user_role_t AS ENUM (...)`. Without an explicit schema-qualified name, `CREATE TYPE` resolves the type **into the current search_path** — that creates `tenant_template.user_role_t`.

**Problem:** When the provisioning script runs `CREATE SCHEMA firm_acme; SET search_path = firm_acme; <re-execute 0002 DDL verbatim>`, the `DO $$ BEGIN CREATE TYPE user_role_t ... EXCEPTION WHEN duplicate_object THEN NULL` blocks will **swallow the duplicate_object error from `tenant_template.user_role_t`**, then `CREATE TABLE users (... role user_role_t)` will resolve `user_role_t` via search_path — finding it in `tenant_template`. The result: every cloned firm schema's columns share the **same ENUM type instance** in `tenant_template`. If a future migration `ALTER TYPE tenant_template.user_role_t ADD VALUE 'auditor'`, all firms see it instantly — that may be intended, but it also means dropping `tenant_template` (or any per-schema ENUM management) becomes impossible without rewriting every dependent column type.

Worse: per the deviation note (#8), the intent was to **prevent** namespace collisions. Suffix `_t` does nothing for that — collisions occur on `(schema_name, type_name)` pairs, and types here all live in `tenant_template`.

**Fix direction:** Decide explicitly:
- **Option A — shared types** (current de-facto behaviour): make this explicit by always qualifying as `tenant_template.user_role_t` in column DDL, and document that ENUM additions are firm-global. Provisioning script should NOT re-run the CREATE TYPE blocks (skip lines 59-305 when search_path is set to a firm schema).
- **Option B — per-firm types**: prefix every CREATE TYPE with the current schema name dynamically (requires `EXECUTE format('CREATE TYPE %I.user_role_t ...')`), or run in a single search_path that includes only the target firm schema. Then types are isolated and `ALTER TYPE` is per-firm.

**Without an explicit decision, the system will silently work in development (single schema) and break in production (multi-tenant clones).**

**Test:** Provision two firms (firm_acme, firm_beta). `\dT firm_acme.*` should show types if Option B was chosen, or be empty if Option A. Insert with a value not in the enum — error message must reference the correct schema's type. Then `ALTER TYPE` and verify isolation/sharing matches the chosen option.

---

### C6 — `CREATE INDEX IF NOT EXISTS` on partitioned parent table is a Postgres 11-12 trap

**File:** `0001_public_schema.sql:470-477` and `0002_template_schema.sql:1519-1525`

```sql
CREATE INDEX IF NOT EXISTS audit_global_occurred_at_idx
  ON public.audit_global (occurred_at DESC);
```

Postgres 11+ propagates indexes to existing partitions on `CREATE INDEX` — **but** if a partition is added later (as your monthly cron will), the new partition gets the index automatically only if the parent index exists at the moment of `CREATE TABLE ... PARTITION OF`. This is fine in steady state.

**Two real problems:**
1. The `IF NOT EXISTS` clause on partitioned parent indexes was buggy in PG13 and earlier — it can succeed but leave child partitions un-indexed in some upgrade paths. Confirm target Postgres version (16+ recommended) and remove `IF NOT EXISTS` if migration runner already enforces idempotency.
2. The audit partitions for the current month + next month are created in the same DO block but **before** the indexes are created (lines 431-467 vs 470-477). On Postgres < 14, this can leave the bootstrap partitions without the indexes that will be auto-attached on later `CREATE INDEX` (no, actually, Postgres will attach to existing partitions — but this is version-specific). Audit this on the actual target version.

Also: **no scheduled job or `pg_cron` is configured to create future partitions**. The bootstrap creates current + 1 future partition only. On the 1st of next month + 1, INSERTs will fail with `no partition of relation found for row`. This is a P0 production outage waiting to happen.

**Fix direction:**
1. Move all index creation **before** the `DO $$ ... CREATE TABLE ... PARTITION OF` block, OR explicitly attach indexes to each partition after creation.
2. Add a `background_job` of type `partition_maintenance` that runs daily and ensures the next 3 months' partitions exist. Reference: 0002 already has `background_job` table — wire it in the worker.
3. Document the assumed Postgres version (looks like 14+ based on syntax). Add a `SELECT current_setting('server_version_num')::int >= 140000` guard at the top of 0001.

**Test:** Set system clock to last day of month. Insert audit row with `occurred_at = now() + interval '32 days'`. Expect failure (proves the gap exists). Then run the maintenance job, retry, expect success.

---

## 2. MAJOR ISSUES (should fix in Sprint 1)

### M1 — `pool` is not actually a pool; tenant cache is per-process

**File:** `fastify-tenant.ts:51, 141`

`import { pool } from '@themisos/db'` — `postgres.js` connections are pooled by default but `pool` is a single client. The Map cache is **per Node process**. With 4 PM2 instances, a `clearTenantCache('acme')` call on instance 1 leaves instances 2/3/4 with stale data for up to 60s. For tier/status changes this can cause:
- 60s of access to a suspended firm (acceptable per spec, but should be < 5s for billing/legal compliance).
- 60s of stale tier (Starter user gets Pro features after upgrade — acceptable; reverse case is a security gap).

**Fix direction:** Replace Map with Redis-backed cache (we already run Redis for BullMQ) keyed by `firm:slug:<slug>`, or publish invalidation events via Redis pub/sub on writes. Or: lower TTL to 5-10s during Phase 1 and accept the DB cost.

### M2 — `lookupFirmBySlug` cache stampede

**File:** `fastify-tenant.ts:196-242`

On cache miss, N concurrent requests all hit `pool` with the same SELECT. For a hot subdomain at 100 req/s, every 60s there are ~100 simultaneous identical lookups. Solve with single-flight: keep a `Map<string, Promise<FirmRow>>` of in-flight lookups; second caller awaits the first promise. Standard pattern.

### M3 — `lookupFirmBySlug` writes to cache **after** sending 403, but only for `suspended`/`cancelled`

**File:** `fastify-tenant.ts:213-238`

Suspended firms are **not cached** (the function returns null after sending 403, never reaching `setCached`). So every request to a suspended firm hits the DB. Cheap attack: spam suspended-firm-slug requests → DB CPU saturation. Cache the suspended/cancelled result with a shorter TTL too, return early from cache, avoid the SELECT.

### M4 — `firm_users.email` is not normalized

**File:** `0001_public_schema.sql:243` (`UNIQUE (firm_id, email)`)

UNIQUE on `email` allows `Niko@MECE.GR` and `niko@mece.gr` as two distinct rows — duplicate accounts. Use either (a) a `lower(email)` expression on the unique constraint, or (b) a `BEFORE INSERT` trigger to lowercase. Tenant template `users` does this correctly at line 342 — public.firm_users does not.

### M5 — `audit_global` partition PRIMARY KEY missing

**File:** `0001_public_schema.sql:373-400`

Comment at line 398-399 says "no PRIMARY KEY declared at table level — each partition inherits the constraint. Declared below after partition creation." — but **no PRIMARY KEY is ever declared**. By contrast, `audit_log` in 0002 correctly declares `PRIMARY KEY (id, occurred_at)` inline at line 417. Fix: add `PRIMARY KEY (id, occurred_at)` to `public.audit_global`. Otherwise `bigserial` produces duplicate values per partition under high write load (each partition uses the same sequence but no constraint enforces uniqueness across the partitioned parent).

Actually — `bigserial` creates **one** sequence at the parent level that is shared across all partitions, so duplicates don't happen by sequence allocation. **But** without a PK, you cannot do `ON CONFLICT`, cannot reference a row by ID, cannot use logical replication on the table. Add the PK.

### M6 — `firm_users.password_hash` has no length enforcement; `mfa_secret` plaintext at TEXT

**File:** `0001_public_schema.sql:217, 241`

Spec calls out `mfa_secret as text not bytea` as a self-deviation. With pgcrypto's `pgp_sym_encrypt` returning `bytea`, storing as `text` requires a base64 round-trip — fine, but document the encoding contract explicitly in the column comment (it currently just says "pgp_sym_encrypt'd" without specifying the wire format). Also: `password_hash text` should have a `CHECK (length(password_hash) BETWEEN 60 AND 200)` to catch obvious bugs (empty/garbage values).

### M7 — `withTenantSchema` validation regex is inconsistent with the canonical helper

**File:** `fastify-tenant.ts:416` vs `tenant-resolver.ts:44`

Both regex `^firm_[a-z0-9_]{1,27}$` — agree on length, but `getFirmSchemaName` truncates at `MAX_SLUG_LENGTH - 5 = 27` chars. The 0001 schema check is `^firm_[a-z0-9_]+$` (no upper bound). Three sources, three slightly different rules. Centralize in one place: export `FIRM_SCHEMA_REGEX` from `@themisos/db` and import in both the SQL CHECK (well, you can't — but ensure parity at provisioning time) and the TS validator.

### M8 — `withTenantSchema` German error message

**File:** `fastify-tenant.ts:417`

```ts
throw new Error(`withTenantSchema: ungültig schema name: ${schemaName}`);
```

`ungültig` is German ("invalid"). Greek-first product, English fallback. Rename to `invalid schema name`.

### M9 — `EXEMPT_ROUTES` does not include `/api/v1` placeholder + no health subpath

**File:** `fastify-tenant.ts:128-134`

Self-flagged correctly. Specifically:
- `/healthz`, `/readyz`, `/metrics` are commonly probed by orchestration (Kubernetes/Hetzner LB). Only `/health` is exempt.
- `/api/v1/auth/refresh` is missing — refresh-token endpoints typically run before the tenant cookie is fresh.
- No exemption for `/api/v1/auth/verify-email/:token` or `/api/v1/auth/reset-password/:token` (registration flow).

Add these or document them as out-of-scope for Day 2.

### M10 — JWT JTI revocation not implemented

**File:** `fastify-tenant.ts` (no JTI check) + `0002_template_schema.sql:349-368` (user_sessions has `jwt_jti` and `revoked_at` columns)

The DB schema models a JTI revocation list (`user_sessions.revoked_at`), but the plugin never checks it. A leaked JWT remains valid until exp. Add a fast Redis blocklist check after `request.jwtVerify()` and a write-through from `user_sessions.revoked_at`. P1 from a security stance — likely Sprint 1, not blocking Gate G1, but flag explicitly.

### M11 — `representing_counsel_party_id` should be CHECK-constrained or app-validated explicitly

**File:** `0002_template_schema.sql:735`

Comment says "app validates party.is_attorney = true" but no DB constraint. For Phase 1.5 add a row-level trigger or lateral check; for Phase 1, ensure the app layer test exists in the smoke suite.

### M12 — Spec count discrepancy: 43 ≠ 40

**File:** `0002_template_schema.sql:3, 1771-1777`

Header says "40 Phase-1 tables" but actually creates 43. Reviewer correctly flagged. Either update the header, or move `party_natural`+`party_legal`+`trust_account_entry` notes to a deviation block referencing the spec footnote. Cosmetic but matters for Aristotle's review pass.

### M13 — No FK index on many app-enforced FK columns

Postgres does not auto-index FKs. The migration adds many indexes correctly, but spot-checks show:
- `audit_log.actor_user_id` — has index (line 430). Good.
- `document.party_id` — has index (line 972). Good.
- `document.parent_document_id` — **no index**. Bad for version traversal.
- `document_share.shared_with_party_id` — **no index**. Bad for "list all docs shared with this client".
- `email_classification.classified_to_party_id` — **no index** (only matter_id is indexed at line 1481).
- `expense.receipt_document_id` — **no index**. Bad for "show me the receipt for this expense".
- `gdpr_request.response_document_id` — **no index**.
- `payment.recorded_by_user_id` — **no index**.
- `task.created_by_user_id` — **no index**.
- `time_entry.user_id` — has index (line 1117). Good.
- `matter_team.user_id` — has index. Good.

Add the missing indexes. Each is one line.

---

## 3. MINOR ISSUES / NITS

- **N1** — `0002:50` uses `SET LOCAL search_path` outside a transaction. Outside a transaction, `SET LOCAL` is a no-op with a `WARNING`. This relies on the caller wrapping the entire migration in BEGIN/COMMIT. Document the contract.
- **N2** — `0001:122` regex requires slug ≥ 3 chars (`{1,30}` between two char classes). Spec says "3-32 chars". Verify boundary: `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$` matches 3-32. OK but a CHECK like `length(slug) BETWEEN 3 AND 32` would be clearer.
- **N3** — `0001:157` email regex `'^[^@\s]+@[^@\s]+\.[^@\s]+$'` — `\s` inside a `[^...]` does not mean whitespace in Postgres POSIX regex. Use `\S` or `[^@[:space:]]`. Currently allows `nik o@mece.gr`.
- **N4** — `firm.afm` is checked at INSERT but a real ΑΦΜ has a check-digit modulo. The spec says "validated at registration against AADE GSIS" — make sure the application layer enforces this; the DB CHECK is necessary but insufficient.
- **N5** — `0002:1163` `invoice.invoice_number` is globally UNIQUE. Within a single firm schema this is fine; but the spec mentions per-(year, prefix) sequences. The `UNIQUE` is on the column — sufficient. Keep an eye on multi-prefix scenarios.
- **N6** — `0002:1209` `invoice_line.total_eur_cents` is `int`, not `bigint`. A €40,000+ legal invoice line is plausible (large transaction, M&A). Use `bigint` to match other money columns and Invariant #3.
- **N7** — `0002:1102` `time_entry.billable_rate_eur_cents` is `int`. Rates >€21.4M unlikely, OK.
- **N8** — `audit_log.outcome` has no CHECK constraint despite the comment listing `success | denied | error`. Either ENUM-ify or add CHECK.
- **N9** — `subscription.id` has UNIQUE on firm_id but no historical row support; comment acknowledges. Add a TODO inline so we don't regret in 12 months.
- **N10** — `getFirmSchemaName` at `tenant-resolver.ts:17-29` truncates by counting characters but does not deduplicate — `getFirmSchemaName('alpha-law')` and `getFirmSchemaName('alpha_law')` both produce `firm_alpha_law`. Two firms can collide on schema. Add a uniqueness guard at provisioning time (SELECT 1 FROM firms WHERE schema_name = $1).
- **N11** — `fastify-tenant.ts:120` cache TTL constant is `60_000`. Make it env-configurable (`process.env['TENANT_CACHE_TTL_MS']`) for ops tuning without redeploy.
- **N12** — `payment.amount_eur_cents int` — same int vs bigint nit (N6).
- **N13** — `0002:1709` `background_job.attempts` should index for retry queries; only `(status, scheduled_at)` is indexed.
- **N14** — `notification` table has no soft-delete or TTL column; cleanup job referenced (line 1692) will need a `created_at` index for efficient WHERE old.
- **N15** — `setting.key text PRIMARY KEY` — primary key on text is fine but consider length check `CHECK (length(key) <= 100)` to prevent bloat.

---

## 4. OPEN QUESTIONS for Niko / architect

1. **ENUM ownership model (relates to C5)**: Are tenant ENUMs **shared** across firms (Option A) or **per-firm** (Option B)? Decide before provisioning the first paying customer; reversing later requires touching every column type.
2. **Privilege architecture rollout (relates to C3)**: Spec §8 ships full crypto layer for Pro+ and skips DDK on Starter. Does this Phase 1 migration target Pro+ only, or do we need a Starter-compatible degraded mode in `0002`? Currently 0002 is silent on tier.
3. **Partition maintenance (C6)**: Are we deploying `pg_cron` extension or relying on application-level cron? Spec mentions neither. Decide.
4. **JWT revocation latency (M10)**: Is "60s window after logout" acceptable for compliance? If no, design Redis blocklist for Sprint 1.
5. **multi-firm membership**: Comment at `0001:201-202` says "Phase 1 = one user belongs to exactly one firm". The plugin's resolver chain assumes the same. Confirm Phase 1.5 will require a `firm_user_membership` table — should we shape the schema now to avoid migration pain?
6. **`trust_account_entry` scope (deviation #5)**: Spec §6 defers to Phase 1.5 but the migration ships it now. Either remove (cleaner) or commit to Phase 1 trust accounting (which has ΕΔΕ regulatory surface area).

---

## 5. STRENGTHS — preserve these

- **Append-only enforcement via REVOKE** on `audit_log`, `audit_privilege_access`, `trust_account_entry`, `party_role` — correctly implements Invariant #4. The dynamic role enumeration in 0001:482-496 is a nice touch.
- **Idempotent ENUM creation** via `DO $$ ... EXCEPTION WHEN duplicate_object` — correct pattern, applied consistently.
- **Partial unique indexes** for "at most one primary" semantics (`party_contact_primary_uq`, `party_address_primary_uq`, `matter_party_primary_contact_uq`) — exactly the right idiom, demonstrates fluency.
- **Snapshot rates on `time_entry.billable_rate_eur_cents`** — implements the Aristotle L17 fix from v0.3 correctly. `rate_change_audit JSONB` for overrides is clean.
- **`mydata_submission.content_hash` UNIQUE for idempotency** — exactly-once semantics on AADE retransmits, prevents duplicate submissions.
- **`user_sessions.expires_at` partial index `WHERE revoked_at IS NULL`** — good index hygiene; only indexes what's queried.
- **Resolver chain ordering** in `fastify-tenant.ts:446` — JWT > header > subdomain is the right priority. The single-flight pattern (first non-null wins) is clean.
- **Greek-localized error messages** in the plugin — matches Invariant #7.
- **`@dependency @fastify/jwt`** declared at line 493 — Fastify will refuse to load if order is wrong. Defensive.
- **`SET LOCAL` intent inside transaction** in `tenant-resolver.ts` and `fastify-tenant.ts` — the design is correct even though execution has the C2 bug.
- **Comprehensive table COMMENTs** with spec references — documentation lives next to the schema. Excellent for onboarding.
- **`storage_mode_t`** ENUM — even if `document_privilege` is missing (C3), the storage mode column shows the right design intent. Don't drop it; couple it with the missing table.

---

## 6. GATE G1 RECOMMENDATION — concrete actions

Before declaring G1 passed, the following must be true:

1. **Run `psql -d themis_test -f 0001_public_schema.sql -f 0002_template_schema.sql` against a fresh DB and the migration must complete with exit code 0.** Today it will fail at C1.
2. **Re-run the same command on the now-populated DB. It must succeed (idempotency).**
3. **C1 fixed**: either `system_health` table exists or stamping moved to a real `schema_migrations` table.
4. **C2 fixed**: `withTenantSchema` rewritten to (a) use validated string-substituted SET, (b) pass `tx` into `queryFn`. Update all current callers (likely zero — flag for sprint planning).
5. **C3 resolved**: either (a) `document_privilege` + spec-aligned `audit_privilege_access` added, or (b) explicit deferral with Niko's signed approval saying "Phase 1 ships without crypto layer; Invariant #9 downgraded to application+audit only for Starter and Pro tiers". The latter is a strategic/regulatory decision, not a tech decision.
6. **C4 fixed**: billing_split trigger relaxed (or replaced with service-layer enforcement) so that a partially-filled split doesn't roll back the transaction.
7. **C5 decided**: ENUM ownership model documented (Option A or B), and provisioning script aligned to that choice.
8. **C6 mitigated**: `partition_maintenance` background_job entry exists in seed data, with a pinned worker that creates next 3 months' partitions daily. (Or `pg_cron` installed — decision required.)
9. **Smoke test added** that does the full path: provision firm → JWT login → `withTenantSchema` write → bare-pool read isolation check (proves C2 is gone). This becomes the regression test forever.
10. **One pass over M4, M5, M9 fixes** (cheap, highly leveraged, ~30 min total work).

If items 1-9 are GREEN, G1 passes. **M1-M3, M6-M8, M10-M13 ship as Sprint 1 follow-up tickets** (track in GG4 todos). All N-items go to a backlog issue tagged `cleanup-day2`.

**Estimated time to GREEN:** 4-6 hours for one engineer. The work is mostly mechanical now that the issues are mapped.

---

## Files referenced

- `/root/projects/themis-os/code/packages/db/migrations/0001_public_schema.sql`
- `/root/projects/themis-os/code/packages/db/migrations/0002_template_schema.sql`
- `/root/projects/themis-os/code/apps/api/src/plugins/fastify-tenant.ts`
- `/root/projects/themis-os/code/packages/db/src/tenant-resolver.ts`
- `/root/projects/themis-os/code/packages/types/src/firm.ts`
- `/root/projects/themis-os/docs/v03/data-model-v03.md` (§3.0 mandate table, §8 Privilege Architecture)
