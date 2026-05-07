// Calendar — shared TypeScript types για το Calendar module
// Αναφορά: docs/api-architecture.md §Calendar
// Invariant #10: Greek labels everywhere

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'hearing',
  'deadline',
  'meeting',
  'court_holiday',
  'custom',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  hearing: 'Δικάσιμος',
  deadline: 'Προθεσμία',
  meeting: 'Συνάντηση',
  court_holiday: 'Δικαστική Αργία',
  custom: 'Άλλο',
};

export const EVENT_TYPE_COLORS: Record<EventType, string> = {
  hearing: 'bg-blue-100 text-blue-800 border-blue-200',
  deadline: 'bg-red-100 text-red-800 border-red-200',
  meeting: 'bg-green-100 text-green-800 border-green-200',
  court_holiday: 'bg-gray-100 text-gray-700 border-gray-200',
  custom: 'bg-purple-100 text-purple-800 border-purple-200',
};

export const EVENT_TYPE_DOT_COLORS: Record<EventType, string> = {
  hearing: 'bg-blue-500',
  deadline: 'bg-red-500',
  meeting: 'bg-green-500',
  court_holiday: 'bg-gray-400',
  custom: 'bg-purple-500',
};

export const PARTY_RESIDENCIES = [
  'domestic',
  'eu',
  'foreign',
] as const;
export type PartyResidency = (typeof PARTY_RESIDENCIES)[number];

export const PARTY_RESIDENCY_LABELS: Record<PartyResidency, string> = {
  domestic: 'Εντός Ελλάδος',
  eu: 'Κράτος ΕΕ',
  foreign: 'Εξωτερικό (εκτός ΕΕ)',
};

// ---------------------------------------------------------------------------
// Rule categories for grouping dropdown
// ---------------------------------------------------------------------------

