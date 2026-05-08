/**
 * /time-entries — Σελίδα Καταχωρήσεων Χρόνου
 * Server Component — data φορτώνεται server-side, φίλτρα μέσω search params.
 *
 * Invariant #10: Greek labels everywhere
 * Currency: ΠΑΝΤΑ cents — ΠΟΤΕ float
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TimeEntriesClient } from './time-entries-client';
import {
  TIME_ENTRY_STATUSES,
  type TimeEntriesListResponse,
  type TimeEntryStatus,
} from '@/types/billing';
import { formatEur, formatDuration } from '@/lib/currency';
import { serverFetch } from '@/lib/api-client-server';

export const metadata: Metadata = {
  title: 'Καταχωρήσεις Χρόνου',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PER_PAGE = 20;

const EMPTY_RESPONSE: TimeEntriesListResponse = {
  data: [],
  meta: { total: 0, page: 1, per_page: PER_PAGE },
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
}

async function fetchTimeEntries(
  opts: FetchTimeEntriesOptions
): Promise<TimeEntriesListResponse> {
  const { offset = 0, limit = PER_PAGE, ...filters } = opts;

  const params = new URLSearchParams();
  if (filters.matter_id) params.set('matter_id', filters.matter_id);
  if (filters.billable) params.set('billable', filters.billable);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  try {
    const res = await serverFetch(`/api/v1/time-entries?${params.toString()}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json() as Promise<TimeEntriesListResponse>;
  } catch {
    return EMPTY_RESPONSE;
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

  const response = await fetchTimeEntries({
    ...(params.matter_id && { matter_id: params.matter_id }),
    ...(params.billable && { billable: params.billable }),
    ...(status && { status }),
    ...(params.from && { from: params.from }),
    ...(params.to && { to: params.to }),
    offset,
    limit: PER_PAGE,
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
