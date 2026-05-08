/**
 * calculator.ts
 *
 * calculateDeadline — κεντρική συνάρτηση υπολογισμού προθεσμιών.
 *
 * Αλγόριθμος (κατά ΚΠολΔ 144):
 *   1. Αρχή: επόμενη ημέρα από trigger_date (η ημέρα αφετηρίας ΔΕΝ μετράει).
 *   2. Επιλογή duration: date_conditional → variants, foreign → duration_foreign.
 *   3. Προσθήκη διάρκειας (ημερολογιακές ή εργάσιμες).
 *   4. Αν skip_august: εφαρμογή αναστολής Αυγούστου.
 *   5. Αν party_residency != 'domestic' και rule έχει duration_foreign: χρήση foreign duration.
 *   6. Rollover: αν τελευταία ημέρα = Σαββ/Κυρ/αργία → επόμενη εργάσιμη.
 *   7. Προσθήκη exterior_extension_days (ΚΠολΔ 144§2 general +30).
 *   8. Warnings από rule.warnings_gr + requires_legal_review.
 *
 * v2: υποστήριξη date_conditional rules (πχ 518§2, 564§3),
 *     warnings_gr από rule JSON, requires_legal_review flag.
 */

import { getRuleById, type DateVariant } from './rules';
import {
  addCalendarDays,
  addBusinessDays,
  addCalendarMonths,
  addCalendarYears,
  nextBusinessDay,
  isBusinessDay,
} from './business-days';
import { applyAugustSuspension, AUGUST_EXEMPT_RULE_IDS } from './august-suspension';
import { getHolidayName } from './holidays';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PartyResidency = 'domestic' | 'eu' | 'overseas';

export interface DeadlineInput {
  rule_id: string;
  trigger_date: Date;
  party_residency?: PartyResidency | undefined;
  custom_extension_days?: number | undefined;
  /**
   * Για date_conditional rules (πχ 518§2, 564§3):
   * ημερομηνία δημοσίευσης απόφασης.
   * Αν δεν δοθεί: χρησιμοποιείται fallback_variant_index + warning.
   */
  decision_publication_date?: Date | undefined;
  /**
   * Ποια έκδοση rule να χρησιμοποιηθεί (as-of date).
   * Default = σήμερα.
   */
  as_of_date?: Date | undefined;
}

export interface DeadlineAdjustments {
  august_suspension_applied: boolean;
  weekend_rollover_applied: boolean;
  court_holiday_skipped: string[];
  exterior_extension_days: number;
}

