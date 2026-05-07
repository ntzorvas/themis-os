'use client';

/**
 * PaymentDialog — Καταγραφή πληρωμής σε τιμολόγιο
 *
 * - Amount (€ input → cents)
 * - Date paid
 * - Method (Μετρητά / Τραπεζική κατάθεση / Κάρτα / POS / Άλλο)
 * - Reference (free text)
 * - POST /api/v1/invoices/:id/payments
 *
 * Invariant #10: Greek labels everywhere
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  CreatePaymentSchema,
  type CreatePaymentInput,
  type Payment,
} from '@/types/billing';
import { clientFetch, ApiClientError } from '@/lib/api-client';
import { formatEur } from '@/lib/currency';

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
// Props
// ---------------------------------------------------------------------------

interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  outstandingCents: number;
}

// ---------------------------------------------------------------------------
// Internal form state
// ---------------------------------------------------------------------------

interface PaymentFormState {
  amount_eur_display: string;
  method: CreatePaymentInput['method'];
  paid_at: string;
  reference: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PaymentDialog({
  open,
  onClose,
  invoiceId,
  outstandingCents,
}: PaymentDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [amountDisplay, setAmountDisplay] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreatePaymentInput>({
    resolver: zodResolver(CreatePaymentSchema),
    defaultValues: {
      paid_at: todayIso(),
      method: 'bank_transfer',
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      // Pre-fill with outstanding amount
      const outstandingEur = outstandingCents / 100;
      const display = outstandingEur.toFixed(2);
      setAmountDisplay(display);
      setValue(
        'amount_eur_cents',
        outstandingCents,
        { shouldValidate: false }
      );
      setTimeout(() => {
        dialog.querySelector<HTMLInputElement>('input[type="number"]')?.focus();
      }, 50);
    } else {
      if (dialog.open) dialog.close();
      reset({ paid_at: todayIso(), method: 'bank_transfer' });
      setAmountDisplay('');
    }
  }, [open, reset, setValue, outstandingCents]);

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

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAmountDisplay(val);
    const euros = parseFloat(val.replace(',', '.'));
    if (!isNaN(euros) && euros > 0) {
      setValue('amount_eur_cents', Math.round(euros * 100), {
        shouldValidate: true,
      });
    }
  };

  const onSubmit = async (data: CreatePaymentInput) => {
    try {
      await clientFetch<{ data: Payment }>(
        `/api/v1/invoices/${invoiceId}/payments`,
        {
          method: 'POST',
          body: data,
        }
      );
      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError('root', { message: err.message });
      } else {
        setError('root', {
          message: 'Σφάλμα καταγραφής πληρωμής',
        });
      }
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      aria-labelledby="payment-dialog-title"
      aria-modal="true"
      className={cn(
        'w-full max-w-md rounded-2xl bg-white p-0 shadow-2xl',
        'backdrop:bg-black/40 backdrop:backdrop-blur-sm',
        'border-0 outline-none open:flex open:flex-col'
      )}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2
          id="payment-dialog-title"
          className="text-lg font-semibold text-gray-900"
        >
          Καταγραφή Πληρωμής
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
        className="space-y-4 px-6 py-5"
      >
        {errors.root && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errors.root.message}
          </div>
        )}

        {/* Outstanding info */}
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-xs text-blue-600">Εκκρεμές υπόλοιπο</p>
          <p className="text-lg font-bold text-blue-800">
            {formatEur(outstandingCents)}
          </p>
        </div>

        {/* Amount */}
        <div>
          <label
            htmlFor="pay-amount"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Ποσό Πληρωμής (€){' '}
            <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          {/* Hidden field for cents */}
          <input
            {...register('amount_eur_cents', { valueAsNumber: true })}
            type="hidden"
          />
          <input
            id="pay-amount"
            type="number"
            min="0.01"
            step="0.01"
            value={amountDisplay}
            onChange={handleAmountChange}
            aria-required="true"
            aria-invalid={errors.amount_eur_cents ? 'true' : undefined}
            aria-describedby={
              errors.amount_eur_cents ? 'pay-amount-error' : undefined
            }
            className={cn(
              'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              errors.amount_eur_cents
                ? 'border-red-400 bg-red-50'
                : 'border-gray-300 bg-white'
            )}
          />
          {errors.amount_eur_cents && (
            <p
              id="pay-amount-error"
              role="alert"
              className="mt-1 text-sm text-red-600"
            >
              {errors.amount_eur_cents.message}
            </p>
          )}
        </div>

        {/* Date + Method */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="pay-date"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Ημ/νία Πληρωμής{' '}
              <span aria-hidden="true" className="text-red-500">*</span>
            </label>
            <input
              {...register('paid_at')}
              id="pay-date"
              type="date"
              aria-required="true"
              aria-invalid={errors.paid_at ? 'true' : undefined}
              className={cn(
                'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                errors.paid_at
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-300 bg-white'
              )}
            />
            {errors.paid_at && (
              <p role="alert" className="mt-1 text-sm text-red-600">
                {errors.paid_at.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="pay-method"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Τρόπος Πληρωμής{' '}
              <span aria-hidden="true" className="text-red-500">*</span>
            </label>
            <select
              {...register('method')}
              id="pay-method"
              aria-required="true"
              aria-invalid={errors.method ? 'true' : undefined}
              className={cn(
                'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                errors.method
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-300 bg-white'
              )}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
            {errors.method && (
              <p role="alert" className="mt-1 text-sm text-red-600">
                {errors.method.message}
              </p>
            )}
          </div>
        </div>

        {/* Reference */}
        <div>
          <label
            htmlFor="pay-ref"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Κωδικός Αναφοράς{' '}
            <span className="font-normal text-gray-400">(προαιρετικό)</span>
          </label>
          <input
            {...register('reference')}
            id="pay-ref"
            type="text"
            placeholder="π.χ. αριθμός εντολής κατάθεσης"
            className={cn(
              'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
            )}
          />
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
              'hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            Ακύρωση
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            aria-label="Καταγραφή πληρωμής"
            className={cn(
              'flex-1 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
              'hover:bg-primary-600 transition-colors disabled:cursor-not-allowed disabled:opacity-60'
            )}
          >
            {isSubmitting ? 'Καταγραφή…' : 'Καταγραφή Πληρωμής'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
