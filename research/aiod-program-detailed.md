# AIoD EU Program — Deep Research Report
**Ηρόδοτος Research Agent | 2026-04-29**
**Call:** AIoD OC #1 – Private Sector (DeployAI Project)
**Deadline:** 8 Ιουνίου 2026, 17:00 CEST
**Portal:** F6S — https://www.f6s.com/aiod-oc1privatesector/apply

---

## Executive Summary

Το AIoD Open Call #1 είναι cascading grant (FSTP — Financial Support to Third Parties) κάτω από το **Digital Europe Programme**, διαχειριζόμενο από το consortium **DeployAI** (grant agreement 101146490-DIGITAL-2022-CLOUD-AI-B-03). Δεν αποτελεί Horizon Europe grant — είναι sub-grant που δίνεται από το consortium απευθείας σε SMEs. Funding: έως **€60.000** σε AI Providers, σε 3 στάδια (€5K → €35K → €20K). Η δομή είναι funnel: 50 → 20 → ~10 εταιρείες.

**Βασικό εύρημα για Niko:** Ατομική επιχείρηση γίνεται δεκτή (micro-enterprise < 10 persons = SME). ΘΕΜΙΣ OS ταιριάζει θεματικά (AI product TRL 7+). Κυριότερο εμπόδιο: υποχρεωτικά 3 in-person events σε Ευρωπαϊκές πόλεις (Σεπτ., Δεκ., Μάρτ.) και integration στο AIoD Platform (Docker containerization απαιτείται).

---

## Ερώτηση 1: Τι αναζητούν ως καινοτομία — είναι το ΘΕΜΙΣ OS eligible;

