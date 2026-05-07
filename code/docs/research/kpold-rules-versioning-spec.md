# ΚΠολΔ Rules Engine — Versioning Schema Specification

**Author:** Ηρόδοτος (Deep Research)
**Ημερομηνία:** 2026-04-29
**Προς:** Δαίδαλος (schema implementation) + tool-specialist (engine logic)
**Hand-off context:** Το Ν. 5221/2025 αποκάλυψε ότι οι νομικοί κανόνες αλλάζουν με συγκεκριμένες ημερομηνίες ισχύος, με μεταβατικές διατάξεις που εξαρτώνται από την ημερομηνία του trigger event (πχ δημοσίευση απόφασης). Απαιτείται versioning schema ικανό να διαχειριστεί αυτές τις πολυεκδοχικές καταστάσεις.

---

## 1. Executive Summary

Το rules engine για ΘΕΜΙΣ OS χρειάζεται να υποστηρίξει τρία επίπεδα χρονικής εξάρτησης:

1. **Engine effective_from**: Πότε ξεκίνησε να ισχύει αυτή η έκδοση του rule (metadata)
2. **Trigger date condition**: Η ημερομηνία του νομικά σημαντικού γεγονότος (πχ δημοσίευση απόφασης, κατάθεση αγωγής) καθορίζει ΠΟΙΑ έκδοση του rule εφαρμόζεται
3. **Deadline computation**: Ο υπολογισμός της τελικής προθεσμίας βάσει της επιλεγμένης έκδοσης

---

## 2. Πλήρης Schema ανά Rule

### 2.1 Βασική Δομή Rule (v2)

```typescript
interface KPoldRule {
  // Αναλλοίωτα metadata
  rule_id: string;                    // "kpold-518-efesi-katachristiki"
  kpold_article: string;              // "518§2"
  title_gr: string;
  frequency_score: number;            // 1-10
  deadline_kind: DeadlineKind;        // "ανατρεπτική" | "αποκλειστική" | "γενικός_κανόνας" | "ενδεικτική"

  // Versioning metadata
  version: string;                    // "v1" | "v2" | "v2.1"
  effective_from: string;             // ISO date "2026-01-01" — πότε αυτό το rule αρχίζει να ισχύει
  effective_until: string | null;     // ISO date ή null (ανοιχτό)
  supersedes_version: string | null;  // "v1" — η προηγούμενη έκδοση που αντικαθιστά
  legal_source: string;               // "Ν. 5221/2025 άρθρο 44"
  last_amended_by: string;

  // Trigger event & duration
  trigger_event: string;
  duration: Duration | null;
  duration_foreign?: Duration;

  // Temporal rule selection (για date-conditional rules)
  date_conditional?: DateConditional;

  // Computation flags
  business_days_only: boolean;
  skip_august: boolean;
  weekend_rollover: "next_business_day" | "previous_business_day";

  // History
  previous_versions: PreviousVersion[];

  // Warnings
  warnings_gr: string[];
  needs_legal_review: boolean;
  needs_legal_review_reason?: string;

  // Notes
  notes_gr: string;
  edge_cases: string[];
}

interface Duration {
  value: number;
  unit: "days" | "business_days" | "months" | "years" | "business_days_before_auction";
  note?: string;
}

interface DateConditional {
  rule_type: "date_conditional";
  condition_field: "decision_publication_date" | "filing_date" | "service_date";
  variants: DateVariant[];
  fallback_variant_index: number;   // αν δεν δοθεί ημερομηνία: ποια variant χρησιμοποιείται
}

interface DateVariant {
  condition: string;                  // "decision_publication_date <= 2025-12-31"
  duration: Duration;
  effective_from: string;
  effective_until: string | null;
  legal_source: string;
  notes_gr: string;
}

interface PreviousVersion {
  version: string;                    // "v1"
  effective_from: string;
  effective_until: string;
  duration: Duration;
  legal_source: string;
}
```

