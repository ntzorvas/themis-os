/**
 * /invoices — Σελίδα Τιμολογίων
 * Server Component — data server-side, φίλτρα μέσω search params.
 *
 * Invariant #10: Greek labels everywhere
 */

import { Suspense } from 'react';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { InvoicesClient } from './invoices-client';
import {
  INVOICE_STATUSES,
  type InvoicesListResponse,
  type InvoiceStatus,
} from '@/types/billing';
import { formatEur } from '@/lib/currency';

export const metadata: Metadata = {
  title: 'Τιμολόγια',
};

const PER_PAGE = 20;

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_RESPONSE: InvoicesListResponse = {
  data: [
    {
      id: 'inv-0000-0000-0000-000000000001',
      invoice_number: 'INV-2026-001',
      matter_id: '10000000-0000-0000-0000-000000000001',
      bill_to_party_id: 'p-0000-0000-0000-000000000001',
      status: 'issued',
      invoice_date: '2026-04-01',
      due_date: '2026-05-01',
      subtotal_eur_cents: 49500,
      vat_rate_pct: 24,
      vat_amount_eur_cents: 11880,
      total_eur_cents: 61380,
      paid_eur_cents: 0,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      matter_title: 'Αγωγή Παπαδόπουλου κατά ΑΛΦΑ ΑΕ',
      matter_number: 'MAT-2026-001',
      party_display_name: 'Παπαδόπουλος Κωνσταντίνος',
    },
    {
      id: 'inv-0000-0000-0000-000000000002',
      invoice_number: 'INV-2026-002',
      matter_id: '10000000-0000-0000-0000-000000000002',
      bill_to_party_id: 'p-0000-0000-0000-000000000002',
      status: 'paid',
      invoice_date: '2026-03-15',
      due_date: '2026-04-15',
      subtotal_eur_cents: 120000,
      vat_rate_pct: 24,
      vat_amount_eur_cents: 28800,
      total_eur_cents: 148800,
      paid_eur_cents: 148800,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      matter_title: 'Σύμβαση Εξαγοράς ΒΗΤΑ ΑΕ',
      matter_number: 'MAT-2026-002',
      party_display_name: 'ΑΛΦΑ ΑΕ',
    },
  ],
  meta: { total: 2, page: 1, per_page: PER_PAGE },
};

// ---------------------------------------------------------------------------
// Server fetch
// ---------------------------------------------------------------------------

async function fetchInvoices(
  params: URLSearchParams,
  firmSlug: string | null
): Promise<InvoicesListResponse> {
  const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';
  const reqHeaders = new Headers();
  reqHeaders.set('Content-Type', 'application/json');
  if (firmSlug) reqHeaders.set('x-firm-slug', firmSlug);

  try {
    const res = await fetch(
      `${apiUrl}/api/v1/invoices?${params.toString()}`,
      { headers: reqHeaders, next: { revalidate: 30 } }
    );
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json() as Promise<InvoicesListResponse>;
  } catch {
    return MOCK_RESPONSE;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageSearchParams {
  matter_id?: string;
  bill_to_party_id?: string;
  status?: string;
  from?: string;
  to?: string;
  offset?: string;
}

interface InvoicesPageProps {
  searchParams: Promise<PageSearchParams>;
}

export default async function InvoicesPage({
  searchParams,
}: InvoicesPageProps) {
  const params = await searchParams;
  const offset = Math.max(0, parseInt(params.offset ?? '0', 10) || 0);

  const statusRaw = params.status;
  const status =
    statusRaw !== undefined &&
    (INVOICE_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as InvoiceStatus)
      : undefined;

  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const urlParams = new URLSearchParams();
  if (params.matter_id) urlParams.set('matter_id', params.matter_id);
  if (params.bill_to_party_id) urlParams.set('bill_to_party_id', params.bill_to_party_id);
  if (status) urlParams.set('status', status);
  if (params.from) urlParams.set('from', params.from);
  if (params.to) urlParams.set('to', params.to);
  urlParams.set('limit', String(PER_PAGE));
  urlParams.set('offset', String(offset));

  const response = await fetchInvoices(urlParams, firmSlug);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <div className="h-96 animate-pulse rounded-xl bg-gray-100" />
        }
      >
        <InvoicesClient
          response={response}
          perPage={PER_PAGE}
          formatEur={formatEur}
        />
      </Suspense>
    </main>
  );
}
