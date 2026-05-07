// Tenant Resolver — schema-per-tenant routing
// Κάθε firm έχει δικό της schema: firm_<slug_short>
// Αναλυτικά: docs/v03/data-model-v03.md §2.1
//
// 2026-04-29 fix-pass: M7 (regex centralization), C2 (withTenantContext tx isolation)

import postgres from 'postgres';

// ---------------------------------------------------------------------------
// Canonical regex constants — single source of truth for the whole monorepo.
// Import these in fastify-tenant.ts and any provisioning scripts; do NOT
// duplicate the literals.
// ---------------------------------------------------------------------------

/** Matches a valid Postgres schema name for a tenant firm. */
export const FIRM_SCHEMA_REGEX = /^firm_[a-z0-9_]{1,27}$/;

/** Matches a valid firm URL slug. */
export const FIRM_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/** Maximum character length of a firm slug (enforced by FIRM_SLUG_REGEX). */
export const MAX_SLUG_LENGTH = 32;

/**
 * Μετατρέπει firm slug σε Postgres schema name.
 *
 * @example
 * getFirmSchemaName('acme-legal') → 'firm_acme_legal'
 * getFirmSchemaName('very-long-name-that-exceeds-limit') → 'firm_very_long_name_that_ex'
 */
export function getFirmSchemaName(firmSlug: string): string {
  // Κανονικοποίηση: lowercase, αντικατάσταση μη-alphanumeric με underscore
  const normalized = firmSlug
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  // Truncate στο max μήκος (αφαιρώντας το "firm_" prefix = 5 chars)
  const truncated = normalized.slice(0, MAX_SLUG_LENGTH - 5);

  return `firm_${truncated}`;
}

/**
 * Ορίζει search_path για tenant-scoped queries.
 * Πρέπει να κληθεί σε κάθε connection πριν από tenant queries.
 *
 * ΠΡΟΣΟΧΗ: Ποτέ μην περάσετε user input απευθείας χωρίς validation.
 *
 * @param sql  - A postgres.js Sql instance (connection or transaction).
 * @param firmSlug - The firm's URL slug (e.g. "acme-legal").
 */
export async function setTenantSearchPath(
  sql: postgres.Sql<{}>,
  firmSlug: string
): Promise<void> {
  const schemaName = getFirmSchemaName(firmSlug);

  // Whitelist validation — αποτροπή SQL injection
  if (!FIRM_SCHEMA_REGEX.test(schemaName)) {
    throw new Error(`Μη έγκυρο schema name: ${schemaName}`);
  }

  // schemaName is whitelisted by FIRM_SCHEMA_REGEX above; unsafe interpolation is safe here.
  await sql.unsafe(`SET search_path TO "${schemaName}", public`);
}

/**
 * Επιστρέφει tenant-scoped connection (search_path preset).
 * Χρησιμοποιείται στα Fastify route handlers μετά το resolveTenant middleware.
 *
 * MIGRATION NOTE (C2 fix, 2026-04-29):
 * The callback now receives the transaction (`tx`) as its first argument.
 * All queries inside the callback MUST use `tx`, not the outer `sql`, to
 * guarantee they run on the same connection where SET LOCAL is in effect.
 *
 * Before (broken — queries ran on outer pool, SET LOCAL had no effect):
 *   withTenantContext(sql, slug, () => sql`SELECT ...`)
 *
 * After (correct):
 *   withTenantContext(sql, slug, (tx) => tx`SELECT ...`)
 *
 * @param sql      - The outer postgres.js pool/client.
 * @param firmSlug - The firm's URL slug.
 * @param callback - Runs inside the transaction; MUST use the provided tx.
 */
export async function withTenantContext<T>(
  sql: postgres.Sql<{}>,
  firmSlug: string,
  callback: (tx: postgres.Sql<{}>) => Promise<T>
): Promise<T> {
  const schemaName = getFirmSchemaName(firmSlug);

  if (!FIRM_SCHEMA_REGEX.test(schemaName)) {
    throw new Error(`Μη έγκυρο schema name: ${schemaName}`);
  }

  return sql.begin(async (tx: postgres.TransactionSql<{}>) => {
    // schemaName is whitelisted by FIRM_SCHEMA_REGEX above; unsafe is safe here.
    await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", public`);
    // CRITICAL: pass tx into callback so all queries use the same connection.
    return callback(tx as unknown as postgres.Sql<{}>);
  }) as Promise<T>;
}
