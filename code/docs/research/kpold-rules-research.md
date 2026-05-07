# ΚΠολΔ Rules Engine — Research Report
**Agent:** Ηρόδοτος (Deep Research)
**Ημερομηνία:** 2026-04-29
**Πελάτης:** ΘΕΜΙΣ OS — Deadline Calculation Engine
**Hand-off προς:** tool-specialist (implementation)

---

## Executive Summary

Ερευνήθηκαν 13 WebSearch queries σε πρωτεύουσες νομικές πηγές (DSA, Lawspot, DSAnet/Ισοκράτης, opengov.gr, efotopoulou.gr, karagiannislawfirm.gr, nomoskopio.gr, greeklaw.github.io, ΑΠ, ΔΣΚέρκυρας, ΔΣΤρίπολης). Εντοπίστηκαν 30 κανόνες-κλειδιά για τον rules engine του ΘΕΜΙΣ OS. Τα ευρήματα καλύπτουν: τακτική διαδικασία, ένδικα μέσα, αναγκαστική εκτέλεση, ασφαλιστικά μέτρα, ειδικές διαδικασίες, παραγραφές και γενικούς κανόνες υπολογισμού.

**Κρίσιμη ανατρεπτική μεταρρύθμιση:** Ν. 4842/2021 (εφαρμογή από 1/1/2022) — αλλαγές σε 237 (ισοτιμία 90 ημ.), 591 (ειδικές), 630Α (ΔΠ), 693 (ασφαλιστικά), 938 (αναστολή εκτέλεσης).

---

## Methodology

### Queries Εκτελέστηκαν (13 total)

| # | Query | Πηγή focus |
|---|-------|-----------|
| 1 | ΚΠολΔ 518 έφεση 30 ημέρες N.4842/2021 | DSA, Lawspot, opengov |
| 2 | ΚΠολΔ 237 προτάσεις 100/90 ημέρες N.4842/2021 | opengov, antimolia, kalamitsis |
| 3 | ΚΠολΔ 632 ανακοπή ΔΠ 15 εργάσιμες | Lawspot, DSA, tpvlaw |
| 4 | ΚΠολΔ 564 αναίρεση 30/60 ημέρες ΚΠολΔ 144 | Lawspot, DSA, DSAnet |
| 5 | ΚΠολΔ 933 ανακοπή εκτέλεσης 45 ημέρες | opengov, xkarampagias, dsrnet |
| 6 | ΚΠολΔ 503 ανακοπή ερημοδικίας 15 ημέρες | karagiannislawfirm, efotopoulou |
| 7 | ΚΠολΔ 545 αναψηλάφηση 60/120 ημέρες | DSA, xkarampagias, dslar |
| 8 | ΚΠολΔ 583 τριτανακοπή 60 ημέρες | karagiannislawfirm, opengov |
| 9 | ΚΠολΔ 144 δικαστικές διακοπές Αύγουστος | efotopoulou, greeklaw.github.io |
| 10 | ΚΠολΔ 591 εργατικές 8 ημέρες N.4842/2021 | antimolia, opengov, lawspot |
| 11 | ΚΠολΔ 215 αγωγή επίδοση 30 ημέρες | legalnews24, dsanet |
| 12 | ΚΠολΔ 693 ασφαλιστικά κύρια αγωγή 30 ημέρες | opengov, efotopoulou, karagiannislawfirm |
| 13 | ΚΠολΔ 237 προσθήκη αντίκρουση 15 ημέρες | nomoskopio, giannoulas, lawspot |

---

## Findings — Summary Table

