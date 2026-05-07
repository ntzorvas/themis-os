# Day 3 — Provisioning Notes

**File:** `packages/db/src/provisioning.ts`
**Spec ref:** docs/v03/data-model-v03.md §2–§3, D-DM-17

---

## 1. Schema clone strategy: string-replace vs pg_dump

### What we do in Phase 1

`provisionFirm` reads `0002_template_schema.sql` from disk and replaces every
occurrence of the string `tenant_template` with the new firm's schema name
(e.g. `firm_acme_legal`), then executes the result inside a transaction.

**Why this approach:**

- Zero external tools at runtime — no shell exec, no pg_dump process.
- The template SQL currently has `tenant_template` in exactly three places:
  `CREATE SCHEMA IF NOT EXISTS tenant_template`, `SET LOCAL search_path TO tenant_template`,
  and code comments. String replacement is exhaustive and predictable.
- The entire clone runs inside the provisioning transaction, so a failed DDL step
  rolls back both the schema creation and all public table inserts atomically.

**Known limitation:**

If the template ever gains sequences with `OWNED BY` clauses, function bodies with
`schema.table` references, or views referencing other schemas, a simple string
replace may produce broken DDL. Those constructs require the `pg_dump` approach.

### Phase 2 migration plan

Replace `buildClonedDDL()` with a `pg_dump`-based clone:

```
pg_dump \
  --schema-only \
  --schema=tenant_template \
  --no-owner \
  --no-privileges \
  $DATABASE_URL \
| sed 's/tenant_template/firm_<slug>/g' \
| psql $DATABASE_URL
```

This correctly handles sequences, triggers with schema-qualified references,
and inherited table structures. The `sed` replacement is safe here because
`pg_dump` output is deterministic and `tenant_template` will only appear as
a schema qualifier.

Phase 2 is a non-breaking change: the public table structure and the
`ProvisionedFirm` return type remain identical. Only `buildClonedDDL()` changes.

---

## 2. Advisory lock pattern

### The race condition

Without a lock, two simultaneous `POST /api/v1/auth/register-firm` requests with
the same slug both reach the `SELECT id FROM public.firms WHERE slug = $1` check
at the same time, both see zero rows, both proceed to INSERT, and one fails with
a Postgres unique-constraint violation that surfaces as an opaque 500 error.

### The fix: `pg_advisory_xact_lock`

```sql
SELECT pg_advisory_xact_lock(hashtext('firm-provisioning'));
```

This acquires a **transaction-scoped exclusive advisory lock** identified by the
integer hash of the string `'firm-provisioning'`. Key properties:

- **Exclusive:** only one transaction holds it at a time — all others block.
- **Transaction-scoped:** released automatically on commit or rollback. No
  explicit `pg_advisory_unlock` call required.
- **Global:** applies across all connections to the same Postgres server.
  Concurrent calls from different API pods are serialised correctly.
- **Low contention in practice:** provisioning is infrequent (seconds-long window
  at signup). The lock does not affect any read queries or tenant-scoped writes.

The advisory lock is acquired **before** the slug uniqueness check, so the
check + insert pair is atomic with respect to other provisioning calls. The
second concurrent caller will block at the advisory lock, then run the slug
check after the first call commits, and correctly receive `SlugTakenError`.

### Alternative considered

A `INSERT ... ON CONFLICT DO NOTHING RETURNING id` pattern would handle the
race without a lock, but it would not let us distinguish "slug taken" from a
different constraint violation, and it loses the ability to return a clean
`SlugTakenError` to the HTTP layer.

---

## 3. Open question: trial billing model

**Question:** Should the platform collect a payment method (card) on Day 1 of
the trial, or only prompt for payment after `trial_ends_at`?

**Two standard SaaS models:**

| Model | Behaviour | Pros | Cons |
|---|---|---|---|
| **Card-up-front** | Card required at signup; charge deferred until trial ends | Lower churn at trial end; fewer failed charges | Higher friction at signup; GDPR implications (card = PII) |
| **Card-at-conversion** | No card required during trial; prompt at `trial_ends_at - N days` | Frictionless signup; higher trial activation | Higher churn at conversion; dunning complexity |

**Recommendation for ΘΕΜΙΣ OS Phase 1 (Niko to confirm):**

Given the beachhead segment (solo Greek lawyers, ΔΣΘ pilot), **card-at-conversion**
is likely better for initial adoption. Greek professionals are conservative about
entering card details for SaaS they haven't evaluated. A 30-day free trial with a
reminder email at day 25 and a Viva Wallet payment link is operationally simpler
for Phase 1 and avoids needing PCI-DSS scope for card tokenisation during signup.

The `public.subscriptions.status = 'trialing'` and `provider_subscription_id = NULL`
design already supports this: `provider_subscription_id` stays NULL until the
firm converts, at which point the Viva Wallet subscription ID is written by the
billing webhook handler.

**Action required:** Niko to decide model before Day 5 (billing integration).
The schema does not need to change for either model.

---

## 4. Vault stub — what happens on Day 5

`firm_kms_keys` rows are inserted with vault paths in the form
`kv/themisos/firms/<slug>/dek` and `kv/themisos/firms/<slug>/pek`.

On Day 5, the vault-provisioner will:

1. Write an AES-256-GCM DEK to the Vault KV path.
2. Write a policy binding `firm-<slug>-policy` granting the API service account
   read access to that path.
3. Update `firm_kms_keys.status` to reflect that the key is live (it already
   defaults to `'active'` — the provisioner may add a `vault_provisioned_at`
   column if needed).

Until Day 5, `pgp_sym_encrypt` calls will fail for new firms because there is
no actual key at the Vault path. The stub is intentional to avoid blocking the
provisioning pipeline on Vault being available in the dev environment.
