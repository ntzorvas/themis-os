'use client';

/**
 * InvoiceDetailClient — Client Component
 * Λεπτομέρειες τιμολογίου με actions, lines, totals, payments.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PaymentDialog } from '@/components/invoices/payment-dialog';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
  PAYMENT_METHOD_LABELS,
  type Invoice,
  type InvoiceLine,
  type Payment,
  type InvoiceStatus,
} from '@/types/billing';
import { clientFetch, ApiClientError } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function formatDate(str: string | null): string {
  if (!str) return '—';
  try {
    return new Intl.DateTimeFormat('el-GR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(str));
  } catch {
    return str;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InvoiceDetailClientProps {
  invoice: Invoice & { lines?: InvoiceLine[] };
  payments: Payment[];
  formatEur: (cents: number) => string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvoiceDetailClient({
  invoice,
  payments,
  formatEur,
}: InvoiceDetailClientProps) {
  const router = useRouter();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const outstandingCents = invoice.total_eur_cents - invoice.paid_eur_cents;
  const lines = invoice.lines ?? [];

  const handleFinalize = async () => {
    setIsFinalizing(true);
    setFinalizeError(null);
    try {
      await clientFetch(`/api/v1/invoices/${invoice.id}/finalize`, {
        method: 'POST',
      });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFinalizeError(err.message);
      } else {
        setFinalizeError('Σφάλμα οριστικοποίησης τιμολογίου');
      }
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleDownloadPdf = () => {
    // Phase 1.5 feature — stub
    alert(
      'Η λήψη PDF δεν είναι διαθέσιμη ακόμα.\nΔιαθέσιμη σε επόμενη φάση.'
    );
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link
          href="/invoices"
          className="text-gray-500 hover:text-gray-700 transition-colors"
        >
          Τιμολόγια
        </Link>
        <span aria-hidden="true" className="text-gray-300">
          /
        </span>
        <span className="font-medium text-gray-900">
          {invoice.invoice_number}
        </span>
      </nav>

      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 font-mono">
                {invoice.invoice_number}
              </h1>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium',
                  INVOICE_STATUS_COLORS[invoice.status as InvoiceStatus] ??
                    'bg-gray-100 text-gray-600'
                )}
                aria-label={`Κατάσταση: ${INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus]}`}
              >
                {INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus] ??
                  invoice.status}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
              <div>
                <dt className="text-xs font-medium text-gray-500">Πελάτης</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">
                  {invoice.party_display_name ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Υπόθεση</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">
                  {invoice.matter_title ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">
                  Ημ/νία Τιμολογίου
                </dt>
                <dd className="mt-0.5 text-sm text-gray-700">
                  {formatDate(invoice.invoice_date)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">
                  Ημ/νία Λήξης
                </dt>
                <dd className="mt-0.5 text-sm text-gray-700">
                  {formatDate(invoice.due_date)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Actions */}
          <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row">
            {invoice.status === 'draft' && (
              <button
                type="button"
                onClick={handleFinalize}
                disabled={isFinalizing}
                aria-label="Οριστικοποίηση τιμολογίου"
                className={cn(
                  'rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
                  'hover:bg-primary-600 transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
                  'disabled:cursor-not-allowed disabled:opacity-60'
                )}
              >
                {isFinalizing ? 'Οριστικοποίηση…' : 'Οριστικοποίηση'}
              </button>
            )}

            {(invoice.status === 'issued' || invoice.status === 'sent') && (
              <button
                type="button"
                onClick={() => setPaymentOpen(true)}
                aria-label="Καταγραφή πληρωμής"
                className={cn(
                  'rounded-lg bg-green-500 px-4 py-2.5 text-sm font-medium text-white',
                  'hover:bg-green-600 transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-500'
                )}
              >
                Καταγραφή Πληρωμής
              </button>
            )}

            <button
              type="button"
              onClick={handleDownloadPdf}
              aria-label="Λήψη PDF (μη διαθέσιμη)"
              className={cn(
                'rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700',
                'hover:bg-gray-50 transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
              )}
            >
              Λήψη PDF
            </button>
          </div>
        </div>

        {finalizeError && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {finalizeError}
          </div>
        )}
      </div>

      {/* Lines table */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">Γραμμές</h2>
        </div>
        {lines.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">
            Δεν υπάρχουν γραμμές.
          </div>
        ) : (
          <table
            className="min-w-full divide-y divide-gray-100"
            aria-label="Γραμμές τιμολογίου"
          >
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Περιγραφή
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Ποσ.
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Τιμή
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Σύνολο
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 bg-white">
              {lines.map((line: InvoiceLine) => (
                <tr key={line.id}>
                  <td className="px-6 py-3 text-sm text-gray-800">
                    {line.description}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">
                    {line.quantity}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">
                    {formatEur(line.unit_price_eur_cents)}
                  </td>
                  <td className="px-6 py-3 text-right text-sm font-medium text-gray-900">
                    {formatEur(line.line_total_eur_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Totals */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Σύνολα</h2>
        <dl className="space-y-2">
          <div className="flex justify-between text-sm">
            <dt className="text-gray-600">Υποσύνολο</dt>
            <dd className="text-gray-900">
              {formatEur(invoice.subtotal_eur_cents)}
            </dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-gray-600">ΦΠΑ {invoice.vat_rate_pct}%</dt>
            <dd className="text-gray-900">
              {formatEur(invoice.vat_amount_eur_cents)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-semibold">
            <dt className="text-gray-900">Σύνολο</dt>
            <dd className="text-gray-900">
              {formatEur(invoice.total_eur_cents)}
            </dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-gray-600">Πληρωμένο</dt>
            <dd className="text-green-700 font-medium">
              {formatEur(invoice.paid_eur_cents)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-bold">
            <dt className="text-gray-900">Εκκρεμές Υπόλοιπο</dt>
            <dd
              className={cn(
                outstandingCents > 0 ? 'text-red-600' : 'text-green-600'
              )}
            >
              {formatEur(outstandingCents)}
            </dd>
          </div>
        </dl>

        {invoice.notes && (
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <p className="text-xs font-medium text-gray-500">Σημειώσεις</p>
            <p className="mt-1 text-sm text-gray-700">{invoice.notes}</p>
          </div>
        )}
      </div>

      {/* Payments history */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            Ιστορικό Πληρωμών
          </h2>
        </div>
        {payments.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">
            Δεν έχουν καταγραφεί πληρωμές ακόμα.
          </div>
        ) : (
          <table
            className="min-w-full divide-y divide-gray-100"
            aria-label="Ιστορικό πληρωμών"
          >
            <thead className="bg-gray-50">
              <tr>
                {['Ημ/νία', 'Ποσό', 'Τρόπος', 'Αναφορά'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 bg-white">
              {payments.map((p: Payment) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatDate(p.paid_at)}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {formatEur(p.amount_eur_cents)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {PAYMENT_METHOD_LABELS[p.method]}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {p.reference ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Payment Dialog */}
      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        invoiceId={invoice.id}
        outstandingCents={outstandingCents}
      />
    </div>
  );
}
