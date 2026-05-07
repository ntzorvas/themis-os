// Parties — shared TypeScript types για το Parties module
// Αναφορά: docs/v03/api-architecture-v03.md §Unified Party Model
// Invariant #2: Unified Party Model — party + role chips, ΟΧΙ separate "Clients" page

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const PARTY_TYPES = ['natural', 'legal'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  natural: 'Φυσικό Πρόσωπο',
  legal: 'Νομικό Πρόσωπο',
};

// Role values per API contract — ΟΧΙ "opponent" (410 παλιό endpoint)
export const PARTY_ROLES = [
  'client',
  'counterparty',
  'attorney',
  'witness',
  'expert',
  'counsel',
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const PARTY_ROLE_LABELS: Record<PartyRole, string> = {
  client: 'Πελάτης',
  counterparty: 'Αντίδικος',
  attorney: 'Δικηγόρος',
  witness: 'Μάρτυρας',
  expert: 'Πραγματογνώμονας',
  counsel: 'Σύμβουλος',
};

export const PARTY_ROLE_COLORS: Record<PartyRole, string> = {
  client: 'bg-blue-100 text-blue-800',
  counterparty: 'bg-red-100 text-red-800',
  attorney: 'bg-purple-100 text-purple-800',
  witness: 'bg-yellow-100 text-yellow-800',
  expert: 'bg-green-100 text-green-800',
  counsel: 'bg-gray-100 text-gray-700',
};

// ---------------------------------------------------------------------------
// Party model — Path B: plaintext AFM/display_name in Phase 1
// ---------------------------------------------------------------------------

export const PartySchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().min(1),
  party_type: z.enum(PARTY_TYPES),
  afm: z.string().nullable(),
  is_attorney: z.boolean(),
  roles: z.array(z.enum(PARTY_ROLES)),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Party = z.infer<typeof PartySchema>;

// ---------------------------------------------------------------------------
// API request / response shapes
// ---------------------------------------------------------------------------

export const CreatePartySchema = z.object({
  display_name: z.string().min(1, 'Υποχρεωτικό πεδίο'),
  party_type: z.enum(PARTY_TYPES, {
    errorMap: () => ({ message: 'Επιλέξτε τύπο προσώπου' }),
  }),
  afm: z.string().optional(),
  is_attorney: z.boolean().optional(),
  initial_role: z.enum(PARTY_ROLES).optional(),
});

export type CreatePartyInput = z.infer<typeof CreatePartySchema>;

export interface PartiesListResponse {
  data: Party[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

// ---------------------------------------------------------------------------
// Query / filter params
// ---------------------------------------------------------------------------

export interface PartiesQueryParams {
  role?: PartyRole;
  party_type?: PartyType;
  is_attorney?: boolean;
  limit?: number;
  offset?: number;
  sort?: 'display_name' | 'created_at';
  order?: 'asc' | 'desc';
  q?: string;
}
