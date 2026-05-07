# SOLON Integration Research — ΘΕΜΙΣ OS
**Ηρόδοτος Deep Research Agent**
**Ημερομηνία:** 2026-04-28
**Queries εκτελέστηκαν:** 12 WebSearch
**Status:** FINAL — παραδίδεται σε Δαίδαλο για implementation planning

---

## Executive Summary

1. **Το "SOLON" για e-filing δεν είναι ένα portal — είναι δύο.** Το solon.gov.gr (ΟΣΔΔΥ-ΠΠ) χειρίζεται κυρίως tracking υποθέσεων και έκδοση πιστοποιητικών. Το **portal.olomeleia.gr** είναι το actual e-filing portal για κατάθεση δικογράφων. Αυτή η διάκριση είναι κρίσιμη για τον σχεδιασμό integration.

2. **Κανένας ανταγωνιστής δεν έχει επαληθευμένο full automation.** ORBIT, Thesis.net, Alma — κανένα από αυτά δεν έχει δηλώσει δημοσίως πλήρη αυτοματοποιημένη κατάθεση μέσω SOLON/Olomeleia. Η αγορά είναι στο επίπεδο "workflow prep" και manual upload.

3. **Το technical stack είναι Oracle WebCenter/ADF (Java EE).** Η URL `solon.gov.gr/webcenter/portal/` αποκαλύπτει Oracle ADF framework — βαρύ enterprise Java stack, jsessionid-based sessions, stateful ADF view components. Δύσκολο στο reverse engineering, όχι αδύνατο.

4. **Ν.5221/2025 υποχρεωτική ηλεκτρονική κατάθεση από 1/1/2026** — η αγορά είναι τώρα, η ζήτηση για tooling explodes. Παράθυρο πρωτοκινητή για ΘΕΜΙΣ OS.

5. **MySolon project αποδεικνύει ότι scraping είναι τεχνικά εφικτό** αλλά fragile — connectivity failures αναφέρονται από χρήστες, εξαρτάται από portal stability που ιστορικά είναι πρόβλημα.

---

## Track 1 — Competitive Matrix

### Α. Ανταγωνιστές & SOLON Integration

| Competitor | Χώρα focus | SOLON/e-filing claim | Πώς το marketing | API access claim | User-reported status | Pricing signal |
|---|---|---|---|---|---|---|
| **ORBIT Law Plus** (orbit.gr) | GR | Άγνωστο — δεν βρέθηκε δημόσια αναφορά σε SOLON integration | Γενική οργάνωση υποθέσεων, deadlines, documents | Όχι | Δεν βρέθηκε review | Άγνωστο |
| **MySolon** (mysolon.gr) | GR | Ναι — monitoring μόνο (tracking, όχι filing) | "Αυτόματες ειδοποιήσεις από solon.gov.gr" via Telegram bot | Ανεπίσημο scraping | Αστάθειες αναφέρονται (connectivity failures solon↔mysolon) | Freemium/free tool |
| **Thesis.net / CGSoft** | GR | Άγνωστο — CGSoft είναι ERP/CRM vendor, χωρίς legal e-filing claims | ERP, CRM, BI γενικά | Όχι | Δεν βρέθηκε | Enterprise ERP |
| **Alma / ΝΒ** (nb.org/alma) | GR | Άγνωστο — φαίνεται νομική βιβλιοθήκη/research, όχι practice management | Νομική βάση δεδομένων | Όχι | Δεν βρέθηκε | Subscription |
| **Lawgic.gr** | GR | Partial — guides/tutorials για SOLON + Olomeleia portal | "Οδηγός επιβίωσης" για e-filing, troubleshooting | Όχι | Χρήσιμο community resource | Free content |
| **portal.olomeleia.gr** | GR | ΝΑΙ — είναι το ίδιο το filing portal | Επίσημος portal ΟλοΜέλειας για κατάθεση δικογράφων | Δεν υπάρχει public API — state-owned system | Χρησιμοποιείται υποχρεωτικά από δικηγόρους | Δωρεάν για δικηγόρους |
| **Nomos Legal Practice** (nomoslegalpractice.com) | GR | Άγνωστο — practice management, δεν βρέθηκε SOLON claim | Modern practice management | Δεν φαίνεται | Δεν βρέθηκε | Άγνωστο |
| **IQ Lex / NomosOnline** | GR/DE | Δεν επαληθεύτηκε GR market focus | Legal research database | Όχι | Δεν βρέθηκε | Research subscription |

### Β. Βασικά Συμπεράσματα Track 1

