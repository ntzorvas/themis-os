'use client';

/**
 * DocumentsTable — list εγγράφων με actions (download + soft delete)
 *
 * Actions:
 *   download → GET /api/v1/documents/:id/content (server decrypts + streams)
 *   delete   → DELETE /api/v1/documents/:id (soft delete, confirm πρώτα)
 *
 * Invariant #9: download link → content endpoint (server-side decrypt),
 *               NEVER direct R2 URL.
 */

import { useState, useCallback } from 'react';
import {
  DOC_TYPE_LABELS,
  DOC_TYPE_COLORS,
  OCR_STATUS_LABELS,
  type Document,
  type DocumentsListResponse,
} from '@/types/documents';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function formatBytes(bytesStr: string | null): string {
  if (bytesStr === null) return '—';
  const n = parseInt(bytesStr, 10);
  if (isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('el-GR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DocumentsTableProps {
  response: DocumentsListResponse;
  firmSlug: string | null;
  onDeleted?: (documentId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DocumentsTable({ response, firmSlug, onDeleted }: DocumentsTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [localDocs, setLocalDocs] = useState<Document[]>(response.data);

  const handleDownload = useCallback(
    (doc: Document) => {
      const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
      const url = `${apiUrl}/api/v1/documents/${doc.id}/content`;

      // Open in a new tab — browser handles Content-Disposition download
      // For authenticated endpoints in production, a token-bearing redirect or
      // cookie-based auth is needed. Day 7: header-based via x-firm-slug.
      const a = window.document.createElement('a');
      a.href = url;
      a.setAttribute('download', doc.title ?? 'document');
      // Pass firm slug via query param as fallback (backend reads header OR query)
      if (firmSlug !== null) {
        a.href = `${url}?_firm=${encodeURIComponent(firmSlug)}`;
      }
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
    },
    [firmSlug]
  );

  const handleDelete = useCallback(
    async (doc: Document) => {
      if (!window.confirm(`Διαγραφή εγγράφου "${doc.title}";`)) return;

      setDeletingId(doc.id);

      try {
        const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
        const headers: Record<string, string> = {};
        if (firmSlug !== null) headers['x-firm-slug'] = firmSlug;

        const res = await fetch(`${apiUrl}/api/v1/documents/${doc.id}`, {
          method: 'DELETE',
          headers,
        });

        if (res.status === 204 || res.ok) {
          setLocalDocs((prev) => prev.filter((d) => d.id !== doc.id));
          onDeleted?.(doc.id);
        } else {
          const json = (await res.json()) as { error?: { message?: string } };
          alert(json.error?.message ?? `Σφάλμα ${res.status}`);
        }
      } catch {
        alert('Αποτυχία διαγραφής. Δοκιμάστε ξανά.');
      } finally {
        setDeletingId(null);
      }
    },
    [firmSlug, onDeleted]
  );

  if (localDocs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center">
        <p className="text-sm text-gray-400">Δεν υπάρχουν έγγραφα για αυτή την υπόθεση.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              Αρχείο
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              Τύπος
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              Μέγεθος
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              Ανάρτηση
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              OCR
            </th>
            <th scope="col" className="relative px-4 py-3">
              <span className="sr-only">Ενέργειες</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {localDocs.map((doc) => (
            <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3">
                <div className="max-w-xs">
                  <p className="truncate text-sm font-medium text-gray-800" title={doc.title}>
                    {doc.title}
                  </p>
                  {doc.version > 1 && (
                    <span className="text-xs text-gray-400">v{doc.version}</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    DOC_TYPE_COLORS[doc.doc_type]
                  )}
                >
                  {DOC_TYPE_LABELS[doc.doc_type]}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">
                {formatBytes(doc.size_bytes)}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {formatDate(doc.created_at)}
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    'text-xs',
                    doc.ocr_status === 'completed'
                      ? 'text-green-600'
                      : doc.ocr_status === 'failed'
                        ? 'text-red-500'
                        : 'text-gray-400'
                  )}
                >
                  {OCR_STATUS_LABELS[doc.ocr_status]}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownload(doc)}
                    className="text-xs font-medium text-primary-600 hover:text-primary-800"
                    aria-label={`Λήψη ${doc.title}`}
                  >
                    Λήψη
                  </button>
                  <span className="text-gray-300" aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(doc)}
                    disabled={deletingId === doc.id}
                    className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50"
                    aria-label={`Διαγραφή ${doc.title}`}
                  >
                    {deletingId === doc.id ? 'Διαγραφή…' : 'Διαγραφή'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Footer */}
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-400">
        {response.meta.total} {response.meta.total === 1 ? 'έγγραφο' : 'έγγραφα'} συνολικά
      </div>
    </div>
  );
}
