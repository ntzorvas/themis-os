'use client';

/**
 * MattersFilterBar — Client Component
 * Status chips + matter_type select + assigned_to filter.
 * Ενημερώνει query params (URL state) — re-fetch γίνεται αυτόματα από RSC page.
 *
 * a11y: keyboard nav, ARIA labels Ελληνικά, focus-visible, role="group"
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import {
  MATTER_STATUSES,
  MATTER_STATUS_LABELS,
  MATTER_STATUS_COLORS,
  MATTER_TYPES,
  MATTER_TYPE_LABELS,
  type MatterStatus,
  type MatterType,
} from '@/types/matters';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FilterState {
  status: MatterStatus | null;
  matter_type: MatterType | null;
}

function readFilters(params: URLSearchParams): FilterState {
  const statusRaw = params.get('status');
  const typeRaw = params.get('matter_type');

  return {
    status:
      statusRaw !== null &&
      (MATTER_STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as MatterStatus)
        : null,
    matter_type:
      typeRaw !== null &&
      (MATTER_TYPES as readonly string[]).includes(typeRaw)
        ? (typeRaw as MatterType)
        : null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MattersFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = readFilters(searchParams);

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === null) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      // Reset pagination on filter change
      next.delete('offset');
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const toggleStatus = useCallback(
    (status: MatterStatus) => {
      updateParam('status', filters.status === status ? null : status);
    },
    [filters.status, updateParam]
  );

  const setMatterType = useCallback(
    (value: string) => {
      updateParam('matter_type', value === '' ? null : value);
    },
    [updateParam]
  );

  const clearAll = useCallback(() => {
    router.push(pathname);
  }, [router, pathname]);

  const hasActiveFilters =
    filters.status !== null || filters.matter_type !== null;

  return (
    <div className="space-y-3">
      {/* Status chips */}
      <div
        role="group"
        aria-label="Φίλτρο κατά κατάσταση"
        className="flex flex-wrap gap-2"
      >
        <span className="self-center text-sm font-medium text-gray-600 min-w-fit">
          Κατάσταση:
        </span>
        {MATTER_STATUSES.map((status) => {
          const active = filters.status === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => toggleStatus(status)}
              aria-pressed={active}
              aria-label={`Φίλτρο: ${MATTER_STATUS_LABELS[status]}`}
              className={cn(
                'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2',
                active
                  ? 'ring-2 ring-primary-500 ring-offset-1 ' + MATTER_STATUS_COLORS[status]
                  : MATTER_STATUS_COLORS[status] + ' opacity-60 hover:opacity-100'
              )}
            >
              {MATTER_STATUS_LABELS[status]}
            </button>
          );
        })}
      </div>

      {/* matter_type select + clear */}
      <div className="flex flex-wrap items-center gap-3">
        {/* matter_type */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="matter-type-filter"
            className="text-sm font-medium text-gray-600"
          >
            Τύπος:
          </label>
          <select
            id="matter-type-filter"
            value={filters.matter_type ?? ''}
            onChange={(e) => setMatterType(e.target.value)}
            aria-label="Φίλτρο κατά τύπο υπόθεσης"
            className={cn(
              'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              'transition-colors'
            )}
          >
            <option value="">— Όλοι οι τύποι —</option>
            {MATTER_TYPES.map((type) => (
              <option key={type} value={type}>
                {MATTER_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        {/* Separator */}
        {hasActiveFilters && (
          <span aria-hidden="true" className="h-5 w-px bg-gray-200" />
        )}

        {/* Clear all */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAll}
            aria-label="Καθαρισμός όλων των φίλτρων"
            className={cn(
              'rounded px-2 py-1 text-sm text-gray-500 underline hover:text-gray-800',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
            )}
          >
            Καθαρισμός
          </button>
        )}
      </div>
    </div>
  );
}
