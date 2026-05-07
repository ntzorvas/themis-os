/**
 * Documents routes — /api/v1/documents/*
 *
 * Implements document upload, listing, metadata, content streaming,
 * versioning, and soft deletion. All content is encrypted before R2 upload.
 *
 * Endpoints:
 *   POST   /api/v1/documents              — multipart upload (≤50MB)
 *   GET    /api/v1/documents              — list με matter_id filter (required)
 *   GET    /api/v1/documents/:id          — metadata only
 *   PATCH  /api/v1/documents/:id          — update description/doc_type only
 *   GET    /api/v1/documents/:id/content  — server-side decrypt + stream plaintext
 *   DELETE /api/v1/documents/:id          — soft delete (keeps R2 blob)
 *   GET    /api/v1/documents/:id/versions — document_version history
 *
 * Invariants enforced:
 *   #6   withTenantSchema wraps every query — NEVER cross-tenant
 *   #9   NEVER store plaintext in R2 — always encryptDocumentForR2 first
 *   #2   ALL mutations write to audit_log (append-only, INSERT only)
 *
 * @module routes/documents
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import '@fastify/multipart';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { withTenantSchema } from '../../plugins/fastify-tenant.js';
import { r2 } from '../../lib/r2-client.js';
import { encryptDocumentForR2, decryptDocumentFromR2 } from '@themisos/crypto';
import type { JsonEnvelope } from '@themisos/crypto';
import { enqueueDocumentProcessing } from '../../queues/document-processing.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const VALID_DOC_TYPES = [
  'pleading', 'contract', 'correspondence', 'evidence',
  'court_decision', 'internal_note', 'template', 'other',
] as const;
type DocTypeKind = (typeof VALID_DOC_TYPES)[number];

const VALID_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'text/plain',
]);

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

const PatchDocumentSchema = z
  .object({
    description: z.string().max(1000).optional(),
    doc_type: z.enum(VALID_DOC_TYPES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Τουλάχιστον ένα πεδίο απαιτείται για ενημέρωση.',
  });

type PatchDocumentInput = z.infer<typeof PatchDocumentSchema>;

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface DocumentRow {
  id: string;
  matter_id: string | null;
  party_id: string | null;
  title: string;
  doc_type: string;
  mime_type: string | null;
  size_bytes: string | null;
  r2_key: string;
  sha256: string | null;
  version: number;
  parent_document_id: string | null;
  is_privileged: boolean;
  storage_mode: string;
  ocr_status: string;
  uploaded_by_user_id: string | null;
  created_at: Date;
  soft_deleted_at: Date | null;
  envelope_metadata: JsonEnvelope | null;
}

interface DocumentVersionRow {
  id: string;
  document_id: string;
  version: number;
  r2_key: string;
  sha256: string | null;
  size_bytes: string | null;
  change_note: string | null;
  uploaded_by_user_id: string | null;
  created_at: Date;
}

interface CountRow {
  count: string;
}

interface VersionMaxRow {
  max_version: number | null;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const documentsRoutes: FastifyPluginAsync = async (fastify) => {
  // ======================================================================
  // POST /api/v1/documents — multipart upload
  // ======================================================================

  fastify.post(
    '/api/v1/documents',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.firmContext;
      if (ctx === null) {
        return errResponse(reply, 401, 'TENANT_REQUIRED', 'Firm context απαιτείται.');
      }

      // Parse multipart
      let fileBuffer: Buffer | null = null;
      let originalFilename = 'document';
      let mimeType = 'application/octet-stream';
      let matterId: string | null = null;
      let docType: DocTypeKind | null = null;
      let description: string | null = null;
      let parentDocumentId: string | null = null;

      try {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'file') {
            mimeType = part.mimetype;
            originalFilename = part.filename ?? 'document';
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) {
              chunks.push(chunk);
            }
            fileBuffer = Buffer.concat(chunks);
          } else if (part.type === 'field') {
            const value = String(part.value ?? '');
            if (part.fieldname === 'matter_id') matterId = value || null;
            if (part.fieldname === 'doc_type') docType = value as DocTypeKind;
            if (part.fieldname === 'description') description = value || null;
            if (part.fieldname === 'parent_document_id') parentDocumentId = value || null;
          }
        }
      } catch {
        return errResponse(reply, 400, 'MULTIPART_ERROR', 'Σφάλμα ανάλυσης multipart.');
      }

      // Validations
      if (fileBuffer === null) {
        return errResponse(reply, 400, 'VALIDATION_ERROR', 'Το πεδίο "file" είναι υποχρεωτικό.');
      }

      if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
        return errResponse(
          reply,
          413,
          'FILE_TOO_LARGE',
          'Το αρχείο υπερβαίνει το όριο των 50MB.'
        );
      }

      if (!VALID_MIME_TYPES.has(mimeType)) {
        return errResponse(
          reply,
          415,
          'UNSUPPORTED_MIME_TYPE',
          `Μη υποστηριζόμενος τύπος αρχείου: ${mimeType}.`
        );
      }

      if (docType === null || !(VALID_DOC_TYPES as ReadonlyArray<string>).includes(docType)) {
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          `doc_type είναι υποχρεωτικό. Έγκυρες τιμές: ${VALID_DOC_TYPES.join(', ')}.`
        );
      }

      if (matterId === null) {
        return errResponse(reply, 400, 'VALIDATION_ERROR', 'matter_id είναι υποχρεωτικό.');
      }

      const { firmId, firmSlug, schemaName } = ctx;
      const actorUserId = ctx.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      // Compute sha256 of plaintext
      const sha256 = createHash('sha256').update(fileBuffer).digest('hex');

      // Encrypt before R2 upload (Invariant #9 — NEVER plaintext in R2)
      let ciphertext: Buffer;
      let envelope: JsonEnvelope | null;
      let storageMode: 'r2_sse_c' | 'ddk_aes_gcm';

      try {
        const result = await encryptDocumentForR2(fileBuffer, firmSlug, 'confidential');
        ciphertext = result.ciphertext;
        envelope = result.envelope;
        // Map storageMode from crypto layer to DB enum
        storageMode = result.storageMode === 'plain' ? 'r2_sse_c' : 'ddk_aes_gcm';
      } catch (err) {
        fastify.log.error(err, 'encryptDocumentForR2 failed');
        return errResponse(reply, 500, 'ENCRYPTION_ERROR', 'Αποτυχία κρυπτογράφησης εγγράφου.');
      }

      // Determine version number
      let versionNumber = 1;
      if (parentDocumentId !== null) {
        // Read parent's current version
        const parentVersionResult = await withTenantSchema(request, async (tx) => {
          return tx<VersionMaxRow[]>`
            SELECT version AS max_version FROM document
            WHERE id = ${parentDocumentId}::uuid AND soft_deleted_at IS NULL
            LIMIT 1
          `;
        });
        const parentRow = parentVersionResult[0];
        if (parentRow === undefined || parentRow.max_version === null) {
          return errResponse(reply, 404, 'PARENT_NOT_FOUND', 'Το parent document δεν βρέθηκε.');
        }
        versionNumber = parentRow.max_version + 1;
      }

      // Generate document_id (UUID generated by DB, but we need it for R2 key pre-flight)
      // Use crypto.randomUUID for consistency
      const { randomUUID } = await import('node:crypto');
      const documentId = randomUUID();

      // R2 keys
      const r2Key = `firms/${firmId}/documents/${documentId}.bin`;
      const envelopeKey = `firms/${firmId}/documents/${documentId}.envelope.json`;

      // Upload ciphertext to R2
      try {
        await r2.uploadObject(r2Key, ciphertext, 'application/octet-stream');

        // Upload envelope JSON alongside (alternative to storing in DB JSONB)
        // We store in BOTH DB (envelope_metadata) AND R2 for redundancy
        if (envelope !== null) {
          const envelopeBuffer = Buffer.from(JSON.stringify(envelope), 'utf8');
          await r2.uploadObject(envelopeKey, envelopeBuffer, 'application/json');
        }
      } catch (err) {
        fastify.log.error(err, 'R2 upload failed');
        return errResponse(reply, 502, 'R2_UPLOAD_ERROR', 'Αποτυχία ανάρτησης στο R2.');
      }

      // DB insert inside tenant schema
      const document = await withTenantSchema(request, async (tx) => {
        // Verify matter_id belongs to this firm (cross-firm document protection)
        if (matterId !== null) {
          const matterCheck = await tx`
            SELECT id FROM matter
            WHERE id = ${matterId}::uuid AND soft_deleted_at IS NULL
            LIMIT 1
          `;
          if (matterCheck.length === 0) {
            throw Object.assign(
              new Error('matter_id δεν βρέθηκε ή δεν ανήκει σε αυτό το γραφείο.'),
              { code: 'MATTER_NOT_FOUND', statusCode: 404 }
            );
          }
        }

        // INSERT document with pre-generated UUID
        const rows = await tx<DocumentRow[]>`
          INSERT INTO document
            (id, matter_id, title, doc_type, mime_type, size_bytes, r2_key,
             sha256, version, parent_document_id, storage_mode,
             uploaded_by_user_id, envelope_metadata)
          VALUES
            (${documentId}::uuid,
             ${matterId}::uuid,
             ${originalFilename},
             ${docType}::tenant_template.doc_type_t,
             ${mimeType},
             ${fileBuffer!.length},
             ${r2Key},
             ${sha256},
             ${versionNumber},
             ${parentDocumentId ?? null}::uuid,
             ${storageMode}::tenant_template.storage_mode_t,
             ${actorUserId}::uuid,
             ${envelope !== null ? JSON.stringify(envelope) : null}::jsonb)
          RETURNING
            id, matter_id, party_id, title, doc_type, mime_type, size_bytes,
            r2_key, sha256, version, parent_document_id, is_privileged,
            storage_mode, ocr_status, uploaded_by_user_id, created_at,
            soft_deleted_at, envelope_metadata
        `;

        const inserted = rows[0];
        if (inserted === undefined) {
          throw Object.assign(new Error('INSERT document returned no row'), { code: 'DB_ERROR' });
        }

        // INSERT document_version (immutable history)
        await tx`
          INSERT INTO document_version
            (document_id, version, r2_key, sha256, size_bytes,
             change_note, uploaded_by_user_id)
          VALUES
            (${documentId}::uuid,
             ${versionNumber},
             ${r2Key},
             ${sha256},
             ${fileBuffer!.length},
             ${description},
             ${actorUserId}::uuid)
        `;

        // Audit (Invariant #2)
        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'document.upload',
             'document',
             ${documentId},
             ${JSON.stringify({
               matter_id: matterId,
               doc_type: docType,
               size_bytes: fileBuffer!.length,
               version: versionNumber,
               storage_mode: storageMode,
             })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return inserted;
      });

      // Enqueue OCR/text extraction (fire-and-forget)
      try {
        await enqueueDocumentProcessing({
          document_id: documentId,
          mime_type: mimeType,
          firm_slug: firmSlug,
          schema_name: schemaName,
          r2_key: r2Key,
        });
      } catch (err) {
        // Non-fatal — log and continue
        fastify.log.warn(err, 'Failed to enqueue document-processing job');
      }

      return reply.code(201).send({ data: sanitizeDocument(document) });
    }
  );

  // ======================================================================
  // GET /api/v1/documents — list
  // matter_id required (tenant safety)
  // ======================================================================

  fastify.get(
    '/api/v1/documents',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;

      const matterId = query['matter_id'];
      if (matterId === undefined || matterId.trim() === '') {
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          'matter_id είναι υποχρεωτικό για λόγους ασφάλειας tenant.'
        );
      }

      const docTypeFilter = query['doc_type'];
      if (docTypeFilter !== undefined && !(VALID_DOC_TYPES as ReadonlyArray<string>).includes(docTypeFilter)) {
        return errResponse(
          reply,
          400,
          'INVALID_DOC_TYPE',
          `Μη έγκυρο doc_type. Έγκυρες τιμές: ${VALID_DOC_TYPES.join(', ')}.`
        );
      }

      const rawLimit = parseInt(query['limit'] ?? String(DEFAULT_LIMIT), 10);
      const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
      const rawOffset = parseInt(query['offset'] ?? '0', 10);
      const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

      const typedDocType = (docTypeFilter as DocTypeKind | undefined) ?? null;

      const { rows, total } = await withTenantSchema(request, async (tx) => {
        const [countRows, dataRows] = await Promise.all([
          tx<CountRow[]>`
            SELECT count(*)::text AS count
            FROM document
            WHERE matter_id = ${matterId}::uuid
              AND soft_deleted_at IS NULL
              AND (
                ${typedDocType}::text IS NULL
                OR doc_type = ${typedDocType}::tenant_template.doc_type_t
              )
          `,
          tx<DocumentRow[]>`
            SELECT
              id, matter_id, party_id, title, doc_type, mime_type, size_bytes,
              r2_key, sha256, version, parent_document_id, is_privileged,
              storage_mode, ocr_status, uploaded_by_user_id, created_at,
              soft_deleted_at, envelope_metadata
            FROM document
            WHERE matter_id = ${matterId}::uuid
              AND soft_deleted_at IS NULL
              AND (
                ${typedDocType}::text IS NULL
                OR doc_type = ${typedDocType}::tenant_template.doc_type_t
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
        data: rows.map(sanitizeDocument),
        meta: {
          total,
          page: Math.floor(offset / limit) + 1,
          per_page: limit,
        },
      });
    }
  );

  // ======================================================================
  // GET /api/v1/documents/:id — metadata only
  // ======================================================================

  fastify.get(
    '/api/v1/documents/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const doc = await withTenantSchema(request, async (tx) => {
        const rows = await tx<DocumentRow[]>`
          SELECT
            id, matter_id, party_id, title, doc_type, mime_type, size_bytes,
            r2_key, sha256, version, parent_document_id, is_privileged,
            storage_mode, ocr_status, uploaded_by_user_id, created_at,
            soft_deleted_at, envelope_metadata
          FROM document
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (doc === null) {
        return errResponse(reply, 404, 'DOCUMENT_NOT_FOUND', 'Το έγγραφο δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: sanitizeDocument(doc) });
    }
  );

  // ======================================================================
  // PATCH /api/v1/documents/:id — update description/doc_type only
  // Content versioning is done via POST with parent_document_id
  // ======================================================================

  fastify.patch(
    '/api/v1/documents/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parseResult = PatchDocumentSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          400,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input: PatchDocumentInput = parseResult.data;
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const updated = await withTenantSchema(request, async (tx) => {
        const rows = await tx<DocumentRow[]>`
          UPDATE document SET
            doc_type   = COALESCE(${input.doc_type ?? null}::tenant_template.doc_type_t, doc_type),
            title      = COALESCE(${input.description ?? null}, title)
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          RETURNING
            id, matter_id, party_id, title, doc_type, mime_type, size_bytes,
            r2_key, sha256, version, parent_document_id, is_privileged,
            storage_mode, ocr_status, uploaded_by_user_id, created_at,
            soft_deleted_at, envelope_metadata
        `;

        const row = rows[0];
        if (row === undefined) return null;

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'document.update',
             'document',
             ${id},
             ${JSON.stringify({ updated_fields: Object.keys(input) })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return row;
      });

      if (updated === null) {
        return errResponse(reply, 404, 'DOCUMENT_NOT_FOUND', 'Το έγγραφο δεν βρέθηκε.');
      }

      return reply.code(200).send({ data: sanitizeDocument(updated) });
    }
  );

  // ======================================================================
  // GET /api/v1/documents/:id/content — server-side decrypt + stream
  // INVARIANT #9: NEVER return ciphertext to client
  // ======================================================================

  fastify.get(
    '/api/v1/documents/:id/content',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const ctx = request.firmContext;
      if (ctx === null) {
        return errResponse(reply, 401, 'TENANT_REQUIRED', 'Firm context απαιτείται.');
      }

      const doc = await withTenantSchema(request, async (tx) => {
        const rows = await tx<DocumentRow[]>`
          SELECT
            id, matter_id, title, mime_type, r2_key, storage_mode,
            soft_deleted_at, envelope_metadata, is_privileged
          FROM document
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (doc === null) {
        return errResponse(reply, 404, 'DOCUMENT_NOT_FOUND', 'Το έγγραφο δεν βρέθηκε.');
      }

      // Download ciphertext from R2
      let ciphertext: Buffer;
      try {
        ciphertext = await r2.getObject(doc.r2_key);
      } catch {
        return errResponse(reply, 502, 'R2_FETCH_ERROR', 'Αποτυχία λήψης από R2.');
      }

      // Decrypt
      let plaintext: Buffer;
      try {
        const classification = doc.is_privileged ? 'privileged' : 'confidential';
        plaintext = await decryptDocumentFromR2(
          ciphertext,
          doc.envelope_metadata,
          ctx.firmSlug,
          classification
        );
      } catch (err) {
        fastify.log.error(err, 'decryptDocumentFromR2 failed');
        return errResponse(reply, 500, 'DECRYPTION_ERROR', 'Αποτυχία αποκρυπτογράφησης εγγράφου.');
      }

      // Audit content access
      const actorUserId = ctx.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;
      try {
        await withTenantSchema(request, async (tx) => {
          await tx`
            INSERT INTO audit_log
              (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
            VALUES
              (${actorUserId}::uuid,
               'document.download',
               'document',
               ${id},
               ${JSON.stringify({ size_bytes: plaintext.length })}::jsonb,
               ${request.ip}::inet,
               ${userAgent},
               'success')
          `;
        });
      } catch {
        // Non-fatal
      }

      const filename = doc.title ?? 'document';
      const contentType = doc.mime_type ?? 'application/octet-stream';

      reply
        .code(200)
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
        .header('Content-Length', String(plaintext.length));

      return reply.send(plaintext);
    }
  );

  // ======================================================================
  // DELETE /api/v1/documents/:id — soft delete
  // R2 blob retained for audit (spec: keep for retention period)
  // ======================================================================

  fastify.delete(
    '/api/v1/documents/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const actorUserId = request.firmContext?.userId ?? null;
      const userAgent = request.headers['user-agent'] ?? null;

      const deleted = await withTenantSchema(request, async (tx) => {
        const rows = await tx<{ id: string }[]>`
          UPDATE document
          SET soft_deleted_at = now()
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          RETURNING id
        `;

        const row = rows[0];
        if (row === undefined) return null;

        await tx`
          INSERT INTO audit_log
            (actor_user_id, action, target_type, target_id, payload, ip, user_agent, outcome)
          VALUES
            (${actorUserId}::uuid,
             'document.delete',
             'document',
             ${id},
             ${JSON.stringify({ soft_deleted: true })}::jsonb,
             ${request.ip}::inet,
             ${userAgent},
             'success')
        `;

        return row;
      });

      if (deleted === null) {
        return errResponse(reply, 404, 'DOCUMENT_NOT_FOUND', 'Το έγγραφο δεν βρέθηκε.');
      }

      return reply.code(204).send();
    }
  );

  // ======================================================================
  // GET /api/v1/documents/:id/versions — version history
  // ======================================================================

  fastify.get(
    '/api/v1/documents/:id/versions',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const versions = await withTenantSchema(request, async (tx) => {
        // Verify document exists first
        const docCheck = await tx<{ id: string }[]>`
          SELECT id FROM document
          WHERE id = ${id}::uuid AND soft_deleted_at IS NULL
          LIMIT 1
        `;

        if (docCheck[0] === undefined) return null;

        return tx<DocumentVersionRow[]>`
          SELECT
            id, document_id, version, r2_key, sha256, size_bytes,
            change_note, uploaded_by_user_id, created_at
          FROM document_version
          WHERE document_id = ${id}::uuid
          ORDER BY version DESC
        `;
      });

      if (versions === null) {
        return errResponse(reply, 404, 'DOCUMENT_NOT_FOUND', 'Το έγγραφο δεν βρέθηκε.');
      }

      const sanitizedVersions = versions.map(({ r2_key: _r2, ...v }) => ({
        ...v,
        download_url: `/api/v1/documents/${id}/versions/${v.version}/content`,
      }));

      return reply.code(200).send({ data: sanitizedVersions });
    }
  );
};

// ---------------------------------------------------------------------------
// sanitizeDocument — strip internal fields before sending to client
// envelope_metadata and r2_key are internal implementation details
// ---------------------------------------------------------------------------

function sanitizeDocument(
  doc: DocumentRow
): Omit<DocumentRow, 'envelope_metadata' | 'r2_key'> & {
  download_url: string;
} {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { envelope_metadata, r2_key, ...rest } = doc;
  return {
    ...rest,
    download_url: `/api/v1/documents/${doc.id}/content`,
  };
}

export default fp(documentsRoutes, { name: 'documents-routes' });
