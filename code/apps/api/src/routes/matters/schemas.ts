/**
 * Matter route schemas — Zod definitions με Greek error messages.
 *
 * ENUMs match 0002_template_schema.sql exactly:
 *   matter_party_role_t : client | counterparty | witness | expert | court | judge | opposing_counsel | other
 *   matter_party_side_t : ours | opponent | neutral
 *   matter_status_t     : prospective | active | dormant | closed | archived
 *   matter_type_t       : litigation | transactional | advisory | regulatory | criminal | family | labor | admin | tax | other
 *   billing_method_t    : hourly | fixed | contingency | retainer | pro_bono
 *
 * @module routes/matters/schemas
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enum constants (exported so index.ts can reference for runtime checks)
// ---------------------------------------------------------------------------

export const MATTER_STATUSES = [
  'prospective', 'active', 'dormant', 'closed', 'archived',
] as const;

export const MATTER_TYPES = [
  'litigation', 'transactional', 'advisory', 'regulatory',
  'criminal', 'family', 'labor', 'admin', 'tax', 'other',
] as const;

export const BILLING_METHODS = [
  'hourly', 'fixed', 'contingency', 'retainer', 'pro_bono',
] as const;

export const MATTER_PARTY_ROLES = [
  'client', 'counterparty', 'witness', 'expert', 'court',
  'judge', 'opposing_counsel', 'other',
] as const;

export const MATTER_PARTY_SIDES = ['ours', 'opponent', 'neutral'] as const;

export const REPRESENTATION_STATUSES = [
  'representing', 'represented_by_other', 'not_represented',
] as const;

// Valid status transitions (directed graph)
export const STATUS_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  prospective: ['active', 'archived'],
  active:      ['dormant', 'closed', 'archived'],
  dormant:     ['active', 'closed', 'archived'],
  closed:      ['active', 'archived'],
  archived:    [],
};

// ---------------------------------------------------------------------------
// Matter CRUD schemas
// ---------------------------------------------------------------------------

export const CreateMatterSchema = z.object({
  matter_number: z
    .string({ required_error: 'matter_number είναι υποχρεωτικό.' })
    .min(1, 'matter_number δεν μπορεί να είναι κενό.')
    .max(100, 'matter_number υπερβαίνει τα 100 χαρακτήρες.'),
  title: z
    .string({ required_error: 'title είναι υποχρεωτικό.' })
    .min(1, 'title δεν μπορεί να είναι κενό.')
    .max(500, 'title υπερβαίνει τα 500 χαρακτήρες.'),
  matter_type: z.enum(MATTER_TYPES, {
    errorMap: () => ({
      message: `matter_type πρέπει να είναι ένα από: ${MATTER_TYPES.join(', ')}.`,
    }),
  }),
  status: z
    .enum(MATTER_STATUSES, {
      errorMap: () => ({
        message: `status πρέπει να είναι ένα από: ${MATTER_STATUSES.join(', ')}.`,
      }),
    })
    .optional()
    .default('prospective'),
  lead_attorney_user_id: z
    .string()
    .uuid('lead_attorney_user_id πρέπει να είναι έγκυρο UUID.')
    .optional(),
  practice_area: z.string().max(200).optional(),
  court: z.string().max(200).optional(),
  court_case_number: z.string().max(100).optional(),
  privilege_level: z
    .enum(['standard', 'privileged'], {
      errorMap: () => ({ message: 'privilege_level πρέπει να είναι "standard" ή "privileged".' }),
    })
    .optional()
    .default('standard'),
  estimated_value_eur_cents: z
    .number()
    .int('estimated_value_eur_cents πρέπει να είναι ακέραιος (cents).')
    .nonnegative('estimated_value_eur_cents δεν μπορεί να είναι αρνητικό.')
    .optional(),
  billing_method: z
    .enum(BILLING_METHODS, {
      errorMap: () => ({
        message: `billing_method πρέπει να είναι ένα από: ${BILLING_METHODS.join(', ')}.`,
      }),
    })
    .optional()
    .default('hourly'),
  statute_of_limitations: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'statute_of_limitations: μορφή YYYY-MM-DD.')
    .optional(),
  legal_hold: z.boolean().optional().default(false),
  notes: z.string().max(10000).optional(),
  tags: z.array(z.string().max(100)).optional().default([]),
  department_id: z
    .string()
    .uuid('department_id πρέπει να είναι έγκυρο UUID.')
    .optional(),
  custom_fields: z.record(z.unknown()).optional().default({}),
});

export type CreateMatterInput = z.infer<typeof CreateMatterSchema>;

export const PatchMatterSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    matter_type: z.enum(MATTER_TYPES).optional(),
    status: z.enum(MATTER_STATUSES).optional(),
    lead_attorney_user_id: z.string().uuid().optional(),
    practice_area: z.string().max(200).optional(),
    court: z.string().max(200).optional(),
    court_case_number: z.string().max(100).optional(),
    privilege_level: z.enum(['standard', 'privileged']).optional(),
    estimated_value_eur_cents: z.number().int().nonnegative().optional(),
    billing_method: z.enum(BILLING_METHODS).optional(),
    statute_of_limitations: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'statute_of_limitations: μορφή YYYY-MM-DD.')
      .optional(),
    legal_hold: z.boolean().optional(),
    notes: z.string().max(10000).optional(),
    tags: z.array(z.string().max(100)).optional(),
    department_id: z.string().uuid().optional(),
    custom_fields: z.record(z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Τουλάχιστον ένα πεδίο απαιτείται για ενημέρωση.',
  });

export type PatchMatterInput = z.infer<typeof PatchMatterSchema>;

// ---------------------------------------------------------------------------
// matter_party schemas
// ---------------------------------------------------------------------------

export const AttachPartySchema = z.object({
  party_id: z
    .string({ required_error: 'party_id είναι υποχρεωτικό.' })
    .uuid('party_id πρέπει να είναι έγκυρο UUID.'),
  role: z.enum(MATTER_PARTY_ROLES, {
    errorMap: () => ({
      message: `role πρέπει να είναι ένα από: ${MATTER_PARTY_ROLES.join(', ')}.`,
    }),
  }),
  side: z.enum(MATTER_PARTY_SIDES, {
    errorMap: () => ({
      message: `side πρέπει να είναι ένα από: ${MATTER_PARTY_SIDES.join(', ')}.`,
    }),
  }),
  representation_status: z
    .enum(REPRESENTATION_STATUSES, {
      errorMap: () => ({
        message: `representation_status πρέπει να είναι ένα από: ${REPRESENTATION_STATUSES.join(', ')}.`,
      }),
    })
    .optional()
    .default('not_represented'),
  representing_counsel_party_id: z
    .string()
    .uuid('representing_counsel_party_id πρέπει να είναι έγκυρο UUID.')
    .optional(),
  billing_split_percentage: z
    .number()
    .min(0, 'billing_split_percentage δεν μπορεί να είναι αρνητικό.')
    .max(100, 'billing_split_percentage δεν μπορεί να υπερβαίνει το 100.')
    .optional(),
  billing_split_locked: z.boolean().optional().default(false),
  is_primary_contact: z.boolean().optional().default(false),
  notes: z.string().max(2000).optional(),
});

export type AttachPartyInput = z.infer<typeof AttachPartySchema>;

export const PatchMatterPartySchema = z
  .object({
    role: z.enum(MATTER_PARTY_ROLES).optional(),
    side: z.enum(MATTER_PARTY_SIDES).optional(),
    representation_status: z.enum(REPRESENTATION_STATUSES).optional(),
    representing_counsel_party_id: z.string().uuid().optional(),
    billing_split_percentage: z.number().min(0).max(100).optional(),
    billing_split_locked: z.boolean().optional(),
    is_primary_contact: z.boolean().optional(),
    valid_to: z
      .string()
      .datetime({ message: 'valid_to πρέπει να είναι έγκυρο ISO 8601 datetime.' })
      .optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Τουλάχιστον ένα πεδίο απαιτείται για ενημέρωση.',
  });

export type PatchMatterPartyInput = z.infer<typeof PatchMatterPartySchema>;