- **Κανένας GR competitor δεν έχει ανακοινώσει επίσημο SOLON API integration** — το "SOLON integration" στην αγορά σήμερα σημαίνει "βοηθάμε να προετοιμάσεις τα αρχεία" ή "σε ειδοποιούμε για αλλαγές".
- **MySolon** είναι το μόνο confirmed automated tool — αλλά κάνει μόνο monitoring (read-only), όχι filing (write). Χρησιμοποιεί scraping, έχει αστάθειες.
- **portal.olomeleia.gr** είναι το critical path, όχι solon.gov.gr. Αυτό αλλάζει την τεχνική ανάλυση.
- **Η αγορά είναι κενή** από legitimate, reliable automated filing tool. First-mover advantage διαθέσιμο.

---

## Track 2 — Technical Feasibility Analysis

### Α. SOLON / Olomeleia Portal Architecture

**Solon.gov.gr (ΟΣΔΔΥ-ΠΠ):**
- URL pattern: `solon.gov.gr/webcenter/portal/osddy/home` — επιβεβαιώνει **Oracle WebCenter Portal** framework
- URL pattern: `extapps.solon.gov.gr/mojwp/faces/TrackDocket` — **Oracle ADF (Application Development Framework)**, JSF-based
- jsessionid φαίνεται ανοιχτά στα URLs (`jsessionid=gzpusCmvT5SqCWcxjHXiubmbsaAznrTt5hmi62WMHG25DvoflErb!2050044211`) — stateful server-side session management
- Tech stack: Java EE / Oracle ADF / WebCenter Portal / JSF (JavaServer Faces)
- Backend: Oracle Database (implied από Oracle stack)

**portal.olomeleia.gr (actual e-filing):**
- BackOffice URL: `bar.olomeleia.gr/BackOffice/login.aspx` — **.NET ASP.NET** framework (`.aspx` extension)
- Ξεχωριστό σύστημα από solon.gov.gr — διαφορετικός vendor, διαφορετική αρχιτεκτονική
- Δύο ξεχωριστά targets για integration = διπλασιασμός πολυπλοκότητας

### Β. Authentication Model

**solon.gov.gr:**
- TaxisNet OAuth/SSO — standard Greek government auth
- Χρησιμοποιεί AADE credentials (ΑΦΜ + password)
- Δεδομένα που περνά: VAT, Ονοματεπώνυμο, Πατρώνυμο, Έτος γέννησης

**portal.olomeleia.gr (filing):**
- Απαιτεί **ψηφιακή υπογραφή** (ΑΠΕΔ token, π.χ. Safenet) — ΟΧΙ απλό TaxisNet
- Το Safenet token software πρέπει να τρέχει locally
- MFA με hardware token = **κρίσιμο blocker για full server-side automation**

### Γ. Reverse Engineering Feasibility

| Παράγοντας | Solon.gov.gr (tracking) | portal.olomeleia.gr (filing) | Assessment |
|---|---|---|---|
| **Tech stack** | Oracle ADF/JSF — view state encoded | ASP.NET — ViewState encoded | Και τα δύο δύσκολα αλλά δυνατά |
| **Auth** | TaxisNet OAuth | ΑΠΕΔ digital signature hardware token | ΑΠΕΔ token = hardware blocker |
| **Session mgmt** | jsessionid stateful | ASP.NET session | Standard, scriptable |
| **CAPTCHA** | Δεν επιβεβαιώθηκε | Δεν επιβεβαιώθηκε | Πιθανά άπαν (gov portals) |
| **Rate limiting** | Άγνωστο | Άγνωστο | Πιθανό |
| **Stability** | Γνωστές αστάθειες (MySolon reports) | Γνωστά προβλήματα (DSA Αθηνών παράπονα) | High fragility risk |
| **GitHub activity** | Μόνο academic Solon (different project) | Τίποτα | Zero community RE attempt |
| **Legal exposure** | Μέτριο (ToS) | Υψηλό (ψηφιακή υπογραφή manipulation) | Σημαντικός κίνδυνος |

**Κρίσιμος τεχνικός περιορισμός:** Η κατάθεση μέσω portal.olomeleia.gr απαιτεί hardware ΑΠΕΔ token (Safenet) που τρέχει **locally στο μηχάνημα του δικηγόρου**. Αυτό σημαίνει ότι server-side automation από εξωτερική εφαρμογή είναι αρχιτεκτονικά αδύνατη χωρίς ειδική συμφωνία για "remote signing" service — που δεν υπάρχει δημοσίως.

### Δ. MySolon — Το Μόνο Confirmed Automation Precedent