| rule_id | Άρθρο | Τίτλος | Διάρκεια | Είδος | frequency |
|---------|--------|---------|----------|-------|-----------|
| kpold-215-epidosi-agogis | 215§2 | Επίδοση αγωγής | 30 ημ. (60 εξωτ.) | ανατρεπτική | 10 |
| kpold-237-protaseis-taktiki | 237§1 | Κατάθεση προτάσεων τακτικής | 90 ημ. | ανατρεπτική | 10 |
| kpold-237-prosthiki-antikrousi | 237§2 | Προσθήκη-αντίκρουση | 15 ημ. | ανατρεπτική | 10 |
| kpold-518-efesi-gnisia | 518§1 | Έφεση (από επίδοση) | 30 ημ. (60 εξωτ.) | ανατρεπτική | 10 |
| kpold-518-efesi-katachristiki | 518§2 | Έφεση (χωρίς επίδοση) | 2 έτη | αποκλειστική | 7 |
| kpold-503-anakopi-erimodikias | 503§1 | Ανακοπή ερημοδικίας | 15 ημ. (30 εξωτ.) | ανατρεπτική | 9 |
| kpold-545-anapsilafisi | 544-545 | Αναψηλάφηση | 60 ημ. (120 εξωτ.) | ανατρεπτική | 5 |
| kpold-564-anairesi-gnisia | 564§1 | Αναίρεση (από επίδοση) | 30 ημ. (60 εξωτ.) | ανατρεπτική | 8 |
| kpold-564-anairesi-katachristiki | 564§3 | Αναίρεση (χωρίς επίδοση) | 2 έτη | αποκλειστική | 5 |
| kpold-583-tritanakopi | 583-586 | Τριτανακοπή | 60 ημ. (3 έτη καταχρ.) | ανατρεπτική | 4 |
| kpold-632-anakopi-diatagis-pliromis | 632§1 | Ανακοπή κατά ΔΠ | 15 εργάσιμες (30 εξωτ.) | ανατρεπτική | 10 |
| kpold-630a-epidosi-diatagis-pliromis | 630Α | Επίδοση ΔΠ (2μηνη) | 2 μήνες | ανατρεπτική | 9 |
| kpold-933-anakopi-ektelesis | 933-934 | Ανακοπή εκτέλεσης | 45 ημ. + 15 εργάσιμες πριν πλειστ. | ανατρεπτική | 9 |
| kpold-954-pleistariasmou-oria | 954§2 | Πλειστηριασμός χρόνος | 7-8 μήνες | ενδεικτική | 7 |
| kpold-693-asfalistika-kyria-agogi | 693§1 | Ασφαλιστικά — κύρια αγωγή | ≥30 ημ. (δικαστής) | ανατρεπτική | 8 |
| kpold-144-exairetees-imeres | 144 | Εξαιρετέες ημέρες | γενικός κανόνας | γενικός_κανόνας | 10 |
| kpold-144-par2-exoteriko | 144§2 | Παρέκταση εξωτερικού | +30 ημ. | γενικός_κανόνας | 7 |
| kpold-591-ergatikes-protaseis | 591 | Εργατικές — προτάσεις | 8 ημ. πριν δικάσιμο | ανατρεπτική | 8 |
| kpold-215-agogi-epidosi-klisi | 215+226 | Κλήση για συζήτηση | 30 ημ. πριν (60 εξωτ.) | ανατρεπτική | 8 |
| kpold-260-mataiosi-orismou | 260 | Ματαίωση — εκ νέου κλήση | 30 ημ. πριν | ανατρεπτική | 7 |
| kpold-938-anastoli-ektelesis | 938 | Αναστολή εκτέλεσης | άμεσα (πριν πλειστ.) | ενδεικτική | 8 |
| kpold-286-katargi-dikis | 286 | Κατάργηση δίκης | 6 μήνες | ανατρεπτική | 6 |
| kpold-misthiotikes-agogi | 647-661 | Μισθωτικές — αγωγή | 30 ημ. μεταξύ επίδ./δικ. | ανατρεπτική | 8 |
| kpold-ergatikes-agogi | 663-676 | Εργατικές — αγωγή | 60 ημ. μεταξύ επίδ./δικ. | ανατρεπτική | 8 |
| kpold-oikogeniakes-diafores | 592-613 | Οικογενειακές | 60 ημ. μεταξύ επίδ./δικ. | ανατρεπτική | 7 |
| kpold-ekousia-anakopi | 739-866 | Εκούσια δικαιοδοσία | 30 ημ. πριν | ενδεικτική | 5 |
| kpold-ak-paragrafos-penta | ΑΚ 250 | 5ετής παραγραφή | 5 έτη | ανατρεπτική | 9 |
| kpold-ak-paragrafos-dikigoros | ΑΚ 862 | 3ετής παραγραφή δικηγόρου | 3 έτη (ανά έτος) | ανατρεπτική | 8 |
| kpold-954-anakopi-pleistariasmou | 954§4α | Ανακοπή πλειστηριασμού | 15 εργάσιμες ΠΡΟ πλειστ. | ανατρεπτική | 7 |
| kpold-diakopes-augoustos | 144+Ν.1756/88 | Αύγουστος — αναστολή | 1/8-31/8 | γενικός_κανόνας | 10 |
| kpold-epidosi-vs-koinopoiisi | 123-142 | Επίδοση vs Κοινοποίηση | κανόνας | γενικός_κανόνας | 9 |

