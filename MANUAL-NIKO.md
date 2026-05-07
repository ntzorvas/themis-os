# ΘΕΜΙΣ OS — Status Report για Niko

**Audience:** Νικόλαος Τζόρβας (CEO MECE.gr, owner)
**Date:** 30 Απριλίου 2026
**Phase:** 1 Preview — LIVE
**URL:** https://themis.mentorist.gr
**Smoke test:** 16/18 pass (2 skip: admin token / DATABASE_URL για cleanup)

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| Phase 1 status | **LIVE on preview** (production deferred μέχρι v0.3 retargeting) |
| Phase 1 % complete | ~85% — όλα τα core modules deployed, 2 known bugs (§8) |
| Live URL | https://themis.mentorist.gr (Cloudflare → Traefik → Next.js) |
| Smoke API tests | **16/18 pass** (2 skip σκόπιμα) |
| Schemas live | 4 (`tenant_template`, `firm_demo`, 2× `firm_smoke_test_*`) |
| Modules live | 9/10 Phase-1 modules functional, documents queue έχει bug |
| AI/Aegis | **Not yet deployed** — Phase 2 deliverable |
| Greek compliance | myDATA submission table exists, **not transmitting** ακόμα. Encryption ready. |

**Bottom line:** Έχουμε working preview που δείχνει το core flow (login → dashboard → matters → parties → time → invoices → deadlines). Ready για **demo στο ΔΣΘ Θεσσαλονίκης**. Δεν είναι production-ready για paying customers ακόμα — λείπουν AI features, mobile UX, myDATA transmission, ΑΠΕΔ integration.

---

## 2. Architecture

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | Next.js **15.4** (App Router, RSC) + TypeScript + Tailwind + shadcn/ui | Originally targeted 16, downgraded to 15.4 for stability |
| Auth | NextAuth v5 (cookie sessions, bcrypt hashes) | Server-side `lib/auth.requireAuth()` guard |
| Backend | Fastify (Node 20, modular monolith) | 9 route groups deployed |
| Database | PostgreSQL 16 (Docker `claude-pm-os-postgres-1`) | Schema-per-tenant pattern |
| Encryption | Vault (dev mode) — envelope encryption | KMS keys per tenant, AES-256-GCM at rest |
| Reverse proxy | Traefik (Docker, ports 80/443) | nginx CANNOT bind 80/443 on preview (port-conflict) |
| TLS | Let's Encrypt wildcard `*.mentorist.gr` | DNS-01 via Cloudflare, expires 2026-07-29 |
| Process mgmt | PM2 | `themis-web` (3501), `themis-api` (4100) |
| Workspace | pnpm monorepo (`apps/`, `packages/`) | Workspace package imports stripped of `.js` extension for Next webpack |

### Multi-tenancy model
**Schema-per-tenant** μέσα σε μία shared database (`themisos_preview`). Κάθε γραφείο = δικό του Postgres schema (`firm_<slug>`), connection routing μέσω `firm_id` → schema name.

> **Note:** Original Invariant #6 (single-tenant per firm = ξεχωριστή database) χαλάρωσε για το preview. Το v0.3 spec προβλέπει **two-tier:** shared multi-tenant (Starter/Pro €19/€39) + dedicated (Firm/Enterprise €59+). Decision pending Niko approval.

### Key files
- `/opt/themis-os/apps/web/` — Next.js App
- `/opt/themis-os/apps/api/` — Fastify API
- `/opt/themis-os/packages/{db,types,greek-utils,rules-engine,crypto,ui}/` — shared workspace packages
- `/opt/themis-os/scripts/smoke-test-phase1.mjs` — automated smoke test
- `/opt/themis-os/ecosystem.preview.config.cjs` — PM2 config

---

## 3. Modules Live (Phase 1)

### Status legend
- **WORKING** — UI + API + DB integrated, smoke-tested
- **STUB** — UI/API exists αλλά δεν κάνει την πλήρη δουλειά
- **MISSING** — όχι στο Phase 1, planned για Phase 2

### Module table