- **MySolon** (mysolon.github.io / mysolon.gr): Telegram bot που monitors solon.gov.gr
- Λειτουργία: user δίνει GAK αριθμό + δικαστήριο → bot ειδοποιεί για αλλαγές
- Τεχνική βάση: scraping του solon.gov.gr (read-only, δεν κάνει filing)
- Προβλήματα: αναφερόμενες αστάθειες σύνδεσης `mysolon↔solon.gov.gr`
- Συμπέρασμα: αποδεικνύει ότι read-only scraping είναι δυνατό, αλλά fragile

### Ε. Legal/Regulatory Angle

**Νόμος 5221/2025:**
- Υποχρεωτική αποκλειστικά ψηφιακή κατάθεση από 1/1/2026
- Υποχρεωτικός ψηφιακός φάκελος (ΟΣΔΔΥ-ΠΠ) ως μοναδικός αποδέκτης
- Ο νόμος δεν αναφέρει third-party integrations ή API — blank slate

**ToS solon.gov.gr:**
- Δεν βρέθηκε δημόσια ανάρτηση ToS που να απαγορεύει ρητά automation
- Η χρήση TaxisNet credentials σε third-party app είναι legally γκρίζα ζώνη
- GDPR exposure: εάν η εφαρμογή αποθηκεύει credentials ή case data, χρειάζεται DPIA

**ΑΠΕΔ digital signature manipulation:**
- Η χρήση digital signature token μέσω third-party software που "emulates" user action είναι υψηλού νομικού κινδύνου — ισοδύναμο με "electronic impersonation"
- Η ΕΕΑΕ (Αρχή Ηλεκτρονικών Επικοινωνιών) / ΑΠΕΔ rules θα ήταν σχετικές

---

## Recommendations για ΘΕΜΙΣ OS

### 1. Option D (Hybrid) — ΕΠΙΒΕΒΑΙΩΜΕΝΑ ΣΩΣΤΗ ΣΤΡΑΤΗΓΙΚΗ

**Ranking: A (Strongly Recommended)**

Το Option D είναι η μόνη στρατηγικά υγιής επιλογή για τους εξής λόγους:
- Hardware ΑΠΕΔ token απαιτεί physical presence ή local software — server-side full automation είναι αρχιτεκτονικά blocked
- Portal instability (αναφερόμενη από DSA Αθηνών, MySolon users) σημαίνει ότι automation dependency = SLA risk
- Zero published API = zero contractual reliability guarantee
- Legal exposure σε "credential automation" χωρίς formal partnership

**Υλοποίηση Option D που προτείνεται:**
- ΘΕΜΙΣ OS κάνει: PDF generation (correct format), ΑΠΕΔ signing workflow UI, Γραμμάτιο calculation, e-Paravolo reference generation, validation checklist
- User κάνει: login στο portal.olomeleia.gr, upload του ready package (1 upload button, prefilled)
- Friction: ~2-3 minutes αντί ~30+ minutes. Αυτό είναι το selling point.

### 2. R&D Investment σε Reverse Engineering — ΑΠΟΦΥΓΗ (μεσοπρόθεσμα)

**Ranking: C (Avoid for now)**

Δεν αξίζει sprint resources γιατί:
- Hardware token blocker δεν λύνεται με software
- Oracle ADF ViewState + JSF state management = high maintenance overhead
- Portal instability = automation breaks frequently
- Zero legal clarity = compliance risk για B2B SaaS
- Μηδέν community interest (κανένα GitHub repo) = μόνοι στο πρόβλημα

**Εξαίρεση:** Browser extension approach — ένα Chromium extension που pre-fills portal.olomeleia.gr fields από ΘΕΜΙΣ data. Αυτό δεν απαιτεί API, δεν κάνει automation, δεν εγείρει νομικά ζητήματα. Υλοποιήσιμο. Προτείνεται ως Phase 2 enhancement.

### 3. Alternative Path — Partnership με ΟλοΜέλεια (Highest Long-term Value)

**Ranking: B+ (Strategic priority, 6-12 months horizon)**

**Γιατί:**
- ΟλοΜέλεια λειτουργεί portal.olomeleia.gr — είναι η οντότητα που χρειάζεσαι
- Εάν υπάρξει formal partnership: legitimate API access ή authorized integration
- Precedent: η ΟλοΜέλεια έχει ήδη interoperability με solon.gov.gr (official collaboration)
- DSA Αθηνών έχει ήδη παραπονεθεί δημοσίως για system failures → window ευκαιρίας για ΘΕΜΙΣ να αναδειχθεί ως λύση

**Action:** Επίσημη επαφή με Ολομέλεια Δικηγορικών Συλλόγων για "authorized integration partner" program. Pitch: ΘΕΜΙΣ μειώνει load στο portal (pre-validated submissions = λιγότερα errors).

