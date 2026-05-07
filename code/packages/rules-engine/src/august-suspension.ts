/**
 * august-suspension.ts
 *
 * Δικαστικές διακοπές Αυγούστου (1-31/8) κατά ΚΠολΔ 144§1 + ν. 1756/1988.
 *
 * Κανόνας: αν προθεσμία τρέχει τον Αύγουστο, ο Αύγουστος δεν μετράει —
 * η προθεσμία "παγώνει" 1/8 και ξανατρέχει 1/9.
 *
 * Εξαιρέσεις (rule_ids που ΔΕΝ αναστέλλονται):
 *   - kpold-630a-epidosi-diatagis-pliromis (OQ-1 default: ΟΧΙ αναστολή)
 *   - kpold-693-asfalistika-kyria-agogi (OQ-4 default: ΟΧΙ αναστολή)
 *   - kpold-286-katargi-dikis (6μηνη αδράνεια — δεν αναστέλλεται)
 *   - kpold-260-mataiosi-orismou (κλήση για νέα δικάσιμο — ΟΧΙ αναστολή)
 *   - kpold-misthiotikes-agogi (κλήτευση αγωγής — ΟΧΙ αναστολή)
 *   - kpold-ergatikes-agogi (κλήτευση αγωγής — ΟΧΙ αναστολή)
 *   - kpold-oikogeniakes-diafores (κλήτευση αγωγής — ΟΧΙ αναστολή)
 *   - kpold-ekousia-anakopi (εκούσια — ΟΧΙ αναστολή)
 *   - kpold-ak-paragrafos-penta (παραγραφή ΑΚ — ΟΧΙ αναστολή)
 *   - kpold-ak-paragrafos-dikigoros (παραγραφή ΑΚ — ΟΧΙ αναστολή)
 *   - kpold-518-efesi-katachristiki (OQ-2 default: ΝΑΙ αναστολή — ΟΧΙ exemption)
 *   - kpold-938-anastoli-ektelesis (ενδεικτική, null duration — δεν εφαρμόζεται)
 *   - kpold-epidosi-vs-koinopoiisi (γενικός κανόνας, null duration)
 *   - kpold-144-exairetees-imeres (γενικός κανόνας, null duration)
 *   - kpold-144-par2-exoteriko (γενικός κανόνας, null duration)
 *   - kpold-954-pleistariasmou-oria (Αύγουστος: μεταφορά λήξης, ΟΧΙ αναστολή)
 */

// Rules whose `skip_august` in the JSON is already false OR that explicitly
// do NOT suspend per OQ decisions. The engine reads skip_august from the JSON;
// this set is used only for the explicit exemption list in warnings.
export const AUGUST_EXEMPT_RULE_IDS: ReadonlySet<string> = new Set([
  'kpold-630a-epidosi-diatagis-pliromis',
  'kpold-693-asfalistika-kyria-agogi',
  'kpold-286-katargi-dikis',
  'kpold-260-mataiosi-orismou',
  'kpold-misthiotikes-agogi',
  'kpold-ergatikes-agogi',
  'kpold-oikogeniakes-diafores',
  'kpold-ekousia-anakopi',
  'kpold-ak-paragrafos-penta',
  'kpold-ak-paragrafos-dikigoros',
  'kpold-938-anastoli-ektelesis',
  'kpold-epidosi-vs-koinopoiisi',
  'kpold-144-exairetees-imeres',
  'kpold-144-par2-exoteriko',
  'kpold-954-pleistariasmou-oria',
]);

/** Αύγουστος = μήνας 7 (0-indexed UTC) */
const AUGUST_MONTH = 7;

/**
 * Επιστρέφει true αν ημερομηνία εμπίπτει στις δικαστικές διακοπές Αυγούστου (1-31/8).
 */
export function isAugust(date: Date): boolean {
  return date.getUTCMonth() === AUGUST_MONTH;
}

/**
 * Εφαρμόζει αναστολή Αυγούστου: επιστρέφει νέο deadline.
 *
 * Νομικός κανόνας (ΚΠολΔ 144§1β): ο Αύγουστος δεν προσμετράται στην προθεσμία.
 * Ισοδύναμα: αρχίζουμε από trigger_date+1 και μετράμε μόνο μη-Αυγουστιάτικες ημέρες
 * μέχρι να συμπληρωθεί ο απαιτούμενος αριθμός ημερών.
 *
 * Αυτή η συνάρτηση υπολογίζει πόσες ημέρες Αυγούστου εμπίπτουν στην τρέχουσα
 * προθεσμία [triggerDate+1 .. rawDeadline] και τις προσθέτει στο rawDeadline.
 * Αν το νέο deadline εμπίπτει επίσης σε Αύγουστο, επαναλαμβάνει (max 2 φορές).
 *
 * @param triggerDate - Ημέρα αφετηρίας (δεν μετράει — ΚΠολΔ 144§1α)
 * @param rawDeadline - Υπολογισμένη ημ. χωρίς αναστολή
 * @returns Νέο deadline με Αύγουστο εξαιρεμένο
 */
export function applyAugustSuspension(triggerDate: Date, rawDeadline: Date): Date {
  // Count August days in [triggerDate+1 .. rawDeadline]
  const startCount = new Date(triggerDate);
  startCount.setUTCDate(startCount.getUTCDate() + 1);

  let augCount = 0;
  const cur = new Date(startCount);
  while (cur <= rawDeadline) {
    if (isAugust(cur)) augCount++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  if (augCount === 0) return new Date(rawDeadline);

  const extended = new Date(rawDeadline);
  extended.setUTCDate(extended.getUTCDate() + augCount);

  // Edge case: the extension itself crosses August (e.g., trigger late July,
  // deadline was in August, extension adds days that also cross August).
  // Count additional August days only in the extension window [rawDeadline+1 .. extended].
  const extStart = new Date(rawDeadline);
  extStart.setUTCDate(extStart.getUTCDate() + 1);
  let extAugCount = 0;
  const cur2 = new Date(extStart);
  while (cur2 <= extended) {
    if (isAugust(cur2)) extAugCount++;
    cur2.setUTCDate(cur2.getUTCDate() + 1);
  }

  if (extAugCount > 0) {
    extended.setUTCDate(extended.getUTCDate() + extAugCount);
  }

  return extended;
}

/**
 * Επιστρέφει τον αριθμό ημερών Αυγούστου στο διάστημα (triggerDate, rawDeadline].
 * Χρησιμοποιείται από τα tests για επαλήθευση.
 */
export function augustSuspensionDays(triggerDate: Date, rawDeadline: Date): number {
  let count = 0;
  const current = new Date(triggerDate);
  current.setUTCDate(current.getUTCDate() + 1);
  while (current <= rawDeadline) {
    if (isAugust(current)) count++;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}
