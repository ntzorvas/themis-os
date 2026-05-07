'use client';

/**
 * TimeEntriesClient — Client Component
 * Εμφανίζει λίστα καταχωρήσεων χρόνου με φίλτρα, πίνακα, pagination.
 * "Νέα Καταχώρηση" button + "Έκδοση Τιμολογίου" bulk action.
 */

import { useState, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { NewTimeEntryDialog } from '@/components/time/new-time-entry-dialog';
import {
  TIME_ENTRY_STATUSES,
  TIME_ENTRY_STATUS_LABELS,
  TIME_ENTRY_STATUS_COLORS,
  type TimeEntriesListResponse,
  type TimeEntry,
  type TimeEntryStatus,
} from '@/types/billing';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function formatDate(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('el-GR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TimeEntriesClientProps {
  response: TimeEntriesListResponse;
  perPage: number;
  formatEur: (cents: number) => string;
  formatDuration: (minutes: number | null) => string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TimeEntriesClient({
  response,
  perPage,
  formatEur,
  formatDuration,
}: TimeEntriesClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: entries, meta } = response;
  const currentOffset = parseInt(searchParams.get('offset') ?? '0', 10);
  const currentPage = Math.floor(currentOffset / perPage) + 1;
  const totalPages = Math.ceil(meta.total / perPage);

  const unbilledEntries = entries.filter(
    (e) => e.status === 'draft' && e.billable
  );

  const goToPage = useCallback(
    (page: number) => {
      const next = new URLSearchParams(searchParams.toString());
      const offset = (page - 1) * perPage;
      if (offset === 0) {
        next.delete('offset');
      } else {
        next.set('offset', String(offset));
      }
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams, perPage]
  );

  const setFilter = useCallback(
    (key: string, value: string | undefined) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.delete('offset');
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleIssueInvoice = () => {
    const ids = Array.from(selectedIds).join(',');
    router.push(`/invoices/new?time_entry_ids=${ids}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Καταχωρήσεις Χρόνου
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Σύνολο: {meta.total} εγγραφές
          </p>
        </div>
        <div className="flex gap-3">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleIssueInvoice}
              aria-label={`Έκδοση τιμολογίου για ${selectedIds.size} εγγραφές`}
              className={cn(
                'rounded-lg border border-primary-300 bg-primary-50 px-4 py-2.5 text-sm font-medium text-primary-700',
                'hover:bg-primary-100 transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
              )}
            >
              Έκδοση Τιμολογίου ({selectedIds.size})
            </button>
          )}
          <button
            type="button"
            onClick={() => setNewEntryOpen(true)}
            aria-label="Νέα καταχώρηση χρόνου"
            className={cn(
              'rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
              'hover:bg-primary-600 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
            )}
          >
            + Νέα Καταχώρηση
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-4">
          {/* Status filter */}
          <div>
            <label
              htmlFor="filter-status"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Κατάσταση
            </label>
            <select
              id="filter-status"
              value={searchParams.get('status') ?? ''}
              onChange={(e) =>
                setFilter('status', e.target.value || undefined)
              }
              className={cn(
                'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
              )}
            >
              <option value="">Όλες</option>
              {TIME_ENTRY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TIME_ENTRY_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          {/* Billable filter */}
          <div>
            <label
              htmlFor="filter-billable"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Χρεώσιμο
            </label>
            <select
              id="filter-billable"
              value={searchParams.get('billable') ?? ''}
              onChange={(e) =>
                setFilter('billable', e.target.value || undefined)
              }
              className={cn(
                'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
              )}
            >
              <option value="">Όλες</option>
              <option value="true">Χρεώσιμες</option>
              <option value="false">Μη Χρεώσιμες</option>
            </select>
          </div>

          {/* Date from */}
          <div>
            <label
              htmlFor="filter-from"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Από
            </label>
            <input
              id="filter-from"
              type="date"
              value={searchParams.get('from') ?? ''}
              onChange={(e) =>
                setFilter('from', e.target.value || undefined)
              }
              className={cn(
                'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
              )}
            />
          </div>

          {/* Date to */}
          <div>
            <label
              htmlFor="filter-to"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Έως
            </label>
            <input
              id="filter-to"
              type="date"
              value={searchParams.get('to') ?? ''}
              onChange={(e) => setFilter('to', e.target.value || undefined)}
              className={cn(
                'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
              )}
            />
          </div>
        </div>
      </div>

      {/* Unbilled alert */}
      {unbilledEntries.length > 0 && selectedIds.size === 0 && (
        <div
          role="status"
          className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3"
        >
          <p className="text-sm text-blue-700">
            <strong>{unbilledEntries.length}</strong> μη τιμολογημένες χρεώσιμες
            εγγραφές. Επιλέξτε εγγραφές και πατήστε &ldquo;Έκδοση
            Τιμολογίου&rdquo;.
          </p>
        </div>
      )}

      {/* Table */}
      {entries.length === 0 ? (
        <div
          role="status"
          className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center"
        >
          <p className="text-gray-500">Δεν βρέθηκαν καταχωρήσεις χρόνου.</p>
          <p className="mt-1 text-sm text-gray-400">
            Χρησιμοποιήστε το χρονόμετρο ή πατήστε &ldquo;Νέα
            Καταχώρηση&rdquo;.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table
            className="min-w-full divide-y divide-gray-200"
            aria-label="Λίστα καταχωρήσεων χρόνου"
          >
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="w-10 px-4 py-3">
                  <span className="sr-only">Επιλογή</span>
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Ημ/νία
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Υπόθεση
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Χρήστης
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Διάρκεια
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Περιγραφή
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Χρεώσιμο
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Χρέωση
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  Κατάσταση
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {entries.map((entry: TimeEntry) => (
                <tr
                  key={entry.id}
                  className={cn(
                    'transition-colors hover:bg-gray-50',
                    selectedIds.has(entry.id) && 'bg-primary-50'
                  )}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleSelect(entry.id)}
                      disabled={entry.status === 'billed'}
                      aria-label={`Επιλογή εγγραφής ${entry.id}`}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatDate(entry.started_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <span className="text-sm font-medium text-gray-900">
                        {entry.matter_title ?? entry.matter_id}
                      </span>
                      {entry.matter_number && (
                        <span className="ml-1 font-mono text-xs text-gray-400">
                          #{entry.matter_number}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {entry.user_display_name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-700">
                    {formatDuration(entry.duration_minutes)}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-sm text-gray-500">
                    <span
                      className="block truncate"
                      title={entry.description ?? undefined}
                    >
                      {entry.description ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {entry.billable ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Ναι
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                        Όχι
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                    {entry.billable_amount_eur_cents !== null
                      ? formatEur(entry.billable_amount_eur_cents)
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        TIME_ENTRY_STATUS_COLORS[
                          entry.status as TimeEntryStatus
                        ] ?? 'bg-gray-100 text-gray-600'
                      )}
                    >
                      {TIME_ENTRY_STATUS_LABELS[
                        entry.status as TimeEntryStatus
                      ] ?? entry.status}
                    </span>
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
          aria-label="Σελιδοποίηση"
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
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
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
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
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

      {/* New Time Entry Dialog */}
      <NewTimeEntryDialog
        open={newEntryOpen}
        onClose={() => setNewEntryOpen(false)}
      />
    </div>
  );
}
