'use client';

/**
 * InvoicesClient — Client Component
 * Λίστα τιμολογίων με φίλτρα, wizard button, pagination.
 */

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { InvoiceWizard } from '@/components/invoices/invoice-wizard';
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
  type InvoicesListResponse,
  type Invoice,
  type InvoiceStatus,
} from '@/types/billing';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function formatDate(str: string): string {
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

interface InvoicesClientProps {
  response: InvoicesListResponse;
  perPage: number;
  formatEur: (cents: number) => string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvoicesClient({
  response,
  perPage,
  formatEur,
}: InvoicesClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: invoices, meta } = response;
  const currentOffset = parseInt(searchParams.get('offset') ?? '0', 10);
  const currentPage = Math.floor(currentOffset / perPage) + 1;
  const totalPages = Math.ceil(meta.total / perPage);

  const goToPage = useCallback(
    (page: number) => {
      const next = new URLSearchParams(searchParams.toString());
      const offset = (page - 1) * perPage;
      if (offset === 0) next.delete('offset');
      else next.set('offset', String(offset));
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams, perPage]
  );

  const setFilter = useCallback(
    (key: string, value: string | undefined) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('offset');
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Τιμολόγια</h1>
          <p className="mt-1 text-sm text-gray-500">
            Σύνολο: {meta.total} τιμολόγια
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          aria-label="Νέο τιμολόγιο"
          className={cn(
            'rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
            'hover:bg-primary-600 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
          )}
        >
          + Νέο Τιμολόγιο
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label
              htmlFor="inv-filter-status"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Κατάσταση
            </label>
            <select
              id="inv-filter-status"
              value={searchParams.get('status') ?? ''}
              onChange={(e) =>
                setFilter('status', e.target.value || undefined)
              }
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none"
            >
              <option value="">Όλες</option>
              {INVOICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {INVOICE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="inv-filter-from"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Από
            </label>
            <input
              id="inv-filter-from"
              type="date"
              value={searchParams.get('from') ?? ''}
              onChange={(e) =>
                setFilter('from', e.target.value || undefined)
              }
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="inv-filter-to"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Έως
            </label>
            <input
              id="inv-filter-to"
              type="date"
              value={searchParams.get('to') ?? ''}
              onChange={(e) => setFilter('to', e.target.value || undefined)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {invoices.length === 0 ? (
        <div
          role="status"
          className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center"
        >
          <p className="text-gray-500">Δεν βρέθηκαν τιμολόγια.</p>
          <p className="mt-1 text-sm text-gray-400">
            Πατήστε &ldquo;Νέο Τιμολόγιο&rdquo; για να δημιουργήσετε το
            πρώτο.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table
            className="min-w-full divide-y divide-gray-200"
            aria-label="Λίστα τιμολογίων"
          >
            <thead className="bg-gray-50">
              <tr>
                {[
                  'Αρ. Τιμολογίου',
                  'Ημ/νία',
                  'Πελάτης',
                  'Υπόθεση',
                  'Σύνολο',
                  'Πληρωμένο',
                  'Κατάσταση',
                  '',
                ].map((h) => (
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
            <tbody className="divide-y divide-gray-100 bg-white">
              {invoices.map((inv: Invoice) => (
                <tr
                  key={inv.id}
                  className="transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-mono text-sm font-medium text-primary-600 hover:text-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 rounded"
                      aria-label={`Προβολή τιμολογίου ${inv.invoice_number}`}
                    >
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatDate(inv.invoice_date)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-800">
                    {inv.party_display_name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="max-w-[180px]">
                      <span
                        className="block truncate text-sm text-gray-800"
                        title={inv.matter_title}
                      >
                        {inv.matter_title ?? '—'}
                      </span>
                      {inv.matter_number && (
                        <span className="font-mono text-xs text-gray-400">
                          #{inv.matter_number}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {formatEur(inv.total_eur_cents)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatEur(inv.paid_eur_cents)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        INVOICE_STATUS_COLORS[inv.status as InvoiceStatus] ??
                          'bg-gray-100 text-gray-600'
                      )}
                    >
                      {INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] ??
                        inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="text-sm font-medium text-primary-600 hover:text-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 rounded"
                      aria-label={`Λεπτομέρειες τιμολογίου ${inv.invoice_number}`}
                    >
                      Προβολή →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav
          aria-label="Σελιδοποίηση τιμολογίων"
          className="flex items-center justify-between"
        >
          <p className="text-sm text-gray-600">
            Σελίδα{' '}
            <strong>
              {currentPage} από {totalPages}
            </strong>{' '}
            (σύνολο {meta.total})
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              aria-label="Προηγούμενη σελίδα"
              className={cn(
                'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                currentPage === 1
                  ? 'cursor-not-allowed border-gray-100 text-gray-300'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              )}
            >
              ← Προηγούμενη
            </button>
            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              aria-label="Επόμενη σελίδα"
              className={cn(
                'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                currentPage === totalPages
                  ? 'cursor-not-allowed border-gray-100 text-gray-300'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              )}
            >
              Επόμενη →
            </button>
          </div>
        </nav>
      )}

      {/* Invoice Wizard */}
      <InvoiceWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