---

## Comparison Matrix: Ένδικα Μέσα

| Ένδικο Μέσο | Άρθρο | Γνήσια (Ελλάδα) | Γνήσια (Εξωτ.) | Καταχρηστική | Αύγουστος |
|-------------|-------|-----------------|----------------|--------------|-----------|
| Έφεση | 518 | 30 ημ. | 60 ημ. | 2 έτη από δημοσίευση | ΑΝΑΣΤΕΛΛΕΤΑΙ |
| Ανακοπή ερημοδικίας | 503 | 15 ημ. | 30 ημ. | — (ουδέποτε τελεσιδικεί) | ΑΝΑΣΤΕΛΛΕΤΑΙ |
| Αναίρεση | 564 | 30 ημ. | 60 ημ. | 2 έτη από δημοσίευση | ΑΝΑΣΤΕΛΛΕΤΑΙ |
| Αναψηλάφηση | 545 | 60 ημ. | 120 ημ. | 3 έτη από δημοσίευση | ΑΝΑΣΤΕΛΛΕΤΑΙ |
| Τριτανακοπή | 583 | 60 ημ. από γνώση | 60 ημ. + | 3 έτη από δημοσίευση | ΑΝΑΣΤΕΛΛΕΤΑΙ |

## Comparison Matrix: Ανακοπές Εκτέλεσης

| Ανακοπή | Άρθρο | Προθεσμία | Μέτρηση | Αναστολή εκτέλεσης |
|---------|-------|-----------|---------|-------------------|
| Κατά ΔΠ | 632 | 15 εργ. (30 εξωτ.) | από επίδοση ΔΠ | ΟΧΙ αυτόματα |
| Κατά εκτέλεσης (1ο στάδιο) | 933 | 45 ημ. | από κατάσχεση | ΟΧΙ αυτόματα (938) |
| Κατά πλειστηριασμού (2ο στάδιο) | 954§4 | 15 εργ. ΠΡΟ πλειστ. | αντίστροφη μέτρηση | ΟΧΙ αυτόματα |

---

## Recommendations (ranked)

### P0 — Υποχρεωτικά για MVP

1. **kpold-144-exairetees-imeres**: Ο γενικός κανόνας Αυγούστου/Σαββάτου/Κυριακής/Αργιών πρέπει να εφαρμόζεται ΠΡΙΝ από κάθε άλλο rule. Είναι base layer.
2. **kpold-215-epidosi-agogis + kpold-237-protaseis-taktiki + kpold-237-prosthiki-antikrousi**: Τριάδα τακτικής διαδικασίας — αλυσιδωτή εξάρτηση. Πρέπει να υπολογίζονται sequentially.
3. **kpold-518-efesi-gnisia**: Frequency 10 — κάθε δίκη που κλείνει έχει αυτή.
4. **kpold-632-anakopi-diatagis-pliromis + kpold-630a-epidosi-diatagis-pliromis**: Δύο rules ΔΠ — η 630Α είναι ο πιο επικίνδυνος κανόνας (ΔΕΝ αναστέλλεται Αύγουστος).
5. **kpold-933-anakopi-ektelesis**: Double deadline (45 ημ. + 15 εργ. πριν πλειστ.) — υψηλή πολυπλοκότητα.
6. **kpold-epidosi-vs-koinopoiisi**: Θεμελιακός διαχωρισμός — πρέπει να ελέγχεται σε κάθε trigger event.

