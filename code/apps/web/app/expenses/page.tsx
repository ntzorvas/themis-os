/**
 * /expenses — Σελίδα Εξόδων
 * Server Component — data server-side, φίλτρα μέσω search params.
 *
 * Invariant #10: Greek labels everywhere
 * Currency: ΠΑΝΤΑ cents — ΠΟΤΕ float
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ExpensesClient } from './expenses-client';
import { type ExpensesListResponse } from '@/types/billing';
import { formatEur } from '@/lib/currency';
import { serverFetch } from '@/lib/api-client-server';

export const metadata: Metadata = {
  title: 'Έξοδα',
};

const PER_PAGE = 20;

const EMPTY_RESPONSE: ExpensesListResponse = {
  data: [],
  meta: { total: 0, page: 1, per_page: PER_PAGE },
};

// ---------------------------------------------------------------------------
// Server fetch
// ---------------------------------------------------------------------------

async function fetchExpenses(
  params: URLSearchParams
): Promise<ExpensesListResponse> {
  try {
    const res = await serverFetch(`/api/v1/expenses?${params.toString()}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json() as Promise<ExpensesListResponse>;
  } catch {
    return EMPTY_RESPONSE;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageSearchParams {
  matter_id?: string;
  status?: string;
  from?: string;
  to?: string;
  offset?: string;
}

interface ExpensesPageProps {
  searchParams: Promise<PageSearchParams>;
}

export default async function ExpensesPage({
  searchParams,
}: ExpensesPageProps) {
  const params = await searchParams;
  const offset = Math.max(0, parseInt(params.offset ?? '0', 10) || 0);

  const urlParams = new URLSearchParams();
  if (params.matter_id) urlParams.set('matter_id', params.matter_id);
  if (params.status) urlParams.set('status', params.status);
  if (params.from) urlParams.set('from', params.from);
  if (params.to) urlParams.set('to', params.to);
  urlParams.set('limit', String(PER_PAGE));
  urlParams.set('offset', String(offset));

  const response = await fetchExpenses(urlParams);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <div className="h-96 animate-pulse rounded-xl bg-gray-100" />
        }
      >
        <ExpensesClient
          response={response}
          perPage={PER_PAGE}
          formatEur={formatEur}
        />
      </Suspense>
    </main>
  );
}
