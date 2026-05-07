/**
 * Currency helpers για ΘΕΜΙΣ OS
 *
 * Κανόνες:
 * - ΠΑΝΤΑ cents (BIGINT-compatible) — ΠΟΤΕ float για αποθήκευση
 * - Greek locale formatting: κόμμα ως decimal separator, τελεία ως thousands
 * - 123456 cents → "1.234,56 €"
 *
 * @module lib/currency
 */

// ---------------------------------------------------------------------------
// formatEur — cents → "1.234,56 €"
// ---------------------------------------------------------------------------

/**
 * Μετατρέπει cents σε ευρώ με Greek locale formatting.
 * @param cents - ποσό σε λεπτά (integer)
 * @returns "1.234,56 €"
 */
export function formatEur(cents: number): string {
  const euros = cents / 100;
  return new Intl.NumberFormat('el-GR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(euros);
}

/**
 * Μετατρέπει cents σε ευρώ, χωρίς το σύμβολο €.
 * Χρήσιμο για inputs.
 * @param cents - ποσό σε λεπτά (integer)
 * @returns "1.234,56"
 */
export function formatEurAmount(cents: number): string {
  const euros = cents / 100;
  return new Intl.NumberFormat('el-GR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(euros);
}

// ---------------------------------------------------------------------------
// parseEurInput — "1.234,56" ή "1234.56" → cents (integer)
// ---------------------------------------------------------------------------

/**
 * Μετατρέπει string input σε cents.
 * Αποδέχεται:
 *   - Greek locale: "1.234,56" → 123456
 *   - Plain decimal: "1234.56" → 123456
 *   - Integer string: "1234" → 123400
 *
 * @param str - user input string
 * @returns cents (integer), ή 0 αν invalid
 */
export function parseEurInput(str: string): number {
  if (!str || str.trim() === '') return 0;

  const trimmed = str.trim();

  // Greek locale: "1.234,56" — τελεία = thousands, κόμμα = decimal
  // Detect by presence of comma
  if (trimmed.includes(',')) {
    // Remove thousand separators (dots before the last comma group)
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const parsed = parseFloat(normalized);
    if (isNaN(parsed)) return 0;
    return Math.round(parsed * 100);
  }

  // Plain: "1234.56" or "1234"
  const parsed = parseFloat(trimmed);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

// ---------------------------------------------------------------------------
// formatVatRate
// ---------------------------------------------------------------------------

/**
 * Μορφοποιεί ΦΠΑ ποσοστό.
 * @param pct - ποσοστό (0-100)
 * @returns "24%" / "13%" / "0%"
 */
export function formatVatRate(pct: number): string {
  return `${pct}%`;
}

// ---------------------------------------------------------------------------
// formatDuration — minutes → "2ω 30λ" / "45λ"
// ---------------------------------------------------------------------------

/**
 * Μορφοποιεί διάρκεια σε λεπτά σε ανθρώπινη μορφή.
 * @param minutes - διάρκεια σε λεπτά
 * @returns "2ω 30λ" ή "45λ"
 */
export function formatDuration(minutes: number | null): string {
  if (minutes === null || minutes === 0) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}λ`;
  if (mins === 0) return `${hours}ω`;
  return `${hours}ω ${mins}λ`;
}

/**
 * Μορφοποιεί elapsed seconds σε HH:MM:SS για timer display.
 * @param seconds - elapsed seconds
 * @returns "01:23:45"
 */
export function formatElapsedTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}
