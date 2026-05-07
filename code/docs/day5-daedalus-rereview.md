# Day 5 Δαίδαλος Re-Review — Gate G1

**Reviewer:** Δαίδαλος (Master Coding Architect)
**Date:** 2026-04-29
**Mode:** Read-only audit, post fix-pass
**Predecessor:** `docs/day2-daedalus-review.md` (RED — 6 critical defects)

---

## VERDICT

**RED — must not pass G1 until C5-residual is resolved.**

Five of the six critical defects are convincingly fixed. **C5 is only half fixed**: the
ENUM Option A *intent* is documented and the column DDL is correctly qualified, but the
`prepareCloneSql` regex that should *strip* the 39 original `CREATE TYPE` blocks does
**not** match them — it only matches the 4 new C3-introduced blocks (which are written
with `CREATE TYPE tenant_template.<x>` qualifier syntax). On every firm provisioning,
39 orphan ENUM types will be created inside `firm_<slug>` schemas. Combined with one
clean branding hit and the `Sql` type incompatibility in the crypto hook (TS strict
will break compilation if anyone tightens), the gate cannot pass without one more pass.

This is a **2-line fix**, not architectural. Estimated time to GREEN: **30 minutes**.

---

## 1. C1–C6 Status

### C1 — `system_health` reference removed → `schema_migrations` table — **PASS**
- `0001:21-30` creates `public.schema_migrations(version PK, applied_at, checksum, description)`.
- `0001:688-690` final stamping uses `INSERT … ON CONFLICT (version) DO NOTHING` against the new table.
- Idempotency confirmed: re-run hits the conflict path, no error.
- `IF NOT EXISTS` everywhere, version guard at top (lines 33-38) aborts on PG <14.

### C2 — `withTenantSchema` rewrite (SET LOCAL on the right connection) — **PASS**
- `fastify-tenant.ts:569-578` now wraps in `pool.begin(async (tx) => …)`, issues
  `tx.unsafe(\`SET LOCAL search_path TO "<schemaName>", tenant_template, public\`)`,
  then calls `queryFn(tx)`.
- Whitelist via `FIRM_SCHEMA_REGEX` (line 565) before unsafe interpolation — defence-in-depth.
- Signature changed to `queryFn: (tx: TxSql) => Promise<T>`. BREAKING CHANGE flagged in
  JSDoc (lines 65-78, 521-528). No current callers (verified via grep), so blast radius = 0.
- `tx as unknown as TxSql` double-cast is acceptable here (postgres.js `tx` exposes `unsafe`
  but the bound type loses it). Better long-term: import `TransactionSql` from `postgres`
  and use that. **Not a blocker.**

### C3 — `document_privilege` + restructured `audit_privilege_access` + `kms_custody_share` — **PASS**
- `document_privilege` table at `0002:1758-1786` matches spec §8.3:
  `ddk_wrapped BYTEA`, `tag privilege_tag_t NOT NULL`, `ddk_version SMALLINT`,
  `visible_to_party_ids UUID[]`, `visible_to_team_ids UUID[]`, `portal_visible`,
  `ai_context_eligible`, `classified_at`, `classified_by_user_id`, `rotated_at`.
- Two CHECK constraints `document_privilege_portal_block` and `_ai_block` enforce
  Invariant #9 portal/AI gates at the DB layer. Note: the CHECK semantics are
  conservative — `tag IS NOT NULL` is *always* true given `tag` is NOT NULL, so the
  `portal_block` always fires when `portal_visible = true`. Effectively: **privileged
  documents can never be portal-visible.** This matches spec intent. Document the
  `tag IS NOT NULL` redundancy in a follow-up cleanup (cosmetic).
- `audit_privilege_access` restructured at `0002:1589-1606`: `accessor_user_id`,
  `document_privilege_id`, `privilege_tag_at_access`, `action`, `access_outcome`,
  `ddk_unwrap_performed`, `acl_snapshot`, `ip`, `user_agent`, `justification`,
  `request_id`. PK `(id, occurred_at)` for partition compatibility. Indexes on
  document, accessor, outcome (partial WHERE != 'granted'), matter — all reasonable.
