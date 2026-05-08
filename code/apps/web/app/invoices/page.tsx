/**
 * /invoices — Σελίδα Τιμολογίων
 * Server Component — data server-side, φίλτρα μέσω search params.
 *
 * Invariant #10: Greek labels everywhere
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { InvoicesClient } from './invoices-client';
import {
  INVOICE_STATUSES,
  type InvoicesListResponse,
  type InvoiceStatus,
} from '@/types/billing';
import { formatEur } from '@/lib/currency';
import { serverFetch } from '@/lib/api-client-server';

export const metadata: Metadata = {
  title: 'Τιμολόγια',
};

const PER_PAGE = 20;

const EMPTY_RESPONSE: InvoicesListResponse = {
  data: [],
  meta: { total: 0, page: 1, per_page: PER_PAGE },
};

// ---------------------------------------------------------------------------
// Server fetch
// ---------------------------------------------------------------------------

async function fetchInvoices(
  params: URLSearchParams
): Promise<InvoicesListResponse> {
  try {
    const res = await serverFetch(`/api/v1/invoices?${params.toString()}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json() as Promise<InvoicesListResponse>;
  } catch {
    return EMPTY_RESPONSE;
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

  const urlParams = new URLSearchParams();
  if (params.matter_id) urlParams.set('matter_id', params.matter_id);
  if (params.bill_to_party_id)
    urlParams.set('bill_to_party_id', params.bill_to_party_id);
  if (status) urlParams.set('status', status);
  if (params.from) urlParams.set('from', params.from);
  if (params.to) urlParams.set('to', params.to);
  urlParams.set('limit', String(PER_PAGE));
  urlParams.set('offset', String(offset));

  const response = await fetchInvoices(urlParams);

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
