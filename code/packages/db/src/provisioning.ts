/**
 * @file provisioning.ts
 * @module @themisos/db/provisioning
 *
 * Firm provisioning and de-provisioning for ΘΕΜΙΣ OS.
 *
 * TRANSACTION SEMANTICS
 * ─────────────────────
 * The entire `provisionFirm` flow runs inside a single postgres.js transaction
 * (`pool.begin`). PostgreSQL supports DDL inside transactions, so `CREATE SCHEMA`
 * and the subsequent DDL clone are fully rolled back if any later step throws.
 * This means: either the firm exists completely (all public rows + schema + local
 * user row + audit entry), or it does not exist at all. No partial state leaks.
 *
 * ADVISORY LOCK
 * ─────────────
 * `pg_advisory_xact_lock(hashtext('firm-provisioning'))` is acquired at the
 * start of the transaction. It is a session-level exclusive lock scoped to the
 * transaction lifetime, released automatically on commit or rollback. This
 * serialises concurrent provisioning calls that would otherwise race on the
 * slug uniqueness check between SELECT and INSERT.
 *
 * SCHEMA CLONE STRATEGY (Phase 1)
 * ────────────────────────────────
 * We read `0002_template_schema.sql` from disk and process it via `prepareCloneSql`:
 *   1. Strip all CREATE TYPE DO blocks — ENUMs live in `tenant_template` (C5 Option A).
 *   2. Rewrite `tenant_template.<table>` → `firm_<slug>.<table>` (TABLE/INDEX/FUNCTION).
 *   3. Preserve `tenant_template.<type>_t` references — these are ENUM FQN column refs.
 *   4. Rewrite CREATE SCHEMA and SET search_path statements.
 * Phase 2 will switch to `pg_dump --schema-only --schema=tenant_template` +
 * post-process, which handles sequences, triggers, and views more robustly.
 * See: docs/day3-provisioning-notes.md, docs/day2-daedalus-review.md §C5
 *
 * VAULT / KMS (Day 5 — live)
 * ──────────────────────────
 * `firm_kms_keys` rows are inserted by `provisionFirmKeys` (packages/crypto)
 * which performs the actual HashiCorp Vault KV write inside the transaction.
 * If Vault is sealed or unreachable, the exception propagates and the full
 * transaction rolls back. Privilege key (BYOK) is Phase 2 — returns null.
 * Reference: docs/v03/data-model-v03.md §8 (D-DM-17), Invariant #9.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './client';
import { getFirmSchemaName } from './tenant-resolver';
import { provisionFirmKeys } from '@themisos/crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Per-seat monthly price in Euro cents for each tier.
 * Enterprise is a placeholder; actual price is set by the sales quote process.
 */
const PRICING_MAP = {
  starter: 1900,        // €19.00
  professional: 3900,   // €39.00
  firm: 5900,           // €59.00
  enterprise: 7900,     // €79.00 (placeholder — enterprise = custom quote)
} as const;

/** Default trial length in days if not specified by the caller. */
const DEFAULT_TRIAL_DAYS = 30;

/**
 * Slug regex enforced before any string interpolation into SQL identifiers.
 * Must match the CHECK constraint on public.firms.slug in 0001_public_schema.sql.
 * Format: lowercase kebab-case, 3–32 chars, starts and ends with alphanumeric.
 */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/**
 * Schema name regex used to validate the derived schema name before unsafe SQL.
 * Matches tenant-resolver.ts whitelist check.
 */
const SCHEMA_NAME_REGEX = /^firm_[a-z0-9_]{1,27}$/;

// ---------------------------------------------------------------------------
// Path to migration file (resolved relative to this source file)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Absolute path to the tenant template DDL.
 * Resolved at module load so any missing-file error surfaces at startup, not
 * at first provisioning call.
 */
const TEMPLATE_SQL_PATH = resolve(
  __dirname,
  '../migrations/0002_template_schema.sql'
);

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when the requested slug is already registered in public.firms.
 * The caller (POST /api/v1/auth/register-firm) should return HTTP 409.
 */
export class SlugTakenError extends Error {
  readonly code = 'SLUG_TAKEN' as const;
  readonly userMessage = 'Το όνομα είναι ήδη σε χρήση. Παρακαλώ επιλέξτε διαφορετικό όνομα γραφείου.';

