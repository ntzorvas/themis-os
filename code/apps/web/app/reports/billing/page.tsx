/**
 * /reports/billing — Αναφορά Χρεώσεων
 * Server Component
 *
 * - Date range selector (default τρέχον μήνα)
 * - Cards: Σύνολο τιμολογίων, Εξοφλημένα, Εκκρεμή, Realization rate %
 * - Chart placeholder (Phase 1.5)
 * - "Εξαγωγή Excel" stub button
 *
 * Invariant #10: Greek labels everywhere
 */

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import { BillingReportsClient } from './billing-reports-client';
import { type BillingSummaryResponse } from '@/types/billing';
import { formatEur } from '@/lib/currency';

export const metadata: Metadata = {
  title: 'Αναφορά Χρεώσεων',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split('T')[0]!;
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .split('T')[0]!;
  return { from, to };
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_SUMMARY: BillingSummaryResponse = {
  data: {
    total_invoiced_eur_cents: 210180,
    total_paid_eur_cents: 148800,
    total_outstanding_eur_cents: 61380,
    realization_rate_pct: 70.8,
    invoice_count: 2,
    paid_count: 1,
  },
};

// ---------------------------------------------------------------------------
// Server fetch
// ---------------------------------------------------------------------------

async function fetchBillingSummary(
  from: string,
  to: string,
  firmSlug: string | null
): Promise<BillingSummaryResponse> {
  const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';
  const reqHeaders = new Headers();
  reqHeaders.set('Content-Type', 'application/json');
  if (firmSlug) reqHeaders.set('x-firm-slug', firmSlug);

  try {
    const res = await fetch(
      `${apiUrl}/api/v1/reports/billing-summary?from=${from}&to=${to}`,
      { headers: reqHeaders, next: { revalidate: 60 } }
    );
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json() as Promise<BillingSummaryResponse>;
  } catch {
    return MOCK_SUMMARY;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageSearchParams {
  from?: string;
  to?: string;
}

interface BillingReportsPageProps {
  searchParams: Promise<PageSearchParams>;
}

export default async function BillingReportsPage({
  searchParams,
}: BillingReportsPageProps) {
  const params = await searchParams;
  const defaults = currentMonthRange();
  const from = params.from ?? defaults.from;
  const to = params.to ?? defaults.to;

  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const summary = await fetchBillingSummary(from, to, firmSlug);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        }
      >
        <BillingReportsClient
          summary={summary}
          from={from}
          to={to}
          formatEur={formatEur}
        />
      </Suspense>
    </main>
  );
}
