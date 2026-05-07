# Backlog: Phase 1.5 — ΔΠ από Δικηγόρο (kpold-625)

**Module:** Deadline from Attorney (Ν. 5221/2025 art. 625)
**Status:** BACKLOG — requires attorney legal review before activation
**Priority:** Medium — after Phase 1 stabilisation
**Requires:** `requires_legal_review` flag cleared by attorney sign-off

---

## Background

Ν. 5221/2025 άρθρο 625 εισάγει νέο σύστημα έκδοσης ΔΠ από δικηγόρο. Η αρχική ημερομηνία ισχύος ήταν **1/1/2026**, αλλά το **Ν. 5264/2025 άρθρο 142 (CODIFIED) τη μετέθεσε στις 16/9/2026**.

**SHOWSTOPPER CORRECTION (Themis v2 final review, 2026-04-29):** Η ημερομηνία ισχύος είναι **16/9/2026**, ΟΧΙ 1/1/2026. Patches εφαρμόστηκαν στα `kpold-rules-top30-v2.json`, `calendar-rules-static.ts` και αυτό το αρχείο.

Rule: `kpold-625-dp-dikigoros-ekdosi`
- duration: null (γενικός_κανόνας — δεν υπολογίζει deadline)
- trigger: υποβολή αίτησης έκδοσης ΔΠ
- deadline_kind: γενικός_κανόνας
- skip_august: false
- effective_from: **2026-09-16** (διορθώθηκε από 2026-01-01)
- feature_flag: BETA_DISABLED_UNTIL_2026-09-16

---

## What Needs to Happen

### Legal Review Gate
- [ ] Δικηγόρος (Niko ή εξωτερικός) επαληθεύει ΦΕΚ Ν. 5221/2025 άρθρο 625
- [ ] Επιβεβαιώνει: trigger event = κατάθεση αίτησης (όχι επίδοση)
- [ ] Επιβεβαιώνει: duration = 30 ημέρες (ή διαφορετικό)
- [ ] Επιβεβαιώνει: skip_august behaviour
- [ ] Sign-off → `requires_legal_review` → false, `requires_legal_review_reason` → null

### Engine Changes (post sign-off)
- [ ] Update `kpold-625-dp-dikigoros-ekdosi` in `kpold-rules-top30-v2.json`: `requires_legal_review: false`
- [ ] Remove BETA banner from frontend for this rule
- [ ] Bump rule `version` to `"1.1"`, update `effective_from` if needed

### UI/UX (Phase 1.5)
- [ ] Add `decision_publication_date` input field to deadline calculator form
  - Required only for `date_conditional` rules (518, 564)
  - Show/hide conditionally based on selected rule's `date_conditional` presence
- [ ] Show `date_variant_used` info in `DeadlineResult` when date_conditional rule is used
  - e.g. "Εφαρμόστηκε: Παράγραφος 2 — Αποφάσεις δημοσιευθείσες από 1/1/2026 (1 έτος)"
- [ ] Add `effective_from` / `effective_until` badge in rule dropdown
  - If rule has `effective_from >= today - 90d` → show "ΝΕΟ" badge (green)
  - If rule has `effective_until` in the future → show "ΛΗΓΕΙ" badge (orange)

### API Integration (Phase 1.5)
- [ ] `GET /api/calendar/rules` response: include `requires_legal_review`, `legal_source`, `warnings_gr`, `effective_from`, `effective_until` in each rule object
- [ ] `POST /api/calendar/calculate`: accept `decision_publication_date` in request body, pass to engine `calculateDeadline()`
- [ ] `POST /api/calendar/calculate`: return `legal_source`, `requires_legal_review` in response alongside existing fields

### Testing
- [ ] Test 625 rule: trigger 2026-03-01 → deadline 2026-03-31 (30 days)
- [ ] Test 625 rule: trigger 2026-07-25 → deadline 2026-08-25 (no skip_august, crosses August)
- [ ] Test 518 date_conditional: with `decision_publication_date` absent → fallback warning present
- [ ] Test 518 date_conditional: straddling 2025/2026 boundary explicitly

---

## Notes

- kpold-625 βρίσκεται ήδη στο `kpold-rules-top30-v2.json` και `calendar-rules-static.ts`
- `requires_legal_review: true` → BETA banner εμφανίζεται αυτόματα
- Δεν χρειάζεται νέος κώδικας — μόνο JSON update + attorney sign-off
- Phase 1.5 δεν είναι blocking για Phase 1 launch

---

## Links

- Rule JSON: `docs/research/kpold-rules-top30-v2.json` (search `kpold-625`)
- Legal source doc: `docs/research/kpold-rules-legal-review.md` (OQ-7 section)
- Engine: `packages/rules-engine/src/calculator.ts` (`date_conditional` handling)
- Frontend: `apps/web/components/calendar/deadline-result.tsx` (BETA banner)