### P1 — Σημαντικά για v1.0

7. **kpold-564-anairesi-gnisia**: Frequency 8 — όλες οι τελεσίδικες.
8. **kpold-693-asfalistika-kyria-agogi**: Πολύς όγκος ασφαλιστικών.
9. **kpold-503-anakopi-erimodikias**: Frequency 9 — συχνό φαινόμενο.
10. **kpold-ak-paragrafos-penta + kpold-ak-paragrafos-dikigoros**: Παραγραφές — κρίσιμες για το σύστημα alerts.

### P2 — Για επόμενη έκδοση

11. Ειδικές διαδικασίες (εργατικές, μισθωτικές, οικογενειακές)
12. Αναψηλάφηση, τριτανακοπή
13. Εκούσια δικαιοδοσία

---

## Open Questions για Θέμις (Legal Agent) Review

### Αμφισβητούμενα — Πρέπει Legal Review πριν Lock

**OQ-1: Αύγουστος και 630Α (Επίδοση ΔΠ)**
Η διάταξη 630Α ρητώς δεν αναφέρει εξαίρεση Αυγούστου. Νομολογία efotopoulou.gr επιβεβαιώνει ότι ΔΕΝ αναστέλλεται. Το rules engine πρέπει να εξαιρεί τη 630Α από τη βάση αναστολής Αυγούστου. Χρειάζεται επιβεβαίωση από ΑΠ νομολογία.

**OQ-2: Αύγουστος και Καταχρηστική Έφεση/Αναίρεση (2ετής)**
Υπάρχει διχογνωμία: ΑΠ 460/2022 ασχολήθηκε με COVID-αναστολή καταχρηστικής. Δεν είναι σαφές αν ο Αύγουστος αναστέλλει και την καταχρηστική 2ετή. Συντηρητικά: ΝΑΙ αναστέλλεται, αλλά χρειάζεται flag.

**OQ-3: Γνήσια έφεση εργατικών — 30 ή 20 ημέρες;**
Παλαιά νομολογία αναφέρει 20ήμερη για εργατικές. Μετά ν. 4842/2021 φαίνεται ενοποιήθηκε σε 30 ημέρες. Χρειάζεται επιβεβαίωση ΑΠ νεότερη.

**OQ-4: Ασφαλιστικά 693 — αφετηρία "επίδοση εκθέσεως κατάσχεσης" ή "απόφαση ασφαλιστικών";**
Για συντηρητική κατάσχεση: η 30ήμερη για κύρια αγωγή αρχίζει από επίδοση εκθέσεως κατάσχεσης στον οφειλέτη ή από απόφαση ασφαλιστικών; Ν. 4842/2021 άρθ. 50 τροποποίησε — χρειάζεται επιβεβαίωση.

**OQ-5: Τριτανακοπή — "πλήρης γνώση" vs "κοινοποίηση"**
Ο νόμος γράφει "κοινοποίηση ή πλήρη γνώση". Τι σημαίνει "πλήρης γνώση" νομολογιακά; Δεν αρκεί ακρόαση — χρειάζεται πρόσβαση στο κείμενο. Ανοιχτό ερώτημα για implementation του trigger.

**OQ-6: ΑΚ 862 — αφετηρία "τέλος έτους" ή "γένεση αξίωσης";**
Η 3ετής παραγραφή αξιώσεων δικηγόρου: υπολογίζεται από το τέλος του έτους κατά το οποίο έγιναν απαιτητές οι αμοιβές (ΑΚ 862). Πρακτικά: αμοιβή Ιουνίου 2023 παραγράφεται 31/12/2026. Να επιβεβαιωθεί.

**OQ-7: Ν. 5221/2025 — νέες τροποποιήσεις ΚΠολΔ**
Εντοπίστηκε αναφορά σε Ν. 5221/2025 (Γιαννούλας, metodikigoro.gr). Δεν ερευνήθηκε πλήρως. Πιθανές επιπτώσεις σε ΚΠολΔ 237 και 260. Legal agent να ελέγξει αν επηρεάζει κάποιο από τα 30 rules.

