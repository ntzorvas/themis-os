/**
 * /matters/[id]/documents — Έγγραφα Υπόθεσης
 *
 * Server Component — φορτώνει list εγγράφων server-side.
 * Client components: DocumentUploader (XHR progress), DocumentsTable (delete).
 *
 * Invariant #9: download → /api/v1/documents/:id/content (server decrypt)
 * Invariant #10: Greek labels everywhere
 */

import { Suspense } from 'react';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { Metadata } from 'next';
import { DocumentsPageClient } from './page-client';
import type { DocumentsListResponse } from '@/types/documents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchDocuments(
  matterId: string,
  firmSlug: string | null
): Promise<DocumentsListResponse> {
  const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';

  const requestHeaders = new Headers();
  requestHeaders.set('Content-Type', 'application/json');
  if (firmSlug !== null) requestHeaders.set('x-firm-slug', firmSlug);

  try {
    const response = await fetch(
      `${apiUrl}/api/v1/documents?matter_id=${encodeURIComponent(matterId)}&limit=50`,
      {
        headers: requestHeaders,
        next: { revalidate: 0 },  // documents always fresh
      }
    );

    if (!response.ok) throw new Error(`API responded ${response.status}`);
    return response.json() as Promise<DocumentsListResponse>;
  } catch {
    // Graceful fallback
    return { data: [], meta: { total: 0, page: 1, per_page: 50 } };
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Έγγραφα — Υπόθεση ${id.slice(0, 8)}` };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DocumentsPage({ params }: PageProps) {
  const { id: matterId } = await params;

  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const documentsResponse = await fetchDocuments(matterId, firmSlug);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/matters" className="hover:text-gray-800">
          Υποθέσεις
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/matters/${matterId}`} className="hover:text-gray-800">
          Υπόθεση
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-gray-800">Έγγραφα</span>
      </nav>

      <Suspense
        fallback={
          <div
            aria-label="Φόρτωση εγγράφων…"
            className="h-64 animate-pulse rounded-xl bg-gray-100"
          />
        }
      >
        <DocumentsPageClient
          matterId={matterId}
          firmSlug={firmSlug}
          initialResponse={documentsResponse}
        />
      </Suspense>
    </main>
  );
}