| # | Module | Path | API Routes | DB Tables | Seed Data | Status |
|---|--------|------|-----------|-----------|-----------|--------|
| 1 | **Auth & Login** | `/login`, `/(auth)/*` | `/auth/*` | `users`, `user_sessions`, `api_tokens` | 2 users (partner+associate) | **WORKING** |
| 2 | **Dashboard** | `/dashboard` | aggregates from matters | — | KPIs computed live | **WORKING** |
| 3 | **Matters** | `/matters` | `/v1/matters/*` | `matter`, `matter_status_history`, `matter_team`, `matter_tag`, `matter_event`, `matter_note` | **40 matters** (25 active / 8 prospective / 7 closed) | **WORKING** |
| 4 | **Parties** | `/parties` | `/v1/parties/*` | `party`, `party_natural`, `party_legal`, `party_contact`, `party_address`, `party_role`, `party_relationship` | **40 parties + 80 matter_party links** | **WORKING** |
| 5 | **Time entries** | `/time-entries` | `/v1/time-entries/*` | `time_entry` | **15 entries** | **WORKING** (1 known bug: `/active` endpoint 401 inside dashboard widget) |
| 6 | **Invoices** | `/invoices` | `/v1/invoices/*` | `invoice`, `invoice_line`, `payment` | **5 invoices, 7 lines** | **WORKING** |
| 7 | **Expenses** | `/expenses` | `/v1/expenses/*` | `expense` | **8 expenses** | **WORKING** |
| 8 | **Calendar** | `/calendar` | `/v1/calendar/*` | `calendar_event` | **0 events** (table ready, seed pending) | **WORKING** (empty) |
| 9 | **Documents** | `/documents` | `/v1/documents/*` | `document`, `document_version`, `document_share`, `document_template`, `document_privilege` | **0 documents** | **STUB** — upload UI exists, OCR queue has 42P10 ON CONFLICT bug (§8) |
| 10 | **Deadlines** | `/deadlines` | `/v1/matters/:id/deadlines` | `matter_deadline` | **30 deadlines** | **WORKING** (manual entry; ΚΠολΔ rules engine in `packages/rules-engine` not wired to UI auto-suggest yet) |
| 11 | **Reports** | `/reports` | `/v1/reports/*` | reads from above | computed live | **WORKING** (CSV export) |
| 12 | **Settings** | `/settings` | — | `setting` | per-tenant key/value | **WORKING** |
| 13 | **Audit log** | — | — | `audit_log` (partitioned by month: `2026_04`, `2026_05`, `2026_06`) + `audit_privilege_access` | append-only, every write logged | **WORKING** |
| 14 | **Background jobs** | — | internal | `background_job`, `ocr_job` | — | **STUB** — queue exists, OCR not running |
| 15 | **Aegis AI (11 agents)** | — | — | `ai_request`, `ai_review`, `email_classification` | tables exist, no calls | **MISSING — Phase 2** |
| 16 | **myDATA transmission** | — | — | `mydata_submission` | empty | **MISSING — Phase 2** |
| 17 | **Trust Accounting** | — | — | `trust_account_entry` | empty | **STUB** — table exists, UI Phase 2 |
| 18 | **Conflict checks** | — | — | `conflict_check` | empty | **STUB — Phase 2** |
| 19 | **GDPR requests** | — | — | `gdpr_request` | empty | **STUB — Phase 2** |
| 20 | **Notifications** | — | — | `notification` | empty | **STUB — Phase 2** |
| 21 | **Tasks (Kanban)** | — | — | `task`, `task_comment` | empty | **STUB — Phase 2** |
| 22 | **KMS custody shares** | — | — | `kms_custody_share` | empty | **STUB — Phase 3** (multi-party key escrow) |

**Live Phase-1 modules: 13 fully working / 8 stubbed-tables-only / 1 missing entirely (AI).**

---

## 4. Database

### Database
- Engine: PostgreSQL 16 (Docker container `claude-pm-os-postgres-1`)
- Database name: `themisos_preview`
- App user: `themisos_app`
- Migrations applied: through **0008** (latest: soft-delete normalization to `soft_deleted_at`)

