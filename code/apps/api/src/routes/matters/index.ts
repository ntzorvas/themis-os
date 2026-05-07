/**
 * Matters routes — /api/v1/matters/*
 *
 * Implements Matter ↔ Party M2M (Invariant #2).
 * No client_id on matter — all parties via matter_party junction table.
 *
 * Endpoints:
 *   GET    /api/v1/matters                          — list με filters + pagination
 *   POST   /api/v1/matters                          — create (Zod, audit)
 *   GET    /api/v1/matters/:id                      — detail with parties array
 *   PATCH  /api/v1/matters/:id                      — partial update + status transitions + audit
 *   GET    /api/v1/matters/:id/parties              — list parties (role/side/billing_split)
 *   POST   /api/v1/matters/:id/parties              — attach party (validates split, primary_contact)
 *   PATCH  /api/v1/matters/:matterId/parties/:partyId — update split / role / valid_to
 *   DELETE /api/v1/matters/:matterId/parties/:partyId — soft remove (set valid_to=now)
 *
 * Invariants enforced:
 *   #2  Matter ↔ Party M2M — no client_id on matter
 *   #3  All money BIGINT cents (enforced in schema, validated in Zod)
 *   #6  withTenantSchema wraps every query — NEVER cross-tenant
 *   #2  ALL mutations write to audit_log (append-only, INSERT only)
 *
 * DB constraints relied upon:
 *   - trg_billing_split (DEFERRABLE INITIALLY DEFERRED):
 *     SUM(billing_split_percentage)=100 for active 'ours' rows when billing_split_locked=true.
 *     Trigger fires at COMMIT. Postgres error: 'BILLING_SPLIT_INVALID: ...'
 *   - matter_party_primary_contact_uq (PARTIAL UNIQUE):
 *     Only one is_primary_contact=TRUE per (matter_id, side) WHERE valid_to IS NULL.
 *     Postgres error code: 23505 (unique_violation)
 *   - matter_party_uniq UNIQUE (matter_id, party_id, role):
 *     Prevents duplicate role assignment. Postgres error code: 23505 (unique_violation)
 *
 * Note: matter_party uses `valid_to` (not `left_at`) per 0002_template_schema.sql.
 *
 * @module routes/matters
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { withTenantSchema } from '../../plugins/fastify-tenant.js';
import {
  CreateMatterSchema,
  PatchMatterSchema,
  AttachPartySchema,
  PatchMatterPartySchema,
  STATUS_TRANSITIONS,
  type CreateMatterInput,
  type PatchMatterInput,
  type AttachPartyInput,
  type PatchMatterPartyInput,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Error helper — matches parties/index.ts pattern exactly
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

interface MatterRow {
  id: string;
  matter_number: string;
  title: string;
  matter_type: string;
  status: string;
  opened_at: Date;
  closed_at: Date | null;
  lead_attorney_user_id: string | null;
  practice_area: string | null;
  court: string | null;
  court_case_number: string | null;
  privilege_level: string;
  estimated_value_eur_cents: string | null;
  billing_method: string;
  retainer_balance_eur_cents: string;
  statute_of_limitations: string | null;
  legal_hold: boolean;
  ethical_wall: boolean;
  notes: string | null;
  custom_fields: Record<string, unknown>;
  tags: string[];
  department_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface MatterPartyRow {
  id: string;
  matter_id: string;
  party_id: string;
  role: string;
  side: string;
  representation_status: string;
  representing_counsel_party_id: string | null;
  conflict_check_passed_at: Date | null;
  billing_split_percentage: string | null;
  billing_split_locked: boolean;
  is_primary_contact: boolean;
  valid_from: Date;
  valid_to: Date | null;
  notes: string | null;
}

interface MatterPartyWithNameRow extends MatterPartyRow {
  party_display_name: string;
  party_type: string;
  party_afm: string | null;
}

interface CountRow {
  count: string;
}

interface IdRow {
  id: string;
}

interface ExistingMatterRow {
  id: string;
  status: string;
  deleted_at: Date | null;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const mattersRoutes: FastifyPluginAsync = async (fastify) => {
  // ======================================================================
  // GET /api/v1/matters
  // Filters: status, matter_type, assigned_to_user_id (= lead_attorney_user_id)
  // Pagination: limit (max 100), offset
  // Response envelope: { data: [...], meta: { total, page, per_page } }
  // ======================================================================

  fastify.get(
    '/api/v1/matters',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;

      const rawLimit = parseInt(query['limit'] ?? String(DEFAULT_LIMIT), 10);
      const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);

      const rawOffset = parseInt(query['offset'] ?? '0', 10);
      const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

      const statusFilter = query['status'] ?? null;
      const matterTypeFilter = query['matter_type'] ?? null;
      const assignedToFilter = query['assigned_to_user_id'] ?? null;

      const { rows, total } = await withTenantSchema(request, async (tx) => {
        const [countRows, dataRows] = await Promise.all([
          tx<CountRow[]>`
            SELECT count(*)::text AS count
            FROM matter
            WHERE deleted_at IS NULL
              AND (
                ${statusFilter}::text IS NULL
                OR status = ${statusFilter}::tenant_template.matter_status_t
              )
              AND (
                ${matterTypeFilter}::text IS NULL
                OR matter_type = ${matterTypeFilter}::tenant_template.matter_type_t
              )
              AND (
                ${assignedToFilter}::text IS NULL
                OR lead_attorney_user_id = ${assignedToFilter}::uuid
              )
          `,
          tx<MatterRow[]>`
            SELECT
              id, matter_number, title, matter_type, status,
              opened_at, closed_at, lead_attorney_user_id,
              practice_area, court, court_case_number, privilege_level,
              estimated_value_eur_cents, billing_method, retainer_balance_eur_cents,
              statute_of_limitations, legal_hold, ethical_wall,
              notes, custom_fields, tags, department_id,
              created_at, updated_at
            FROM matter
            WHERE deleted_at IS NULL
              AND (
                ${statusFilter}::text IS NULL
                OR status = ${statusFilter}::tenant_template.matter_status_t
              )
              AND (
                ${matterTypeFilter}::text IS NULL
                OR matter_type = ${matterTypeFilter}::tenant_template.matter_type_t
              )
              AND (
                ${assignedToFilter}::text IS NULL
                OR lead_attorney_user_id = ${assignedToFilter}::uuid
              )
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
  // POST /api/v1/matters
  // Create matter. Writes audit_log on success (Invariant #2).
  // ======================================================================

  fastify.post(
    '/api/v1/matters',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreateMatterSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: CreateMatterInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const matter = await withTenantSchema(request, async (tx) => {
        const rows = await tx<MatterRow[]>`
          INSERT INTO matter (
            matter_number, title, matter_type, status,
            lead_attorney_user_id, practice_area, court, court_case_number,
            privilege_level, estimated_value_eur_cents, billing_method,
            statute_of_limitations, legal_hold, notes, tags,
            department_id, custom_fields
          ) VALUES (
            ${input.matter_number},
            ${input.title},
            ${input.matter_type}::tenant_template.matter_type_t,
            ${input.status}::tenant_template.matter_status_t,
            ${input.lead_attorney_user_id ?? null}::uuid,
            ${input.practice_area ?? null},
            ${input.court ?? null},
            ${input.court_case_number ?? null},
            ${input.privilege_level}::tenant_template.matter_privilege_t,
            ${input.estimated_value_eur_cents ?? null},
            ${input.billing_method}::tenant_template.billing_method_t,
            ${input.statute_of_limitations ?? null},
            ${input.legal_hold},
            ${input.notes ?? null},
            ${input.tags},
            ${input.department_id ?? null}::uuid,
            ${JSON.stringify(input.custom_fields)}::jsonb
          )
          RETURNING
            id, matter_number, title, matter_type, status,
            opened_at, closed_at, lead_attorney_user_id,
            practice_area, court, court_case_number, privilege_level,
            estimated_value_eur_cents, billing_method, retainer_balance_eur_cents,
            statute_of_limitations, legal_hold, ethical_wall,
            notes, custom_fields, tags, department_id,
            created_at, updated_at
        `;

        const inserted = rows[0];
        if (inserted === undefined) {
          throw Object.assign(new Error('INSERT matter returned no row'), { code: 'DB_ERROR' });
        }

        // Audit (Invariant #2 — append-only INSERT)
        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES (
            ${actorUserId}::uuid,
            'matter.create',
            'matter',
            ${inserted.id},
            ${JSON.stringify({
              matter_number: input.matter_number,
              title: input.title,
              matter_type: input.matter_type,
              status: input.status,
            })}::jsonb,
            ${request.ip}::inet,
            ${userAgent},
            'success'
          )
        `;

        return inserted;
      });

      return reply.code(201).send({ data: matter });
    }
  );

  // ======================================================================
  // GET /api/v1/matters/:id
  // Detail with parties array (joined matter_party + party).
  // ======================================================================

  fastify.get(
    '/api/v1/matters/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const result = await withTenantSchema(request, async (tx) => {
        const [matterRows, partyRows] = await Promise.all([
          tx<MatterRow[]>`
            SELECT
              id, matter_number, title, matter_type, status,
              opened_at, closed_at, lead_attorney_user_id,
              practice_area, court, court_case_number, privilege_level,
              estimated_value_eur_cents, billing_method, retainer_balance_eur_cents,
              statute_of_limitations, legal_hold, ethical_wall,
              notes, custom_fields, tags, department_id,
              created_at, updated_at, deleted_at
            FROM matter
            WHERE id = ${id}::uuid
            LIMIT 1
          `,
          tx<MatterPartyWithNameRow[]>`
            SELECT
              mp.id, mp.matter_id, mp.party_id, mp.role, mp.side,
              mp.representation_status, mp.representing_counsel_party_id,
              mp.conflict_check_passed_at, mp.billing_split_percentage,
              mp.billing_split_locked, mp.is_primary_contact,
              mp.valid_from, mp.valid_to, mp.notes,
              p.display_name AS party_display_name,
              p.party_type,
              p.afm AS party_afm
            FROM matter_party mp
            JOIN party p ON p.id = mp.party_id
            WHERE mp.matter_id = ${id}::uuid
            ORDER BY mp.side ASC, mp.role ASC, mp.valid_from ASC
          `,
        ]);

        return { matterRows, partyRows };
      });

      const matter = result.matterRows[0];
      if (matter === undefined || matter.deleted_at !== null) {
        return errResponse(reply, 404, 'MATTER_NOT_FOUND', 'Ο φάκελος υπόθεσης δεν βρέθηκε.');
      }

      return reply.code(200).send({
        data: {
          ...matter,
          parties: result.partyRows,
        },
      });
    }
  );

  // ======================================================================
  // PATCH /api/v1/matters/:id
  // Partial update. Validates status transitions. Writes audit_log (Invariant #2).
  // ======================================================================

  fastify.patch(
    '/api/v1/matters/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parseResult = PatchMatterSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: PatchMatterInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const updated = await withTenantSchema(request, async (tx) => {
        // Verify matter exists and is not deleted
        const existing = await tx<ExistingMatterRow[]>`
          SELECT id, status, deleted_at
          FROM matter
          WHERE id = ${id}::uuid
          LIMIT 1
        `;

        const existingMatter = existing[0];
        if (existingMatter === undefined || existingMatter.deleted_at !== null) {
          return null;
        }

        // Validate status transition if status is being changed
        if (input.status !== undefined && input.status !== existingMatter.status) {
          const allowed = STATUS_TRANSITIONS[existingMatter.status] ?? [];
          if (!(allowed as ReadonlyArray<string>).includes(input.status)) {
            throw Object.assign(
              new Error(
                `Μη επιτρεπτή μετάβαση status από "${existingMatter.status}" σε "${input.status}". ` +
                `Επιτρεπτές: ${allowed.length > 0 ? allowed.join(', ') : 'καμία'}.`
              ),
              { code: 'INVALID_STATUS_TRANSITION', statusCode: 422 }
            );
          }
        }

        const rows = await tx<MatterRow[]>`
          UPDATE matter SET
            title                     = COALESCE(${input.title ?? null}, title),
            matter_type               = COALESCE(
                                          ${input.matter_type ?? null}::tenant_template.matter_type_t,
                                          matter_type
                                        ),
            status                    = COALESCE(
                                          ${input.status ?? null}::tenant_template.matter_status_t,
                                          status
                                        ),
            lead_attorney_user_id     = COALESCE(${input.lead_attorney_user_id ?? null}::uuid, lead_attorney_user_id),
            practice_area             = COALESCE(${input.practice_area ?? null}, practice_area),
            court                     = COALESCE(${input.court ?? null}, court),
            court_case_number         = COALESCE(${input.court_case_number ?? null}, court_case_number),
            privilege_level           = COALESCE(
                                          ${input.privilege_level ?? null}::tenant_template.matter_privilege_t,
                                          privilege_level
                                        ),
            estimated_value_eur_cents = COALESCE(${input.estimated_value_eur_cents ?? null}, estimated_value_eur_cents),
            billing_method            = COALESCE(
                                          ${input.billing_method ?? null}::tenant_template.billing_method_t,
                                          billing_method
                                        ),
            statute_of_limitations    = COALESCE(${input.statute_of_limitations ?? null}, statute_of_limitations),
            legal_hold                = COALESCE(${input.legal_hold ?? null}, legal_hold),
            notes                     = COALESCE(${input.notes ?? null}, notes),
            tags                      = COALESCE(${input.tags ?? null}, tags),
            department_id             = COALESCE(${input.department_id ?? null}::uuid, department_id),
            custom_fields             = COALESCE(
                                          ${input.custom_fields !== undefined ? JSON.stringify(input.custom_fields) : null}::jsonb,
                                          custom_fields
                                        ),
            updated_at                = now()
          WHERE id = ${id}::uuid AND deleted_at IS NULL
          RETURNING
            id, matter_number, title, matter_type, status,
            opened_at, closed_at, lead_attorney_user_id,
            practice_area, court, court_case_number, privilege_level,
            estimated_value_eur_cents, billing_method, retainer_balance_eur_cents,
            statute_of_limitations, legal_hold, ethical_wall,
            notes, custom_fields, tags, department_id,
            created_at, updated_at
        `;

        const row = rows[0];
        if (row === undefined) return null;

        // Audit (Invariant #2 — append-only INSERT)
        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES (
            ${actorUserId}::uuid,
            'matter.update',
            'matter',
            ${id},
            ${JSON.stringify({ updated_fields: Object.keys(input) })}::jsonb,
            ${request.ip}::inet,
            ${userAgent},
            'success'
          )
        `;

        return row;
      });

      if (updated === null) {
        return errResponse(reply, 404, 'MATTER_NOT_FOUND', 'Ο φάκελος υπόθεσης δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: updated });
    }
  );

  // ======================================================================
  // GET /api/v1/matters/:id/parties
  // List all matter_party rows με joined party info.
  // ======================================================================

  fastify.get(
    '/api/v1/matters/:id/parties',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parties = await withTenantSchema(request, async (tx) => {
        // Verify matter exists
        const matterCheck = await tx<IdRow[]>`
          SELECT id FROM matter
          WHERE id = ${id}::uuid AND deleted_at IS NULL
          LIMIT 1
        `;

        if (matterCheck[0] === undefined) return null;

        return tx<MatterPartyWithNameRow[]>`
          SELECT
            mp.id, mp.matter_id, mp.party_id, mp.role, mp.side,
            mp.representation_status, mp.representing_counsel_party_id,
            mp.conflict_check_passed_at, mp.billing_split_percentage,
            mp.billing_split_locked, mp.is_primary_contact,
            mp.valid_from, mp.valid_to, mp.notes,
            p.display_name AS party_display_name,
            p.party_type,
            p.afm AS party_afm
          FROM matter_party mp
          JOIN party p ON p.id = mp.party_id
          WHERE mp.matter_id = ${id}::uuid
          ORDER BY mp.side ASC, mp.role ASC, mp.valid_from ASC
        `;
      });

      if (parties === null) {
        return errResponse(reply, 404, 'MATTER_NOT_FOUND', 'Ο φάκελος υπόθεσης δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: parties });
    }
  );

  // ======================================================================
  // POST /api/v1/matters/:id/parties
  // Attach party to matter with role, side, billing_split, primary_contact.
  // Catches:
  //   - 23505 unique_violation → matter_party_uniq (duplicate role) → 409
  //   - 23505 unique_violation → matter_party_primary_contact_uq → 409
  //   - P0001 raise_exception  → BILLING_SPLIT_INVALID (trigger) → 400
  // Writes audit_log on success (Invariant #2).
  // ======================================================================

  fastify.post(
    '/api/v1/matters/:id/parties',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parseResult = AttachPartySchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: AttachPartyInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      try {
        const matterParty = await withTenantSchema(request, async (tx) => {
          // Verify matter exists
          const matterCheck = await tx<IdRow[]>`
            SELECT id FROM matter
            WHERE id = ${id}::uuid AND deleted_at IS NULL
            LIMIT 1
          `;

          if (matterCheck[0] === undefined) return null;

          // Verify party exists and is not soft-deleted
          const partyCheck = await tx<IdRow[]>`
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

          const rows = await tx<MatterPartyRow[]>`
            INSERT INTO matter_party (
              matter_id, party_id, role, side,
              representation_status, representing_counsel_party_id,
              billing_split_percentage, billing_split_locked,
              is_primary_contact, notes
            ) VALUES (
              ${id}::uuid,
              ${input.party_id}::uuid,
              ${input.role}::tenant_template.matter_party_role_t,
              ${input.side}::tenant_template.matter_party_side_t,
              ${input.representation_status}::tenant_template.representation_status_t,
              ${input.representing_counsel_party_id ?? null}::uuid,
              ${input.billing_split_percentage ?? null},
              ${input.billing_split_locked},
              ${input.is_primary_contact},
              ${input.notes ?? null}
            )
            RETURNING
              id, matter_id, party_id, role, side,
              representation_status, representing_counsel_party_id,
              conflict_check_passed_at, billing_split_percentage,
              billing_split_locked, is_primary_contact,
              valid_from, valid_to, notes
          `;

          const inserted = rows[0];
          if (inserted === undefined) {
            throw Object.assign(new Error('INSERT matter_party returned no row'), { code: 'DB_ERROR' });
          }

          // Audit (Invariant #2 — append-only INSERT)
          await tx`
            INSERT INTO audit_log
              (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
            VALUES (
              ${actorUserId}::uuid,
              'matter.party.attach',
              'matter_party',
              ${inserted.id},
              ${JSON.stringify({
                matter_id: id,
                party_id: input.party_id,
                role: input.role,
                side: input.side,
                billing_split_percentage: input.billing_split_percentage ?? null,
              })}::jsonb,
              ${request.ip}::inet,
              ${userAgent},
              'success'
            )
          `;

          return inserted;
        });

        if (matterParty === null) {
          return errResponse(reply, 404, 'MATTER_NOT_FOUND', 'Ο φάκελος υπόθεσης δεν βρέθηκε.');
        }

        return reply.code(201).send({ data: matterParty });
      } catch (err: unknown) {
        if (isPostgresError(err)) {
          // Unique violation — primary contact or duplicate role
          if (err.code === '23505') {
            if (err.constraint === 'matter_party_primary_contact_uq') {
              return errResponse(
                reply,
                409,
                'PRIMARY_CONTACT_CONFLICT',
                'Υπάρχει ήδη κύρια επαφή (is_primary_contact=true) για αυτό το side στην υπόθεση. ' +
                'Αφαιρέστε πρώτα την υπάρχουσα ή ορίστε is_primary_contact=false.'
              );
            }
            if (err.constraint === 'matter_party_uniq') {
              return errResponse(
                reply,
                409,
                'DUPLICATE_PARTY_ROLE',
                'Το μέρος έχει ήδη αυτό τον ρόλο στην υπόθεση.'
              );
            }
            return errResponse(reply, 409, 'CONFLICT', 'Σύγκρουση δεδομένων κατά την εισαγωγή.');
          }

          // Trigger RAISE EXCEPTION — billing split invalid
          if (err.code === 'P0001' && typeof err.message === 'string' && err.message.includes('BILLING_SPLIT_INVALID')) {
            return errResponse(
              reply,
              400,
              'BILLING_SPLIT_INVALID',
              'Το άθροισμα των billing_split_percentage για τα ενεργά "ours" μέρη δεν ισούται με 100. ' +
              'Ελέγξτε τα ποσοστά και βεβαιωθείτε ότι αθροίζουν 100.'
            );
          }
        }

        // Re-throw structured errors from within withTenantSchema
        if (isStructuredError(err)) {
          return errResponse(
            reply,
            err.statusCode,
            err.code,
            err.message
          );
        }

        throw err;
      }
    }
  );

  // ======================================================================
  // PATCH /api/v1/matters/:matterId/parties/:partyId
  // Update split / role / valid_to / is_primary_contact on a matter_party row.
  // partyId here is the matter_party.id (junction row UUID), not party.id.
  // Catches same billing_split and primary_contact constraint violations.
  // Writes audit_log on success (Invariant #2).
  // ======================================================================

  fastify.patch(
    '/api/v1/matters/:matterId/parties/:partyId',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { matterId, partyId } = request.params as { matterId: string; partyId: string };

      const parseResult = PatchMatterPartySchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: PatchMatterPartyInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      try {
        const updated = await withTenantSchema(request, async (tx) => {
          // Verify the matter_party row exists and belongs to this matter
          const existing = await tx<MatterPartyRow[]>`
            SELECT id, matter_id, party_id, role, side,
                   billing_split_percentage, billing_split_locked,
                   is_primary_contact, valid_to
            FROM matter_party
            WHERE id = ${partyId}::uuid AND matter_id = ${matterId}::uuid
            LIMIT 1
          `;

          if (existing[0] === undefined) return null;

          const rows = await tx<MatterPartyRow[]>`
            UPDATE matter_party SET
              role                          = COALESCE(
                                                ${input.role ?? null}::tenant_template.matter_party_role_t,
                                                role
                                              ),
              side                          = COALESCE(
                                                ${input.side ?? null}::tenant_template.matter_party_side_t,
                                                side
                                              ),
              representation_status         = COALESCE(
                                                ${input.representation_status ?? null}::tenant_template.representation_status_t,
                                                representation_status
                                              ),
              representing_counsel_party_id = COALESCE(
                                                ${input.representing_counsel_party_id ?? null}::uuid,
                                                representing_counsel_party_id
                                              ),
              billing_split_percentage      = COALESCE(${input.billing_split_percentage ?? null}, billing_split_percentage),
              billing_split_locked          = COALESCE(${input.billing_split_locked ?? null}, billing_split_locked),
              is_primary_contact            = COALESCE(${input.is_primary_contact ?? null}, is_primary_contact),
              valid_to                      = COALESCE(${input.valid_to ?? null}::timestamptz, valid_to),
              notes                         = COALESCE(${input.notes ?? null}, notes)
            WHERE id = ${partyId}::uuid AND matter_id = ${matterId}::uuid
            RETURNING
              id, matter_id, party_id, role, side,
              representation_status, representing_counsel_party_id,
              conflict_check_passed_at, billing_split_percentage,
              billing_split_locked, is_primary_contact,
              valid_from, valid_to, notes
          `;

          const row = rows[0];
          if (row === undefined) return null;

          // Audit (Invariant #2 — append-only INSERT)
          await tx`
            INSERT INTO audit_log
              (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
            VALUES (
              ${actorUserId}::uuid,
              'matter.party.update',
              'matter_party',
              ${partyId},
              ${JSON.stringify({ matter_id: matterId, updated_fields: Object.keys(input) })}::jsonb,
              ${request.ip}::inet,
              ${userAgent},
              'success'
            )
          `;

          return row;
        });

        if (updated === null) {
          return errResponse(
            reply,
            404,
            'MATTER_PARTY_NOT_FOUND',
            'Η συσχέτιση μέρους-υπόθεσης δεν βρέθηκε.'
          );
        }

        return reply.code(200).send({ data: updated });
      } catch (err: unknown) {
        if (isPostgresError(err)) {
          if (err.code === '23505') {
            if (err.constraint === 'matter_party_primary_contact_uq') {
              return errResponse(
                reply,
                409,
                'PRIMARY_CONTACT_CONFLICT',
                'Υπάρχει ήδη κύρια επαφή (is_primary_contact=true) για αυτό το side στην υπόθεση.'
              );
            }
            return errResponse(reply, 409, 'CONFLICT', 'Σύγκρουση δεδομένων κατά την ενημέρωση.');
          }

          if (err.code === 'P0001' && typeof err.message === 'string' && err.message.includes('BILLING_SPLIT_INVALID')) {
            return errResponse(
              reply,
              400,
              'BILLING_SPLIT_INVALID',
              'Το άθροισμα των billing_split_percentage για τα ενεργά "ours" μέρη δεν ισούται με 100. ' +
              'Ελέγξτε τα ποσοστά και βεβαιωθείτε ότι αθροίζουν 100.'
            );
          }
        }

        throw err;
      }
    }
  );

  // ======================================================================
  // DELETE /api/v1/matters/:matterId/parties/:partyId
  // Soft remove: set valid_to = now() on the matter_party row.
  // partyId = matter_party.id (junction row UUID).
  // Writes audit_log on success (Invariant #2).
  // ======================================================================

  fastify.delete(
    '/api/v1/matters/:matterId/parties/:partyId',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { matterId, partyId } = request.params as { matterId: string; partyId: string };

      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const removed = await withTenantSchema(request, async (tx) => {
        const rows = await tx<MatterPartyRow[]>`
          UPDATE matter_party
          SET valid_to = now()
          WHERE id = ${partyId}::uuid
            AND matter_id = ${matterId}::uuid
            AND valid_to IS NULL
          RETURNING
            id, matter_id, party_id, role, side,
            representation_status, representing_counsel_party_id,
            conflict_check_passed_at, billing_split_percentage,
            billing_split_locked, is_primary_contact,
            valid_from, valid_to, notes
        `;

        const row = rows[0];
        if (row === undefined) return null;

        // Audit (Invariant #2 — append-only INSERT)
        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES (
            ${actorUserId}::uuid,
            'matter.party.remove',
            'matter_party',
            ${partyId},
            ${JSON.stringify({ matter_id: matterId, party_id: row.party_id, role: row.role })}::jsonb,
            ${request.ip}::inet,
            ${userAgent},
            'success'
          )
        `;

        return row;
      });

      if (removed === null) {
        return errResponse(
          reply,
          404,
          'MATTER_PARTY_NOT_FOUND',
          'Η συσχέτιση μέρους-υπόθεσης δεν βρέθηκε ή έχει ήδη αφαιρεθεί.'
        );
      }

      return reply.code(200).send({ data: removed });
    }
  );
};

// ---------------------------------------------------------------------------
// Type guards for Postgres / structured errors
// ---------------------------------------------------------------------------

interface PostgresError {
  code: string;
  constraint?: string;
  message: string;
}

interface StructuredError {
  code: string;
  statusCode: number;
  message: string;
}

function isPostgresError(err: unknown): err is PostgresError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>)['code'] === 'string'
  );
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

export default fp(mattersRoutes, { name: 'matters-routes' });