export interface DeadlineResult {
  deadline_date: Date;
  raw_deadline_date: Date;
  rule_applied: {
    id: string;
    kpold_article: string;
    title_gr: string;
    deadline_kind: string;
    legal_source?: string;
    requires_legal_review: boolean;
  };
  adjustments: DeadlineAdjustments;
  warnings_gr: string[];
  /** Variant επιλεγμένη (αν date_conditional rule) */
  date_variant_used?: DateVariant | undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Κάνει rollover: αν date ΔΕΝ είναι εργάσιμη → επόμενη εργάσιμη.
 */
function rolloverToNextBusinessDay(date: Date): {
  date: Date;
  rolledOver: boolean;
  holidayNames: string[];
} {
  if (isBusinessDay(date)) {
    return { date, rolledOver: false, holidayNames: [] };
  }

  const holidayNames: string[] = [];
  const d = new Date(date);

  while (!isBusinessDay(d)) {
    const holidayName = getHolidayName(d);
    if (holidayName !== null && !holidayNames.includes(holidayName)) {
      holidayNames.push(holidayName);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }

  return { date: d, rolledOver: true, holidayNames };
}

/**
 * Επιλέγει το σωστό DateVariant για date_conditional rule.
 * Συγκρίνει condition_field value με τα variants.
 *
 * @param conditionDate - Η ημερομηνία του condition field (πχ δημοσίευση απόφασης)
 * @param variants - Τα variants του rule
 * @param fallbackIndex - Index για fallback αν conditionDate null
 * @returns { variant, usedFallback }
 */
function selectDateVariant(
  conditionDate: Date | undefined,
  variants: DateVariant[],
  fallbackIndex: number
): { variant: DateVariant; usedFallback: boolean } {
  if (conditionDate === undefined || variants.length === 0) {
    return {
      variant: variants[fallbackIndex] ?? variants[variants.length - 1]!,
      usedFallback: true,
    };
  }

  const condStr = conditionDate.toISOString().split('T')[0] ?? '';

  for (const variant of variants) {
    const cond = variant.condition;
    // Parse condition: "field <= YYYY-MM-DD" or "field >= YYYY-MM-DD"
    const leMatch = /<=\s*(\d{4}-\d{2}-\d{2})/.exec(cond);
    const geMatch = />=\s*(\d{4}-\d{2}-\d{2})/.exec(cond);

    if (leMatch !== null) {
      const threshold = leMatch[1]!;
      if (condStr <= threshold) {
        return { variant, usedFallback: false };
      }
    } else if (geMatch !== null) {
      const threshold = geMatch[1]!;
      if (condStr >= threshold) {
        return { variant, usedFallback: false };
      }
    }
  }

  // No match → fallback
  return {
    variant: variants[fallbackIndex] ?? variants[variants.length - 1]!,
    usedFallback: true,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Υπολογίζει deadline για δεδομένο rule_id + trigger_date + παραμέτρους.
 *
 * v2: υποστηρίζει date_conditional rules, warnings από JSON, requires_legal_review.
 */
export function calculateDeadline(input: DeadlineInput): DeadlineResult {
  const {
    rule_id,
    trigger_date,
    party_residency,
    custom_extension_days,
    decision_publication_date,
    as_of_date,
  } = input;

  const rule = getRuleById(rule_id, as_of_date);
  const warnings_gr: string[] = [];
  const adjustments: DeadlineAdjustments = {
    august_suspension_applied: false,
    weekend_rollover_applied: false,
    court_holiday_skipped: [],
    exterior_extension_days: 0,
  };

  // --- Append rule-level warnings_gr (from JSON v2) ---
  if (rule.warnings_gr !== undefined && rule.warnings_gr.length > 0) {
    for (const w of rule.warnings_gr) {
      warnings_gr.push(w);
    }
  }

  // --- requires_legal_review warning ---
  if (rule.requires_legal_review === true) {
    warnings_gr.push(
      `ΠΡΟΣΟΧΗ — ΕΚΚΡΕΜΕΙ ΝΟΜΙΚΟΣ ΕΛΕΓΧΟΣ: Ο κανόνας "${rule.kpold_article}" έχει επισημανθεί ως υπό νομική επαλήθευση.` +
      (rule.requires_legal_review_reason !== undefined
        ? ` Λόγος: ${rule.requires_legal_review_reason}.`
        : '') +
      ' Επιβεβαιώστε με νομικό σύμβουλο πριν χρησιμοποιήσετε αυτόν τον υπολογισμό.'
    );
  }

  // --- Step 0: date_conditional rule handling ---
  let dateVariantUsed: DateVariant | undefined;
  let conditionalDuration: { value: number; unit: string } | null = null;

  if (rule.date_conditional !== undefined) {
    const { variant, usedFallback } = selectDateVariant(
      decision_publication_date,
      rule.date_conditional.variants,
      rule.date_conditional.fallback_variant_index
    );

    dateVariantUsed = variant;
    conditionalDuration = variant.duration;

    if (usedFallback) {
      warnings_gr.push(
        `Δεν δόθηκε ημερομηνία δημοσίευσης απόφασης (${rule.date_conditional.condition_field}). ` +
        `Χρησιμοποιήθηκε η συντηρητική εκδοχή: ${variant.duration.value} ${variant.duration.unit}. ` +
        `Αν η απόφαση δημοσιεύθηκε ΠΡΙΝ 1/1/2026, η ισχύουσα προθεσμία μπορεί να είναι διαφορετική. ` +
        'Επαληθεύστε ημερομηνία δημοσίευσης.'
      );
    } else {
      warnings_gr.push(
        `Εφαρμόστηκε εκδοχή: ${variant.duration.value} ${variant.duration.unit} (${variant.legal_source}).`
      );
    }
  }

  // --- Step 0b: null duration check ---
  const effectiveDuration = conditionalDuration ?? (rule.duration !== null ? rule.duration : null);

  if (effectiveDuration === null) {
    warnings_gr.push(
      `Κανόνας "${rule.kpold_article}" δεν έχει σταθερή προθεσμία (null duration). ` +
      'Ο υπολογισμός είναι ενδεικτικός. Επιβεβαιώστε με νομικό αν αμφιβάλλετε.'
    );
    const fallback = new Date(trigger_date);
    return {
      deadline_date: fallback,
      raw_deadline_date: fallback,
      rule_applied: {
        id: rule.rule_id,
        kpold_article: rule.kpold_article,
        title_gr: rule.title_gr,
        deadline_kind: rule.deadline_kind,
        ...(rule.legal_source !== undefined ? { legal_source: rule.legal_source } : {}),
        requires_legal_review: rule.requires_legal_review ?? false,
      },
      adjustments,
      warnings_gr,
      date_variant_used: dateVariantUsed,
    };
  }

  // --- Step 1: Determine duration value + unit ---
  const isForeign = party_residency === 'eu' || party_residency === 'overseas';

  let durationValue: number;
  let durationUnit: string;

  // date_conditional overrides foreign duration
  if (conditionalDuration !== null) {
    durationValue = conditionalDuration.value;
    durationUnit = conditionalDuration.unit;
  } else if (isForeign && rule.duration_foreign !== undefined) {
    durationValue = rule.duration_foreign.value;
    durationUnit = rule.duration_foreign.unit;
  } else {
    const dur = rule.duration!;
    if ('value_min' in dur) {
      durationValue = dur.value_min;
      durationUnit = dur.unit;
      warnings_gr.push(
        `Κανόνας "${rule.kpold_article}" έχει εύρος διάρκειας (${dur.value_min}-${dur.value_max} ${dur.unit}). ` +
        'Χρησιμοποιήθηκε ελάχιστη τιμή. Επιβεβαιώστε με νομικό αν αμφιβάλλετε.'
      );
    } else {
      durationValue = dur.value;
      durationUnit = dur.unit;
    }
  }

  // --- Step 2: Add duration to trigger_date ---
  let rawDeadline: Date;

  switch (durationUnit) {
    case 'days':
      rawDeadline = addCalendarDays(trigger_date, durationValue);
      break;
    case 'months':
      rawDeadline = addCalendarMonths(trigger_date, durationValue);
      break;
    case 'years':
      if (rule.rule_id === 'kpold-ak-paragrafos-dikigoros') {
        // v2 fix: 5ετής από τέλος έτους τελευταίας πράξης δικηγόρου (Ν. 4194/2013 άρθρο 58)
        const endOfYear = new Date(Date.UTC(trigger_date.getUTCFullYear(), 11, 31));
        rawDeadline = addCalendarYears(endOfYear, durationValue);
        warnings_gr.push(
          'Ν. 4194/2013 άρθρο 58: αφετηρία = τέλος του ημ. έτους κατά το οποίο ενεργήθηκε η τελευταία πράξη ΑΠΟ ΤΟΝ ΔΙΚΗΓΟΡΟ. ' +
          'Παράδειγμα: τελευταία πράξη 15/06/2023 → αφετηρία 31/12/2023 → λήξη 31/12/2028.'
        );
      } else {
        rawDeadline = addCalendarYears(trigger_date, durationValue);
      }
      break;
    case 'business_days':
      rawDeadline = addBusinessDays(trigger_date, durationValue);
      break;
    case 'business_days_before_auction':
      rawDeadline = addBusinessDays(trigger_date, -durationValue);
      warnings_gr.push(
        `Κανόνας "${rule.kpold_article}": αντίστροφη αρίθμηση — ${durationValue} εργάσιμες ΠΡΟ πλειστηριασμού. ` +
        'Η trigger_date πρέπει να είναι η ημέρα του πλειστηριασμού.'
      );
      break;
    default:
      rawDeadline = addCalendarDays(trigger_date, durationValue);
  }

  // --- Step 3: exterior_extension_days (ΚΠολΔ 144§2 general +30) ---
  if (isForeign && rule.duration_foreign === undefined && conditionalDuration === null) {
    const extDays = 30;
    rawDeadline = addCalendarDays(rawDeadline, extDays);
    adjustments.exterior_extension_days = extDays;
    warnings_gr.push(
      'ΚΠολΔ 144§2: παρέκταση +30 ημέρες για διάδικο εξωτερικού/άγνωστης διαμονής. ' +
      'Αν ο νόμος ορίζει ρητά διαφορετική παρέκταση, εκείνη υπερισχύει.'
    );
  }

  // custom_extension_days (πχ ΚΠολΔ 693 judge-set extension)
  if (custom_extension_days !== undefined && custom_extension_days > 0) {
    rawDeadline = addCalendarDays(rawDeadline, custom_extension_days);
    if (rule.rule_id === 'kpold-693-asfalistika-kyria-agogi') {
      warnings_gr.push(
        `ΚΠολΔ 693: δικαστής όρισε παρέκταση ${custom_extension_days} ημερών. ` +
        'Αφετηρία = ΕΚΔΟΣΗ απόφασης ασφαλιστικών μέτρων (ΑΠ 957/2021). Αύγουστος ΔΕΝ αναστέλλει.'
      );
    } else {
      warnings_gr.push(`Εφαρμόστηκε custom παρέκταση +${custom_extension_days} ημερών.`);
    }
  }

  // Freeze raw_deadline_date before august/rollover adjustments
  const raw_deadline_date = new Date(rawDeadline);

  // --- Step 4: August suspension ---
  let finalDeadline = new Date(rawDeadline);

  if (rule.skip_august) {
    const afterAugust = applyAugustSuspension(trigger_date, finalDeadline);
    if (afterAugust.getTime() !== finalDeadline.getTime()) {
      adjustments.august_suspension_applied = true;
      finalDeadline = afterAugust;
    }
  }

  // --- OQ-specific warnings (legacy OQ defaults — still relevant for v1 compat) ---
  if (rule.rule_id === 'kpold-518-efesi-katachristiki' && rule.warnings_gr === undefined) {
    warnings_gr.push(
      'ΚΠολΔ 518§2 (καταχρηστική): αμφισβητείται αν ο Αύγουστος αναστέλλει. ' +
      'Εφαρμόστηκε συντηρητικό default: ΝΑΙ αναστολή (ΑΠ 1357/2025). Επιβεβαιώστε με νομικό.'
    );
  }

  if (rule.rule_id === 'kpold-630a-epidosi-diatagis-pliromis' && rule.warnings_gr === undefined) {
    warnings_gr.push(
      'ΚΠολΔ 630Α: η 2μηνη προθεσμία ΔΕΝ αναστέλλεται τον Αύγουστο (ΑΠ 948/2007). ' +
      'Επιβεβαιώστε με νομικό αν αμφιβάλλετε.'
    );
  }

  if (rule.rule_id === 'kpold-693-asfalistika-kyria-agogi' && rule.warnings_gr === undefined) {
    warnings_gr.push(
      'ΚΠολΔ 693: αφετηρία = ΕΚΔΟΣΗ απόφασης ασφαλιστικών (ΟΧΙ επίδοση) — ΑΠ 957/2021. ' +
      'Αύγουστος ΔΕΝ αναστέλλει. Επιβεβαιώστε με νομικό αν αμφιβάλλετε.'
    );
  }

  if (rule.rule_id === 'kpold-583-tritanakopi') {
    warnings_gr.push(
      'Τριτανακοπή: ένδικο βοήθημα (ΑΠ 734/2024). Trigger = "πλήρης γνώση" — απαιτείται manual input. ' +
      'Χωρίς κοινοποίηση/επίδοση δεν τρέχει ορισμένη προθεσμία. Επιβεβαιώστε με νομικό.'
    );
  }

  if (rule.rule_id === 'kpold-ak-paragrafos-penta') {
    warnings_gr.push(
      'ΑΚ 250 παραγραφή: αφετηρία = γένεση αξίωσης ή γνώση ζημίας. ' +
      'Επιβεβαιώστε ακριβή ημερομηνία. Επιβεβαιώστε με νομικό αν αμφιβάλλετε.'
    );
  }

  // --- Step 5: Weekend/holiday rollover ---
  const rolloverResult = rolloverToNextBusinessDay(finalDeadline);
  if (rolloverResult.rolledOver) {
    adjustments.weekend_rollover_applied = true;
    adjustments.court_holiday_skipped = rolloverResult.holidayNames;
    finalDeadline = rolloverResult.date;
  }

  return {
    deadline_date: finalDeadline,
    raw_deadline_date,
    rule_applied: {
      id: rule.rule_id,
      kpold_article: rule.kpold_article,
      title_gr: rule.title_gr,
      deadline_kind: rule.deadline_kind,
      ...(rule.legal_source !== undefined ? { legal_source: rule.legal_source } : {}),
      requires_legal_review: rule.requires_legal_review ?? false,
    },
    adjustments,
    warnings_gr,
    date_variant_used: dateVariantUsed,
  };
}
