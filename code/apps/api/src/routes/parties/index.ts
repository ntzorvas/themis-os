/**
 * Parties routes — /api/v1/parties/*
 *
 * Implements the Unified Party Model (Invariant #1).
 * All persons/organisations — clients, counterparties, witnesses, suppliers, etc.
 * — are stored in a single `party` table. Roles are time-bounded via `party_role`.
 *
 * Endpoints:
 *   GET    /api/v1/clients                  — 410 Gone
 *   GET    /api/v1/parties/search           — AFM exact + name FTS
 *   GET    /api/v1/parties                  — list με filters + pagination
 *   POST   /api/v1/parties                  — create (AFM checksum via greek-utils)
 *   GET    /api/v1/parties/:id              — detail (joined roles, contacts, addresses)
 *   PATCH  /api/v1/parties/:id             — partial update
 *   GET    /api/v1/parties/:id/roles        — time-bounded roles list
 *   POST   /api/v1/parties/:id/roles        — add role με valid_from/valid_to
 *
 * Invariants enforced:
 *   #1  Unified Party Model — no separate client table
 *   #2  ALL mutations write to audit_log (append-only, INSERT only)
 *   #6  withTenantSchema wraps every query — NEVER cross-tenant
 *
 * PII Note (Invariant #4 — DEFERRED to Phase 1.5):
 *   afm, display_name stored as plaintext in Phase 1 for search simplicity.
 *   GG4 todo 4a5888eb tracks encryption sprint.
 *
 * @module routes/parties
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { withTenantSchema } from '../../plugins/fastify-tenant.js';
import { validateAFM } from '@themisos/greek-utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ROLES = [
  'client', 'counterparty', 'witness', 'expert', 'judge', 'court',
  'supplier', 'employee', 'contact', 'opposing_counsel', 'mediator',
  'arbitrator', 'guarantor', 'notary', 'bailiff', 'other',
] as const;

type PartyRoleKind = typeof VALID_ROLES[number];

const VALID_PARTY_TYPES = ['natural', 'legal'] as const;
type PartyTypeKind = typeof VALID_PARTY_TYPES[number];

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Error helper — matches auth route pattern
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

const CreatePartySchema = z.object({
  party_type: z.enum(VALID_PARTY_TYPES, {
    errorMap: () => ({ message: 'party_type πρέπει να είναι "natural" ή "legal".' }),
  }),
  display_name: z
    .string({ required_error: 'display_name είναι υποχρεωτικό.' })
    .min(1, 'display_name δεν μπορεί να είναι κενό.')
    .max(255, 'display_name υπερβαίνει τα 255 χαρακτήρες.'),
  afm: z
    .string()
    .regex(/^\d{9}$/, 'ΑΦΜ πρέπει να αποτελείται από 9 ψηφία.')
    .optional(),
  doy: z.string().max(100).optional(),
  is_attorney: z.boolean().optional().default(false),
  bar_number: z.string().max(50).optional(),
  gdpr_consent_at: z.string().datetime().optional(),
  gdpr_consent_type: z.string().max(50).optional(),
});

type CreatePartyInput = z.infer<typeof CreatePartySchema>;

const PatchPartySchema = z
  .object({
    display_name: z.string().min(1).max(255).optional(),
    afm: z
      .string()
      .regex(/^\d{9}$/, 'ΑΦΜ πρέπει να αποτελείται από 9 ψηφία.')
      .optional(),
    doy: z.string().max(100).optional(),
    is_attorney: z.boolean().optional(),
    bar_number: z.string().max(50).optional(),
    gdpr_consent_at: z.string().datetime().optional(),
    gdpr_consent_type: z.string().max(50).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Τουλάχιστον ένα πεδίο απαιτείται για ενημέρωση.',
  });

type PatchPartyInput = z.infer<typeof PatchPartySchema>;

const AddRoleSchema = z.object({
  role: z.enum(VALID_ROLES, {
    errorMap: () => ({
      message: `role πρέπει να είναι ένα από: ${VALID_ROLES.join(', ')}.`,
    }),
  }),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'valid_from: μορφή YYYY-MM-DD.')
    .optional(),
  valid_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'valid_to: μορφή YYYY-MM-DD.')
    .optional(),
  notes: z.string().max(500).optional(),
});

type AddRoleInput = z.infer<typeof AddRoleSchema>;

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface PartyBaseRow {
  id: string;
  party_type: string;
  display_name: string;
  afm: string | null;
  doy: string | null;
  is_attorney: boolean;
  bar_number: string | null;
  created_at: Date;
  updated_at: Date;
}

interface PartyDetailRow extends PartyBaseRow {
  soft_deleted_at: Date | null;
  gdpr_consent_at: Date | null;
  gdpr_consent_type: string | null;
}

interface PartyRoleRow {
  id: string;
  party_id: string;
  role: string;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  created_at: Date;
}

interface PartyContactRow {
  id: string;
  party_id: string;
  contact_type: string;
  value: string;
  label: string | null;
  is_primary: boolean;
  created_at: Date;
}

interface PartyAddressRow {
  id: string;
  party_id: string;
  address_type: string;
  street: string | null;
  number: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string;
  is_primary: boolean;
  created_at: Date;
}

interface PartyNaturalRow {
  party_id: string;
  first_name: string | null;
  last_name: string | null;
  father_name: string | null;
  mother_name: string | null;
  birth_date: string | null;
  gender: string | null;
  adt_number: string | null;
  profession: string | null;
}

interface PartyLegalRow {
  party_id: string;
  legal_name: string;
  legal_form: string | null;
  gemi_number: string | null;
  website: string | null;
}

interface CountRow {
  count: string;
}

interface IdRow {
  id: string;
}

interface ExistingPartyRow {
  id: string;
  is_attorney: boolean;
  bar_number: string | null;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const partiesRoutes: FastifyPluginAsync = async (fastify) => {
  // ======================================================================
  // GET /api/v1/clients → 410 Gone
  // Registered first to avoid routing ambiguity
  // ======================================================================

  fastify.get(
    '/api/v1/clients',
    {},
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(410).send({
        error: {
          code: 'ENDPOINT_REMOVED',
          message: 'Endpoint αποσύρθηκε. Χρησιμοποιήστε /api/v1/parties?role=client',
        },
      });
    }
  );

  // ======================================================================
  // GET /api/v1/parties/search?q=
  // AFM exact match (party_afm_idx) + name FTS (gin index)
  // Registered BEFORE /:id to prevent "search" being matched as a UUID
  // ======================================================================

  fastify.get(
    '/api/v1/parties/search',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;
      const q = query['q'];

      if (q === undefined || q.trim().length === 0) {
        return errResponse(reply, 400, 'VALIDATION_ERROR', 'Παράμετρος "q" είναι υποχρεωτική.');
      }

      const searchTerm = q.trim();

      const rows = await withTenantSchema(request, async (tx) => {
        return tx<PartyBaseRow[]>`
          SELECT
            id, party_type, display_name, afm, doy,
            is_attorney, bar_number, created_at, updated_at
          FROM party
          WHERE soft_deleted_at IS NULL
            AND (
              afm = ${searchTerm}
              OR to_tsvector('simple', display_name) @@ plainto_tsquery('simple', ${searchTerm})
            )
          ORDER BY
            CASE WHEN afm = ${searchTerm} THEN 0 ELSE 1 END ASC,
            display_name ASC
          LIMIT 50
        `;
      });

      return reply.code(200).send({ data: rows, total: rows.length });
    }
  );

  // ======================================================================
  // GET /api/v1/parties
  // Filters: role (party_role_kind_t), party_type, is_attorney
  // Pagination: limit (max 100), offset
  // ======================================================================

  fastify.get(
    '/api/v1/parties',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;

      // --- Validate filters ---
      const roleFilter = query['role'];
      if (roleFilter !== undefined && !(VALID_ROLES as ReadonlyArray<string>).includes(roleFilter)) {
        return errResponse(
          reply,
          400,
          'INVALID_ROLE',
          `Μη έγκυρο role. Έγκυρες τιμές: ${VALID_ROLES.join(', ')}.`
        );
      }

      const partyTypeFilter = query['party_type'];
      if (
        partyTypeFilter !== undefined &&
        !(VALID_PARTY_TYPES as ReadonlyArray<string>).includes(partyTypeFilter)
      ) {
        return errResponse(
          reply,
          400,
          'INVALID_PARTY_TYPE',
          'party_type πρέπει να είναι "natural" ή "legal".'
        );
      }

      const isAttorneyStr = query['is_attorney'];
      const isAttorneyFilter: boolean | null =
        isAttorneyStr === 'true' ? true
        : isAttorneyStr === 'false' ? false
        : null;

      const rawLimit = parseInt(query['limit'] ?? String(DEFAULT_LIMIT), 10);
      const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);

      const rawOffset = parseInt(query['offset'] ?? '0', 10);
      const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

      // --- Query ---
      const { rows, total } = await withTenantSchema(request, async (tx) => {
        // Use a CTE to avoid repeating filter conditions
        // Filters are applied as nullable params — postgres.js handles NULL correctly

        const typedRole = (roleFilter as PartyRoleKind | undefined) ?? null;
        const typedType = (partyTypeFilter as PartyTypeKind | undefined) ?? null;

        const [countRows, dataRows] = await Promise.all([
          tx<CountRow[]>`
            SELECT count(*)::text AS count
            FROM party p
            WHERE p.soft_deleted_at IS NULL
              AND (
                ${typedRole}::text IS NULL
                OR p.id IN (
                  SELECT party_id FROM party_role
                  WHERE role = ${typedRole}::tenant_template.party_role_kind_t
                    AND (valid_to IS NULL OR valid_to >= current_date)
                )
              )
              AND (
                ${typedType}::text IS NULL
                OR p.party_type = ${typedType}::tenant_template.party_type_t
              )
              AND (
                ${isAttorneyFilter}::boolean IS NULL
                OR p.is_attorney = ${isAttorneyFilter}::boolean
              )
          `,
          tx<PartyBaseRow[]>`
            SELECT
              p.id, p.party_type, p.display_name, p.afm, p.doy,
              p.is_attorney, p.bar_number, p.created_at, p.updated_at
            FROM party p
            WHERE p.soft_deleted_at IS NULL
              AND (
                ${typedRole}::text IS NULL
                OR p.id IN (
                  SELECT party_id FROM party_role
                  WHERE role = ${typedRole}::tenant_template.party_role_kind_t
                    AND (valid_to IS NULL OR valid_to >= current_date)
                )
              )
              AND (
                ${typedType}::text IS NULL
                OR p.party_type = ${typedType}::tenant_template.party_type_t
              )
              AND (
                ${isAttorneyFilter}::boolean IS NULL
                OR p.is_attorney = ${isAttorneyFilter}::boolean
              )
            ORDER BY p.display_name ASC
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
  // POST /api/v1/parties
  // Create party. AFM checksum via @themisos/greek-utils.
  // Writes audit_log on success (Invariant #2).
  // ======================================================================

  fastify.post(
    '/api/v1/parties',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreatePartySchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: CreatePartyInput = parseResult.data;

      // AFM checksum validation (business rule, not just format)
      if (input.afm !== undefined && !validateAFM(input.afm)) {
        return errResponse(
          reply,
          400,
          'INVALID_AFM',
          'Το ΑΦΜ δεν είναι έγκυρο (αποτυχία checksum ΑΑΔΕ).'
        );
      }

      // Attorney requires bar_number
      if (input.is_attorney && (input.bar_number === undefined || input.bar_number === null)) {
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          'bar_number είναι υποχρεωτικό για δικηγόρους (is_attorney = true).'
        );
      }

      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const party = await withTenantSchema(request, async (tx) => {
        const rows = await tx<PartyBaseRow[]>`
          INSERT INTO party
            (party_type, display_name, afm, doy, is_attorney, bar_number,
             gdpr_consent_at, gdpr_consent_type)
          VALUES
            (${input.party_type}::tenant_template.party_type_t,
             ${input.display_name},
             ${input.afm ?? null},
             ${input.doy ?? null},
             ${input.is_attorney},
             ${input.bar_number ?? null},
             ${input.gdpr_consent_at ?? null},
             ${input.gdpr_consent_type ?? null})
          RETURNING
            id, party_type, display_name, afm, doy, is_attorney, bar_number,
            created_at, updated_at
        `;

        const inserted = rows[0];
        if (inserted === undefined) {
          throw Object.assign(new Error('INSERT party returned no row'), { code: 'DB_ERROR' });
        }

        // Audit (Invariant #2 — append-only INSERT)
        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'party.create',
             'party',
             ${inserted.id},
             ${JSON.stringify({ party_type: input.party_type, display_name: input.display_name })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return inserted;
      });

      return reply.code(201).send({ data: party });
    }
  );

  // ======================================================================
  // GET /api/v1/parties/:id
  // Full detail: core + extension tables + roles + contacts + addresses
  // ======================================================================

  fastify.get(
    '/api/v1/parties/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const result = await withTenantSchema(request, async (tx) => {
        const [partyRows, roles, contacts, addresses, naturalRows, legalRows] = await Promise.all([
          tx<PartyDetailRow[]>`
            SELECT
              id, party_type, display_name, afm, doy, is_attorney, bar_number,
              created_at, updated_at, soft_deleted_at, gdpr_consent_at, gdpr_consent_type
            FROM party
            WHERE id = ${id}::uuid
            LIMIT 1
          `,
          tx<PartyRoleRow[]>`
            SELECT id, party_id, role, valid_from, valid_to, notes, created_at
            FROM party_role
            WHERE party_id = ${id}::uuid
            ORDER BY created_at DESC
          `,
          tx<PartyContactRow[]>`
            SELECT id, party_id, contact_type, value, label, is_primary, created_at
            FROM party_contact
            WHERE party_id = ${id}::uuid
            ORDER BY is_primary DESC, created_at ASC
          `,
          tx<PartyAddressRow[]>`
            SELECT
              id, party_id, address_type, street, number, city, region,
              postal_code, country, is_primary, created_at
            FROM party_address
            WHERE party_id = ${id}::uuid
            ORDER BY is_primary DESC, created_at ASC
          `,
          tx<PartyNaturalRow[]>`
            SELECT
              party_id, first_name, last_name, father_name, mother_name,
              birth_date, gender, adt_number, profession
            FROM party_natural
            WHERE party_id = ${id}::uuid
            LIMIT 1
          `,
          tx<PartyLegalRow[]>`
            SELECT party_id, legal_name, legal_form, gemi_number, website
            FROM party_legal
            WHERE party_id = ${id}::uuid
            LIMIT 1
          `,
        ]);

        return { partyRows, roles, contacts, addresses, naturalRows, legalRows };
      });

      const party = result.partyRows[0];
      if (party === undefined || party.soft_deleted_at !== null) {
        return errResponse(reply, 404, 'PARTY_NOT_FOUND', 'Ο φάκελος δεν βρέθηκε.');
      }

      return reply.code(200).send({
        data: {
          ...party,
          roles: result.roles,
          contacts: result.contacts,
          addresses: result.addresses,
          natural: result.naturalRows[0] ?? null,
          legal: result.legalRows[0] ?? null,
        },
      });
    }
  );

  // ======================================================================
  // PATCH /api/v1/parties/:id
  // Partial update. Only provided fields change; others use COALESCE.
  // Writes audit_log on success (Invariant #2).
  // ======================================================================

  fastify.patch(
    '/api/v1/parties/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parseResult = PatchPartySchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: PatchPartyInput = parseResult.data;

      // AFM checksum validation if provided
      if (input.afm !== undefined && !validateAFM(input.afm)) {
        return errResponse(
          reply,
          400,
          'INVALID_AFM',
          'Το ΑΦΜ δεν είναι έγκυρο (αποτυχία checksum ΑΑΔΕ).'
        );
      }

      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const updated = await withTenantSchema(request, async (tx) => {
        // Verify party exists and is not soft-deleted
        const existing = await tx<ExistingPartyRow[]>`
          SELECT id, is_attorney, bar_number
          FROM party
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          LIMIT 1
        `;

        const existingParty = existing[0];
        if (existingParty === undefined) {
          return null;
        }

        // Business rule: is_attorney=true requires bar_number to be present
        const effectiveIsAttorney = input.is_attorney ?? existingParty.is_attorney;
        const effectiveBarNumber = input.bar_number ?? existingParty.bar_number;
        if (effectiveIsAttorney && (effectiveBarNumber === null || effectiveBarNumber === undefined)) {
          throw Object.assign(
            new Error('bar_number είναι υποχρεωτικό για δικηγόρους.'),
            { code: 'VALIDATION_ERROR', statusCode: 400 }
          );
        }

        const rows = await tx<PartyBaseRow[]>`
          UPDATE party SET
            display_name      = COALESCE(${input.display_name ?? null}, display_name),
            afm               = COALESCE(${input.afm ?? null}, afm),
            doy               = COALESCE(${input.doy ?? null}, doy),
            is_attorney       = COALESCE(${input.is_attorney ?? null}, is_attorney),
            bar_number        = COALESCE(${input.bar_number ?? null}, bar_number),
            gdpr_consent_at   = COALESCE(${input.gdpr_consent_at ?? null}, gdpr_consent_at),
            gdpr_consent_type = COALESCE(${input.gdpr_consent_type ?? null}, gdpr_consent_type),
            updated_at        = now()
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          RETURNING
            id, party_type, display_name, afm, doy, is_attorney, bar_number,
            created_at, updated_at
        `;

        const row = rows[0];
        if (row === undefined) return null;

        // Audit (Invariant #2 — append-only INSERT)
        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'party.update',
             'party',
             ${id},
             ${JSON.stringify({ updated_fields: Object.keys(input) })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return row;
      });

      if (updated === null) {
        return errResponse(reply, 404, 'PARTY_NOT_FOUND', 'Ο φάκελος δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: updated });
    }
  );

  // ======================================================================
  // GET /api/v1/parties/:id/roles
  // Time-bounded roles. Active roles (valid_to IS NULL or future) listed first.
  // ======================================================================

  fastify.get(
    '/api/v1/parties/:id/roles',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const roles = await withTenantSchema(request, async (tx) => {
        // Verify party exists first
        const partyCheck = await tx<IdRow[]>`
          SELECT id FROM party
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          LIMIT 1
        `;

        if (partyCheck[0] === undefined) return null;

        return tx<PartyRoleRow[]>`
          SELECT id, party_id, role, valid_from, valid_to, notes, created_at
          FROM party_role
          WHERE party_id = ${id}::uuid
          ORDER BY
            CASE WHEN valid_to IS NULL OR valid_to >= current_date THEN 0 ELSE 1 END ASC,
            created_at DESC
        `;
      });

      if (roles === null) {
        return errResponse(reply, 404, 'PARTY_NOT_FOUND', 'Ο φάκελος δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: roles });
    }
  );

  // ======================================================================
  // POST /api/v1/parties/:id/roles
  // Add time-bounded role. Writes audit_log (Invariant #2).
  // Multiple simultaneous roles per party are allowed (Invariant #1).
  // ======================================================================

  fastify.post(
    '/api/v1/parties/:id/roles',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parseResult = AddRoleSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: AddRoleInput = parseResult.data;

      // Business rule: valid_from must precede valid_to
      if (
        input.valid_from !== undefined &&
        input.valid_to !== undefined &&
        input.valid_from > input.valid_to
      ) {
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          'valid_from πρέπει να είναι πριν από valid_to.'
        );
      }

      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const role = await withTenantSchema(request, async (tx) => {
        // Verify party exists
        const partyCheck = await tx<IdRow[]>`
          SELECT id FROM party
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          LIMIT 1
        `;

        if (partyCheck[0] === undefined) return null;

        const rows = await tx<PartyRoleRow[]>`
          INSERT INTO party_role (party_id, role, valid_from, valid_to, notes)
          VALUES (
            ${id}::uuid,
            ${input.role}::tenant_template.party_role_kind_t,
            ${input.valid_from ?? null},
            ${input.valid_to ?? null},
            ${input.notes ?? null}
          )
          RETURNING id, party_id, role, valid_from, valid_to, notes, created_at
        `;

        const inserted = rows[0];
        if (inserted === undefined) {
          throw Object.assign(new Error('INSERT party_role returned no row'), { code: 'DB_ERROR' });
        }

        // Audit (Invariant #2 — append-only INSERT)
        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'party.role.add',
             'party_role',
             ${inserted.id},
             ${JSON.stringify({
               party_id: id,
               role: input.role,
               valid_from: input.valid_from ?? null,
               valid_to: input.valid_to ?? null,
             })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return inserted;
      });

      if (role === null) {
        return errResponse(reply, 404, 'PARTY_NOT_FOUND', 'Ο φάκελος δεν βρέθηκε.');
      }

      return reply.code(201).send({ data: role });
    }
  );
};

export default fp(partiesRoutes, { name: 'parties-routes' });