---

## Implementation Notes για tool-specialist

### Business Days Logic
- Εργάσιμες = ΜΗΝ Κυριακή, ΜΗΝ Σάββατο, ΜΗΝ επίσημη αργία
- Αργίες: 1/1, 6/1, Καθαρά Δευτέρα, 25/3, Μεγάλη Παρασκευή, Πάσχα (Κυριακή), Δευτέρα Πάσχα, 1/5, Αγίου Πνεύματος, 15/8, 28/10, 25/12, 26/12
- Κινητές εορτές (Καθαρά Δευτέρα, Πάσχα) — χρειάζεται Easter algorithm

### Rule Dependencies (execution order)
```
1. Υπολογισμός αρχικής ημερομηνίας trigger
2. Εφαρμογή βασικού κανόνα (ημερολογιακές ή εργάσιμες)
3. Αφαίρεση Αυγούστου αν επιτρέπεται (skip_august=true)
4. Rollover αν τελευταία ημέρα = Σαββ/Κυρ/Αργία
5. Εφαρμογή παρέκτασης εξωτερικού αν εναγόμενος εκτός Ελλάδας
```

### Ειδικοί τύποι duration
- `days`: ημερολογιακές
- `business_days`: εργάσιμες
- `business_days_before_auction`: αντίστροφη μέτρηση (εργάσιμες ΠΡΟ γεγονότος)
- `months`: ημερολογιακοί μήνες
- `years`: ημερολογιακά έτη

### Trigger Events Vocabulary (standardized)
Η υλοποίηση πρέπει να map αρει τα trigger_event strings σε concrete event types:
- `επίδοση_*`: date + proof from δικαστικός επιμελητής
- `κατάθεση_*`: court registry timestamp
- `δημοσίευση_*`: court publication date
- `λήξη_*`: computed date from parent rule

---

## Sources