### 2.2 Παράδειγμα: kpold-518-efesi-katachristiki (v2)

```json
{
  "rule_id": "kpold-518-efesi-katachristiki",
  "kpold_article": "518§2",
  "title_gr": "Έφεση — καταχρηστική προθεσμία",
  "version": "v2",
  "effective_from": "2026-01-01",
  "effective_until": null,
  "legal_source": "Ν. 5221/2025 άρθρο 44 + μεταβατική Ν. 5264/2025 άρθρο 114 §4",
  "last_amended_by": "Ν. 5221/2025",
  "trigger_event": "δημοσίευση_απόφασης_πρωτοβάθμιου",
  "duration": null,
  "date_conditional": {
    "rule_type": "date_conditional",
    "condition_field": "decision_publication_date",
    "fallback_variant_index": 1,
    "variants": [
      {
        "condition": "decision_publication_date <= 2025-12-31",
        "duration": { "value": 2, "unit": "years" },
        "effective_from": "2016-01-01",
        "effective_until": "2025-12-31",
        "legal_source": "ΚΠολΔ 518§2 (Ν. 4335/2015) + μεταβ. Ν. 5264/2025 άρθρο 114§4",
        "notes_gr": "Αποφάσεις 2016-2025: καταχρηστική 2 έτη"
      },
      {
        "condition": "decision_publication_date >= 2026-01-01",
        "duration": { "value": 1, "unit": "years" },
        "effective_from": "2026-01-01",
        "effective_until": null,
        "legal_source": "Ν. 5221/2025 άρθρο 44",
        "notes_gr": "Αποφάσεις 2026+: καταχρηστική 1 έτος"
      }
    ]
  },
  "skip_august": true,
  "business_days_only": false,
  "weekend_rollover": "next_business_day",
  "previous_versions": [
    {
      "version": "v1",
      "effective_from": "2016-01-01",
      "effective_until": "2025-12-31",
      "duration": { "value": 2, "unit": "years" },
      "legal_source": "ΚΠολΔ 518§2 (Ν. 4335/2015)"
    }
  ],
  "warnings_gr": [
    "ΚΡΙΣΙΜΟ: Η καταχρηστική έφεσης εξαρτάται από ημερομηνία δημοσίευσης απόφασης. Αποφάσεις ΕΩΣ 31/12/2025: 2 έτη. ΑΠΟ 1/1/2026: 1 έτος. Αναστολή Αυγούστου: ΝΑΙ (ΑΠ 1357/2025)."
  ],
  "needs_legal_review": false,
  "frequency_score": 7,
  "deadline_kind": "αποκλειστική"
}
```

---

## 3. API Contract για το Engine

### 3.1 Input Schema

Ο caller (frontend/Themis UI) δίνει:

```typescript
interface DeadlineCalculationRequest {
  rule_id: string;
  trigger_date: string;             // ISO date — ημερομηνία του trigger event (πχ επίδοση)
  
  // Optional context για date-conditional rules
  context?: {
    decision_publication_date?: string;   // ISO date — για καταχρηστικές
    filing_date?: string;                 // ISO date — για αγωγές
    service_date?: string;                // ISO date — για επιδόσεις
  };
  
  // Optional overrides
  party_location?: "domestic" | "foreign" | "unknown";  // για παρέκταση
  judge_set_deadline?: string;                            // για 693 (αν δικαστής όρισε)
  
  // Engine options
  as_of_date?: string;              // ISO date — "ποια έκδοση rule ίσχυε αυτή την ημέρα"
}
```

### 3.2 Output Schema