**Τι αναζητούν:**
- AI Providers: εταιρείες με **mature AI products, TRL 7+** (ήδη δοκιμασμένα σε πραγματικό περιβάλλον)
- Η λύση πρέπει να ενταχθεί στην **AIoD Platform** (EU's central AI marketplace/registry)
- Στόχος: να γίνουν οι λύσεις τους διαθέσιμες στην ευρωπαϊκή αγορά μέσω της πλατφόρμας
- Sectors: δεν υπάρχει explicit sector restriction — legal AI, healthcare AI, agritech κ.ά. είναι eligible

**Use cases που αναφέρονται:**
- AI solutions για SMEs σε οποιοδήποτε τομέα (horizontal)
- Έμφαση σε AI deployment & commercialisation, όχι pure R&D

**ΘΕΜΙΣ OS assessment:**
| Κριτήριο | ΘΕΜΙΣ OS | Status |
|---|---|---|
| AI product TRL 7+ | RAG με 1.46M points + rules engine — ΝΑΙ αν υπάρχει working prototype | ΠΙΘΑΝΟ ΝΑΙ |
| Docker containerization | Απαιτείται για integration | ΕΛΕΓΞΕ |
| Legal sector eligible | Δεν αποκλείεται — domain-agnostic call | ΝΑΙ |
| Existing AI product (όχι ιδέα) | ΘΕΜΙΣ OS σε v0.2/v0.3 — ΑΝ έχει demo-ready version | ΚΡΙΤΙΚΟ |
| EU deployment | Greece = EU Member State | ΝΑΙ |

**Verdict:** ΘΕΜΙΣ OS είναι **θεματικά eligible**, αλλά το κλειδί είναι ο TRL. Πρέπει να υπάρχει deployable product, όχι spec. Αν το ΘΕΜΙΣ OS είναι σε spec/prototype φάση, κινδυνεύει να αποκλειστεί ως TRL 6 ή κατώτερο.

---

## Ερώτηση 2: Υποχρεωτικά 5+ άτομα; Δέχονται ατομικές επιχειρήσεις;

**Απάντηση: ΟΧΙ, δεν υπάρχει minimum employee requirement.**

Αναλυτικά:
- Το call αναφέρει: "AI Providers who are **SMEs**, or research organisations (single legal entities)"
- EU SME definition (Recommendation 2003/361/EC): 
  - **Micro-enterprise**: < 10 άτομα, τζίρος < €2M — ΕΜΠΕΡΙΕΧΕΤΑΙ
  - **Small**: < 50 άτομα — ΕΜΠΕΡΙΕΧΕΤΑΙ
  - Ατομική επιχείρηση με 0 υπαλλήλους = micro-enterprise = SME κατά EU ορισμό
- Δεν αναφέρεται minimum headcount πουθενά στα διαθέσιμα docs
- Mid-caps (50-250 employees) αναφέρονται επίσης ως eligible σε Stages 1 & 2

**Συμπέρασμα για Niko:** Ατομική επιχείρηση MECE.gr είναι **eligible ως entity type**. Δεν χρειάζονται υπάλληλοι. Η απαίτηση είναι να είσαι νομικά καταχωρημένη οντότητα στην ΕΕ — ΟΚ.

---

## Ερώτηση 3: Πότε δίνουν τα χρήματα — payment schedule;

**Δομή πληρωμών (milestone-based lump sum, ΟΧΙ reimbursement):**

| Stage | Milestone | Πληρωμή |
|---|---|---|
| Stage 1: Pitch & Select (Σεπτ. 2026) | Επιλογή & pitch στο in-person event | **€5.000** |
| Stage 2: Integration (Οκτ.–Δεκ. 2026) | Full integration στο AIoD Platform | **€35.000** |
| Stage 3: Deployment (Ιαν.–Απρ. 2027) | Live deployment + Stage 3 event | **€20.000** |
| **Σύνολο AI Provider** | | **€60.000** |

**Σημαντικά:**
- Είναι **lump-sum** (όχι cost reimbursement — δεν ελέγχουν τιμολόγια)
- Η πληρωμή απελευθερώνεται με **ολοκλήρωση milestone**, όχι upfront
- Timeline από signed sub-grant agreement (Αύγ. 2026): ~2 μήνες έως first payment (€5K, μετά Stage 1 event Σεπτ. 2026)
- Τελική πληρωμή: Μάρτιος-Απρίλιος 2027

**Πρακτικά:** Δεν υπάρχει pre-financing. Πρέπει να έχεις cash flow για 2 μήνες μέχρι να έρθει το πρώτο €5K. Το bulk (€35K) έρχεται μετά τη Stage 2 (Δεκ. 2026).

---

## Ερώτηση 4: De minimis aid ή regular state aid;

**Απάντηση: Πιθανότατα ΟΧΙ de minimis — είναι EU-direct funding (non-state aid).**

Αναλυτική αιτιολόγηση:
- Το AIoD OC1 είναι **FSTP (Financial Support to Third Parties)** κάτω από το **Digital Europe Programme**
- EU-centrally-managed funds (Horizon Europe, Digital Europe): **δεν αποτελούν State Aid** κατά το άρθρο 107 ΣΛΕΕ, γιατί δεν διοχετεύονται μέσω κρατικών πόρων ή κρατικής διακριτικής ευχέρειας
- Επομένως: **δεν μετράει στο €300.000 de minimis ceiling** (Κανονισμός 2023/2831)
- Αυτό επιβεβαιώνεται από EU Parliament briefing: "EU resources awarded directly by the Union with no discretion on the part of national authorities do not constitute State resources"

**ΣΗΜΑΝΤΙΚΗ ΕΠΙΦΥΛΑΞΗ:** Αν το call docs ρητά αναφέρουν "de minimis" (check Sub-Grant Agreement), τότε ισχύει ο Κανονισμός. Ο Guide for Applicants δεν ανέφερε ρητά de minimis στα διαθέσιμα excerpts. **Πρέπει να ελεγχθεί το Sub-Grant Agreement PDF** που διατίθεται στο aiodp.ai/open_calls/.

**Πρακτικά για Niko:** Πιθανολογείται ότι δεν επηρεάζει το €300K ceiling σου, αλλά απαιτείται επιβεβαίωση από το Sub-Grant Agreement.

---

## Ερώτηση 5: Τι δεσμεύσεις έχει ο beneficiary;

**Επιβεβαιωμένες δεσμεύσεις:**

| Δέσμευση | Λεπτομέρεια |
|---|---|
| **3 mandatory in-person events** | Σεπτ. 2026, Δεκ. 2026, Μάρτ. 2027 — ΥΠΟΧΡΕΩΤΙΚΑ (κόστος μετακίνησης δικό σου) |
| **AIoD Platform registration** | Πριν την αίτηση — Business Navigator + AIoD Platform account |
| **Docker containerization** | Η λύση πρέπει να παραδοθεί σε containerized format |
| **Data confidentiality** | 5 χρόνια post-completion (δεν μπορείς να κοινοποιήσεις confidential data της AIoD) |
| **IP: παραμένει δικό σου** | "Solutions developed and results achieved belong to the third parties. Applicants remain sole owners of their IPRs" — ΘΕΤΙΚΟ |
| **Reporting** | Per-stage milestone reports (3 reports αντίστοιχα) |
| **Open source** | ΔΕΝ αναφέρεται υποχρέωση open-source για την λύση σου |
| **Consortium Stage 3** | Υποχρεωτική συνεργασία με AI Adopter (εταιρεία που χρησιμοποιεί τη λύση σου) |

**Ό,τι ΔΕΝ βρέθηκε ρητά (απαιτεί έλεγχο Sub-Grant Agreement):**
- Audit duration (τυπικά FSTP: 2-5 χρόνια)
- Claw-back conditions (τυπικά: αν δεν ολοκληρωθεί milestone, επιστρέφεις πληρωμή)
- Follow-up grants exclusion (άγνωστο)
- Sustainability metrics (post-project obligations)

**Geographic restrictions:** Εγγεγραμμένος σε EU Member State ή associated country Digital Europe — Greece ΟΚ.

---

## Comparison Matrix: ΘΕΜΙΣ OS vs AIoD Requirements

| Παράμετρος | AIoD Requirement | ΘΕΜΙΣ OS | Ετοιμότητα |
|---|---|---|---|
| Entity type | SME/research org, EU registered | Ατομική επιχείρηση GR | PASS |
| TRL | 7+ (demo-ready, real environment) | v0.2 spec, v0.3 pivot | RISK |
| AI product (not idea) | Yes — existing solution | RAG 1.46M + rules engine | PARTIAL |
| Docker containerization | Required | Not done yet | GAP |
| 3 in-person events | Mandatory travel | Solo founder bandwidth | RISK |
| AI Adopter (Stage 3) | Must find partner | Legal firm needed | ACTION NEEDED |
| IP ownership | Yours | Ναι | PASS |
| Open source | No obligation | N/A | PASS |
| De minimis ceiling | Not applicable (EU-direct) | Under €300K anyway | PASS |

---

## Recommendations (Ranked)

1. **ΑΜΕΣΑ (πριν αποφασίσεις):** Κατέβασε και διάβασε το **Sub-Grant Agreement PDF** από aiodp.ai/open_calls/ — επιβεβαίωσε de minimis status και claw-back terms.

2. **ΚΡΙΤΙΚΟ:** Αξιολόγησε το TRL του ΘΕΜΙΣ OS. Αν δεν υπάρχει working prototype με real user testing, η αίτηση είναι αδύνατη (TRL 6 → rejected). Το call δεν χρηματοδοτεί development — χρηματοδοτεί deployment.

3. **ΑΝ προχωράς:** Βρες AI Adopter τώρα (δικηγορικό γραφείο που θα κάνει pilot του ΘΕΜΙΣ OS) — υποχρεωτικό για Stage 3.

4. **Bandwidth check:** 3 in-person events σε EU πόλεις (πιθανά Brussels/Amsterdam/etc) = κόστος + χρόνος για solo founder. Αξίζει για €60K;

5. **Deadline είναι 8/6/2026** — έχεις 5 εβδομάδες. Η αίτηση είναι 3-stage funnel — το application form πρέπει να περιγράφει TRL 7+ product, όχι roadmap.

---

## Sources

- [AIoD Open Calls (aiodp.ai)](https://www.aiodp.ai/open_calls/) — Official call page, payment structure, eligibility
- [Cascade Funding Hub — AIoD OC #1](https://cascadefunding.eu/open-call/aiod-oc-1-private-sector/) — Cascade funding aggregator
- [F6S Application Portal](https://www.f6s.com/aiod-oc1privatesector/apply) — Submission portal
- [DigitalSME — Open Call for SMEs](https://www.digitalsme.eu/fundings/open-call-for-smes-to-integrate-and-deploy-innovative-ai-solutions/) — Summary
- [Science|Business — Cascade Funding Explained](https://sciencebusiness.net/news/r-d-funding/horizon-europe/explained-horizon-europes-cascade-funding) — FSTP mechanism
- [EUR-Lex — Regulation 2023/2831 de minimis](https://eur-lex.europa.eu/eli/reg/2023/2831/oj/eng) — De minimis legal basis
- [CORDIS — AI4Europe project](https://cordis.europa.eu/project/id/101070000) — Parent project info
- [EC Funding Tenders — FSTP info](https://webgate.ec.europa.eu/funding-tenders-opportunities/spaces/IT/pages/25559615/Cascade+Funding+Calls+Financial+Support+for+Third+Parties+FSTP)
- [Fraunhofer IAIS — AIoD Announcement](https://www.iais.fraunhofer.de/en/press-events/press-releases/AI-on-Demand_Platform.html)

---

*Report: Ηρόδοτος Research Agent | Επόμενο βήμα: Δαίδαλος αν αποφασιστεί αίτηση*
