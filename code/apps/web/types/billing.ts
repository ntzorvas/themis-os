// Billing — TypeScript types + Zod schemas για Time Entries, Expenses, Invoices
// Αναφορά: docs/v03/build-plan-v03.md §Billing Module
// Invariant #10: Greek labels everywhere
// Currency: ΠΑΝΤΑ cents (BIGINT-compatible) — ΠΟΤΕ float
// Contract fix (Day 9.5): aligned to DB schema 0002

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Time Entry
// ---------------------------------------------------------------------------

export const TIME_ENTRY_STATUSES = ['draft', 'billed'] as const;
export type TimeEntryStatus = (typeof TIME_ENTRY_STATUSES)[number];

export const TIME_ENTRY_STATUS_LABELS: Record<TimeEntryStatus, string> = {
  draft: 'Προσχέδιο',
  billed: 'Τιμολογήθηκε',
};

export const TIME_ENTRY_STATUS_COLORS: Record<TimeEntryStatus, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  billed: 'bg-green-100 text-green-800',
};

export const TimeEntrySchema = z.object({
  id: z.string().uuid(),
  matter_id: z.string().uuid(),
  user_id: z.string().uuid(),
  started_at: z.string().datetime(),
  stopped_at: z.string().datetime().nullable(),
  duration_minutes: z.number().int().nullable(),
  description: z.string().nullable(),
  billable: z.boolean(),
  billable_rate_eur_cents: z.number().int().nullable(),
  billable_amount_eur_cents: z.number().int().nullable(),
  status: z.enum(TIME_ENTRY_STATUSES),
  invoice_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  // Joined fields from API
  matter_title: z.string().optional(),
  matter_number: z.string().optional(),
  user_display_name: z.string().optional(),
});

export type TimeEntry = z.infer<typeof TimeEntrySchema>;

export const CreateTimeEntrySchema = z.object({
  matter_id: z.string().uuid('Επιλέξτε υπόθεση'),
  started_at: z.string().min(1, 'Υποχρεωτικό πεδίο'),
  stopped_at: z.string().optional(),
  duration_minutes: z.number().int().positive('Θετικός αριθμός').optional(),
  description: z.string().optional(),
  billable: z.boolean().default(true),
  billable_rate_eur_cents: z.number().int().nonnegative().optional(),
});

export type CreateTimeEntryInput = z.infer<typeof CreateTimeEntrySchema>;

export const StopTimeEntrySchema = z.object({
  stopped_at: z.string().optional(),
});

export type StopTimeEntryInput = z.infer<typeof StopTimeEntrySchema>;

