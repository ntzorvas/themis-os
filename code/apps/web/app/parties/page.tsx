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
import { serverFetch } from '@/lib/api-client-server';

export const metadata: Metadata = {
  title: 'Συμβαλλόμενοι',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PER_PAGE = 20;

const EMPTY_RESPONSE: PartiesListResponse = {
  data: [],
  meta: { total: 0, page: 1, per_page: PER_PAGE },
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
}

async function fetchParties(
  opts: FetchPartiesOptions
): Promise<PartiesListResponse> {
  const { offset = 0, limit = PER_PAGE, ...filters } = opts;

  const params = new URLSearchParams();
  if (filters.role) params.set('role', filters.role);
  if (filters.party_type) params.set('party_type', filters.party_type);
  if (filters.is_attorney) params.set('is_attorney', filters.is_attorney);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.order) params.set('order', filters.order);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  try {
    const res = await serverFetch(`/api/v1/parties?${params.toString()}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) throw new Error(`API responded ${res.status}`);
    return res.json() as Promise<PartiesListResponse>;
  } catch {
    return EMPTY_RESPONSE;
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

  const partiesResponse = await fetchParties({
    ...(role !== undefined && { role }),
    ...(partyType !== undefined && { party_type: partyType }),
    ...(isAttorney !== undefined && { is_attorney: isAttorney }),
    ...(params.sort !== undefined && { sort: params.sort }),
    ...(params.order !== undefined && { order: params.order }),
    offset,
    limit: PER_PAGE,
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
      </div>
    </main>
  );
}
