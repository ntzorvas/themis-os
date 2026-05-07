/**
 * Invoices routes — /api/v1/invoices/*
 *
 * myDATA-compliant invoice generation with billing_split support (Invariant #3).
 * All monetary values in BIGINT cents (EUR).
 *
 * Endpoints:
 *   POST   /api/v1/invoices/draft            — create draft from unbilled time_entries + expenses
 *   POST   /api/v1/invoices/:id/finalize     — draft → issued, generate invoice_number, mark billed
 *   POST   /api/v1/invoices/:id/send         — mark sent_at (TODO Phase 1.5 email)
 *   POST   /api/v1/invoices/:id/payments     — record payment
 *   GET    /api/v1/invoices                  — list with filters
 *   GET    /api/v1/invoices/:id              — detail with lines + payments
 *   GET    /api/v1/invoices/:id/pdf          — stub 501
 *   DELETE /api/v1/invoices/:id             — soft delete (draft only)
 *
 * Billing split (Invariant #3):
 *   Αν multiple parties with billing_split_percentage in matter_party,
 *   POST /invoices/draft creates one draft invoice per party scaled by split_pct.
 *
 * Invariants:
 *   #3  All money BIGINT cents
 *   #6  withTenantSchema wraps every query
 *   #4  ALL mutations write to audit_log
 *   #10 Greek compliance — myDATA fields, ΤΘ numbering
 *
 * @module routes/invoices
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import * as crypto from 'node:crypto';
import { withTenantSchema } from '../../plugins/fastify-tenant.js';
import { nextInvoiceNumber } from '../../lib/invoice-numbering.js';
import { calculateVat, calculateTotal, DEFAULT_VAT_RATE } from '../../lib/greek-vat.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_INVOICE_STATUSES = ['draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled'] as const;
type InvoiceStatus = typeof VALID_INVOICE_STATUSES[number];

const VALID_PAYMENT_METHODS = [
  'bank_transfer', 'viva', 'ethniki', 'cash', 'check', 'other',
] as const;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

function errResponse(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string
): ReturnType<FastifyReply['code']> {
  return reply.code(status).send({
    error: { code, message, requestId: reply.request.id },
  });
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateDraftInvoiceSchema = z.object({
  matter_id: z
    .string({ required_error: 'matter_id είναι υποχρεωτικό.' })
    .uuid('matter_id πρέπει να είναι έγκυρο UUID.'),
  // If party_id provided: create invoice for that specific party only.
  // If omitted: respect billing_split_percentage from matter_party.
  party_id: z.string().uuid('party_id πρέπει να είναι έγκυρο UUID.').optional(),
  vat_rate: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .default(DEFAULT_VAT_RATE),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'due_date: μορφή YYYY-MM-DD.')
    .optional(),
  notes: z.string().max(2000).optional(),
});

type CreateDraftInvoiceInput = z.infer<typeof CreateDraftInvoiceSchema>;

const RecordPaymentSchema = z.object({
  amount_eur_cents: z
    .number({ required_error: 'amount_eur_cents είναι υποχρεωτικό.' })
    .int('amount_eur_cents πρέπει να είναι ακέραιος (cents).')
    .positive('amount_eur_cents πρέπει να είναι θετικό.'),
  payment_method: z.enum(VALID_PAYMENT_METHODS, {
    errorMap: () => ({
      message: `payment_method πρέπει να είναι ένα από: ${VALID_PAYMENT_METHODS.join(', ')}.`,
    }),
  }),
  payment_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_date: μορφή YYYY-MM-DD.')
    .optional(),
  reference: z.string().max(255).optional(),
  idempotency_key: z.string().max(64).optional(),
});

type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface InvoiceRow {
  id: string;
  invoice_number: string;
  matter_id: string | null;
  bill_to_party_id: string;
  issue_date: string;
  due_date: string | null;
  subtotal_eur_cents: string;
  vat_eur_cents: string;
  total_eur_cents: string;
  status: string;
  mydata_mark: string | null;
  mydata_uid: string | null;
  paid_at: Date | null;
  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  line_number: number;
  description: string;
  quantity: string;
  unit_price_eur_cents: string;
  vat_pct: number;
  total_eur_cents: string;
  source_type: string;
  source_id: string | null;
}

interface PaymentRow {
  id: string;
  invoice_id: string;
  amount_eur_cents: string;
  payment_date: string;
  payment_method: string;
  reference: string | null;
  recorded_by_user_id: string | null;
  created_at: Date;
}

interface TimeEntryBillable {
  id: string;
  duration_minutes: number;
  billable_rate_eur_cents: number;
  description: string | null;
}

interface ExpenseBillable {
  id: string;
  amount_eur_cents: string;
  description: string;
  expense_type: string;
}

interface BillingSplitRow {
  party_id: string;
  billing_split_percentage: string;
}

interface CountRow {
  count: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Computes billable_amount_cents for a time entry (rate * duration / 60).
 * Returns integer cents.
 */
