/**
 * Calendar routes — /api/v1/calendar/*
 *
 * Implements deadline rules engine + calendar event CRUD.
 *
 * Endpoints:
 *   POST   /api/v1/calendar/calculate-deadline  — pure calculation (no DB, no tenant required)
 *   GET    /api/v1/calendar/rules               — list all 30 rules (no tenant required, cached)
 *   GET    /api/v1/calendar/rules/:rule_id      — rule detail (no tenant required)
 *   POST   /api/v1/calendar/events              — create event (tenant required)
 *   GET    /api/v1/calendar/events              — list with filters + pagination (tenant required)
 *   PATCH  /api/v1/calendar/events/:id          — partial update (tenant required)
 *   DELETE /api/v1/calendar/events/:id          — soft delete (tenant required)
 *
 * Invariants:
 *   #6  withTenantSchema wraps all DB queries — NEVER cross-tenant
 *   #2  ALL mutations write to audit_log (append-only, INSERT only)
 *   calculate-deadline + rules endpoints: no tenant context needed (no firm data)
 *
 * @module routes/calendar
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { withTenantSchema } from '../../plugins/fastify-tenant.js';
import { calculateDeadline, getAllRules, getRuleById } from '@themisos/rules-engine';
import {
  CalculateDeadlineSchema,
  CreateCalendarEventSchema,
  PatchCalendarEventSchema,
  type CreateCalendarEventInput,
  type PatchCalendarEventInput,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Error helper — matches matters/parties pattern exactly
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
// DB row types
// ---------------------------------------------------------------------------

interface CalendarEventRow {
  id: string;
  matter_id: string;
  party_id: string | null;
  event_type: string;
  title_gr: string | null;
  description_gr: string | null;
  occurs_at: Date | null;
  all_day: boolean;
  location: string | null;
  deadline_rule_id: string | null;
  source_event_id: string | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  soft_deleted_at: Date | null;
  // original columns from 0002
  title: string;
  starts_at: Date;
  ends_at: Date | null;
  attendee_user_ids: string[];
  related_party_ids: string[];
  description: string | null;
}

interface CountRow {
  count: string;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const calendarRoutes: FastifyPluginAsync = async (fastify) => {
  // ======================================================================
  // POST /api/v1/calendar/calculate-deadline
  // Pure computation — no DB, no tenant context required.
  // ======================================================================

  fastify.post(
    '/api/v1/calendar/calculate-deadline',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CalculateDeadlineSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input = parseResult.data;

      let result;
      try {
        result = calculateDeadline({
          rule_id: input.rule_id,
          trigger_date: new Date(input.trigger_date),
          party_residency: input.party_residency,
          custom_extension_days: input.custom_extension_days,
        });
      } catch (err: unknown) {
        if (isStructuredError(err)) {
          return errResponse(reply, err.statusCode, err.code, err.message);
        }
        throw err;
      }

      return reply.code(200).send({ data: result });
    }
  );

  // ======================================================================
  // GET /api/v1/calendar/rules
  // List all 30 rules — cached in-process, no tenant context required.
  // ======================================================================

  fastify.get(
    '/api/v1/calendar/rules',
    {},
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const rules = getAllRules();
      return reply.code(200).send({
        data: rules,
        meta: { total: rules.length },
      });
    }
  );

  // ======================================================================
  // GET /api/v1/calendar/rules/:rule_id
  // Rule detail με edge_cases — no tenant context required.
  // ======================================================================

  fastify.get(
    '/api/v1/calendar/rules/:rule_id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { rule_id } = request.params as { rule_id: string };

      let rule;
      try {
        rule = getRuleById(rule_id);
      } catch (err: unknown) {
        if (isStructuredError(err)) {
          return errResponse(reply, err.statusCode, err.code, err.message);
        }
        throw err;
      }

      return reply.code(200).send({ data: rule });
    }
  );

  // ======================================================================
  // POST /api/v1/calendar/events
  // Create event. If deadline_rule_id set → auto-calculate occurs_at.
  // Writes audit_log (Invariant #2).
  // ======================================================================

  fastify.post(
    '/api/v1/calendar/events',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreateCalendarEventSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: CreateCalendarEventInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      // Auto-calculate occurs_at if deadline_rule_id is provided
      let calculatedOccursAt: Date | null = null;
      let deadlineWarnings: string[] = [];

      if (input.deadline_rule_id !== undefined) {
        if (input.deadline_trigger_date === undefined) {
          return errResponse(
            reply,
            400,
            'VALIDATION_ERROR',
            'deadline_trigger_date είναι υποχρεωτικό όταν ορίζεται deadline_rule_id.'
          );
        }

        let deadlineResult;
        try {
          deadlineResult = calculateDeadline({
            rule_id: input.deadline_rule_id,
            trigger_date: new Date(input.deadline_trigger_date),
            party_residency: input.deadline_party_residency,
          });
        } catch (err: unknown) {
          if (isStructuredError(err)) {
            return errResponse(reply, err.statusCode, err.code, err.message);
          }
          throw err;
        }

        calculatedOccursAt = deadlineResult.deadline_date;
        deadlineWarnings = deadlineResult.warnings_gr;
      } else if (input.occurs_at !== undefined) {
        calculatedOccursAt = new Date(input.occurs_at);
      }

      const event = await withTenantSchema(request, async (tx) => {
        // Verify matter exists
        const matterCheck = await tx<{ id: string }[]>`
          SELECT id FROM matter
          WHERE id = ${input.matter_id}::uuid AND deleted_at IS NULL
          LIMIT 1
        `;

        if (matterCheck[0] === undefined) {
          throw Object.assign(
            new Error('Ο φάκελος υπόθεσης δεν βρέθηκε.'),
            { code: 'MATTER_NOT_FOUND', statusCode: 404 }
          );
        }

        // Verify party if provided
        if (input.party_id !== undefined) {
          const partyCheck = await tx<{ id: string }[]>`
            SELECT id FROM party
            WHERE id = ${input.party_id}::uuid AND soft_deleted_at IS NULL
            LIMIT 1
          `;
          if (partyCheck[0] === undefined) {
            throw Object.assign(
              new Error('Το μέρος (party) δεν βρέθηκε.'),
              { code: 'PARTY_NOT_FOUND', statusCode: 404 }
            );
          }
        }

        const occursAtValue = calculatedOccursAt;
        const startsAtValue = calculatedOccursAt ?? new Date();

        const rows = await tx<CalendarEventRow[]>`
          INSERT INTO calendar_event (
            matter_id,
            party_id,
            event_type,
            title,
            title_gr,
            description_gr,
            occurs_at,
            starts_at,
            all_day,
            location,
            deadline_rule_id,
            source_event_id,
            created_by_user_id
          ) VALUES (
            ${input.matter_id}::uuid,
            ${input.party_id ?? null}::uuid,
            ${input.event_type}::tenant_template.calendar_event_type_t,
            ${input.title_gr},
            ${input.title_gr},
            ${input.description_gr ?? null},
            ${occursAtValue ?? null},
            ${startsAtValue},
            ${input.all_day},
            ${input.location ?? null},
            ${input.deadline_rule_id ?? null},
            ${input.source_event_id ?? null}::uuid,
            ${actorUserId}::uuid
          )
          RETURNING
            id, matter_id, party_id, event_type, title, title_gr, description_gr,
            occurs_at, starts_at, ends_at, all_day, location,
            deadline_rule_id, source_event_id, created_by_user_id,
            created_at, updated_at, soft_deleted_at,
            attendee_user_ids, related_party_ids, description
        `;

        const inserted = rows[0];
        if (inserted === undefined) {
          throw Object.assign(new Error('INSERT calendar_event returned no row'), { code: 'DB_ERROR' });
        }

        // Audit (Invariant #2)
        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES (
            ${actorUserId}::uuid,
            'calendar_event.create',
            'calendar_event',
            ${inserted.id},
            ${JSON.stringify({
              matter_id: input.matter_id,
              event_type: input.event_type,
              deadline_rule_id: input.deadline_rule_id ?? null,
              occurs_at: calculatedOccursAt?.toISOString() ?? null,
            })}::jsonb,
            ${request.ip}::inet,
            ${userAgent},
            'success'
          )
        `;

        return inserted;
      }).catch((err: unknown) => {
        if (isStructuredError(err)) throw err;
        throw err;
      });

      return reply.code(201).send({
        data: event,
        meta: {
          deadline_warnings: deadlineWarnings,
        },
      });
    }
  );

  // ======================================================================
  // GET /api/v1/calendar/events
  // List με filters: matter_id (required), from/to, event_type, party_id.
  // Response envelope: { data, meta: { total, page, per_page } }
  // ======================================================================

  fastify.get(
    '/api/v1/calendar/events',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;

      const matterId = query['matter_id'] ?? null;
      if (matterId === null) {
        return errResponse(reply, 400, 'VALIDATION_ERROR', 'matter_id filter είναι υποχρεωτικό.');
      }

      const rawLimit = parseInt(query['limit'] ?? String(DEFAULT_LIMIT), 10);
      const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);

      const rawOffset = parseInt(query['offset'] ?? '0', 10);
      const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

      const fromFilter = query['from'] ?? null;
      const toFilter = query['to'] ?? null;
      const eventTypeFilter = query['event_type'] ?? null;
      const partyIdFilter = query['party_id'] ?? null;

      const { rows, total } = await withTenantSchema(request, async (tx) => {
        const [countRows, dataRows] = await Promise.all([
          tx<CountRow[]>`
            SELECT count(*)::text AS count
            FROM calendar_event
            WHERE soft_deleted_at IS NULL
              AND matter_id = ${matterId}::uuid
              AND (
                ${fromFilter}::text IS NULL
                OR COALESCE(occurs_at, starts_at) >= ${fromFilter}::timestamptz
              )
              AND (
                ${toFilter}::text IS NULL
                OR COALESCE(occurs_at, starts_at) <= ${toFilter}::timestamptz
              )
              AND (
                ${eventTypeFilter}::text IS NULL
                OR event_type = ${eventTypeFilter}::tenant_template.calendar_event_type_t
              )
              AND (
                ${partyIdFilter}::text IS NULL
                OR party_id = ${partyIdFilter}::uuid
              )
          `,
          tx<CalendarEventRow[]>`
            SELECT
              id, matter_id, party_id, event_type, title, title_gr, description_gr,
              occurs_at, starts_at, ends_at, all_day, location,
              deadline_rule_id, source_event_id, created_by_user_id,
              created_at, updated_at, soft_deleted_at,
              attendee_user_ids, related_party_ids, description
            FROM calendar_event
            WHERE soft_deleted_at IS NULL
              AND matter_id = ${matterId}::uuid
              AND (
                ${fromFilter}::text IS NULL
                OR COALESCE(occurs_at, starts_at) >= ${fromFilter}::timestamptz
              )
              AND (
                ${toFilter}::text IS NULL
                OR COALESCE(occurs_at, starts_at) <= ${toFilter}::timestamptz
              )
              AND (
                ${eventTypeFilter}::text IS NULL
                OR event_type = ${eventTypeFilter}::tenant_template.calendar_event_type_t
              )
              AND (
                ${partyIdFilter}::text IS NULL
                OR party_id = ${partyIdFilter}::uuid
              )
            ORDER BY COALESCE(occurs_at, starts_at) ASC
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
  // PATCH /api/v1/calendar/events/:id
  // Partial update. Manual override allowed με recalculate_deadline=true.
  // Writes audit_log (Invariant #2).
  // ======================================================================

  fastify.patch(
    '/api/v1/calendar/events/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parseResult = PatchCalendarEventSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: PatchCalendarEventInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      // Optional recalculation on PATCH
      let newOccursAt: Date | null | undefined;
      let deadlineWarnings: string[] = [];

      if (input.recalculate_deadline === true && input.deadline_trigger_date !== undefined) {
        const existing = await withTenantSchema(request, async (tx) => {
          const rows = await tx<{ deadline_rule_id: string | null }[]>`
            SELECT deadline_rule_id
            FROM calendar_event
            WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
            LIMIT 1
          `;
          return rows[0] ?? null;
        });

        if (existing?.deadline_rule_id !== undefined && existing.deadline_rule_id !== null) {
          let deadlineResult;
          try {
            deadlineResult = calculateDeadline({
              rule_id: existing.deadline_rule_id,
              trigger_date: new Date(input.deadline_trigger_date),
              party_residency: input.deadline_party_residency,
            });
          } catch (err: unknown) {
            if (isStructuredError(err)) {
              return errResponse(reply, err.statusCode, err.code, err.message);
            }
            throw err;
          }
          newOccursAt = deadlineResult.deadline_date;
          deadlineWarnings = deadlineResult.warnings_gr;
        }
      } else if (input.occurs_at !== undefined) {
        newOccursAt = new Date(input.occurs_at);
      }

      const updated = await withTenantSchema(request, async (tx) => {
        // Verify event exists
        const existing = await tx<{ id: string; soft_deleted_at: Date | null }[]>`
          SELECT id, soft_deleted_at
          FROM calendar_event
          WHERE id = ${id}::uuid
          LIMIT 1
        `;

        const ev = existing[0];
        if (ev === undefined || ev.soft_deleted_at !== null) return null;

        const occursAtFinal = newOccursAt ?? null;

        const rows = await tx<CalendarEventRow[]>`
          UPDATE calendar_event SET
            event_type      = COALESCE(
                                ${input.event_type ?? null}::tenant_template.calendar_event_type_t,
                                event_type
                              ),
            title           = COALESCE(${input.title_gr ?? null}, title),
            title_gr        = COALESCE(${input.title_gr ?? null}, title_gr),
            description_gr  = COALESCE(${input.description_gr ?? null}, description_gr),
            occurs_at       = CASE WHEN ${occursAtFinal !== undefined}
                                THEN ${occursAtFinal ?? null}::timestamptz
                                ELSE occurs_at
                              END,
            starts_at       = CASE WHEN ${occursAtFinal !== undefined}
                                THEN COALESCE(${occursAtFinal ?? null}::timestamptz, starts_at)
                                ELSE starts_at
                              END,
            all_day         = COALESCE(${input.all_day ?? null}, all_day),
            location        = COALESCE(${input.location ?? null}, location),
            updated_at      = now()
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          RETURNING
            id, matter_id, party_id, event_type, title, title_gr, description_gr,
            occurs_at, starts_at, ends_at, all_day, location,
            deadline_rule_id, source_event_id, created_by_user_id,
            created_at, updated_at, soft_deleted_at,
            attendee_user_ids, related_party_ids, description
        `;

        const row = rows[0];
        if (row === undefined) return null;

        // Audit (Invariant #2)
        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES (
            ${actorUserId}::uuid,
            'calendar_event.update',
            'calendar_event',
            ${id},
            ${JSON.stringify({
              updated_fields: Object.keys(input),
              recalculated: input.recalculate_deadline === true,
            })}::jsonb,
            ${request.ip}::inet,
            ${userAgent},
            'success'
          )
        `;

        return row;
      });

      if (updated === null) {
        return errResponse(reply, 404, 'CALENDAR_EVENT_NOT_FOUND', 'Η καταχώριση ημερολογίου δεν βρέθηκε.');
      }

      return reply.code(200).send({
        data: updated,
        meta: { deadline_warnings: deadlineWarnings },
      });
    }
  );

  // ======================================================================
  // DELETE /api/v1/calendar/events/:id
  // Soft delete: set soft_deleted_at = now().
  // Writes audit_log (Invariant #2).
  // ======================================================================

  fastify.delete(
    '/api/v1/calendar/events/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const removed = await withTenantSchema(request, async (tx) => {
        const rows = await tx<CalendarEventRow[]>`
          UPDATE calendar_event
          SET soft_deleted_at = now(), updated_at = now()
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          RETURNING
            id, matter_id, party_id, event_type, title, title_gr,
            occurs_at, starts_at, deadline_rule_id, created_at, updated_at, soft_deleted_at
        `;

        const row = rows[0];
        if (row === undefined) return null;

        // Audit (Invariant #2)
        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES (
            ${actorUserId}::uuid,
            'calendar_event.delete',
            'calendar_event',
            ${id},
            ${JSON.stringify({ matter_id: row.matter_id, event_type: row.event_type })}::jsonb,
            ${request.ip}::inet,
            ${userAgent},
            'success'
          )
        `;

        return row;
      });

      if (removed === null) {
        return errResponse(reply, 404, 'CALENDAR_EVENT_NOT_FOUND', 'Η καταχώριση ημερολογίου δεν βρέθηκε ή έχει ήδη διαγραφεί.');
      }

      return reply.code(200).send({ data: removed });
    }
  );
};

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

interface StructuredError {
  code: string;
  statusCode: number;
  message: string;
}

function isStructuredError(err: unknown): err is StructuredError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as Record<string, unknown>)['statusCode'] === 'number' &&
    'code' in err &&
    'message' in err
  );
}

export default fp(calendarRoutes, { name: 'calendar-routes' });
