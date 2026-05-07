'use client';

/**
 * DocumentsPageClient — Client Component
 *
 * Manages local state για το document list + upload dialog.
 * Οι server actions (fetch) γίνονται στο parent Server Component.
 * Αυτό το component χειρίζεται:
 *   - Show/hide του uploader
 *   - Optimistic add μετά successful upload
 *   - Pass-through deletion callbacks
 */

import { useState, useCallback } from 'react';
import { DocumentUploader } from '@/components/documents/document-uploader';
import { DocumentsTable } from '@/components/documents/documents-table';
import type { Document, DocumentsListResponse } from '@/types/documents';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DocumentsPageClientProps {
  matterId: string;
  firmSlug: string | null;
  initialResponse: DocumentsListResponse;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DocumentsPageClient({
  matterId,
  firmSlug,
  initialResponse,
}: DocumentsPageClientProps) {
  const [showUploader, setShowUploader] = useState(false);
  const [localResponse, setLocalResponse] = useState<DocumentsListResponse>(initialResponse);

  const handleUploadSuccess = useCallback((doc: Document) => {
    setLocalResponse((prev) => ({
      data: [doc, ...prev.data],
      meta: { ...prev.meta, total: prev.meta.total + 1 },
    }));
    setShowUploader(false);
  }, []);

  const handleDeleted = useCallback((documentId: string) => {
    setLocalResponse((prev) => ({
      data: prev.data.filter((d) => d.id !== documentId),
      meta: { ...prev.meta, total: Math.max(0, prev.meta.total - 1) },
    }));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Έγγραφα</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {localResponse.meta.total}{' '}
            {localResponse.meta.total === 1 ? 'έγγραφο' : 'έγγραφα'} — κρυπτογραφημένα στο R2
          </p>
        </div>

        {!showUploader && (
          <button
            type="button"
            onClick={() => setShowUploader(true)}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            + Ανάρτηση Εγγράφου
          </button>
        )}
      </div>

      {/* Uploader panel */}
      {showUploader && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-800">Ανάρτηση Νέου Εγγράφου</h2>
          <DocumentUploader
            matterId={matterId}
            firmSlug={firmSlug}
            onSuccess={handleUploadSuccess}
            onCancel={() => setShowUploader(false)}
          />
        </div>
      )}

      {/* Documents list */}
      <DocumentsTable
        response={localResponse}
        firmSlug={firmSlug}
        onDeleted={handleDeleted}
      />

      {process.env['NODE_ENV'] !== 'production' && (
        <p className="text-center text-xs text-gray-400">
          Encryption: AES-256-GCM envelope · R2 mock mode αν R2_* env vars απουσιάζουν
        </p>
      )}
    </div>
  );
}
