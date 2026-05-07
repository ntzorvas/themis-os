'use client';

/**
 * MattersTable — Client Component
 * Εμφανίζει λίστα υποθέσεων με status badge, matter_type, opened_at, party count + pagination.
 * Λαμβάνει data ως props από RSC page (server-fetched).
 */

import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import {
  MATTER_STATUS_LABELS,
  MATTER_STATUS_COLORS,
  MATTER_TYPE_LABELS,
  type Matter,
  type MattersListResponse,
} from '@/types/matters';

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
// Sub-components
// ---------------------------------------------------------------------------

interface StatusBadgeProps {
  status: Matter['status'];
}

function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        MATTER_STATUS_COLORS[status]
      )}
      aria-label={`Κατάσταση: ${MATTER_STATUS_LABELS[status]}`}
    >
      {MATTER_STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface MattersTableProps {
  response: MattersListResponse;
  perPage: number;
}

export function MattersTable({ response, perPage }: MattersTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: matters, meta } = response;
  const currentOffset = parseInt(searchParams.get('offset') ?? '0', 10);
  const currentPage = Math.floor(currentOffset / perPage) + 1;
  const totalPages = Math.ceil(meta.total / perPage);

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

  if (matters.length === 0) {
    return (
      <div
        role="status"
        className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center"
      >
        <p className="text-gray-500">Δεν βρέθηκαν υποθέσεις.</p>
        <p className="mt-1 text-sm text-gray-400">
          Χρησιμοποιήστε το κουμπί &ldquo;Νέα Υπόθεση&rdquo; ή αλλάξτε τα φίλτρα.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table
          className="min-w-full divide-y divide-gray-200"
          aria-label="Λίστα Υποθέσεων"
        >
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Τίτλος
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Τύπος
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Κατάσταση
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Ημ/νία Άνοιξης
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Συμβαλλόμενοι
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Ενέργειες</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {matters.map((matter: Matter) => (
              <tr
                key={matter.id}
                className="transition-colors hover:bg-gray-50"
              >
                <td className="px-6 py-4">
                  <div>
                    <span className="font-medium text-gray-900">
                      {matter.title}
                    </span>
                    {matter.matter_number && (
                      <span className="ml-2 font-mono text-xs text-gray-400">
                        #{matter.matter_number}
                      </span>
                    )}
                  </div>
                  {matter.court_case_number && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      ΑΡ.ΚΑΤ.: {matter.court_case_number}
                    </p>
                  )}
                </td>
                <td className="px-4 py-4 text-sm text-gray-600">
                  {MATTER_TYPE_LABELS[matter.matter_type]}
                </td>
                <td className="px-4 py-4">
                  <StatusBadge status={matter.status} />
                </td>
                <td className="px-4 py-4 text-sm text-gray-500">
                  {formatDate(matter.opened_at)}
                </td>
                <td className="px-4 py-4 text-sm text-gray-500">
                  {matter.party_count !== undefined ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="font-medium text-gray-700">
                        {matter.party_count}
                      </span>
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-4 text-right">
                  <Link
                    href={`/matters/${matter.id}`}
                    className={cn(
                      'text-sm font-medium text-primary-600 hover:text-primary-800',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 rounded'
                    )}
                    aria-label={`Προβολή υπόθεσης: ${matter.title}`}
                  >
                    Προβολή →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <nav
          aria-label="Σελιδοποίηση υποθέσεων"
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
    </div>
  );
}