export interface TimeEntriesListResponse {
  data: TimeEntry[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

export interface ActiveTimerResponse {
  data: TimeEntry | null;
}

export interface TimeEntriesQueryParams {
  matter_id?: string;
  user_id?: string;
  billable?: boolean;
  status?: TimeEntryStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Expense
// ---------------------------------------------------------------------------

export const EXPENSE_TYPES = [
  'court_fee',
  'expert_fee',
  'translation',
  'travel',
  'courier',
  'other',
] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  court_fee: 'Δικαστικά τέλη',
  expert_fee: 'Αμοιβή πραγματογνώμονα',
  translation: 'Μεταφράσεις',
  travel: 'Μετακινήσεις',
  courier: 'Ταχυμεταφορά',
  other: 'Άλλο',
};

export const EXPENSE_STATUSES = ['draft', 'billed'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  draft: 'Προσχέδιο',
  billed: 'Τιμολογήθηκε',
};

export const ExpenseSchema = z.object({
  id: z.string().uuid(),
  matter_id: z.string().uuid(),
  user_id: z.string().uuid(),
  expense_type: z.enum(EXPENSE_TYPES),
  amount_eur_cents: z.number().int().nonnegative(),
  description: z.string().nullable(),
  incurred_at: z.string().datetime(),
  document_id: z.string().uuid().nullable(),
  status: z.enum(EXPENSE_STATUSES),
  invoice_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  // Joined
  matter_title: z.string().optional(),
  matter_number: z.string().optional(),
});

export type Expense = z.infer<typeof ExpenseSchema>;

export const CreateExpenseSchema = z.object({
  matter_id: z.string().uuid('Επιλέξτε υπόθεση'),
  expense_type: z.enum(EXPENSE_TYPES, {
    errorMap: () => ({ message: 'Επιλέξτε τύπο εξόδου' }),
  }),
  amount_eur_cents: z
    .number()
    .int('Ακέραιος')
    .positive('Θετικό ποσό σε λεπτά'),
  description: z.string().optional(),
  incurred_at: z.string().min(1, 'Υποχρεωτικό πεδίο'),
  document_id: z.string().uuid().optional(),
});

export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;

export interface ExpensesListResponse {
  data: Expense[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

// ---------------------------------------------------------------------------
// Invoice Line — source pattern (Day 9.5 contract fix)
// ---------------------------------------------------------------------------

export const INVOICE_LINE_SOURCES = ['time', 'expense', 'manual', 'grammatio'] as const;
export type InvoiceLineSource = (typeof INVOICE_LINE_SOURCES)[number];

export const InvoiceLineSchema = z.object({
  id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  unit_price_eur_cents: z.number().int(),
  line_total_eur_cents: z.number().int(),
  source_type: z.enum(INVOICE_LINE_SOURCES).nullable(),
  source_id: z.string().uuid().nullable(),
});

export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'sent',
  'paid',
  'overdue',
  'cancelled',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Προσχέδιο',
  issued: 'Εκδοθέν',
  sent: 'Απεσταλμένο',
  paid: 'Εξοφλημένο',
  overdue: 'Ληξιπρόθεσμο',
  cancelled: 'Ακυρωμένο',
};

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  issued: 'bg-blue-100 text-blue-800',
  sent: 'bg-indigo-100 text-indigo-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-500',
};

export const InvoiceSchema = z.object({
  id: z.string().uuid(),
  invoice_number: z.string(),
  matter_id: z.string().uuid(),
  bill_to_party_id: z.string().uuid(),
  status: z.enum(INVOICE_STATUSES),
  invoice_date: z.string(),
  due_date: z.string().nullable(),
  subtotal_eur_cents: z.number().int(),
  vat_rate_pct: z.number(),
  vat_amount_eur_cents: z.number().int(),
  total_eur_cents: z.number().int(),
  paid_eur_cents: z.number().int(),
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  // Joined
  matter_title: z.string().optional(),
  matter_number: z.string().optional(),
  party_display_name: z.string().optional(),
  lines: z.array(InvoiceLineSchema).optional(),
});

export type Invoice = z.infer<typeof InvoiceSchema>;

export const CreateInvoiceDraftSchema = z.object({
  matter_id: z.string().uuid('Επιλέξτε υπόθεση'),
  bill_to_party_id: z.string().uuid('Επιλέξτε συμβαλλόμενο'),
  time_entry_ids: z.array(z.string().uuid()),
  expense_ids: z.array(z.string().uuid()),
  vat_rate_pct: z.number().min(0).max(100).default(24),
  invoice_date: z.string().min(1, 'Υποχρεωτικό πεδίο'),
  due_date: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateInvoiceDraftInput = z.infer<typeof CreateInvoiceDraftSchema>;

export interface InvoicesListResponse {
  data: Invoice[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

export interface InvoiceDetailResponse {
  data: Invoice & { lines: InvoiceLine[] };
}

export interface InvoicesQueryParams {
  matter_id?: string;
  bill_to_party_id?: string;
  status?: InvoiceStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = [
  'bank_transfer',
  'viva',
  'ethniki',
  'cash',
  'check',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: 'Τραπεζικό έμβασμα',
  viva: 'Viva Wallet',
  ethniki: 'Εθνική Τράπεζα POS',
  cash: 'Μετρητά',
  check: 'Επιταγή',
  other: 'Άλλο',
};

export const PaymentSchema = z.object({
  id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  amount_eur_cents: z.number().int().positive(),
  paid_at: z.string(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().nullable(),
  created_at: z.string().datetime(),
});

export type Payment = z.infer<typeof PaymentSchema>;

export const CreatePaymentSchema = z.object({
  amount_eur_cents: z
    .number()
    .int('Ακέραιος')
    .positive('Θετικό ποσό'),
  paid_at: z.string().min(1, 'Υποχρεωτικό πεδίο'),
  method: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: 'Επιλέξτε τρόπο πληρωμής' }),
  }),
  reference: z.string().optional(),
});

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface BillingSummaryResponse {
  data: {
    total_invoiced_eur_cents: number;
    total_paid_eur_cents: number;
    total_outstanding_eur_cents: number;
    realization_rate_pct: number;
    invoice_count: number;
    paid_count: number;
  };
}