### 4. Partnership με ΥπΔικ — Χαμηλή προτεραιότητα

**Ranking: C+ (Opportunistic only)**

- Δεν βρέθηκε καμία δημόσια consultation ή roadmap για third-party API
- Government procurement cycles = 18-36 months
- Αξίζει μόνο αν υπάρχει ήδη επαφή

---

## Surprises

1. **DUAL PORTAL ARCHITECTURE (ΚΡΙΣΙΜΟ):** solon.gov.gr != filing portal. Το actual e-filing γίνεται μέσω portal.olomeleia.gr (ΟλοΜέλεια). Αυτό αλλάζει τελείως τον τεχνικό στόχο — και η ΟλοΜέλεια είναι παράδοξα πιο προσβάσιμη ως potential partner από το κρατικό σύστημα.

2. **ASP.NET portal vs Oracle Java:** portal.olomeleia.gr τρέχει ASP.NET (`.aspx`), ενώ solon.gov.gr τρέχει Oracle ADF/Java. Δύο εντελώς διαφορετικές tech stacks για integration.

3. **DSA Αθηνών vs ΥπΔικ:** Ο Δικηγορικός Σύλλογος Αθηνών έχει δημοσίως εκφράσει "τεράστιες ευθύνες της πολιτείας για δυσλειτουργία" — υπάρχει ανοιχτή διαμάχη μεταξύ bar associations και κρατικών συστημάτων. ΘΕΜΙΣ μπορεί να αξιοποιήσει αυτό το friction.

4. **Κανένα GitHub repo** για solon.gov.gr automation — μηδενική community activity. Αυτό είναι είτε "δύσκολο δεν το προσπάθησε κανένας" είτε "δεν αξίζει" — πιθανότερο το δεύτερο.

5. **File size limit 4MB** στο portal.olomeleia.gr — ένα ΘΕΜΙΣ feature για "intelligent PDF compression/splitting" θα λύνει πραγματικό pain point.

6. **Ν.5221/2025 βγήκε ΦΕΚ Α' 133/28-7-2025** — σχετικά πρόσφατος νόμος, η αγορά είναι ακόμα σε προσαρμογή. Timing για ΘΕΜΙΣ είναι ιδανικό.

---

## Open Questions για Follow-up

1. **portal.olomeleia.gr ToS:** Υπάρχει published ToS; Επιτρέπει browser extension pre-fill; Πρέπει να ελεγχθεί η πηγή κώδικα του portal.

2. **ΑΠΕΔ remote signing:** Υπάρχει cloud-based ΑΠΕΔ signing service (π.χ. DocuSign-equivalent για GR) που θα επέτρεπε server-side signing χωρίς hardware token; Αξίζει dedicated research.

3. **Orbit.gr actual features:** Χρειάζεται direct product demo ή φόρμα επικοινωνίας για να επιβεβαιωθεί εάν υπάρχει SOLON integration που δεν εμφανίζεται στο marketing υλικό.

4. **ΟλοΜέλεια contact:** Ποιος είναι ο αρμόδιος για technical partnerships; Υπάρχει developers portal ή API documentation που δεν είναι δημόσιο;

5. **Captcha presence:** portal.olomeleia.gr ή solon.gov.gr έχουν CAPTCHA; Αν ναι, ποιο (reCAPTCHA, hCaptcha);

6. **e-Paravolo API:** Το e-Paravolo (gsis.gr) έχει REST API για generation/validation; Αν ναι, αυτό είναι το ευκολότερο automation win για ΘΕΜΙΣ.

7. **Nomos Legal Practice (nomoslegalpractice.com):** Αδύνατη επαλήθευση — ίσως ο πιο relevant Greek competitor που χρειάζεται deeper dive.

---

## Sources

