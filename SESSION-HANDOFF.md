# ΘΕΜΙΣ OS / legalapp — Session Handoff
**Last updated:** 2026-04-30
**Status:** Phase 1 Preview LIVE on https://themis.mentorist.gr (smoke 16/16 pass), v0.3 retargeting pending (small-firm pivot)
**Searchable keywords:** legalapp, ΘΕΜΙΣ OS, themis-os, legal practice management, Greek lawyers, small firms, pilot

---

## 2026-04-30 — Preview Deployment Milestone

| Item | State |
|------|-------|
| SSL wildcard cert (`*.mentorist.gr`) | Issued via Let's Encrypt + Cloudflare DNS-01, expires 2026-07-29. Creds at `/root/.cloudflare-credentials.ini` (chmod 600). |
| Reverse proxy | Traefik (Docker, ports 80/443) — file provider `/root/traefik/config/dynamic/themis.yml`. nginx CANNOT bind 80/443 on preview; sites-available config exists but disabled. |
| Web | Next.js 15.4 PM2 `themis-web` → port **3501** (NOT 3110 as earlier docs implied) |
| API | Fastify PM2 `themis-api` → port **4100** |
| DB | `claude-pm-os-postgres-1` Docker, db `themisos_preview`, schema `firm_smoke_test_1777490801858` |
| Dashboard `/dashboard` | NEW — server component, cookie session guard via `lib/auth.requireAuth()`, 4 KPI cards (Σύνολο/Ενεργές/Προοπτικές/Κλεισμένες) + Πρόσφατες Υποθέσεις. Returns 307→/login when unauth (verified). |
| Seed enrich | matter `ΥΠ-2026-0042` (Παπαδημητρίου κατά ΕΛΛΑΣ ΕΜΠΟΡΙΚΗ ΑΕ): 3 parties (client/opposing/witness), 1 doc, 3 time entries, 1 invoice (ΤΠΥ-2026-0017), 2 deadlines (ΚΠολΔ 237). Script: `/tmp/themis-deploy/seed-enrich.sql` (rerunnable). |
| Smoke test (`scripts/smoke-test-phase1.mjs`) | 16/18 pass, 2 skip (audit log + cleanup require admin token / DATABASE_URL) |
| Workspace `.js` extension imports | Stripped from `packages/{types,greek-utils,rules-engine,db,crypto}/src` so Next webpack resolves source TS directly (transpilePackages). Fixer at `/tmp/fix-imports.py` (also on preview `/tmp/fix-imports.py`). |

### Blocked
- **GitHub `git@github.com:ntzorvas/themis-os.git`**: repo not created. The `gh` token on Bridge is GitHub-App scoped (`Resource not accessible by integration` on `createRepository`). Push pending until Niko creates the repo manually OR provides a PAT with `repo` scope.

### Quick re-verify
```bash
curl -sk -o /dev/null -w "ROOT:%{http_code} DASH:" https://themis.mentorist.gr/
curl -sk -o /dev/null -w "%{http_code} LOGIN:"      https://themis.mentorist.gr/dashboard
curl -sk -o /dev/null -w "%{http_code}\n"           https://themis.mentorist.gr/login
# Expect: ROOT:200 DASH:307 LOGIN:200
ssh root@89.167.110.132 'cd /opt/themis-os && THEMIS_API_URL=http://localhost:4100 node scripts/smoke-test-phase1.mjs | tail -5'
```

---

## 🎯 What This Is

**ΘΕΜΙΣ OS** = AI-native legal practice management SaaS platform for the Greek market.

**Original target (v0.1/v0.2):** Enterprise Greek law firms (20-50+ lawyers).
**Strategic pivot (2026-04-28):** **Small Greek firms (1-15 lawyers, mostly solo + 2-5)** — because the Greek market doesn't have many large firms.

**Owner:** Νίκος (CEO MECE.gr)
**Master builder agent:** Pericles (Περικλής, opus model, navy)
**Domain agent:** themis (already exists for legal-platform queries)

---

## 📂 File Structure

```
/root/projects/themis-os/
├── SESSION-HANDOFF.md          ← THIS FILE — start here
├── docs/
│   ├── README.md               ← project overview v0.2
│   ├── changelog.md            ← v0.1 → v0.2 delta
│   ├── build-plan.md           ← 18 sprints, ~9 months, €340K budget
│   ├── module-dependencies.md  ← DAG, 8-layer hierarchy
│   ├── data-model.md           ← 68 tables, Unified Party Model
│   ├── api-architecture.md     ← REST endpoints, services topology
│   ├── aegis-spec.md           ← 11 AI agents
│   ├── greek-compliance.md     ← myDATA, ΑΠΕΔ, SOLON, Trust ΕΔΕ
│   ├── tech-stack.md           ← Next.js 16 + FastAPI + Fastify
│   ├── gap-audit.md            ← Argos competitor gap audit (frozen v0.1)
│   └── critique.md             ← Aristotle logical critique
└── research/
    ├── small-firm-market-research.md  ← Herodotos market validation (CRITICAL)
    └── solon-integration-research.md  ← Herodotos SOLON e-filing reality
```

