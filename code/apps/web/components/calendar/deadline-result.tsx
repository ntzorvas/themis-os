'use client';

/**
 * DeadlineResult — αποτέλεσμα υπολογισμού προθεσμίας.
 * Δείχνει: big deadline_date, day-of-week, adjustments breakdown, warnings_gr.
 * "Αποθήκευση ως γεγονός" button → onSaveAsEvent callback.
 */

import type { DeadlineCalculationResult } from '@/types/calendar';
import { GREEK_DAYS_FULL, GREEK_MONTHS_GEN } from '@/types/calendar';

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatGreekDate(isoDate: string): { dayName: string; formatted: string } {
  const date = new Date(`${isoDate}T12:00:00`);
  const dayName = GREEK_DAYS_FULL[date.getDay()] ?? '';
  const day = date.getDate();
  const month = GREEK_MONTHS_GEN[date.getMonth()] ?? '';
  const year = date.getFullYear();
  return { dayName, formatted: `${day} ${month} ${year}` };
}

const ADJUSTMENT_ICONS: Record<string, string> = {
  august_suspension: '🏖',
  weekend_rollover: '📅',
  foreign_extension: '✈',
  business_days: '🗓',
};

const ADJUSTMENT_LABELS: Record<string, string> = {
  august_suspension: 'Αναστολή Αυγούστου',
  weekend_rollover: 'Μεταφορά λόγω αργίας/Σ/Κ',
  foreign_extension: 'Παρέκταση εξωτερικού',
  business_days: 'Εργάσιμες ημέρες',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeadlineResultProps {
  result: DeadlineCalculationResult;
  onSaveAsEvent?: () => void;
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeadlineResult({
  result,
  onSaveAsEvent,
  isLoading = false,
}: DeadlineResultProps) {
  const { dayName, formatted } = formatGreekDate(result.deadline_date);
  const rawFormatted = result.raw_deadline_date !== result.deadline_date
    ? formatGreekDate(result.raw_deadline_date)
    : null;

  const hasAdjustments = result.adjustments.length > 0;
  const hasWarnings = result.warnings_gr.length > 0;

  return (
    <div
      aria-live="polite"
      aria-label="Αποτέλεσμα υπολογισμού προθεσμίας"
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      {/* Big deadline display */}
      <div className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Ημερομηνία Λήξης Προθεσμίας
        </p>
        <div className="mt-2">
          <span className="block text-sm font-medium text-gray-500">{dayName}</span>
          <span className="mt-1 block text-4xl font-bold tracking-tight text-gray-900">
            {isLoading ? (
              <span className="inline-block h-10 w-48 animate-pulse rounded-lg bg-gray-200" />
            ) : (
              formatted
            )}
          </span>
        </div>

        {rawFormatted && (
          <p className="mt-2 text-xs text-gray-400">
            Αρχική ημ/νία (πριν προσαρμογές):{' '}
            <span className="line-through">{rawFormatted.formatted}</span>
          </p>
        )}
      </div>

      {/* BETA / legal review banner */}
      {result.requires_legal_review && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3"
          aria-label="Απαιτείται νομικός έλεγχος"
        >
          <div className="flex items-start gap-2">
            <span className="shrink-0 text-yellow-600 text-base" aria-hidden="true">🟡</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-yellow-800 uppercase tracking-wide">
                BETA — Απαιτείται νομικός έλεγχος
              </p>
              <p className="mt-0.5 text-xs text-yellow-700">
                Αυτός ο κανόνας έχει πρόσφατα τροποποιηθεί ή βρίσκεται υπό νομική αναθεώρηση.
                Επαληθεύστε την προθεσμία με τη νομοθεσία πριν τη χρησιμοποιήσετε.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Rule applied */}
      {result.rule_applied && (
        <div className="mb-4 rounded-md bg-gray-50 px-3 py-2">
          <p className="text-xs text-gray-500">
            <span className="font-semibold">Κανόνας:</span>{' '}
            {result.rule_applied}
          </p>
          {result.legal_source && (
            <p className="mt-0.5 text-xs text-gray-400">
              <span className="font-semibold">Πηγή:</span>{' '}
              {result.legal_source}
            </p>
          )}
        </div>
      )}

      {/* Adjustments breakdown */}
      {hasAdjustments && (
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Προσαρμογές
          </h3>
          <ul className="space-y-2">
            {result.adjustments.map((adj, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2"
              >
                <span
                  className="mt-0.5 shrink-0 text-base"
                  aria-hidden="true"
                >
                  {ADJUSTMENT_ICONS[adj.type] ?? '•'}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-700">
                    {ADJUSTMENT_LABELS[adj.type] ?? adj.type}
                  </p>
                  <p className="text-xs text-gray-500">{adj.description_gr}</p>
                  {adj.days_added !== 0 && (
                    <p className="mt-0.5 text-xs font-medium text-primary-600">
                      {adj.days_added > 0 ? `+${adj.days_added}` : adj.days_added} ημέρες
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4"
          aria-label="Προειδοποιήσεις"
        >
          <div className="flex items-start gap-2">
            <span className="shrink-0 text-yellow-500" aria-hidden="true">⚠</span>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold text-yellow-800">
                Προειδοποιήσεις
              </p>
              <ul className="space-y-1">
                {result.warnings_gr.map((w, i) => (
                  <li key={i} className="text-xs text-yellow-700">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Save as event button */}
      {onSaveAsEvent && (
        <button
          type="button"
          onClick={onSaveAsEvent}
          aria-label="Αποθήκευση ως νέο γεγονός ημερολογίου"
          className={cn(
            'mt-2 w-full rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
            'hover:bg-primary-600 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
            'disabled:cursor-not-allowed disabled:opacity-60'
          )}
        >
          Αποθήκευση ως Γεγονός
        </button>
      )}
    </div>
  );
}
