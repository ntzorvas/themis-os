/**
 * /time-entries — Σελίδα Καταχωρήσεων Χρόνου
 * Server Component — data φορτώνεται server-side, φίλτρα μέσω search params.
 *
 * Invariant #10: Greek labels everywhere
 * Currency: ΠΑΝΤΑ cents — ΠΟΤΕ float
 */

import { Suspense } from 'react';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { TimeEntriesClient } from './time-entries-client';
import {
  TIME_ENTRY_STATUSES,
  type TimeEntriesListResponse,
  type TimeEntryStatus,
} from '@/types/billing';
import { formatEur, formatDuration } from '@/lib/currency';

export const metadata: Metadata = {
  title: 'Καταχωρήσεις Χρόνου',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PER_PAGE = 20;

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_RESPONSE: TimeEntriesListResponse = {
  data: [
    {
      id: 'te-0000-0000-0000-000000000001',
      matter_id: '10000000-0000-0000-0000-000000000001',
      user_id: 'u-0000-0000-0000-000000000001',
      started_at: new Date('2026-04-29T09:00:00').toISOString(),
      stopped_at: new Date('2026-04-29T11:30:00').toISOString(),
      duration_minutes: 150,
      description: 'Σύνταξη αγωγής',
      billable: true,
      billable_rate_eur_cents: 15000,
      billable_amount_eur_cents: 37500,
      status: 'draft',
      invoice_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      matter_title: 'Αγωγή Παπαδόπουλου κατά ΑΛΦΑ ΑΕ',
      matter_number: 'MAT-2026-001',
      user_display_name: 'Νικόλαος Δικηγόρος',
    },
    {
      id: 'te-0000-0000-0000-000000000002',
      matter_id: '10000000-0000-0000-0000-000000000002',
      user_id: 'u-0000-0000-0000-000000000001',
      started_at: new Date('2026-04-28T14:00:00').toISOString(),
      stopped_at: new Date('2026-04-28T15:00:00').toISOString(),
      duration_minutes: 60,
      description: 'Νομική έρευνα due diligence',
      billable: true,
      billable_rate_eur_cents: 12000,
      billable_amount_eur_cents: 12000,
      status: 'draft',
      invoice_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      matter_title: 'Σύμβαση Εξαγοράς ΒΗΤΑ ΑΕ',
      matter_number: 'MAT-2026-002',
      user_display_name: 'Νικόλαος Δικηγόρος',
    },
  ],
  meta: { total: 2, page: 1, per_page: PER_PAGE },
};

// ---------------------------------------------------------------------------
// Server fetch
// ---------------------------------------------------------------------------

interface FetchTimeEntriesOptions {
  matter_id?: string;
  billable?: string;
  status?: string;
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
  firmSlug: string | null;
}

async function fetchTimeEntries(
  opts: FetchTimeEntriesOptions
): Promise<TimeEntriesListResponse> {
  const { firmSlug, offset = 0, limit = PER_PAGE, ...filters } = opts;

  const params = new URLSearchParams();
  if (filters.matter_id) params.set('matter_id', filters.matter_id);
  if (filters.billable) params.set('billable', filters.billable);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';
  const reqHeaders = new Headers();
  reqHeaders.set('Content-Type', 'application/json');
  if (firmSlug) reqHeaders.set('x-firm-slug', firmSlug);

  try {
    const res = await fetch(
      `${apiUrl}/api/v1/time-entries?${params.toString()}`,
      { headers: reqHeaders, next: { revalidate: 30 } }
    );
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json() as Promise<TimeEntriesListResponse>;
  } catch {
    return MOCK_RESPONSE;
  }
}

// ---------------------------------------------------------------------------
// Search params
// ---------------------------------------------------------------------------

interface PageSearchParams {
  matter_id?: string;
  billable?: string;
  status?: string;
  from?: string;
  to?: string;
  offset?: string;
}

interface TimeEntriesPageProps {
  searchParams: Promise<PageSearchParams>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function TimeEntriesPage({
  searchParams,
}: TimeEntriesPageProps) {
  const params = await searchParams;

  const statusRaw = params.status;
  const status =
    statusRaw !== undefined &&
    (TIME_ENTRY_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as TimeEntryStatus)
      : undefined;

  const offset = Math.max(0, parseInt(params.offset ?? '0', 10) || 0);

  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const response = await fetchTimeEntries({
    ...(params.matter_id && { matter_id: params.matter_id }),
    ...(params.billable && { billable: params.billable }),
    ...(status && { status }),
    ...(params.from && { from: params.from }),
    ...(params.to && { to: params.to }),
    offset,
    limit: PER_PAGE,
    firmSlug,
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <Suspense
          fallback={
            <div className="h-96 animate-pulse rounded-xl bg-gray-100" />
          }
        >
          <TimeEntriesClient
            response={response}
            perPage={PER_PAGE}
            formatEur={formatEur}
            formatDuration={formatDuration}
          />
        </Suspense>
      </div>
    </main>
  );
}
