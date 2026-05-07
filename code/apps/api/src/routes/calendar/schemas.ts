/**
 * Calendar route schemas — Zod definitions με Greek error messages.
 *
 * calendar_event_type_t ENUMs match 0002_template_schema.sql + 0006 extension:
 *   'hearing' | 'meeting' | 'deadline' | 'internal' | 'personal' | 'court_holiday' | 'custom'
 *
 * @module routes/calendar/schemas
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enum constants
// ---------------------------------------------------------------------------

export const CALENDAR_EVENT_KINDS = [
  'hearing',
  'meeting',
  'deadline',
  'internal',
  'personal',
  'court_holiday',
  'custom',
] as const;

export type CalendarEventKind = typeof CALENDAR_EVENT_KINDS[number];

// ---------------------------------------------------------------------------
// Calculate deadline endpoint
// ---------------------------------------------------------------------------

export const CalculateDeadlineSchema = z.object({
  rule_id: z
    .string({ required_error: 'rule_id είναι υποχρεωτικό.' })
    .min(1, 'rule_id δεν μπορεί να είναι κενό.'),
  trigger_date: z
    .string({ required_error: 'trigger_date είναι υποχρεωτική.' })
    .datetime({ message: 'trigger_date πρέπει να είναι έγκυρη ISO 8601 ημερομηνία (πχ "2026-01-15T00:00:00Z").' }),
  party_residency: z
    .enum(['domestic', 'eu', 'overseas'], {
      errorMap: () => ({ message: 'party_residency πρέπει να είναι: domestic, eu, ή overseas.' }),
    })
    .optional(),
  custom_extension_days: z
    .number({ invalid_type_error: 'custom_extension_days πρέπει να είναι αριθμός.' })
    .int('custom_extension_days πρέπει να είναι ακέραιος.')
    .min(0, 'custom_extension_days δεν μπορεί να είναι αρνητικός.')
    .optional(),
});

export type CalculateDeadlineInput = z.infer<typeof CalculateDeadlineSchema>;

// ---------------------------------------------------------------------------
// Create event endpoint
// ---------------------------------------------------------------------------

export const CreateCalendarEventSchema = z.object({
  matter_id: z
    .string({ required_error: 'matter_id είναι υποχρεωτικό.' })
    .uuid('matter_id πρέπει να είναι έγκυρο UUID.'),
  party_id: z
    .string()
    .uuid('party_id πρέπει να είναι έγκυρο UUID.')
    .optional(),
  event_type: z.enum(CALENDAR_EVENT_KINDS, {
    errorMap: () => ({
      message: `event_type πρέπει να είναι ένα από: ${CALENDAR_EVENT_KINDS.join(', ')}.`,
    }),
  }),
  title_gr: z
    .string({ required_error: 'title_gr είναι υποχρεωτικός.' })
    .min(1, 'title_gr δεν μπορεί να είναι κενός.')
    .max(500, 'title_gr υπερβαίνει τα 500 χαρακτήρες.'),
  description_gr: z
    .string()
    .max(5000, 'description_gr υπερβαίνει τα 5000 χαρακτήρες.')
    .optional(),
  occurs_at: z
    .string()
    .datetime({ message: 'occurs_at πρέπει να είναι έγκυρη ISO 8601 ημερομηνία.' })
    .optional(),
  all_day: z
    .boolean()
    .optional()
    .default(false),
  location: z
    .string()
    .max(500, 'location υπερβαίνει τα 500 χαρακτήρες.')
    .optional(),
  // If deadline_rule_id is set, occurs_at is auto-calculated
  deadline_rule_id: z
    .string()
    .min(1, 'deadline_rule_id δεν μπορεί να είναι κενό.')
    .optional(),
  deadline_trigger_date: z
    .string()
    .datetime({ message: 'deadline_trigger_date πρέπει να είναι έγκυρη ISO 8601 ημερομηνία.' })
    .optional(),
  deadline_party_residency: z
    .enum(['domestic', 'eu', 'overseas'], {
      errorMap: () => ({ message: 'deadline_party_residency πρέπει να είναι: domestic, eu, ή overseas.' }),
    })
    .optional(),
  source_event_id: z
    .string()
    .uuid('source_event_id πρέπει να είναι έγκυρο UUID.')
    .optional(),
});

export type CreateCalendarEventInput = z.infer<typeof CreateCalendarEventSchema>;

// ---------------------------------------------------------------------------
// Patch event endpoint
// ---------------------------------------------------------------------------

export const PatchCalendarEventSchema = z.object({
  event_type: z.enum(CALENDAR_EVENT_KINDS, {
    errorMap: () => ({
      message: `event_type πρέπει να είναι ένα από: ${CALENDAR_EVENT_KINDS.join(', ')}.`,
    }),
  }).optional(),
  title_gr: z
    .string()
    .min(1, 'title_gr δεν μπορεί να είναι κενός.')
    .max(500, 'title_gr υπερβαίνει τα 500 χαρακτήρες.')
    .optional(),
  description_gr: z
    .string()
    .max(5000, 'description_gr υπερβαίνει τα 5000 χαρακτήρες.')
    .optional(),
  occurs_at: z
    .string()
    .datetime({ message: 'occurs_at πρέπει να είναι έγκυρη ISO 8601 ημερομηνία.' })
    .optional(),
  all_day: z
    .boolean()
    .optional(),
  location: z
    .string()
    .max(500, 'location υπερβαίνει τα 500 χαρακτήρες.')
    .optional(),
  // Manual override: recalculate occurs_at from deadline_rule_id + trigger
  recalculate_deadline: z
    .boolean()
    .optional()
    .default(false),
  deadline_trigger_date: z
    .string()
    .datetime({ message: 'deadline_trigger_date πρέπει να είναι έγκυρη ISO 8601 ημερομηνία.' })
    .optional(),
  deadline_party_residency: z
    .enum(['domestic', 'eu', 'overseas'], {
      errorMap: () => ({ message: 'deadline_party_residency πρέπει να είναι: domestic, eu, ή overseas.' }),
    })
    .optional(),
}).refine(
  (data) => Object.keys(data).filter((k) => k !== 'recalculate_deadline').length > 0,
  { message: 'Τουλάχιστον ένα πεδίο πρέπει να παρέχεται για ενημέρωση.' }
);

export type PatchCalendarEventInput = z.infer<typeof PatchCalendarEventSchema>;
