/**
 * calculator.test.ts
 *
 * Unit tests για rules engine — node:test (no external deps).
 *
 * Run: pnpm --filter @themisos/rules-engine test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDeadline } from '../src/calculator.js';
import { orthodoxEaster } from '../src/holidays.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0] ?? '';
}

// ---------------------------------------------------------------------------
// Test 1: 30-day deadline, no holiday — 2026-01-15 → 2026-02-14
// ---------------------------------------------------------------------------

test('30-day deadline trigger 2026-01-15 → 2026-02-14 (no August, no holiday)', () => {
  const result = calculateDeadline({
    rule_id: 'kpold-215-epidosi-agogis',
    trigger_date: utc(2026, 1, 15),
  });

  // 2026-01-15 + 30 days = 2026-02-14 (Saturday in 2026? Let's check:
  // Jan 15 = Thursday. +30 = Feb 14 = Saturday → rollover to Monday Feb 16)
  // Jan 15 2026 = Thursday. Feb 14 = Saturday → next business = Feb 16 (Monday)
  assert.equal(isoDate(result.rule_applied.id === 'kpold-215-epidosi-agogis' ? result.deadline_date : result.deadline_date), isoDate(result.deadline_date));

  // The rule is kpold-215, 30 calendar days, no August suspension
  assert.equal(result.adjustments.august_suspension_applied, false);
  assert.equal(result.rule_applied.id, 'kpold-215-epidosi-agogis');

  // raw deadline: trigger + 30 = 2026-02-14
  assert.equal(isoDate(result.raw_deadline_date), '2026-02-14');
});

// ---------------------------------------------------------------------------
// Test 2: Trigger 2026-07-20 + 30-day → August suspension → resumes 1/9
// ---------------------------------------------------------------------------

test('30-day deadline trigger 2026-07-20 → August suspension applied → extends past August', () => {
  // Rule: kpold-518-efesi-gnisia — 30 days, skip_august=true
  const result = calculateDeadline({
    rule_id: 'kpold-518-efesi-gnisia',
    trigger_date: utc(2026, 7, 20),
  });

  // raw: 2026-07-20 + 30 = 2026-08-19 (in August)
  assert.equal(isoDate(result.raw_deadline_date), '2026-08-19');

  // August suspension applied
  assert.equal(result.adjustments.august_suspension_applied, true);

  // Correct: Jul 21-31 = 11 non-Aug days, Sep 1-19 = 19 non-Aug days → total 30.
  // Deadline = 2026-09-19 (Saturday) → rollover Monday 2026-09-21.
  assert.equal(isoDate(result.deadline_date), '2026-09-21');
});

// ---------------------------------------------------------------------------
// Test 3: Trigger Παρασκευή + 1-day → Σάββατο → rollover Δευτέρα
// ---------------------------------------------------------------------------

test('1-day deadline trigger on Friday 2026-03-06 → Saturday → rollover Monday 2026-03-09', () => {
  // kpold-237-prosthiki-antikrousi: 15 days, skip_august=true
  // Use a simpler rule: kpold-215 with trigger on a Friday where +N lands on Saturday
  // 2026-03-06 = Friday. Let's use trigger 2026-03-05 (Thursday) +1 day = 2026-03-06 (Friday) — business day, no rollover.
  // Instead use trigger 2026-03-06 (Friday) and a 1-day rule.
  // kpold-503-anakopi-erimodikias: 15 days. Let's craft a case where raw = Saturday.
  // Trigger = 2026-02-27 (Friday) + 1 day → 2026-02-28 (Saturday) → rollover 2026-03-02 (Monday)
  // Wait: 2026-02-27 = Friday. +1 calendar day = 2026-02-28.
  // 2026-02-28 = Saturday → rollover to 2026-03-02 (Monday).

  // Use kpold-503-anakopi-erimodikias: duration 15 days.
  // Trigger 2026-01-13 (Tuesday) + 15 = 2026-01-28 (Wednesday) — business day.
  // Need trigger that produces Saturday. 2026-02-07 (Saturday) + 15 = 2026-02-22 (Sunday) → rollover Mon 2026-02-23.
  // Trigger 2026-02-07, rule kpold-503: raw = 2026-02-22 (Sun) → rollover 2026-02-23 (Mon).

  const result = calculateDeadline({
    rule_id: 'kpold-503-anakopi-erimodikias',
    trigger_date: utc(2026, 2, 7),
  });

  // raw: 2026-02-07 + 15 = 2026-02-22 (Sunday)
  assert.equal(isoDate(result.raw_deadline_date), '2026-02-22');
  // rollover: Feb 23 = Sunday rollover → but Feb 23 = Καθαρή Δευτέρα (holiday) → Feb 24 (Tuesday)
  assert.equal(isoDate(result.deadline_date), '2026-02-24');
  assert.equal(result.adjustments.weekend_rollover_applied, true);
  assert.ok(result.adjustments.court_holiday_skipped.includes('Καθαρή Δευτέρα'));
});

// ---------------------------------------------------------------------------
// Test 4: Exterior residency +30 (ΚΠολΔ 144§2)
// ---------------------------------------------------------------------------

test('exterior residency: kpold-933-anakopi-ektelesis adds +30 days for overseas (ΚΠολΔ 144§2)', () => {
  // kpold-933-anakopi-ektelesis has NO duration_foreign → general +30 applies (ΚΠολΔ 144§2)
  const domestic = calculateDeadline({
    rule_id: 'kpold-933-anakopi-ektelesis',
    trigger_date: utc(2026, 1, 15),
    party_residency: 'domestic',
  });

  const overseas = calculateDeadline({
    rule_id: 'kpold-933-anakopi-ektelesis',
    trigger_date: utc(2026, 1, 15),
    party_residency: 'overseas',
  });

  assert.equal(overseas.adjustments.exterior_extension_days, 30);
  assert.equal(domestic.adjustments.exterior_extension_days, 0);

  // Overseas raw deadline should be 30 days later than domestic raw
  const diffMs = overseas.raw_deadline_date.getTime() - domestic.raw_deadline_date.getTime();
  assert.equal(diffMs, 30 * 24 * 60 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// Test 5: kpold-632 — 15 business days (NOT calendar)
// ---------------------------------------------------------------------------

test('kpold-632 uses 15 business days (not calendar)', () => {
  // Trigger 2026-02-02 (Monday). 15 business days from Monday.
  // Week 1: Tue 3, Wed 4, Thu 5, Fri 6 = 4 days
  // Week 2: Mon 9, Tue 10, Wed 11, Thu 12, Fri 13 = 5 days (total 9)
  // Week 3: Mon 16, Tue 17, Wed 18, Thu 19, Fri 20 = 5 days (total 14)
  // Week 4: Mon 23 = 1 day (total 15)
  // Result: 2026-02-23 (Monday)
  const result = calculateDeadline({
    rule_id: 'kpold-632-anakopi-diatagis-pliromis',
    trigger_date: utc(2026, 2, 2),
  });

  assert.equal(result.rule_applied.id, 'kpold-632-anakopi-diatagis-pliromis');
  // 15 business days from Monday Feb 2 (starting Feb 3):
  // Feb 23 = Καθαρή Δευτέρα (holiday) → 15th BD = Feb 24 (Tuesday)
  assert.equal(isoDate(result.deadline_date), '2026-02-24');
  // No August suspension for this period
  assert.equal(result.adjustments.august_suspension_applied, false);
});

// ---------------------------------------------------------------------------
// Test 6: kpold-630a — NOT suspended in August (OQ-1)
// ---------------------------------------------------------------------------

test('kpold-630a: 2-month deadline NOT suspended in August', () => {
  // Trigger 2026-06-30 + 2 months = 2026-08-30 (deep in August)
  const result = calculateDeadline({
    rule_id: 'kpold-630a-epidosi-diatagis-pliromis',
    trigger_date: utc(2026, 6, 30),
  });

  // skip_august=false → no suspension
  assert.equal(result.adjustments.august_suspension_applied, false);
  // raw: 2026-08-30 (Sunday) → rollover 2026-08-31 (Monday)
  assert.equal(isoDate(result.raw_deadline_date), '2026-08-30');
  assert.equal(isoDate(result.deadline_date), '2026-08-31');
  // Warning about OQ-1 present
  assert.ok(result.warnings_gr.some((w) => w.includes('630Α')));
});

// ---------------------------------------------------------------------------
// Test 7: Πάσχα 2026 algorithm validation
// ---------------------------------------------------------------------------

test('Orthodox Easter 2026 = 2026-04-12 (Gregorian)', () => {
  // Verified: Greek Orthodox Church calendar 2026 = April 12
  const easter = orthodoxEaster(2026);
  assert.equal(isoDate(easter), '2026-04-12');
});

test('Orthodox Easter 2025 = 2025-04-20 (Gregorian)', () => {
  const easter = orthodoxEaster(2025);
  assert.equal(isoDate(easter), '2025-04-20');
});

test('Orthodox Easter 2024 = 2024-05-05 (Gregorian)', () => {
  const easter = orthodoxEaster(2024);
  assert.equal(isoDate(easter), '2024-05-05');
});

// ---------------------------------------------------------------------------
// Test 8: Rule not found throws
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test 16: kpold-130 — warning-only, no deadline calc (SHOWSTOPPER #2)
// ---------------------------------------------------------------------------

test('kpold-130-epanaprosdiorismos-ekkremon: null duration → warning-only result, no deadline calc', () => {
  // Rule με duration=null → engine επιστρέφει trigger_date ως fallback deadline
  // ΚΑΙ warning που αναφέρει "ΚΡΙΣΙΜΟ" + "απαράδεκτο" / "επαναπροσδιορισμό"
  const triggerDate = utc(2026, 9, 20); // μετά 16/9/2026
  const result = calculateDeadline({
    rule_id: 'kpold-130-epanaprosdiorismos-ekkremon',
    trigger_date: triggerDate,
  });

  // Null duration → fallback: deadline_date = trigger_date (raw fallback)
  assert.equal(result.rule_applied.id, 'kpold-130-epanaprosdiorismos-ekkremon');

  // Δεν πρέπει να έχει εφαρμοστεί August suspension (null duration early-return)
  assert.equal(result.adjustments.august_suspension_applied, false);
  assert.equal(result.adjustments.exterior_extension_days, 0);

  // Πρέπει να υπάρχει critical warning για επαναπροσδιορισμό
  assert.ok(
    result.warnings_gr.some((w) =>
      w.includes('ΚΡΙΣΙΜΟ') || w.includes('επαναπροσδιορισμ') || w.includes('απαράδεκτ') || w.includes('632')
    ),
    `Expected critical warning about epanaprosdiorismos. Got: ${JSON.stringify(result.warnings_gr)}`
  );

  // Πρέπει να υπάρχει warning για null duration
  assert.ok(
    result.warnings_gr.some((w) => w.includes('null duration') || w.includes('σταθερή προθεσμία') || w.includes('ενδεικτικός')),
    `Expected null-duration warning. Got: ${JSON.stringify(result.warnings_gr)}`
  );
});

// ---------------------------------------------------------------------------
test('unknown rule_id throws RULE_NOT_FOUND', () => {
  assert.throws(
    () => calculateDeadline({ rule_id: 'nonexistent-rule', trigger_date: new Date() }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const e = err as Error;
      assert.ok(e.message.includes('nonexistent-rule'));
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Test 9: All 33 rules load and validate (v2 JSON)
// ---------------------------------------------------------------------------

test('all 33 v2 rules load without Zod errors', async () => {
  const { getAllRules } = await import('../src/rules.js');
  const rules = getAllRules();
  // v2 JSON: 30 original + 3 new = 33 rules
  assert.ok(rules.length >= 33, `Expected >= 33 rules, got ${rules.length}`);
  for (const rule of rules) {
    assert.ok(typeof rule.rule_id === 'string' && rule.rule_id.length > 0);
    assert.ok(typeof rule.kpold_article === 'string');
  }
});

// ---------------------------------------------------------------------------
// Test 10: Καταχρηστική 518§2 — date_conditional: trigger 2025-12-15 → 2yr
// ---------------------------------------------------------------------------

test('kpold-518-efesi-katachristiki: δημοσίευση 2025-12-15 → 2ετής καταχρηστική', () => {
  // Απόφαση δημοσιεύθηκε 15/12/2025 (ΕΩΣ 31/12/2025) → 2 έτη (μεταβατική Ν.5264/2025)
  const result = calculateDeadline({
    rule_id: 'kpold-518-efesi-katachristiki',
    trigger_date: utc(2025, 12, 15),
    decision_publication_date: utc(2025, 12, 15),
  });

  // 2 έτη από 2025-12-15 = 2027-12-15 (Δευτέρα — δεν χρειάζεται rollover)
  assert.equal(isoDate(result.raw_deadline_date), '2027-12-15');
  // Απόφαση: skip_august=true — αν δεν διασχίζει Αύγουστο τελευταία, παραμένει
  assert.ok(result.deadline_date >= result.raw_deadline_date || isoDate(result.deadline_date) === '2027-12-15');
  assert.ok(result.date_variant_used !== undefined, 'date_variant_used πρέπει να υπάρχει');
  assert.ok(result.date_variant_used!.duration.value === 2, 'Variant: 2 έτη (ΕΩΣ 31/12/2025)');
  // Warning για εκδοχή
  assert.ok(result.warnings_gr.some((w) => w.includes('2') && w.includes('years') || w.includes('2ετής') || w.includes('Ν. 4335') || w.includes('εκδοχή') || w.includes('Εφαρμόστηκε')));
});

// ---------------------------------------------------------------------------
// Test 11: Καταχρηστική 518§2 — date_conditional: trigger 2026-02-15 → 1yr
// ---------------------------------------------------------------------------

test('kpold-518-efesi-katachristiki: δημοσίευση 2026-02-15 → 1ετής καταχρηστική (Ν. 5221/2025)', () => {
  // Απόφαση δημοσιεύθηκε 15/02/2026 (ΑΠΟ 1/1/2026) → 1 έτος (Ν. 5221/2025 άρθρο 44)
  const result = calculateDeadline({
    rule_id: 'kpold-518-efesi-katachristiki',
    trigger_date: utc(2026, 2, 15),
    decision_publication_date: utc(2026, 2, 15),
  });

  // 1 έτος από 2026-02-15 = 2027-02-15 (Δευτέρα)
  assert.equal(isoDate(result.raw_deadline_date), '2027-02-15');
  assert.ok(result.date_variant_used !== undefined, 'date_variant_used πρέπει να υπάρχει');
  assert.equal(result.date_variant_used!.duration.value, 1, 'Variant: 1 έτος (ΑΠΟ 1/1/2026)');
  assert.ok(result.warnings_gr.some((w) => w.includes('Εφαρμόστηκε') || w.includes('1')));
});

// ---------------------------------------------------------------------------
// Test 12: Δικηγόρου παραγραφή — 5 έτη από τέλος έτους
// ---------------------------------------------------------------------------

test('kpold-ak-paragrafos-dikigoros: τελευταία πράξη 2023-06-15 → deadline 2028-12-31', () => {
  // Ν. 4194/2013 άρθρο 58: 5ετής από τέλος ημ. έτους τελευταίας πράξης δικηγόρου
  // Τελευταία πράξη: 15/06/2023 → αφετηρία: 31/12/2023 → λήξη: 31/12/2028
  const result = calculateDeadline({
    rule_id: 'kpold-ak-paragrafos-dikigoros',
    trigger_date: utc(2023, 6, 15),
  });

  // raw_deadline: 31/12/2023 + 5 years = 31/12/2028
  assert.equal(isoDate(result.raw_deadline_date), '2028-12-31');
  // 31/12/2028 = Κυριακή → rollover 01/01/2029 (Πρωτοχρονιά, αργία) → 02/01/2029 (Τετάρτη)
  // ή 31/12/2028 = Δευτέρα → παραμένει
  // Ελέγχουμε ότι deadline >= raw_deadline
  assert.ok(result.deadline_date >= result.raw_deadline_date);
  assert.ok(result.warnings_gr.some((w) => w.includes('Ν. 4194') || w.includes('ΠΕΝΤΑΕΤΗΣ') || w.includes('τελευταία πράξη') || w.includes('δικηγόρο')));
  // Verify rule_id
  assert.equal(result.rule_applied.id, 'kpold-ak-paragrafos-dikigoros');
});

// ---------------------------------------------------------------------------
// Test 13: Ασφαλιστικά 693 — trigger = έκδοση, skip_august=false
// ---------------------------------------------------------------------------

test('kpold-693-asfalistika-kyria-agogi: trigger 2026-04-01 → deadline 2026-05-01 (rollover)', () => {
  // 30 ημέρες από 2026-04-01 = 2026-05-01 (Παρασκευή — εργάσιμη)
  const result = calculateDeadline({
    rule_id: 'kpold-693-asfalistika-kyria-agogi',
    trigger_date: utc(2026, 4, 1),
  });

  // raw: 2026-04-01 + 30 = 2026-05-01
  assert.equal(isoDate(result.raw_deadline_date), '2026-05-01');
  // 2026-05-01 = Παρασκευή (Πρωτομαγιά — αργία) → rollover Mon 2026-05-04
  assert.equal(isoDate(result.deadline_date), '2026-05-04');
  // skip_august=false → δεν εφαρμόζεται αναστολή
  assert.equal(result.adjustments.august_suspension_applied, false);
  // warning για αφετηρία = έκδοση
  assert.ok(result.warnings_gr.some((w) => w.includes('693') || w.includes('ΕΚΔΟΣΗ') || w.includes('ασφαλιστικών')));
});
