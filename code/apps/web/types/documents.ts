// Documents — shared TypeScript types για το Documents module
// Αναφορά: docs/v03/build-plan-v03.md §Documents + R2 + Encryption
// Invariant #9: NEVER plaintext in R2 — server-side decrypt + stream
// Invariant #10: Greek labels everywhere

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums — mirror DB ENUMs from 0002_template_schema.sql
// ---------------------------------------------------------------------------

export const DOC_TYPES = [
  'pleading',
  'contract',
  'correspondence',
  'evidence',
  'court_decision',
  'internal_note',
  'template',
  'other',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  pleading:       'Δικόγραφο',
  contract:       'Συμβόλαιο',
  correspondence: 'Αλληλογραφία',
  evidence:       'Αποδεικτικό',
  court_decision: 'Δικαστική Απόφαση',
  internal_note:  'Εσωτερική Σημείωση',
  template:       'Πρότυπο',
  other:          'Άλλο',
};

export const DOC_TYPE_COLORS: Record<DocType, string> = {
  pleading:       'bg-blue-100 text-blue-800',
  contract:       'bg-purple-100 text-purple-800',
  correspondence: 'bg-yellow-100 text-yellow-800',
  evidence:       'bg-orange-100 text-orange-800',
  court_decision: 'bg-red-100 text-red-800',
  internal_note:  'bg-gray-100 text-gray-700',
  template:       'bg-teal-100 text-teal-800',
  other:          'bg-slate-100 text-slate-600',
};

export const OCR_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type OcrStatus = (typeof OCR_STATUSES)[number];

export const OCR_STATUS_LABELS: Record<OcrStatus, string> = {
  pending:    'Αναμονή',
  processing: 'Επεξεργασία',
  completed:  'Ολοκληρώθηκε',
  failed:     'Αποτυχία',
};

// ---------------------------------------------------------------------------
// Core document type (returned by API — no ciphertext, no r2_key)
// ---------------------------------------------------------------------------

export const DocumentSchema = z.object({
  id:                   z.string().uuid(),
  matter_id:            z.string().uuid().nullable(),
  party_id:             z.string().uuid().nullable(),
  title:                z.string(),
  doc_type:             z.enum(DOC_TYPES),
  mime_type:            z.string().nullable(),
  size_bytes:           z.string().nullable(),   // bigint returned as string from postgres
  sha256:               z.string().nullable(),
  version:              z.number().int(),
  parent_document_id:   z.string().uuid().nullable(),
  is_privileged:        z.boolean(),
  storage_mode:         z.string(),
  ocr_status:           z.enum(OCR_STATUSES),
  uploaded_by_user_id:  z.string().uuid().nullable(),
  created_at:           z.string(),
  soft_deleted_at:      z.string().nullable(),
  download_url:         z.string(),
});

export type Document = z.infer<typeof DocumentSchema>;

// ---------------------------------------------------------------------------
// API response envelopes
// ---------------------------------------------------------------------------

export interface DocumentsListResponse {
  data: Document[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

export interface DocumentResponse {
  data: Document;
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

export interface DocumentVersion {
  id: string;
  document_id: string;
  version: number;
  r2_key: string;
  sha256: string | null;
  size_bytes: string | null;
  change_note: string | null;
  uploaded_by_user_id: string | null;
  created_at: string;
}

export interface DocumentVersionsResponse {
  data: DocumentVersion[];
}

// ---------------------------------------------------------------------------
// Upload form state
// ---------------------------------------------------------------------------

export interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error';
  progress: number;  // 0-100
  error: string | null;
  document: Document | null;
}
