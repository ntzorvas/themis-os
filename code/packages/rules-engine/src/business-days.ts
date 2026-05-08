/**
 * business-days.ts
 *
 * Υπολογισμός εργάσιμων ημερών κατά ΚΠολΔ 144.
 *
 * Εξαιρετέες ημέρες (ΚΠολΔ 144 + ν. 4335/2015):
 *   - Κυριακές
 *   - Σάββατα (από ν. 4335/2015)
 *   - Επίσημες αργίες (isGreekHoliday)
 */

import { isGreekHoliday } from './holidays.js';

// ---------------------------------------------------------------------------
// Core checks
// ---------------------------------------------------------------------------

/**
 * Επιστρέφει true αν η ημερομηνία είναι εργάσιμη:
 * ΟΧΙ Κυριακή, ΟΧΙ Σάββατο, ΟΧΙ Ελληνική αργία.
 */
export function isBusinessDay(date: Date): boolean {
  const dow = date.getUTCDay(); // 0=Sunday, 6=Saturday
  if (dow === 0 || dow === 6) return false;
  if (isGreekHoliday(date)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Next business day (rollover for deadline expiry)
// ---------------------------------------------------------------------------

/**
 * Αν η ημερομηνία ΔΕΝ είναι εργάσιμη, επιστρέφει την επόμενη εργάσιμη.
 * Αν είναι εργάσιμη, επιστρέφει την ίδια.
 */
export function nextBusinessDay(date: Date): Date {
  const d = new Date(date);
  while (!isBusinessDay(d)) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

/**
 * Αν η ημερομηνία ΔΕΝ είναι εργάσιμη, επιστρέφει την προηγούμενη εργάσιμη.
 * Χρησιμοποιείται για "Ν εργάσιμες ΠΡΙΝ" (πχ ανακοπή πλειστηριασμού 954§4).
 */
export function previousBusinessDay(date: Date): Date {
  const d = new Date(date);
  while (!isBusinessDay(d)) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Calendar day addition (χωρίς προσαρμογή)
// ---------------------------------------------------------------------------

/**
 * Προσθέτει N ημερολογιακές ημέρες σε ημερομηνία.
 * Δεν γίνεται καμία προσαρμογή — χρησιμοποιήστε nextBusinessDay αν χρειάζεται rollover.
 */
export function addCalendarDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// ---------------------------------------------------------------------------
// Business day addition (εργάσιμες ημέρες — ΟΧΙ ημερολογιακές)
// ---------------------------------------------------------------------------

/**
 * Προσθέτει N εργάσιμες ημέρες σε ημερομηνία.
 * Κάθε βήμα μετράει μόνο αν η νέα ημέρα είναι εργάσιμη.
 *
 * Αρνητικά N → αφαιρεί εργάσιμες (για "Ν πριν" υπολογισμούς).
 */
export function addBusinessDays(date: Date, days: number): Date {
  if (days === 0) return new Date(date);

  const d = new Date(date);
  const step = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);

  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    if (isBusinessDay(d)) {
      remaining--;
    }
  }

  return d;
}

// ---------------------------------------------------------------------------
// Month/year addition (calendar months)
// ---------------------------------------------------------------------------

/**
 * Προσθέτει N ημερολογιακούς μήνες σε ημερομηνία.
 * Χειρίζεται overflow μηνών (πχ 31 Ιαν + 1 μήνας → 28/29 Φεβ).
 */
export function addCalendarMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const targetMonth = d.getUTCMonth() + months;
  d.setUTCMonth(targetMonth);
  return d;
}

/**
 * Προσθέτει N ημερολογιακά έτη σε ημερομηνία.
 */
export function addCalendarYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}
