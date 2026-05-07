/**
 * /expenses — Σελίδα Εξόδων
 * Server Component — data server-side, φίλτρα μέσω search params.
 *
 * Invariant #10: Greek labels everywhere
 * Currency: ΠΑΝΤΑ cents — ΠΟΤΕ float
 */

import { Suspense } from 'react';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { ExpensesClient } from './expenses-client';
import { type ExpensesListResponse } from '@/types/billing';
import { formatEur } from '@/lib/currency';

export const metadata: Metadata = {
  title: 'Έξοδα',
};

const PER_PAGE = 20;

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_RESPONSE: ExpensesListResponse = {
  data: [
    {
      id: 'exp-0000-0000-0000-000000000001',
      matter_id: '10000000-0000-0000-0000-000000000001',
      user_id: 'u-0000-0000-0000-000000000001',
      expense_type: 'court_fee',
      amount_eur_cents: 15000,
      description: 'Παράβολο κατάθεσης αγωγής',
      incurred_at: new Date('2026-04-28').toISOString(),
      document_id: null,
      status: 'draft',
      invoice_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      matter_title: 'Αγωγή Παπαδόπουλου κατά ΑΛΦΑ ΑΕ',
      matter_number: 'MAT-2026-001',
    },
    {
      id: 'exp-0000-0000-0000-000000000002',
      matter_id: '10000000-0000-0000-0000-000000000002',
      user_id: 'u-0000-0000-0000-000000000001',
      expense_type: 'other',
      amount_eur_cents: 28000,
      description: 'Συμβολαιογραφικά έξοδα',
      incurred_at: new Date('2026-04-27').toISOString(),
      document_id: null,
      status: 'draft',
      invoice_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      matter_title: 'Σύμβαση Εξαγοράς ΒΗΤΑ ΑΕ',
      matter_number: 'MAT-2026-002',
    },
  ],
  meta: { total: 2, page: 1, per_page: PER_PAGE },
};

// ---------------------------------------------------------------------------
// Server fetch
// ---------------------------------------------------------------------------

async function fetchExpenses(
  params: URLSearchParams,
  firmSlug: string | null
): Promise<ExpensesListResponse> {
  const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';
  const reqHeaders = new Headers();
  reqHeaders.set('Content-Type', 'application/json');
  if (firmSlug) reqHeaders.set('x-firm-slug', firmSlug);

  try {
    const res = await fetch(
      `${apiUrl}/api/v1/expenses?${params.toString()}`,
      { headers: reqHeaders, next: { revalidate: 30 } }
    );
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json() as Promise<ExpensesListResponse>;
  } catch {
    return MOCK_RESPONSE;
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

  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const urlParams = new URLSearchParams();
  if (params.matter_id) urlParams.set('matter_id', params.matter_id);
  if (params.status) urlParams.set('status', params.status);
  if (params.from) urlParams.set('from', params.from);
  if (params.to) urlParams.set('to', params.to);
  urlParams.set('limit', String(PER_PAGE));
  urlParams.set('offset', String(offset));

  const response = await fetchExpenses(urlParams, firmSlug);

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
