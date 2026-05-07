/**
 * Expenses routes — /api/v1/expenses/*
 *
 * Disbursements and costs per matter.
 * All monetary values in BIGINT cents (Invariant #3).
 *
 * Endpoints:
 *   POST   /api/v1/expenses         — create
 *   GET    /api/v1/expenses         — list with filters + pagination
 *   GET    /api/v1/expenses/:id     — detail
 *   PATCH  /api/v1/expenses/:id     — update
 *   DELETE /api/v1/expenses/:id     — soft delete (draft only → status=invoiced as guard)
 *
 * Invariants:
 *   #3  All money BIGINT cents
 *   #6  withTenantSchema wraps every query
 *   #4  ALL mutations write to audit_log
 *
 * @module routes/expenses
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { withTenantSchema } from '../../plugins/fastify-tenant.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_EXPENSE_TYPES = [
  'court_fee', 'expert_fee', 'translation', 'travel', 'courier', 'other',
] as const;

const VALID_EXPENSE_STATUSES = ['draft', 'posted', 'invoiced'] as const;
type ExpenseStatus = typeof VALID_EXPENSE_STATUSES[number];

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

const CreateExpenseSchema = z.object({
  matter_id: z
    .string({ required_error: 'matter_id είναι υποχρεωτικό.' })
    .uuid('matter_id πρέπει να είναι έγκυρο UUID.'),
  user_id: z
    .string({ required_error: 'user_id είναι υποχρεωτικό.' })
    .uuid('user_id πρέπει να είναι έγκυρο UUID.'),
  amount_eur_cents: z
    .number({ required_error: 'amount_eur_cents είναι υποχρεωτικό.' })
    .int('amount_eur_cents πρέπει να είναι ακέραιος (cents).')
    .min(0, 'amount_eur_cents δεν μπορεί να είναι αρνητικό.'),
  description: z
    .string({ required_error: 'description είναι υποχρεωτικό.' })
    .min(1, 'description δεν μπορεί να είναι κενό.')
    .max(1000),
  expense_type: z.enum(VALID_EXPENSE_TYPES, {
    errorMap: () => ({
      message: `expense_type πρέπει να είναι ένα από: ${VALID_EXPENSE_TYPES.join(', ')}.`,
    }),
  }),
  expense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expense_date: μορφή YYYY-MM-DD.')
    .optional(),
  vat_pct: z.number().int().min(0).max(100).optional().default(24),
  billable: z.boolean().optional().default(true),
  reimbursable: z.boolean().optional().default(false),
  receipt_document_id: z.string().uuid().optional(),
});

type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;

const PatchExpenseSchema = z
  .object({
    amount_eur_cents: z.number().int().min(0).optional(),
    description: z.string().min(1).max(1000).optional(),
    expense_type: z.enum(VALID_EXPENSE_TYPES, {
      errorMap: () => ({
        message: `expense_type πρέπει να είναι ένα από: ${VALID_EXPENSE_TYPES.join(', ')}.`,
      }),
    }).optional(),
    expense_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'expense_date: μορφή YYYY-MM-DD.')
      .optional(),
    vat_pct: z.number().int().min(0).max(100).optional(),
    billable: z.boolean().optional(),
    reimbursable: z.boolean().optional(),
    receipt_document_id: z.string().uuid().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Τουλάχιστον ένα πεδίο απαιτείται για ενημέρωση.',
  });

type PatchExpenseInput = z.infer<typeof PatchExpenseSchema>;

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ExpenseRow {
  id: string;
  matter_id: string;
  user_id: string;
  expense_date: string;
  amount_eur_cents: string;
  description: string;
  expense_type: string;
  vat_pct: number;
  billable: boolean;
  reimbursable: boolean;
  status: string;
  invoice_id: string | null;
  receipt_document_id: string | null;
  created_at: Date;
}

interface CountRow {
  count: string;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const expensesRoutes: FastifyPluginAsync = async (fastify) => {
  // ======================================================================
  // POST /api/v1/expenses
  // ======================================================================

  fastify.post(
    '/api/v1/expenses',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreateExpenseSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: CreateExpenseInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const expense = await withTenantSchema(request, async (tx) => {
        // Verify matter exists
        const matterCheck = await tx<{ id: string }[]>`
          SELECT id FROM matter WHERE id = ${input.matter_id}::uuid AND deleted_at IS NULL LIMIT 1
        `;
        if (matterCheck[0] === undefined) {
          throw Object.assign(
            new Error('Η υπόθεση δεν βρέθηκε.'),
            { code: 'MATTER_NOT_FOUND', statusCode: 404 }
          );
        }

        const rows = await tx<ExpenseRow[]>`
          INSERT INTO expense
            (matter_id, user_id, expense_date, amount_eur_cents, description,
             expense_type, vat_pct, billable, reimbursable, receipt_document_id, status)
          VALUES
            (${input.matter_id}::uuid,
             ${input.user_id}::uuid,
             ${input.expense_date ?? null}::date,
             ${input.amount_eur_cents},
             ${input.description},
             ${input.expense_type}::tenant_template.expense_type_t,
             ${input.vat_pct},
             ${input.billable},
             ${input.reimbursable},
             ${input.receipt_document_id ?? null}::uuid,
             'draft')
          RETURNING
            id, matter_id, user_id, expense_date, amount_eur_cents, description,
            expense_type, vat_pct, billable, reimbursable, status, invoice_id,
            receipt_document_id, created_at
        `;

        const inserted = rows[0];
        if (inserted === undefined) {
          throw Object.assign(new Error('INSERT expense returned no row'), { code: 'DB_ERROR' });
        }

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'expense.create',
             'expense',
             ${inserted.id},
             ${JSON.stringify({
               matter_id: input.matter_id,
               amount_eur_cents: input.amount_eur_cents,
               expense_type: input.expense_type,
             })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return inserted;
      });

      return reply.code(201).send({ data: expense });
    }
  );

  // ======================================================================
  // GET /api/v1/expenses
  // ======================================================================

  fastify.get(
    '/api/v1/expenses',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;

      const matterId = query['matter_id'] ?? null;
      const userId = query['user_id'] ?? null;
      const billableStr = query['billable'];
      const billableFilter: boolean | null =
        billableStr === 'true' ? true
        : billableStr === 'false' ? false
        : null;
      const statusFilter = query['status'] ?? null;

      if (statusFilter !== null && !(VALID_EXPENSE_STATUSES as ReadonlyArray<string>).includes(statusFilter)) {
        return errResponse(
          reply,
          400,
          'INVALID_STATUS',
          `status πρέπει να είναι ένα από: ${VALID_EXPENSE_STATUSES.join(', ')}.`
        );
      }

      const rawLimit = parseInt(query['limit'] ?? String(DEFAULT_LIMIT), 10);
      const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
      const rawOffset = parseInt(query['offset'] ?? '0', 10);
      const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

      const typedStatus = (statusFilter as ExpenseStatus | null);

      const { rows, total } = await withTenantSchema(request, async (tx) => {
        const [countRows, dataRows] = await Promise.all([
          tx<CountRow[]>`
            SELECT count(*)::text AS count
            FROM expense
            WHERE (${matterId}::text IS NULL OR matter_id = ${matterId}::uuid)
              AND (${userId}::text IS NULL OR user_id = ${userId}::uuid)
              AND (${billableFilter}::boolean IS NULL OR billable = ${billableFilter}::boolean)
              AND (${typedStatus}::text IS NULL OR status = ${typedStatus}::tenant_template.expense_status_t)
          `,
          tx<ExpenseRow[]>`
            SELECT
              id, matter_id, user_id, expense_date, amount_eur_cents, description,
              expense_type, vat_pct, billable, reimbursable, status, invoice_id,
              receipt_document_id, created_at
            FROM expense
            WHERE (${matterId}::text IS NULL OR matter_id = ${matterId}::uuid)
              AND (${userId}::text IS NULL OR user_id = ${userId}::uuid)
              AND (${billableFilter}::boolean IS NULL OR billable = ${billableFilter}::boolean)
              AND (${typedStatus}::text IS NULL OR status = ${typedStatus}::tenant_template.expense_status_t)
            ORDER BY expense_date DESC, created_at DESC
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
  // GET /api/v1/expenses/:id
  // ======================================================================

  fastify.get(
    '/api/v1/expenses/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const expense = await withTenantSchema(request, async (tx) => {
        const rows = await tx<ExpenseRow[]>`
          SELECT
            id, matter_id, user_id, expense_date, amount_eur_cents, description,
            expense_type, vat_pct, billable, reimbursable, status, invoice_id,
            receipt_document_id, created_at
          FROM expense
          WHERE id = ${id}::uuid
          LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (expense === null) {
        return errResponse(reply, 404, 'EXPENSE_NOT_FOUND', 'Η δαπάνη δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: expense });
    }
  );

  // ======================================================================
  // PATCH /api/v1/expenses/:id
  // ======================================================================

  fastify.patch(
    '/api/v1/expenses/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parseResult = PatchExpenseSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: PatchExpenseInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const updated = await withTenantSchema(request, async (tx) => {
        const existing = await tx<{ id: string; status: string }[]>`
          SELECT id, status FROM expense WHERE id = ${id}::uuid LIMIT 1
        `;
        if (existing[0] === undefined) return null;

        const rows = await tx<ExpenseRow[]>`
          UPDATE expense SET
            amount_eur_cents      = COALESCE(${input.amount_eur_cents ?? null}, amount_eur_cents),
            description           = COALESCE(${input.description ?? null}, description),
            expense_type          = COALESCE(${input.expense_type ?? null}::tenant_template.expense_type_t, expense_type),
            expense_date          = COALESCE(${input.expense_date ?? null}::date, expense_date),
            vat_pct               = COALESCE(${input.vat_pct ?? null}, vat_pct),
            billable              = COALESCE(${input.billable ?? null}, billable),
            reimbursable          = COALESCE(${input.reimbursable ?? null}, reimbursable),
            receipt_document_id   = COALESCE(${input.receipt_document_id ?? null}::uuid, receipt_document_id)
          WHERE id = ${id}::uuid
          RETURNING
            id, matter_id, user_id, expense_date, amount_eur_cents, description,
            expense_type, vat_pct, billable, reimbursable, status, invoice_id,
            receipt_document_id, created_at
        `;

        const row = rows[0];
        if (row === undefined) return null;

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'expense.update',
             'expense',
             ${id},
             ${JSON.stringify({ updated_fields: Object.keys(input) })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return row;
      });

      if (updated === null) {
        return errResponse(reply, 404, 'EXPENSE_NOT_FOUND', 'Η δαπάνη δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: updated });
    }
  );

  // ======================================================================
  // DELETE /api/v1/expenses/:id
  // Soft delete — only draft expenses (no soft_deleted_at in schema,
  // guarded by status check; draft expenses deleted via status='invoiced'
  // would be wrong — instead we block deletion of non-draft entries).
  // Since expense has no soft_deleted_at column, we DELETE the row
  // only when status='draft'. Non-draft entries are protected.
  // ======================================================================

  fastify.delete(
    '/api/v1/expenses/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const deleted = await withTenantSchema(request, async (tx) => {
        const existing = await tx<{ id: string; status: string }[]>`
          SELECT id, status FROM expense WHERE id = ${id}::uuid LIMIT 1
        `;
        const entry = existing[0];
        if (entry === undefined) return null;

        if (entry.status !== 'draft') {
          throw Object.assign(
            new Error('Μόνο δαπάνες σε κατάσταση "draft" μπορούν να διαγραφούν.'),
            { code: 'INVALID_STATUS', statusCode: 409 }
          );
        }

        const rows = await tx<{ id: string }[]>`
          DELETE FROM expense WHERE id = ${id}::uuid AND status = 'draft'
          RETURNING id
        `;

        if (rows[0] === undefined) return null;

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'expense.delete',
             'expense',
             ${id},
             ${JSON.stringify({ previous_status: 'draft' })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return rows[0];
      });

      if (deleted === null) {
        return errResponse(reply, 404, 'EXPENSE_NOT_FOUND', 'Η δαπάνη δεν βρέθηκε.');
      }

      return reply.code(204).send();
    }
  );
};

export default fp(expensesRoutes, { name: 'expenses-routes' });