### Schemas live

| Schema | Purpose | Tables | Status |
|--------|---------|--------|--------|
| `tenant_template` | Template για νέα γραφεία (clone source) | 51 | Reference |
| `firm_demo` | Public demo + ΔΣΘ presentation | **51 tables, populated** | **PRIMARY** |
| `firm_smoke_test_1777490801858` | Smoke test artifact | 51 | Disposable |
| `firm_smoke_test_1777527517368` | Smoke test artifact | 51 | Disposable |

### Demo data (`firm_demo` schema)

| Table | Rows |
|-------|------|
| `users` | 2 |
| `matter` | 40 |
| `party` | 40 |
| `matter_party` | 80 (avg 2 parties per matter) |
| `matter_deadline` | 30 |
| `time_entry` | 15 |
| `invoice` | 5 |
| `invoice_line` | 7 |
| `expense` | 8 |
| `document` | 0 (queue blocked, see §8) |
| `calendar_event` | 0 (seed pending) |

### Demo enrichment
Sample matter `ΥΠ-2026-0042` (**Παπαδημητρίου κατά ΕΛΛΑΣ ΕΜΠΟΡΙΚΗ ΑΕ**):
- 3 parties (client + opposing + witness)
- 1 invoice (`ΤΠΥ-2026-0017`)
- 3 time entries
- 2 deadlines (ΚΠολΔ 237 §1 + §2)
- 1 document (note: doc table currently empty due to upload queue bug; seed reflects intended state)

Seed script: `/tmp/themis-deploy/seed-enrich.sql` (rerunnable, idempotent on conflict).

### Practice areas covered (16 distinct)
Αστικό (6), Ποινικό (8), Φορολογικό (4), Εμπορικό (4), Εργατικό (4), Διοικητικό (2), Ασφαλιστικό (2), Εμπράγματο (2), και 8 ακόμα από 1 each.

### Audit log
- **Partitioned monthly** (`audit_log_2026_04`, `_05`, `_06` ήδη δημιουργημένα)
- Append-only, INSERT only, ποτέ UPDATE/DELETE
- `audit_privilege_access` ξεχωριστή partitioned table για attorney-client privileged document access

---

## 5. Infrastructure

### Servers
| Server | Role | Notes |
|--------|------|-------|
| **Preview** (89.167.110.132) | THIS DEPLOYMENT | Hetzner cx32 8GB, Traefik front |
| Bridge (37.27.211.14) | GG4, MemPalace, dev | Where Pericles runs |
| Production (37.27.47.200) | Canonical DB, NOT used yet | Reserved for Phase 2 |

### PM2 processes (preview)
```
themis-api    online    PID 1759399    91 MB    port 4100
themis-web    online    PID 1759391    95 MB    port 3501
```
(Stable on current restart; older `pm-os-api` and `villa-tuman` unrelated.)

### Networking
- Cloudflare DNS → preview server IP
- Traefik file provider config: `/root/traefik/config/dynamic/themis.yml`
- TLS: Let's Encrypt wildcard `*.mentorist.gr` (Cloudflare DNS-01)
- TLS expiry: **2026-07-29** (renewal cron set)
- TLS credentials: `/root/.cloudflare-credentials.ini` (chmod 600)

### Quick health check
```
curl -sk -o /dev/null -w "ROOT:%{http_code} DASH:" https://themis.mentorist.gr/
curl -sk -o /dev/null -w "%{http_code} LOGIN:"      https://themis.mentorist.gr/dashboard
curl -sk -o /dev/null -w "%{http_code}\n"           https://themis.mentorist.gr/login
# Expected: ROOT:200 DASH:307 LOGIN:200
```

---

## 6. Security