```typescript
interface DeadlineCalculationResult {
  rule_id: string;
  rule_version_used: string;         // "v2" — ποια έκδοση εφαρμόστηκε
  
  trigger_date: string;
  deadline_date: string;             // ISO date — η τελική προθεσμία
  deadline_date_display: string;     // "31/12/2026 (Πέμπτη)" — για UI
  
  days_remaining: number;            // αρνητικό αν έχει παρέλθει
  is_expired: boolean;
  
  // Αναλυτικός υπολογισμός
  calculation_breakdown: {
    base_duration: Duration;
    august_days_excluded: number;
    weekend_rollover_applied: boolean;
    foreign_extension_applied: boolean;
    judge_override_applied: boolean;
    variant_selected?: DateVariant;    // αν date_conditional
  };
  
  // Warnings
  warnings: string[];
  legal_review_required: boolean;
  
  // Metadata
  legal_source: string;
  computed_at: string;               // ISO datetime
}
```

### 3.3 Endpoint: Επιλογή Rule Version

Όταν δίνεται `as_of_date`:

```
GET /api/rules/{rule_id}?as_of=2025-06-01
```

Επιστρέφει την έκδοση του rule που **ίσχυε** στις 2025-06-01, όχι την τρέχουσα.

Αλγόριθμος επιλογής:
```
rule_version = versions
  .filter(v => v.effective_from <= as_of_date)
  .filter(v => v.effective_until == null OR v.effective_until >= as_of_date)
  .sort(by effective_from DESC)
  .first()
```

---

## 4. Edge Cases & Αποφάσεις Αρχιτεκτονικής

### Edge Case 1: Trigger date ΠΡΙΝ 1/1/2026, deadline ΜΕΤΑ

**Σενάριο:** Απόφαση δημοσιεύθηκε 15/11/2025. Δεν επιδόθηκε ποτέ. Πότε λήγει η καταχρηστική έφεση;

**Απόφαση engine:** Το rule που εφαρμόζεται **εξαρτάται από την ημερομηνία του trigger event** (δημοσίευση απόφασης), ΟΧΙ από σήμερα. Η δημοσίευση ≤ 31/12/2025 → εφαρμόζεται η 2ετής έκδοση → deadline = 15/11/2027.

**Κανόνας:** `rule_version = select_by(condition_field_value, date_conditional.variants)`

**Παρατήρηση:** Αυτό ΔΕΝ σημαίνει ότι έπρεπε να "ξέρεις" πριν 1/1/2026 — η μεταβατική Ν.5264/2025 άρθρο 114§4 ρητά το λέει: «εξακολουθεί να ισχύει η διετής».

### Edge Case 2: Trigger date ΑΓΝΩΣΤΗ

**Σενάριο:** Χρήστης δεν γνωρίζει αν η απόφαση έχει δημοσιευθεί πριν ή μετά 1/1/2026.

**Απόφαση engine:**
- Engine χρησιμοποιεί το `fallback_variant_index` (default: συντηρητική προσέγγιση = η πιο σύντομη προθεσμία)
- Εμφανίζεται ΥΠΟΧΡΕΩΤΙΚΟ warning: «Δεν δόθηκε ημερομηνία δημοσίευσης. Χρησιμοποιήθηκε η προθεσμία 1 έτους (Ν.5221/2025). Αν η απόφαση δημοσιεύθηκε ΠΡΙΝ 1/1/2026, η ισχύουσα προθεσμία είναι 2 έτη. Επαληθεύστε ημερομηνία δημοσίευσης.»

### Edge Case 3: Η προθεσμία έχει ήδη παρέλθει

**Σενάριο:** Απόφαση δημοσιεύθηκε 15/01/2026. Σήμερα 29/04/2026. Η 1ετής καταχρηστική λήγει 15/01/2027. Ο χρήστης αναρωτιέται «αν η παλαιά 2ετής ίσχυε, τι θα ήταν το deadline;»

**Απόφαση engine:** Το engine **δεν επιτρέπει** υπολογισμό με «υποθετική» έκδοση rule εφόσον το νόμιμο αποτέλεσμα είναι ξεκάθαρο. Εμφανίζεται μόνο το νόμιμο αποτέλεσμα.

### Edge Case 4: Δικαστής όρισε μεγαλύτερη προθεσμία (693)

**Σενάριο:** ΚΠολΔ 693: δικαστής όρισε 60 ημέρες αντί 30.

