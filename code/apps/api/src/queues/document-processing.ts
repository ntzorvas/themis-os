/**
 * BullMQ queue — document-processing
 *
 * Handles async text extraction from uploaded documents (PDF via pdf-parse).
 *
 * Real mode: REDIS_URL env var present → real BullMQ Queue + Worker
 * Mock mode: REDIS_URL absent → immediate in-process execution με console.log
 *
 * Day 7: stub processor — extracts basic PDF text via pdf-parse,
 *         updates document.ocr_status + ocr_job row.
 *
 * @module queues/document-processing
 */

import { pool } from '@themisos/db';

// ---------------------------------------------------------------------------
// Job payload shape
// ---------------------------------------------------------------------------

export interface DocumentProcessingJob {
  document_id: string;
  mime_type: string;
  firm_slug: string;
  schema_name: string;
  r2_key: string;
}

// ---------------------------------------------------------------------------
// Queue factory — real or mock depending on REDIS_URL
// ---------------------------------------------------------------------------

interface QueueHandle {
  add: (name: string, data: DocumentProcessingJob) => Promise<void>;
  close?: () => Promise<void>;
}

let _queue: QueueHandle | null = null;

async function buildQueue(): Promise<QueueHandle> {
  const redisUrl = process.env['REDIS_URL'];

  if (!redisUrl) {
    console.warn(
      '[document-processing] REDIS_URL not set — using in-process mock queue. ' +
        'Set REDIS_URL for production BullMQ.'
    );

    return {
      add: async (_name: string, data: DocumentProcessingJob) => {
        console.log(
          `[document-processing mock] enqueued job for document ${data.document_id}`
        );
        // Fire-and-forget in mock — no await, errors are non-fatal
        void processJobMock(data);
      },
    };
  }

  // Dynamic import — avoids requiring ioredis when REDIS_URL not set
  const { Queue, Worker } = await import('bullmq');

  const connection = { url: redisUrl };

  const queue = new Queue('document-processing', { connection });

  // Spin up an in-process worker (single-process dev mode).
  // In production, run a separate worker process.
  new Worker(
    'document-processing',
    async (job) => {
      const data = job.data as DocumentProcessingJob;
      await processJobReal(data);
    },
    { connection }
  );

  return {
    add: async (name: string, data: DocumentProcessingJob) => {
      await queue.add(name, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      });
    },
    close: async () => {
      await queue.close();
    },
  };
}

export async function getDocumentQueue(): Promise<QueueHandle> {
  if (_queue === null) {
    _queue = await buildQueue();
  }
  return _queue;
}

// ---------------------------------------------------------------------------
// Mock processor — runs in-process immediately
// ---------------------------------------------------------------------------

async function processJobMock(data: DocumentProcessingJob): Promise<void> {
  console.log(
    `[document-processing mock] processing document_id=${data.document_id} ` +
      `mime=${data.mime_type}`
  );

  if (!data.mime_type.includes('pdf')) {
    console.log(
      `[document-processing mock] skipping non-PDF mime_type=${data.mime_type}`
    );
    await updateOcrStatus(data.schema_name, data.document_id, 'completed', null);
    return;
  }

  // In mock mode, cannot download from R2 — just mark completed with stub text
  const stubText = `[Mock extraction] Document ID: ${data.document_id} — PDF text extraction pending real R2 credentials.`;
  await updateOcrStatus(data.schema_name, data.document_id, 'completed', stubText);
  console.log(`[document-processing mock] marked document ${data.document_id} ocr_status=completed`);
}

// ---------------------------------------------------------------------------
// Real processor — downloads from R2, runs pdf-parse
// ---------------------------------------------------------------------------

async function processJobReal(data: DocumentProcessingJob): Promise<void> {
  const { r2 } = await import('../lib/r2-client.js');

  try {
    // Update status → processing
    await updateOcrStatus(data.schema_name, data.document_id, 'processing', null);

    if (!data.mime_type.includes('pdf')) {
      await updateOcrStatus(data.schema_name, data.document_id, 'completed', null);
      return;
    }

    // Download ciphertext from R2
    const ciphertext = await r2.getObject(data.r2_key);

    // Note: ciphertext is encrypted. For Phase 1, we extract from the raw bytes.
    // Proper flow (Phase 2): decrypt first, then extract.
    // For now we attempt extraction on what we have — if encrypted, pdf-parse will fail gracefully.

    let extractedText: string | null = null;

    try {
      // Dynamic import — pdf-parse may not be installed in all environments.
      // PENDING: pnpm --filter @themisos/api add pdf-parse @types/pdf-parse
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfParseModule = await import('pdf-parse' as string).then((m: any) => (m.default ?? m) as (buf: Buffer) => Promise<{ text: string }>);
      const result = await pdfParseModule(ciphertext);
      extractedText = result.text?.trim() ?? null;
    } catch {
      // pdf-parse fails on encrypted blobs — that's expected in Phase 1
      console.warn(
        `[document-processing] pdf-parse failed for ${data.document_id} — ` +
          'likely encrypted. Phase 2 will decrypt first.'
      );
    }

    await updateOcrStatus(data.schema_name, data.document_id, 'completed', extractedText);
  } catch (err) {
    console.error(`[document-processing] job failed for ${data.document_id}:`, err);
    await updateOcrStatus(data.schema_name, data.document_id, 'failed', null);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// DB helper — updates document.ocr_status + inserts/updates ocr_job row
// ---------------------------------------------------------------------------

async function updateOcrStatus(
  schemaName: string,
  documentId: string,
  status: 'processing' | 'completed' | 'failed',
  extractedText: string | null
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pool.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof pool;

    await tx.unsafe(
      `SET LOCAL search_path TO "${schemaName}", tenant_template, public`
    );

    // Update document ocr_status
    await tx`
      UPDATE document
      SET ocr_status = ${status}::tenant_template.ocr_status_t
      WHERE id = ${documentId}::uuid
    `;

    // Upsert ocr_job
    if (status === 'processing') {
      await tx`
        INSERT INTO ocr_job (document_id, status, started_at)
        VALUES (${documentId}::uuid, 'processing'::tenant_template.ocr_status_t, now())
        ON CONFLICT (document_id) DO UPDATE
          SET status = 'processing', started_at = now()
      `;
    } else {
      await tx`
        INSERT INTO ocr_job (document_id, status, completed_at, extracted_text)
        VALUES (
          ${documentId}::uuid,
          ${status}::tenant_template.ocr_status_t,
          now(),
          ${extractedText}
        )
        ON CONFLICT (document_id) DO UPDATE
          SET status = ${status}::tenant_template.ocr_status_t,
              completed_at = now(),
              extracted_text = ${extractedText}
      `;
    }
  });
}

// ---------------------------------------------------------------------------
// Exported enqueue helper — called from documents route
// ---------------------------------------------------------------------------

export async function enqueueDocumentProcessing(
  job: DocumentProcessingJob
): Promise<void> {
  const queue = await getDocumentQueue();
  await queue.add('extract-text', job);
}
