/**
 * holidays.ts
 *
 * Ελληνικές αργίες — σταθερές + κινητές (Ορθόδοξο Πάσχα).
 *
 * Αλγόριθμος Meeus/Jones/Butcher για Ορθόδοξο Πάσχα (Ιουλιανό → Γρηγοριανό).
 * Αναφορά: Blackburn & Holford-Strevens "The Oxford Companion to the Year" §12.
 */

// ---------------------------------------------------------------------------
// Orthodox Easter (Julian calendar → Gregorian adjustment)
// ---------------------------------------------------------------------------

/**
 * Επιστρέφει ημερομηνία Ορθοδόξου Πάσχα για δεδομένο έτος (UTC, 00:00).
 * Χρησιμοποιεί αλγόριθμο Meeus για Ιουλιανό Πάσχα + offset +13 ημέρες για Γρηγοριανό.
 */
export function orthodoxEaster(year: number): Date {
  // Meeus algorithm for Julian Easter
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31); // 3=March, 4=April
  const day = ((d + e + 114) % 31) + 1;

  // Julian to Gregorian: add 13 days (valid for 1900–2099)
  const julian = new Date(Date.UTC(year, month - 1, day));
  julian.setUTCDate(julian.getUTCDate() + 13);
  return julian;
}

// ---------------------------------------------------------------------------
// Dynamic holidays derived from Easter
// ---------------------------------------------------------------------------

/**
 * Επιστρέφει ημερομηνίες κινητών αργιών για δεδομένο έτος.
 * Όλες σε UTC 00:00.
 */
export function dynamicHolidays(year: number): Map<string, string> {
  const easter = orthodoxEaster(year);
  const result = new Map<string, string>();

  const addOffset = (label: string, offsetDays: number): void => {
    const d = new Date(easter);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    result.set(toISODate(d), label);
  };

  // Καθαρά Δευτέρα = Πάσχα - 48
  addOffset('Καθαρή Δευτέρα', -48);
  // Μεγάλη Παρασκευή = Πάσχα - 2
  addOffset('Μεγάλη Παρασκευή', -2);
  // Δευτέρα Πάσχα = Πάσχα + 1
  addOffset('Δευτέρα Πάσχα', 1);
  // Δευτέρα Πεντηκοστής = Πάσχα + 50
  addOffset('Δευτέρα Πεντηκοστής', 50);

  return result;
}

// ---------------------------------------------------------------------------
// Fixed holidays (MM-DD)
// ---------------------------------------------------------------------------

const FIXED_HOLIDAYS: ReadonlyArray<[string, string]> = [
  ['01-01', 'Πρωτοχρονιά'],
  ['01-06', 'Θεοφάνεια'],
  ['03-25', 'Εθνική Εορτή 25 Μαρτίου'],
  ['05-01', 'Εργατική Πρωτομαγιά'],
  ['08-15', 'Κοίμηση Θεοτόκου'],
  ['10-28', 'Εθνική Εορτή 28 Οκτωβρίου (Όχι)'],
  ['12-25', 'Χριστούγεννα'],
  ['12-26', 'Σύναξη Θεοτόκου (26 Δεκεμβρίου)'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/** Cache κινητών αργιών ανά έτος — αποφεύγει επανυπολογισμό */
const dynamicCache = new Map<number, Map<string, string>>();

/**
 * Ελέγχει αν ημερομηνία είναι Ελληνική αργία.
 * Επιστρέφει όνομα αργίας αν ναι, null αν όχι.
 */
export function getHolidayName(date: Date): string | null {
  const year = date.getUTCFullYear();
  const mmdd = `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  const isoDate = toISODate(date);

  // Σταθερές αργίες
  for (const [fixedMmdd, label] of FIXED_HOLIDAYS) {
    if (fixedMmdd === mmdd) return label;
  }

  // Κινητές αργίες
  let yearCache = dynamicCache.get(year);
  if (yearCache === undefined) {
    yearCache = dynamicHolidays(year);
    dynamicCache.set(year, yearCache);
  }

  return yearCache.get(isoDate) ?? null;
}

/**
 * Επιστρέφει true αν ημερομηνία είναι Ελληνική αργία.
 */
export function isGreekHoliday(date: Date): boolean {
  return getHolidayName(date) !== null;
}