  constructor(slug: string) {
    super(`Slug already registered: ${slug}`);
    this.name = 'SlugTakenError';
  }
}

/**
 * Thrown when any step of the provisioning pipeline fails for reasons other
 * than a slug collision. The entire transaction is rolled back before this is
 * thrown, so no partial state exists in the database.
 */
export class ProvisioningError extends Error {
  readonly code = 'PROVISIONING_FAILED' as const;
  readonly userMessage = 'Σφάλμα κατά τη δημιουργία του λογαριασμού. Παρακαλώ δοκιμάστε ξανά ή επικοινωνήστε με την υποστήριξη.';

  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input to `provisionFirm`. All values must be validated and sanitised by the
 * caller (Fastify route handler + Zod schema) before passing here.
 */
export interface ProvisionFirmInput {
  /** Full legal name of the law firm, e.g. "Γραφείο Παπαδόπουλου & Συνεργατών Ε.Π.Ε." */
  legalName: string;

  /**
   * URL-safe identifier. Must match `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`.
   * Pre-validated kebab-case by the caller; re-validated here before SQL use.
   */
  slug: string;

  /** Greek tax registration number (ΑΦΜ). Exactly 9 digits, no spaces. */
  afm: string;

  /** Subscription tier selected at registration. */
  tier: 'starter' | 'professional' | 'firm' | 'enterprise';

  /** Email address for billing receipts and dunning notifications. */
  billingEmail: string;

  /** Login email for the initial owner account. */
  ownerEmail: string;

  /**
   * argon2id password hash produced by the caller.
   * This module never sees the plaintext password.
   */
  ownerPasswordHash: string;

  /** Full name of the owner, e.g. "Νίκος Παπαδόπουλος". */
  ownerFullName: string;

  /** Bar association membership number (ΑΜ ΔΣ). Optional for non-lawyer owners. */
  ownerBarId?: string | undefined;

  /**
   * Trial length in days. Defaults to DEFAULT_TRIAL_DAYS (30).
   * Billing starts after trial_ends_at unless the firm upgrades earlier.
   */
  trialDays?: number | undefined;
}

/**
 * Result returned by `provisionFirm` on success.
 * The caller uses this to issue a JWT, redirect, or send a welcome email.
 */
export interface ProvisionedFirm {
  /** UUID of the newly created firm (public.firms.id). */
  firmId: string;

  /** Postgres schema name, e.g. "firm_acme_legal". */
  schemaName: string;

  /** UUID of the owner's public.firm_users row. */
  ownerUserId: string;

  /** When the trial period ends (UTC). */
  trialEndsAt: Date;

