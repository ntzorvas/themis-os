'use client';

/**
 * PartiesTable — Client Component
 * Εμφανίζει λίστα συμβαλλομένων με role chips + pagination.
 * Λαμβάνει data ως props από RSC page (server-fetched).
 */

import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import {
  PARTY_ROLE_LABELS,
  PARTY_ROLE_COLORS,
  PARTY_TYPE_LABELS,
  type Party,
  type PartiesListResponse,
} from '@/types/parties';

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

interface RoleChipProps {
  role: Party['roles'][number];
}

function RoleChip({ role }: RoleChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        PARTY_ROLE_COLORS[role]
      )}
      aria-label={`Ρόλος: ${PARTY_ROLE_LABELS[role]}`}
    >
      {PARTY_ROLE_LABELS[role]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface PartiesTableProps {
  response: PartiesListResponse;
  perPage: number;
}

export function PartiesTable({ response, perPage }: PartiesTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: parties, meta } = response;
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

  if (parties.length === 0) {
    return (
      <div
        role="status"
        className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center"
      >
        <p className="text-gray-500">Δεν βρέθηκαν συμβαλλόμενοι.</p>
        <p className="mt-1 text-sm text-gray-400">
          Χρησιμοποιήστε το κουμπί &ldquo;Νέο Συμβαλλόμενο&rdquo; ή αλλάξτε τα φίλτρα.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200" aria-label="Λίστα Συμβαλλομένων">
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Ονομασία
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
                ΑΦΜ
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Ρόλοι
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Εγγραφή
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Ενέργειες</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {parties.map((party: Party) => (
              <tr
                key={party.id}
                className="transition-colors hover:bg-gray-50"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {party.display_name}
                    </span>
                    {party.is_attorney && (
                      <span
                        className="rounded bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700"
                        aria-label="Δικηγόρος"
                        title="Δικηγόρος"
                      >
                        ΔΙΚ
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-4 text-sm text-gray-600">
                  {PARTY_TYPE_LABELS[party.party_type]}
                </td>
                <td className="px-4 py-4 font-mono text-sm text-gray-500">
                  {party.afm !== null && party.afm.length > 0
                    ? party.afm
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-1">
                    {party.roles.length === 0 ? (
                      <span className="text-sm text-gray-300">—</span>
                    ) : (
                      party.roles.map((role: Party['roles'][number]) => (
                        <RoleChip key={role} role={role} />
                      ))
                    )}
                  </div>
                </td>
                <td className="px-4 py-4 text-sm text-gray-500">
                  {formatDate(party.created_at)}
                </td>
                <td className="px-4 py-4 text-right">
                  <Link
                    href={`/parties/${party.id}`}
                    className={cn(
                      'text-sm font-medium text-primary-600 hover:text-primary-800',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 rounded'
                    )}
                    aria-label={`Προβολή στοιχείων: ${party.display_name}`}
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
          aria-label="Σελιδοποίηση συμβαλλομένων"
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
