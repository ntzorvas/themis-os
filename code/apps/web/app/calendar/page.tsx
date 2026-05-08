/**
 * /calendar — Κεντρική σελίδα Ημερολογίου
 *
 * RSC: φορτώνει events server-side.
 * Client: CalendarPageClient handles month nav, new event modal.
 *
 * Invariant #10: Greek labels.
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CalendarPageClient } from './page-client';
import type { CalendarEventsResponse } from '@/types/calendar';
import { serverFetch } from '@/lib/api-client-server';

export const metadata: Metadata = {
  title: 'Ημερολόγιο',
};

const EMPTY_EVENTS_RESPONSE: CalendarEventsResponse = {
  data: [],
  meta: { total: 0, page: 1, per_page: 200 },
};

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchCalendarEvents(
  from: string,
  to: string
): Promise<CalendarEventsResponse> {
  const params = new URLSearchParams({ from, to, per_page: '200' });

  try {
    const response = await serverFetch(`/api/v1/calendar/events?${params}`, {
      next: { revalidate: 0 },
    });

    if (!response.ok) throw new Error(`API responded ${response.status}`);
    return response.json() as Promise<CalendarEventsResponse>;
  } catch {
    return EMPTY_EVENTS_RESPONSE;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageProps {
  searchParams: Promise<{
    year?: string;
    month?: string;
    event_type?: string;
    matter_id?: string;
  }>;
}

export default async function CalendarPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const now = new Date();
  const year = params.year ? parseInt(params.year, 10) : now.getFullYear();
  const month = params.month ? parseInt(params.month, 10) - 1 : now.getMonth();

  // Fetch 3 months window for smooth navigation
  const from = new Date(year, month - 1, 1).toISOString().split('T')[0]!;
  const to = new Date(year, month + 2, 0).toISOString().split('T')[0]!;

  const eventsResponse = await fetchCalendarEvents(from, to);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <div
            aria-label="Φόρτωση ημερολογίου…"
            className="h-96 animate-pulse rounded-xl bg-gray-100"
          />
        }
      >
        <CalendarPageClient
          eventsResponse={eventsResponse}
          initialYear={year}
          initialMonth={month}
        />
      </Suspense>
    </main>
  );
}
