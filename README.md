# THEMIS OS

Premium AI-native Legal Practice Management Platform for enterprise Greek law firms (20-200 lawyers).

## Vision

The first practice management system that natively understands Greek law, integrates with SOLON e-filing, automates DSA bar stamps, handles myDATA invoicing, and provides AI-powered legal research -- all in one platform.

## Architecture

- **Frontend**: Next.js 16 + React 19 + TypeScript + Tailwind
- **Business API**: Fastify (Node.js/TypeScript) -- matters, billing, clients, calendar
- **AI Orchestrator (Aegis)**: FastAPI (Python) -- legal research, document drafting, deadline calculation
- **Database**: PostgreSQL 16 per tenant (field-level PII encryption)
- **Vector Store**: Qdrant (shared Greek legal corpus + per-tenant private collections)
- **File Storage**: Cloudflare R2 (encrypted at rest)
- **Queue**: BullMQ (Redis-backed)
- **Cache**: Redis

## Key Differentiators

1. Native Greek law AI (24K+ laws, 236K+ articles, 538K+ vectors)
2. SOLON e-filing integration
3. DSA/DST bar stamp automation
4. myDATA AADE native invoicing
5. KPolD deadline calculation engine
6. APED qualified digital signature
7. Greek court database
8. Combined legal research + practice management (no need for 2 systems)

## Documentation

- [Data Model](docs/data-model.md) -- ERD for all 34 modules
- [API Architecture](docs/api-architecture.md) -- Services, endpoints, auth
- [Tech Stack](docs/tech-stack.md) -- Full technology decisions
- [Build Plan](docs/build-plan.md) -- Sprint-by-sprint Phase 1 + Phases 2-4
- [Module Dependencies](docs/module-dependencies.md) -- Dependency graph
- [Aegis Spec](docs/aegis-spec.md) -- AI orchestrator architecture
- [Greek Compliance](docs/greek-compliance.md) -- DSA, myDATA, KPolD, SOLON

## Pricing Target

EUR 89-149/user/month (30-user firm = EUR 32K-54K/year)

## Status

Architecture spec phase. No code yet.
