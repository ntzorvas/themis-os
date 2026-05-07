/**
 * Invoice numbering service — ΤΘ-{YYYY}-{NNNN}
 *
 * Per-firm sequential invoice numbers using Postgres advisory locks
 * for concurrent-safe generation.
 *
 * Format: ΤΘ-{YYYY}-{NNNN zero-padded to 4 digits}
 * Example: ΤΘ-2026-0001
 *
 * Sequence resets annually (year part changes).
 *
 * Advisory lock key: hash of (firm schema name + year) → int4 pair
 * Uses pg_advisory_xact_lock (session-level, auto-released on txn end).
 *
 * @module lib/invoice-numbering
 */

import type postgres from 'postgres';

// Type alias matching the tx passed from withTenantSchema
type TxSql = postgres.Sql<{}>;

/**
 * Generates the next sequential invoice number for the current firm
 * and year, acquiring a Postgres advisory transaction lock to prevent
 * duplicate numbers under concurrent requests.
 *
 * MUST be called inside a withTenantSchema transaction (the same `tx`
 * must be passed in so the advisory lock is tied to that transaction).
 *
 * @param tx         - postgres.js transaction connection (from withTenantSchema)
 * @param schemaName - firm schema name (used to derive advisory lock key)
 * @param year       - Full year number (e.g. 2026)
 * @returns          - Invoice number string, e.g. "ΤΘ-2026-0001"
 */
export async function nextInvoiceNumber(
  tx: TxSql,
  schemaName: string,
  year: number
): Promise<string> {
  // Derive a stable int4 advisory lock key from schema name + year.
  // hashtext() is stable per Postgres version; combined with year gives annual reset.
  // We use two int4 values: (1, hash) to namespace away from other advisory locks.
  const lockRows = await tx<{ hash: number }[]>`
    SELECT hashtext(${schemaName} || '-invoice-' || ${String(year)}) AS hash
  `;
  const hash = lockRows[0]?.hash ?? 0;

  // Acquire advisory lock (transaction-scoped — released automatically at COMMIT/ROLLBACK).
  // First arg is a fixed namespace key (42 = THEMIS billing namespace).
  await tx`SELECT pg_advisory_xact_lock(42, ${hash})`;

  // Find the highest invoice number for this firm+year in the invoice table.
  // Pattern: ΤΘ-{year}-{seq}
  const prefix = `ΤΘ-${String(year)}-`;

  interface MaxRow { max_seq: string | null }
  const rows = await tx<MaxRow[]>`
    SELECT max(
      CAST(substring(invoice_number FROM ${`^ΤΘ-${String(year)}-(\\d+)$`}) AS int)
    )::text AS max_seq
    FROM invoice
    WHERE invoice_number LIKE ${prefix + '%'}
  `;

  const maxSeq = rows[0]?.max_seq !== null && rows[0]?.max_seq !== undefined
    ? parseInt(rows[0].max_seq, 10)
    : 0;

  const nextSeq = (isNaN(maxSeq) ? 0 : maxSeq) + 1;
  const padded = String(nextSeq).padStart(4, '0');

  return `ΤΘ-${String(year)}-${padded}`;
}
