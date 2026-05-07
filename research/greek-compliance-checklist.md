# ΘΕΜΙΣ OS — Greek Compliance Checklist (Pre-Launch)

**Έκδοση:** 1.0 (2026-04-29)
**Συντάκτης:** Themis (Head of Legal)
**Σκοπός:** Πλήρης λίστα νομικών/regulatory requirements που ΠΡΕΠΕΙ να ικανοποιεί το ΘΕΜΙΣ OS πριν δεχθεί τον πρώτο πραγματικό πελάτη (έναν Έλληνα δικηγόρο που αναθέτει υπόθεση πελάτη του στην πλατφόρμα).
**Συμπληρωματικό προς:** `/root/projects/themis-os/docs/greek-compliance.md` (v0.2 spec). Αυτό το checklist καλύπτει τα κενά που εντόπισε το v0.2 spec, προσθέτει privilege/conflict/ethical-walls/court-calendar/DPIA που δεν υπήρχαν, και δίνει υλοποιήσιμο action plan ανά item.

**Νομική παρατήρηση:** Το checklist είναι professional opinion του Head of Legal με βάση την κείμενη νομοθεσία και νομολογία. ΔΕΝ υποκαθιστά εξωτερικό sign-off από practicing Έλληνα δικηγόρο (βλ. `external-attorney-shortlist.md`). Όλες οι παραπομπές σε άρθρα/νόμους πρέπει να επανεπιβεβαιωθούν σε ΦΕΚ-level πριν launch.

**Status legend:**
- `READY` = το v0.3 spec/codebase ήδη το καλύπτει με αποδεκτό τρόπο
- `PARTIAL` = υπάρχει σχεδίαση αλλά λείπουν συγκεκριμένες ρυθμίσεις/UI/control
- `MISSING` = δεν υπάρχει τίποτα στο spec

---

## 1. Attorney-Client Privilege (Δικηγορικό Απόρρητο)

### 1.1 Άρθρο 5 περ. δ' & Άρθρο 38 Κώδικα Δικηγόρων (Ν. 4194/2013, ΦΕΚ Α' 208/27.09.2013)

**Rule:** Ο δικηγόρος υπέχει αυστηρή υποχρέωση εχεμύθειας/απορρήτου για κάθε πληροφορία που του εμπιστεύεται ο εντολέας. Η παραβίαση συνιστά πειθαρχικό παράπτωμα (άρθ. 139 ΚΔικ) και ποινικό αδίκημα (άρθ. 371 ΠΚ — παραβίαση επαγγελματικής εχεμύθειας).

**Συνέπειες για cloud SaaS:**
- Ο δικηγόρος που χρησιμοποιεί SaaS παραμένει ο μοναδικός υπεύθυνος του απορρήτου. Ο πάροχος είναι **εκτελών την επεξεργασία** (processor) που υπεισέρχεται σε προστατευόμενες πληροφορίες.
- Η ΓνΕισΑΠ 9/2009 (γνωμοδότηση Εισαγγελέα ΑΠ) και η νομολογία του ΕΔΔΑ (Niemietz κατά Γερμανίας 1992, André κατά Γαλλίας 2008, Leotsakos κατά Ελλάδας 2018, Laurent κατά Γαλλίας 2018) επεκτείνουν το απόρρητο σε ό,τι βρίσκεται φυσικά ή ηλεκτρονικά στον επαγγελματικό χώρο του δικηγόρου — άρα και στο cloud workspace.

**Status:** `PARTIAL`
- v0.2 §8 έχει "privilege tagging" σε επίπεδο εγγράφου και Invariant #9.
- ΛΕΙΠΕΙ: enforcement στο επίπεδο **column-level encryption** για privileged content με κλειδί που δεν διαθέτει ο πάροχος (zero-knowledge ή customer-managed KMS keys).
- ΛΕΙΠΕΙ: privilege flag στο επίπεδο **matter** (όχι μόνο document) — π.χ. ολόκληρη υπόθεση εμπίπτει σε privilege, οπότε όλα τα παράγωγα (notes, time entries, AI summaries) κληρονομούν το flag.
- ΛΕΙΠΕΙ: ρητός αποκλεισμός privileged content από AI training/fine-tuning telemetry.

**Action για compliance:**
1. Όλα τα `matter`, `document`, `note`, `time_entry`, `comm_log` rows πρέπει να φέρουν `privilege_class ENUM('attorney_client','work_product','joint_defense','none')`. Default = `attorney_client`.
2. Ξεχωριστό KMS key per tenant για privileged data· κλειδί κρατείται είτε σε Hetzner KMS (Phase 1) είτε σε customer-controlled HSM (Phase 2 add-on για Firm/Enterprise).
3. Logging: κάθε ανάγνωση/πρόσβαση σε privileged record γράφεται στο `audit_log` με `actor_id`, `legal_basis` (κανείς non-attorney user, ακόμα κι ο firm admin, δεν διαβάζει privileged ΧΩΡΙΣ ρητή έγκριση από τον υπεύθυνο δικηγόρο της υπόθεσης).
4. AI agents (Aegis): privileged content περνά μόνο σε EU-region endpoints **και** με contractual no-train clause (βλ. §2.5).

