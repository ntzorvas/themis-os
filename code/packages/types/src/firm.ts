import { z } from 'zod';

// Subscription tiers — αντιστοιχεί στο pricing model
// Αναφορά: docs/v03/data-model-v03.md §Invariant #6
export const SubscriptionTierSchema = z.enum([
  'starter',     // €19/μήνα — shared cluster, 1-3 χρήστες
  'professional', // €39/μήνα — shared cluster, 1-15 χρήστες
  'firm',        // €59/μήνα — dedicated DB
  'enterprise',  // €79+/μήνα — dedicated DB + BYOK
]);

export type SubscriptionTier = z.infer<typeof SubscriptionTierSchema>;

// Firm roles — RBAC (5 roles Phase 1)
export const FirmRoleSchema = z.enum([
  'admin',       // Ιδιοκτήτης γραφείου
  'partner',     // Συνεταίρος
  'associate',   // Συνεργάτης δικηγόρος
  'paralegal',   // Νομικός βοηθός
  'secretary',   // Γραμματεία
]);

export type FirmRole = z.infer<typeof FirmRoleSchema>;

// Firm context — τίθεται στο JWT + request context
export const FirmContextSchema = z.object({
  firmId: z.string().uuid(),
  firmSlug: z.string(),
  firmSchemaName: z.string(), // firm_<slug_short>
  tier: SubscriptionTierSchema,
});

export type FirmContext = z.infer<typeof FirmContextSchema>;
