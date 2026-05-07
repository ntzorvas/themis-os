'use client';

/**
 * DocumentUploader — drag-drop file uploader με XHR progress tracking
 *
 * Χρησιμοποιεί XHR (ΟΧΙ fetch) για να υποστηρίζει upload progress events.
 * Multipart form: fields = file, matter_id, doc_type, description
 *
 * Props:
 *   matterId   — injected from parent (required για backend tenant safety)
 *   firmSlug   — για x-firm-slug header
 *   onSuccess  — callback με νέο Document
 *   onCancel   — callback για κλείσιμο
 */

import { useCallback, useRef, useState } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  type DocType,
  type Document,
} from '@/types/documents';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/tiff': 'TIFF',
  'text/plain': 'TXT',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DocumentUploaderProps {
  matterId: string;
  firmSlug: string | null;
  onSuccess: (doc: Document) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DocumentUploader({
  matterId,
  firmSlug,
  onSuccess,
  onCancel,
}: DocumentUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocType>('other');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // File selection
  // -------------------------------------------------------------------------

  const validateAndSet = useCallback((file: File): boolean => {
    if (!ALLOWED_MIME_TYPES[file.type]) {
      setError(
        `Μη υποστηριζόμενος τύπος αρχείου: ${file.type}. ` +
          `Επιτρεπτά: ${Object.values(ALLOWED_MIME_TYPES).join(', ')}.`
      );
      return false;
    }
    if (file.size > MAX_SIZE) {
      setError(`Το αρχείο υπερβαίνει το μέγεθος 50MB (${formatBytes(file.size)}).`);
      return false;
    }
    setError(null);
    setSelectedFile(file);
    return true;
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file !== undefined) validateAndSet(file);
    },
    [validateAndSet]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragActive(false);
  }, []);

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file !== undefined) validateAndSet(file);
    },
    [validateAndSet]
  );

  // -------------------------------------------------------------------------
  // Upload via XHR (for progress events)
  // -------------------------------------------------------------------------

  const handleUpload = useCallback(() => {
    if (selectedFile === null) return;

    setUploading(true);
    setProgress(0);
    setError(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('matter_id', matterId);
    formData.append('doc_type', docType);
    if (description.trim() !== '') {
      formData.append('description', description.trim());
    }

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      setUploading(false);
      if (xhr.status === 201) {
        try {
          const json = JSON.parse(xhr.responseText) as { data: Document };
          onSuccess(json.data);
        } catch {
          setError('Μη αναμενόμενη απόκριση από τον διακομιστή.');
        }
      } else {
        try {
          const json = JSON.parse(xhr.responseText) as {
            error?: { message?: string };
          };
          setError(json.error?.message ?? `Σφάλμα ${xhr.status}`);
        } catch {
          setError(`Σφάλμα ανάρτησης: HTTP ${xhr.status}`);
        }
      }
    });

    xhr.addEventListener('error', () => {
      setUploading(false);
      setError('Αποτυχία σύνδεσης με τον διακομιστή.');
    });

    xhr.addEventListener('abort', () => {
      setUploading(false);
      setError('Η ανάρτηση ακυρώθηκε.');
    });

    const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
    xhr.open('POST', `${apiUrl}/api/v1/documents`);
    if (firmSlug !== null) {
      xhr.setRequestHeader('x-firm-slug', firmSlug);
    }
    xhr.send(formData);
  }, [selectedFile, matterId, docType, description, firmSlug, onSuccess]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Περιοχή αναρτήσεως εγγράφου"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors',
          dragActive
            ? 'border-primary-500 bg-primary-50'
            : selectedFile !== null
              ? 'border-green-400 bg-green-50'
              : 'border-gray-300 bg-white hover:border-gray-400'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={Object.keys(ALLOWED_MIME_TYPES).join(',')}
          onChange={handleInputChange}
          aria-hidden="true"
        />

        {selectedFile !== null ? (
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-800">{selectedFile.name}</p>
            <p className="text-xs text-gray-500">
              {formatBytes(selectedFile.size)} · {ALLOWED_MIME_TYPES[selectedFile.type] ?? selectedFile.type}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedFile(null);
                setError(null);
                if (inputRef.current !== null) inputRef.current.value = '';
              }}
              className="mt-1 text-xs text-red-500 underline hover:text-red-700"
            >
              Αφαίρεση
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-700">
              Σύρε αρχείο εδώ ή{' '}
              <span className="text-primary-600 underline">κάνε κλικ για επιλογή</span>
            </p>
            <p className="text-xs text-gray-400">
              PDF, DOC, DOCX, XLS, XLSX, JPEG, PNG, TIFF, TXT — έως 50MB
            </p>
          </div>
        )}
      </div>

      {/* Doc type */}
      <div>
        <label
          htmlFor="doc-type-select"
          className="block text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          Τύπος Εγγράφου
        </label>
        <select
          id="doc-type-select"
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocType)}
          className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          disabled={uploading}
        >
          {DOC_TYPES.map((dt) => (
            <option key={dt} value={dt}>
              {DOC_TYPE_LABELS[dt]}
            </option>
          ))}
        </select>
      </div>

      {/* Description (optional) */}
      <div>
        <label
          htmlFor="doc-description"
          className="block text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          Περιγραφή <span className="text-gray-400 font-normal">(προαιρετικό)</span>
        </label>
        <input
          id="doc-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder="π.χ. Αγωγή πρώτης έκδοσης 2026-04-29"
          className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          disabled={uploading}
        />
      </div>

      {/* Progress bar */}
      {uploading && (
        <div aria-live="polite" aria-label={`Ανάρτηση ${progress}%`}>
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>Ανάρτηση…</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-primary-500 transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error !== null && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={uploading}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Ακύρωση
        </button>
        <button
          type="button"
          onClick={handleUpload}
          disabled={selectedFile === null || uploading}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? 'Ανάρτηση…' : 'Ανάρτηση'}
        </button>
      </div>
    </div>
  );
}