export const RULE_CATEGORIES = [
  'Τακτική Διαδικασία',
  'Ένδικα Μέσα',
  'Εκτέλεση',
  'Ασφαλιστικά',
  'Ειδικές Διαδικασίες',
  'Παραγραφή',
  'Γενικοί Κανόνες',
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Calendar Rule
// ---------------------------------------------------------------------------

export interface CalendarRule {
  rule_id: string;
  kpold_article: string;
  title_gr: string;
  description_gr: string;
  trigger_event: string;
  deadline_kind: string;
  business_days_only: boolean;
  skip_august: boolean;
  weekend_rollover: string;
  notes_gr: string;
  frequency_score: number;
  category: RuleCategory;
  // v2 fields
  requires_legal_review?: boolean;
  legal_source?: string;
  warnings_gr?: string[];
  effective_from?: string;
  effective_until?: string | null;
  version?: string;
}

export interface CalendarRulesResponse {
  data: CalendarRule[];
}

// ---------------------------------------------------------------------------
// Calendar Event
// ---------------------------------------------------------------------------

export const CalendarEventSchema = z.object({
  id: z.string().uuid(),
  matter_id: z.string().uuid().nullable(),
  title_gr: z.string().min(1),
  description_gr: z.string().nullable(),
  event_type: z.enum(EVENT_TYPES),
  occurs_at: z.string().datetime(),
  all_day: z.boolean(),
  location: z.string().nullable(),
  deadline_rule_id: z.string().nullable(),
  trigger_date: z.string().nullable(),
  party_residency: z.enum(PARTY_RESIDENCIES).nullable(),
  is_calculated: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

// ---------------------------------------------------------------------------
// Deadline calculation
// ---------------------------------------------------------------------------

export interface DeadlineAdjustment {
  type: 'august_suspension' | 'weekend_rollover' | 'foreign_extension' | 'business_days';
  description_gr: string;
  days_added: number;
}

export interface DeadlineCalculationResult {
  deadline_date: string;          // ISO date (YYYY-MM-DD)
  raw_deadline_date: string;      // before adjustments
  rule_applied: string;
  adjustments: DeadlineAdjustment[];
  warnings_gr: string[];
  // v2 fields
  legal_source?: string;
  requires_legal_review?: boolean;
}

export interface DeadlineCalculationRequest {
  rule_id: string;
  trigger_date: string;           // ISO date
  party_residency: PartyResidency;
  custom_extension_days?: number;
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface CalendarEventsResponse {
  data: CalendarEvent[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

export interface CalendarEventDetailResponse {
  data: CalendarEvent;
}

export interface CalendarEventsQueryParams {
  matter_id?: string;
  from?: string;
  to?: string;
  event_type?: EventType;
  page?: number;
  per_page?: number;
}

// ---------------------------------------------------------------------------
// Create event input
// ---------------------------------------------------------------------------

export const CreateCalendarEventSchema = z.object({
  title_gr: z.string().min(1, 'Υποχρεωτικό πεδίο'),
  description_gr: z.string().optional(),
  event_type: z.enum(EVENT_TYPES, {
    errorMap: () => ({ message: 'Επιλέξτε τύπο γεγονότος' }),
  }),
  occurs_at: z.string().min(1, 'Υποχρεωτικό πεδίο'),
  all_day: z.boolean().optional().default(false),
  location: z.string().optional(),
  matter_id: z.string().uuid('Μη έγκυρο αναγνωριστικό υπόθεσης').optional(),
  deadline_rule_id: z.string().optional(),
  trigger_date: z.string().optional(),
  party_residency: z.enum(PARTY_RESIDENCIES).optional(),
  custom_extension_days: z.number().int().min(0).optional(),
});

export type CreateCalendarEventInput = z.infer<typeof CreateCalendarEventSchema>;

// ---------------------------------------------------------------------------
// Greek locale helpers
// ---------------------------------------------------------------------------

export const GREEK_MONTHS_FULL: Record<number, string> = {
  0: 'Ιανουάριος',
  1: 'Φεβρουάριος',
  2: 'Μάρτιος',
  3: 'Απρίλιος',
  4: 'Μάιος',
  5: 'Ιούνιος',
  6: 'Ιούλιος',
  7: 'Αύγουστος',
  8: 'Σεπτέμβριος',
  9: 'Οκτώβριος',
  10: 'Νοέμβριος',
  11: 'Δεκέμβριος',
};

export const GREEK_MONTHS_GEN: Record<number, string> = {
  0: 'Ιανουαρίου',
  1: 'Φεβρουαρίου',
  2: 'Μαρτίου',
  3: 'Απριλίου',
  4: 'Μαΐου',
  5: 'Ιουνίου',
  6: 'Ιουλίου',
  7: 'Αυγούστου',
  8: 'Σεπτεμβρίου',
  9: 'Οκτωβρίου',
  10: 'Νοεμβρίου',
  11: 'Δεκεμβρίου',
};

export const GREEK_DAYS_FULL: Record<number, string> = {
  0: 'Κυριακή',
  1: 'Δευτέρα',
  2: 'Τρίτη',
  3: 'Τετάρτη',
  4: 'Πέμπτη',
  5: 'Παρασκευή',
  6: 'Σάββατο',
};

export const GREEK_DAYS_SHORT: Record<number, string> = {
  0: 'Κυρ',
  1: 'Δευ',
  2: 'Τρι',
  3: 'Τετ',
  4: 'Πεμ',
  5: 'Παρ',
  6: 'Σαβ',
};

// ---------------------------------------------------------------------------
// Mock data — χρησιμοποιείται αν backend δεν απαντά
// ---------------------------------------------------------------------------

export const MOCK_EVENTS: CalendarEvent[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    matter_id: null,
    title_gr: 'Δικάσιμος Παπαδόπουλου κατά ΑΛΦΑ ΑΕ',
    description_gr: 'Πρωτοδικείο Αθηνών, αίθουσα 15',
    event_type: 'hearing',
    occurs_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    all_day: false,
    location: 'Πρωτοδικείο Αθηνών',
    deadline_rule_id: null,
    trigger_date: null,
    party_residency: null,
    is_calculated: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    matter_id: null,
    title_gr: 'Προθεσμία κατάθεσης προτάσεων',
    description_gr: 'ΚΠολΔ 237§1 — τακτική διαδικασία',
    event_type: 'deadline',
    occurs_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    all_day: true,
    location: null,
    deadline_rule_id: 'kpold-237-protaseis-taktiki',
    trigger_date: null,
    party_residency: null,
    is_calculated: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    matter_id: null,
    title_gr: 'Συνάντηση με πελάτη',
    description_gr: null,
    event_type: 'meeting',
    occurs_at: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
    all_day: false,
    location: 'Γραφείο',
    deadline_rule_id: null,
    trigger_date: null,
    party_residency: null,
    is_calculated: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];
