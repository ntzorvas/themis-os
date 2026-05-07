/**
 * /matters/[id] — Σελίδα Λεπτομερειών Υπόθεσης
 * Server Component — φορτώνει matter + parties server-side.
 *
 * Tabs:
 *   - Στοιχεία (info): τίτλος, τύπος, κατάσταση, ημερομηνίες, δικαστήριο
 *   - Συμβαλλόμενοι: MatterPartiesTab (client, CRUD)
 *   - Έγγραφα: DocumentsPageClient (Day 7 — upload + list)
 *   - Χρονολόγιο: stub (Day 8)
 *
 * Invariant #10: Greek labels everywhere
 */

import { Suspense } from 'react';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { Metadata } from 'next';
import type { DocumentsListResponse } from '@/types/documents';
import {
  MATTER_STATUS_LABELS,
  MATTER_STATUS_COLORS,
  MATTER_TYPE_LABELS,
  type Matter,
  type MatterPartiesResponse,
} from '@/types/matters';
import { MatterDetailTabs } from '@/components/matters/matter-detail-tabs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('el-GR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchMatter(
  id: string,
  firmSlug: string | null
): Promise<Matter | null> {
  const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';

  const requestHeaders = new Headers();
  requestHeaders.set('Content-Type', 'application/json');
  if (firmSlug !== null) requestHeaders.set('x-firm-slug', firmSlug);

  try {
    const response = await fetch(`${apiUrl}/api/v1/matters/${id}`, {
      headers: requestHeaders,
      next: { revalidate: 60 },
    });

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`API responded ${response.status}`);

    const json = (await response.json()) as { data: Matter };
    return json.data;
  } catch {
    // Mock fallback — αφαιρείται όταν backend είναι stable
    return {
      id,
      matter_number: 'MAT-2026-MOCK',
      title: 'Υπόθεση (mock)',
      matter_type: 'litigation',
      status: 'active',
      opened_at: new Date().toISOString(),
      closed_at: null,
      lead_attorney_user_id: null,
      practice_area: null,
      court: null,
      court_case_number: null,
      privilege_level: 'standard',
      estimated_value_eur_cents: null,
      billing_method: 'hourly',
      retainer_balance_eur_cents: 0,
      statute_of_limitations: null,
      legal_hold: false,
      ethical_wall: false,
      notes: null,
      custom_fields: {},
      tags: [],
      department_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}

async function fetchMatterParties(
  id: string,
  firmSlug: string | null
): Promise<MatterPartiesResponse> {
  const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';

  const requestHeaders = new Headers();
  requestHeaders.set('Content-Type', 'application/json');
  if (firmSlug !== null) requestHeaders.set('x-firm-slug', firmSlug);

  try {
    const response = await fetch(`${apiUrl}/api/v1/matters/${id}/parties`, {
      headers: requestHeaders,
      next: { revalidate: 30 },
    });

    if (!response.ok) throw new Error(`API responded ${response.status}`);
    return response.json() as Promise<MatterPartiesResponse>;
  } catch {
    return { data: [], meta: { total: 0, page: 1, per_page: 20 } };
  }
}

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
        next: { revalidate: 0 },
      }
    );

    if (!response.ok) throw new Error(`API responded ${response.status}`);
    return response.json() as Promise<DocumentsListResponse>;
  } catch {
    return { data: [], meta: { total: 0, page: 1, per_page: 50 } };
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');
  const matter = await fetchMatter(id, firmSlug);

  return {
    title: matter?.title ?? 'Υπόθεση',
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function MatterDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tab = 'info' } = await searchParams;

  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  // Fetch matter + parties + documents in parallel
  const [matter, partiesResponse, documentsResponse] = await Promise.all([
    fetchMatter(id, firmSlug),
    fetchMatterParties(id, firmSlug),
    fetchDocuments(id, firmSlug),
  ]);

  if (matter === null) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="rounded-xl border border-red-100 bg-red-50 p-8 text-center">
          <h1 className="text-xl font-semibold text-red-800">
            Υπόθεση δεν βρέθηκε
          </h1>
          <p className="mt-2 text-sm text-red-600">
            Το αναγνωριστικό <code className="font-mono">{id}</code> δεν
            αντιστοιχεί σε καμία υπόθεση.
          </p>
          <Link
            href="/matters"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline"
            aria-label="Επιστροφή στη λίστα υποθέσεων"
          >
            ← Επιστροφή στη λίστα
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-2 text-sm text-gray-500">
          <li>
            <Link
              href="/matters"
              className="hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 rounded"
              aria-label="Υποθέσεις"
            >
              Υποθέσεις
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li className="font-medium text-gray-900" aria-current="page">
            {matter.title}
          </li>
        </ol>
      </nav>

      <div className="space-y-6">
        {/* Summary card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">
                  {matter.title}
                </h1>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                    MATTER_STATUS_COLORS[matter.status]
                  )}
                  aria-label={`Κατάσταση: ${MATTER_STATUS_LABELS[matter.status]}`}
                >
                  {MATTER_STATUS_LABELS[matter.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {MATTER_TYPE_LABELS[matter.matter_type]}
                {matter.matter_number && (
                  <span className="ml-2 font-mono text-xs text-gray-400">
                    #{matter.matter_number}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Quick details row */}
          <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Ημ/νία Άνοιξης
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {formatDate(matter.opened_at)}
              </dd>
            </div>

            {matter.closed_at && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Ημ/νία Κλεισίματος
                </dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {formatDate(matter.closed_at)}
                </dd>
              </div>
            )}

            {matter.court && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Δικαστήριο
                </dt>
                <dd className="mt-1 text-sm text-gray-900">{matter.court}</dd>
              </div>
            )}

            {matter.court_case_number && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  ΑΡ.ΚΑΤ.
                </dt>
                <dd className="mt-1 font-mono text-sm text-gray-900">
                  {matter.court_case_number}
                </dd>
              </div>
            )}

            {matter.practice_area && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Κλάδος Δικαίου
                </dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {matter.practice_area}
                </dd>
              </div>
            )}

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Εμπιστευτικότητα
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {matter.privilege_level === 'privileged'
                  ? 'Εμπιστευτική'
                  : 'Κανονική'}
              </dd>
            </div>
          </dl>

          {matter.notes && (
            <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Σημειώσεις
              </p>
              <p className="mt-1 text-sm text-gray-700 whitespace-pre-line">
                {matter.notes}
              </p>
            </div>
          )}
        </div>

        {/* Tab panel — client component handles tab switching */}
        <Suspense
          fallback={
            <div
              aria-label="Φόρτωση καρτελών…"
              className="h-64 animate-pulse rounded-xl bg-gray-100"
            />
          }
        >
          <MatterDetailTabs
            matterId={id}
            initialTab={tab}
            partiesResponse={partiesResponse}
            documentsResponse={documentsResponse}
            firmSlug={firmSlug}
            matter={matter}
          />
        </Suspense>
      </div>
    </main>
  );
}
