'use client';

/**
 * InvoiceWizard — 4-step invoice creation wizard
 *
 * Step 1: Matter + Party selector
 *   - billing_split alert αν matter έχει multiple billing parties
 * Step 2: Preview unbilled time entries + expenses (checkboxes include/exclude)
 * Step 3: VAT rate, invoice date, due date, notes
 * Step 4: Preview totals + "Δημιουργία προσχεδίου"
 *
 * POST /api/v1/invoices/draft → redirect στο detail page
 *
 * Invariant #3: billing_split surface
 * Invariant #10: Greek labels everywhere
 */

import { useState, useEffect, useCallback } from 'react';
import { clientFetch, ApiClientError } from '@/lib/api-client';
import { formatEur } from '@/lib/currency';
import type {
  TimeEntry,
  Expense,
  Invoice,
} from '@/types/billing';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MatterOption {
  id: string;
  title: string;
  matter_number: string;
}

interface PartyOption {
  id: string;
  display_name: string;
  billing_split_percentage?: number | null;
}

interface BillingSplitParty extends PartyOption {
  billing_split_percentage: number;
}

interface WizardState {
  matter_id: string;
  bill_to_party_id: string;
  selected_time_entry_ids: Set<string>;
  selected_expense_ids: Set<string>;
  vat_rate_pct: number;
  invoice_date: string;
  due_date: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0] ?? '';
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

const MOCK_MATTERS: MatterOption[] = [
  { id: '10000000-0000-0000-0000-000000000001', title: 'Αγωγή Παπαδόπουλου κατά ΑΛΦΑ ΑΕ', matter_number: 'MAT-2026-001' },
  { id: '10000000-0000-0000-0000-000000000002', title: 'Σύμβαση Εξαγοράς ΒΗΤΑ ΑΕ', matter_number: 'MAT-2026-002' },
];

const MOCK_PARTIES: PartyOption[] = [
  { id: 'p-0000-0000-0000-000000000001', display_name: 'Παπαδόπουλος Κωνσταντίνος', billing_split_percentage: null },
  { id: 'p-0000-0000-0000-000000000002', display_name: 'ΑΛΦΑ ΑΕ', billing_split_percentage: null },
];

const MOCK_TIME_ENTRIES: TimeEntry[] = [
  {
    id: 'te-0000-0000-0000-000000000001',
    matter_id: '10000000-0000-0000-0000-000000000001',
    user_id: 'u1',
    started_at: new Date('2026-04-29T09:00:00').toISOString(),
    stopped_at: new Date('2026-04-29T11:30:00').toISOString(),
    duration_minutes: 150,
    description: 'Σύνταξη αγωγής',
    billable: true,
    billable_rate_eur_cents: 15000,
    billable_amount_eur_cents: 37500,
    status: 'draft',
    invoice_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    user_display_name: 'Νικόλαος Δικηγόρος',
  },
];

