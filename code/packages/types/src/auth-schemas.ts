// Auth Zod schemas — shared between API (validation) and Web (form resolvers)
// All user-facing error messages in Greek per D-API-10
// Spec: docs/day4-auth-notes.md

import { z } from 'zod';
import { SubscriptionTierSchema } from './firm';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * ΑΦΜ validator — 9 digits + mod-11 checksum.
 * Checksum algorithm per ΑΑΔΕ specification.
 * Full implementation lives in packages/greek-utils/src/afm.ts.
 * This schema runs the same logic inline so it works without an import
 * in environments where greek-utils is not available (e.g. browser).
 */
function validateAfmChecksum(afm: string): boolean {
  if (!/^\d{9}$/.test(afm)) return false;
  if (afm === '000000000') return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const digit = parseInt(afm[i] ?? '0', 10);
    sum += digit * Math.pow(2, 8 - i);
  }
  const checkDigit = (sum % 11) % 10;
  return checkDigit === parseInt(afm[8] ?? '0', 10);
}

export const AfmSchema = z
  .string()
  .regex(/^\d{9}$/, 'Το ΑΦΜ πρέπει να είναι ακριβώς 9 ψηφία.')
  .refine(validateAfmChecksum, 'Μη έγκυρο ΑΦΜ. Ελέγξτε τον αριθμό και δοκιμάστε ξανά.');

/** URL-safe firm identifier: kebab-case, 3–32 chars */
export const SlugSchema = z
  .string()
  .min(3, 'Το αναγνωριστικό γραφείου πρέπει να έχει τουλάχιστον 3 χαρακτήρες.')
  .max(32, 'Το αναγνωριστικό γραφείου δεν μπορεί να υπερβαίνει τους 32 χαρακτήρες.')
  .regex(
    /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/,
    'Το αναγνωριστικό πρέπει να αποτελείται μόνο από πεζά γράμματα, αριθμούς και παύλες.'
  );

/**
 * Strong password: min 12 chars, must contain at least one letter and one digit.
 * No maximum (prevents password manager truncation).
 */
export const PasswordSchema = z
  .string()
  .min(12, 'Ο κωδικός πρέπει να έχει τουλάχιστον 12 χαρακτήρες.')
  .refine(
    (pw) => /[a-zA-ZΑ-Ωα-ω]/.test(pw),
    'Ο κωδικός πρέπει να περιέχει τουλάχιστον ένα γράμμα.'
  )
  .refine(
    (pw) => /\d/.test(pw),
    'Ο κωδικός πρέπει να περιέχει τουλάχιστον έναν αριθμό.'
  );

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const LoginSchema = z.object({
  email: z
    .string()
    .email('Μη έγκυρη διεύθυνση email.'),
  password: z
    .string()
    .min(8, 'Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.'),
});

export type LoginInput = z.infer<typeof LoginSchema>;

// ---------------------------------------------------------------------------
// Register Firm
// ---------------------------------------------------------------------------

export const RegisterFirmSchema = z.object({
  /** Legal name of the law firm */
  legalName: z
    .string()
    .min(3, 'Η επωνυμία γραφείου πρέπει να έχει τουλάχιστον 3 χαρακτήρες.')
    .max(200, 'Η επωνυμία γραφείου δεν μπορεί να υπερβαίνει τους 200 χαρακτήρες.'),

  /** URL-safe subdomain identifier */
  slug: SlugSchema,

  /** Greek tax registration number */
  afm: AfmSchema,

  /** Subscription tier */
  tier: SubscriptionTierSchema,

  /** Email for billing receipts and dunning */
  billingEmail: z
    .string()
    .email('Μη έγκυρη διεύθυνση email χρέωσης.'),

  /** Owner account email */
  ownerEmail: z
    .string()
    .email('Μη έγκυρη διεύθυνση email ιδιοκτήτη.'),

  /** Owner account password — must pass PasswordSchema rules */
  ownerPassword: PasswordSchema,

  /** Owner full name */
  ownerFullName: z
    .string()
    .min(2, 'Το όνομα ιδιοκτήτη πρέπει να έχει τουλάχιστον 2 χαρακτήρες.')
    .max(120, 'Το όνομα ιδιοκτήτη δεν μπορεί να υπερβαίνει τους 120 χαρακτήρες.'),

  /** Bar association membership number (optional for non-lawyer owners) */
  ownerBarId: z
    .string()
    .max(30, 'Ο ΑΜ ΔΣ δεν μπορεί να υπερβαίνει τους 30 χαρακτήρες.')
    .optional(),

  /** Override trial duration in days (default: 14) */
  trialDays: z
    .number()
    .int('Οι ημέρες δοκιμής πρέπει να είναι ακέραιος αριθμός.')
    .min(1, 'Οι ημέρες δοκιμής πρέπει να είναι τουλάχιστον 1.')
    .max(90, 'Οι ημέρες δοκιμής δεν μπορούν να υπερβαίνουν τις 90.')
    .optional(),
});

export type RegisterFirmInput = z.infer<typeof RegisterFirmSchema>;

// ---------------------------------------------------------------------------
// Forgot / Reset Password
// ---------------------------------------------------------------------------

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Μη έγκυρη διεύθυνση email.'),
  firmSlug: SlugSchema,
});

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z
    .string()
    .min(64, 'Μη έγκυρος κωδικός επαναφοράς.')
    .max(64, 'Μη έγκυρος κωδικός επαναφοράς.'),
  newPassword: PasswordSchema,
  firmSlug: SlugSchema,
});

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