**Απόφαση engine:** `judge_override_applied = true`, duration = 60 ημέρες, βάση = «δικαστής απόφαση».

**UI:** Input field «Η απόφαση ορίζει συγκεκριμένη προθεσμία; [NAI/OXI]» → αν NAI: «Εισάγετε ημέρες».

### Edge Case 5: Αύγουστος και καταχρηστική προθεσμία (open question)

**Σενάριο:** Καταχρηστική 518§2 εκκινεί 15/07/2026 και λήγει πριν 15/09/2027 αλλά ο Αύγουστος μεταθέτει.

**Απόφαση engine (συντηρητική — βάσει Θέμις):** Εφαρμόζεται αναστολή Αυγούστου. Εμφανίζεται warning: «Η αναστολή Αυγούστου στην καταχρηστική προθεσμία (518§2) βασίζεται σε συντηρητική νομολογιακή ερμηνεία (ΑΠ 1357/2025). Δεν υπάρχει Ολομέλεια ΑΠ. Επαληθεύστε με νομικό σύμβουλο.»

### Edge Case 6: Εκκρεμής ανακοπή ΔΠ κατατεθείσα πριν 1/1/2026

**Σενάριο:** Ανακοπή 632 κατατέθηκε 15/12/2025. Σήμερα 29/04/2026 δεν έχει δικαστεί.

**Απόφαση engine:** Ο νέος κανόνας εκδίκασης (60 ημέρες) ΔΕΝ εφαρμόζεται σε αυτή — εκκρεμεί κατά παλαιό σύστημα + επαναπροσδιορισμός μέσω ηλεκτρονικής πλατφόρμας (Ν.5264/2025 άρθρο 115). Το engine δεν υπολογίζει deadline εκδίκασης για εκκρεμείς ανακοπές — παραπέμπει στην πλατφόρμα.

---

## 5. Rule Registry Schema (JSON file format)

Το `kpold-rules-top30.json` να εξελιχθεί σε:

```
kpold-rules-registry.json
├── version: "v2"
├── generated_at: "2026-04-29"
├── rules: Rule[]
│   └── κάθε rule: { ...full Rule schema... }
├── transitions: Transition[]
│   └── { from_version, to_version, law, effective_date, affected_rules[] }
└── metadata
    ├── total_rules: 33
    ├── last_legal_review: "2026-04-29"
    └── next_scheduled_review: "2026-07-01"
```

---

## 6. Migration από v1 → v2

### 6.1 Breaking Changes

| Rule | Breaking | Αλλαγή |
|------|----------|--------|
| kpold-518-efesi-katachristiki | ΝΑΙ | Απαιτείται νέο field `decision_publication_date` |
| kpold-564-anairesi-katachristiki | ΝΑΙ | Απαιτείται νέο field `decision_publication_date` |
| kpold-ak-paragrafos-dikigoros | ΝΑΙ | Αλλαγή duration 3→5 + αλλαγή legal source |
| kpold-693-asfalistika-kyria-agogi | ΝΑΙ | Αλλαγή trigger_event |

### 6.2 Non-Breaking Changes

- `duration_foreign: 120 days` στο 237 (νέο field, παλαιά clients απλά δεν το χρησιμοποιούν)
- `mediation_does_not_suspend: true` στο 237 (νέο flag)
- `warnings_gr[]` array — additive
- `previous_versions[]` — additive

### 6.3 Τρόπος Migration

```
1. Load v1 JSON
2. Apply patches (kpold-rules-top30-v2-patches.json)
3. Add new rules (new_rules array)
4. Validate schema
5. Run test suite (date-conditional rules + edge cases)
6. Θέμις sign-off για NEEDS_LEGAL_REVIEW rules
7. Tag as v2 + lock
```

---

## 7. Recommended Implementation Notes για Δαίδαλος

### 7.1 Database Schema

Αν τα rules αποθηκεύονται σε DB αντί JSON:

