/**
 * /calendar — Κεντρική σελίδα Ημερολογίου
 *
 * RSC: φορτώνει events server-side.
 * Client: CalendarPageClient handles month nav, new event modal.
 *
 * Invariant #10: Greek labels.
 */

import { Suspense } from 'react';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { CalendarPageClient } from './page-client';
import type { CalendarEventsResponse } from '@/types/calendar';
import { MOCK_EVENTS } from '@/types/calendar';

export const metadata: Metadata = {
  title: 'Ημερολόγιο',
};

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchCalendarEvents(
  firmSlug: string | null,
  from: string,
  to: string
): Promise<CalendarEventsResponse> {
  const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';

  const reqHeaders = new Headers();
  reqHeaders.set('Content-Type', 'application/json');
  if (firmSlug !== null) reqHeaders.set('x-firm-slug', firmSlug);

  const params = new URLSearchParams({ from, to, per_page: '200' });

  try {
    const response = await fetch(`${apiUrl}/api/v1/calendar/events?${params}`, {
      headers: reqHeaders,
      next: { revalidate: 0 },
    });

    if (!response.ok) throw new Error(`API responded ${response.status}`);
    return response.json() as Promise<CalendarEventsResponse>;
  } catch {
    // Backend not ready — mock fallback
    return {
      data: MOCK_EVENTS,
      meta: { total: MOCK_EVENTS.length, page: 1, per_page: 200 },
    };
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
  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const now = new Date();
  const year = params.year ? parseInt(params.year, 10) : now.getFullYear();
  const month = params.month ? parseInt(params.month, 10) - 1 : now.getMonth();

  // Fetch 3 months window for smooth navigation
  const from = new Date(year, month - 1, 1).toISOString().split('T')[0]!;
  const to = new Date(year, month + 2, 0).toISOString().split('T')[0]!;

  const eventsResponse = await fetchCalendarEvents(firmSlug, from, to);

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
