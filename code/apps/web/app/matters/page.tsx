/**
 * /matters — Σελίδα Υποθέσεων
 * Server Component — δεδομένα φορτώνονται server-side, φίλτρα μέσω search params.
 *
 * Invariant #2: Unified Party Model — parties via matter_party M2M (ΟΧΙ client_id)
 * Invariant #10: Greek labels everywhere
 *
 * Routing: app/matters/page.tsx (public route group)
 * Auth guard: middleware ανακατευθύνει σε /login αν δεν υπάρχει session
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { MattersFilterBar } from '@/components/matters/matters-filter-bar';
import { MattersTable } from '@/components/matters/matters-table';
import { MattersHeader } from '@/components/matters/matters-header';
import {
  MATTER_STATUSES,
  MATTER_TYPES,
  type MattersListResponse,
  type MatterStatus,
  type MatterType,
} from '@/types/matters';
import { serverFetch } from '@/lib/api-client-server';

export const metadata: Metadata = {
  title: 'Υποθέσεις',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PER_PAGE = 20;

const EMPTY_RESPONSE: MattersListResponse = {
  data: [],
  meta: { total: 0, page: 1, per_page: PER_PAGE },
};

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

interface FetchMattersOptions {
  status?: string;
  matter_type?: string;
  assigned_to_user_id?: string;
  offset?: number;
  limit?: number;
}

async function fetchMatters(
  opts: FetchMattersOptions
): Promise<MattersListResponse> {
  const { offset = 0, limit = PER_PAGE, ...filters } = opts;

  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.matter_type) params.set('matter_type', filters.matter_type);
  if (filters.assigned_to_user_id)
    params.set('assigned_to_user_id', filters.assigned_to_user_id);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  try {
    const res = await serverFetch(`/api/v1/matters?${params.toString()}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) throw new Error(`API responded ${res.status}`);
    return res.json() as Promise<MattersListResponse>;
  } catch {
    return EMPTY_RESPONSE;
  }
}

// ---------------------------------------------------------------------------
// Search params type
// ---------------------------------------------------------------------------

interface PageSearchParams {
  status?: string;
  matter_type?: string;
  assigned_to_user_id?: string;
  offset?: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface MattersPageProps {
  searchParams: Promise<PageSearchParams>;
}

export default async function MattersPage({ searchParams }: MattersPageProps) {
  const params = await searchParams;

  // Validate status against known values
  const statusRaw = params.status;
  const status =
    statusRaw !== undefined &&
    (MATTER_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as MatterStatus)
      : undefined;

  // Validate matter_type against known values
  const typeRaw = params.matter_type;
  const matterType =
    typeRaw !== undefined &&
    (MATTER_TYPES as readonly string[]).includes(typeRaw)
      ? (typeRaw as MatterType)
      : undefined;

  const offset = Math.max(0, parseInt(params.offset ?? '0', 10) || 0);

  const mattersResponse = await fetchMatters({
    ...(status !== undefined && { status }),
    ...(matterType !== undefined && { matter_type: matterType }),
    ...(params.assigned_to_user_id !== undefined && {
      assigned_to_user_id: params.assigned_to_user_id,
    }),
    offset,
    limit: PER_PAGE,
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-6">
        {/* Header with "Νέα Υπόθεση" button (client, owns dialog state) */}
        <MattersHeader totalCount={mattersResponse.meta.total} />

        {/* Filter bar */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="space-y-4">
            <Suspense
              fallback={
                <div
                  aria-label="Φόρτωση φίλτρων…"
                  className="h-10 animate-pulse rounded-lg bg-gray-100"
                />
              }
            >
              <MattersFilterBar />
            </Suspense>
          </div>
        </div>

        {/* Table */}
        <Suspense
          fallback={
            <div
              aria-label="Φόρτωση λίστας…"
              className="h-64 animate-pulse rounded-xl bg-gray-100"
            />
          }
        >
          <MattersTable response={mattersResponse} perPage={PER_PAGE} />
        </Suspense>
      </div>
    </main>
  );
}
