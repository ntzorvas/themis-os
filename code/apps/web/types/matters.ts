// Matters — shared TypeScript types για το Matters module
// Αναφορά: docs/v03/build-plan-v03.md §Matter Management
// Invariant #2: Unified Party Model — parties via matter_party M2M
// Invariant #10: Greek labels everywhere

import { z } from 'zod';
import { PartySchema, type PartyRole } from '@/types/parties';

// ---------------------------------------------------------------------------
// Enums — mirror DB ENUMs from 0002_template_schema.sql
// ---------------------------------------------------------------------------

export const MATTER_STATUSES = [
  'prospective',
  'active',
  'dormant',
  'closed',
  'archived',
] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

export const MATTER_STATUS_LABELS: Record<MatterStatus, string> = {
  prospective: 'Υποψήφια',
  active: 'Ενεργή',
  dormant: 'Αδρανής',
  closed: 'Κλειστή',
  archived: 'Αρχειοθετημένη',
};

export const MATTER_STATUS_COLORS: Record<MatterStatus, string> = {
  prospective: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  dormant: 'bg-gray-100 text-gray-600',
  closed: 'bg-red-100 text-red-700',
  archived: 'bg-slate-100 text-slate-600',
};

export const MATTER_TYPES = [
  'litigation',
  'transactional',
  'advisory',
  'regulatory',
  'criminal',
  'family',
  'labor',
  'admin',
  'tax',
  'other',
] as const;
export type MatterType = (typeof MATTER_TYPES)[number];

export const MATTER_TYPE_LABELS: Record<MatterType, string> = {
  litigation: 'Δικαστική Διαφορά',
  transactional: 'Συναλλαγή',
  advisory: 'Νομική Συμβουλή',
  regulatory: 'Ρυθμιστική Συμμόρφωση',
  criminal: 'Ποινική Υπόθεση',
  family: 'Οικογενειακό Δίκαιο',
  labor: 'Εργατικό Δίκαιο',
  admin: 'Διοικητικό Δίκαιο',
  tax: 'Φορολογικό Δίκαιο',
  other: 'Άλλο',
};

// matter_party_side_t ENUM — "ours" / "opponent" / "neutral"
// Note: DB uses "opponent" but spec/Greek labels say "Αντίδικη πλευρά" for opponent
export const MATTER_PARTY_SIDES = ['ours', 'opponent', 'neutral'] as const;
export type MatterPartySide = (typeof MATTER_PARTY_SIDES)[number];

export const MATTER_PARTY_SIDE_LABELS: Record<MatterPartySide, string> = {
  ours: 'Δική μας πλευρά',
  opponent: 'Αντίδικη πλευρά',
  neutral: 'Ουδέτερος',
};

export const MATTER_PARTY_SIDE_COLORS: Record<MatterPartySide, string> = {
  ours: 'bg-blue-100 text-blue-800',
  opponent: 'bg-red-100 text-red-800',
  neutral: 'bg-gray-100 text-gray-600',
};

// matter_party_role_t ENUM
export const MATTER_PARTY_ROLES = [
  'client',
  'counterparty',
  'witness',
  'expert',
  'court',
  'judge',
  'opposing_counsel',
  'other',
] as const;
export type MatterPartyRole = (typeof MATTER_PARTY_ROLES)[number];

export const MATTER_PARTY_ROLE_LABELS: Record<MatterPartyRole, string> = {
  client: 'Πελάτης',
  counterparty: 'Αντίδικος',
  witness: 'Μάρτυρας',
  expert: 'Πραγματογνώμονας',
  court: 'Δικαστήριο',
  judge: 'Δικαστής',
  opposing_counsel: 'Πληρεξούσιος Αντιδίκου',
  other: 'Άλλο',
};

export const MATTER_PARTY_ROLE_COLORS: Record<MatterPartyRole, string> = {
  client: 'bg-blue-100 text-blue-800',
  counterparty: 'bg-red-100 text-red-800',
  witness: 'bg-yellow-100 text-yellow-800',
  expert: 'bg-green-100 text-green-800',
  court: 'bg-slate-100 text-slate-700',
  judge: 'bg-slate-100 text-slate-700',
  opposing_counsel: 'bg-purple-100 text-purple-800',
  other: 'bg-gray-100 text-gray-600',
};

// ---------------------------------------------------------------------------
// Matter model
// ---------------------------------------------------------------------------