function timeEntryBillableCents(durationMinutes: number, ratePerHourCents: number): number {
  return Math.round((durationMinutes * ratePerHourCents) / 60);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const invoicesRoutes: FastifyPluginAsync = async (fastify) => {
  // ======================================================================
  // POST /api/v1/invoices/draft
  // Create draft invoice(s) from unbilled time_entries + expenses.
  // Respects billing_split_percentage from matter_party.
  // Registered BEFORE /:id routes to prevent "draft" matching as UUID.
  // ======================================================================

  fastify.post(
    '/api/v1/invoices/draft',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreateDraftInvoiceSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: CreateDraftInvoiceInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;
      const schemaName = request.firmContext?.schemaName ?? 'tenant_template';
      const year = new Date().getFullYear();
      const vatRate = input.vat_rate;

      const createdInvoices = await withTenantSchema(request, async (tx) => {
        // 1. Verify matter exists
        const matterCheck = await tx<{ id: string }[]>`
          SELECT id FROM matter WHERE id = ${input.matter_id}::uuid AND deleted_at IS NULL LIMIT 1
        `;
        if (matterCheck[0] === undefined) {
          throw Object.assign(
            new Error('Η υπόθεση δεν βρέθηκε.'),
            { code: 'MATTER_NOT_FOUND', statusCode: 404 }
          );
        }

        // 2. Collect unbilled billable time entries for this matter
        const timeEntries = await tx<TimeEntryBillable[]>`
          SELECT id, duration_minutes, billable_rate_eur_cents, description
          FROM time_entry
          WHERE matter_id = ${input.matter_id}::uuid
            AND billable = true
            AND status = 'draft'
            AND invoice_id IS NULL
        `;

        // 3. Collect unbilled billable expenses for this matter
        const expenses = await tx<ExpenseBillable[]>`
          SELECT id, amount_eur_cents, description, expense_type
          FROM expense
          WHERE matter_id = ${input.matter_id}::uuid
            AND billable = true
            AND status = 'draft'
            AND invoice_id IS NULL
        `;

        if (timeEntries.length === 0 && expenses.length === 0) {
          throw Object.assign(
            new Error('Δεν υπάρχουν χρεώσιμες εγγραφές για τιμολόγηση.'),
            { code: 'NO_BILLABLE_ENTRIES', statusCode: 422 }
          );
        }

        // 4. Compute base subtotal
        const timeSubtotal = timeEntries.reduce((sum, te) => {
          return sum + timeEntryBillableCents(te.duration_minutes, te.billable_rate_eur_cents);
        }, 0);

        const expenseSubtotal = expenses.reduce((sum, ex) => {
          return sum + parseInt(ex.amount_eur_cents, 10);
        }, 0);

        const baseSubtotal = timeSubtotal + expenseSubtotal;

        // 5. Determine parties to invoice
        let partiesToInvoice: Array<{ party_id: string; split_pct: number }> = [];

        if (input.party_id !== undefined) {
          // Specific party requested — use 100%
          partiesToInvoice = [{ party_id: input.party_id, split_pct: 100 }];
        } else {
          // Look up billing splits from matter_party
          const splits = await tx<BillingSplitRow[]>`
            SELECT party_id, billing_split_percentage::text
            FROM matter_party
            WHERE matter_id = ${input.matter_id}::uuid
              AND side = 'ours'
              AND billing_split_percentage IS NOT NULL
              AND (valid_to IS NULL OR valid_to > now())
          `;

          if (splits.length > 0) {
            partiesToInvoice = splits.map((s) => ({
              party_id: s.party_id,
              split_pct: parseFloat(s.billing_split_percentage),
            }));
          } else {
            // No split defined — look for primary 'ours' client party
            const clientParty = await tx<{ party_id: string }[]>`
              SELECT mp.party_id
              FROM matter_party mp
              WHERE mp.matter_id = ${input.matter_id}::uuid
                AND mp.role = 'client'
                AND mp.side = 'ours'
                AND (mp.valid_to IS NULL OR mp.valid_to > now())
              ORDER BY mp.is_primary_contact DESC
              LIMIT 1
            `;

            if (clientParty[0] === undefined) {
              throw Object.assign(
                new Error('Δεν βρέθηκε χρεούμενος αντίδικος (client) στην υπόθεση.'),
                { code: 'NO_CLIENT_PARTY', statusCode: 422 }
              );
            }

            partiesToInvoice = [{ party_id: clientParty[0].party_id, split_pct: 100 }];
          }
        }

        // 6. Create one draft invoice per party with scaled amounts
        const invoiceIds: string[] = [];

        for (const { party_id, split_pct } of partiesToInvoice) {
          // Scale amounts by split percentage
          const splitFactor = split_pct / 100;
          const scaledSubtotal = Math.round(baseSubtotal * splitFactor);
          const vatCents = calculateVat(scaledSubtotal, vatRate);
          const totalCents = calculateTotal(scaledSubtotal, vatRate);

          // Generate placeholder invoice number for draft (will be replaced on finalize)
          const draftNumber = `DRAFT-${crypto.randomUUID()}`;

          const invoiceRows = await tx<{ id: string }[]>`
            INSERT INTO invoice
              (invoice_number, matter_id, bill_to_party_id, due_date,
               subtotal_eur_cents, vat_eur_cents, total_eur_cents,
               status, notes)
            VALUES
              (${draftNumber},
               ${input.matter_id}::uuid,
               ${party_id}::uuid,
               ${input.due_date ?? null}::date,
               ${scaledSubtotal},
               ${vatCents},
               ${totalCents},
               'draft',
               ${input.notes ?? null})
            RETURNING id
          `;

          const invoiceId = invoiceRows[0]?.id;
          if (invoiceId === undefined) {
            throw Object.assign(new Error('INSERT invoice returned no row'), { code: 'DB_ERROR' });
          }

          invoiceIds.push(invoiceId);

          // 7. Insert invoice lines for time entries (scaled by split)
          let lineNumber = 1;

          for (const te of timeEntries) {
            const baseCents = timeEntryBillableCents(te.duration_minutes, te.billable_rate_eur_cents);
            const scaledCents = Math.round(baseCents * splitFactor);
            const unitPrice = te.duration_minutes > 0
              ? Math.round((te.billable_rate_eur_cents / 60) * splitFactor)
              : 0;

            await tx`
              INSERT INTO invoice_line
                (invoice_id, line_number, description, quantity, unit_price_eur_cents,
                 vat_pct, total_eur_cents, source_type, source_id)
              VALUES
                (${invoiceId}::uuid,
                 ${lineNumber},
                 ${te.description ?? 'Χρόνος εργασίας'},
                 ${te.duration_minutes},
                 ${unitPrice},
                 ${Math.round(vatRate)},
                 ${scaledCents},
                 'time',
                 ${te.id})
            `;
            lineNumber++;
          }

          for (const ex of expenses) {
            const baseCents = parseInt(ex.amount_eur_cents, 10);
            const scaledCents = Math.round(baseCents * splitFactor);

            await tx`
              INSERT INTO invoice_line
                (invoice_id, line_number, description, quantity, unit_price_eur_cents,
                 vat_pct, total_eur_cents, source_type, source_id)
              VALUES
                (${invoiceId}::uuid,
                 ${lineNumber},
                 ${ex.description},
                 1,
                 ${scaledCents},
                 ${Math.round(vatRate)},
                 ${scaledCents},
                 'expense',
                 ${ex.id})
            `;
            lineNumber++;
          }

          await tx`
            INSERT INTO audit_log
              (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
            VALUES
              (${actorUserId}::uuid,
               'invoice.draft',
               'invoice',
               ${invoiceId},
               ${JSON.stringify({
                 matter_id: input.matter_id,
                 party_id,
                 split_pct,
                 subtotal_eur_cents: scaledSubtotal,
                 vat_eur_cents: vatCents,
                 total_eur_cents: totalCents,
               })}::jsonb,
               ${request.ip}::inet,
               ${userAgent},
               'success')
          `;
        }

        // 8. Fetch and return created invoices
        return tx<InvoiceRow[]>`
          SELECT
            id, invoice_number, matter_id, bill_to_party_id, issue_date, due_date,
            subtotal_eur_cents, vat_eur_cents, total_eur_cents, status,
            mydata_mark, mydata_uid, paid_at, notes, version, created_at, updated_at
          FROM invoice
          WHERE id = ANY(${invoiceIds}::uuid[])
          ORDER BY created_at ASC
        `;
      });

      return reply.code(201).send({ data: createdInvoices });
    }
  );

  // ======================================================================
  // GET /api/v1/invoices
  // ======================================================================

  fastify.get(
    '/api/v1/invoices',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;

      const matterId = query['matter_id'] ?? null;
      const partyId = query['party_id'] ?? null;
      const statusFilter = query['status'] ?? null;

      if (statusFilter !== null && !(VALID_INVOICE_STATUSES as ReadonlyArray<string>).includes(statusFilter)) {
        return errResponse(
          reply,
          400,
          'INVALID_STATUS',
          `status πρέπει να είναι ένα από: ${VALID_INVOICE_STATUSES.join(', ')}.`
        );
      }

      const rawLimit = parseInt(query['limit'] ?? String(DEFAULT_LIMIT), 10);
      const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
      const rawOffset = parseInt(query['offset'] ?? '0', 10);
      const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

      const typedStatus = (statusFilter as InvoiceStatus | null);

      const { rows, total } = await withTenantSchema(request, async (tx) => {
        const [countRows, dataRows] = await Promise.all([
          tx<CountRow[]>`
            SELECT count(*)::text AS count
            FROM invoice
            WHERE (${matterId}::text IS NULL OR matter_id = ${matterId}::uuid)
              AND (${partyId}::text IS NULL OR bill_to_party_id = ${partyId}::uuid)
              AND (${typedStatus}::text IS NULL OR status = ${typedStatus}::tenant_template.invoice_status_t)
          `,
          tx<InvoiceRow[]>`
            SELECT
              id, invoice_number, matter_id, bill_to_party_id, issue_date, due_date,
              subtotal_eur_cents, vat_eur_cents, total_eur_cents, status,
              mydata_mark, mydata_uid, paid_at, notes, version, created_at, updated_at
            FROM invoice
            WHERE (${matterId}::text IS NULL OR matter_id = ${matterId}::uuid)
              AND (${partyId}::text IS NULL OR bill_to_party_id = ${partyId}::uuid)
              AND (${typedStatus}::text IS NULL OR status = ${typedStatus}::tenant_template.invoice_status_t)
            ORDER BY created_at DESC
            LIMIT ${limit}
            OFFSET ${offset}
          `,
        ]);

        return {
          rows: dataRows,
          total: parseInt(countRows[0]?.count ?? '0', 10),
        };
      });

      return reply.code(200).send({
        data: rows,
        meta: {
          total,
          page: Math.floor(offset / limit) + 1,
          per_page: limit,
        },
      });
    }
  );

  // ======================================================================
  // GET /api/v1/invoices/:id
  // Detail with invoice_lines + payments
  // ======================================================================

  fastify.get(
    '/api/v1/invoices/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const result = await withTenantSchema(request, async (tx) => {
        const [invoiceRows, lines, payments] = await Promise.all([
          tx<InvoiceRow[]>`
            SELECT
              id, invoice_number, matter_id, bill_to_party_id, issue_date, due_date,
              subtotal_eur_cents, vat_eur_cents, total_eur_cents, status,
              mydata_mark, mydata_uid, paid_at, notes, version, created_at, updated_at
            FROM invoice
            WHERE id = ${id}::uuid
            LIMIT 1
          `,
          tx<InvoiceLineRow[]>`
            SELECT
              id, invoice_id, line_number, description, quantity, unit_price_eur_cents,
              vat_pct, total_eur_cents, source_type, source_id
            FROM invoice_line
            WHERE invoice_id = ${id}::uuid
            ORDER BY line_number ASC
          `,
          tx<PaymentRow[]>`
            SELECT
              id, invoice_id, amount_eur_cents, payment_date, payment_method,
              reference, recorded_by_user_id, created_at
            FROM payment
            WHERE invoice_id = ${id}::uuid
            ORDER BY payment_date ASC, created_at ASC
          `,
        ]);

        return { invoice: invoiceRows[0] ?? null, lines, payments };
      });

      if (result.invoice === null) {
        return errResponse(reply, 404, 'INVOICE_NOT_FOUND', 'Το τιμολόγιο δεν βρέθηκε.');
      }

      return reply.code(200).send({
        data: {
          ...result.invoice,
          lines: result.lines,
          payments: result.payments,
        },
      });
    }
  );

  // ======================================================================
  // POST /api/v1/invoices/:id/finalize
  // Draft → issued. Generates sequential invoice_number, locks lines,
  // marks time_entries + expenses as status='invoiced'.
  // ======================================================================

  fastify.post(
    '/api/v1/invoices/:id/finalize',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;
      const schemaName = request.firmContext?.schemaName ?? 'tenant_template';
      const year = new Date().getFullYear();

      const finalized = await withTenantSchema(request, async (tx) => {
        // Load invoice with optimistic version
        const invoiceRows = await tx<InvoiceRow[]>`
          SELECT id, status, version, matter_id
          FROM invoice
          WHERE id = ${id}::uuid
          LIMIT 1
        `;

        const invoice = invoiceRows[0];
        if (invoice === undefined) return null;

        if (invoice.status !== 'draft') {
          throw Object.assign(
            new Error('Μόνο τιμολόγια σε κατάσταση "draft" μπορούν να οριστικοποιηθούν.'),
            { code: 'INVALID_STATUS', statusCode: 409 }
          );
        }

        // Generate next invoice number (concurrent-safe via advisory lock)
        const invoiceNumber = await nextInvoiceNumber(tx, schemaName, year);

        // Finalize invoice
        const updatedRows = await tx<InvoiceRow[]>`
          UPDATE invoice SET
            invoice_number = ${invoiceNumber},
            status         = 'issued',
            issue_date     = CURRENT_DATE,
            updated_at     = now(),
            version        = version + 1
          WHERE id = ${id}::uuid AND status = 'draft' AND version = ${invoice.version}
          RETURNING
            id, invoice_number, matter_id, bill_to_party_id, issue_date, due_date,
            subtotal_eur_cents, vat_eur_cents, total_eur_cents, status,
            mydata_mark, mydata_uid, paid_at, notes, version, created_at, updated_at
        `;

        const updated = updatedRows[0];
        if (updated === undefined) {
          throw Object.assign(
            new Error('Concurrent update detected — παρακαλώ επαναλάβετε.'),
            { code: 'OPTIMISTIC_LOCK_FAILURE', statusCode: 409 }
          );
        }

        // Mark source time entries as invoiced
        await tx`
          UPDATE time_entry SET
            status     = 'invoiced',
            invoice_id = ${id}::uuid
          WHERE invoice_id IS NULL
            AND matter_id = ${invoice.matter_id ?? null}::uuid
            AND billable = true
            AND status = 'draft'
            AND id IN (
              SELECT source_id::uuid FROM invoice_line
              WHERE invoice_id = ${id}::uuid AND source_type = 'time'
            )
        `;

        // Mark source expenses as invoiced
        await tx`
          UPDATE expense SET
            status     = 'invoiced',
            invoice_id = ${id}::uuid
          WHERE invoice_id IS NULL
            AND matter_id = ${invoice.matter_id ?? null}::uuid
            AND billable = true
            AND status = 'draft'
            AND id IN (
              SELECT source_id::uuid FROM invoice_line
              WHERE invoice_id = ${id}::uuid AND source_type = 'expense'
            )
        `;

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'invoice.finalize',
             'invoice',
             ${id},
             ${JSON.stringify({ invoice_number: invoiceNumber, status: 'issued' })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return updated;
      });

      if (finalized === null) {
        return errResponse(reply, 404, 'INVOICE_NOT_FOUND', 'Το τιμολόγιο δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: finalized });
    }
  );

  // ======================================================================
  // POST /api/v1/invoices/:id/send
  // Mark as sent. Email integration deferred to Phase 1.5.
  // ======================================================================

  fastify.post(
    '/api/v1/invoices/:id/send',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const sent = await withTenantSchema(request, async (tx) => {
        const invoiceRows = await tx<{ id: string; status: string }[]>`
          SELECT id, status FROM invoice WHERE id = ${id}::uuid LIMIT 1
        `;

        const invoice = invoiceRows[0];
        if (invoice === undefined) return null;

        if (invoice.status !== 'issued') {
          throw Object.assign(
            new Error('Μόνο τιμολόγια σε κατάσταση "issued" μπορούν να σταλούν.'),
            { code: 'INVALID_STATUS', statusCode: 409 }
          );
        }

        const rows = await tx<InvoiceRow[]>`
          UPDATE invoice SET
            status     = 'sent',
            updated_at = now(),
            version    = version + 1
          WHERE id = ${id}::uuid AND status = 'issued'
          RETURNING
            id, invoice_number, matter_id, bill_to_party_id, issue_date, due_date,
            subtotal_eur_cents, vat_eur_cents, total_eur_cents, status,
            mydata_mark, mydata_uid, paid_at, notes, version, created_at, updated_at
        `;

        const row = rows[0];
        if (row === undefined) return null;

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'invoice.send',
             'invoice',
             ${id},
             ${JSON.stringify({ status: 'sent', note: 'email_phase_1.5' })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return row;
      });

      if (sent === null) {
        return errResponse(reply, 404, 'INVOICE_NOT_FOUND', 'Το τιμολόγιο δεν βρέθηκε.');
      }

      // TODO Phase 1.5: trigger email delivery
      return reply.code(200).send({
        data: sent,
        meta: { email_delivery: 'pending_phase_1_5' },
      });
    }
  );

  // ======================================================================
  // POST /api/v1/invoices/:id/payments
  // Record payment. Marks invoice as 'paid' when fully settled.
  // ======================================================================

  fastify.post(
    '/api/v1/invoices/:id/payments',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parseResult = RecordPaymentSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: RecordPaymentInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const result = await withTenantSchema(request, async (tx) => {
        const invoiceRows = await tx<{ id: string; status: string; total_eur_cents: string }[]>`
          SELECT id, status, total_eur_cents
          FROM invoice
          WHERE id = ${id}::uuid
          LIMIT 1
        `;

        const invoice = invoiceRows[0];
        if (invoice === undefined) return null;

        if (!['issued', 'sent', 'overdue'].includes(invoice.status)) {
          throw Object.assign(
            new Error('Πληρωμές μπορούν να καταχωρηθούν μόνο σε τιμολόγια issued/sent/overdue.'),
            { code: 'INVALID_STATUS', statusCode: 409 }
          );
        }

        // Check idempotency key if provided
        if (input.idempotency_key !== undefined) {
          const existing = await tx<{ id: string }[]>`
            SELECT id FROM payment WHERE idempotency_key = ${input.idempotency_key} LIMIT 1
          `;
          if (existing[0] !== undefined) {
            throw Object.assign(
              new Error('Η πληρωμή με αυτό το idempotency_key έχει ήδη καταχωρηθεί.'),
              { code: 'DUPLICATE_PAYMENT', statusCode: 409 }
            );
          }
        }

        const paymentRows = await tx<PaymentRow[]>`
          INSERT INTO payment
            (invoice_id, amount_eur_cents, payment_date, payment_method,
             reference, recorded_by_user_id, idempotency_key)
          VALUES
            (${id}::uuid,
             ${input.amount_eur_cents},
             ${input.payment_date ?? null}::date,
             ${input.payment_method}::tenant_template.payment_method_t,
             ${input.reference ?? null},
             ${actorUserId}::uuid,
             ${input.idempotency_key ?? null})
          RETURNING
            id, invoice_id, amount_eur_cents, payment_date, payment_method,
            reference, recorded_by_user_id, created_at
        `;

        const payment = paymentRows[0];
        if (payment === undefined) {
          throw Object.assign(new Error('INSERT payment returned no row'), { code: 'DB_ERROR' });
        }

        // Check if invoice is now fully paid
        const totalPaidRows = await tx<{ total_paid: string }[]>`
          SELECT coalesce(sum(amount_eur_cents), 0)::text AS total_paid
          FROM payment
          WHERE invoice_id = ${id}::uuid
        `;

        const totalPaid = parseInt(totalPaidRows[0]?.total_paid ?? '0', 10);
        const invoiceTotal = parseInt(invoice.total_eur_cents, 10);

        if (totalPaid >= invoiceTotal) {
          await tx`
            UPDATE invoice SET
              status     = 'paid',
              paid_at    = now(),
              updated_at = now(),
              version    = version + 1
            WHERE id = ${id}::uuid
          `;
        }

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'invoice.payment',
             'payment',
             ${payment.id},
             ${JSON.stringify({
               invoice_id: id,
               amount_eur_cents: input.amount_eur_cents,
               payment_method: input.payment_method,
               total_paid: totalPaid,
               invoice_total: invoiceTotal,
               fully_paid: totalPaid >= invoiceTotal,
             })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return payment;
      });

      if (result === null) {
        return errResponse(reply, 404, 'INVOICE_NOT_FOUND', 'Το τιμολόγιο δεν βρέθηκε.');
      }

      return reply.code(201).send({ data: result });
    }
  );

  // ======================================================================
  // GET /api/v1/invoices/:id/pdf
  // Stub — Phase 1.5
  // ======================================================================

  fastify.get(
    '/api/v1/invoices/:id/pdf',
    {},
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(501).send({
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'Η δημιουργία PDF τιμολογίων θα είναι διαθέσιμη στο Phase 1.5 (myDATA integration).',
        },
      });
    }
  );

  // ======================================================================
  // DELETE /api/v1/invoices/:id
  // Soft delete — only draft invoices. Sets status = 'cancelled'.
  // ======================================================================

  fastify.delete(
    '/api/v1/invoices/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const deleted = await withTenantSchema(request, async (tx) => {
        const existing = await tx<{ id: string; status: string }[]>`
          SELECT id, status FROM invoice WHERE id = ${id}::uuid LIMIT 1
        `;
        const invoice = existing[0];
        if (invoice === undefined) return null;

        if (invoice.status !== 'draft') {
          throw Object.assign(
            new Error('Μόνο τιμολόγια σε κατάσταση "draft" μπορούν να διαγραφούν.'),
            { code: 'INVALID_STATUS', statusCode: 409 }
          );
        }

        const rows = await tx<{ id: string }[]>`
          UPDATE invoice SET status = 'cancelled', updated_at = now()
          WHERE id = ${id}::uuid AND status = 'draft'
          RETURNING id
        `;

        if (rows[0] === undefined) return null;

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'invoice.cancel',
             'invoice',
             ${id},
             ${JSON.stringify({ previous_status: 'draft' })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return rows[0];
      });

      if (deleted === null) {
        return errResponse(reply, 404, 'INVOICE_NOT_FOUND', 'Το τιμολόγιο δεν βρέθηκε.');
      }

      return reply.code(204).send();
    }
  );
};

export default fp(invoicesRoutes, { name: 'invoices-routes' });