### 1.2 Πληροφορίες που ΔΕΝ επιτρέπεται να βλέπουν εκτός γραφείου

| Κατηγορία | Παραδείγματα | Status |
|-----------|--------------|--------|
| Επικοινωνία δικηγόρου-πελάτη | emails, SMS, WhatsApp, σημειώσεις συσκέψεων | privilege flag enforced |
| Στρατηγική υπόθεσης | Internal memos, "work product" | privilege flag enforced |
| Περιεχόμενο εξωδίκων/δικογράφων ΠΡΙΝ κατατεθούν | Προσχέδια | privilege flag enforced |
| Πληροφορίες αντιδίκου που έλαβε ο δικηγόρος υπό προστασία (ΚΠολΔ 401) | Αρχεία διαμεσολάβησης | NEW flag `mediation_protected` |

**Status:** `MISSING` το `mediation_protected` flag. Action: προσθήκη στο data-model schema.

### 1.3 Mandatory disclosures προς πελάτη όταν χρησιμοποιείται cloud SaaS

**Rule:** Δεν υπάρχει ρητή νομοθετική διάταξη που να επιβάλλει disclosure, αλλά:
- Άρθρο 35 ΚΔεοντ (Κώδικας Δεοντολογίας Δικηγορικού Λειτουργήματος) — υποχρέωση ενημέρωσης πελάτη για ουσιώδη ζητήματα της εντολής.
- ΓΚΠΔ άρθ. 13-14 — υποχρέωση ενημέρωσης για αποδέκτες δεδομένων (ο SaaS πάροχος είναι αποδέκτης).
- Best practice ΔΣΑ (μη δεσμευτική σύσταση 2022) — αναφορά σε εντολή ότι "η διαχείριση του φακέλου γίνεται μέσω εξωτερικού πληροφοριακού συστήματος που πληροί ΓΚΠΔ".

**Status:** `MISSING`
**Action:**
1. ΘΕΜΙΣ OS παρέχει pre-built **template εντολής** στα ελληνικά με ρητή ρήτρα: *"Ο πελάτης ενημερώνεται ότι το δικηγορικό γραφείο χρησιμοποιεί την πλατφόρμα ΘΕΜΙΣ OS (πάροχος: MECE.gr) για τη διαχείριση του φακέλου του. Η πλατφόρμα φιλοξενείται σε εξυπηρετητές εντός ΕΕ (Hetzner DE/FI), συμμορφώνεται με τον ΓΚΠΔ και τον Ν.4624/2019, και ο πάροχος δεσμεύεται με σύμβαση επεξεργασίας δεδομένων."*
2. Στο client portal: "Όροι Χρήσης" σε απλή γλώσσα που εξηγούν τι βλέπει ο πελάτης / τι όχι.

---

## 2. Data Protection / GDPR

### 2.1 Ν.4624/2019 §31 derogation για legal professionals

