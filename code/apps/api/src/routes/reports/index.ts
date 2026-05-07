/**
 * Reports routes — /api/v1/reports/*
 *
 * Billing and productivity aggregations.
 * All monetary values in BIGINT cents (Invariant #3).
 *
 * Endpoints:
 *   GET /api/v1/reports/billing-summary     — total invoiced, paid, outstanding
 *   GET /api/v1/reports/time-by-user        — productivity per user
 *   GET /api/v1/reports/realization-rate    — billed_amount / time_value per matter
 *
 * Invariants:
 *   #6  withTenantSchema wraps every query — NEVER cross-tenant
 *   Read-only endpoints — no audit_log writes required.
 *
 * @module routes/reports
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { withTenantSchema } from '../../plugins/fastify-tenant.js';

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
// DB row types
// ---------------------------------------------------------------------------

interface BillingSummaryRow {
  total_invoiced_cents: string;
  total_paid_cents: string;
  total_outstanding_cents: string;
  draft_count: string;
  issued_count: string;
  paid_count: string;
  overdue_count: string;
}

interface TimeByUserRow {
  user_id: string;
  total_entries: string;
  total_minutes: string;
  billable_minutes: string;
  non_billable_minutes: string;
  billable_amount_cents: string;
}

interface RealizationRateRow {
  matter_id: string;
  total_time_value_cents: string;
  total_billed_cents: string;
  realization_rate_pct: string;
  total_minutes: string;
  billable_minutes: string;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  // ======================================================================
  // GET /api/v1/reports/billing-summary?from=&to=
  // Total invoiced, paid, outstanding in date range.
  // ======================================================================

  fastify.get(
    '/api/v1/reports/billing-summary',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;
      const fromDate = query['from'] ?? null;
      const toDate = query['to'] ?? null;

      if (fromDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
        return errResponse(reply, 400, 'VALIDATION_ERROR', 'from: μορφή YYYY-MM-DD.');
      }
      if (toDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
        return errResponse(reply, 400, 'VALIDATION_ERROR', 'to: μορφή YYYY-MM-DD.');
      }

      const summary = await withTenantSchema(request, async (tx) => {
        const rows = await tx<BillingSummaryRow[]>`
          SELECT
            coalesce(sum(total_eur_cents) FILTER (WHERE status != 'cancelled' AND status != 'draft'), 0)::text
              AS total_invoiced_cents,
            coalesce(sum(total_eur_cents) FILTER (WHERE status = 'paid'), 0)::text
              AS total_paid_cents,
            coalesce(
              sum(total_eur_cents) FILTER (WHERE status IN ('issued', 'sent', 'overdue'))
              - coalesce(
                  (SELECT sum(p.amount_eur_cents)
                   FROM payment p
                   JOIN invoice i ON i.id = p.invoice_id
                   WHERE i.status IN ('issued', 'sent', 'overdue')
                     AND (${fromDate}::text IS NULL OR i.issue_date >= ${fromDate}::date)
                     AND (${toDate}::text IS NULL OR i.issue_date <= ${toDate}::date)),
                  0
                ),
              0
            )::text AS total_outstanding_cents,
            count(*) FILTER (WHERE status = 'draft')::text   AS draft_count,
            count(*) FILTER (WHERE status = 'issued')::text  AS issued_count,
            count(*) FILTER (WHERE status = 'paid')::text    AS paid_count,
            count(*) FILTER (WHERE status = 'overdue')::text AS overdue_count
          FROM invoice
          WHERE (${fromDate}::text IS NULL OR issue_date >= ${fromDate}::date)
            AND (${toDate}::text IS NULL OR issue_date <= ${toDate}::date)
        `;

        return rows[0] ?? null;
      });

      return reply.code(200).send({
        data: summary,
        meta: { from: fromDate, to: toDate },
      });
    }
  );

  // ======================================================================
  // GET /api/v1/reports/time-by-user?from=&to=
  // Productivity per user: total + billable minutes + billable amount.
  // ======================================================================

  fastify.get(
    '/api/v1/reports/time-by-user',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;
      const fromDate = query['from'] ?? null;
      const toDate = query['to'] ?? null;

      if (fromDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
        return errResponse(reply, 400, 'VALIDATION_ERROR', 'from: μορφή YYYY-MM-DD.');
      }
      if (toDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
        return errResponse(reply, 400, 'VALIDATION_ERROR', 'to: μορφή YYYY-MM-DD.');
      }

      const rows = await withTenantSchema(request, async (tx) => {
        return tx<TimeByUserRow[]>`
          SELECT
            user_id,
            count(*)::text AS total_entries,
            coalesce(sum(duration_minutes), 0)::text AS total_minutes,
            coalesce(sum(duration_minutes) FILTER (WHERE billable), 0)::text AS billable_minutes,
            coalesce(sum(duration_minutes) FILTER (WHERE NOT billable), 0)::text AS non_billable_minutes,
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
          GROUP BY user_id
          ORDER BY billable_minutes DESC
        `;
      });

      return reply.code(200).send({
        data: rows,
        meta: { from: fromDate, to: toDate, total: rows.length },
      });
    }
  );

  // ======================================================================
  // GET /api/v1/reports/realization-rate?from=&to=
  // Realization rate = billed_amount / time_value per matter.
  // Κρίσιμο KPI για δικηγορικά γραφεία.
  // time_value = sum of (duration_minutes * billable_rate_eur_cents / 60)
  // billed = sum of invoice_line.total_eur_cents WHERE source_type='time'
  // ======================================================================

  fastify.get(
    '/api/v1/reports/realization-rate',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;
      const fromDate = query['from'] ?? null;
      const toDate = query['to'] ?? null;

      if (fromDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
        return errResponse(reply, 400, 'VALIDATION_ERROR', 'from: μορφή YYYY-MM-DD.');
      }
      if (toDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
        return errResponse(reply, 400, 'VALIDATION_ERROR', 'to: μορφή YYYY-MM-DD.');
      }

      const rows = await withTenantSchema(request, async (tx) => {
        return tx<RealizationRateRow[]>`
          WITH time_values AS (
            SELECT
              matter_id,
              sum(duration_minutes)::text AS total_minutes,
              sum(duration_minutes) FILTER (WHERE billable)::text AS billable_minutes,
              coalesce(
                sum(
                  CASE WHEN billable
                    THEN (duration_minutes::bigint * billable_rate_eur_cents / 60)
                    ELSE 0
                  END
                ),
                0
              ) AS time_value_cents
            FROM time_entry
            WHERE status != 'written_off'
              AND (${fromDate}::text IS NULL OR started_at >= ${fromDate}::timestamptz)
              AND (${toDate}::text IS NULL OR started_at <= ${toDate}::timestamptz)
            GROUP BY matter_id
          ),
          billed_values AS (
            SELECT
              i.matter_id,
              coalesce(sum(il.total_eur_cents), 0) AS billed_cents
            FROM invoice_line il
            JOIN invoice i ON i.id = il.invoice_id
            WHERE il.source_type = 'time'
              AND i.status IN ('issued', 'sent', 'paid', 'overdue')
              AND (${fromDate}::text IS NULL OR i.issue_date >= ${fromDate}::date)
              AND (${toDate}::text IS NULL OR i.issue_date <= ${toDate}::date)
            GROUP BY i.matter_id
          )
          SELECT
            tv.matter_id,
            tv.time_value_cents::text AS total_time_value_cents,
            coalesce(bv.billed_cents, 0)::text AS total_billed_cents,
            CASE
              WHEN tv.time_value_cents = 0 THEN '0'
              ELSE round(
                (coalesce(bv.billed_cents, 0)::numeric / tv.time_value_cents::numeric) * 100,
                2
              )::text
            END AS realization_rate_pct,
            tv.total_minutes,
            tv.billable_minutes
          FROM time_values tv
          LEFT JOIN billed_values bv ON bv.matter_id = tv.matter_id
          ORDER BY realization_rate_pct DESC
        `;
      });

      return reply.code(200).send({
        data: rows,
        meta: { from: fromDate, to: toDate, total: rows.length },
      });
    }
  );
};

export default fp(reportsRoutes, { name: 'reports-routes' });