```sql
CREATE TABLE kpold_rules (
  id SERIAL PRIMARY KEY,
  rule_id VARCHAR(100) NOT NULL,
  version VARCHAR(10) NOT NULL,
  effective_from DATE NOT NULL,
  effective_until DATE,
  rule_data JSONB NOT NULL,
  legal_source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rule_id, version)
);

-- Index για temporal queries
CREATE INDEX idx_rules_temporal ON kpold_rules(rule_id, effective_from, effective_until);

-- View: τρέχουσα έκδοση κάθε rule
CREATE VIEW current_kpold_rules AS
SELECT DISTINCT ON (rule_id)
  rule_id, version, rule_data, legal_source
FROM kpold_rules
WHERE effective_from <= CURRENT_DATE
  AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
ORDER BY rule_id, effective_from DESC;
```

### 7.2 Κρίσιμες Επικυρώσεις

Πριν γίνει production lock, το test suite ΠΡΕΠΕΙ να περιλαμβάνει:

1. `trigger_date = 2025-11-15, rule = 518§2` → deadline = +2 years (2027-11-15)
2. `trigger_date = 2026-02-10, rule = 518§2` → deadline = +1 year (2027-02-10)
3. `trigger_date = 2026-07-01, rule = 237§1` → deadline = +90 days (1/10/2026) but August excluded → 1/10/2026
4. `trigger_date = 2026-07-01, rule = 630A` → deadline = +2 months = 1/9/2026 (NO August suspension)
5. `trigger_date = 2026-12-31, rule = 518§1` → deadline = 30/1/2027 (rollover αν Σαββ.)
6. `trigger_date = 2023-06-15, rule = δικηγόρος` → deadline = 31/12/2028 (5 years from 31/12/2023)

### 7.3 UI Requirement

Για rules με `date_conditional`: το UI ΠΡΕΠΕΙ να εμφανίζει επιπλέον input field για το `condition_field` (πχ «Ημερομηνία δημοσίευσης απόφασης») ΠΡΙΝ τον υπολογισμό. Αν ο χρήστης δεν δώσει τιμή: εμφάνιση warning + default στη συντηρητικότερη έκδοση (σύντομη προθεσμία).

---

## 8. Open Questions (αρχιτεκτονικά)

1. **Ποιος ορίζει `as_of_date`;** — Αν ο χρήστης θέλει να υπολογίσει προθεσμία «αναδρομικά» (πχ «τι ίσχυε πέρσι»), χρειάζεται UI toggle. Τυπική χρήση: `as_of_date = today`.

2. **Πολλαπλά trigger events ανά rule;** — Πχ αναψηλάφηση: ο λόγος αναψηλάφησης καθορίζει την αφετηρία. Πρόταση: κάθε λόγος 544 = ξεχωριστό sub-rule με δικό του trigger_event.

3. **Ηλεκτρονική πλατφόρμα ανακοπών;** — Οι νέες υποχρεωτικές προθεσμίες εκδίκασης (60 ημ.) είναι υποχρεώσεις δικαστηρίου, ΟΧΙ δικηγόρου. Το engine τις παρακολουθεί; Πρόταση: ξεχωριστή κατηγορία `deadline_kind: "δικαστική_υποχρέωση"` — ο δικηγόρος το παρακολουθεί ως reminder, ΟΧΙ ως ανατρεπτική.

4. **Locks για NEEDS_LEGAL_REVIEW;** — Τα rules με `needs_legal_review: true` να εμφανίζονται με yellow banner (ορατό disclaimer) στο UI ώσπου η Θέμις τα sign-off.

---

*Ηρόδοτος — Deep Research Agent | ΘΕΜΙΣ OS Day 8 | 2026-04-29*
*Βάση: v1 rules + Θέμις legal review + Ν.5221/2025 audit*
*Hand-off: Δαίδαλος (schema) + tool-specialist (engine logic) + Θέμις (NEEDS_LEGAL_REVIEW sign-off)*
