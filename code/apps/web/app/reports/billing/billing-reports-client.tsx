'use client';

/**
 * BillingReportsClient — Client Component
 * Dashboard χρεώσεων με date range selector, summary cards.
 */

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { type BillingSummaryResponse } from '@/types/billing';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BillingReportsClientProps {
  summary: BillingSummaryResponse;
  from: string;
  to: string;
  formatEur: (cents: number) => string;
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  title: string;
  value: string;
  subtitle?: string;
  colorClass?: string;
}

function SummaryCard({
  title,
  value,
  subtitle,
  colorClass = 'text-gray-900',
}: SummaryCardProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className={cn('mt-2 text-2xl font-bold', colorClass)}>{value}</p>
      {subtitle && (
        <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BillingReportsClient({
  summary,
  from,
  to,
  formatEur,
}: BillingReportsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data } = summary;

  const setDateRange = useCallback(
    (key: 'from' | 'to', value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(key, value);
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const handleExportExcel = () => {
    alert(
      'Η εξαγωγή Excel δεν είναι διαθέσιμη ακόμα.\nΔιαθέσιμη σε επόμενη φάση.'
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Αναφορά Χρεώσεων
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Στατιστικά τιμολογίων και πληρωμών
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportExcel}
          aria-label="Εξαγωγή σε Excel (μη διαθέσιμη)"
          className={cn(
            'rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700',
            'hover:bg-gray-50 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
          )}
        >
          Εξαγωγή Excel
        </button>
      </div>

      {/* Date range */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="rep-from"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Από
            </label>
            <input
              id="rep-from"
              type="date"
              value={from}
              onChange={(e) => setDateRange('from', e.target.value)}
              aria-label="Ημερομηνία έναρξης αναφοράς"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <div>
            <label
              htmlFor="rep-to"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Έως
            </label>
            <input
              id="rep-to"
              type="date"
              value={to}
              onChange={(e) => setDateRange('to', e.target.value)}
              aria-label="Ημερομηνία λήξης αναφοράς"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Σύνοψη χρεώσεων"
      >
        <SummaryCard
          title="Σύνολο Τιμολογίων"
          value={formatEur(data.total_invoiced_eur_cents)}
          subtitle={`${data.invoice_count} τιμολόγια`}
        />
        <SummaryCard
          title="Εξοφλημένα"
          value={formatEur(data.total_paid_eur_cents)}
          subtitle={`${data.paid_count} τιμολόγια`}
          colorClass="text-green-700"
        />
        <SummaryCard
          title="Εκκρεμή"
          value={formatEur(data.total_outstanding_eur_cents)}
          subtitle={`${data.invoice_count - data.paid_count} τιμολόγια`}
          colorClass={
            data.total_outstanding_eur_cents > 0 ? 'text-red-600' : 'text-green-600'
          }
        />
        <SummaryCard
          title="Realization Rate"
          value={`${data.realization_rate_pct.toFixed(1)}%`}
          subtitle="Πληρωμένο / Τιμολογηθέν"
          colorClass={
            data.realization_rate_pct >= 80
              ? 'text-green-700'
              : data.realization_rate_pct >= 50
              ? 'text-yellow-700'
              : 'text-red-600'
          }
        />
      </div>

      {/* Chart placeholder */}
      <div
        className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center"
        aria-label="Γράφημα χρεώσεων (Phase 1.5)"
        role="img"
      >
        <p className="text-sm font-medium text-gray-400">
          Γράφημα Χρεώσεων
        </p>
        <p className="mt-1 text-xs text-gray-300">
          Διαθέσιμο σε Phase 1.5 με recharts
        </p>
      </div>
    </div>
  );
}
