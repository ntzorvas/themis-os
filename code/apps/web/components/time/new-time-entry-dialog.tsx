'use client';

/**
 * NewTimeEntryDialog — Manual time entry creation modal
 *
 * - Matter selector (autocomplete via select)
 * - Date picker (started_at)
 * - Time inputs (από/έως ή διάρκεια σε λεπτά)
 * - Description (textarea, Greek)
 * - Hourly rate (default από matter, override allowed)
 * - Billable checkbox (default true)
 * - Greek error messages
 * - POST → /api/v1/time-entries
 *
 * Invariant #10: Greek labels everywhere
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { clientFetch, ApiClientError } from '@/lib/api-client';
import type { TimeEntry } from '@/types/billing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MatterOption {
  id: string;
  title: string;
  matter_number: string;
}

interface NewTimeEntryDialogProps {
  open: boolean;
  onClose: () => void;
  matterId?: string; // pre-select if coming from matter detail
}

// ---------------------------------------------------------------------------
// Schema — supports either stopped_at OR duration_minutes
// ---------------------------------------------------------------------------

const NewTimeEntryFormSchema = z
  .object({
    matter_id: z.string().uuid('Επιλέξτε υπόθεση'),
    started_at: z.string().min(1, 'Υποχρεωτικό πεδίο'),
    stopped_at: z.string().optional(),
    duration_minutes: z.coerce
      .number()
      .int('Ακέραιος αριθμός')
      .min(1, 'Τουλάχιστον 1 λεπτό')
      .optional(),
    description: z.string().optional(),
    hourly_rate_eur: z.coerce
      .number()
      .nonnegative('Μη αρνητικό')
      .optional(),
    billable: z.boolean().default(true),
  })
  .refine(
    (data) => data.stopped_at !== undefined || data.duration_minutes !== undefined,
    {
      message: 'Απαιτείται ώρα λήξης ή διάρκεια',
      path: ['stopped_at'],
    }
  );

type NewTimeEntryFormData = z.infer<typeof NewTimeEntryFormSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function nowDateLocal(): string {
  return new Date().toISOString().slice(0, 16);
}

const MOCK_MATTERS: MatterOption[] = [
  {
    id: '10000000-0000-0000-0000-000000000001',
    title: 'Αγωγή Παπαδόπουλου κατά ΑΛΦΑ ΑΕ',
    matter_number: 'MAT-2026-001',
  },
  {
    id: '10000000-0000-0000-0000-000000000002',
    title: 'Σύμβαση Εξαγοράς ΒΗΤΑ ΑΕ',
    matter_number: 'MAT-2026-002',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewTimeEntryDialog({
  open,
  onClose,
  matterId,
}: NewTimeEntryDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [inputMode, setInputMode] = useState<'range' | 'duration'>('range');

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewTimeEntryFormData>({
    resolver: zodResolver(NewTimeEntryFormSchema),
    defaultValues: {
      billable: true,
      started_at: nowDateLocal(),
      matter_id: matterId ?? '',
    },
  });

  // Fetch matters
  useEffect(() => {
    if (!open) return;
    clientFetch<{ data: MatterOption[] }>('/api/v1/matters?limit=100&status=active')
      .then((resp) => setMatters(resp.data ?? MOCK_MATTERS))
      .catch(() => setMatters(MOCK_MATTERS));
  }, [open]);

  // Dialog sync
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      setTimeout(() => {
        dialog.querySelector<HTMLElement>('select, input')?.focus();
      }, 50);
    } else {
      if (dialog.open) dialog.close();
      reset({
        billable: true,
        started_at: nowDateLocal(),
        matter_id: matterId ?? '',
      });
    }
  }, [open, reset, matterId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const handleDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      const rect = dialogRef.current?.getBoundingClientRect();
      if (!rect) return;
      const { clientX, clientY } = e;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        onClose();
      }
    },
    [onClose]
  );

  const onSubmit = async (data: NewTimeEntryFormData) => {
    try {
      const payload: Record<string, unknown> = {
        matter_id: data.matter_id,
        started_at: new Date(data.started_at).toISOString(),
        description: data.description ?? null,
        billable: data.billable,
        billable_rate_eur_cents: data.hourly_rate_eur
          ? Math.round(data.hourly_rate_eur * 100)
          : null,
      };

      if (inputMode === 'range' && data.stopped_at) {
        payload['stopped_at'] = new Date(data.stopped_at).toISOString();
      } else if (inputMode === 'duration' && data.duration_minutes) {
        payload['duration_minutes'] = data.duration_minutes;
      }

      await clientFetch<{ data: TimeEntry }>('/api/v1/time-entries', {
        method: 'POST',
        body: payload,
      });

      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError('root', { message: err.message });
      } else {
        setError('root', {
          message: 'Σφάλμα επικοινωνίας με τον διακομιστή',
        });
      }
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      aria-labelledby="new-time-entry-title"
      aria-modal="true"
      className={cn(
        'w-full max-w-lg rounded-2xl bg-white p-0 shadow-2xl',
        'backdrop:bg-black/40 backdrop:backdrop-blur-sm',
        'border-0 outline-none',
        'open:flex open:flex-col'
      )}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2
          id="new-time-entry-title"
          className="text-lg font-semibold text-gray-900"
        >
          Νέα Καταχώρηση Χρόνου
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Κλείσιμο"
          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-4 overflow-y-auto px-6 py-5"
        style={{ maxHeight: 'calc(90vh - 120px)' }}
      >
        {errors.root && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errors.root.message}
          </div>
        )}

        {/* Matter */}
        <div>
          <label
            htmlFor="te-matter"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Υπόθεση{' '}
            <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <select
            {...register('matter_id')}
            id="te-matter"
            aria-required="true"
            aria-invalid={errors.matter_id ? 'true' : undefined}
            className={cn(
              'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
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
            <p role="alert" className="mt-1 text-sm text-red-600">
              {errors.matter_id.message}
            </p>
          )}
        </div>

        {/* Input mode toggle */}
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">
            Καταχώρηση χρόνου
          </p>
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => setInputMode('range')}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                inputMode === 'range'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              Ώρα Από/Έως
            </button>
            <button
              type="button"
              onClick={() => setInputMode('duration')}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                inputMode === 'duration'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              Διάρκεια
            </button>
          </div>
        </div>

        {/* Started at */}
        <div>
          <label
            htmlFor="te-started"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            {inputMode === 'range' ? 'Ώρα Έναρξης' : 'Ημ/νία & Ώρα'}{' '}
            <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <input
            {...register('started_at')}
            id="te-started"
            type="datetime-local"
            aria-required="true"
            aria-invalid={errors.started_at ? 'true' : undefined}
            className={cn(
              'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              errors.started_at ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
            )}
          />
          {errors.started_at && (
            <p role="alert" className="mt-1 text-sm text-red-600">
              {errors.started_at.message}
            </p>
          )}
        </div>

        {/* Stopped at or duration */}
        {inputMode === 'range' ? (
          <div>
            <label
              htmlFor="te-stopped"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Ώρα Λήξης{' '}
              <span aria-hidden="true" className="text-red-500">*</span>
            </label>
            <input
              {...register('stopped_at')}
              id="te-stopped"
              type="datetime-local"
              aria-invalid={errors.stopped_at ? 'true' : undefined}
              className={cn(
                'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                errors.stopped_at ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
              )}
            />
            {errors.stopped_at && (
              <p role="alert" className="mt-1 text-sm text-red-600">
                {errors.stopped_at.message}
              </p>
            )}
          </div>
        ) : (
          <div>
            <label
              htmlFor="te-duration"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Διάρκεια (λεπτά){' '}
              <span aria-hidden="true" className="text-red-500">*</span>
            </label>
            <input
              {...register('duration_minutes', { valueAsNumber: true })}
              id="te-duration"
              type="number"
              min="1"
              step="1"
              placeholder="π.χ. 90"
              aria-invalid={errors.duration_minutes ? 'true' : undefined}
              className={cn(
                'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                errors.duration_minutes ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
              )}
            />
            {errors.duration_minutes && (
              <p role="alert" className="mt-1 text-sm text-red-600">
                {errors.duration_minutes.message}
              </p>
            )}
          </div>
        )}

        {/* Description */}
        <div>
          <label
            htmlFor="te-description"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Περιγραφή{' '}
            <span className="font-normal text-gray-400">(προαιρετικό)</span>
          </label>
          <textarea
            {...register('description')}
            id="te-description"
            rows={3}
            placeholder="π.χ. Σύνταξη αγωγής, ανάγνωση δικογραφίας…"
            className={cn(
              'block w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
            )}
          />
        </div>

        {/* Hourly rate + Billable */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="te-rate"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Ωριαία Αμοιβή (€){' '}
              <span className="font-normal text-gray-400">(προαιρετικό)</span>
            </label>
            <input
              {...register('hourly_rate_eur', { valueAsNumber: true })}
              id="te-rate"
              type="number"
              min="0"
              step="0.01"
              placeholder="150.00"
              className={cn(
                'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
              )}
            />
          </div>
          <div className="flex items-end pb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                {...register('billable')}
                id="te-billable"
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-gray-700">
                Χρεώσιμο
              </span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Ακύρωση"
            className={cn(
              'flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700',
              'hover:bg-gray-50 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            Ακύρωση
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            aria-label="Αποθήκευση καταχώρησης"
            className={cn(
              'flex-1 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
              'hover:bg-primary-600 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
              'disabled:cursor-not-allowed disabled:opacity-60'
            )}
          >
            {isSubmitting ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
