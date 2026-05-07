# THEMIS OS — Specifications

Premium enterprise legal practice management platform for Greek law firms (20-50+ lawyers), with native AI grounded in Greek law, full Greek regulatory compliance (myDATA, ΔΣΑ, ΚΠολΔ, SOLON, ΑΠΕΔ), single-tenant DB per firm.

**Current spec version:** v0.2 (2026-04-28) — see `changelog.md`.

---

## Reading order

If you are new to ΘΕΜΙΣ OS, read in this order:

1. **`tech-stack.md`** — Stack choices, infrastructure, deployment topology
2. **`module-dependencies.md`** — How the 28 modules relate; what blocks what
3. **`build-plan.md`** — Phase 1 / Phase 2 / Phase 3 sprint allocation, budget, team
4. **`data-model.md`** — 65 tables, 2 architectural invariants
5. **`api-architecture.md`** — REST endpoints, auth, RBAC, webhooks
6. **`aegis-spec.md`** — AI orchestrator (11 agents), PII handling, autonomy levels
7. **`greek-compliance.md`** — myDATA, ΔΣΑ Γραμμάτιο, ΚΠολΔ deadlines, SOLON, ΑΠΕΔ, Trust ΕΔΕ
8. **`changelog.md`** — Spec version history with rationale

If you are auditing the v0.2 changes specifically:
- **`changelog.md`** first (full transition map)
- Then any spec file marked "v0.2" in its header

---

## File index

| File | Lines (approx.) | Owner | Last touched |
|------|-----------------|-------|--------------|
| [tech-stack.md](./tech-stack.md) | 400 | claude-engineer | v0.2 (tenant clarification) |
| [build-plan.md](./build-plan.md) | 600 | planner | v0.2 (sprint reallocation) |
| [module-dependencies.md](./module-dependencies.md) | 350 | planner | v0.2 (DAG update) |
| [data-model.md](./data-model.md) | 1400 | kostas-engineer | v0.2 (tenant_id removal + new tables + invariant cleanup) |
| [api-architecture.md](./api-architecture.md) | 850 | app-specialist | v0.2 (new endpoints) |
| [aegis-spec.md](./aegis-spec.md) | 700 | claude-engineer | v0.2 (3 new agents) |
| [greek-compliance.md](./greek-compliance.md) | 700 | michalis (compliance) | v0.2 (SOLON/ΑΠΕΔ/Trust full spec) |
| [gap-audit.md](./gap-audit.md) | 440 | Άργος (auditor) | v0.1 audit, frozen |
| [changelog.md](./changelog.md) | 200 | spec authors | v0.2 |
| [README.md](./README.md) | this file | Δαίδαλος | v0.2 |

**Total:** 10 files, ~5,650 lines.

---

## The 10 invariants (locked)

Any proposal contradicting these is rejected by default. They are explained in detail in their home files; this is the index.

1. **Unified Party Model** — one row per real-world person/org (`data-model.md` §2)
2. **Matter ↔ Party M2M** — no `matter.client_id`; rich `matter_party` (`data-model.md` §3)
3. **PII encryption at rest** — AES-256-GCM, per-firm KMS (`tech-stack.md`)
4. **Audit log immutability** — append-only, partitioned (`data-model.md` §21)
5. **AI failure never blocks core ops** — Aegis is enhancement layer (`aegis-spec.md`)
6. **Single-tenant per firm DEPLOYMENT** — dedicated DB+Qdrant+KMS (`tech-stack.md`)
7. **Greek-first localization** — UI, errors, PDFs, dates (`tech-stack.md`)
8. **Human-in-the-loop for AI legal output** — ΑΠΕΔ, drafts, court filings (`aegis-spec.md`)
9. **Privilege tag enforcement** — DMS + AI + portal (`data-model.md` §5, `aegis-spec.md`)
10. **No PII leaves EU** — Hetzner DE/FI, EU-region IMAP/Graph (`tech-stack.md`)

---

## How to propose a change

1. Open a discussion (GitHub issue or Niko approval gate for strategic changes)
2. Identify which invariants are touched (if any)
3. If invariants are touched: STOP, escalate to Niko + spec authors
4. If not: write proposed diff against the relevant file(s)
5. Update `changelog.md` with new version row at top
6. Spec author + planner sign off, then commit

---

## Out of scope (explicitly)

These are NOT part of ΘΕΜΙΣ OS and will not be added without major scope review:

- HR / Payroll (use Erganinet, SoftOne, Epsilon — integrate, don't duplicate)
- CLE tracking (ΔΣΑ does this centrally)
- Internal Slack-clone (use Teams/Slack — keep matter-linked notes only)
- Physical file management (cloud-native, no shelf tracking)
- Business Development CRM (merged into Module 11 Intake)
- PI Settlement calculator (not target market)

---

## Project context

- **Operator:** Νικόλαος Τζόρβας (Niko), CEO MECE.gr
- **Target customer:** Greek law firms 20-50+ lawyers (KG Law, Karatzas, Zepos & Yannopoulos tier-out, mid-market sweet spot)
- **Pricing target:** €100-120/user/month
- **Phase 1 GA target:** Month 12 from kickoff
- **Phase 1 budget:** ~€340K (v0.2)
- **Critical compliance date:** Ν.5221/2025 already active 1.1.2026 (SOLON e-filing must work in pilot)

---

*Last updated: 2026-04-28 (v0.2 lock).*