**Rule:** Άρθρο 31 Ν.4624/2019 (ΦΕΚ Α' 137/29.08.2019) επιτρέπει παρεκκλίσεις από δικαιώματα υποκειμένων (πρόσβαση, διόρθωση, διαγραφή, εναντίωση) **όταν η επεξεργασία απαιτείται για την άσκηση ή υποστήριξη νομικών αξιώσεων** ή για συμμόρφωση με υποχρεώσεις τήρησης αρχείου που επιβάλλει νόμος (φορολογικά, λογιστικά, πειθαρχικά).

**Status:** `READY` (καλύπτεται στο v0.2 §8 με ρητή αναφορά).
**Επιπλέον action:** Pseudonymization SOP πρέπει να γραφτεί ως πολιτική (όχι μόνο τεχνικό spec) και να συνυπογραφεί από DPO.

### 2.2 DPIA (Data Protection Impact Assessment) — άρθρο 35 ΓΚΠΔ

**Rule:** Υποχρεωτικό DPIA όταν η επεξεργασία ενδέχεται να επιφέρει υψηλό κίνδυνο. Η ΑΠΔΠΧ (Απόφαση 65/2018, Πίνακας §1) θεωρεί υψηλού κινδύνου:
- Συστηματική επεξεργασία ευαίσθητων δεδομένων (νομικές υποθέσεις περιέχουν δεδομένα υγείας, ποινικές καταδίκες, οικογενειακή κατάσταση).
- Χρήση καινοτόμων τεχνολογιών (AI/LLM = ναι).
- Μεγάλη κλίμακα.

**Συμπέρασμα:** ΘΕΜΙΣ OS = **υποχρεωτικό DPIA** πριν τον πρώτο πραγματικό πελάτη.

**Status:** `MISSING`
**Action:**
1. Σύνταξη DPIA report (template ΑΠΔΠΧ διαθέσιμο στο dpa.gr) που να καλύπτει:
   - Σκοπός και νομική βάση επεξεργασίας
   - Κατηγορίες δεδομένων (κανονικά, ειδικών κατηγοριών, ποινικά)
   - Aegis AI risk analysis (per-agent: τι δεδομένα, που πάνε, ποιος βλέπει)
   - Μέτρα ασφάλειας (κρυπτογράφηση, ACL, audit log)
   - Σχεδιασμός incident response
2. Προηγούμενη διαβούλευση με ΑΠΔΠΧ (άρθ. 36 ΓΚΠΔ) **εάν** το DPIA δείξει υπολειπόμενο υψηλό κίνδυνο που δεν μπορεί να μετριαστεί.
3. Επανεξέταση DPIA ετησίως ή σε κάθε major release.

### 2.3 Retention periods per data type

| Δεδομένα | Retention | Νομική βάση |
|----------|-----------|-------------|
| Φάκελος υπόθεσης | 20 έτη μετά το πέρας | Άρθ. 247 ΑΚ (γενική παραγραφή), βλ. και ΚΔικ άρθ. 38 §3 |
| Λογιστικά (τιμολόγια, αμοιβές) | 10 έτη | Ν.4308/2014 ΕΛΠ άρθ. 7 |
| myDATA records | 10 έτη | Ν.4308/2014 + Α.1138/2020 ΑΑΔΕ |
| Επικοινωνία (emails, chat) | 5 έτη μετά το κλείσιμο υπόθεσης (default), 20 έτη αν αποτελεί evidence | Διακριτική ευχέρεια δικηγόρου |
| Audit log | 10 έτη | Άρθ. 30 ΓΚΠΔ + ΓνΑΠΔΠΧ 2/2018 |
| Trust account ledger | 20 έτη | ΕΔΕ rules + Ν.4308/2014 |
| Backups | 90 ημέρες (operational), 1 έτος (disaster recovery), τότε διαγραφή | Best practice |
| AI logs (Aegis prompts/responses) | 30 ημέρες (debugging only), τότε διαγραφή ή ανωνυμοποίηση | Άρθ. 5 παρ. 1 ε' ΓΚΠΔ |

**Status:** `PARTIAL` — v0.2 αναφέρει "configurable retention", αλλά δεν δίνει defaults ανά κατηγορία.
**Action:** Hardcoded defaults στο schema migration (`document_retention_policy` table) με τα παραπάνω, παραμετροποιήσιμα μόνο ΠΡΟΣ ΤΑ ΠΑΝΩ από firm admin.

### 2.4 Anonymization vs deletion (legal hold)

**Rule:** Όσο ισχύει legal hold (εκκρεμής δίκη, εφορία, διοικητικός έλεγχος), η διαγραφή απαγορεύεται. Πρέπει να υπάρχει ρητός μηχανισμός legal hold flag που υπερισχύει του retention timer.

**Status:** `MISSING` (το v0.2 αναφέρει "legal hold" ως feature, αλλά δεν περιγράφει enforcement).
**Action:**
1. `legal_hold` ENUM column σε `matter` — values: `none|active|released`.
2. `release_reason` + `released_by_user_id` + `released_at` υποχρεωτικά κατά την άρση.
3. Background retention worker αγνοεί records με ενεργό legal hold.
4. UI alert όταν ο χρήστης προσπαθεί να διαγράψει matter με ενεργό hold.

### 2.5 Data Processing Agreement (DPA) — υποχρεωτικές ρήτρες

**Rule:** Άρθρο 28 §3 ΓΚΠΔ — δεσμευτικές ρήτρες:
- Αντικείμενο, διάρκεια, φύση, σκοπός
- Είδος δεδομένων + κατηγορίες υποκειμένων
- Δικαιώματα/υποχρεώσεις υπευθύνου
- Επεξεργασία μόνο κατόπιν τεκμηριωμένης εντολής
- Εμπιστευτικότητα προσωπικού
- Μέτρα ασφάλειας άρθ. 32
- Sub-processors (πρότερη γραπτή έγκριση)
- Συνδρομή σε δικαιώματα υποκειμένων
- Ενημέρωση για περιστατικά παραβίασης (72h)
- Διαγραφή/επιστροφή στο τέλος
- Δικαίωμα ελέγχου (audit right)

**Status:** `MISSING`
**Action:** Σύνταξη "Data Processing Addendum" ως μέρος των Όρων Χρήσης ΘΕΜΙΣ OS. Template ΕΕ (Standard Contractual Clauses module 2 — Controller-Processor) είναι αρκετό· εξειδίκευση για legal SaaS. Sign-off από εξωτερικό DPO ή GDPR-εξειδικευμένο δικηγόρο (βλ. shortlist §B).

### 2.6 No PII leaves EU + AI sub-processor risk

**Rule:** Άρθρα 44-49 ΓΚΠΔ. Anthropic Claude API διαθέτει EU residency endpoint (Frankfurt, Q1 2026 announced). Πρέπει να χρησιμοποιείται **αποκλειστικά** το EU endpoint.

**Status:** `READY` (Invariant #10 + v0.2 αναφορά EU LLM endpoints).
**Επιπλέον action:** Annual compliance check + technical guard rail (firewall rule που απορρίπτει non-EU LLM URLs).

---

## 3. ΔΣΑ Compliance

### 3.1 Γραμμάτιο: τύπος και χρόνοι

**Rule:** Άρθρο 61 §1 ΚΔικ — η προκαταβολή εισφορών (γραμμάτιο) είναι προϋπόθεση παράστασης. Έκδοση πριν την παράσταση. Μηνιαία εκκαθάριση από ΔΣΑ. Διορθώσεις/ακυρώσεις μόνο με νέο γραμμάτιο (κανόνας immutability).

Συνιστώσες (ποσοστά 2026, Απόφαση ΔΣ ΔΣΑ Ιανουαρίου 2026):
- ΕΦΚΑ τμήμα δικηγόρων: ~13.33%
- ΕΑΔΔ (επικουρικό + εφάπαξ): ~7.5%
- Λογαριασμός Ενίσχυσης ΔΣΑ (ΛΕΑΔΣΑ/ΛΕΕΔ): μεταβλητό
- Παρακρ. φόρου: 15% (ν.4172/2013 άρθ. 64 §1δ)
- Ταμειακή ενίσχυση/απαντήσεις/χαρτόσημο: μικρά πάγια

**Status:** `READY` (v0.2 §1 + `bar_rate_config` table).
**Επιπλέον action:**
- Auto-update rates μέσω **manual administrator entry** στο πρώτο τρίμηνο κάθε έτους. Όχι auto-scrape — υπάρχει ρίσκο λάθους που οδηγεί σε λανθασμένα γραμμάτια (πειθαρχικό).
- UI alert στον δικηγόρο τον Ιανουάριο: "Έχουν ενημερωθεί οι νέες κρατήσεις 2026; — [Ναι] [Όχι, υπενθύμιση μετά από 7 μέρες]".

### 3.2 Συνδρομές ΔΣΑ — αυτόματη ενημέρωση δυνατή;

**Rule:** Οι συνδρομές προς ΔΣΑ καταβάλλονται μέσω portal.olomeleia.gr. Δεν υπάρχει δημόσιο API.

**Status:** `MISSING` και πιθανότατα ΑΔΥΝΑΤΟ Phase 1.
**Action:**
- Phase 1: manual entry από τον δικηγόρο. Reminder 1/χρόνο.
- Phase 2: εάν portal.olomeleia.gr εκθέσει API ή scraping endpoint, integration. Σήμερα ΟΧΙ — **μην υποσχεθείς αυτοματισμό**.

### 3.3 Reporting obligations σε ΔΣΑ

**Rule:**
- Ετήσια δήλωση εσόδων (συμπληρωματική στο E1/E3) — δεν είναι υποχρέωση προς ΔΣΑ αλλά προς ΑΑΔΕ.
- Πειθαρχικά εκκρεμή/καταδικαστικά — οικειοθελής αναφορά.
- Τήρηση μητρώου εντολέων κατά Ν.4557/2018 (anti-money laundering) — υποχρεωτικό για δικηγόρους που εμπίπτουν σε ορισμένες κατηγορίες (real estate, εταιρικά, διαχείριση χρημάτων).

**Status:** `PARTIAL`
**Action:**
1. AML mode: opt-in flag στο firm. Αν ενεργό, εμφανίζεται UI για "Πελάτης AML-υπόχρεος": KYC fields, δηλώσεις προέλευσης χρημάτων, αναφορά σε Αρχή ΞΕ Φ-Π (Αρχή 1) όταν ενεργοποιηθεί ύποπτη συναλλαγή (Reporting → Αρχή Καταπολέμησης Νομιμοποίησης).
2. Annual revenue report export → CSV/PDF για ΑΑΔΕ E3 prep.

---

## 4. ΑΑΔΕ / myDATA

### 4.1 Mandatory invoice fields για δικηγόρο

**Rule:** Ν.4308/2014 (ΕΛΠ) άρθ. 9 + Α.1138/2020 + Α.1054/2021 ΑΑΔΕ:

| Πεδίο | Υποχρεωτικότητα |
|-------|------------------|
| ΑΦΜ εκδότη + ΔΟΥ | Υποχρ. |
| Πλήρης επωνυμία/ονοματεπώνυμο εκδότη | Υποχρ. |
| Διεύθυνση εκδότη | Υποχρ. |
| ΓΕΜΗ (αν εμπορική εταιρεία) | Υποχρ. |
| Αριθμός παροχής (ΔΕΗ) | Όχι υποχρ., αλλά απαιτητέο σε ορισμένες περιπτώσεις |
| ΑΦΜ + στοιχεία λήπτη | Υποχρ. |
| Σειρά + ΑΑ | Υποχρ. |
| Ημερομηνία έκδοσης | Υποχρ. |
| Είδος παραστατικού (ΑΠΥ 2.1, ΔΑ 2.2, κλπ.) | Υποχρ. |
| Καθαρή αξία | Υποχρ. |
| ΦΠΑ (κατηγορία + ποσοστό + ποσό) | Υποχρ. |
| Παρακράτηση φόρου (ποσοστό + ποσό) | Υποχρ. όταν εφαρμόζεται |
| Τέλη χαρτοσήμου | Όταν εφαρμόζεται |
| Συνολική αξία | Υποχρ. |
| MARK (από myDATA) | Μετά τη διαβίβαση |
| QR code με σύνδεσμο για online verification | Συνιστώμενο |

**Status:** `READY` (v0.2 §2 + XML example).
**ΛΕΙΠΕΙ:** validation engine που να μπλοκάρει finalize αν λείπει υποχρεωτικό πεδίο.

### 4.2 ΦΠΑ — εξαιρέσεις στις νομικές υπηρεσίες

**Rule:** Νομικές υπηρεσίες = 24% ΦΠΑ standard rate (Ν.2859/2000 άρθ. 21).
**Εξαιρέσεις:**
- Νομική βοήθεια Ν.3226/2004 (νομική βοήθεια σε πολίτες χαμηλού εισοδήματος) — απαλλάσσεται.
- Δικηγόροι μέλη ΔΣ μη κερδοσκοπικών οργανώσεων (πάροχος υπηρεσίας ΑΜΚΕ/ΝΠΙΔ) — εξαρτάται από καθεστώς.
- Υπηρεσίες προς λήπτες εκτός ΕΕ — άρθ. 14 §1 παρ. 13 — αντίστροφη χρέωση.
- Υπηρεσίες προς υποκείμενο σε ΦΠΑ ΕΕ-εκτός Ελλάδας — αντίστροφη χρέωση.

**Status:** `PARTIAL` (v0.2 αναφέρει 24% generic).
**Action:** Invoice creation wizard ρωτά "Πελάτης εντός ΕΕ;", "Λήπτης υποκείμενος σε ΦΠΑ;", και εφαρμόζει σωστή κατηγορία ΦΠΑ. ΑΦΜ validation με VIES API για cross-border.

### 4.3 e-invoice format & transmission timing

**Rule:** Α.1138/2020 ΑΑΔΕ:
- Β2Β τιμολόγια: διαβίβαση σε **πραγματικό χρόνο** (max 1 εργάσιμη μέρα).
- Δελτία αμοιβής (ΔΑ): διαβίβαση εντός 5 ημερών.
- Από 2026, ηλεκτρονική τιμολόγηση peppol/structured είναι ευχέρεια όχι υποχρέωση για δικηγόρους — υποχρέωση μόνο για συναλλαγές με Δημόσιο.

**Status:** `READY` (v0.2 §2 με BullMQ worker).
**Action:** Add SLA monitor: alert αν transmission queue > 30 λεπτά.

### 4.4 Παρακράτηση φόρου στην αμοιβή

**Rule:** Άρθ. 64 §1 περ. δ' Ν.4172/2013 (ΚΦΕ) όπως ισχύει:
- **20% παρακράτηση** στις αμοιβές δικηγόρων από νομικά πρόσωπα/επιτηδευματίες, **εφόσον το ποσό της αμοιβής υπερβαίνει τα 300€** πέραν του γραμματίου προκαταβολής.
- **15% παρακράτηση** στις αμοιβές γραμματίου προκαταβολής (επί της δικηγορικής αμοιβής, όχι του συνόλου του γραμματίου).
- ΧΩΡΙΣ παρακράτηση όταν λήπτης = ιδιώτης (φυσικό πρόσωπο μη επιχείρηση).

**Status:** `PARTIAL` — v0.2 §2 αναφέρει 15% αλλά δεν διακρίνει σαφώς το 20%/300€ threshold ούτε το ιδιώτης-vs-επιχείρηση case.
**Action:**
1. Logic engine στο Billing module:
   ```
   if recipient.entity_type == 'individual' and not recipient.is_business:
       withholding = 0
   elif fee_amount <= 300 + grammatio_amount:
       withholding = grammatio_fee * 0.15  # μόνο 15% στο γραμμάτιο
   else:
       withholding_grammatio = grammatio_fee * 0.15
       withholding_excess = (fee_amount - grammatio_fee) * 0.20
       withholding = withholding_grammatio + withholding_excess
   ```
2. UI εμφανίζει break-down + νομική παραπομπή.

---

## 5. ΑΠΕΔ / Qualified Signatures

### 5.1 Πότε required vs optional

**Rule:**
- **Υποχρεωτικά (qualified signature)**:
  - Δικόγραφα κατατιθέμενα στο SOLON (από 1.1.2026, Ν.5221/2025)
  - Εξώδικες δηλώσεις (από συγκεκριμένη ημερομηνία ανά είδος)
  - Δηλώσεις προς πιστοποιούσες αρχές
- **Optional**:
  - Εσωτερικά memos δικηγορικού γραφείου
  - Ηλεκτρονικά αντίγραφα εγγράφων που δεν προορίζονται για κατάθεση

**Νομική ισχύς:** Άρθ. 25 Καν. eIDAS 910/2014 — qualified signature = ισοδύναμη χειρόγραφης. Άρθ. 13 ΠΔ 150/2001 (μεταφορά οδηγίας eSignatures) + Ν.4727/2020 άρθ. 50 (ηλεκτρονική διακυβέρνηση) ισχύουν.

**Status:** `READY` (v0.2 §7 πλήρες spec).

### 5.2 Νομική ισχύς σε αποφάσεις vs δικόγραφα

**Rule:**
- **Δικαστικές αποφάσεις:** Υπογράφονται ψηφιακά από τον δικαστή στο SOLON. Τα ηλεκτρονικά αντίγραφα έχουν την ίδια ισχύ με τα έντυπα (Ν.4727/2020 άρθ. 13).
- **Δικόγραφα:** Από τη δημοσίευση Ν.5221/2025, η ηλεκτρονική κατάθεση μέσω SOLON υπερτερεί. Η qualified signature του δικηγόρου είναι υποχρεωτική για την επικύρωση.
- **Εξώδικα:** Επίδοση μέσω δικαστικού επιμελητή παραμένει βασική. Η ψηφιακή έκδοση γίνεται αποδεκτή σε όσες περιπτώσεις προβλέπεται από τον νόμο (π.χ. PSI 2026).

**Status:** `READY` (καλύπτεται).
**Action:** Documentation στο help center για κάθε case.

---

## 6. Trust Accounting (ΕΔΕ)

### 6.1 Segregation requirements

**Rule:** Άρθ. 38 §6 ΚΔικ + Κώδικας Δεοντολογίας άρθ. 38-40 (Ισοκράτης ΔΣΑ — Πρόσφατη έκδοση 2025):
- Ξεχωριστός τραπεζικός λογαριασμός για χρήματα πελατών (escrow, διεκπεραιωτικά, διαμεσολάβηση).
- Ονομασία/χαρακτηρισμός λογαριασμού: "Ειδικός λογαριασμός χειρισμού χρημάτων εντολέων".
- Απόλυτη απαγόρευση ανάμειξης (commingling) με προσωπικό/εταιρικό κεφάλαιο.

**Status:** `READY` (v0.2 §10).

### 6.2 Reporting frequency

**Rule:** Δεν υπάρχει νομοθετικά καθορισμένη συχνότητα reporting προς ΔΣΑ. Best practice:
- Μηνιαία αντιστοίχιση (reconciliation) τράπεζας ↔ ledger.
- Ανά ζήτηση πελάτη: αναλυτική κατάσταση κίνησης του sub-account του.
- Ετήσιο audit από εξωτερικό λογιστή για γραφεία > 5 δικηγόρων.

**Status:** `READY` (v0.2 §10 — 2-way Phase 1, 3-way Phase 2).

### 6.3 Audit trail requirements

**Rule:** Κάθε κίνηση: timestamp, χρήστης, ποσό, λόγος, αναφορά υπόθεσης/πελάτη. Reconciliation events lock τα αρχεία.

**Status:** `READY` (v0.2 §10 + Invariant #4).

---

## 7. SOLON / e-Filing

### 7.1 Hardware token reality

**Πραγματικότητα 2026:**
- ΑΠΕΔ tokens (USB Gemalto MD940 ή νεότερα) είναι ΥΠΟΧΡΕΩΤΙΚΑ για qualified signature ΕΚΤΟΣ αν ο δικηγόρος έχει remote signature certificate (cloud-based qualified signature) που εκδίδει η ΑΠΕΔ από Q4 2025.
- Όλο και περισσότεροι δικηγόροι έχουν remote signature → Phase 2 αυτοματισμός γίνεται εφικτός.
- TAXISnet OAuth2 για login στο portal.solon.gov.gr ΕΚΤΟΣ από την qualified signature στο PDF.

**Status:** `READY` (v0.2 §6 wrapper Phase 1 + Phase 2 auto).

### 7.2 Server-side automation θεωρητικά επιτρεπτή;

**Rule:** ΟΧΙ για qualified signature (η ιδιοκτησία ιδιωτικού κλειδιού πρέπει να είναι αποκλειστική του δικηγόρου, άρθ. 24 eIDAS). Server-side επιτρέπεται μόνο για:
- ZIP package assembly
- PDF/A-2 conversion
- Submission preparation (όχι actual signing)
- Status polling (Phase 2)

**Status:** `READY`. **Action:** Στο Privacy Policy ξεκάθαρη δήλωση ότι η qualified signature γίνεται πάντα από τον δικηγόρο.

### 7.3 Hybrid (manual click + auto-prep) acceptable

**Rule:** Ναι, και είναι το safest design Phase 1. Η Ολομέλεια Δικηγορικών Συλλόγων έχει δηλώσει ρητά (ανακοίνωση 03/2026) ότι **wrapper-mode** εφαρμογές που προετοιμάζουν packages αλλά αφήνουν τον δικηγόρο να κάνει manual upload δεν παραβιάζουν κανέναν κανόνα.

**Status:** `READY`.

---

## 8. Court Calendar Sources

### 8.1 Επίσημες πηγές

| Πηγή | Τι παρέχει | API/Format | Reliability |
|------|-----------|-----------|-------------|
| portal.solon.gov.gr | Πίνακες δικασίμων πολιτικά + ποινικά | HTML scraping (όχι API) | Υψηλή |
| ste.gr (ΣτΕ) | Πινάκια διοικητικών | HTML | Μέτρια (ad-hoc updates) |
| areios pagos.gr | Πινάκια ΑΠ | HTML | Υψηλή |
| ΟΣΔΔΥ-ΠΠ | Σύστημα ολοκληρωμένης διαχείρισης | API (περιορισμένο, μόνο authenticated) | Υψηλή |
| dikastiko.gr (private) | News-driven | RSS | Χαμηλή για πινάκια |

**Status:** `MISSING` στο v0.2 (αναφέρεται μόνο court database, όχι auto-import πινακίων).
**Action:**
1. Phase 1: Manual entry πινακίου από δικηγόρο (απλό + αξιόπιστο).
2. Phase 2: SOLON πινάκια integration (όταν εκθέσουν API).
3. Phase 2: Scraping πινακίων ΣτΕ/ΑΠ με fallback alerts στον δικηγόρο για επιβεβαίωση.

### 8.2 Frequency updates

- Πινάκια εκδίδονται 7-15 ημέρες πριν τη δικάσιμο.
- Αναβολές/ματαιώσεις: ad-hoc.
- ΘΕΜΙΣ OS πρέπει να κάνει **καθημερινό re-check** πινακίων + alert αν αλλάξει η ημερομηνία υπόθεσης.

---

## 9. Conflict of Interest Detection

### 9.1 Νομική υποχρέωση

**Rule:** Άρθρο 35 ΚΔικ + άρθ. 12 Κώδικα Δεοντολογίας: ο δικηγόρος δεν αναλαμβάνει υπόθεση που τον φέρνει σε σύγκρουση συμφερόντων με προηγούμενο/τρέχοντα εντολέα. Πειθαρχικά διώκεται.

**Σύγκρουση** σημαίνει:
- Ο νέος εντολέας έχει αντίθετα συμφέροντα με τρέχοντα/πρώην
- Ο δικηγόρος έχει αποκτήσει εμπιστευτικές πληροφορίες χρήσιμες για τον αντίδικο
- Οικογενειακή/οικονομική σχέση με αντίδικο, δικαστή, μάρτυρα

**Status:** `PARTIAL` (v0.2 αναφέρει "Conflict Agent" αλλά δεν περιγράφει νομική υποχρέωση).
**Action:**
1. Conflict check ΥΠΟΧΡΕΩΤΙΚΟ workflow πριν "Δημιουργία υπόθεσης":
   - Fuzzy match σε όλα τα πρώην/τρέχοντα ονόματα/ΑΦΜ (clients, opposing parties, third parties)
   - Phonetic Greek matching (Soundex variant για ελληνικά)
   - AI agent επιστρέφει score + λίστα πιθανών hits
   - **Δικηγόρος υποχρεωτικά αποφασίζει**: "Καμία σύγκρουση" / "Σύγκρουση — απορρίπτω" / "Πιθανή — να εξεταστεί" (with audit log)
2. Re-check trigger όταν προστίθεται νέο πρόσωπο σε υπάρχουσα υπόθεση.

### 9.2 Documentation requirements

**Rule:** Ο δικηγόρος πρέπει να μπορεί να αποδείξει σε πιθανή πειθαρχική διαδικασία ότι έγινε conflict check. Documentation: timestamped log + αρχεία.

**Status:** `MISSING`
**Action:**
- Κάθε conflict check παράγει immutable record στο `audit_log` με:
  - timestamp, υπεύθυνος δικηγόρος, ID υπόθεσης
  - Λίστα ονομάτων που ελέγχθηκαν
  - Λίστα hits (με score)
  - Decision + reason + signature (digital signature ή απλή confirmation)
- Export δυνατότητα: PDF report για φάκελο πειθαρχικής υπεράσπισης.

---

## 10. Ethical Walls / Information Barriers

### 10.1 Πότε required

**Rule:** Άρθρο 35 §3 ΚΔικ + Κώδικας Δεοντολογίας άρθ. 13 — όταν η σύγκρουση είναι μερική (π.χ. δικηγορική εταιρεία αναλαμβάνει mass action όπου διαφορετικοί δικηγόροι εκπροσωπούν διαφορετικές πλευρές), επιτρέπεται με ρητή ηθικά τείχη + έγγραφη συναίνεση όλων των ενδιαφερομένων.

**Παραδείγματα:**
- Mergers & acquisitions όπου το ίδιο γραφείο συμβουλεύει μέρη που αργότερα έγιναν αντίδικοι
- Class actions
- Family disputes με πολλαπλούς δικαιούχους

**Status:** `PARTIAL` (v0.2 αναφέρει "ethical walls" χωρίς detail).
**Action:**
1. `ethical_wall` table: id, matter_id, walled_users[], allowed_users[], reason, created_by, expires_at.
2. ACL enforcement: walled_users ΔΕΝ βλέπουν matter στις λίστες, στο search, στις notifications, στα reports.
3. Audit: κάθε attempted access loggings.
4. UI: στο matter cockpit, ένδειξη "Ethical Wall ενεργό — περιορισμένη πρόσβαση".

### 10.2 Software enforcement requirements

**Rule:** Δεν είναι νομική απαίτηση τα ethical walls να είναι hardware-enforced. Software ACL επαρκεί ΕΦΟΣΟΝ:
- Δεν παρακάμπτεται από admin
- Καταγράφονται όλες οι προσπάθειες παραβίασης
- Υπάρχει tamper-evident audit log

**Status:** `PARTIAL`
**Action:** Firm super-admin ΔΕΝ μπορεί να παρακάμψει ethical wall χωρίς να αφήσει immutable audit entry + email notification στους walled lawyers.

---

## Συνοπτικός πίνακας action items ανά priority

| # | Item | Priority | Effort | Section |
|---|------|----------|--------|---------|
| 1 | DPIA report + ΑΠΔΠΧ διαβούλευση | P0 | 2-3 weeks | 2.2 |
| 2 | DPA template + ΣΧΡ μεταξύ ΘΕΜΙΣ OS και firms | P0 | 1 week (legal review) | 2.5 |
| 3 | Conflict check ΥΠΟΧΡΕΩΤΙΚΟ workflow + audit | P0 | 2 weeks | 9.1, 9.2 |
| 4 | Privilege flag enforcement (matter+document) | P0 | 1.5 weeks | 1.1, 1.2 |
| 5 | Withholding tax 20%/15%/0% logic engine | P0 | 1 week | 4.4 |
| 6 | Legal hold flag + retention worker integration | P1 | 1 week | 2.4 |
| 7 | Client disclosure template (εντολή ρήτρα) | P1 | 2 days (legal text) | 1.3 |
| 8 | Ethical walls full schema + ACL + UI | P1 | 2 weeks | 10.1, 10.2 |
| 9 | AML mode (opt-in) | P1 | 2 weeks | 3.3 |
| 10 | Court calendar import (Phase 1 manual + Phase 2 scraping) | P2 | 3 weeks | 8.1, 8.2 |
| 11 | ΦΠΑ exemption/reverse-charge logic | P2 | 4 days | 4.2 |
| 12 | Customer-managed KMS keys (Firm/Enterprise) | P2 | 3 weeks | 1.1 |

**Συνολικό effort προ-launch:** ~12-14 εβδομάδες (Phase Gate D extension).

---

## ΕΞΩΤΕΡΙΚΟ SIGN-OFF (από `external-attorney-shortlist.md`)

Πριν τον πρώτο πελάτη, υποχρεωτικά sign-off:

1. **DPO/GDPR specialist** — DPIA + DPA + privilege architecture (Spagakou/Dryllerakis/GDPR Team)
2. **Practicing civil procedure attorney** — ΚΠολΔ deadline rules + conflict check workflow (βλ. shortlist)
3. **Tax accountant + ΔΣΑ liaison** — myDATA + γραμμάτιο rates
4. **Trust accounting specialist (λογιστής δικηγορικών εταιρειών)** — ΕΔΕ rules
5. **eIDAS/SOLON practitioner** — wrapper output verification

**Total sign-off budget:** €18,000 (όπως ήδη εκτιμήθηκε στο v0.2 §11).

---

*Έγγραφο 1.0 — αναθεώρηση μετά την προσθήκη v0.3 module list.*