---

## 🧱 The 10 Architectural Invariants (v0.2 LOCKED)

1. **Unified Party Model** — `party` + `party_role` + `party_relationship` (NOT separate client/supplier tables)
2. **Matter ↔ Party M2M** — `matter_party` table with role/side/representation_status
3. **PII encryption at rest** — AES-256-GCM, KMS keys per tenant
4. **Audit log immutability** — append-only, every write logged
5. **AI failure never blocks core ops** — Aegis is enhancement, not dependency
6. **Single-tenant per firm DEPLOYMENT** — ⚠️ **Πιθανώς αλλάζει σε v0.3** (shared multi-tenant για Starter/Professional tiers)
7. **Greek-first localization** — UI, AI, content, legal references
8. **Human-in-the-loop for AI legal output** — no autonomous filings
9. **Privilege tag enforcement** — privileged docs never auto-shared
10. **No PII leaves EU** — EU-region LLM endpoints only

---

## 💰 Pricing (v0.3 — από Herodotos research, validated)

| Tier | Price | Target | Architecture |
|------|-------|--------|--------------|
| **STARTER** | **€19/user/mo** | Solo practitioners | Shared multi-tenant |
| **PROFESSIONAL** | **€39/user/mo** ← sweet spot | 2-8 lawyers | Shared multi-tenant |
| **FIRM** | **€59/user/mo** | 8-15 lawyers | Dedicated single-tenant |
| **ENTERPRISE** | **€79+** | 15+ lawyers | Dedicated + custom SLA |

Annual billing = 2 months free (16.7% discount). 30-day free trial on PROFESSIONAL.

**Anchor competitor:** Alma €19-34/user/mo. Our differentiation: AI + client portal + integrated legal research (none of which competitors have).

---

## 🏛️ Market Sizing (Herodotos validated)

- **40-44K active Greek lawyers** (CCBE 2024) — 3rd highest density in EU
- **60-65% solo practitioners** + 25-28% small (2-5) = ~90% of target
- **TAM:** €14.7-21M ARR
- **SAM Year 3:** €5.7-9M ARR
- **SOM realistic:** €720K-1.4M ARR
- **Catalyst:** Greek state €220M digitization investment → forced adoption

---

## 🎯 Pilot Strategy

**Beachhead: Θεσσαλονίκη μέσω ΔΣΘ partnership** (smaller market, faster feedback, Alma weaker)

| Profile | Size | Location | Tools today | WTP/mo | Acquisition |
|---------|------|----------|-------------|--------|-------------|
| **A: Νέος Δικηγόρος** | Solo | Αθήνα | Sheets + Gmail | €19-29 | LinkedIn, ΔΣΑ new admittees |
| **B: Εμπορικό Γραφείο** | 3-5 | Θεσσαλονίκη | Excel ή Alma (πιλοτικά) | €35-45/user | ΔΣΘ directory ← FIRST |
| **C: Δυσαρεστημένο** | 6-12 | Αθήνα | Alma/ORBIT | €45-59/user | Athens Legal Tech events |

**Distribution sequence:**
- P1: ΔΣΘ partnership + content marketing (lawspot.gr)
- P2: Athens Legal Tech sponsorship + OTE channel (Tipoukeitos precedent)
- P3: ΔΣΑ + Ολομέλεια national reach

---

## ⚔️ Competitive Landscape

| Competitor | Pricing | AI | Client Portal | Mobile | Position |
|-----------|---------|-----|---------------|--------|----------|
| **Alma** (nb.org) | €19-34/u/mo | ❌ | ❌ | Limited | Market leader |
| **ORBIT Law** | Opaque | ❌ | ❌ | ✅ | CRM-centric |
| **Tipoukeitos** | Opaque | ❌ | ❌ | ✅ | OTE endorsed |
| **Thesis.net** | Quote | ❌ | ❌ | ❌ | ERP-style |
| **Bratnet** | Entry | ❌ | ❌ | ❌ | Basic accounting |
| **ΘΕΜΙΣ OS** | Transparent | ✅ Core | ✅ | ✅ Mobile-first | **Differentiator** |

**Our unfair advantage:** Already have legal-platform with **24K νόμοι, 236K άρθρα, 538K Qdrant points** — competitors would need 1+ years to replicate.

---

## 🚧 What Changes v0.2 → v0.3

### ❌ CUT (enterprise-only)
- Module 35 (Εξωδικαστικός) — too specialized, only Niko's firm + ~3 others need it
- Module 36 (Τραπεζική Διαμεσολάβιση) — same
- Bulk operations layer — small firms don't have 3K cases
- Multi-office / Departments — small firms = 1 office
- Hardware-enforced ethical walls — practical reality
- Complex workflow engine — overkill, simpler trigger/action

### ✅ ADD / STRENGTHEN
- Solo Practitioner Mode — everything works without team
- 5-minute onboarding — signup → first matter
- Mobile-first (NOT mobile-friendly)
- WhatsApp client communication integration
- Greek pre-loaded document templates library
- Client portal as **Phase 1** (was Phase 2)