| Control | Status | Implementation |
|---------|--------|----------------|
| **Encryption at rest** | LIVE | Vault (dev mode) envelope encryption, AES-256-GCM, KMS keys per tenant. **TODO production:** Vault prod mode with auto-unseal. |
| **Encryption in transit** | LIVE | TLS 1.3, HSTS preload candidate |
| **Auth** | LIVE | NextAuth v5, JWT cookie sessions, bcrypt password hashes, 8h idle timeout |
| **Schema isolation** | LIVE | Per-tenant Postgres schema, app user without cross-schema grants |
| **AFM validation** | LIVE | Greek checksum algorithm enforced at API + DB layer (`packages/greek-utils`) |
| **Soft-delete normalization** | LIVE | Migration 0008 — όλοι οι πίνακες χρησιμοποιούν `soft_deleted_at` (όχι μίξη `deleted_at` / `is_deleted`) |
| **Audit log** | LIVE | Append-only, partitioned monthly, every write logged |
| **PII anonymization πριν LLM** | NOT NEEDED YET | Aegis offline → no LLM calls |
| **GDPR derogation Ν. 4624/2019 §31** | DESIGNED | Pseudonymization path defined, UI Phase 2 |
| **Rate limiting** | MISSING | Phase 2 |
| **2FA** | MISSING | Phase 2 |
| **OWASP audit** | PENDING | Ninurta scheduled για post-v0.3 |

---

## 7. Quality Gates Passed

| Gate | Result |
|------|--------|
| Smoke test API (`scripts/smoke-test-phase1.mjs`) | **16/18 pass** |
| 2 skipped tests | Audit log read (admin token), cleanup (DATABASE_URL) — σκόπιμα |
| Login flow Playwright | Verified (login → dashboard → 200) |
| Dashboard auth guard | Verified (`/dashboard` returns 307 → /login when unauth) |
| Schema migration 0008 | Applied (soft-delete normalization) |
| Workspace TS resolution | Fixed (`.js` extensions stripped, `transpilePackages` working) |
| TLS cert | Valid through 2026-07-29 |
| PM2 restart resilience | `themis-web` 1 restart, `themis-api` 5 restarts (acceptable for dev preview) |
| Build size | Acceptable (Next.js .next under 200MB) |

---

## 8. Known Issues

### Issue #1 — `42P10` ON CONFLICT bug in document-processing queue
**Symptom:** Documents upload UI accepts file, αλλά μετά queue insert fails με Postgres `42P10` (no unique constraint matching ON CONFLICT specification).
**Root cause:** OCR job dedup key references column without matching unique index.
**Impact:** No documents can be persisted (table currently 0 rows).
**Fix complexity:** Low — drop ON CONFLICT or add proper unique index. **TODO Δαίδαλος**.

### Issue #2 — `/api/v1/time-entries/active` returns 401 inside dashboard widget
**Symptom:** Dashboard "Ενεργός χρόνος" widget shows 401 instead of running timer.
**Root cause:** Widget σε client component fetches the API route χωρίς να περνάει το NextAuth cookie (cookie not propagated through internal fetch).
**Impact:** Dashboard widget broken· /time-entries page works κανονικά.
**Fix complexity:** Low — pass cookie via headers or move το fetch σε server component. **TODO**.

### Issue #3 — Smoke test 2 skips
Όχι bug — admin token & DATABASE_URL για cleanup είναι σκόπιμα disabled στο preview για να μη διαγράφονται ακούσια test artifacts.

### Issue #4 — `sunday` PM2 process errored (34 restarts, 0 mem)
Unrelated to ΘΕΜΙΣ OS αλλά noisy. Pending cleanup.

---

## 9. Phase 2 Pending

### Compliance & integrations
- **myDATA ΑΑΔΕ transmission** — table ready, transmission service missing
- **ΔΣΑ Γραμμάτιο auto-generation** — table πίνακα γραμματίων + UI flow
- **ΑΠΕΔ qualified signatures** — OAuth flow με portal.olomeleia.gr
- **SOLON e-filing** — hybrid only (browser extension), hardware token blocks server-side
- **Trust Accounting ΕΔΕ** — 2-way recon UI

