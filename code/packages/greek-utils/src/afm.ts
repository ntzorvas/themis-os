// ΑΦΜ (Αριθμός Φορολογικού Μητρώου) Validator
// Αλγόριθμος checksum per ΑΑΔΕ specification
// Αναφορά: docs/v03/tech-stack-v03.md §9 (AFM validation)

/**
 * Ελέγχει αν ένα ΑΦΜ είναι έγκυρο βάσει του αλγορίθμου checksum.
 *
 * @param afm - Το ΑΦΜ (9 ψηφία, με ή χωρίς κενά)
 * @returns true αν το ΑΦΜ είναι συντακτικά έγκυρο
 *
 * @example
 * validateAFM('123456789') // → false (test value)
 * validateAFM('094259216') // → true (ΑΑΔΕ sample)
 */
export function validateAFM(afm: string): boolean {
  // Αφαίρεση κενών και dashes
  const cleaned = afm.replace(/[\s\-]/g, '');

  // Πρέπει να είναι ακριβώς 9 ψηφία
  if (!/^\d{9}$/.test(cleaned)) {
    return false;
  }

  // ΑΦΜ 000000000 = μη έγκυρο
  if (cleaned === '000000000') {
    return false;
  }

  // Αλγόριθμος checksum:
  // Κάθε από τα πρώτα 8 ψηφία πολλαπλασιάζεται με 2^(8-i)
  // Το άθροισμα mod 11 πρέπει να ισούται με το 9ο ψηφίο (mod 10)
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const digit = parseInt(cleaned[i] ?? '0', 10);
    sum += digit * Math.pow(2, 8 - i);
  }

  const remainder = sum % 11;
  const checkDigit = remainder % 10;
  const lastDigit = parseInt(cleaned[8] ?? '0', 10);

  return checkDigit === lastDigit;
}

/**
 * Μορφοποιεί ΑΦΜ για εμφάνιση (XXX XXX XXX).
 * Δεν κάνει validation — χρησιμοποιήστε πρώτα validateAFM.
 */
export function formatAFM(afm: string): string {
  const cleaned = afm.replace(/\D/g, '');
  if (cleaned.length !== 9) return afm;
  return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)}`;
}
