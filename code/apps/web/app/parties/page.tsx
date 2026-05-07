/**
 * /parties — Σελίδα Συμβαλλομένων
 * Server Component — δεδομένα φορτώνονται server-side, φίλτρα μέσω search params.
 *
 * Invariant #2: Unified Party Model (ΟΧΙ separate Clients page)
 * Invariant #10: Greek labels everywhere
 *
 * Routing: app/parties/page.tsx (public route group)
 * Auth guard: middleware ανακατευθύνει σε /login αν δεν υπάρχει session
 */

import { Suspense } from 'react';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { PartiesFilterBar } from '@/components/parties/parties-filter-bar';
import { PartiesTable } from '@/components/parties/parties-table';
import { PartiesHeader } from '@/components/parties/parties-header';
import {
  PARTY_ROLES,
  type PartiesListResponse,
  type PartyRole,
  type PartyType,
} from '@/types/parties';

export const metadata: Metadata = {
  title: 'Συμβαλλόμενοι',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PER_PAGE = 20;

// Fallback mock data — χρησιμοποιείται αν το backend δεν είναι ακόμα διαθέσιμο
const MOCK_RESPONSE: PartiesListResponse = {
  data: [
    {
      id: '00000000-0000-0000-0000-000000000001',
      display_name: 'Νικόλαος Παπαδόπουλος',
      party_type: 'natural',
      afm: '094259216',
      is_attorney: false,
      roles: ['client'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      display_name: 'ΑΛΦΑ ΝΟΜΙΚΗ ΑΕ',
      party_type: 'legal',
      afm: null,
      is_attorney: false,
      roles: ['counterparty'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      display_name: 'Ελένη Δημητρίου',
      party_type: 'natural',
      afm: null,
      is_attorney: true,
      roles: ['attorney', 'counsel'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  meta: {
    total: 3,
    page: 1,
    per_page: PER_PAGE,
  },
};

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

interface FetchPartiesOptions {
  role?: string;
  party_type?: string;
  is_attorney?: string;
  sort?: string;
  order?: string;
  offset?: number;
  limit?: number;
  firmSlug: string | null;
}

async function fetchParties(
  opts: FetchPartiesOptions
): Promise<PartiesListResponse> {
  const { firmSlug, offset = 0, limit = PER_PAGE, ...filters } = opts;

  const params = new URLSearchParams();
  if (filters.role) params.set('role', filters.role);
  if (filters.party_type) params.set('party_type', filters.party_type);
  if (filters.is_attorney) params.set('is_attorney', filters.is_attorney);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.order) params.set('order', filters.order);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const apiUrl =
    process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';

  const requestHeaders = new Headers();
  requestHeaders.set('Content-Type', 'application/json');
  if (firmSlug !== null) {
    requestHeaders.set('x-firm-slug', firmSlug);
  }

  try {
    const response = await fetch(
      `${apiUrl}/api/v1/parties?${params.toString()}`,
      {
        headers: requestHeaders,
        next: { revalidate: 30 },
      }
    );

    if (!response.ok) {
      // Backend unavailable — fall through to mock
      throw new Error(`API responded ${response.status}`);
    }

    return response.json() as Promise<PartiesListResponse>;
  } catch {
    // Backend παρατηρεί ακόμα — επιστρέφουμε mock data (graceful degradation)
    // TODO Day 6: remove mock fallback when backend is stable
    return MOCK_RESPONSE;
  }
}

// ---------------------------------------------------------------------------
// Search params type
// ---------------------------------------------------------------------------

interface PageSearchParams {
  role?: string;
  party_type?: string;
  is_attorney?: string;
  sort?: string;
  order?: string;
  offset?: string;
  q?: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PartiesPageProps {
  searchParams: Promise<PageSearchParams>;
}

export default async function PartiesPage({ searchParams }: PartiesPageProps) {
  const params = await searchParams;

  // Validate role against known values to prevent injection
  const roleRaw = params.role;
  const role =
    roleRaw !== undefined &&
    (PARTY_ROLES as readonly string[]).includes(roleRaw)
      ? (roleRaw as PartyRole)
      : undefined;

  const partyType =
    params.party_type === 'natural' || params.party_type === 'legal'
      ? (params.party_type as PartyType)
      : undefined;

  const isAttorney =
    params.is_attorney === 'true' || params.is_attorney === 'false'
      ? params.is_attorney
      : undefined;

  const offset = Math.max(0, parseInt(params.offset ?? '0', 10) || 0);

  // Read firm slug from middleware-injected header
  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const partiesResponse = await fetchParties({
    ...(role !== undefined && { role }),
    ...(partyType !== undefined && { party_type: partyType }),
    ...(isAttorney !== undefined && { is_attorney: isAttorney }),
    ...(params.sort !== undefined && { sort: params.sort }),
    ...(params.order !== undefined && { order: params.order }),
    offset,
    limit: PER_PAGE,
    firmSlug,
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-6">
        {/* Header with "Νέο Συμβαλλόμενο" button (client, owns dialog state) */}
        <PartiesHeader totalCount={partiesResponse.meta.total} />

        {/* Search hint */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="space-y-4">
            {/* Filter bar — client component (URL state) wrapped in Suspense */}
            <Suspense
              fallback={
                <div
                  aria-label="Φόρτωση φίλτρων…"
                  className="h-10 animate-pulse rounded-lg bg-gray-100"
                />
              }
            >
              <PartiesFilterBar />
            </Suspense>
          </div>
        </div>

        {/* Table — client component (pagination) */}
        <Suspense
          fallback={
            <div
              aria-label="Φόρτωση λίστας…"
              className="h-64 animate-pulse rounded-xl bg-gray-100"
            />
          }
        >
          <PartiesTable response={partiesResponse} perPage={PER_PAGE} />
        </Suspense>

        {/* Mock data notice — αφαιρείται Day 6 */}
        {process.env['NODE_ENV'] !== 'production' && (
          <p className="text-center text-xs text-gray-400">
            * Mock data — backend integration pending (Day 6)
          </p>
        )}
      </div>
    </main>
  );
}
