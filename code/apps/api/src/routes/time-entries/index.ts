/**
 * Time Entries routes — /api/v1/time-entries/*
 *
 * Billable time tracking for attorneys/paralegals.
 * All monetary values in BIGINT cents (Invariant #3).
 *
 * Endpoints:
 *   POST   /api/v1/time-entries                    — create entry (timer OR completed)
 *   GET    /api/v1/time-entries/active             — active timer for current user
 *   GET    /api/v1/time-entries/reports/by-matter  — aggregation by matter
 *   GET    /api/v1/time-entries                    — list with filters + pagination
 *   GET    /api/v1/time-entries/:id                — detail
 *   PATCH  /api/v1/time-entries/:id               — update (draft only)
 *   POST   /api/v1/time-entries/:id/stop          — stop active timer
 *   DELETE /api/v1/time-entries/:id              — soft delete (draft only)
 *
 * Invariants:
 *   #3  All money BIGINT cents
 *   #6  withTenantSchema wraps every query — NEVER cross-tenant
 *   #4  ALL mutations write to audit_log
 *
 * @module routes/time-entries
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { withTenantSchema } from '../../plugins/fastify-tenant.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_TIME_ENTRY_STATUSES = ['draft', 'posted', 'invoiced', 'written_off'] as const;
type TimeEntryStatus = typeof VALID_TIME_ENTRY_STATUSES[number];

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

const CreateTimeEntrySchema = z.object({
  matter_id: z
    .string({ required_error: 'matter_id είναι υποχρεωτικό.' })
    .uuid('matter_id πρέπει να είναι έγκυρο UUID.'),
  user_id: z
    .string({ required_error: 'user_id είναι υποχρεωτικό.' })
    .uuid('user_id πρέπει να είναι έγκυρο UUID.'),
  started_at: z
    .string({ required_error: 'started_at είναι υποχρεωτικό.' })
    .datetime('started_at: μορφή ISO 8601.'),
  ended_at: z.string().datetime('ended_at: μορφή ISO 8601.').optional(),
  duration_minutes: z
    .number()
    .int()
    .min(0, 'duration_minutes δεν μπορεί να είναι αρνητικό.')
    .optional(),
  description: z.string().max(2000).optional(),
  billable: z.boolean().optional().default(true),
  billable_rate_eur_cents: z
    .number()
    .int()
    .min(0, 'billable_rate_eur_cents δεν μπορεί να είναι αρνητικό.')
    .optional()
    .default(0),
}).refine(
  (data) => {
    // If ended_at provided, duration_minutes must be derivable
    if (data.ended_at !== undefined && data.duration_minutes === undefined) return true; // computed on insert
    return true;
  },
  { message: 'Εάν παρέχεται ended_at, το duration_minutes υπολογίζεται αυτόματα.' }
);

type CreateTimeEntryInput = z.infer<typeof CreateTimeEntrySchema>;

const PatchTimeEntrySchema = z
  .object({
    description: z.string().max(2000).optional(),
    billable: z.boolean().optional(),
    billable_rate_eur_cents: z
      .number()
      .int()
      .min(0, 'billable_rate_eur_cents δεν μπορεί να είναι αρνητικό.')
      .optional(),
    started_at: z.string().datetime('started_at: μορφή ISO 8601.').optional(),
    ended_at: z.string().datetime('ended_at: μορφή ISO 8601.').optional(),
    duration_minutes: z.number().int().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Τουλάχιστον ένα πεδίο απαιτείται για ενημέρωση.',
  });

type PatchTimeEntryInput = z.infer<typeof PatchTimeEntrySchema>;

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface TimeEntryRow {
  id: string;
  matter_id: string;
  user_id: string;
  started_at: Date;
  ended_at: Date | null;
  duration_minutes: number;
  description: string | null;
  billable: boolean;
  billable_rate_eur_cents: number;
  status: string;
  invoice_id: string | null;
  created_at: Date;
}

interface CountRow {
  count: string;
}

interface MatterAggRow {
  matter_id: string;
  total_entries: string;
  total_minutes: string;
  billable_minutes: string;
  billable_amount_cents: string;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const timeEntriesRoutes: FastifyPluginAsync = async (fastify) => {
  // ======================================================================
  // GET /api/v1/time-entries/active
  // Active timer for current user (ended_at IS NULL, status=draft).
  // Registered BEFORE /:id to prevent "active" being matched as UUID.
  // ======================================================================

  fastify.get(
    '/api/v1/time-entries/active',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.firmContext?.userId ?? null;
      if (userId === null) {
        return errResponse(reply, 401, 'AUTH_REQUIRED', 'Απαιτείται αυθεντικοποίηση.');
      }

      const entry = await withTenantSchema(request, async (tx) => {
        const rows = await tx<TimeEntryRow[]>`
          SELECT
            id, matter_id, user_id, started_at, ended_at, duration_minutes,
            description, billable, billable_rate_eur_cents, status, invoice_id, created_at
          FROM time_entry
          WHERE user_id = ${userId}::uuid
            AND ended_at IS NULL
            AND status = 'draft'
          ORDER BY started_at DESC
          LIMIT 1
        `;
        return rows[0] ?? null;
      });

      return reply.code(200).send({ data: entry });
    }
  );

  // ======================================================================
  // GET /api/v1/time-entries/reports/by-matter
  // Aggregate: hours + billable amount per matter.
  // Registered BEFORE /:id to prevent "reports" being matched as UUID.
  // ======================================================================

  fastify.get(
    '/api/v1/time-entries/reports/by-matter',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;

      const fromDate = query['from'] ?? null;
      const toDate = query['to'] ?? null;
      const userId = query['user_id'] ?? null;

      const rows = await withTenantSchema(request, async (tx) => {
        return tx<MatterAggRow[]>`
          SELECT
            matter_id,
            count(*)::text                                               AS total_entries,
            coalesce(sum(duration_minutes), 0)::text                    AS total_minutes,
            coalesce(sum(duration_minutes) FILTER (WHERE billable), 0)::text AS billable_minutes,
            coalesce(
              sum(
                CASE
                  WHEN billable THEN
                    (duration_minutes::bigint * billable_rate_eur_cents / 60)
                  ELSE 0
                END
              ),
              0
            )::text AS billable_amount_cents
          FROM time_entry
          WHERE status != 'written_off'
            AND (${fromDate}::text IS NULL OR started_at >= ${fromDate}::timestamptz)
            AND (${toDate}::text IS NULL OR started_at <= ${toDate}::timestamptz)
            AND (${userId}::text IS NULL OR user_id = ${userId}::uuid)
          GROUP BY matter_id
          ORDER BY billable_minutes DESC
        `;
      });

      return reply.code(200).send({ data: rows, meta: { total: rows.length } });
    }
  );

  // ======================================================================
  // POST /api/v1/time-entries
  // Create entry. If ended_at provided, computes duration_minutes.
  // ======================================================================

  fastify.post(
    '/api/v1/time-entries',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreateTimeEntrySchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: CreateTimeEntryInput = parseResult.data;

      // Compute duration_minutes if ended_at provided
      let durationMinutes = input.duration_minutes ?? 0;
      if (input.ended_at !== undefined) {
        const startMs = new Date(input.started_at).getTime();
        const endMs = new Date(input.ended_at).getTime();
        if (endMs < startMs) {
          return errResponse(reply, 400, 'VALIDATION_ERROR', 'ended_at πρέπει να είναι μετά το started_at.');
        }
        durationMinutes = Math.round((endMs - startMs) / 60000);
      }

      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const entry = await withTenantSchema(request, async (tx) => {
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

        const rows = await tx<TimeEntryRow[]>`
          INSERT INTO time_entry
            (matter_id, user_id, started_at, ended_at, duration_minutes,
             description, billable, billable_rate_eur_cents, status)
          VALUES
            (${input.matter_id}::uuid,
             ${input.user_id}::uuid,
             ${input.started_at}::timestamptz,
             ${input.ended_at ?? null}::timestamptz,
             ${durationMinutes},
             ${input.description ?? null},
             ${input.billable},
             ${input.billable_rate_eur_cents},
             'draft')
          RETURNING
            id, matter_id, user_id, started_at, ended_at, duration_minutes,
            description, billable, billable_rate_eur_cents, status, invoice_id, created_at
        `;

        const inserted = rows[0];
        if (inserted === undefined) {
          throw Object.assign(new Error('INSERT time_entry returned no row'), { code: 'DB_ERROR' });
        }

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'time_entry.create',
             'time_entry',
             ${inserted.id},
             ${JSON.stringify({
               matter_id: input.matter_id,
               user_id: input.user_id,
               billable: input.billable,
               duration_minutes: durationMinutes,
             })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return inserted;
      });

      return reply.code(201).send({ data: entry });
    }
  );

  // ======================================================================
  // GET /api/v1/time-entries
  // List with filters: matter_id, user_id, billable, status, date range
  // ======================================================================

  fastify.get(
    '/api/v1/time-entries',
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

      if (statusFilter !== null && !(VALID_TIME_ENTRY_STATUSES as ReadonlyArray<string>).includes(statusFilter)) {
        return errResponse(
          reply,
          400,
          'INVALID_STATUS',
          `status πρέπει να είναι ένα από: ${VALID_TIME_ENTRY_STATUSES.join(', ')}.`
        );
      }

      const fromDate = query['from'] ?? null;
      const toDate = query['to'] ?? null;

      const rawLimit = parseInt(query['limit'] ?? String(DEFAULT_LIMIT), 10);
      const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
      const rawOffset = parseInt(query['offset'] ?? '0', 10);
      const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

      const typedStatus = (statusFilter as TimeEntryStatus | null);

      const { rows, total } = await withTenantSchema(request, async (tx) => {
        const [countRows, dataRows] = await Promise.all([
          tx<CountRow[]>`
            SELECT count(*)::text AS count
            FROM time_entry
            WHERE (${matterId}::text IS NULL OR matter_id = ${matterId}::uuid)
              AND (${userId}::text IS NULL OR user_id = ${userId}::uuid)
              AND (${billableFilter}::boolean IS NULL OR billable = ${billableFilter}::boolean)
              AND (${typedStatus}::text IS NULL OR status = ${typedStatus}::tenant_template.time_entry_status_t)
              AND (${fromDate}::text IS NULL OR started_at >= ${fromDate}::timestamptz)
              AND (${toDate}::text IS NULL OR started_at <= ${toDate}::timestamptz)
          `,
          tx<TimeEntryRow[]>`
            SELECT
              id, matter_id, user_id, started_at, ended_at, duration_minutes,
              description, billable, billable_rate_eur_cents, status, invoice_id, created_at
            FROM time_entry
            WHERE (${matterId}::text IS NULL OR matter_id = ${matterId}::uuid)
              AND (${userId}::text IS NULL OR user_id = ${userId}::uuid)
              AND (${billableFilter}::boolean IS NULL OR billable = ${billableFilter}::boolean)
              AND (${typedStatus}::text IS NULL OR status = ${typedStatus}::tenant_template.time_entry_status_t)
              AND (${fromDate}::text IS NULL OR started_at >= ${fromDate}::timestamptz)
              AND (${toDate}::text IS NULL OR started_at <= ${toDate}::timestamptz)
            ORDER BY started_at DESC
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
  // GET /api/v1/time-entries/:id
  // ======================================================================

  fastify.get(
    '/api/v1/time-entries/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const entry = await withTenantSchema(request, async (tx) => {
        const rows = await tx<TimeEntryRow[]>`
          SELECT
            id, matter_id, user_id, started_at, ended_at, duration_minutes,
            description, billable, billable_rate_eur_cents, status, invoice_id, created_at
          FROM time_entry
          WHERE id = ${id}::uuid
          LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (entry === null) {
        return errResponse(reply, 404, 'TIME_ENTRY_NOT_FOUND', 'Η χρονική εγγραφή δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: entry });
    }
  );

  // ======================================================================
  // PATCH /api/v1/time-entries/:id
  // Update — only if status = 'draft'
  // ======================================================================

  fastify.patch(
    '/api/v1/time-entries/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parseResult = PatchTimeEntrySchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: PatchTimeEntryInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const updated = await withTenantSchema(request, async (tx) => {
        const existing = await tx<TimeEntryRow[]>`
          SELECT id, status, started_at, ended_at, duration_minutes
          FROM time_entry
          WHERE id = ${id}::uuid
          LIMIT 1
        `;
        const entry = existing[0];
        if (entry === undefined) return null;

        if (entry.status !== 'draft') {
          throw Object.assign(
            new Error('Μόνο εγγραφές σε κατάσταση "draft" μπορούν να τροποποιηθούν.'),
            { code: 'INVALID_STATUS', statusCode: 409 }
          );
        }

        // Recompute duration if started_at or ended_at changed
        let newDuration: number | null = input.duration_minutes ?? null;
        const effectiveStarted = input.started_at ?? entry.started_at.toISOString();
        const effectiveEnded = input.ended_at ?? entry.ended_at?.toISOString() ?? null;

        if (effectiveEnded !== null && newDuration === null) {
          const startMs = new Date(effectiveStarted).getTime();
          const endMs = new Date(effectiveEnded).getTime();
          if (endMs >= startMs) {
            newDuration = Math.round((endMs - startMs) / 60000);
          }
        }

        const rows = await tx<TimeEntryRow[]>`
          UPDATE time_entry SET
            description            = COALESCE(${input.description ?? null}, description),
            billable               = COALESCE(${input.billable ?? null}, billable),
            billable_rate_eur_cents = COALESCE(${input.billable_rate_eur_cents ?? null}, billable_rate_eur_cents),
            started_at             = COALESCE(${input.started_at ?? null}::timestamptz, started_at),
            ended_at               = COALESCE(${input.ended_at ?? null}::timestamptz, ended_at),
            duration_minutes       = COALESCE(${newDuration}, duration_minutes)
          WHERE id = ${id}::uuid AND status = 'draft'
          RETURNING
            id, matter_id, user_id, started_at, ended_at, duration_minutes,
            description, billable, billable_rate_eur_cents, status, invoice_id, created_at
        `;

        const row = rows[0];
        if (row === undefined) return null;

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'time_entry.update',
             'time_entry',
             ${id},
             ${JSON.stringify({ updated_fields: Object.keys(input) })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return row;
      });

      if (updated === null) {
        return errResponse(reply, 404, 'TIME_ENTRY_NOT_FOUND', 'Η χρονική εγγραφή δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: updated });
    }
  );

  // ======================================================================
  // POST /api/v1/time-entries/:id/stop
  // Stop active timer: sets ended_at = now(), computes duration_minutes.
  // ======================================================================

  fastify.post(
    '/api/v1/time-entries/:id/stop',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const stopped = await withTenantSchema(request, async (tx) => {
        const existing = await tx<TimeEntryRow[]>`
          SELECT id, status, started_at, ended_at
          FROM time_entry
          WHERE id = ${id}::uuid
          LIMIT 1
        `;
        const entry = existing[0];
        if (entry === undefined) return null;

        if (entry.ended_at !== null) {
          throw Object.assign(
            new Error('Ο χρονομετρητής έχει ήδη σταματήσει.'),
            { code: 'TIMER_ALREADY_STOPPED', statusCode: 409 }
          );
        }

        if (entry.status !== 'draft') {
          throw Object.assign(
            new Error('Μόνο εγγραφές σε κατάσταση "draft" μπορούν να σταματήσουν.'),
            { code: 'INVALID_STATUS', statusCode: 409 }
          );
        }

        const nowMs = Date.now();
        const startMs = entry.started_at.getTime();
        const durationMinutes = Math.max(0, Math.round((nowMs - startMs) / 60000));

        const rows = await tx<TimeEntryRow[]>`
          UPDATE time_entry SET
            ended_at         = now(),
            duration_minutes = ${durationMinutes}
          WHERE id = ${id}::uuid AND ended_at IS NULL AND status = 'draft'
          RETURNING
            id, matter_id, user_id, started_at, ended_at, duration_minutes,
            description, billable, billable_rate_eur_cents, status, invoice_id, created_at
        `;

        const row = rows[0];
        if (row === undefined) return null;

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'time_entry.stop',
             'time_entry',
             ${id},
             ${JSON.stringify({ duration_minutes: durationMinutes })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return row;
      });

      if (stopped === null) {
        return errResponse(reply, 404, 'TIME_ENTRY_NOT_FOUND', 'Η χρονική εγγραφή δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: stopped });
    }
  );

  // ======================================================================
  // DELETE /api/v1/time-entries/:id
  // Soft delete — only if status = 'draft'.
  // Note: time_entry has no soft_deleted_at column; we set status = 'written_off'
  // as the schema's equivalent of soft-delete for draft entries.
  // ======================================================================

  fastify.delete(
    '/api/v1/time-entries/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const deleted = await withTenantSchema(request, async (tx) => {
        const existing = await tx<{ id: string; status: string }[]>`
          SELECT id, status FROM time_entry WHERE id = ${id}::uuid LIMIT 1
        `;
        const entry = existing[0];
        if (entry === undefined) return null;

        if (entry.status !== 'draft') {
          throw Object.assign(
            new Error('Μόνο εγγραφές σε κατάσταση "draft" μπορούν να διαγραφούν.'),
            { code: 'INVALID_STATUS', statusCode: 409 }
          );
        }

        const rows = await tx<{ id: string }[]>`
          UPDATE time_entry SET status = 'written_off'
          WHERE id = ${id}::uuid AND status = 'draft'
          RETURNING id
        `;

        if (rows[0] === undefined) return null;

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'time_entry.delete',
             'time_entry',
             ${id},
             ${JSON.stringify({ previous_status: 'draft' })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return rows[0];
      });

      if (deleted === null) {
        return errResponse(reply, 404, 'TIME_ENTRY_NOT_FOUND', 'Η χρονική εγγραφή δεν βρέθηκε.');
      }

      return reply.code(204).send();
    }
  );
};

export default fp(timeEntriesRoutes, { name: 'time-entries-routes' });
