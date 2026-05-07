/**
 * Greek VAT helpers for ΘΕΜΙΣ OS billing engine.
 *
 * Σύνηθης συντελεστής 2026: 24%
 * Μειωμένος (νησιά κτλ):    13%
 *
 * Δικηγορικές υπηρεσίες → 24% (άρθρο 21 ν.2859/2000).
 *
 * Rounding: HALF_UP (Math.round). All inputs/outputs in integer cents.
 *
 * @module lib/greek-vat
 */

/** Σύνηθης συντελεστής ΦΠΑ 2026 — δικηγορικές υπηρεσίες */
export const DEFAULT_VAT_RATE = 24.0;

/** Μειωμένος συντελεστής ΦΠΑ — νησιά, ειδικές κατηγορίες */
export const REDUCED_VAT_RATE = 13.0;

/**
 * Υπολογίζει ΦΠΑ σε cents από υποσύνολο σε cents και συντελεστή %.
 *
 * Rounding: HALF_UP — Math.round(x + 0.5 - epsilon) ≡ standard Math.round.
 * Ειδικός χειρισμός αρνητικών: σπάνια (credit notes) — επιστρέφει αρνητικό.
 *
 * @param subtotalCents - Υποσύνολο σε integer cents (BIGINT)
 * @param ratePct       - Συντελεστής ΦΠΑ (πχ 24.0 ή 13.0)
 * @returns             - ΦΠΑ σε integer cents (BIGINT), rounded HALF_UP
 *
 * @example
 * calculateVat(1000, 24.0) // → 240
 * calculateVat(1000, 13.0) // → 130
 * calculateVat(333,  24.0) // → 80  (79.92 → 80 HALF_UP)
 */
export function calculateVat(subtotalCents: number, ratePct: number): number {
  if (!Number.isFinite(subtotalCents) || !Number.isFinite(ratePct)) {
    throw new Error('calculateVat: μη έγκυρες παράμετροι');
  }
  if (ratePct < 0 || ratePct > 100) {
    throw new Error('calculateVat: ratePct εκτός εύρους [0, 100]');
  }
  const raw = (subtotalCents * ratePct) / 100;
  return Math.round(raw);
}

/**
 * Υπολογίζει συνολικό ποσό (subtotal + ΦΠΑ) σε cents.
 *
 * @param subtotalCents - Υποσύνολο σε integer cents
 * @param ratePct       - Συντελεστής ΦΠΑ
 * @returns             - Σύνολο σε integer cents
 */
export function calculateTotal(subtotalCents: number, ratePct: number): number {
  return subtotalCents + calculateVat(subtotalCents, ratePct);
}
