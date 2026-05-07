// Ελληνικό Text Normalization
// Χρησιμοποιείται για phonetic search και deduplication
// Αναφορά: docs/v03/tech-stack-v03.md §4 (hybrid search)

// Map τόνων → ατόνων (Unicode decomposition)
const GREEK_ACCENT_MAP: Record<string, string> = {
  ά: 'α', έ: 'ε', ή: 'η', ί: 'ι', ό: 'ο', ύ: 'υ', ώ: 'ω',
  Ά: 'Α', Έ: 'Ε', Ή: 'Η', Ί: 'Ι', Ό: 'Ο', Ύ: 'Υ', Ώ: 'Ω',
  ΐ: 'ι', ΰ: 'υ', ϊ: 'ι', ϋ: 'υ', Ϊ: 'Ι', Ϋ: 'Υ',
};

/**
 * Κανονικοποιεί Ελληνικό κείμενο:
 * - Αφαιρεί τόνους και διαλυτικά
 * - Lowercase
 * - Trim whitespace
 *
 * @example
 * normalizeGreekName('Νικόλαος Παπαδόπουλος') → 'νικολαος παπαδοπουλος'
 */
export function normalizeGreekName(name: string): string {
  return name
    .split('')
    .map((char) => GREEK_ACCENT_MAP[char] ?? char)
    .join('')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Δημιουργεί search token για phonetic lookup.
 * Αφαιρεί όλα τα non-alphabetic characters.
 *
 * @example
 * toSearchToken('Νικ. Παπαδόπουλος') → 'νικπαπαδοπουλος'
 */
export function toSearchToken(text: string): string {
  return normalizeGreekName(text).replace(/[^α-ωa-z0-9]/g, '');
}

// ============================================================
// PHONETIC SEARCH — Beider-Morse Greek Port
// TODO: Υλοποίηση σε Day 14 (Search module)
// Προσωρινό stub που επιστρέφει normalized token
// ============================================================

/**
 * Stub για Beider-Morse phonetic encoding.
 * Πλήρης υλοποίηση προγραμματισμένη για Day 14.
 *
 * @todo Υλοποίηση Beider-Morse Greek adaptation
 * @see https://stevemorse.org/phoneticinfo.htm
 */
export function phoneticEncode(name: string): string {
  // TODO: Beider-Morse Greek port (Day 14)
  // Προσωρινά: επιστρέφει normalized token ως fallback
  console.warn('phoneticEncode: stub implementation — επιστρέφει normalized token');
  return toSearchToken(name);
}