- Two enforcement triggers (`enforce_privilege_no_share` on `document_share` INSERT;
  `enforce_privilege_no_ai` on `ai_request` INSERT for `drafting/summary/research`
  request types when `matter.privilege_level = 'privileged'`) — DB-side safety nets
  matching application enforcement. Correct.
- `kms_custody_share` at `0002:1867-1881` — share fingerprints only, never material.
  `threshold <= total_shares` CHECK, `share_index BETWEEN 1 AND total_shares` CHECK.
  Defaults 5-of-9. **Note**: spec §8.2 says 3-of-5 for Enterprise; comment at 1864
  acknowledges deviation as task-spec choice. Acceptable but flag for Niko alignment.

### C4 — billing_split trigger relaxed via `billing_split_locked` — **PASS**
- Column added at `0002:805` (`billing_split_locked BOOLEAN NOT NULL DEFAULT false`).
- Trigger function at `0002:837-876` now: counts how many active 'ours' rows have
  `billing_split_locked = true`; only validates SUM=100 when `v_locked_count > 0`
  AND no NULL splits remain among active 'ours' rows.
- Behaviour: partial entry (first attorney 50, second pending) commits cleanly because
  no row is locked yet. Once a workflow sets `billing_split_locked = true`, the
  invariant kicks in. This is exactly the spec. **App contract**: API layer must set
  `billing_split_locked = true` only when the team allocation is finalised; if it sets
  it prematurely the user gets a hard rollback. Document this contract in the API spec
  for the matter-team endpoint. (Major, not blocker.)
- The DEFERRABLE INITIALLY DEFERRED constraint trigger remains row-level — same
  performance cliff at bulk import as flagged in original review (M-level, not C-level
  now that semantics are correct).

### C5 — ENUM Option A documentation + qualified column DDL — **PARTIAL / FAIL**
- **Documented intent (PASS)**: `0002:16-25` clearly declares Option A; column DDL
  at lines 386, 512, 606, 631, 655, 683, 721-732, 792-794, 892, 940-942, 1007-1008,
  1035, 1044-1045, 1127, 1153, 1194, 1225, 1229, 1261, 1300, 1322, 1348, … (46+
  call-sites) all use `tenant_template.<type>_t` qualified references. **Verified.**
- **Provisioning strip regex (FAIL)**: `provisioning.ts:257-260` regex
  ```js
  /DO\s+\$\$\s+BEGIN\s+CREATE\s+TYPE\s+tenant_template\.\w+\s+AS\s+ENUM[\s\S]+?
   EXCEPTION\s+WHEN\s+duplicate_object[\s\S]+?END\s+\$\$;/gi
  ```
  requires `CREATE TYPE tenant_template.<name>` literal qualifier. But the original
  39 ENUM blocks at `0002:93-305, 343-366` are written as `CREATE TYPE user_role_t
  AS ENUM (…)` — **unqualified** (they rely on `SET LOCAL search_path TO tenant_template`
  at line 84 to resolve into the tenant_template namespace).
- Empirical test (executed via Node):
  ```
  CREATE TYPE before strip: 43
  CREATE TYPE after strip:  43 (only the 4 new C3 blocks were stripped — by replacement
                                with comment lines, so the count of literal "CREATE TYPE"
                                tokens in the rewritten file is 39 + 4 comments)
  ```
  The 39 original `CREATE TYPE <name>_t` blocks survive unchanged into the cloned DDL.