export const MatterSchema = z.object({
  id: z.string().uuid(),
  matter_number: z.string(),
  title: z.string().min(1),
  matter_type: z.enum(MATTER_TYPES),
  status: z.enum(MATTER_STATUSES),
  opened_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable(),
  lead_attorney_user_id: z.string().uuid().nullable(),
  practice_area: z.string().nullable(),
  court: z.string().nullable(),
  court_case_number: z.string().nullable(),
  privilege_level: z.enum(['standard', 'privileged']),
  estimated_value_eur_cents: z.number().int().nullable(),
  billing_method: z.enum(['hourly', 'fixed', 'contingency', 'retainer', 'pro_bono']),
  retainer_balance_eur_cents: z.number().int(),
  statute_of_limitations: z.string().nullable(),
  legal_hold: z.boolean(),
  ethical_wall: z.boolean(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  department_id: z.string().uuid().nullable(),
  custom_fields: z.record(z.unknown()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  // Computed fields returned by API list endpoint
  party_count: z.number().int().optional(),
});

export type Matter = z.infer<typeof MatterSchema>;

// ---------------------------------------------------------------------------
// MatterParty — junction row joined with party details
// ---------------------------------------------------------------------------

export const MatterPartySchema = z.object({
  id: z.string().uuid(),
  matter_id: z.string().uuid(),
  party_id: z.string().uuid(),
  role: z.enum(MATTER_PARTY_ROLES),
  side: z.enum(MATTER_PARTY_SIDES),
  representation_status: z.enum([
    'representing',
    'represented_by_other',
    'not_represented',
  ]),
  billing_split_percentage: z.number().nullable(),
  billing_split_locked: z.boolean(),
  is_primary_contact: z.boolean(),
  valid_from: z.string().datetime(),
  valid_to: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  // Joined party data
  party: PartySchema,
});

export type MatterParty = z.infer<typeof MatterPartySchema>;

// ---------------------------------------------------------------------------
// API request shapes
// ---------------------------------------------------------------------------

export const CreateMatterSchema = z.object({
  title: z.string().min(1, 'Υποχρεωτικό πεδίο'),
  matter_type: z.enum(MATTER_TYPES, {
    errorMap: () => ({ message: 'Επιλέξτε τύπο υπόθεσης' }),
  }),
  status: z.enum(MATTER_STATUSES).optional().default('prospective'),
  opened_at: z.string().optional(),
  practice_area: z.string().optional(),
  court: z.string().optional(),
  court_case_number: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateMatterInput = z.infer<typeof CreateMatterSchema>;

export const AddPartyToMatterSchema = z.object({
  party_id: z.string().uuid('Επιλέξτε συμβαλλόμενο'),
  role: z.enum(MATTER_PARTY_ROLES, {
    errorMap: () => ({ message: 'Επιλέξτε ρόλο' }),
  }),
  side: z.enum(MATTER_PARTY_SIDES, {
    errorMap: () => ({ message: 'Επιλέξτε πλευρά' }),
  }),
  billing_split_percentage: z
    .number()
    .int('Ακέραιος αριθμός 0-100')
    .min(0, 'Ελάχιστο 0')
    .max(100, 'Μέγιστο 100')
    .nullable()
    .optional(),
  is_primary_contact: z.boolean().optional().default(false),
});

export type AddPartyToMatterInput = z.infer<typeof AddPartyToMatterSchema>;

export const UpdateMatterPartySchema = z.object({
  role: z.enum(MATTER_PARTY_ROLES).optional(),
  side: z.enum(MATTER_PARTY_SIDES).optional(),
  billing_split_percentage: z
    .number()
    .int('Ακέραιος αριθμός 0-100')
    .min(0, 'Ελάχιστο 0')
    .max(100, 'Μέγιστο 100')
    .nullable()
    .optional(),
  is_primary_contact: z.boolean().optional(),
});

export type UpdateMatterPartyInput = z.infer<typeof UpdateMatterPartySchema>;

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface MattersListResponse {
  data: Matter[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

export interface MatterDetailResponse {
  data: Matter & { parties?: MatterParty[] };
}

export interface MatterPartiesResponse {
  data: MatterParty[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

// ---------------------------------------------------------------------------
// Query / filter params
// ---------------------------------------------------------------------------

export interface MattersQueryParams {
  status?: MatterStatus;
  matter_type?: MatterType;
  assigned_to_user_id?: string;
  limit?: number;
  offset?: number;
  sort?: 'title' | 'opened_at' | 'created_at';
  order?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Re-export PartyRole so matter components can use it without extra imports
// ---------------------------------------------------------------------------
export type { PartyRole };
