'use client';

/**
 * TimerWidget — Persistent floating timer widget (bottom-right)
 *
 * - Polling: GET /api/v1/time-entries/active on mount + every 30s
 * - Active state: matter name + elapsed time (live ticker every second)
 * - "Παύση" → POST /api/v1/time-entries/:id/stop
 * - "Έναρξη χρόνου" → opens matter selector + description input
 *
 * Mount στο root layout — visible σε όλες τις authenticated pages.
 *
 * Invariant #10: Greek labels everywhere
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { clientFetch, ApiClientError } from '@/lib/api-client';
import { formatElapsedTime, formatEur } from '@/lib/currency';
import type {
  TimeEntry,
  ActiveTimerResponse,
  TimeEntriesListResponse,
} from '@/types/billing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MatterOption {
  id: string;
  title: string;
  matter_number: string;
  billable_rate_eur_cents?: number | null;
}

interface StartTimerForm {
  matter_id: string;
  description: string;
  billable_rate_eur_cents: number;
  billable: boolean;
}

const StartTimerSchema = z.object({
  matter_id: z.string().uuid('Επιλέξτε υπόθεση'),
  description: z.string().optional(),
  billable_rate_eur_cents: z.coerce.number().int().nonnegative().optional(),
  billable: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function getElapsedSeconds(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}

// ---------------------------------------------------------------------------
// Mock fallback για όταν το backend δεν είναι διαθέσιμο
// ---------------------------------------------------------------------------

const MOCK_MATTERS: MatterOption[] = [
  {
    id: '10000000-0000-0000-0000-000000000001',
    title: 'Αγωγή Παπαδόπουλου κατά ΑΛΦΑ ΑΕ',
    matter_number: 'MAT-2026-001',
    billable_rate_eur_cents: 15000,
  },
  {
    id: '10000000-0000-0000-0000-000000000002',
    title: 'Σύμβαση Εξαγοράς ΒΗΤΑ ΑΕ',
    matter_number: 'MAT-2026-002',
    billable_rate_eur_cents: 12000,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TimerWidget() {
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [stopConfirmation, setStopConfirmation] = useState<{
    duration_minutes: number;
    billable_amount_eur_cents: number | null;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<StartTimerForm>({
    resolver: zodResolver(StartTimerSchema),
    defaultValues: { billable: true, billable_rate_eur_cents: 0 },
  });

  const selectedMatterId = watch('matter_id');

  // -------------------------------------------------------------------------
  // Auto-fill billable rate from selected matter
  // -------------------------------------------------------------------------
  useEffect(() => {
    const matter = matters.find((m) => m.id === selectedMatterId);
    if (matter?.billable_rate_eur_cents) {
      reset((prev) => ({
        ...prev,
        matter_id: selectedMatterId,
        billable_rate_eur_cents: Math.floor(
          matter.billable_rate_eur_cents! / 100
        ),
      }));
    }
  }, [selectedMatterId, matters, reset]);

  // -------------------------------------------------------------------------
  // Fetch active timer
  // -------------------------------------------------------------------------
  const fetchActiveTimer = useCallback(async () => {
    try {
      const resp = await clientFetch<ActiveTimerResponse>(
        '/api/v1/time-entries/active'
      );
      setActiveEntry(resp.data);
      if (resp.data) {
        setElapsedSeconds(getElapsedSeconds(resp.data.started_at));
      }
    } catch {
      // Backend not yet available — silently ignore
      setActiveEntry(null);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Fetch matters for selector
  // -------------------------------------------------------------------------
  const fetchMatters = useCallback(async () => {
    try {
      const resp = await clientFetch<TimeEntriesListResponse>(
        '/api/v1/matters?limit=100&status=active'
      );
      // API returns matters list — cast loosely
      const data = (resp as unknown as { data: MatterOption[] }).data;
      setMatters(data ?? MOCK_MATTERS);
    } catch {
      setMatters(MOCK_MATTERS);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  useEffect(() => {
    void fetchActiveTimer();
    void fetchMatters();

    pollRef.current = setInterval(() => {
      void fetchActiveTimer();
    }, 30_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchActiveTimer, fetchMatters]);

  // Live ticker
  useEffect(() => {
    if (activeEntry) {
      tickerRef.current = setInterval(() => {
        setElapsedSeconds(getElapsedSeconds(activeEntry.started_at));
      }, 1000);
    } else {
      if (tickerRef.current) clearInterval(tickerRef.current);
    }
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [activeEntry]);

  // -------------------------------------------------------------------------
  // Start timer
  // -------------------------------------------------------------------------
  const onStartTimer = async (data: StartTimerForm) => {
    setError(null);
    try {
      const resp = await clientFetch<{ data: TimeEntry }>(
        '/api/v1/time-entries',
        {
          method: 'POST',
          body: {
            matter_id: data.matter_id,
            description: data.description ?? null,
            started_at: new Date().toISOString(),
            billable: data.billable,
            billable_rate_eur_cents: data.billable_rate_eur_cents
              ? data.billable_rate_eur_cents * 100
              : null,
          },
        }
      );
      setActiveEntry(resp.data);
      setElapsedSeconds(0);
      setShowPanel(false);
      reset({ billable: true, billable_rate_eur_cents: 0 });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Σφάλμα εκκίνησης χρονομέτρου');
      }
    }
  };

  // -------------------------------------------------------------------------
  // Stop timer
  // -------------------------------------------------------------------------
  const handleStop = async () => {
    if (!activeEntry) return;
    setIsLoading(true);
    setError(null);
    try {
      const resp = await clientFetch<{ data: TimeEntry }>(
        `/api/v1/time-entries/${activeEntry.id}/stop`,
        { method: 'POST', body: { stopped_at: new Date().toISOString() } }
      );
      setStopConfirmation({
        duration_minutes: resp.data.duration_minutes ?? 0,
        billable_amount_eur_cents: resp.data.billable_amount_eur_cents,
      });
      setActiveEntry(null);
      setElapsedSeconds(0);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Σφάλμα διακοπής χρονομέτρου');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div
      className="fixed bottom-6 right-6 z-50"
      role="region"
      aria-label="Χρονόμετρο εργασίας"
    >
      {/* Stop Confirmation Toast */}
      {stopConfirmation && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'mb-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 shadow-lg',
            'flex items-center justify-between gap-4'
          )}
        >
          <div>
            <p className="text-sm font-medium text-green-800">
              Καταγράφηκε:{' '}
              {Math.floor(stopConfirmation.duration_minutes / 60)}ω{' '}
              {stopConfirmation.duration_minutes % 60}λ
            </p>
            {stopConfirmation.billable_amount_eur_cents !== null && (
              <p className="text-xs text-green-600">
                Χρέωση:{' '}
                {formatEur(stopConfirmation.billable_amount_eur_cents)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setStopConfirmation(null)}
            aria-label="Κλείσιμο επιβεβαίωσης"
            className="text-green-500 hover:text-green-700 transition-colors"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}

      {/* Start Panel */}
      {showPanel && !activeEntry && (
        <div
          className={cn(
            'mb-3 w-80 rounded-2xl border border-gray-200 bg-white shadow-2xl',
            'overflow-hidden'
          )}
          role="dialog"
          aria-labelledby="timer-panel-title"
          aria-modal="false"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3
              id="timer-panel-title"
              className="text-sm font-semibold text-gray-900"
            >
              Νέα Καταγραφή Χρόνου
            </h3>
            <button
              type="button"
              onClick={() => {
                setShowPanel(false);
                setError(null);
                reset({ billable: true, billable_rate_eur_cents: 0 });
              }}
              aria-label="Κλείσιμο"
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          <form
            onSubmit={handleSubmit(onStartTimer)}
            noValidate
            className="space-y-3 p-4"
          >
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {error}
              </div>
            )}

            {/* Matter selector */}
            <div>
              <label
                htmlFor="timer-matter"
                className="mb-1 block text-xs font-medium text-gray-700"
              >
                Υπόθεση{' '}
                <span aria-hidden="true" className="text-red-500">
                  *
                </span>
              </label>
              <select
                {...register('matter_id')}
                id="timer-matter"
                aria-required="true"
                aria-invalid={errors.matter_id ? 'true' : undefined}
                className={cn(
                  'block w-full rounded-lg border px-3 py-2 text-sm text-gray-900',
                  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                  errors.matter_id ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
                )}
              >
                <option value="">— Επιλέξτε υπόθεση —</option>
                {matters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.matter_number} — {m.title}
                  </option>
                ))}
              </select>
              {errors.matter_id && (
                <p role="alert" className="mt-1 text-xs text-red-600">
                  {errors.matter_id.message}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="timer-description"
                className="mb-1 block text-xs font-medium text-gray-700"
              >
                Περιγραφή{' '}
                <span className="font-normal text-gray-400">
                  (προαιρετικό)
                </span>
              </label>
              <textarea
                {...register('description')}
                id="timer-description"
                rows={2}
                placeholder="π.χ. Σύνταξη αγωγής…"
                className={cn(
                  'block w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400',
                  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
                )}
              />
            </div>

            {/* Hourly rate + Billable */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label
                  htmlFor="timer-rate"
                  className="mb-1 block text-xs font-medium text-gray-700"
                >
                  Ωριαία αμοιβή (€)
                </label>
                <input
                  {...register('billable_rate_eur_cents', { valueAsNumber: true })}
                  id="timer-rate"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="150"
                  className={cn(
                    'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900',
                    'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
                  )}
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  {...register('billable')}
                  id="timer-billable"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <label
                  htmlFor="timer-billable"
                  className="text-xs font-medium text-gray-700"
                >
                  Χρεώσιμο
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              aria-label="Έναρξη χρονομέτρου"
              className={cn(
                'w-full rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white',
                'hover:bg-primary-600 transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
                'disabled:cursor-not-allowed disabled:opacity-60',
                'flex items-center justify-center gap-2'
              )}
            >
              <span aria-hidden="true">▶</span>
              {isSubmitting ? 'Εκκίνηση…' : 'Έναρξη Χρόνου'}
            </button>
          </form>
        </div>
      )}

      {/* Main Widget Button */}
      {activeEntry ? (
        /* Active timer */
        <div
          className={cn(
            'flex items-center gap-3 rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 shadow-lg',
            'ring-2 ring-primary-300/50'
          )}
        >
          {/* Pulse indicator */}
          <span
            className="relative flex h-3 w-3 flex-shrink-0"
            aria-hidden="true"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary-500" />
          </span>

          <div className="min-w-0">
            <p
              className="max-w-40 truncate text-xs font-medium text-primary-800"
              title={activeEntry.matter_title ?? 'Υπόθεση'}
            >
              {activeEntry.matter_title ?? 'Ενεργή εργασία'}
            </p>
            <p
              className="font-mono text-lg font-bold tabular-nums text-primary-700"
              aria-label={`Παρελθόν χρόνος: ${formatElapsedTime(elapsedSeconds)}`}
              aria-live="off"
            >
              {formatElapsedTime(elapsedSeconds)}
            </p>
          </div>

          <button
            type="button"
            onClick={handleStop}
            disabled={isLoading}
            aria-label="Παύση χρονομέτρου"
            className={cn(
              'ml-1 flex h-9 w-9 flex-shrink-0 items-center justify-center',
              'rounded-xl bg-primary-500 text-white shadow',
              'hover:bg-primary-600 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
              'disabled:cursor-not-allowed disabled:opacity-60'
            )}
          >
            {isLoading ? (
              <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <span aria-hidden="true" className="block h-3 w-3 rounded-sm bg-white" />
            )}
          </button>
        </div>
      ) : (
        /* Idle button */
        <button
          type="button"
          onClick={() => setShowPanel((prev) => !prev)}
          aria-label="Έναρξη καταγραφής χρόνου"
          aria-expanded={showPanel}
          className={cn(
            'flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-lg',
            'hover:border-primary-200 hover:bg-primary-50 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
          )}
        >
          <span aria-hidden="true" className="text-gray-400">
            ⏱
          </span>
          <span className="text-sm font-medium text-gray-700">
            Έναρξη Χρόνου
          </span>
        </button>
      )}
    </div>
  );
}
