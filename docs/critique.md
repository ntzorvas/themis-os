# ΘΕΜΙΣ OS — Αριστοτελική Κριτική Αρχιτεκτονικής
**Reviewed by:** Αριστοτέλης (QA Critic)
**Date:** 2026-04-28
**Submitted by:** Νικόλαος (Niko)
**Inputs:** 8 spec files στο `/root/projects/themis-os/docs/` (~190KB)
**Στόχος:** Internal logical critique (όχι external benchmark — αυτό έκανε ο Άργος)

---

## 0. EXECUTIVE VERDICT

**Verdict: REVISE — Has significant logical flaws but is fixable.**

Το spec έχει στιβαρή σύλληψη και είναι προφανώς γραμμένο από κάποιον που ξέρει το ελληνικό νομικό περιβάλλον. Έχει όμως **17 logical inconsistencies, 14 unstated assumptions, 18 unhandled edge cases, 9 semantic ambiguities, 7 hidden complexity bombs, και 11 missing failure modes** που αν δεν αντιμετωπιστούν πριν Sprint 3 θα παράγουν refactor cost 4-8 εβδομάδων το αργότερο μέχρι Sprint 13.

**Η κορυφαία διαπίστωση:** Το ίδιο το `data-model.md` διακηρύσσει "FOUNDATIONAL INVARIANTS που δεν αλλάζουν ποτέ", και ταυτόχρονα **μέσα στο ίδιο αρχείο τα παραβιάζει** (π.χ. `aml_check.party_id` αναφέρεται ορθά σε party — αλλά υπάρχουν residual references σε `client_id` εκτός data-model.md, όπως αναφέρει ο Άργος, και στο `api-architecture.md` το ολόκληρο "Clients" namespace της REST API παραβιάζει σιωπηρά το Invariant #1). Η αντίφαση μεταξύ διακήρυξης και πράξης είναι το πιο επικίνδυνο σημείο, γιατί κάθε downstream agent (Δαίδαλος, kostas, app-specialist) θα το ερμηνεύσει διαφορετικά.

**Δεύτερη πιο σημαντική:** Ο Aegis ορίζεται ως "AI nervous system" αλλά ταυτόχρονα `aegis-spec.md:567` λέει «AI failure must NEVER block core operations». Αυτό είναι λογικά συνεπές αλλά σημασιολογικά ασυνεπές με το premium pricing — αν το AI είναι optional, τότε δεν είναι "nervous system", είναι "enhancement". Το pricing και marketing υπόσχονται κάτι που το failure-mode contract δεν υπόσχεται. Πρέπει να επιλεχθεί μία από τις δύο θέσεις.

**Τρίτη:** Πολλαπλά specs υποθέτουν «έχουμε internet» / «έχουμε σήμα» / «τα PDF είναι searchable» / «το ΑΠΕΔ key δεν λήγει». Σε ένα σύστημα που σχεδιάζεται για δικαστήρια με patchy 4G και σκαναρισμένα φαξ από το 1998, αυτές οι παραδοχές δεν είναι ουδέτερες.

---

## 1. LOGICAL INCONSISTENCIES (ranked by severity)

### [L1] CRITICAL — REST API Namespace παραβιάζει το Invariant #1
- **Severity:** Critical
- **Location:** `api-architecture.md:170-191` (`/api/v1/clients`, `/api/v1/client-groups`) vs. `data-model.md:20-50` (Invariant #1: "no separate `client` table")
- **Observation:** Το Invariant #1 ορίζει ότι **δεν υπάρχει** `client` ως top-level entity. Παρ' όλα αυτά, το REST API εκθέτει ολόκληρο `/api/v1/clients` namespace με 13 endpoints (`/clients/:id/contacts`, `/clients/:id/matters`, `/client-groups`, etc.). Επιπλέον το RBAC permissions list (`api-architecture.md:114`) ορίζει `client` ως resource: «Resources: client, matter, document, ...».
- **Problem:** Αν ο πελάτης είναι απλώς ένα `party_role`, τότε το `/clients` URL είναι απατηλό. Δύο ερμηνείες:
  1. Το `/clients` είναι syntactic sugar για `parties WHERE active role='client'`. Αν ναι, πρέπει να καθοριστεί ρητά τι συμβαίνει όταν ένα party χάνει το client role (HTTP 404; soft-redirect; access denied;).
  2. Το `/clients` είναι ξεχωριστό από το `/parties` και διατηρεί legacy schema. Αν ναι, το Invariant #1 είναι ψευδές.
- **Question:** Τι θα συμβεί όταν το party_role(client, party_X) λήγει σε `active_until`; Το `GET /api/v1/clients/:id` του party_X θα επιστρέφει 200 ή 404; Αν 200, τότε ο "client" είναι αρχείο, όχι κατάσταση. Αν 404, τότε υπάρχουν historical client records που εξαφανίζονται.
- **Required fix:** Η REST API πρέπει να αναδιοργανωθεί σε `/api/v1/parties` με filter `?role=client` ή να καθοριστεί ρητά ότι `/clients` είναι view (όχι resource) και ότι GET επιστρέφει με βάση **τη χρονικά ενεργή** role state.

### [L2] CRITICAL — Single-tenant DB vs. tenant_id σε κάθε πίνακα
- **Severity:** Critical
- **Location:** `tech-stack.md:99-110` ("Per-tenant database: Complete isolation (separate DB per firm)") vs. `data-model.md:passim` (`tenant_id UUID FK -> tenant` σε **όλους** τους πίνακες)
- **Observation:** Αν κάθε firm έχει δική του database, το `tenant_id` είναι περιττό σε κάθε πίνακα — υπάρχει εξ ορισμού μόνο ένα tenant ανά DB. Αν υπάρχει `tenant_id` σε κάθε πίνακα, τότε είναι row-level isolation (multi-tenant pattern), όχι DB-per-tenant.
- **Problem:** Αυτή η σύγχυση δεν είναι κοσμητική. Επηρεάζει:
  - Migration strategy (ποιες migrations τρέχουν per-firm vs central)
  - Backup/restore granularity
  - Query optimizer (composite indexes με `tenant_id` πρώτο vs χωρίς)
  - GDPR data export (ένα DB dump αρκεί ή πρέπει να φιλτράρω;)
  - Security model (αν είναι DB-per-tenant, η RBAC αρκεί· αν είναι row-level, χρειάζεσαι RLS policies στην Postgres)
- **Required fix:** Επιλογή ΜΙΑΣ από τις δύο και απομάκρυνση των residuals. Πρόταση: DB-per-tenant + drop `tenant_id` από όλους τους per-tenant πίνακες (κρατά μόνο στους shared courts/legal_corpus).

### [L3] HIGH — Aegis είναι "nervous system" αλλά optional
- **Severity:** Significant
- **Location:** `aegis-spec.md:5` ("AI nervous system") vs. `aegis-spec.md:567` ("AI failure must NEVER block core operations") vs. tech-stack pricing premium (€89-149/user)
- **Observation:** Αν το core function δεν εξαρτάται από το AI, τότε το AI δεν είναι "nervous system" — είναι peripheral. Όμως το premium pricing υπόσχεται AI-native experience.
- **Problem:** Η αντίφαση γίνεται προφανής σε scenarios όπως: «τι συμβαίνει σε ένα γραφείο που για 2 ώρες ο Aegis είναι down κατά τη διάρκεια Drafting Studio σύσκεψης;». Αν η απάντηση είναι "δεν μπορώ να γράψω αγωγή χωρίς AI", τότε ψέμα το failure-mode contract. Αν είναι "ναι μπορείς, χωρίς το AI κουμπί", τότε ψέμα το nervous-system marketing.
- **Required fix:** Αναδιατύπωση. Πρόταση: «Aegis is the AI **enhancement layer**. Core operations (matters, billing, calendar, documents) function fully without it. AI features (drafting, summarization, research) degrade to manual workflows when Aegis is unavailable.» — και alignment του pricing rationale.

### [L4] HIGH — Build-plan Sprint 17 packs > capacity
- **Severity:** Significant
- **Location:** `build-plan.md:223-258` (Sprint 17-18: 19 deliverables σε 4 εβδομάδες με 2 devs)
- **Observation:** Sprint 17-18 περιέχει: Lead intake pipeline, Lead capture forms, Source tracking, Consultation scheduling, Conversion flow, Conflict checking (full-text + phonetic + tax + graph + audit + waiver), Contract management, Template library, e-sig, Protocol management, Communication log, Settings page, Notification system, System-wide search, Performance optimization, Security audit, GDPR review, Load testing, Documentation. Sprint 17-18 = 4 εβδομάδες × 2 devs = 80 person-days.
- **Problem:** Conflict checking μόνο του (phonetic Greek + graph traversal + waiver workflow + audit) θέλει 10-15 person-days. Αν προστεθούν τα P1 fixes του Άργου (SOLON wrapper, email sync, ΑΠΕΔ), η χωρητικότητα ξεπερνιέται κατά ~2x.
- **Required fix:** Re-plan. Είτε split σε 3 sprints, είτε descope το "system-wide search" + "performance pass" σε post-launch, είτε προσθήκη τρίτου dev. Άλλως ο Sprint 17 θα γίνει "polish theater" και τα κρίσιμα features θα μπουν με bugs.

### [L5] HIGH — `matter_party.is_primary_contact` χωρίς unique constraint
- **Severity:** Significant
- **Location:** `data-model.md:281-285` ("At most one TRUE per (matter_id, side). ... application-enforced")
- **Observation:** Application-enforced uniqueness σε concurrent system είναι race condition by design. Δύο partners ταυτόχρονα κάνουν "set as primary" → και οι δύο εγγραφές γράφονται.
- **Problem:** Δεν υπάρχει partial unique index (`UNIQUE(matter_id, side) WHERE is_primary_contact = TRUE`). Σε production με concurrent users, το invariant θα παραβιαστεί χωρίς exception.
- **Required fix:** Postgres partial unique index στο schema ορισμό. Δεν είναι application concern — είναι DB integrity concern.

### [L6] HIGH — `billing_split_percentage = 100` constraint χωρίς trigger
- **Severity:** Significant
- **Location:** `data-model.md:286-289`
- **Observation:** "billing_split_percentage summed across side='ours' clients must equal 100 when set". Δεν λέει πώς. Trigger; Application logic; CHECK constraint (αδύνατο σε Postgres χωρίς aggregate);
- **Problem:** Αυτό είναι aggregate constraint που η Postgres δεν υποστηρίζει direct. Χωρίς trigger ή application-layer transaction enforcement, μπορούμε να έχουμε 3 co-clients με 50/50/50 = 150%. Στην τιμολόγηση προκύπτει double-billing.
- **Required fix:** Spec it explicitly: trigger AFTER INSERT/UPDATE/DELETE on `matter_party` που να validates SUM = 100 OR all NULL. Με σαφές error code.

### [L7] HIGH — `referral_source_party_id` σε party + lead, αλλά referral_source table επίσης
- **Severity:** Significant
- **Location:** `data-model.md:142` (`party.referral_source_party_id`), `data-model.md:917` (`lead.referral_source_party_id`), και `data-model.md:1117-1126` (`referral_source` table για non-party referrers)
- **Observation:** Δύο διαφορετικοί μηχανισμοί για να εκφράσεις "αυτός ο πελάτης ήρθε από ___". Το `lead` table έχει και `source` ENUM και `referral_source_party_id` ταυτόχρονα.
- **Problem:** Τι συμβαίνει όταν `lead.source='referral'` αλλά `referral_source_party_id IS NULL`; Είναι αυτό valid; Τι συμβαίνει όταν `source='website'` αλλά `referral_source_party_id` δείχνει σε party; Δεν υπάρχουν consistency checks.
- **Required fix:** Να καθοριστεί exact relationship: είτε το `source` derives από `referral_source_party_id` (drop the ENUM), είτε ορίζεται `CHECK ((source='referral' AND referral_source_party_id IS NOT NULL) OR (source<>'referral'))`.

### [L8] MEDIUM — Sprint 9-10 AI Drafting πριν document templates
- **Severity:** Significant
- **Location:** `build-plan.md:107-130` (Sprint 9-10) vs. `build-plan.md:81-104` (Sprint 7-8)
- **Observation:** Sprint 9 deliverable: «Aegis document drafting agent (agogi, exodiko, aitisi templates)». Sprint 7 deliverable: «Document template system (create templates, variables)». Σωστή σειρά. Αλλά Sprint 9 επίσης λέει «Document embedding pipeline (upload → OCR → embed → Qdrant)» — και Sprint 7 λέει «BullMQ worker: OCR processing». Διπλή ανάθεση.
- **Problem:** Είτε ο OCR worker χτίζεται 2 φορές, είτε το Sprint 9 κληρονομεί από Sprint 7 χωρίς ρητή dependency. Module-dependencies graph δεν δείχνει αυτή τη dependency.
- **Required fix:** Merge τα OCR + embedding deliverables σε ένα sprint (πιθανότατα Sprint 9, με Sprint 7 να φτιάχνει μόνο upload + storage), ή μετονομάστε το Sprint 7 OCR ως "OCR worker scaffold (text extraction only)" και Sprint 9 ως "Embedding pipeline + Qdrant indexing".

### [L9] MEDIUM — Aegis `tenant_{id}_documents` collection vs DB-per-tenant
- **Severity:** Significant
- **Location:** `aegis-spec.md:465` (Qdrant collection per tenant) vs. `tech-stack.md:99` (DB per tenant)
- **Observation:** Qdrant είναι **shared infrastructure** (one Qdrant cluster) με per-tenant collections. PostgreSQL είναι **per-tenant infrastructure** (one DB instance per firm).
- **Problem:** Διαφορετικά isolation levels ανά layer. Αν παραβιαστεί η Qdrant access control (bug, misconfiguration), tenant A μπορεί να αναζητήσει tenant B documents. Σε DB-per-tenant αυτό είναι αδύνατο. Άρα το Qdrant είναι **πιο αδύναμο link** του security chain.
- **Required fix:** Είτε Qdrant per-tenant cluster (κόστος), είτε ρητή spec για row-level access control στο Qdrant (filter by tenant_id σε κάθε query, εφαρμοζόμενο σε middleware όχι σε client side).

### [L10] MEDIUM — `auto_tasks` σε `matter_stage` αλλά Workflow engine = Phase 2
- **Severity:** Significant
- **Location:** `data-model.md:300` (`matter_stage.auto_tasks JSONB`) vs. `module-dependencies.md:150` (Workflow engine = Layer 6)
- **Observation:** Schema έχει `auto_tasks` στο stage, αλλά ο workflow engine (που τα εκτελεί) είναι Phase 2.
- **Problem:** Phase 1 schema έχει το πεδίο. Τι συμβαίνει στο Phase 1; Είναι dormant (τότε γιατί στο schema;) ή υλοποιείται μερικά;
- **Required fix:** Είτε remove `auto_tasks` από Phase 1 schema (add σε Phase 2 migration), είτε ρητός Phase 1 deliverable: «hardcoded JSON-driven task creation on stage transition» (όπως πρότεινε ο Άργος P2.1).

### [L11] MEDIUM — `audit_log` immutable vs GDPR Article 17
- **Severity:** Significant
- **Location:** `data-model.md:1071-1088` ("append-only, immutable. Write-only table") vs. `greek-compliance.md:512` ("Right to erasure: Soft delete with anonymization")
- **Observation:** Audit log καταγράφει changes, που περιλαμβάνουν PII (`changes JSONB` με old/new values). Αν μέσα στο audit_log γράφτηκε «old: Νικόλαος Τζόρβας → new: ___», το PII είναι μέσα immutably.
- **Problem:** Το soft-delete + anonymization στο live πίνακα δεν αρκεί — το audit_log κρατά το ιστορικό PII. GDPR derogation για legal records είναι valid, αλλά πρέπει να documented ρητά. Επίσης ο audit_log θα μεγαλώνει χωρίς όρια — δεν υπάρχει retention policy.
- **Required fix:** Spec ρητή retention policy (π.χ. 20 χρόνια για legal records, μετά pseudonymization). Spec PII handling στο `changes` JSONB (encrypt at rest με tenant key, ώστε να αχρηστευτεί όταν χαθεί το key). Ο Άργος το επεσήμανε στο P1.10.

### [L12] MEDIUM — `matter.status` enum + `closed_at` redundancy
- **Severity:** Minor
- **Location:** `data-model.md:241, 257`
- **Observation:** `status ENUM(intake, active, on_hold, closed, archived)` και `closed_at TIMESTAMPTZ nullable`. Δύο sources of truth.
- **Problem:** Τι συμβαίνει όταν `status='closed'` αλλά `closed_at IS NULL`; Ή αντίστροφα; Bug magnet.
- **Required fix:** Trigger ή application logic να συγχρονίζει. Προτιμότερα: drop `closed_at`, derive από audit_log τo τελευταίο status change. Ή αντίστροφα: derive status από timestamps (open_at/closed_at/archived_at).

### [L13] MEDIUM — `representing_counsel_party_id` self-referential validation
- **Severity:** Significant
- **Location:** `data-model.md:277, 287-289`
- **Observation:** «`representing_counsel_party_id` must reference a party with role `client`'s counsel (an attorney party); validated at write».
- **Problem:** Αυτό είναι σχεδόν αδιανόητο σε καθαρό SQL. Πώς ξέρει το DB ποιοι είναι "attorneys"; Με `party_role.role IN ('opposing_counsel', 'co_counsel', ...)` ; Αλλά αυτές οι roles περιγράφουν ρόλους **σε υποθέσεις**, όχι attorney status. Ένα party μπορεί να είναι attorney (επάγγελμα) αλλά να μην έχει αυτό το role σε κάποιο matter.
- **Required fix:** Πρέπει να υπάρχει `party_role(role='attorney')` ή ξεχωριστό πεδίο στο party (π.χ. `is_attorney`, `bar_number`). Επίσης validation σε application layer (όχι trigger), γιατί το rule είναι complex.

### [L14] MEDIUM — `legal_form` enum κενό για government/nonprofit
- **Severity:** Minor
- **Location:** `data-model.md:165, 171`
- **Observation:** Constraint: "type='person' AND first_name NOT NULL OR type IN ('company','government','nonprofit') AND legal_form NOT NULL". Αλλά `legal_form` enum = `AE, EPE, IKE, OE, EE, atomiki, other`. Καμία από αυτές δεν ταιριάζει σε government ή nonprofit.
- **Problem:** Government entity (π.χ. Δήμος Αθηνών) θα έχει `type='government'` αλλά τι `legal_form`; "Other" είναι hack.
- **Required fix:** Ή ξεχωριστό πεδίο `government_type / nonprofit_type`, ή relax το constraint για non-company types.

### [L15] LOW — `bill_to_party_id` πρέπει να έχει `client` role αλλά δεν validated
- **Severity:** Minor
- **Location:** `data-model.md:540` ("must hold active `client` role")
- **Observation:** Comment-level constraint, no enforcement spec.
- **Problem:** Αν ένα party λήξει το client role mid-billing-cycle, μπορούμε να εκδώσουμε invoice σε non-client; Πιθανότατα όχι, αλλά το spec δεν καλύπτει το edge case.
- **Required fix:** Application validation με σαφές error code. Ή trigger.

### [L16] LOW — `protocol_entry` numbering uniqueness
- **Severity:** Minor
- **Location:** `data-model.md:781-794`
- **Observation:** `protocol_number VARCHAR(30)` (e.g. P.EIS.001/2026). Δεν λέει αν είναι unique, ούτε ποιος εκδίδει το επόμενο νούμερο.
- **Problem:** Σε γραφείο με concurrent secretaries, race condition στο "next number".
- **Required fix:** UNIQUE constraint σε `(tenant_id, protocol_number, direction, year)`. Sequence generator atomic.

### [L17] LOW — `time_entry.total_amount = (duration/60) * rate` αλλά rate μπορεί να αλλάξει
- **Severity:** Minor
- **Location:** `data-model.md:489`
- **Observation:** "Computed: (duration/60) * rate". Αλλά rate cards αλλάζουν. Αν αλλάξει το rate μετά την καταχώρηση αλλά πριν το invoice, ποιο rate ισχύει;
- **Problem:** Ο `rate_amount` είναι snapshot ή live lookup; Το spec δεν είναι σαφές. Παρ' όλα αυτά υπάρχει `rate_amount` column που υποδηλώνει snapshot.
- **Required fix:** Σαφής δήλωση ότι το `rate_amount` snapshot τη στιγμή του time_entry creation. Audit trail αν αλλάξει.

---

## 2. UNSTATED ASSUMPTIONS (πρέπει να γίνουν ρητές)

### [A1] «Ο δικηγόρος έχει internet σε δικαστήριο»
- Όλο το hearing workflow (record outcome, log time, check checklist) προϋποθέτει connectivity. Στα ελληνικά δικαστήρια το 4G είναι patchy (basements, παλιά κτίρια). Ο qa-sentinel θα το πιάσει αργά. **Action:** Spec offline-capable hearing form (PWA cache, queue-and-sync). Άργος P1.8 κάλυψε partial.

### [A2] «Τα έγγραφα είναι searchable post-OCR»
- `aegis-spec.md` υποθέτει pytesseract. Greek legal docs σαρωμένα από fax 1990s έχουν OCR accuracy 50-70%. Spec **δεν θέτει minimum quality threshold** ούτε fallback strategy. **Action:** Άργος P1.5 το κάλυψε. Επιπλέον: spec τι συμβαίνει όταν OCR αποτυγχάνει — δεν indexable; Manual transcription queue;

### [A3] «Το AI θα γράψει σωστά νομικά ελληνικά»
- `aegis-spec.md` υποθέτει Claude Opus για drafting. **Δεν υπάρχει verification corpus** για το αν το output είναι forensically sound (όχι μόνο γραμματικά σωστό). Hallucinations σε νομικό κείμενο = malpractice risk. **Action:** Spec evaluation suite — 50 πραγματικές αγωγές/εξώδικα σαν ground truth, accuracy threshold ≥85% σε structure (όχι content), και mandatory human review banner που δεν dismissable.

### [A4] «Όλοι οι πελάτες έχουν email»
- Lead capture, invoice delivery, client portal — όλα προϋποθέτουν email. Πελάτες >70 ετών συχνά δεν έχουν. **Action:** Add SMS/postal mail fallback paths. `party.preferred_communication_channel`.

### [A5] «Ο πελάτης έχει ταυτότητα σε electronic format»
- AML/KYC workflow υποθέτει υποβολή ID. Αν φωτοτυπία; Αν ξένος πελάτης χωρίς ΑΦΜ; **Action:** Spec ID alternatives, foreign ID handling, και workflow όταν AFM δεν υπάρχει (συμπληρώνεται post-issuance).

### [A6] «ΑΠΕΔ key δεν λήγει mid-process»
- ΑΠΕΔ qualified signatures έχουν χρόνο ζωής. Αν ξεκινήσεις signing flow και η υπογραφή λήξει ενώ ο πελάτης διαβάζει; **Action:** Pre-flight check ΑΠΕΔ validity + grace period + reminder system 30/15/7 days πριν λήξη.

### [A7] «myDATA θα δεχτεί την υποβολή πρώτη φορά»
- AADE myDATA έχει sandbox που δεν αντιπροσωπεύει production. Validation differences. **Action:** Spec pre-production smoke tests, και error catalog για κάθε γνωστό AADE rejection code.

### [A8] «Ο firm admin θα ενημερώνει EFKA/EADD rates ετησίως»
- `greek-compliance.md:34` λέει "Configurable. Yes (annual update)". Αλλά **κανείς δεν θα θυμάται** να το κάνει. **Action:** Spec auto-reminder system στο admin panel (Jan 1, μήνα πριν, day-of) + "stale rates" warning αν δεν έχει επικαιροποιηθεί > 13 μήνες.

### [A9] «Greek phonetic matching είναι λυμένο πρόβλημα»
- `aegis-spec.md:309-313` δίνει παραδείγματα (Ιωάννης/Γιάννης) αλλά **δεν δίνει αλγόριθμο**. Open research problem. **Action:** Spec algorithm: Beider-Morse port + Greek transliteration table + manual override list.

### [A10] «Το backup θα γίνει επαναφορά επιτυχώς»
- `tech-stack.md:107` λέει pg_dump + WAL. Αλλά **δεν υπάρχει disaster recovery test schedule**. Backups που δεν δοκιμάζονται είναι θεωρητικά. **Action:** Άργος P1.4. Quarterly DR drill, document RTO/RPO.

### [A11] «Ο court_case_number είναι unique»
- Αν δύο matters του ίδιου firm έχουν τον ίδιο αριθμό κατάθεσης (μερικές φορές γίνεται με split agogi);
- **Action:** No UNIQUE constraint, but soft-warn UI. Spec the policy.

### [A12] «Sxetiko numbering δεν επανεκδίδεται»
- Αν διαγράψεις ένα Σ.5, το Σ.5 ξαναβγαίνει στο επόμενο upload ή προχωράει σε Σ.6;
- **Action:** Spec numbering policy (gapless vs sparse). Δικαστήρια συνήθως απαιτούν gapless στο ίδιο submission.

### [A13] «Ο δικηγόρος δεν παραιτείται mid-matter»
- Δεν υπάρχει spec για lawyer departure. Τι συμβαίνει στα `matter_member` records; Στις `time_entries`; Στα ongoing deadlines; Στο ΑΠΕΔ key που ήταν associated μαζί του;
- **Action:** Spec lawyer-departure workflow (reassignment, time-entry attribution, key revocation).

### [A14] «GEMI API είναι διαθέσιμο»
- `aegis-spec.md:316` αναφέρει "Company officer matching (via GEMI data when available)". GEMI API παρουσιάζει downtime. Spec δεν λέει τι κάνουμε όταν είναι κάτω.
- **Action:** Cache last-known GEMI data per company party, fallback σε cache.

---

## 3. EDGE CASES NOT HANDLED

### [E1] Joint client όπου ένας θέλει να αποχωρήσει mid-matter
- **Scenario:** Δύο σύζυγοι ως co-clients σε διαζύγιο. Ξαφνικά ένας λέει «δεν θέλω να με εκπροσωπείς πλέον».
- **What breaks:** `matter_party.left_at` υπάρχει, αλλά τι γίνεται με τα joint privileged communications; Ο conflict-of-interest now δημιουργείται. Τα billing splits πρέπει να ανακατανεμηθούν.
- **Suggested fix:** Spec "matter_party.withdraw" workflow με: (a) automatic conflict re-check, (b) privilege review trigger, (c) billing split recalculation, (d) notification cascade.

### [E2] Νεκρός πελάτης / πτώχευση εταιρείας πελάτη
- **Scenario:** Πελάτης πεθαίνει. Estate (κληρονόμοι) θέλουν να συνεχίσουν.
- **What breaks:** `party.status='deceased'` υπάρχει αλλά τι σημαίνει για ongoing matters; Ποιος υπογράφει; Πώς εκδίδεται invoice; ΑΦΜ νεκρού δεν είναι valid.
- **Suggested fix:** Spec succession workflow: link deceased party → estate party (new party type? `type='estate'`), transfer matter_party records, invoice routing to estate.

### [E3] Conflict που ανακαλύπτεται ΜΕΤΑ την ανάληψη υπόθεσης
- **Scenario:** Έλεγχος conflict πέρασε καθαρά. 3 μήνες μετά, νέος πελάτης αποκαλύπτει σχέση με existing matter που δεν είχε δηλωθεί.
- **What breaks:** Spec conflict-check είναι "checked once at intake". Δεν υπάρχει continuous monitoring.
- **Suggested fix:** Spec automatic re-check σε κάθε νέο matter που εμπλέκει `party_id` που έχει το ίδιο firm σε άλλη υπόθεση. Add: `conflict_check.triggered_by` έχει ήδη `'role_change'` αλλά δεν υπάρχει "post-engagement discovery" mode.

### [E4] Δικηγόρος φεύγει και παίρνει υποθέσεις
- **Scenario:** Associate παίρνει 30 matters του και κάνει lateral move σε άλλο γραφείο. Ο πελάτης ακολουθεί.
- **What breaks:** Data export, time entries, billed hours, IP. Ποιος έχει access; Conflict check σε νέο γραφείο πώς γίνεται από τα δεδομένα του παλιού;
- **Suggested fix:** Spec "matter transfer" workflow με GDPR-compliant export, audit trail, και ethical wall για ex-employee.

### [E5] Refund mid-retainer
- **Scenario:** Retainer €5000. Έγιναν €1500 work. Ο πελάτης ζητά refund.
- **What breaks:** `retainer.balance` υπάρχει. Αλλά τι γίνεται με myDATA — έκδοση πιστωτικού; trust accounting movement;
- **Suggested fix:** Spec partial-refund workflow: credit_note + trust withdrawal + myDATA cancellation.

### [E6] Court filing απορρίπτεται και πρέπει refile σε άλλο court
- **Scenario:** Αγωγή κατατέθηκε σε λάθος δικαστήριο. Απορρίπτεται για αναρμοδιότητα. Πρέπει refile.
- **What breaks:** `matter.court_id` αλλάζει. `e_filing` records παλαιά παραμένουν. Bar stamp είχε εκδοθεί. Παράβολο εκδόθηκε.
- **Suggested fix:** Spec "court reassignment" workflow: keep history, mark old filings as 'rejected_jurisdiction', recompute deadlines from new filing date, decide bar stamp fate (refund? carry-over?).

### [E7] ΑΠΕΔ signature που λήγει μέσα στη διαδικασία
- **Scenario:** Multi-signer document. Πρώτος υπέγραψε. ΑΠΕΔ certificate του δευτέρου λήγει 2 μέρες πριν υπογράψει.
- **What breaks:** `signature_request.expires_at` αναφέρεται στο request, όχι στο certificate. Spec δεν λέει τι γίνεται όταν key λήγει mid-flow.
- **Suggested fix:** Pre-flight cert validity check + 30-day buffer + re-sign workflow.

### [E8] myDATA transmission failure και αποστολή 2 ημέρες αργότερα
- **Scenario:** AADE down 24+ ώρες. myDATA transmission delays.
- **What breaks:** Νομικά, AADE θέλει transmission εντός συγκεκριμένων ημερών. Αν retry queue κρατά κάτι 3 μέρες, υπάρχει νομική παράβαση;
- **Suggested fix:** Spec maximum retry window (24h based on AADE rules), beyond that escalate to admin alert. Document AADE grace policy.

### [E9] Document confidential μεταξύ co-clients (privilege conflict)
- **Scenario:** Co-clients A και B σε joint matter. Ο A αποκαλύπτει κάτι μόνο στο γραφείο, όχι στον B. Privileged μεταξύ A-firm αλλά not B.
- **What breaks:** `document.privilege_tag` έχει `joint_defense` αλλά όχι granular per-co-client. Συγκρούεται με Invariant #2 (matter_party multiplicity).
- **Suggested fix:** Spec `document.visible_to_party_ids UUID[]` ώστε να εξαιρούνται specific co-clients από access.

### [E10] AI hallucination σε νομικό κείμενο που δεν εντοπίζεται
- **Scenario:** AI Drafting Studio παράγει αγωγή με fictional case citation (AP 999/2099 που δεν υπάρχει). Ο junior associate copy-pastes χωρίς verify.
- **What breaks:** `aegis-spec.md:565` λέει "mitigated by human-in-the-loop". Αυτό είναι policy, όχι enforcement.
- **Suggested fix:** Spec **citation validator**: κάθε case-law reference που παράγει το AI, verified σε real-time κατά της `case_law` table. Αν δεν υπάρχει, mandatory red banner. Block submission χωρίς manual override.

### [E11] Μερική payment + credit note ταυτόχρονα
- **Scenario:** Invoice €1000. Πελάτης πληρώνει €600. Συμφωνείς για €200 discount, εκδίδεις credit note. Balance €200.
- **What breaks:** Order of operations σε `invoice.amount_paid`, `invoice.balance_due`. Race condition αν payment + credit_note εισάγονται ταυτόχρονα.
- **Suggested fix:** Spec atomic transaction. Lock invoice, apply credit, apply payment, recompute balance, release.

### [E12] Bar stamp εκδόθηκε αλλά hearing ακυρώθηκε εντελώς
- **Scenario:** Hearing scheduled, bar stamp issued (€250). Hearing ακυρώνεται (όχι αναβολή — ακύρωση).
- **What breaks:** `bar_stamp.status='issued'`. Δεν υπάρχει cancellation με refund. Το ΔΣΑ ίσως επιστρέφει το ποσό, ίσως όχι.
- **Suggested fix:** Spec cancel/refund workflow + ΔΣΑ-specific rules (κάθε ΔΣΑ έχει διαφορετικό policy).

### [E13] Αντίκλητος που εξαφανίζεται την ημέρα της δίκης
- **Scenario:** `hearing.anticletos_name` καταχωρημένος. Την ημέρα της δίκης ο αντίκλητος είναι ασθενής/εξαφανίστηκε.
- **What breaks:** Spec δεν προβλέπει last-minute substitution. Δεν υπάρχει `anticletos_substitute`.
- **Suggested fix:** Allow multiple anticletoi (primary + backup) σε `hearing_anticletos` join table.

### [E14] Tenant DB φτάνει 1TB
- **Scenario:** Megafirm με 100 lawyers + 10 χρόνια data. PostgreSQL DB ξεπερνά 1TB.
- **What breaks:** pg_dump backups γίνονται ώρες. WAL replication lag. Index bloat.
- **Suggested fix:** Spec partitioning strategy (`time_entry` partitioned by year ήδη — αλλά `audit_log` and `document` not). Spec archival to cold storage after 5 years.

### [E15] Partner approves invoice και αμέσως επιστρέφει για edit
- **Scenario:** Partner approves €5000 invoice. Realize λάθος rate. Απενεργοποιεί approval. Αλλά invoice ήδη πέρασε σε myDATA queue.
- **What breaks:** Race condition. myDATA transmission μπορεί να ξεκίνησε.
- **Suggested fix:** Spec lockout window — μετά approval, 5min cooldown πριν myDATA transmission. Allow last-second cancel.

### [E16] Two timers ταυτόχρονα running
- **Scenario:** Lawyer ξεκίνησε timer στο Matter A, ξέχασε, ξεκίνησε timer στο Matter B.
- **What breaks:** Spec δεν λέει αν επιτρέπεται multiple concurrent timers. UTBMS standard says no. Time double-counted.
- **Suggested fix:** Spec policy: max 1 active timer per user. Auto-pause others.

### [E17] Lateral hire φέρνει conflicts μαζί του
- **Scenario:** Νέος partner έρχεται με 50 πελάτες από προηγούμενο γραφείο. Όλοι πρέπει να conflict-checked κατά **όλων** των existing matters του γραφείου.
- **What breaks:** `conflict_check.triggered_by='lateral_hire'` υπάρχει αλλά spec workflow είναι vague (ποιος βλέπει τι; mass batch processing; UI;).
- **Suggested fix:** Spec dedicated lateral-hire onboarding workflow: bulk conflict check API + UI, mass-export rejected/conflicted, ethical wall auto-creation.

### [E18] Πελάτης ζητά «σβήστε όλα μου τα δεδομένα» (GDPR Article 17)
- **Scenario:** Closed matter 6 χρόνια πριν. Πελάτης ζητά erasure.
- **What breaks:** Statute of limitations για malpractice = 5 χρόνια. Records μπορούν να σβηστούν. Αλλά τι γίνεται με invoices που είναι σε mydata_record (immutable AADE submission)?
- **Suggested fix:** Spec retention matrix per data type. Pseudonymize όχι delete για financial records. Spec ποιες πληροφορίες είναι GDPR-erasable και ποιες όχι (ονόματα ΝΑΙ, ΑΦΜ ίσως, court records ΟΧΙ).

---

## 4. SEMANTIC AMBIGUITY (Glossary needed)

### [S1] "Matter" vs "Case" vs "Υπόθεση"
- Spec χρησιμοποιεί "matter" ως κύριο όρο. UI θα είναι "Υπόθεση" σε ελληνικά. Αλλά στα ελληνικά νομικά, "υπόθεση" είναι κάτι ευρύτερο από "matter" (mat = engagement, υπόθεση = legal dispute).
- **Action:** Δημιούργησε glossary table σε `docs/glossary.md`. Ορίσε exact mapping.

### [S2] "Client" vs "Party with role=client" vs "Πελάτης"
- Μετά το Invariant #1, ο "client" είναι derived view. Αλλά UI και API διατηρούν τη λέξη. Confusion για developers.
- **Action:** Glossary entry. UI labels keep "Πελάτης" αλλά documentation/code/API καθαροποίηση.

### [S3] "Document" vs "File" vs "Attachment"
- `document` table, `attachment_ids` σε communications. Είναι ίδια οντότητα ή διαφορετικά;
- **Action:** Spec ότι `attachment_ids` references σε `document.id` (ένα document μπορεί να είναι attachment σε communication). Drop συνώνυμο.

### [S4] "Deadline" vs "Appointment" vs "Task" vs "Reminder"
- Τέσσερα concepts μπερδεύονται:
  - `calendar_event` (event_type ENUM περιλαμβάνει `deadline`, `task_due`, `reminder`, `meeting`)
  - `deadline` table (separate)
  - `task` table (separate)
- Ένα deadline εμφανίζεται σε `deadline` AND `calendar_event`; Ή μόνο σε ένα;
- **Action:** Spec data flow: deadline created → optionally creates calendar_event για display. Do not duplicate canonical data.

### [S5] "Hearing" vs "Court Date" vs "Appearance" vs "Παράσταση"
- `hearing` is the event. "Παράσταση" είναι η εμφάνιση του δικηγόρου σε hearing. Δύο διαφορετικά things.
- **Action:** Spec ξεχωριστή οντότητα `appearance` (one per attorney per hearing) που γεννά bar_stamp. Ή ξεκαθάρισε ότι `hearing.attending_user_id` represents single appearance και multi-attorney appearances δεν υποστηρίζονται.

### [S6] "Bill" vs "Invoice" vs "Τιμολόγιο" vs "ΑΠΥ" vs "ΔΑ"
- myDATA διακρίνει ΔΑ (Δελτίο Αμοιβής, για lawyer fees) από ΑΠΥ (γενική). Αλλά `invoice.doc_type ENUM(da, apy)` αρκεί;
- **Action:** Glossary entry, και verify ότι το AADE income classification είναι σωστό για κάθε combo.

### [S7] "Soft delete" vs "Anonymize" vs "Erase"
- `deleted_at` column = soft delete. GDPR erasure = anonymize (όχι hard delete). Πότε είναι ποιο;
- **Action:** Spec policy: user delete UI = soft delete. GDPR erasure request = anonymize PII fields, keep row. Hard delete = admin only, audit logged.

### [S8] "Owner" vs "Responsible" vs "Lead"
- `matter.responsible_user_id` (lead attorney). `matter_member` με role 'lead'. `calendar_event.user_id` (owner). Πολλά "owner-like" concepts.
- **Action:** Spec exact semantics. Πιθανότατα: `responsible_user_id` (legal responsibility, βar association reporting) vs `matter_member.role='lead'` (operational lead) — μπορεί να είναι διαφορετικά.

### [S9] "Active" vs "Open" vs "Pending"
- `matter.status` έχει `active`. `deadline.status` έχει `pending`. `lead.status` έχει `new`. `consultation.status` έχει `scheduled`. Different language για "in-progress" state.
- **Action:** Standardize lifecycle states σε όλα τα entities όπου possible.

---

## 5. HIDDEN COMPLEXITY FLAGS

### [H1] Sprint 11-12 Calendar Sync — 2-way Google + Outlook + Greek holidays
- **Stated effort:** 4 εβδομάδες, 2 devs
- **Real complexity:** 2-way sync conflict resolution alone είναι 1-2 εβδομάδες. iCal RRULE με Greek holidays (ορθόδοξο Πάσχα variable date) είναι custom. Outlook 365 + Google Calendar = δύο API integrations. KPolD rules engine = 50+ rules με court recess + holidays.
- **Realistic estimate:** 6-8 εβδομάδες με 2 devs. Underscoped κατά 50%.

### [H2] Sprint 15-16 myDATA — XML schema permutations
- **Stated effort:** 4 εβδομάδες
- **Real complexity:** myDATA έχει 12+ doc types, κάθε ένα με specific XML schema. Income classification matrix με category × subcategory. AADE rejection codes (~50). Sandbox vs production differences. Resubmission rules. Cancellation rules.
- **Realistic estimate:** 6-8 εβδομάδες ή 4 εβδομάδες με dedicated specialist.

### [H3] PII Anonymization Pipeline (Sprint 9-10)
- **Stated effort:** Part of Sprint 9-10 deliverable
- **Real complexity:** Presidio Greek model δεν είναι production-ready. Custom Greek NER training = 2-4 εβδομάδες. Address detection (Οδός/Λεωφόρος + numbers + city) = custom regex+rules. Anonymization preserve relationships across long contexts = research problem.
- **Realistic estimate:** Sprint 7-8 για NER training prep, Sprint 9-10 για pipeline. Ξεχωριστή προεργασία.

### [H4] Greek phonetic matching (Sprint 17-18)
- **Stated effort:** Part of conflict check polish
- **Real complexity:** Greek transliteration variations (Ιωάννης/Ioannis/Yannis/John). No existing library. Custom Beider-Morse port = 1-2 εβδομάδες. Test corpus needed.
- **Realistic estimate:** Dedicated 2-week sprint.

### [H5] Aegis Context Window Management
- **Stated effort:** Part of Aegis scaffold
- **Real complexity:** Smart chunking για ελληνικά νομικά (long sentences, references). Token budget allocation across multi-source RAG. Document size variance (1-page vs 200-page). Cost spike risk.
- **Realistic estimate:** Ongoing optimization, not one-shot.

### [H6] Court Database Seeding (Sprint 5-6)
- **Stated effort:** Part of Sprint 5-6
- **Real complexity:** 400+ courts. Each with sections, schedules, addresses. No single canonical source. Sections change. Hearing days change.
- **Realistic estimate:** Manual data entry with verification = 2-3 εβδομάδες parallel work. Άργος P2.14 το επεσήμανε.

### [H7] Per-tenant deployment automation (Phase 4)
- **Stated effort:** "Click to deploy" στο Phase 4
- **Real complexity:** Each new tenant = new DB + new R2 bucket + new Qdrant collection + new encryption key + DNS subdomain + nginx config + monitoring + backups. Idempotent provisioning + rollback = significant infra work.
- **Realistic estimate:** Whole sprint dedicated to provisioning automation.

---

## 6. MISSING FAILURE MODES

### [F1] Qdrant cluster falls
- **Spec status:** `aegis-spec.md:563` λέει "degrade gracefully (return 'search unavailable')"
- **Missing:** What about embedding writes? Indexing pipeline blocks; Document upload UX shows what; Document Q&A πώς αποτυγχάνει σε production-quality way;
- **Suggested:** Spec WAL για embedding writes (queue locally, replay), και UI fallback σε PostgreSQL FTS.

### [F2] Anthropic API down (LLM unavailable)
- **Spec status:** `aegis-spec.md:561` "LLM timeout (>30s) Retry once, then return 'AI unavailable'"
- **Missing:** Multi-hour outage. Pending drafts pile up. Cost spike when service returns (queue backlog).
- **Suggested:** Spec circuit breaker — αν >5min consecutive errors, disable AI features at UI level. Status page integration. Manual "AI offline" mode.

### [F3] KMS key rotation/loss
- **Spec status:** `tech-stack.md:124` mentions HashiCorp Vault but no rotation policy
- **Missing:** Π.χ. partner phishing attack → tenant key needs rotation. Πώς re-encrypt 100K records χωρίς downtime; Πώς prove key custody chain για compliance;
- **Suggested:** Spec key rotation procedure, dual-key transition window, audit trail of all key operations.

### [F4] R2 bucket compromise / region outage
- **Spec status:** Implicit "R2 is reliable"
- **Missing:** Cloudflare R2 region outages happen. Documents temporarily inaccessible.
- **Suggested:** Spec multi-region replication (R2 has it as feature). Spec "document temporarily unavailable" UX state.

### [F5] PostgreSQL primary fails (per-tenant DB)
- **Spec status:** None
- **Missing:** Με DB-per-tenant, αν ένα DB πέσει, ένα γραφείο είναι offline. Ο qa-sentinel πιθανώς δεν θα το δει αμέσως.
- **Suggested:** Per-tenant health monitoring + automatic failover σε standby + RTO commitment (Άργος P1.4).

### [F6] BullMQ Redis down — myDATA queue lost
- **Spec status:** Implicit
- **Missing:** Redis crash με queued myDATA jobs in-memory only → AADE transmissions lost. Νομική υποχρέωση αδυνατεί.
- **Suggested:** Spec Redis persistence (AOF + RDB), dual-write critical jobs σε PostgreSQL fallback queue.

### [F7] Concurrent invoice approvals (race condition)
- **Spec status:** None — implicit "first wins"
- **Missing:** Δύο partners approve το ίδιο invoice ταυτόχρονα. Audit log records both. myDATA transmission triggered twice.
- **Suggested:** Spec optimistic lock με version column. Idempotency keys στο myDATA transmission.

### [F8] AADE myDATA transmission idempotency
- **Spec status:** `greek-compliance.md:200` "Idempotent check before transmission"
- **Missing:** **Πώς** ακριβώς; AADE επιστρέφει unique MARK. Πριν λάβουμε MARK αλλά μετά send, τι γίνεται; Retry → duplicate;
- **Suggested:** Spec exactly-once semantics: hash invoice content, check `mydata_record WHERE content_hash=X AND status<>'rejected'` πριν resend.

### [F9] Time zone disasters
- **Spec status:** `data-model.md:12` λέει "TIMESTAMPTZ (UTC stored, displayed in Europe/Athens)"
- **Missing:** Greek summer/winter time transitions. Court deadline σε 23:59 Athens μπορεί να είναι 22:59 ή 21:59 UTC. KPolD calculation πρέπει να τιμήσει local time για deadline.
- **Suggested:** Spec ότι deadline calculations ΠΑΝΤΑ σε Europe/Athens, conversion μόνο για display.

### [F10] DNS/Cloudflare misconfiguration
- **Spec status:** None
- **Missing:** Per-tenant subdomain `{firm}.themis-os.gr`. Αν Cloudflare cache stale, νέοι users παίρνουν λάθος tenant.
- **Suggested:** Spec strict cache rules, tenant resolution σε middleware (όχι μόνο DNS), validation που να εμποδίζει cross-tenant data leak σε dev.

### [F11] Hostage situation: tenant data export refusal
- **Spec status:** None — implicit trust σε platform
- **Missing:** Πελάτης (firm) θέλει να φύγει. Πώς εξάγει 5 χρόνια data; Format; Documents από R2;
- **Suggested:** Spec "data takeout" workflow. SLA. Format (PostgreSQL dump + R2 zip + JSON manifest). Encryption key handover.

---

## 7. TOP 10 PRE-LOCK FIXES (πριν Sprint 3 ξεκινήσει)

1. **[L1+L2] Resolve namespace + tenant model contradiction.** Spec: είτε DB-per-tenant + drop `tenant_id` columns + drop `/clients` namespace, είτε row-level multi-tenant + admit it. Αυτό αλλιώς μολύνει κάθε downstream module. **Owner:** kostas-engineer + claude-engineer.

2. **[L5+L6] Add database-level invariant enforcement.** Partial unique index για `is_primary_contact`. Trigger για `billing_split_percentage` SUM=100. Δεν αρκεί "application-enforced". **Owner:** kostas-engineer.

3. **[L3] Reframe Aegis status.** Όχι "nervous system". Ορισμός: "AI enhancement layer that augments core operations without being required for them." Αλλιώς τo failure-mode contract είναι μαρκετίνγκ ψεύδος. **Owner:** Niko (positioning) + planner.

4. **[E10] Mandatory citation validator για AI drafts.** Κάθε case-law reference στο AI output verified against `case_law` table σε real-time. Block submit αν fictional. **Owner:** ai/ml engineer + michalis (compliance).

5. **[A6+E7] ΑΠΕΔ certificate lifecycle management.** Spec pre-flight cert validation, expiry monitoring, mid-process expiry handling. **Owner:** claude-engineer (αν μπει στο Phase 1 per Άργος P1.7).

6. **[A2+H3] Greek OCR + PII benchmark suites.** Sprint 7 deliverable: 50 real Greek legal docs, OCR target ≥90%, PII detection ≥95%. Fallback strategy σε AWS Textract Greek model. **Owner:** ai/ml engineer + qa-specialist.

7. **[L11+E18] Audit log + GDPR derogation policy.** Document Greek N.4624/2019 derogation explicitly. Retention matrix per data type. Pseudonymization (όχι deletion) για financial. **Owner:** michalis.

8. **[E14] Database scale strategy.** Partition `audit_log` και `document` πέρα από `time_entry`. Define archival policy. Test με synthetic 1TB dataset σε Sprint 4. **Owner:** ops-monitor + kostas-engineer.

9. **[F7+F8] Idempotency + concurrency policy.** Spec optimistic locking για approvals. Spec exactly-once semantics για myDATA με content hash. Test concurrent scenarios σε Sprint 16. **Owner:** kostas-engineer.

10. **[H1+H2+L4] Sprint 17-18 reschedule.** Reduce scope ή add dev. Conflict checking + email sync + protocol + intake + contract + e-sig + system search + perf + security + GDPR + load test + docs σε 4 εβδομάδες είναι αδύνατο. **Owner:** Niko (capacity) + planner (scheduling).

---

## 8. VERDICT ΣΥΝΟΨΗ

**Verdict: REVISE**

Το spec είναι αρκετά φιλόδοξο και αρκετά καλά μελετημένο για να προχωρήσει — αλλά ΟΧΙ σε σημερινή μορφή. Τα 17 logical inconsistencies, 14 unstated assumptions, 18 unhandled edge cases, και 11 missing failure modes είναι ΟΛΑ fixable, αλλά πρέπει να γίνουν **πριν** Sprint 3 ξεκινήσει. Διαφορετικά:
- Το Invariant #1/#2 contradiction θα σπάσει σε Sprint 5 (Matters)
- Το tenant_id confusion θα σπάσει σε Sprint 1 (Foundation)
- Το AI failure-mode mismatch θα σπάσει σε pricing conversations με τα πρώτα γραφεία
- Τα missing edge cases θα σπάσουν σε real customer scenarios εντός 6 μηνών παραγωγής

**Required fixes** (πέραν των Top 10): integrate Άργος P1 list (μην επικαλύπτεις, ολοκλήρωσε), add glossary.md, add disaster-recovery.md, add edge-cases.md.

**Return to:** kostas-engineer (schema fixes), planner (build-plan resequencing), Niko (positioning + ΑΠΕΔ/SOLON go/no-go decisions), και τέλος Δαίδαλος για overall re-design του πλαισίου των failure modes.

**Ο Άργος είδε τους ανταγωνιστές. Εγώ είδα τη λογική. Και οι δύο συμφωνούμε ότι το spec ΔΕΝ είναι έτοιμο για lock — αλλά μετά από αυτές τις διορθώσεις, θα γίνει πραγματικά premium platform.**

---

*Generated by Αριστοτέλης — QA Critic | MECE.gr | 2026-04-28*
*Methodology: 6-step critique (Intent → Verify → Assumptions → Edge → Naming → Verdict)*
*Reviewed: 8 spec files (~190KB)*
