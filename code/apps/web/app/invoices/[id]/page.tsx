/**
 * /invoices/[id] — Λεπτομέρειες Τιμολογίου
 * Server Component — data server-side.
 *
 * - Header: number, status badge, party, matter, dates
 * - Lines table (read-only όταν issued)
 * - Totals breakdown (subtotal, VAT, total, paid, outstanding)
 * - Actions: Οριστικοποίηση (only draft), Καταγραφή πληρωμής (only issued/partial)
 * - Λήψη PDF — 501 stub (Greek message)
 * - Payments history table
 *
 * Invariant #10: Greek labels everywhere
 */

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { InvoiceDetailClient } from './invoice-detail-client';
import {
  type InvoiceDetailResponse,
  type Invoice,
  type InvoiceLine,
  type Payment,
} from '@/types/billing';
import { formatEur } from '@/lib/currency';

export const metadata: Metadata = {
  title: 'Τιμολόγιο',
};

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function makeMockInvoice(id: string): InvoiceDetailResponse {
  const lines: InvoiceLine[] = [
    {
      id: 'line-001',
      invoice_id: id,
      description: 'Σύνταξη αγωγής (2ω 30λ × 150,00 €)',
      quantity: 1,
      unit_price_eur_cents: 37500,
      line_total_eur_cents: 37500,
      source_type: 'time',
      source_id: 'te-0000-0000-0000-000000000001',
    },
    {
      id: 'line-002',
      invoice_id: id,
      description: 'Παράβολο κατάθεσης αγωγής',
      quantity: 1,
      unit_price_eur_cents: 15000,
      line_total_eur_cents: 15000,
      source_type: 'expense',
      source_id: 'exp-0000-0000-0000-000000000001',
    },
  ];

  const invoice: Invoice & { lines: InvoiceLine[] } = {
    id,
    invoice_number: 'INV-2026-001',
    matter_id: '10000000-0000-0000-0000-000000000001',
    bill_to_party_id: 'p-0000-0000-0000-000000000001',
    status: 'issued',
    invoice_date: '2026-04-01',
    due_date: '2026-05-01',
    subtotal_eur_cents: 52500,
    vat_rate_pct: 24,
    vat_amount_eur_cents: 12600,
    total_eur_cents: 65100,
    paid_eur_cents: 0,
    notes: 'Παρακαλώ εξοφλήστε εντός 30 ημερών.',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    matter_title: 'Αγωγή Παπαδόπουλου κατά ΑΛΦΑ ΑΕ',
    matter_number: 'MAT-2026-001',
    party_display_name: 'Παπαδόπουλος Κωνσταντίνος',
    lines,
  };

  return { data: invoice };
}

const MOCK_PAYMENTS: Payment[] = [];

// ---------------------------------------------------------------------------
// Server fetch
// ---------------------------------------------------------------------------

async function fetchInvoice(
  id: string,
  firmSlug: string | null
): Promise<InvoiceDetailResponse | null> {
  const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';
  const reqHeaders = new Headers();
  reqHeaders.set('Content-Type', 'application/json');
  if (firmSlug) reqHeaders.set('x-firm-slug', firmSlug);

  try {
    const res = await fetch(`${apiUrl}/api/v1/invoices/${id}`, {
      headers: reqHeaders,
      next: { revalidate: 30 },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json() as Promise<InvoiceDetailResponse>;
  } catch {
    return makeMockInvoice(id);
  }
}

async function fetchPayments(
  invoiceId: string,
  firmSlug: string | null
): Promise<Payment[]> {
  const apiUrl = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';
  const reqHeaders = new Headers();
  reqHeaders.set('Content-Type', 'application/json');
  if (firmSlug) reqHeaders.set('x-firm-slug', firmSlug);

  try {
    const res = await fetch(
      `${apiUrl}/api/v1/invoices/${invoiceId}/payments`,
      { headers: reqHeaders, next: { revalidate: 30 } }
    );
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = (await res.json()) as { data: Payment[] };
    return data.data;
  } catch {
    return MOCK_PAYMENTS;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface InvoiceDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function InvoiceDetailPage({
  params,
}: InvoiceDetailPageProps) {
  const { id } = await params;

  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const [invoiceResp, payments] = await Promise.all([
    fetchInvoice(id, firmSlug),
    fetchPayments(id, firmSlug),
  ]);

  if (!invoiceResp) {
    notFound();
  }

  const invoice = invoiceResp.data;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <InvoiceDetailClient
        invoice={invoice}
        payments={payments}
        formatEur={formatEur}
      />
    </main>
  );
}