- [Άρθρο 518 ΚΠολΔ — Lawspot](https://www.lawspot.gr/nomothesia/kpold/arthro-518-kodikas-politikis-dikonomias/)
- [Άρθρο 518 — DSA e-Διαβούλευση](https://www.dsa.gr/e-διαβούλευση/άρθρο-518-προθεσμία-έναρξη)
- [Άρθρο 564 ΚΠολΔ — Lawspot](https://www.lawspot.gr/nomothesia/kpold/arthro-564-kodikas-politikis-dikonomias/)
- [Άρθρο 564 — DSA](https://www.dsa.gr/e-διαβούλευση/άρθρο-564-προθεσμία)
- [Άρθρο 632 ΚΠολΔ — Lawspot](https://www.lawspot.gr/nomothesia/kpold/arthro-632-kodikas-politikis-dikonomias/)
- [Άρθρο 632 — DSA](https://www.dsa.gr/e-διαβούλευση/άρθρο-632-ανακοπή-αναστολή-προθεσμία)
- [Ανακοπή κατά ΔΠ — tpvlaw](https://tpvlaw.gr/diatagi-pliromis-anakopi-a-632kpold-amina-ektelesh/)
- [Ν. 4842/2021 — DSAnet (ΦΕΚ)](https://www.dsanet.gr/Epikairothta/Nomothesia/Nomos_4842%20(190).htm)
- [Ν. 4842/2021 Τροποποιήσεις ΚΠολΔ άρθ. 43-60 — opengov](https://www.opengov.gr/ministryofjustice/?p=17902)
- [ΚΠολΔ 237 Αντικατάσταση — opengov](https://www.opengov.gr/ministryofjustice/?p=15200)
- [Προθεσμίες προτάσεων — Giannoulas Law](https://www.giannoulas.eu/proiesmies-protaseon-kai-prosthikis-antikrousis-kata-ton-kpold/)
- [Τακτική διαδικασία ν. 4842/2021 — ESDI PDF](https://www.esdi.gr/wp-content/uploads/2024/05/kyroudi_2024.pdf)
- [Σημαντικότερες τροποποιήσεις ν. 4842 — ENOBE PDF](https://enobe.org.gr/wp-content/uploads/2022/08/ΜΑΚΡΙΔΟΥ-Οι-σημαντικότερες-τροποποιήσεις-του-ν.-4842.pdf)
- [Ανακοπή εκτέλεσης 933-934 — xkarampagias](https://xkarampagias.gr/κατασχεσεισ-πλειστηριασμοι/573-ανακοπή-κατά-αναγκαστικής-εκτέλεσης-άρθρα-933,-934-κπολδ.html)
- [Ανακοπή 933 — opengov (άρθ. 60 ν.4842)](https://www.opengov.gr/ministryofjustice/?p=15152)
- [Εξαιρετέες ημέρες — efotopoulou](https://efotopoulou.gr/exeretees-imeres-gia-ton-ipologismo-ton-dikastikon-prothesmion/)
- [Υπολογισμός προθεσμιών — efotopoulou](https://efotopoulou.gr/ipologismos-enarxis-ke-lixis-prothesmias/)
- [Προθεσμία 630Α δεν αναστέλλεται — efotopoulou](https://efotopoulou.gr/i-prothesmia-tou-arthrou-630a-kpold-den-anastellete-kata-to-chroniko-diastima-apo-1-eos-31-avgoustou/)
- [Ασφαλιστικά μέτρα + κύρια αγωγή 693 — efotopoulou](https://efotopoulou.gr/asfalistika-metra-ke-i-prothesmia-gia-tin-askisi-kirias-agogis/)
- [Ασφαλιστικά 693 — opengov άρθ.50 ν.4842](https://www.opengov.gr/ministryofjustice/?p=15162)
- [Αναψηλάφηση 545 — xkarampagias](https://xkarampagias.gr/αστικεσ-εμπορικεσ-διαφορεσ-διαταξεισ-κπολδ/589-αναψηλάφηση-πολιτικής-δίκης-λόγοι-προθεσμία-άσκησης.html)
- [Ανακοπή ερημοδικίας — efotopoulou](https://efotopoulou.gr/erimodikia-stin-politiki-diki/)
- [Νομικές προθεσμίες (συνοπτικός πίνακας) — greeklaw.github.io](https://greeklaw.github.io/gr/προθεσμίες.html)
- [Προθεσμίες πολιτικής δίκης — ΔΣΤρίπολης](https://www.dstripolis.gr/προθεσμίες-στην-πολιτική-δίκη/)
- [Συνοπτικές τροποποιήσεις νέου ΚΠολΔ — ΔΣΚέρκυρας](https://www.dsc.gr/index.php/75-news/4725-συνοπτικα-οι-βασικεσ-τροποποιησεισ-τοy-νεου-κ-πολ-δ.html)
- [Ειδικές διαδικασίες ν. 4842/2021 — antimolia](https://antimolia.gr/ch-papastamou-oi-eidikes-diadikasies-meta-to-n-4842-2021/)
- [Πλειστηριασμός τροποποιήσεις ν.4842 — Sioufas Law](https://www.sioufaslaw.gr/n-4842-2021-oi-tropopoihseis-stin-anagkastiki-ektelesi-meros-b/)
- [Τριτανακοπή — opengov κεφ.31](http://www.opengov.gr/ministryofjustice/?p=11370)
- [Ανακοπή κατά ΔΠ 632 — offlinepost](https://www.offlinepost.gr/2023/10/22/anakopi-kata-diatagis-pliromis-i-anakopi-tou-arthrou-632-kpold/)
- [Αναστολή εκτέλεσης 938 — opengov άρθ.63](https://www.opengov.gr/ministryofjustice/?p=15149)

---

## Next Steps

1. **Θέμις (legal agent)**: Review των 7 Open Questions — αποφάσεις για production lock
2. **tool-specialist**: Λαμβάνει `kpold-rules-top30.json` ως spec source — υλοποιεί rules engine
3. **Ηρόδοτος** (follow-up αν χρειαστεί): Research Ν. 5221/2025 + ΑΠ νομολογία OQ-1/OQ-3
4. **Production lock**: Μετά Θέμις review, freeze rules v1.0

---

*Ηρόδοτος — Deep Research Agent | ΘΕΜΙΣ OS | 2026-04-29*