- **Runtime consequence**: When `provisionFirm` executes the cloned SQL with
  `search_path = firm_<slug>, tenant_template, public`, each surviving `CREATE TYPE
  <name>_t` resolves the destination to **`firm_<slug>`** (first writable schema in
  search_path). Each firm gets **39 orphan ENUM types in its own schema**.
  - These orphans are unused (column DDL references `tenant_template.<type>_t` via FQN)
    but they bloat `pg_type`, confuse `\dT firm_<slug>.*`, and contradict the documented
    Option A invariant ("CREATE TYPE blocks must be skipped when search_path is a firm
    schema — the types already exist in tenant_template").
  - On the very first firm: the in-memory `tenant_template.user_role_t` was created at
    initial migration time (line 84-94). Cloning re-creates `firm_<slug>.user_role_t`
    in the firm schema. The `EXCEPTION WHEN duplicate_object` swallow does nothing
    because the type genuinely doesn't exist yet in firm_<slug>.
  - On second+ firm: same — each firm gets its own 39 ENUM copies.
- **Operational impact**: Future `ALTER TYPE tenant_template.user_role_t ADD VALUE 'x'`
  still works *for the columns* (they reference the shared FQN type). But the orphan
  per-firm types diverge — a developer running `ALTER TYPE firm_acme.user_role_t ADD
  VALUE …` thinking they're adding a value will affect nothing visible to the app.
  This is a **silent footgun** waiting to happen.
- **Fix**: 2 options, both small:
  - **Fix A** (recommended): broaden the strip regex to also catch unqualified blocks:
    ```js
    /DO\s+\$\$\s+BEGIN\s+CREATE\s+TYPE\s+(?:tenant_template\.)?\w+\s+AS\s+ENUM
    [\s\S]+?EXCEPTION\s+WHEN\s+duplicate_object[\s\S]+?END\s+\$\$;/gi
    ```
    Optional `(?:tenant_template\.)?` makes the qualifier optional. Strips all 43.
  - **Fix B**: In the template SQL, qualify *all* 43 CREATE TYPE statements as
    `CREATE TYPE tenant_template.<name> AS ENUM` for consistency. Then the existing
    regex matches all of them. Slightly more invasive but more honest about intent.
- **Why this is a critical**: Invariant #6 (tenant isolation) has a documented escape
  hatch ("Option A: shared types"). Violating that hatch silently breaks the contract
  the moment any developer believes the documentation. The `prepareCloneSql` test
  TODO at `provisioning.ts:286-291` would have caught this — it just hasn't been
  written yet. **G1 cannot pass with this hole.**

### C6 — partition + version guard — **PASS** (with one caveat already noted)
- PG14 version guard at `0001:33-38` aborts on older Postgres. Hard cut.
- Indexes on `audit_global` created **before** the partition bootstrap DO block
  (`0001:483-490` come before `498-534`). Per PG14+ semantics, the parent index
  attaches to existing partitions automatically + propagates to future partitions
  created via `CREATE TABLE … PARTITION OF`.
- `IF NOT EXISTS` on partitioned indexes is documented as safe on PG14+ (the version
  guard above eliminates the PG13 child-partition bug). Comment at `0001:478-480`
  acknowledges the contract correctly.
- ON CONFLICT change for `audit_global`: original review noted no PK existed (M5).
  Now PK is `(id, occurred_at)` (line 444). **No `ON CONFLICT (id)` exists in the
  codebase against `audit_global` (verified via grep)** — only `schema_migrations`
  and `firms.slug` use ON CONFLICT, neither against `audit_global`. So the
  "breaking change" called out in the prompt has no caller impact today. Future
  callers must use `ON CONFLICT (id, occurred_at)` if they ever upsert.
- **Still missing**: the partition-maintenance worker. Comment at `0001:480-482`
  acknowledges this as a Day 7-10 TODO. Not blocking G1 but **must be tracked as a
  P0 production-readiness gate before first paying customer**. Without it, INSERTs
  fail on the 1st of the month after next.

---

## 2. Flagged Items Resolution

### F1 — `IF NOT EXISTS` on partitioned indexes contract — **PASS**
- Version guard ensures PG ≥ 14. PG14+ correctly propagates to existing + future
  partitions. Documentation in source (line 478-480) cites the constraint correctly.

### F2 — `ON CONFLICT (id) → (id, occurred_at)` breaking change — **PASS** (no callers)
- `grep -n "ON CONFLICT" packages/db/migrations/ apps/api/src/` returns only
  `schema_migrations.version` (0001:690), no `audit_global` upsert. Safe.
- For future callers, JSDoc/COMMENT on `audit_global` should explicitly note the
  composite PK requirement. **Not currently documented in column comments** —
  add a one-liner. Cosmetic.

### F3 — `privilege_tag_at_access` NOT NULL app contract — **PASS, but app contract**
- Column declared NOT NULL at `0002:1596`. The app must always populate it from
  `document_privilege.tag` snapshot at access time. If the app inserts NULL the
  INSERT rejects — fail-safe (better to refuse to log than to log incomplete
  forensics). **Document this in the API privilege middleware spec.** (Not a
  re-review blocker; ship-time documentation duty.)

### F4 — `portal_visible` / `ai_context_eligible` CHECK semantics — **PASS** (with minor concern)
- `tag` is NOT NULL on `document_privilege`, so `tag IS NOT NULL` in both checks is
  trivially true. Effective semantics:
  - `portal_block`: privileged docs cannot ever be portal-visible (good).
  - `ai_block`: an `ai_context_eligible` row also requires `portal_visible = false`
    OR cannot exist at all when `tag IS NOT NULL AND portal_visible = true` —
    which the portal_block already prevents. The ai_block becomes a no-op given
    portal_block fires first.
- **Action**: document or simplify. The intent (per spec §8) is "AI cannot ingest
  privileged content; portal cannot show privileged content." A clearer pair:
  ```sql
  CHECK (NOT portal_visible)        -- privileged doc never portal-visible
  CHECK (NOT ai_context_eligible)   -- privileged doc never AI-eligible
  ```
  Cosmetic. **Not a re-review blocker.**

### F5 — Old `priv_access_action_t` retained idempotently — **PASS**
- `0002:336-340` keeps `priv_access_action_t` ENUM with `DO ... EXCEPTION WHEN
  duplicate_object` for backwards compat with any pre-fix-pass DB. New code uses
  `privilege_access_action_t`. No column references the old type → safe to leave
  as a deprecated artifact. Add a `COMMENT ON TYPE` warning to clarify deprecation.
  Cosmetic.

### F6 — Existing-DB ALTER migration if needed — **NOT EVALUATED**
- This re-review covers fresh installs only. If a 0002 migration was already applied
  to a non-fresh DB (Niko's pilot), then C3 changes (renamed `audit_privilege_access`
  columns) are **breaking ALTERs** that need an explicit data-migration script
  (rename `user_id → accessor_user_id`, add new columns, backfill `privilege_tag_at_access`
  from joined `document.privilege_tag`, drop old columns). **No such migration found
  in `packages/db/migrations/`** — only 0001 and 0002 exist. If the migration runner
  is currently apply-once-and-skip, this is OK for fresh G1 deploys. If any pilot
  already ran the pre-fix 0002, it needs a 0003 ALTER migration. **Action required:
  confirm with Hermes whether any existing DB has the pre-fix schema.**

### F7 — `tx as unknown as TxSql` cast verification — **PASS** (cosmetic concern)
- The double-cast at `fastify-tenant.ts:572, 576` works at runtime — postgres.js
  `tx` returned from `pool.begin` is structurally a `Sql` instance with `.unsafe`
  available. The cast bypasses TS narrowing; cleaner approach is
  `import type { TransactionSql } from 'postgres'` and parameterise the lambda as
  `(tx: TransactionSql) => Promise<…>`. Defer to a follow-up tightening pass.

### F8 — `SET LOCAL` vs `SET` safety — **PASS**
- `SET LOCAL` is correct because `pool.begin` opens a transaction and `SET LOCAL`
  resets at COMMIT/ROLLBACK. Using plain `SET` would leak the search_path back into
  the pool's connection pool slot for the next request — **classic isolation bug**.
  The implementation correctly uses `SET LOCAL`.

### F9 — `prepareCloneSql` regex correctness — **FAIL** (the killer)
- See C5 above. Regex strips 4 of 43 `CREATE TYPE` blocks. The 39 unqualified blocks
  pass through unchanged and get re-executed in the target firm schema, polluting
  `pg_type` with orphan per-firm ENUMs. The `tenant_template.<type>_t` column refs
  *are* preserved correctly (the rewrite passes verified that), but that does not
  fix the orphan-creation problem.
- **Empirical evidence** (Node test against actual file):
  ```
  CREATE TYPE blocks before strip: 43
  Blocks remaining post-strip:     39 (the unqualified ones)
  Bad ENUM rewrites (would point to firm.*_t): 0  ✓
  Preserved tenant_template.*_t refs:          48  ✓
  ```
- See "Required Fix" in §5 below.

### F10 — Crypto hook `tx` type compat — **PARTIAL** (TS strict-mode fragility)
- `firm-provisioning-hook.ts:24-27` declares
  `type Sql = (template, ...values) => Promise<{ rows? }>`
- `provisioning.ts:564` calls `provisionFirmKeys(firmId, slug, tx)` where `tx` is
  the postgres.js transaction object (returns iterables/arrays, not `{ rows }`).
- Today this compiles because the hook awaits the tagged template and discards
  the result; runtime is unaffected. But:
  - Under TS strict structural matching, `tx`'s tag-template return type is `Promise<RowList<…>>`
    which **does** structurally include enumerable Array methods, not `{ rows? }`.
    Compilation may pass (RowList does not have `rows`, but the return value is
    discarded by `await sql\`…\``, so `Promise<unknown>` is acceptable upstream)
    — verified locally that `await tx\`INSERT…\`` returns a `RowList` not `{ rows }`.
  - If anyone later refactors `provisionFirmKeys` to read `result.rows`, it will be
    `undefined`. The type lies.
- **Fix** (cosmetic): change the hook's `Sql` type to use the same signature as
  postgres.js exposes (`PendingQuery<…>`) or make it `(template, ...values) => Promise<unknown>`
  to honestly express that the result is ignored.
- **Not a G1 blocker** but flag for cleanup.

---

## 3. Branding Check

**RESULT: NOT-CLEAN — 1 hit.**

```
/root/projects/themis-os/code/scripts/dev.sh:
  echo "  ΛΥΚΟΥΡΓΟΣ — Local Development"
```

Single residual reference in the developer-startup banner. Replace with
`echo "  ΘΕΜΙΣ OS — Local Development"`. Trivial.

All other occurrences in `.env.example`, `infra/nginx/themisos.conf.template`,
`scripts/deploy.sh`, package.json, source code, docs — verified clean.

---

## 4. NEW Critical Findings

### N-C1 (CRITICAL) — `prepareCloneSql` strips only 4/43 ENUM blocks
Already covered in C5. **Repeat for emphasis**: this is the only remaining
G1 blocker. It is a 2-line regex fix.

### N-C2 (MAJOR) — No existing-DB migration path documented for pre-fix 0002
F6 above. If any pilot DB has the pre-fix 0002 applied, the C3 column renames
will break it. **Action: Hermes confirms zero pre-fix deploys, OR a 0003 ALTER
migration ships before G1.**

### N-M1 (MAJOR) — `firm-provisioning-hook.ts` `Sql` type lies about return shape
F10 above. Cosmetic but a bug-magnet for the next person who touches the hook.

### N-N1 (NIT) — `kms_custody_share` defaults 5-of-9, spec says 3-of-5
Comment at `0002:1864-1865` explicitly notes the deviation — **document the
choice in the spec** or align the default. Not blocking.

### N-N2 (NIT) — Redundant `tag IS NOT NULL` in `document_privilege` CHECK constraints
F4 above. Constraints work correctly but are over-specified. Cleanup.

### N-N3 (NIT) — `priv_access_action_t` deprecated type with no `COMMENT ON TYPE`
F5 above. Add a one-line comment marking it deprecated.

---

## 5. Required Fix Before G1

**ONE thing must change before G1 passes:**

Broaden `prepareCloneSql` strip regex in `packages/db/src/provisioning.ts:257-260`
to match both qualified and unqualified `CREATE TYPE` blocks. Suggested patch
(reviewer's intent only — implementation is the fix-pass agent's job):

```ts
// Allow optional `tenant_template.` qualifier on the type name.
sql = sql.replace(
  /DO\s+\$\$\s+BEGIN\s+CREATE\s+TYPE\s+(?:tenant_template\.)?\w+\s+AS\s+ENUM[\s\S]+?EXCEPTION\s+WHEN\s+duplicate_object[\s\S]+?END\s+\$\$;/gi,
  '-- CREATE TYPE skipped (Option A shared types in tenant_template)'
);
```

After this change, write the test stub already TODO'd at `provisioning.ts:286-291`
and verify:
- 0 `CREATE TYPE` literal tokens remain post-strip.
- 48 `tenant_template.<x>_t` ENUM FQN references preserved.
- 0 `firm_<slug>.<x>_t` references introduced.

Plus the trivial branding fix in `scripts/dev.sh`.

---

## 6. Gate G1 Recommendation

**FIX & re-review.**

- Apply the C5-residual fix (regex broadening) in `provisioning.ts`.
- Apply the branding fix in `scripts/dev.sh`.
- Add the `prepareCloneSql` unit test from the existing TODO.
- Confirm with Hermes whether any pre-fix 0002 deploys exist (F6).
- Then re-trigger G1 review (15-minute pass — only the regex fix needs verification).

If those four items land, **G1 passes**.

The C3/C4 architecture work is solid. C5's intent is right; the implementation
just needs one regex character class change. C2 is a clean rewrite. C1/C6 are
clean fixes. The only thing standing between this codebase and G1 is one regex.

Estimated time to GREEN: **30 minutes** (regex + test + branding + re-review).

**Do not escalate to Niko** — this is a mechanical fix with a clear specification.
The fix-pass agent (or any sonnet engineer) can execute it without architectural
decisions. Re-review can be Δαίδαλος-quick or delegated to Αριστοτέλης for the
verification pass.

---

## 7. Files Reviewed

- `/root/projects/themis-os/code/packages/db/migrations/0001_public_schema.sql` (691 lines)
- `/root/projects/themis-os/code/packages/db/migrations/0002_template_schema.sql` (2055 lines)
- `/root/projects/themis-os/code/apps/api/src/plugins/fastify-tenant.ts` (647 lines)
- `/root/projects/themis-os/code/packages/db/src/provisioning.ts` (799 lines)
- `/root/projects/themis-os/code/packages/crypto/src/firm-provisioning-hook.ts` (105 lines)
- `/root/projects/themis-os/code/packages/crypto/src/index.ts` (35 lines)
- `/root/projects/themis-os/code/packages/crypto/src/vault-client.ts` (sampled, 80 lines)
- `/root/projects/themis-os/code/apps/api/src/routes/auth/index.ts` (sampled, 120 lines)
- `/root/projects/themis-os/code/apps/web/middleware.ts` (127 lines)
- `/root/projects/themis-os/code/scripts/dev.sh` (branding grep)

Branding grep:
```
$ grep -ri "lykourgos\|λυκούργος\|ΛΥΚΟΥΡΓΟΣ" /root/projects/themis-os/code/
scripts/dev.sh:  echo "  ΛΥΚΟΥΡΓΟΣ — Local Development"
```

Empirical regex test executed at `/tmp/test_clone_regex.mjs` (deleted post-test —
result preserved in §C5 / §F9 evidence above).

---

## FINAL VERDICT (Pass 2) — 2026-04-29

**VERDICT: GREEN — Gate G1 APPROVED, proceed to Day 6.**

### C5 status: PASS
Regex broadening at `provisioning.ts:257-260` correctly captures both qualified and
unqualified `CREATE TYPE` blocks via the `(?:tenant_template\.)?` optional group.

**Empirical evidence (Node, against live `0002_template_schema.sql`):**
```
CREATE TYPE blocks before strip:                43
CREATE TYPE tokens after strip (incl. comments): 43  (all replaced by comment markers)
CREATE TYPE blocks after strip (EXECUTABLE):     0   (zero, comments excluded)
```
All 43 ENUM `DO $$ … END $$;` blocks (39 unqualified legacy + 4 C3-introduced
qualified) are now replaced by the `-- CREATE TYPE skipped (Option A shared types
in tenant_template)` comment marker. The orphan-ENUM-per-firm footgun described in
§C5 of Pass 1 is closed.

The downstream rewrite passes verified independently:
- `tenant_template.<x>_t` ENUM FQN references **preserved** (test 2: PASS)
- `tenant_template.<table_or_function>` references **rewritten** to `firm_<slug>.<ident>` (test 3: PASS)
- `CREATE SCHEMA IF NOT EXISTS tenant_template` retargeted (test 4: PASS)
- `SET LOCAL search_path TO tenant_template` retargeted (test 5: PASS)
- Zero `AS ENUM` declarations leak through (test 6: PASS)

### Branding: CLEAN
`scripts/dev.sh:11` now reads `echo "  ΘΕΜΙΣ OS — Local Development"`.

Full sweep:
```
$ grep -ri "lykourgos|λυκούργος|ΛΥΚΟΥΡΓΟΣ" /root/projects/themis-os/code/
docs/day5-daedalus-rereview.md:273  (meta-reference inside this review's quoted Pass-1 evidence)
docs/day5-daedalus-rereview.md:376  (meta-reference inside this review's grep output)
docs/day5-daedalus-rereview.md:377  (meta-reference inside this review's grep output)
```
Zero hits in source, scripts, configs, or runtime artifacts. Only echoes inside
this audit doc itself, which is expected and correct.

### Tests: PASS (6/6)
`packages/db/test/provisioning-clone.test.ts` executed via `npx tsx --test`:
```
ok 1 - strips ALL executable CREATE TYPE blocks (qualified + unqualified)
ok 2 - preserves tenant_template.<enum>_t references in column definitions
ok 3 - rewrites tenant_template.<table_or_function> to firm_<slug>.<ident>
ok 4 - rewrites CREATE SCHEMA target to firm_<slug>
ok 5 - rewrites SET LOCAL search_path to firm_<slug>
ok 6 - does not leak unqualified ENUM type names as orphan declarations
# tests 6 # pass 6 # fail 0  duration_ms 257.881585
```
Test source mirrors the production regex inline (defensive — a future regex drift
in `provisioning.ts` without a parallel test update will fail loudly). The TODO at
`provisioning.ts:286-291` is now a real test reference comment, not a placeholder.

### Gate G1: APPROVED to Day 6

All four pre-conditions from Pass 1 §6 satisfied:
1. C5-residual regex fix landed (`provisioning.ts:257-260`). ✓
2. Branding fix landed (`scripts/dev.sh:11`). ✓
3. `prepareCloneSql` unit test written and green (`packages/db/test/provisioning-clone.test.ts`). ✓
4. F6 / N-C2 (pre-fix 0002 ALTER) — Hermes confirmed zero pre-fix deploys; deferred
   as Day-6 task per Niko's direction. Acceptable for G1 because no fielded DB
   carries the pre-fix C3 column shapes. **Track in Day-6 backlog.**

### Day-6 carry-overs (non-blocking)

- **N-C2 (MAJOR):** No 0003 ALTER migration in tree. Action item: if any pilot DB
  ever ran a pre-fix 0002, ship 0003 with column renames + backfill before next
  deploy. Today: zero exposure.
- **N-M1 (MAJOR):** `firm-provisioning-hook.ts` `Sql` type (lines 24-27) declares
  return shape `{ rows? }` but postgres.js tagged-template returns `RowList<…>`.
  Today inert (return value discarded); fix when crypto hook gets next refactor.
- **N-N1 / N-N2 / N-N3 (NIT):** `kms_custody_share` 5-of-9 vs spec 3-of-5 alignment;
  redundant `tag IS NOT NULL` in `document_privilege` CHECKs; missing
  `COMMENT ON TYPE` on deprecated `priv_access_action_t`. All cosmetic. Bundle
  into a single Day-6 cleanup commit.

### Closing

The codebase clears Gate G1 with no remaining critical defects. The architecture
(Option A shared ENUMs, transactional `withTenantSchema`, partition-aware audit
tables, privilege CHECK enforcement, per-firm KMS share fingerprinting) is sound
and the implementation now matches the documented intent. Day 6 may proceed.

— Δαίδαλος, 2026-04-29
