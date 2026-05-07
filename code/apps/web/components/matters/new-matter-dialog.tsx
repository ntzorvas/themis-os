'use client';

/**
 * NewMatterDialog — Client Component
 * Modal για δημιουργία νέας υπόθεσης.
 *
 * - title (required)
 * - matter_type select (required)
 * - status select (optional, default: prospective)
 * - opened_at date (optional, default: today)
 * - practice_area, court, court_case_number (optional)
 * - notes (optional)
 * - Greek error messages
 * - a11y: focus trap, ARIA dialog, keyboard nav
 *
 * POST → /api/v1/matters (proxied via Next.js rewrites to Fastify)
 */

import { useEffect, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import {
  CreateMatterSchema,
  MATTER_TYPES,
  MATTER_TYPE_LABELS,
  MATTER_STATUSES,
  MATTER_STATUS_LABELS,
  type CreateMatterInput,
  type Matter,
} from '@/types/matters';
import { clientFetch, ApiClientError } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewMatterDialogProps {
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewMatterDialog({ open, onClose }: NewMatterDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstInputId = 'matter-title';

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateMatterInput>({
    resolver: zodResolver(CreateMatterSchema),
    defaultValues: {
      status: 'prospective',
      opened_at: todayIso(),
    },
  });

  // -------------------------------------------------------------------------
  // Open/close synchronization
  // -------------------------------------------------------------------------

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      setTimeout(() => {
        const el = document.getElementById(firstInputId);
        if (el instanceof HTMLElement) el.focus();
      }, 50);
    } else {
      if (dialog.open) {
        dialog.close();
      }
      reset({ status: 'prospective', opened_at: todayIso() });
    }
  }, [open, reset]);

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

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const onSubmit = async (data: CreateMatterInput) => {
    // Normalize opened_at to ISO datetime if only date was given
    const payload: CreateMatterInput = {
      ...data,
      opened_at: data.opened_at
        ? new Date(data.opened_at).toISOString()
        : new Date().toISOString(),
    };

    try {
      await clientFetch<{ data: Matter }>('/api/v1/matters', {
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

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      aria-labelledby="new-matter-title"
      aria-modal="true"
      className={cn(
        'w-full max-w-xl rounded-2xl bg-white p-0 shadow-2xl',
        'backdrop:bg-black/40 backdrop:backdrop-blur-sm',
        'border-0 outline-none',
        'open:flex open:flex-col'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2
          id="new-matter-title"
          className="text-lg font-semibold text-gray-900"
        >
          Νέα Υπόθεση
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Κλείσιμο"
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full text-gray-400',
            'hover:bg-gray-100 hover:text-gray-700 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
          )}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {/* Form */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-5 overflow-y-auto px-6 py-5"
        style={{ maxHeight: 'calc(90vh - 120px)' }}
      >
        {/* Root error */}
        {errors.root && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errors.root.message}
          </div>
        )}

        {/* title */}
        <div>
          <label
            htmlFor="matter-title"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Τίτλος Υπόθεσης{' '}
            <span aria-hidden="true" className="text-red-500">
              *
            </span>
          </label>
          <input
            {...register('title')}
            id="matter-title"
            type="text"
            autoComplete="off"
            placeholder="π.χ. Αγωγή Παπαδόπουλου κατά ΑΛΦΑ ΑΕ"
            aria-required="true"
            aria-invalid={errors.title ? 'true' : undefined}
            aria-describedby={errors.title ? 'matter-title-error' : undefined}
            className={cn(
              'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              'transition-colors',
              errors.title
                ? 'border-red-400 bg-red-50'
                : 'border-gray-300 bg-white'
            )}
          />
          {errors.title && (
            <p
              id="matter-title-error"
              role="alert"
              className="mt-1 text-sm text-red-600"
            >
              {errors.title.message}
            </p>
          )}
        </div>

        {/* matter_type */}
        <div>
          <label
            htmlFor="matter-type"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Τύπος Υπόθεσης{' '}
            <span aria-hidden="true" className="text-red-500">
              *
            </span>
          </label>
          <select
            {...register('matter_type')}
            id="matter-type"
            aria-required="true"
            aria-invalid={errors.matter_type ? 'true' : undefined}
            className={cn(
              'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              'transition-colors',
              errors.matter_type
                ? 'border-red-400 bg-red-50'
                : 'border-gray-300 bg-white'
            )}
          >
            <option value="">— Επιλέξτε τύπο —</option>
            {MATTER_TYPES.map((type) => (
              <option key={type} value={type}>
                {MATTER_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          {errors.matter_type && (
            <p role="alert" className="mt-1 text-sm text-red-600">
              {errors.matter_type.message}
            </p>
          )}
        </div>

        {/* status + opened_at — row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="matter-status"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Κατάσταση
            </label>
            <select
              {...register('status')}
              id="matter-status"
              className={cn(
                'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                'transition-colors'
              )}
            >
              {MATTER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {MATTER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="matter-opened-at"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Ημ/νία Άνοιξης
            </label>
            <input
              {...register('opened_at')}
              id="matter-opened-at"
              type="date"
              className={cn(
                'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                'transition-colors'
              )}
            />
          </div>
        </div>

        {/* practice_area */}
        <div>
          <label
            htmlFor="matter-practice-area"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Κλάδος Δικαίου{' '}
            <span className="font-normal text-gray-400">(προαιρετικό)</span>
          </label>
          <input
            {...register('practice_area')}
            id="matter-practice-area"
            type="text"
            placeholder="π.χ. Εμπορικό Δίκαιο"
            className={cn(
              'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              'transition-colors'
            )}
          />
        </div>

        {/* court + court_case_number — row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="matter-court"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Δικαστήριο{' '}
              <span className="font-normal text-gray-400">(προαιρετικό)</span>
            </label>
            <input
              {...register('court')}
              id="matter-court"
              type="text"
              placeholder="π.χ. Πρωτοδικείο Αθηνών"
              className={cn(
                'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                'transition-colors'
              )}
            />
          </div>

          <div>
            <label
              htmlFor="matter-case-number"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              ΑΡ.ΚΑΤ.{' '}
              <span className="font-normal text-gray-400">(προαιρετικό)</span>
            </label>
            <input
              {...register('court_case_number')}
              id="matter-case-number"
              type="text"
              placeholder="π.χ. 1234/2026"
              className={cn(
                'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                'transition-colors'
              )}
            />
          </div>
        </div>

        {/* notes */}
        <div>
          <label
            htmlFor="matter-notes"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Σημειώσεις{' '}
            <span className="font-normal text-gray-400">(προαιρετικό)</span>
          </label>
          <textarea
            {...register('notes')}
            id="matter-notes"
            rows={3}
            placeholder="Προαιρετικές σημειώσεις για την υπόθεση…"
            className={cn(
              'block w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              'transition-colors'
            )}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Ακύρωση και κλείσιμο"
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
            aria-label="Αποθήκευση νέας υπόθεσης"
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