### 🔄 ARCHITECTURE
- **Invariant #6 needs revisit** — shared multi-tenant για €19/€39 tiers (else margin negative)
- Two-tier infra: Shared (Starter/Pro) + Dedicated (Firm/Enterprise)

---

## 🤖 Aegis AI Stack (11 agents — v0.2)

1. **Research Agent** — Greek legal research (Sonnet)
2. **Drafting Agent** — document generation (Sonnet)
3. **Deadline Agent** — ΚΠολΔ/ΑΚ extraction (Haiku + rules)
4. **Billing Agent** — invoice draft, time polish (Haiku)
5. **Conflict Agent** — fuzzy/phonetic matching (Sonnet)
6. **Intake Agent** — lead scoring, engagement letter (Haiku)
7. **Summary Agent** — matter summary, next actions (Sonnet)
8. **OCR Agent** — document text extraction
9. **Tachydromos (Ταχυδρόμος)** — email classifier (Haiku, degraded-mode-safe)
10. **Chronografos (Χρονογράφος)** — time capture inferrer (Haiku, opt-in)
11. **Apologistis (Απολογιστής)** — NL→SQL reports (Sonnet, sandboxed views)

**Cost:** ~$155/month per active firm at typical load.

---

## 🛡️ Greek Compliance (v0.2 Phase 1)

- **myDATA ΑΑΔΕ** — full integration (timos)
- **ΑΠΕΔ qualified signatures** — OAuth via portal.olomeleia.gr
- **SOLON e-filing** — ⚠️ **Hybrid only** (hardware token blocks server-side automation, Phase 2 = browser extension)
- **ΔΣΑ Γραμμάτιο** — auto-calculation
- **Trust Accounting ΕΔΕ** — segregation, 2-way recon Phase 1, 3-way Phase 2
- **GDPR derogation Ν.4624/2019 §31** — pseudonymization (not deletion)
- **No PII leaves EU**

---

## 💸 Budget & Timeline (v0.2 — needs v0.3 recalibration)

- **Dev cost:** €340K (was €250K, +€90K from Argos additions)
- **Timeline:** 18 sprints, ~9 months
- **Phase Gate D:** External legal review +€4.5K + Security audit +€2.5K
- **LLM API:** ~$155/month/firm

**Year 1 break-even with v0.3 pricing:** Negative (need 400+ active firms, ~Year 3).

---

## 🚦 Next Decisions Pending

1. **Workspace pivot decision** — Niko's firm = NOT pilot anymore (too complex, edge case). Stays as internal R&D customer.
2. **v0.3 module list** — Daedalus needs to update specs after market research
3. **Architecture change** — Invariant #6 (single-tenant) → two-tier
4. **Migration plan** — legal-agent → themis-os (deferred, not Phase 1)
5. **ΔΣΘ outreach** — concrete partnership proposal needed
6. **Demo deck** — for ΔΣΘ + Athens Legal Tech
7. **Domain expert review** — lawyer review of ΚΠολΔ deadline rules

---

## 🤖 Agents Used / Available

| Agent | Role | Status |
|-------|------|--------|
| **Pericles (Περικλής)** | Master builder, opus, dispatches all others | Installed `~/.claude/agents/pericles.md` |
| **Daedalus** | Complex coding, refactors, system design | v0.2 specs complete, awaits v0.3 brief |
| **Argos** | Gap audit, competitor analysis | Completed v0.1 audit |
| **Aristotle** | Logical critique, edge cases | Completed v0.2 critique |
| **Herodotos** | Deep research | Completed market research + SOLON research |
| **themis** | Greek legal domain | Existing for legal-platform |
| **Athena designer** | HTML one-pagers | Available for board/investor pitch |
| **Argyros** | Security | Available when ready |

---

## 📍 Important Context

- **legal-platform** (existing, separate project) at `legal.mentorist.gr` provides the legal corpus that ΘΕΜΙΣ OS reuses (24K νόμοι, 236K άρθρα, 538K Qdrant points). NOT to be confused with ΘΕΜΙΣ OS.
- **legal-agent** (existing PM2 service, port 3100) is the older monolithic legal tool — current 502 status, deferred per Niko.
- **MemPalace drawer:** `mece-engineering/themis-os-research` drawer ID `67367d9bf47ca15b` (Herodotos market findings)
- **MemPalace this handoff:** searchable via "legalapp" or "ΘΕΜΙΣ OS" or "themis-os"

---

## 🔄 To Resume Work In Next Session

Tell Claude:
> "βρες τα πάντα για το legalapp"

Claude should:
1. Search MemPalace for "legalapp" and "ΘΕΜΙΣ OS"
2. Read `/root/projects/themis-os/SESSION-HANDOFF.md` (this file)
3. Read `/root/projects/themis-os/research/small-firm-market-research.md`
4. Read `/root/projects/themis-os/docs/changelog.md` for recent changes
5. Surface the **Next Decisions Pending** list
6. Wait for Niko's direction