  /**
   * Vault KV path for the firm's data_encryption DEK.
   * Written by provisionFirmKeys (Day 5 hook) — points to a live key in MECE Vault.
   * Phase 2 (BYOK): privilege_encryption key path available via provisionFirmKeys return.
   */
  vaultKeyPath: string;
}

// ---------------------------------------------------------------------------
// Logger interface (Pino-compatible subset)
// ---------------------------------------------------------------------------

interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

const consoleLogger: Logger = {
  info: (obj, msg) => console.log('[provisioning]', msg ?? '', obj),
  warn: (obj, msg) => console.warn('[provisioning]', msg ?? '', obj),
  error: (obj, msg) => console.error('[provisioning]', msg ?? '', obj),
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reads the template DDL from disk, strips CREATE TYPE blocks (C5 Option A),
 * and rewrites `tenant_template.<identifier>` references for the target schema.
 *
 * Δαίδαλος C5 Option A decision: ENUMs live in `tenant_template` namespace.
 * Cloned firm schemas reference them via fully-qualified `tenant_template.<type>_t`
 * names — the column DDL already does this. The CREATE TYPE DO blocks must
 * therefore be SKIPPED when cloning, or they attempt to create duplicate types
 * in `tenant_template` (caught by the EXCEPTION WHEN duplicate_object wrapper)
 * and then the column DDL silently resolves types to `tenant_template.*` anyway.
 * Explicitly stripping them makes the intent clear and avoids the silent shared-type
 * side-effect that confused the original string-replace approach.
 *
 * Rewrite rules:
 *   - `tenant_template.<ident>` where ident ends with `_t` → kept as-is (ENUM ref)
 *   - `tenant_template.<ident>` all other idents → `<targetSchema>.<ident>` (TABLE/INDEX/FUNCTION)
 *   - `CREATE SCHEMA IF NOT EXISTS tenant_template;` → targetSchema
 *   - `SET LOCAL search_path TO tenant_template;` → targetSchema
 *
 * Phase 2 will use `pg_dump --schema-only` to handle sequences and views
 * with cross-schema references more robustly.
 *
 * @param targetSchema - Validated schema name, e.g. "firm_acme_legal".
 * @returns SQL string ready for execution inside the provisioning transaction.
 */
function prepareCloneSql(targetSchema: string): string {
  const templateSql = readFileSync(TEMPLATE_SQL_PATH, 'utf-8');
  let sql = templateSql;

  // Strip CREATE TYPE DO blocks.
  // ENUMs live in tenant_template namespace (Δαίδαλος C5 decision: Option A shared types).
  // Cloned firm schemas reference types via fully-qualified tenant_template.* names.
  sql = sql.replace(
    /DO\s+\$\$\s+BEGIN\s+CREATE\s+TYPE\s+(?:tenant_template\.)?\w+\s+AS\s+ENUM[\s\S]+?EXCEPTION\s+WHEN\s+duplicate_object[\s\S]+?END\s+\$\$;/gi,
    '-- CREATE TYPE skipped (Option A shared types in tenant_template)'
  );

  // Rewrite `tenant_template.<identifier>` references:
  //   - identifiers ending in `_t` = ENUM type names → keep pointing to tenant_template
  //   - all other identifiers = TABLE/INDEX/FUNCTION names → rewrite to targetSchema
  sql = sql.replace(
    /tenant_template\.([a-z_][a-z0-9_]*)/gi,
    (_match: string, identifier: string): string => {
      if (identifier.endsWith('_t')) return `tenant_template.${identifier}`;
      return `${targetSchema}.${identifier}`;
    }
  );

  // Rewrite CREATE SCHEMA and SET search_path statements
  sql = sql.replace(
    /CREATE SCHEMA IF NOT EXISTS tenant_template;/g,
    `CREATE SCHEMA IF NOT EXISTS ${targetSchema};`
  );
  sql = sql.replace(
    /SET LOCAL search_path TO tenant_template;/g,
    `SET LOCAL search_path TO ${targetSchema};`
  );

  return sql;
}

// Tests: packages/db/test/provisioning-clone.test.ts (node --test)
//   - asserts: zero executable CREATE TYPE blocks (qualified + unqualified stripped)
//   - asserts: tenant_template.<enum>_t references PRESERVED
//   - asserts: tenant_template.<table> rewritten to firm_<slug>.<table>
//   - asserts: CREATE SCHEMA + SET LOCAL search_path retargeted
//   - asserts: zero AS ENUM declarations leak through

// ---------------------------------------------------------------------------
// Main: provisionFirm
// ---------------------------------------------------------------------------

/**
 * Provisions a new firm (law practice) in ΘΕΜΙΣ OS.
 *
 * Creates, within a single transaction:
 *   1. public.firms row (tenant registry)
 *   2. Postgres schema firm_<slug> created
 *   3. Clone tenant_template DDL into new schema via prepareCloneSql
 *      (C5 Option A: CREATE TYPE blocks stripped; ENUMs stay in tenant_template)
 *   4. public.firm_users row (the owner account)
 *   5. public.subscriptions row (trialing, monthly)
 *   6. public.firm_kms_keys row (DEK — written by provisionFirmKeys, not stubbed)
 *   7. firm_<slug>.users row (local cache of owner for tenant-scoped queries)
 *   8. HashiCorp Vault DEK provisioned via provisionFirmKeys (Day 5 hook).
 *      If Vault is sealed or unreachable, the entire transaction rolls back.
 *   9. public.audit_global entry (action = 'firm.created') with vault key paths
 *
 * ENUM ownership (C5 Option A): all ENUM types live in `tenant_template` schema.
 * Cloned firm schemas reference them via fully-qualified `tenant_template.<type>_t`
 * names. This means ENUM additions are firm-global by design. See prepareCloneSql.
 *
 * Vault keys (Day 5): `provisionFirmKeys` generates the data_encryption DEK in
 * MECE Vault and INSERTs the path into public.firm_kms_keys inside this transaction.
 * If Vault throws (sealed, network), the full transaction rolls back — no orphan
 * schema and no orphan DB rows. The privilege key (BYOK) is Phase 2; returns null.
 *
 * If any step fails the entire transaction rolls back, including the DDL.
 * PostgreSQL supports transactional DDL, so CREATE SCHEMA is fully reversible.
 *
 * @param input  - Validated registration input from the route handler.
 * @param logger - Optional Pino-compatible logger; falls back to console.
 * @returns      - Identifiers and metadata for the newly created firm.
 *
 * @throws {SlugTakenError}    - Slug already exists in public.firms.
 * @throws {ProvisioningError} - Any other DB failure or Vault failure; cause is attached.
 *
 * @example
 * ```ts
 * const result = await provisionFirm({
 *   legalName: 'Δικηγορικό Γραφείο Παπαδόπουλου',
 *   slug: 'papadopoulos-law',
 *   afm: '123456789',
 *   tier: 'starter',
 *   billingEmail: 'billing@papadopoulos-law.gr',
 *   ownerEmail: 'niko@papadopoulos-law.gr',
 *   ownerPasswordHash: '$argon2id$...',
 *   ownerFullName: 'Νικόλαος Παπαδόπουλος',
 *   ownerBarId: 'ΔΣΑ-12345',
 *   trialDays: 30,
 * });
 * ```
 */
export async function provisionFirm(
  input: ProvisionFirmInput,
  logger: Logger = consoleLogger
): Promise<ProvisionedFirm> {

  // ── Pre-flight: slug regex validation ─────────────────────────────────────
  // Re-validate here even though the caller should have validated. This is the
  // last gate before user input is interpolated into SQL identifiers.
  if (!SLUG_REGEX.test(input.slug)) {
    throw new ProvisioningError(
      `Invalid slug format before SQL interpolation: "${input.slug}". ` +
      'Must match ^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'
    );
  }

  const schemaName = getFirmSchemaName(input.slug);

  // Validate the derived schema name before any unsafe SQL execution.
  if (!SCHEMA_NAME_REGEX.test(schemaName)) {
    throw new ProvisioningError(
      `Derived schema name failed whitelist check: "${schemaName}". ` +
      'This is a programming error — slug passed regex but schema derivation produced an invalid result.'
    );
  }

  const trialDays = input.trialDays ?? DEFAULT_TRIAL_DAYS;

  logger.info({ slug: input.slug, schemaName, tier: input.tier }, 'provisioning firm — start');

  try {
    return await pool.begin(async (tx) => {

      // ── Step 0: Advisory lock ────────────────────────────────────────────
      // Serialises concurrent provisioning calls that would race on slug
      // uniqueness between the SELECT check and the INSERT.
      // The lock is automatically released when the transaction ends.
      await tx`SELECT pg_advisory_xact_lock(hashtext('firm-provisioning'))`;

      // ── Step 1: Validate slug uniqueness ─────────────────────────────────
      const existingRows = await tx<Array<{ id: string }>>`
        SELECT id
        FROM public.firms
        WHERE slug = ${input.slug}
        LIMIT 1
      `;

      if (existingRows.length > 0) {
        logger.warn({ slug: input.slug }, 'provisioning aborted — slug already taken');
        throw new SlugTakenError(input.slug);
      }

      // ── Step 2: INSERT public.firms ───────────────────────────────────────
      const firmRows = await tx<Array<{ id: string; trial_ends_at: Date }>>`
        INSERT INTO public.firms (
          slug,
          legal_name,
          afm,
          status,
          tier,
          schema_name,
          billing_email,
          trial_ends_at
        ) VALUES (
          ${input.slug},
          ${input.legalName},
          ${input.afm},
          'trial',
          ${input.tier},
          ${schemaName},
          ${input.billingEmail},
          now() + (${trialDays} || ' days')::interval
        )
        RETURNING id, trial_ends_at
      `;

      const firmRow = firmRows[0];
      if (firmRow === undefined) {
        throw new ProvisioningError('INSERT INTO public.firms returned no rows.');
      }

      const firmId = firmRow.id;
      const trialEndsAt = firmRow.trial_ends_at;

      logger.info({ firmId, slug: input.slug }, 'public.firms row created');

      // ── Step 3: CREATE SCHEMA firm_<slug> ────────────────────────────────
      // postgres.js `sql` tagged template escapes identifiers via sql(name).
      // Using tx.unsafe() only for the CREATE SCHEMA statement because
      // postgres.js does not support parameterised DDL. The schema name has
      // already been validated against SCHEMA_NAME_REGEX above.
      await tx.unsafe(`CREATE SCHEMA "${schemaName}"`);

      logger.info({ schemaName }, 'tenant schema created');

      // ── Step 4: Clone tenant_template DDL into new schema ─────────────────
      // C5 Option A: CREATE TYPE blocks stripped by prepareCloneSql — ENUMs
      // remain in tenant_template and are referenced via FQN from column DDL.
      // Phase 2 will use pg_dump --schema-only for sequences and views.
      const clonedDDL = prepareCloneSql(schemaName);
      await tx.unsafe(clonedDDL);

      logger.info({ schemaName }, 'tenant DDL cloned from template');

      // ── Step 5: INSERT public.firm_users (owner) ──────────────────────────
      const ownerRows = await tx<Array<{ id: string }>>`
        INSERT INTO public.firm_users (
          firm_id,
          email,
          password_hash,
          role,
          full_name,
          bar_id,
          is_active
        ) VALUES (
          ${firmId},
          ${input.ownerEmail},
          ${input.ownerPasswordHash},
          'owner',
          ${input.ownerFullName},
          ${input.ownerBarId ?? null},
          true
        )
        RETURNING id
      `;

      const ownerRow = ownerRows[0];
      if (ownerRow === undefined) {
        throw new ProvisioningError('INSERT INTO public.firm_users returned no rows.');
      }

      const ownerUserId = ownerRow.id;

      logger.info({ ownerUserId, firmId }, 'public.firm_users owner row created');

      // ── Step 6: INSERT public.subscriptions ──────────────────────────────
      const pricePerUser = PRICING_MAP[input.tier];

      await tx`
        INSERT INTO public.subscriptions (
          firm_id,
          tier,
          billing_period,
          price_per_user_eur_cents,
          seat_count,
          status,
          current_period_start,
          current_period_end,
          payment_provider
        ) VALUES (
          ${firmId},
          ${input.tier},
          'monthly',
          ${pricePerUser},
          1,
          'trialing',
          now(),
          now() + (${trialDays} || ' days')::interval,
          'viva'
        )
      `;

      logger.info({ firmId, tier: input.tier, pricePerUser }, 'public.subscriptions row created');

      // ── Step 7: (KMS keys provisioned in Step 8.5 via provisionFirmKeys) ──
      // The stub INSERT that used to be here has been replaced by the Day 5
      // provisionFirmKeys hook which performs the actual Vault write + INSERT.
      // See: packages/crypto/src/firm-provisioning-hook.ts

      // ── Step 8: INSERT firm_<slug>.users (owner local cache) ──────────────
      // The tenant schema's `users` table caches the public.firm_users row for
      // tenant-scoped queries that run with search_path = firm_<slug>.
      // Kept in sync by triggers or application layer (future sprint).
      //
      // Strategy: SET LOCAL search_path to the new schema, then use a normal
      // tagged-template query. This is safe because:
      //   a) schemaName is validated against SCHEMA_NAME_REGEX above.
      //   b) SET LOCAL scopes the search_path to this transaction only.
      //   c) All user-supplied values go through postgres.js parameterisation.
      // The search_path is reset to its previous value on tx commit/rollback.
      await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", tenant_template, public`);

      // Columns match tenant_template.users exactly (0002_template_schema.sql §A.1):
      //   id, email, role, full_name, bar_number, is_active, created_at
      // firm_user_id is not a column — the FK to public.firm_users is app-enforced.
      // bar_association is left NULL (can be populated by the owner in settings).
      await tx`
        INSERT INTO users (
          id,
          email,
          full_name,
          role,
          bar_number,
          is_active,
          created_at
        ) VALUES (
          ${ownerUserId},
          ${input.ownerEmail},
          ${input.ownerFullName},
          'partner',
          ${input.ownerBarId ?? null},
          true,
          now()
        )
      `;

      logger.info({ schemaName, ownerUserId }, 'tenant users row created');

      // ── Step 8.5: Provision Vault keys for the new firm ───────────────────
      // Generates a data_encryption DEK in MECE Vault and registers it in
      // public.firm_kms_keys inside this same transaction.
      // Privilege key (BYOK Phase 2) is stubbed — returns null.
      //
      // If provisionFirmKeys throws (Vault sealed, network error, DB INSERT fail),
      // the entire transaction rolls back — CREATE SCHEMA and all preceding INSERTs
      // are fully reverted. No orphan schema or partial DB state will exist.
      // Reference: docs/v03/data-model-v03.md §8 (D-DM-17), Invariant #9.
      const { dataKeyPath, privilegeKeyPath } = await provisionFirmKeys(firmId, input.slug, tx as unknown as Parameters<typeof provisionFirmKeys>[2]);
      logger.info({ firmId, slug: input.slug, dataKeyPath, privilegeKeyPath }, 'firm KMS keys provisioned');

      // ── Step 9: INSERT public.audit_global ───────────────────────────────
      await tx`
        INSERT INTO public.audit_global (
          occurred_at,
          actor_type,
          actor_id,
          action,
          target_type,
          target_id,
          payload
        ) VALUES (
          now(),
          'system',
          NULL,
          'firm.created',
          'firm',
          ${firmId},
          ${JSON.stringify({
            slug: input.slug,
            legalName: input.legalName,
            afm: input.afm,
            tier: input.tier,
            billingEmail: input.billingEmail,
            ownerEmail: input.ownerEmail,
            ownerFullName: input.ownerFullName,
            ownerBarId: input.ownerBarId ?? null,
            trialDays,
            schemaName,
            vault_data_key_path: dataKeyPath,
            vault_privilege_key_path: privilegeKeyPath,
            // ownerPasswordHash intentionally omitted
          })}
        )
      `;

      logger.info({ firmId, action: 'firm.created' }, 'audit_global entry written');

      // ── Step 10: Return result ────────────────────────────────────────────
      const result: ProvisionedFirm = {
        firmId,
        schemaName,
        ownerUserId,
        trialEndsAt,
        vaultKeyPath: dataKeyPath, // live Vault path from provisionFirmKeys (Day 5)
      };

      logger.info({ firmId, schemaName, ownerUserId }, 'provisioning firm — success');

      return result;
    });

  } catch (err: unknown) {
    // Re-throw domain errors as-is; wrap everything else
    if (err instanceof SlugTakenError || err instanceof ProvisioningError) {
      throw err;
    }

    logger.error({ err, slug: input.slug }, 'provisioning firm — unexpected error (transaction rolled back)');

    throw new ProvisioningError(
      `Unexpected error provisioning firm "${input.slug}": ${String(err)}`,
      err
    );
  }
}

// ---------------------------------------------------------------------------
// deprovisionFirm — soft delete
// ---------------------------------------------------------------------------

/**
 * Soft-deletes a firm by setting status = 'cancelled' in public.firms
 * and status = 'cancelled' in public.subscriptions.
 *
 * The firm's Postgres schema (firm_<slug>) is RETAINED for the legally
 * required data retention period:
 *   - GDPR Art. 17 right-to-erasure: erasure window is 30 days from request.
 *   - Greek N.4624/2019 §31: pseudonymisation required before erasure.
 *   - Greek accounting law: financial records retained 10 years.
 *
 * Hard deletion of the schema (DROP SCHEMA firm_<slug> CASCADE) is a
 * separate Day 30+ admin task executed by a privileged maintenance job
 * after the retention window has elapsed and pseudonymisation is complete.
 *
 * @param firmId - UUID of the firm to cancel.
 * @param reason - Human-readable reason for the cancellation (audit log).
 * @param logger - Optional Pino-compatible logger; falls back to console.
 *
 * @throws {ProvisioningError} - If the firm does not exist or the DB update fails.
 */
export async function deprovisionFirm(
  firmId: string,
  reason: string,
  logger: Logger = consoleLogger
): Promise<void> {
  logger.info({ firmId, reason }, 'deprovisioning firm — start (soft delete)');

  try {
    await pool.begin(async (tx) => {

      // Verify firm exists and is not already cancelled
      const firmRows = await tx<Array<{ id: string; status: string; slug: string }>>`
        SELECT id, status, slug
        FROM public.firms
        WHERE id = ${firmId}
        LIMIT 1
      `;

      const firm = firmRows[0];
      if (firm === undefined) {
        throw new ProvisioningError(`Firm not found: ${firmId}`);
      }

      if (firm.status === 'cancelled') {
        logger.warn({ firmId, slug: firm.slug }, 'deprovision called on already-cancelled firm — no-op');
        return;
      }

      // Update firms.status → cancelled
      await tx`
        UPDATE public.firms
        SET
          status     = 'cancelled',
          updated_at = now()
        WHERE id = ${firmId}
      `;

      // Update subscriptions.status → cancelled
      await tx`
        UPDATE public.subscriptions
        SET
          status               = 'cancelled',
          cancel_at_period_end = false,
          updated_at           = now()
        WHERE firm_id = ${firmId}
          AND status NOT IN ('cancelled', 'expired')
      `;

      // Audit log
      await tx`
        INSERT INTO public.audit_global (
          occurred_at,
          actor_type,
          actor_id,
          action,
          target_type,
          target_id,
          payload
        ) VALUES (
          now(),
          'system',
          NULL,
          'firm.cancelled',
          'firm',
          ${firmId},
          ${JSON.stringify({
            reason,
            slug: firm.slug,
            previousStatus: firm.status,
            note: 'Schema retained for legal retention period. Hard delete: Day 30+ admin task.',
          })}
        )
      `;

      logger.info(
        { firmId, slug: firm.slug },
        'firm soft-deleted (schema retained for retention period)'
      );
    });

  } catch (err: unknown) {
    if (err instanceof ProvisioningError) throw err;

    logger.error({ err, firmId }, 'deprovision firm — unexpected error');
    throw new ProvisioningError(
      `Unexpected error deprovisioning firm "${firmId}": ${String(err)}`,
      err
    );
  }
}

// ---------------------------------------------------------------------------
// TODO: tests at packages/db/test/provisioning.test.ts (Day 5)
//
// Test cases to cover:
//
// 1. Happy path — starter signup, owner can query tenant schema
//    - provisionFirm() returns correct firmId, schemaName, ownerUserId
//    - public.firms row exists with status='trial'
//    - public.firm_users row exists with role='owner', is_active=true
//    - public.subscriptions row exists with status='trialing', price=1900
//    - public.firm_kms_keys has 2 rows (dek + pek), status='active'
//    - firm_<slug>.users has 1 row matching the owner
//    - public.audit_global has 'firm.created' entry, payload has no password_hash
//
// 2. Slug collision (advisory lock + race simulation)
//    - First call succeeds, second call with same slug throws SlugTakenError
//    - Simulate race: two concurrent provisionFirm() calls for same slug
//      → only one succeeds, other throws SlugTakenError
//    - Verify advisory lock serialises the two transactions correctly
//
// 3. DDL failure midway (e.g. corrupt template SQL)
//    - Patch prepareCloneSql to return invalid SQL
//    - provisionFirm() throws ProvisioningError
//    - Verify: public.firms has NO row for that slug
//    - Verify: schema firm_<slug> does NOT exist in pg_namespace
//    - Confirm full rollback including CREATE SCHEMA
//
// 4. Duplicate AFM (different firm)
//    - Two firms with different slugs but same AFM → currently ALLOWED
//    - public.firms has no UNIQUE constraint on afm (by design)
//    - Rationale: Greek law firms can share an ΑΦΜ when the firm has multiple
//      legal entities or branches. OPEN QUESTION: verify with Niko whether
//      we should add a soft-warning (not a hard constraint) for duplicate AFMs.
//
// 5. Trial expiration calculation
//    - trialDays=30, timezone Europe/Athens
//    - trial_ends_at should be 30 days from now() in UTC
//    - Verify using pg_timezone_names that stored timestamp is correct when
//      server TZ differs from Europe/Athens
//    - Edge case: provision at 23:59 Athens time → trial_ends_at next month
//
// 6. deprovisionFirm — soft delete
//    - Firm status → 'cancelled', subscription status → 'cancelled'
//    - Schema firm_<slug> still exists after deprovision
//    - audit_global has 'firm.cancelled' entry with reason
//    - Calling deprovisionFirm again on already-cancelled firm → no-op (no error)
//
// 7. Input sanitisation guard
//    - Slug with uppercase → ProvisioningError (not SlugTakenError)
//    - Slug with spaces → ProvisioningError
//    - Slug that passes regex but getFirmSchemaName() produces invalid schema → ProvisioningError
// ---------------------------------------------------------------------------
