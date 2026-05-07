# ΘΕΜΙΣ OS — Legal Practice Management SaaS

Λογισμικό Διαχείρισης Δικηγορικού Γραφείου για την Ελληνική αγορά.
Agent-first build | TypeScript end-to-end | Greek-first UX

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15.4 (App Router, RSC) |
| Backend | Fastify 5 (TypeScript) |
| Database | PostgreSQL 16 (schema-per-tenant) |
| Vector DB | Qdrant (PC node 10.0.0.10) |
| Cache/Queue | Redis 7 + BullMQ |
| Storage | Cloudflare R2 (EU) |
| Auth | NextAuth.js v5 + WebAuthn |
| AI | Anthropic Claude (Sonnet 4.6 + Haiku 4.5) |
| Migrations | Drizzle ORM + drizzle-kit |
| Package manager | pnpm workspaces |
| Deploy | Hetzner Bridge + nginx + PM2 |
| Payments | Viva Wallet (primary) + Εθνική Τράπεζα |

---

## Αρχιτεκτονική

```
themisos/
├── apps/
│   ├── web/          # Next.js 15.4 — φρόντεντ, App Router
│   └── api/          # Fastify — REST API + Aegis AI plugin
├── packages/
│   ├── db/           # Drizzle schema + migrations + tenant resolver
│   ├── types/        # Shared Zod schemas + TypeScript types
│   ├── ui/           # Shared React components (Greek-first)
│   └── greek-utils/  # ΑΦΜ validation, text normalization
├── infra/
│   ├── nginx/        # nginx site config templates
│   └── pm2/          # PM2 ecosystem (web + api + worker)
└── scripts/
    ├── dev.sh        # Local dev εκκίνηση
    └── deploy.sh     # 5-phase production deploy
```

### Multi-tenancy

```
PostgreSQL database: themisos_shared
├── public.firms              ← tenant registry
├── public.subscriptions      ← billing
├── firm_a1b2c3d4.party       ← tenant A
├── firm_a1b2c3d4.matter
├── firm_e5f6g7h8.party       ← tenant B (εντελώς διαχωρισμένο)
└── firm_e5f6g7h8.matter
```

Routing: `acme.themisos.gr` → middleware → `firm_acme` schema → RLS guard

---

## Local Dev Quickstart

```bash
# 1. Αντιγραφή και συμπλήρωση env vars
cp .env.example .env.local
# Επεξεργαστείτε .env.local με DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY

# 2. Εγκατάσταση εξαρτήσεων
pnpm install

# 3. Εκκίνηση (API + Web παράλληλα)
pnpm dev
```

Πρόσβαση:
- Frontend: http://localhost:3110
- API: http://localhost:4000
- Health: http://localhost:4000/health

---

## DB Commands

```bash
pnpm db:generate   # Δημιουργία migration από schema αλλαγές
pnpm db:migrate    # Εφαρμογή migrations
pnpm db:studio     # Drizzle Studio (visual browser)
```

---

## Specs

Πλήρη τεχνικά specs στο `../docs/v03/`:
- `tech-stack-v03.md` — Stack decisions
- `build-plan-v03.md` — 30-day build plan
- `data-model-v03.md` — DB schema (40 tables Phase 1)
- `api-architecture-v03.md` — REST API (14 modules, 4 Aegis agents)

---

## Deployment

```bash
# Production deploy (5-phase Ερμής pipeline)
bash scripts/deploy.sh production

# PM2 processes
pm2 list  # themisos-web | themisos-api | themisos-worker
```

---

*ΘΕΜΙΣ OS | © MECE.gr | Confidential*