const MOCK_EXPENSES: Expense[] = [
  {
    id: 'exp-0000-0000-0000-000000000001',
    matter_id: '10000000-0000-0000-0000-000000000001',
    user_id: 'u1',
    expense_type: 'court_fee',
    amount_eur_cents: 15000,
    description: 'Παράβολο κατάθεσης',
    incurred_at: new Date('2026-04-28').toISOString(),
    document_id: null,
    status: 'draft',
    invoice_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS = [
  'Υπόθεση & Πελάτης',
  'Επιλογή Εγγραφών',
  'ΦΠΑ & Ημερομηνίες',
  'Επισκόπηση',
];

interface StepIndicatorProps {
  currentStep: number;
}

function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <nav aria-label="Βήματα οδηγού τιμολογίου" className="mb-6">
      <ol className="flex items-center">
        {STEPS.map((label, idx) => {
          const step = idx + 1;
          const isCompleted = step < currentStep;
          const isCurrent = step === currentStep;
          return (
            <li key={label} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold',
                    isCompleted && 'bg-primary-500 text-white',
                    isCurrent && 'border-2 border-primary-500 text-primary-600',
                    !isCompleted && !isCurrent && 'border-2 border-gray-200 text-gray-400'
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isCompleted ? '✓' : step}
                </div>
                <span
                  className={cn(
                    'mt-1 text-xs',
                    isCurrent ? 'font-medium text-primary-600' : 'text-gray-400'
                  )}
                >
                  {label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    'mx-2 flex-1 border-t-2 transition-colors',
                    isCompleted ? 'border-primary-500' : 'border-gray-200'
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

interface InvoiceWizardProps {
  open: boolean;
  onClose: () => void;
  preselectedTimeEntryIds?: string[];
}

export function InvoiceWizard({
  open,
  onClose,
  preselectedTimeEntryIds = [],
}: InvoiceWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [billingParties, setBillingParties] = useState<BillingSplitParty[]>([]);

  const [wizard, setWizard] = useState<WizardState>({
    matter_id: '',
    bill_to_party_id: '',
    selected_time_entry_ids: new Set(preselectedTimeEntryIds),
    selected_expense_ids: new Set(),
    vat_rate_pct: 24,
    invoice_date: todayIso(),
    due_date: addDays(30),
    notes: '',
  });

  // Fetch matters
  useEffect(() => {
    if (!open) return;
    clientFetch<{ data: MatterOption[] }>('/api/v1/matters?limit=100&status=active')
      .then((r) => setMatters(r.data ?? MOCK_MATTERS))
      .catch(() => setMatters(MOCK_MATTERS));
  }, [open]);

  // Fetch parties + billing split when matter selected
  const fetchMatterParties = useCallback(async (matterId: string) => {
    try {
      const r = await clientFetch<{ data: PartyOption[] }>(
        `/api/v1/matters/${matterId}/parties`
      );
      const data = r.data ?? MOCK_PARTIES;
      setParties(data);
      const splits = data.filter(
        (p): p is BillingSplitParty => p.billing_split_percentage !== null && p.billing_split_percentage !== undefined
      );
      setBillingParties(splits);
    } catch {
      setParties(MOCK_PARTIES);
      setBillingParties([]);
    }
  }, []);

  useEffect(() => {
    if (wizard.matter_id) {
      void fetchMatterParties(wizard.matter_id);
    }
  }, [wizard.matter_id, fetchMatterParties]);

  // Fetch unbilled items when matter selected
  useEffect(() => {
    if (!wizard.matter_id) return;

    const params = `matter_id=${wizard.matter_id}&status=draft&billable=true&limit=100`;

    clientFetch<{ data: TimeEntry[] }>(`/api/v1/time-entries?${params}`)
      .then((r) => {
        const data = r.data ?? MOCK_TIME_ENTRIES;
        setTimeEntries(data);
        setWizard((prev) => ({
          ...prev,
          selected_time_entry_ids: new Set(data.map((e) => e.id)),
        }));
      })
      .catch(() => {
        setTimeEntries(MOCK_TIME_ENTRIES);
        setWizard((prev) => ({
          ...prev,
          selected_time_entry_ids: new Set(MOCK_TIME_ENTRIES.map((e) => e.id)),
        }));
      });

    clientFetch<{ data: Expense[] }>(`/api/v1/expenses?matter_id=${wizard.matter_id}&status=draft&limit=100`)
      .then((r) => {
        const data = r.data ?? MOCK_EXPENSES;
        setExpenses(data);
        setWizard((prev) => ({
          ...prev,
          selected_expense_ids: new Set(data.map((e) => e.id)),
        }));
      })
      .catch(() => {
        setExpenses(MOCK_EXPENSES);
        setWizard((prev) => ({
          ...prev,
          selected_expense_ids: new Set(MOCK_EXPENSES.map((e) => e.id)),
        }));
      });
  }, [wizard.matter_id]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep(1);
      setError(null);
      setWizard({
        matter_id: '',
        bill_to_party_id: '',
        selected_time_entry_ids: new Set(preselectedTimeEntryIds),
        selected_expense_ids: new Set(),
        vat_rate_pct: 24,
        invoice_date: todayIso(),
        due_date: addDays(30),
        notes: '',
      });
    }
  }, [open, preselectedTimeEntryIds]);

  // ---------------------------------------------------------------------------
  // Computed totals
  // ---------------------------------------------------------------------------

  const selectedTimeEntries = timeEntries.filter((e) =>
    wizard.selected_time_entry_ids.has(e.id)
  );
  const selectedExpenses = expenses.filter((e) =>
    wizard.selected_expense_ids.has(e.id)
  );

  const subtotal =
    selectedTimeEntries.reduce(
      (sum, e) => sum + (e.billable_amount_eur_cents ?? 0),
      0
    ) +
    selectedExpenses.reduce((sum, e) => sum + e.amount_eur_cents, 0);

  const vatAmount = Math.round((subtotal * wizard.vat_rate_pct) / 100);
  const total = subtotal + vatAmount;

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const resp = await clientFetch<{ data: Invoice }>('/api/v1/invoices/draft', {
        method: 'POST',
        body: {
          matter_id: wizard.matter_id,
          bill_to_party_id: wizard.bill_to_party_id,
          time_entry_ids: Array.from(wizard.selected_time_entry_ids),
          expense_ids: Array.from(wizard.selected_expense_ids),
          vat_rate_pct: wizard.vat_rate_pct,
          invoice_date: wizard.invoice_date,
          due_date: wizard.due_date || null,
          notes: wizard.notes || null,
        },
      });
      onClose();
      router.push(`/invoices/${resp.data.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Σφάλμα δημιουργίας τιμολογίου');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render guards
  // ---------------------------------------------------------------------------

  if (!open) return null;

  const canProceedStep1 = wizard.matter_id && wizard.bill_to_party_id;
  const canProceedStep2 =
    wizard.selected_time_entry_ids.size > 0 ||
    wizard.selected_expense_ids.size > 0;
  const canProceedStep3 = wizard.invoice_date;

  // ---------------------------------------------------------------------------
  // Step renders
  // ---------------------------------------------------------------------------

  const renderStep1 = () => (
    <div className="space-y-4">
      {/* Billing split alert */}
      {billingParties.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
        >
          <p className="text-sm font-medium text-amber-800">
            Η υπόθεση έχει κατανομή χρέωσης (billing split)
          </p>
          <ul className="mt-1 space-y-0.5">
            {billingParties.map((p) => (
              <li key={p.id} className="text-xs text-amber-700">
                {p.display_name}: {p.billing_split_percentage}%
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-amber-600">
            Επιλέξτε τον συμβαλλόμενο για τον οποίο εκδίδεται αυτό το τιμολόγιο.
          </p>
        </div>
      )}

      {/* Matter */}
      <div>
        <label htmlFor="wiz-matter" className="mb-1.5 block text-sm font-medium text-gray-700">
          Υπόθεση <span aria-hidden="true" className="text-red-500">*</span>
        </label>
        <select
          id="wiz-matter"
          value={wizard.matter_id}
          onChange={(e) =>
            setWizard((prev) => ({ ...prev, matter_id: e.target.value, bill_to_party_id: '' }))
          }
          aria-required="true"
          className={cn(
            'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
            'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
            'border-gray-300 bg-white'
          )}
        >
          <option value="">— Επιλέξτε υπόθεση —</option>
          {matters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.matter_number} — {m.title}
            </option>
          ))}
        </select>
      </div>

      {/* Party */}
      <div>
        <label htmlFor="wiz-party" className="mb-1.5 block text-sm font-medium text-gray-700">
          Συμβαλλόμενος (Χρέωση) <span aria-hidden="true" className="text-red-500">*</span>
        </label>
        <select
          id="wiz-party"
          value={wizard.bill_to_party_id}
          onChange={(e) =>
            setWizard((prev) => ({ ...prev, bill_to_party_id: e.target.value }))
          }
          disabled={!wizard.matter_id}
          aria-required="true"
          className={cn(
            'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
            'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
            !wizard.matter_id ? 'cursor-not-allowed bg-gray-50 border-gray-200 text-gray-400' : 'border-gray-300 bg-white'
          )}
        >
          <option value="">— Επιλέξτε συμβαλλόμενο —</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
              {p.billing_split_percentage !== null && p.billing_split_percentage !== undefined
                ? ` (${p.billing_split_percentage}%)`
                : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
      {/* Time entries */}
      {timeEntries.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-800">
            Καταχωρήσεις Χρόνου ({timeEntries.length})
          </h4>
          <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
            {timeEntries.map((entry) => (
              <label key={entry.id} className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={wizard.selected_time_entry_ids.has(entry.id)}
                  onChange={() =>
                    setWizard((prev) => {
                      const next = new Set(prev.selected_time_entry_ids);
                      if (next.has(entry.id)) next.delete(entry.id);
                      else next.add(entry.id);
                      return { ...prev, selected_time_entry_ids: next };
                    })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {entry.description ?? 'Χωρίς περιγραφή'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDate(entry.started_at)} · {entry.duration_minutes}λ
                  </p>
                </div>
                <span className="text-sm font-medium text-gray-900">
                  {entry.billable_amount_eur_cents !== null
                    ? formatEur(entry.billable_amount_eur_cents)
                    : '—'}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Expenses */}
      {expenses.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-800">
            Έξοδα ({expenses.length})
          </h4>
          <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
            {expenses.map((exp) => (
              <label key={exp.id} className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={wizard.selected_expense_ids.has(exp.id)}
                  onChange={() =>
                    setWizard((prev) => {
                      const next = new Set(prev.selected_expense_ids);
                      if (next.has(exp.id)) next.delete(exp.id);
                      else next.add(exp.id);
                      return { ...prev, selected_expense_ids: next };
                    })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {exp.description ?? 'Χωρίς περιγραφή'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDate(exp.incurred_at)}
                  </p>
                </div>
                <span className="text-sm font-medium text-gray-900">
                  {formatEur(exp.amount_eur_cents)}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {timeEntries.length === 0 && expenses.length === 0 && (
        <div
          role="status"
          className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-8 text-center"
        >
          <p className="text-sm text-gray-500">
            Δεν βρέθηκαν μη τιμολογημένες εγγραφές για αυτή την υπόθεση.
          </p>
        </div>
      )}
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-4">
      {/* VAT rate */}
      <div>
        <label htmlFor="wiz-vat" className="mb-1.5 block text-sm font-medium text-gray-700">
          Συντελεστής ΦΠΑ (%)
        </label>
        <select
          id="wiz-vat"
          value={wizard.vat_rate_pct}
          onChange={(e) =>
            setWizard((prev) => ({
              ...prev,
              vat_rate_pct: parseInt(e.target.value, 10),
            }))
          }
          className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none"
        >
          <option value={24}>24%</option>
          <option value={13}>13%</option>
          <option value={6}>6%</option>
          <option value={0}>0% (Απαλλαγή)</option>
        </select>
      </div>

      {/* Invoice date + Due date */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="wiz-inv-date" className="mb-1.5 block text-sm font-medium text-gray-700">
            Ημ/νία Τιμολογίου <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <input
            id="wiz-inv-date"
            type="date"
            value={wizard.invoice_date}
            onChange={(e) =>
              setWizard((prev) => ({ ...prev, invoice_date: e.target.value }))
            }
            aria-required="true"
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="wiz-due-date" className="mb-1.5 block text-sm font-medium text-gray-700">
            Ημ/νία Λήξης{' '}
            <span className="font-normal text-gray-400">(προαιρετικό)</span>
          </label>
          <input
            id="wiz-due-date"
            type="date"
            value={wizard.due_date}
            onChange={(e) =>
              setWizard((prev) => ({ ...prev, due_date: e.target.value }))
            }
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="wiz-notes" className="mb-1.5 block text-sm font-medium text-gray-700">
          Σημειώσεις{' '}
          <span className="font-normal text-gray-400">(προαιρετικό)</span>
        </label>
        <textarea
          id="wiz-notes"
          rows={3}
          value={wizard.notes}
          onChange={(e) =>
            setWizard((prev) => ({ ...prev, notes: e.target.value }))
          }
          placeholder="Προαιρετικές σημειώσεις στο τιμολόγιο…"
          className="block w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none"
        />
      </div>
    </div>
  );

  const renderStep4 = () => {
    const selectedMatter = matters.find((m) => m.id === wizard.matter_id);
    const selectedParty = parties.find((p) => p.id === wizard.bill_to_party_id);
    return (
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Summary */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Υπόθεση</span>
            <span className="font-medium text-gray-900">
              {selectedMatter?.title ?? wizard.matter_id}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Πελάτης</span>
            <span className="font-medium text-gray-900">
              {selectedParty?.display_name ?? wizard.bill_to_party_id}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Ημ/νία Τιμολογίου</span>
            <span className="font-medium text-gray-900">
              {formatDate(wizard.invoice_date)}
            </span>
          </div>
          {wizard.due_date && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Ημ/νία Λήξης</span>
              <span className="font-medium text-gray-900">
                {formatDate(wizard.due_date)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">
              Εγγραφές χρόνου + Έξοδα
            </span>
            <span className="font-medium text-gray-900">
              {wizard.selected_time_entry_ids.size} + {wizard.selected_expense_ids.size}
            </span>
          </div>
        </div>

        {/* Totals */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Υποσύνολο</span>
            <span className="text-gray-900">{formatEur(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">ΦΠΑ {wizard.vat_rate_pct}%</span>
            <span className="text-gray-900">{formatEur(vatAmount)}</span>
          </div>
          <div className="border-t border-gray-100 pt-2 flex justify-between text-base font-semibold">
            <span className="text-gray-900">Σύνολο</span>
            <span className="text-primary-600">{formatEur(total)}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-labelledby="invoice-wizard-title"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 id="invoice-wizard-title" className="text-lg font-semibold text-gray-900">
            Νέο Τιμολόγιο
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο οδηγού τιμολογίου"
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: 'calc(90vh - 180px)' }}>
          <StepIndicator currentStep={step} />
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={() => step > 1 ? setStep((s) => s - 1) : onClose()}
            className={cn(
              'rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700',
              'hover:bg-gray-50 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
            )}
          >
            {step === 1 ? 'Ακύρωση' : '← Πίσω'}
          </button>

          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 1 && !canProceedStep1) ||
                (step === 2 && !canProceedStep2) ||
                (step === 3 && !canProceedStep3)
              }
              className={cn(
                'rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
                'hover:bg-primary-600 transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              Επόμενο →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              aria-label="Δημιουργία προσχεδίου τιμολογίου"
              className={cn(
                'rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
                'hover:bg-primary-600 transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
                'disabled:cursor-not-allowed disabled:opacity-60'
              )}
            >
              {isSubmitting ? 'Δημιουργία…' : 'Δημιουργία Προσχεδίου'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
