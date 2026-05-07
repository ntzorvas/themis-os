'use client';

/**
 * PartiesFilterBar — Client Component
 * Role chips + party_type filter + is_attorney toggle + sort controls.
 * Ενημερώνει query params (URL state) — re-fetch γίνεται αυτόματα από RSC page.
 *
 * a11y: keyboard nav, ARIA labels Ελληνικά, focus-visible, role="group"
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import {
  PARTY_ROLES,
  PARTY_ROLE_LABELS,
  PARTY_TYPE_LABELS,
  type PartyRole,
  type PartyType,
} from '@/types/parties';

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
  role: PartyRole | null;
  party_type: PartyType | null;
  is_attorney: boolean | null;
  sort: 'display_name' | 'created_at';
  order: 'asc' | 'desc';
}

function readFilters(params: URLSearchParams): FilterState {
  const roleRaw = params.get('role');
  const partyTypeRaw = params.get('party_type');
  const isAttorneyRaw = params.get('is_attorney');

  return {
    role:
      roleRaw !== null && (PARTY_ROLES as readonly string[]).includes(roleRaw)
        ? (roleRaw as PartyRole)
        : null,
    party_type:
      partyTypeRaw === 'natural' || partyTypeRaw === 'legal'
        ? partyTypeRaw
        : null,
    is_attorney:
      isAttorneyRaw === 'true'
        ? true
        : isAttorneyRaw === 'false'
          ? false
          : null,
    sort:
      params.get('sort') === 'created_at' ? 'created_at' : 'display_name',
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PartiesFilterBar() {
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

  const toggleRole = useCallback(
    (role: PartyRole) => {
      updateParam('role', filters.role === role ? null : role);
    },
    [filters.role, updateParam]
  );

  const togglePartyType = useCallback(
    (pt: PartyType) => {
      updateParam('party_type', filters.party_type === pt ? null : pt);
    },
    [filters.party_type, updateParam]
  );

  const toggleIsAttorney = useCallback(() => {
    const next =
      filters.is_attorney === true
        ? null
        : filters.is_attorney === null
          ? 'true'
          : null;
    updateParam('is_attorney', next);
  }, [filters.is_attorney, updateParam]);

  const toggleSort = useCallback(
    (field: 'display_name' | 'created_at') => {
      if (filters.sort === field) {
        updateParam('order', filters.order === 'asc' ? 'desc' : 'asc');
      } else {
        const next = new URLSearchParams(searchParams.toString());
        next.set('sort', field);
        next.set('order', 'asc');
        next.delete('offset');
        router.push(`${pathname}?${next.toString()}`);
      }
    },
    [filters.sort, filters.order, searchParams, router, pathname]
  );

  const clearAll = useCallback(() => {
    router.push(pathname);
  }, [router, pathname]);

  const hasActiveFilters =
    filters.role !== null ||
    filters.party_type !== null ||
    filters.is_attorney !== null;

  return (
    <div className="space-y-3">
      {/* Role chips */}
      <div
        role="group"
        aria-label="Φίλτρο κατά ρόλο"
        className="flex flex-wrap gap-2"
      >
        <span className="self-center text-sm font-medium text-gray-600 min-w-fit">
          Ρόλος:
        </span>
        {PARTY_ROLES.map((role: typeof PARTY_ROLES[number]) => {
          const active = filters.role === role;
          return (
            <button
              key={role}
              type="button"
              onClick={() => toggleRole(role)}
              aria-pressed={active}
              aria-label={`Φίλτρο: ${PARTY_ROLE_LABELS[role]}`}
              className={cn(
                'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2',
                active
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
            >
              {PARTY_ROLE_LABELS[role]}
            </button>
          );
        })}
      </div>

      {/* Party type + is_attorney + sort + clear */}
      <div className="flex flex-wrap items-center gap-3">
        {/* party_type */}
        <div
          role="group"
          aria-label="Φίλτρο κατά τύπο προσώπου"
          className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1"
        >
          {(['natural', 'legal'] as PartyType[]).map((pt) => {
            const active = filters.party_type === pt;
            return (
              <button
                key={pt}
                type="button"
                onClick={() => togglePartyType(pt)}
                aria-pressed={active}
                aria-label={`Τύπος: ${PARTY_TYPE_LABELS[pt]}`}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
                  active
                    ? 'bg-primary-500 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                {PARTY_TYPE_LABELS[pt]}
              </button>
            );
          })}
        </div>

        {/* is_attorney toggle */}
        <button
          type="button"
          onClick={toggleIsAttorney}
          aria-pressed={filters.is_attorney === true}
          aria-label="Εμφάνιση μόνο δικηγόρων"
          className={cn(
            'rounded-lg border px-3 py-1 text-sm font-medium transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
            filters.is_attorney === true
              ? 'border-primary-500 bg-primary-50 text-primary-700'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          )}
        >
          Μόνο Δικηγόροι
        </button>

        {/* Separator */}
        <span aria-hidden="true" className="h-5 w-px bg-gray-200" />

        {/* Sort controls */}
        <div
          role="group"
          aria-label="Ταξινόμηση"
          className="flex items-center gap-1 text-sm text-gray-600"
        >
          <span className="font-medium">Ταξινόμηση:</span>
          {(
            [
              { field: 'display_name', label: 'Όνομα' },
              { field: 'created_at', label: 'Ημερομηνία' },
            ] as { field: 'display_name' | 'created_at'; label: string }[]
          ).map(({ field, label }) => (
            <button
              key={field}
              type="button"
              onClick={() => toggleSort(field)}
              aria-label={`Ταξινόμηση κατά ${label}${filters.sort === field ? (filters.order === 'asc' ? ' (αύξουσα)' : ' (φθίνουσα)') : ''}`}
              className={cn(
                'rounded px-2 py-1 transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
                filters.sort === field
                  ? 'font-semibold text-primary-700'
                  : 'hover:text-gray-900'
              )}
            >
              {label}
              {filters.sort === field && (
                <span aria-hidden="true" className="ml-1">
                  {filters.order === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </button>
          ))}
        </div>

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