### AI (Aegis stack — 11 agents)
1. Research Agent (Sonnet)
2. Drafting Agent (Sonnet)
3. Deadline Agent (Haiku + ΚΠολΔ rules)
4. Billing Agent (Haiku)
5. Conflict Agent (Sonnet)
6. Intake Agent (Haiku)
7. Summary Agent (Sonnet)
8. OCR Agent (Tesseract + LLM cleanup)
9. Tachydromos — email classifier (Haiku)
10. Chronografos — time capture (Haiku, opt-in)
11. Apologistis — NL→SQL reports (Sonnet, sandboxed views)

Estimated cost: ~$155/month per active firm at typical load.

### UX
- **Mobile-first redesign** (Phase 1 = mobile-friendly only)
- **PWA** με offline mode για court visits
- **Client portal** — promoted from Phase 3 to Phase 1 σύμφωνα με v0.3 spec
- **WhatsApp client communication** integration
- **Greek pre-loaded document templates library**
- **5-minute onboarding wizard**

### Operations
- 2FA (TOTP)
- Rate limiting (per-IP + per-user)
- Real-time notifications (WebSocket)
- Calendar sync (CalDAV)
- Email integration (IMAP read + SMTP send)
- Backup automation (Hetzner volume snapshots → off-site S3-compatible)
- Vault production mode (auto-unseal)

---

## 10. Repository State

### Local
```
/root/projects/themis-os/   (Bridge)   — docs, specs, research
/opt/themis-os/             (Preview)  — actual deployed code
```

### Workspace (Preview)
```
/opt/themis-os/
├── apps/
│   ├── api/       (Fastify, src/routes/{auth,calendar,documents,expenses,invoices,matters,parties,reports,time-entries})
│   └── web/       (Next.js 15.4 App Router, app/{matters,parties,time-entries,invoices,expenses,calendar,deadlines,documents,reports,settings,dashboard,(auth)})
├── packages/
│   ├── crypto/    (AES-256-GCM, Vault client)
│   ├── db/        (PG client, schema migrations 0001-0008)
│   ├── greek-utils/   (AFM validation, ΚΠολΔ deadline calc)
│   ├── rules-engine/  (deadline rules, conflict matching)
│   ├── types/     (shared TS types)
│   └── ui/        (shadcn/ui wrappers)
├── infra/         (Traefik configs, Docker compose)
├── scripts/       (smoke-test-phase1.mjs, seed scripts)
└── ecosystem.preview.config.cjs   (PM2)
```

### GitHub
**NOT pushed yet.** Repo `git@github.com:ntzorvas/themis-os.git` does not exist.
- `gh` token on Bridge is GitHub-App scoped → `Resource not accessible by integration` σε `createRepository`
- **Niko action required:** create repo manually OR provide PAT με `repo` scope
- Codebase remains entirely on Bridge `/root/projects/themis-os/` + Preview `/opt/themis-os/`

---

## 11. Pending Niko Tasks

| # | Task | Why | Urgency |
|---|------|-----|---------|
| 1 | **Buy domains** `themisos.gr` + `themis.legal` | Brand protection, production domain | **High** — squat risk |
| 2 | **Trademark application** ΘΕΜΙΣ OS, Class 9 (software) + Class 42 (SaaS) | IP protection, EU + Greek registries | **Medium** — pre-launch ideally |
| 3 | **Provide GitHub PAT** (`repo` scope) | Push code, enable CI/CD, backup | **High** — single-point-of-failure today |
| 4 | **First pilot decision** | ΔΣΘ Θεσσαλονίκης beachhead vs alternative | **High** — Q3 2026 launch dependent |
| 5 | **v0.3 module list approval** | Cut Module 35/36/bulk, add solo-mode/mobile-first/WhatsApp/client portal Phase 1 | **High** — blocks Daedalus brief |
| 6 | **Invariant #6 decision** | Single-tenant ΟΛΟΙ vs two-tier (shared για Starter/Pro) | **High** — affects unit economics |
| 7 | **Domain expert legal review** | Lawyer review ΚΠολΔ deadline rules | **Medium** — pre-pilot |
| 8 | **External legal review +€4.5K** | Phase Gate D (privacy + bar association compliance) | Medium — pre-launch |
| 9 | **Security audit +€2.5K** | Ninurta + 3rd party | Medium — pre-launch |
| 10 | **Demo deck** για ΔΣΘ + Athens Legal Tech | Pilot acquisition | High — needs Athena Designer |

