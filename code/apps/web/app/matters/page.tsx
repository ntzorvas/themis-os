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
import { headers } from 'next/headers';
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

export const metadata: Metadata = {
  title: 'Υποθέσεις',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PER_PAGE = 20;

// Fallback mock data — χρησιμοποιείται αν το backend δεν είναι ακόμα διαθέσιμο
const MOCK_RESPONSE: MattersListResponse = {
  data: [
    {
      id: '10000000-0000-0000-0000-000000000001',
      matter_number: 'MAT-2026-001',
      title: 'Αγωγή Παπαδόπουλου κατά ΑΛΦΑ ΑΕ',
      matter_type: 'litigation',
      status: 'active',
      opened_at: new Date('2026-01-15').toISOString(),
      closed_at: null,
      lead_attorney_user_id: null,
      practice_area: 'Εμπορικό Δίκαιο',
      court: 'Πρωτοδικείο Αθηνών',
      court_case_number: '1234/2026',
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
      party_count: 3,
    },
    {
      id: '10000000-0000-0000-0000-000000000002',
      matter_number: 'MAT-2026-002',
      title: 'Σύμβαση Εξαγοράς ΒΗΤΑ ΑΕ',
      matter_type: 'transactional',
      status: 'prospective',
      opened_at: new Date('2026-03-01').toISOString(),
      closed_at: null,
      lead_attorney_user_id: null,
      practice_area: null,
      court: null,
      court_case_number: null,
      privilege_level: 'standard',
      estimated_value_eur_cents: 50000000,
      billing_method: 'fixed',
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
      party_count: 2,
    },
  ],
  meta: {
    total: 2,
    page: 1,
    per_page: PER_PAGE,
  },
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
  firmSlug: string | null;
}

async function fetchMatters(
  opts: FetchMattersOptions
): Promise<MattersListResponse> {
  const { firmSlug, offset = 0, limit = PER_PAGE, ...filters } = opts;

  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.matter_type) params.set('matter_type', filters.matter_type);
  if (filters.assigned_to_user_id)
    params.set('assigned_to_user_id', filters.assigned_to_user_id);
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
      `${apiUrl}/api/v1/matters?${params.toString()}`,
      {
        headers: requestHeaders,
        next: { revalidate: 30 },
      }
    );

    if (!response.ok) {
      throw new Error(`API responded ${response.status}`);
    }

    return response.json() as Promise<MattersListResponse>;
  } catch {
    // Backend παρατηρεί ακόμα — graceful degradation με mock data
    return MOCK_RESPONSE;
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

  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const mattersResponse = await fetchMatters({
    ...(status !== undefined && { status }),
    ...(matterType !== undefined && { matter_type: matterType }),
    ...(params.assigned_to_user_id !== undefined && {
      assigned_to_user_id: params.assigned_to_user_id,
    }),
    offset,
    limit: PER_PAGE,
    firmSlug,
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

        {process.env['NODE_ENV'] !== 'production' && (
          <p className="text-center text-xs text-gray-400">
            * Mock data — backend integration pending
          </p>
        )}
      </div>
    </main>
  );
}