### SOLON / ΥπΔικ Official
- [solon.gov.gr — Επίσημο portal ΟΣΔΔΥ-ΠΠ](https://www.solon.gov.gr/)
- [solon.gov.gr WebCenter portal URL](https://www.solon.gov.gr/webcenter/portal/osddy/home)
- [Ολοκληρωμένο Σύστημα — ΥπΔικ](https://ministryofjustice.gr/?page_id=2445)
- [Κοινό δελτίο τύπου ΥπΔικ + ΥπΨΔ για ψηφιακά πιστοποιητικά](https://ministryofjustice.gr/?p=4846)
- [ΟΣΔΔΥ-ΠΠ οδηγίες — Πρωτοδικείο Πειραιώς](https://www.protodikeio-peir.gr/?news=Διαδικτυακή-πύλη-portal-του-ΟΣΔΔΥ-ΠΠ)
- [MITOS.gov.gr — Ηλεκτρονική κατάθεση δικογράφων](https://mitos.gov.gr/index.php/ΔΔ:Ηλεκτρονική_κατάθεση_δικογράφων_(Πολιτικά_/_Ποινικά_Δικαστήρια))

### Ν.5221/2025
- [Lekkakou.gr — Τα τρία ψηφιακά θεμέλια Ν.5221/2025](https://lekkakou.gr/b/ta-tria-pshfiaka-themelia-ths-neas-politikhs-dikhs-oi-dyo-megales-tomes-kai-h-sygkroush)
- [siamakis-lawyers.gr — Κυριότερες αλλαγές ΚΠολΔ Ν.5221/2025](https://siamakis-lawyers.gr/οι-κυριότερες-αλλαγές-στο-κπολδ-με-τον/)
- [dschal.gr — ΟΡΘΗ ΕΠΑΝΑΛΗΨΗ Ν.5221/2025 ανακοίνωση](https://dschal.gr/orthi-epanalipsi-simantiki-anakoinosi-n-5221-2025-fek-a-133-28-7-2025-paremvaseis-ston-kodika-politikis-dikonomias-tropopoiiseis-schetika-me-ti-dimosieysi-diathikon-tropopoiiseis-sto-rythmistiko-plais/)

### ΟλοΜέλεια
- [olomeleia.gr — Επίσημο portal ΟλοΜέλειας](https://olomeleia.gr/)
- [bar.olomeleia.gr/BackOffice/login.aspx — Filing BackOffice](https://bar.olomeleia.gr/BackOffice/login.aspx)
- [Οδηγός χρήσης ηλεκτρονικής κατάθεσης — DSA (PDF)](https://www.dsa.gr/sites/default/files/news/attached/odigos_hrisis_ilektroniki_katathesi_dikografoy_osddy_pp_ver_02.pdf)

### Ανταγωνιστές
- [ORBIT Law Plus](https://www.orbit.gr/law.html)
- [MySolon — GitHub Pages](https://mysolon.github.io/)
- [MySolon.gr](https://www.mysolon.gr/)
- [Lawgic.gr — Solon troubleshooting guide](https://lawgic.gr/solon-gov-gr-provlimata-odigos-epiviosis/)
- [Nomos Legal Practice](https://nomoslegalpractice.com/index.html)
- [Alma / Νομική Βιβλιοθήκη](https://www.nb.org/greek/alma/)

### Technical
- [Oracle ADF documentation (επιβεβαίωση tech stack)](https://www.oracle.com/database/technologies/developer-tools/adf/)
- [Oracle ADF Wikipedia](https://en.wikipedia.org/wiki/Oracle_Application_Development_Framework)
- [TaxisNet Authentication — howto.gov.gr](https://howto.gov.gr/mod/book/tool/print/index.php?id=1601)
- [GSIS Web Services](https://www.gsis.gr/en/public-administration/ked/web-services)
- [e-Paravolo](https://www1.gsis.gr/sgsisapps/eparavolo/public/welcome.htm)

### Regulatory / GDPR
- [HDPA — Hellenic Data Protection Authority](https://www.dpa.gr/en)
- [opengov.gr — διαβούλευση ΥπΔικ Ιανουάριος 2026](https://www.opengov.gr/home/2026/01/23/10055)

---

## Next Steps για Δαίδαλο (Implementation)

1. **IMMEDIATE:** Επιβεβαίωσε portal.olomeleia.gr form fields (manual inspection) — τι fields χρειάζονται για κατάθεση δικογράφου.

2. **IMMEDIATE:** Ελέγξε e-Paravolo (gsis.gr) για REST API documentation — ευκολότερο automation win.

3. **SHORT-TERM (1-2 sprints):** Build Option D prep pipeline: PDF formatter → ΑΠΕΔ signing workflow → Γραμμάτιο calculator → e-Paravolo reference → validation checklist → "ready to upload" package.

4. **MEDIUM-TERM (1-2 months):** Browser extension proof-of-concept — pre-fill portal.olomeleia.gr fields από ΘΕΜΙΣ data. Low legal risk, high UX value.

5. **STRATEGIC (Q3 2026):** Επαφή με ΟλοΜέλεια Δικηγορικών Συλλόγων για authorized integration partnership.

6. **RESEARCH (follow-up Ηρόδοτος task):** Cloud-based ΑΠΕΔ remote signing services στην Ελλάδα — υπάρχουν; Τιμολόγηση; Compliance;