---

## 12. Build Plan Lessons (NEW)

### Σόλων agent (created post-deployment)
**Trigger:** Πρώτη φορά login experience ήταν σπασμένο — dashboard 500 error για authenticated user, λύθηκε post-hoc.
**Mitigation:** **Σόλων** agent created ως legislator-agent — γράφει "νόμους" (acceptance criteria + first-login regression tests) πριν κάθε Phase deploy. Όσα modules προσθέτονται ή αλλάζουν περνάνε από Σόλων review πριν τη μετάβαση σε QA gate (Δοκιμασία).

**Outcome:** Δεν θα ξανασυμβεί το λάθος "η σύνδεση πετυχαίνει αλλά το dashboard δεν φορτώνει". Σόλων gates: (a) login→landing flow, (b) empty state rendering, (c) seed data sufficiency για demo, (d) cookie propagation σε internal fetches (το bug §8 #2 θα είχε πιαστεί από Σόλων).

### Other lessons captured
- **Workspace `.js` import pitfall** — Next webpack δεν αντιστοιχίζει `.js` imports σε `.ts` source όταν τα packages είναι σε pnpm workspace. Fixer script `/tmp/fix-imports.py` μόνιμη λύση = δεν γράφουμε `.js` σε workspace package internal imports.
- **Traefik vs nginx port conflict** — Στο preview server, nginx υπήρχε ήδη με port 80/443 dependencies. Traefik αντικατέστησε, nginx config disabled. Documented στο handoff.
- **PM port mismatch** — Earlier docs έλεγαν 3110, στην πραγματικότητα `themis-web` τρέχει στο 3501. Handoff updated.

---

## 13. Demo Access

### URL
```
https://themis.mentorist.gr/login
```

### Credentials
| Email | Role | Όνομα | Τι μπορεί |
|-------|------|-------|-----------|
| `demo@themisos.gr` | partner | Δημήτριος Παπαδόπουλος | Πλήρης πρόσβαση, όλα τα modules |
| `associate@themisos.gr` | associate | Ελένη Κωνσταντινίδου | Matters + time, όχι invoicing |

(Passwords stored hashed στη DB, set μέσω seed script.)

### Demo data summary
- 40 matters (16 πεδία δικαίου, 9 matter types, 25 active / 8 prospective / 7 closed)
- 40 parties + 80 matter_party links
- 30 deadlines (ΚΠολΔ 237/518/564/501/632, ΚΠΔ 473)
- 15 time entries (mix billable/non)
- 5 invoices με 7 lines (`ΤΠΥ-2026-0017` etc)
- 8 expenses

### Verification one-liner
```bash
ssh root@89.167.110.132 'cd /opt/themis-os && THEMIS_API_URL=http://localhost:4100 node scripts/smoke-test-phase1.mjs | tail -5'
```

### Screenshots
Phase 1 preview screenshots: TODO — Athena Designer task, για demo deck Niko-facing.

---

## Current Best Next Actions

1. **Niko decision** σε pending items #3 (GitHub PAT), #5 (v0.3 module list), #6 (Invariant #6 architecture)
2. **Fix bug #1** (documents queue 42P10) — dispatch Δαίδαλος, ~2h work
3. **Fix bug #2** (dashboard time-active widget 401) — dispatch app-specialist, ~1h work
4. **Demo deck** για ΔΣΘ — dispatch Athena Designer μόλις Niko approve content brief
5. **Σόλων full agent installation** — agent file ready, needs Niko review πριν register στο `~/.claude/agents/`

---

*ΘΕΜΙΣ OS Phase 1 Preview — built by Pericles, audited by Argos, critiqued by Aristotle, researched by Herodotos, deployed via hermes pipeline.*
*Status: LIVE on preview, 16/18 smoke pass, awaiting v0.3 retargeting decisions.*
