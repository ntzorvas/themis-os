'use client';

/**
 * ExpensesClient — Client Component
 * Λίστα εξόδων με φίλτρα, "Νέο Έξοδο" modal, pagination.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter as useRouterForRefresh } from 'next/navigation';
import {
  EXPENSE_TYPES,
  EXPENSE_TYPE_LABELS,
  EXPENSE_STATUS_LABELS,
  CreateExpenseSchema,
  type ExpensesListResponse,
  type Expense,
  type ExpenseStatus,
  type CreateExpenseInput,
} from '@/types/billing';
import { clientFetch, ApiClientError } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('el-GR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

const MOCK_MATTERS = [
  { id: '10000000-0000-0000-0000-000000000001', title: 'Αγωγή Παπαδόπουλου κατά ΑΛΦΑ ΑΕ', matter_number: 'MAT-2026-001' },
  { id: '10000000-0000-0000-0000-000000000002', title: 'Σύμβαση Εξαγοράς ΒΗΤΑ ΑΕ', matter_number: 'MAT-2026-002' },
];

// ---------------------------------------------------------------------------
// New Expense Dialog (inline)
// ---------------------------------------------------------------------------

interface NewExpenseDialogProps {
  open: boolean;
  onClose: () => void;
}

function NewExpenseDialog({ open, onClose }: NewExpenseDialogProps) {
  const router = useRouterForRefresh();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [matters, setMatters] = useState(MOCK_MATTERS);
  // amount display as euros (user input), store as cents internally
  const [amountEurDisplay, setAmountEurDisplay] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateExpenseInput>({
    resolver: zodResolver(CreateExpenseSchema),
    defaultValues: { incurred_at: todayIso() },
  });

  useEffect(() => {
    if (!open) return;
    clientFetch<{ data: typeof MOCK_MATTERS[0][] }>('/api/v1/matters?limit=100&status=active')
      .then((r) => setMatters(r.data ?? MOCK_MATTERS))
      .catch(() => setMatters(MOCK_MATTERS));
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
      reset({ incurred_at: todayIso() });
      setAmountEurDisplay('');
    }
  }, [open, reset]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAmountEurDisplay(val);
    const euros = parseFloat(val.replace(',', '.'));
    if (!isNaN(euros) && euros >= 0) {
      setValue('amount_eur_cents', Math.round(euros * 100), {
        shouldValidate: true,
      });
    }
  };

  const onSubmit = async (data: CreateExpenseInput) => {
    try {
      await clientFetch('/api/v1/expenses', {
        method: 'POST',
        body: {
          ...data,
          incurred_at: new Date(data.incurred_at).toISOString(),
        },
      });
      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError('root', { message: err.message });
      } else {
        setError('root', { message: 'Σφάλμα επικοινωνίας με τον διακομιστή' });
      }
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="new-expense-title"
      aria-modal="true"
      className={cn(
        'w-full max-w-lg rounded-2xl bg-white p-0 shadow-2xl',
        'backdrop:bg-black/40 backdrop:backdrop-blur-sm',
        'border-0 outline-none open:flex open:flex-col'
      )}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2 id="new-expense-title" className="text-lg font-semibold text-gray-900">
          Νέο Έξοδο
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
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errors.root.message}
          </div>
        )}

        {/* Matter */}
        <div>
          <label htmlFor="exp-matter" className="mb-1.5 block text-sm font-medium text-gray-700">
            Υπόθεση <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <select
            {...register('matter_id')}
            id="exp-matter"
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
            <p role="alert" className="mt-1 text-sm text-red-600">{errors.matter_id.message}</p>
          )}
        </div>

        {/* Expense type */}
        <div>
          <label htmlFor="exp-type" className="mb-1.5 block text-sm font-medium text-gray-700">
            Τύπος Εξόδου <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <select
            {...register('expense_type')}
            id="exp-type"
            aria-required="true"
            aria-invalid={errors.expense_type ? 'true' : undefined}
            className={cn(
              'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              errors.expense_type ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
            )}
          >
            <option value="">— Επιλέξτε τύπο —</option>
            {EXPENSE_TYPES.map((t) => (
              <option key={t} value={t}>{EXPENSE_TYPE_LABELS[t]}</option>
            ))}
          </select>
          {errors.expense_type && (
            <p role="alert" className="mt-1 text-sm text-red-600">{errors.expense_type.message}</p>
          )}
        </div>

        {/* Amount + Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="exp-amount" className="mb-1.5 block text-sm font-medium text-gray-700">
              Ποσό (€) <span aria-hidden="true" className="text-red-500">*</span>
            </label>
            {/* Hidden field for cents */}
            <input
              {...register('amount_eur_cents', { valueAsNumber: true })}
              type="hidden"
            />
            <input
              id="exp-amount"
              type="number"
              min="0"
              step="0.01"
              value={amountEurDisplay}
              onChange={handleAmountChange}
              aria-required="true"
              aria-invalid={errors.amount_eur_cents ? 'true' : undefined}
              placeholder="150.00"
              className={cn(
                'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                errors.amount_eur_cents ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
              )}
            />
            {errors.amount_eur_cents && (
              <p role="alert" className="mt-1 text-sm text-red-600">{errors.amount_eur_cents.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="exp-date" className="mb-1.5 block text-sm font-medium text-gray-700">
              Ημ/νία <span aria-hidden="true" className="text-red-500">*</span>
            </label>
            <input
              {...register('incurred_at')}
              id="exp-date"
              type="date"
              aria-required="true"
              className={cn(
                'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
              )}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="exp-desc" className="mb-1.5 block text-sm font-medium text-gray-700">
            Περιγραφή <span className="font-normal text-gray-400">(προαιρετικό)</span>
          </label>
          <textarea
            {...register('description')}
            id="exp-desc"
            rows={2}
            placeholder="π.χ. Παράβολο κατάθεσης αγωγής"
            className={cn(
              'block w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'
            )}
          />
        </div>

        <div className="flex gap-3 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
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
            className={cn(
              'flex-1 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
              'hover:bg-primary-600 transition-colors disabled:cursor-not-allowed disabled:opacity-60'
            )}
          >
            {isSubmitting ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

interface ExpensesClientProps {
  response: ExpensesListResponse;
  perPage: number;
  formatEur: (cents: number) => string;
}

export function ExpensesClient({
  response,
  perPage,
  formatEur,
}: ExpensesClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [newExpenseOpen, setNewExpenseOpen] = useState(false);

  const { data: expenses, meta } = response;
  const currentOffset = parseInt(searchParams.get('offset') ?? '0', 10);
  const currentPage = Math.floor(currentOffset / perPage) + 1;
  const totalPages = Math.ceil(meta.total / perPage);

  const goToPage = useCallback(
    (page: number) => {
      const next = new URLSearchParams(searchParams.toString());
      const offset = (page - 1) * perPage;
      if (offset === 0) next.delete('offset');
      else next.set('offset', String(offset));
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams, perPage]
  );

  const setFilter = useCallback(
    (key: string, value: string | undefined) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('offset');
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Έξοδα</h1>
          <p className="mt-1 text-sm text-gray-500">Σύνολο: {meta.total} εγγραφές</p>
        </div>
        <button
          type="button"
          onClick={() => setNewExpenseOpen(true)}
          aria-label="Νέο έξοδο"
          className={cn(
            'rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
            'hover:bg-primary-600 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
          )}
        >
          + Νέο Έξοδο
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label htmlFor="exp-filter-status" className="mb-1 block text-xs font-medium text-gray-600">
              Κατάσταση
            </label>
            <select
              id="exp-filter-status"
              value={searchParams.get('status') ?? ''}
              onChange={(e) => setFilter('status', e.target.value || undefined)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none"
            >
              <option value="">Όλες</option>
              <option value="draft">Προσχέδιο</option>
              <option value="billed">Τιμολογήθηκε</option>
            </select>
          </div>
          <div>
            <label htmlFor="exp-filter-from" className="mb-1 block text-xs font-medium text-gray-600">
              Από
            </label>
            <input
              id="exp-filter-from"
              type="date"
              value={searchParams.get('from') ?? ''}
              onChange={(e) => setFilter('from', e.target.value || undefined)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="exp-filter-to" className="mb-1 block text-xs font-medium text-gray-600">
              Έως
            </label>
            <input
              id="exp-filter-to"
              type="date"
              value={searchParams.get('to') ?? ''}
              onChange={(e) => setFilter('to', e.target.value || undefined)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {expenses.length === 0 ? (
        <div
          role="status"
          className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center"
        >
          <p className="text-gray-500">Δεν βρέθηκαν έξοδα.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table
            className="min-w-full divide-y divide-gray-200"
            aria-label="Λίστα εξόδων"
          >
            <thead className="bg-gray-50">
              <tr>
                {['Ημ/νία', 'Υπόθεση', 'Τύπος', 'Περιγραφή', 'Ποσό', 'Κατάσταση'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {expenses.map((exp: Expense) => (
                <tr key={exp.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatDate(exp.incurred_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-gray-900">
                      {exp.matter_title ?? exp.matter_id}
                    </span>
                    {exp.matter_number && (
                      <span className="ml-1 font-mono text-xs text-gray-400">
                        #{exp.matter_number}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {EXPENSE_TYPE_LABELS[exp.expense_type]}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-sm text-gray-500">
                    <span className="block truncate" title={exp.description ?? undefined}>
                      {exp.description ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {formatEur(exp.amount_eur_cents)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      exp.status === 'draft' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
                    )}>
                      {EXPENSE_STATUS_LABELS[exp.status as ExpenseStatus] ?? exp.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav aria-label="Σελιδοποίηση εξόδων" className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Σελίδα <strong>{currentPage} από {totalPages}</strong> (σύνολο {meta.total})
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              aria-label="Προηγούμενη σελίδα"
              className={cn(
                'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
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

      <NewExpenseDialog
        open={newExpenseOpen}
        onClose={() => setNewExpenseOpen(false)}
      />
    </div>
  );
}
