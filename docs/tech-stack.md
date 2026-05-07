# THEMIS OS -- Tech Stack

## Architecture Philosophy

1. **Separation of concerns**: Business logic (TypeScript) separate from AI layer (Python)
2. **Single-tenant isolation**: Each firm gets dedicated DB + encryption keys
3. **Security-first**: Field-level PII encryption, ethical walls, audit trail, GDPR compliance
4. **Offline-ready shared corpus**: Legal corpus updates pushed periodically, not real-time dependent
5. **Progressive complexity**: Start with core modules, add modules without re-architecture

---

## Frontend

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| Framework | Next.js | 16 | SSR + RSC for SEO + fast initial load, API routes for BFF |
| UI Library | React | 19 | Server components, concurrent features |
| Language | TypeScript | 5.7+ | Type safety across full stack |
| Styling | Tailwind CSS | 4.x | Utility-first, consistent design system |
| Component Library | shadcn/ui | latest | Accessible, customizable, Tailwind-native |
| State Management | Zustand | 5.x | Simple, performant, minimal boilerplate |
| Server State | TanStack Query | 5.x | Caching, revalidation, optimistic updates |
| Forms | React Hook Form + Zod | latest | Validation shared with backend |
| Rich Text Editor | Tiptap | 2.x | Document drafting, template editing |
| PDF Viewer | react-pdf | latest | Document preview in browser |
| Calendar | FullCalendar | 6.x | Hearing calendar, drag-and-drop |
| Charts | Recharts | 2.x | Dashboard analytics |
| Data Tables | TanStack Table | 8.x | Sortable, filterable, virtualizable |
| Date/Time | date-fns | 4.x | Timezone-aware, Greek locale |
| i18n | next-intl | latest | Greek + English, per-tenant |
| Icons | Lucide React | latest | Consistent icon set |

### Frontend Architecture Notes

- **App Router** with route groups per module: `(auth)`, `(dashboard)`, `(matters)`, `(billing)`, etc.
- **Server Components** by default; client components only for interactivity
- **Middleware** for auth check, tenant resolution, locale detection
- **Design tokens** via Tailwind config for per-tenant branding (logo, primary color)
- **Keyboard shortcuts** for power users (Ctrl+T = new timer, Ctrl+M = new matter)

---

## Business API (Backend)

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| Framework | Fastify | 5.x | Fastest Node.js framework, plugin architecture, schema validation |
| Language | TypeScript | 5.7+ | Shared types with frontend |
| ORM | Prisma | 6.x | Type-safe queries, migrations, schema management |
| Validation | Zod | 3.x | Runtime validation, shared schemas with frontend |
| Auth | Custom JWT | -- | jose library for JWT, argon2 for passwords |
| Email | Nodemailer + React Email | latest | Templated transactional emails |
| File Upload | @fastify/multipart | latest | Streaming to R2 |
| Queue | BullMQ | 5.x | Redis-backed job queue |
| Cron | node-cron | latest | Scheduled jobs (reminders, sync, reports) |
| Logging | Pino | 9.x | Structured JSON logging (Fastify built-in) |
| Testing | Vitest + Supertest | latest | Unit + integration tests |
| API Docs | Scalar + OpenAPI | latest | Auto-generated from Fastify schemas |

### Backend Architecture Notes

- **Plugin-based module system**: Each module (clients, matters, billing) is a Fastify plugin
- **Repository pattern**: Data access layer abstracted behind repositories
- **Service layer**: Business logic in service classes, controllers thin
- **Middleware chain**: Auth -> Tenant -> RBAC -> Rate Limit -> Handler
- **Transactions**: Prisma interactive transactions for multi-table writes
- **Soft delete**: All entities use `deleted_at` + query filter middleware

---

## AI Orchestrator (Aegis)

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| Framework | FastAPI | 0.115+ | Async Python, auto-docs, typing |
| Language | Python | 3.12+ | Best ML/AI ecosystem |
| LLM Client | Anthropic SDK | latest | Claude as primary LLM |
| Embeddings | sentence-transformers | latest | Local embedding generation |
| Vector DB Client | qdrant-client | latest | Qdrant SDK |
| DB Client | SQLAlchemy + asyncpg | latest | Async PostgreSQL access |
| PII Detection | presidio (Microsoft) | latest | PII detection + anonymization |
| OCR | pytesseract + pdf2image | latest | Greek OCR for scanned docs |
| PDF Parsing | pdfplumber | latest | Text extraction from PDFs |
| Templating | Jinja2 | latest | Prompt template management |
| Testing | pytest + httpx | latest | Async test client |

### Aegis Architecture Notes

- **Agent framework**: Custom hub-and-spoke (see aegis-spec.md)
- **No direct external access**: All requests proxied through Business API
- **PII pipeline**: Anonymize before LLM call, deanonymize after response
- **Prompt management**: Versioned prompts in `/prompts/` directory, A/B testable
- **Context window management**: Smart chunking for large documents
- **Caching**: Redis cache for repeated research queries (TTL: 24h)

---

## Database

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| Primary DB | PostgreSQL | 16 | JSONB, FTS, partitioning, mature ecosystem |
| Migrations | Prisma Migrate | latest | Schema versioning |
| Connection Pooling | PgBouncer | latest | Connection management for multi-worker setup |
| Backup | pg_dump + WAL archiving | -- | Daily full + continuous WAL |

### Database Architecture Notes

- **Per-tenant database**: Complete isolation (separate DB per firm, not schema-per-tenant)
- **Shared database**: Legal corpus (read-only replicas available to tenants)
- **Partitioning**: `audit_log` partitioned by month; `time_entry` partitioned by year
- **Indexes**: Composite indexes on (tenant_id, status) for all primary tables
- **Full-text search**: PostgreSQL tsvector for document OCR text, client names, matter titles
- **JSONB**: Used for custom_fields, settings, checklist -- queryable with GIN indexes

### Encryption

| Layer | Method | Details |
|-------|--------|---------|
| At rest (disk) | LUKS | Full disk encryption on Hetzner |
| At rest (R2) | AES-256 | Cloudflare R2 server-side encryption |
| In transit | TLS 1.3 | All connections encrypted |
| Field-level PII | AES-256-GCM | Per-tenant key, stored fields marked `[PII]` |
| Key management | HashiCorp Vault (or similar) | Per-tenant encryption keys |
| Backups | GPG | Encrypted backups |

### Field-Level Encryption Implementation

```
Encrypt: plaintext -> AES-256-GCM(key=tenant_key, iv=random_96bit) -> base64(iv + ciphertext + tag)
Decrypt: base64_decode -> split(iv, ciphertext, tag) -> AES-256-GCM-decrypt -> plaintext

Searchable encrypted fields: Use blind index (HMAC-SHA256 of normalized value)
- client.tax_id_blind_index = HMAC(normalize(tax_id), tenant_search_key)
- Allows exact match search without decrypting all records
```

---

## Vector Store

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| Vector DB | Qdrant | latest | Existing infrastructure, hybrid search, filtering |

### Collections

| Collection | Owner | Content | Vectors |
|------------|-------|---------|---------|
| `legal_corpus` | Shared | Greek laws, articles (24K+ laws, 236K+ articles) | 538K+ |
| `case_law` | Shared | Greek jurisprudence (AP, StE, EfAth) | Growing |
| `tenant_{id}_documents` | Per-tenant | Firm's uploaded documents (OCR text) | Variable |

### Search Strategy

1. **Dense search**: Embedding similarity (cosine) via Qdrant
2. **Sparse search**: BM25 via Qdrant (built-in sparse vectors)
3. **PostgreSQL FTS**: tsvector search for exact phrase matching
4. **Reranking**: Claude reranker for final result ordering
5. **Hybrid fusion**: RRF (Reciprocal Rank Fusion) combining dense + sparse results

---

## File Storage

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Object Store | Cloudflare R2 | S3-compatible, no egress fees, encrypted at rest |
| CDN | Cloudflare | Fast delivery for client portal documents |

### Storage Organization

```
{tenant_id}/
  documents/
    {matter_id}/
      {document_id}/{version}/{filename}
  templates/
    {template_id}/{filename}
  invoices/
    {year}/{invoice_id}.pdf
  receipts/
    {expense_id}/{filename}
  exports/
    {report_id}/{filename}
```

### Upload Flow

1. Frontend requests presigned URL from Business API
2. Business API generates R2 presigned PUT URL (5min expiry)
3. Frontend uploads directly to R2 (no proxy through API)
4. On completion, frontend notifies API -> creates document record
5. Worker picks up: OCR processing -> embedding generation -> Qdrant index

---

## Caching

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Application Cache | Redis 7 | API response cache, session store |
| BFF Cache | Next.js cache | ISR for static-ish pages (courts list, templates) |
| AI Cache | Redis | Research query results (24h TTL) |

### Cache Invalidation Strategy

- **Write-through**: On entity update, invalidate related cache keys
- **TTL-based**: Research results (24h), court data (7d), rate cards (1h)
- **Cache keys**: `{tenant_id}:{entity_type}:{entity_id}` or `{tenant_id}:{entity_type}:list:{hash(filters)}`

---

## Monitoring & Observability

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Metrics | Prometheus | System + application metrics |
| Dashboards | Grafana | Visualization |
| Logging | Pino -> Loki | Structured logging, searchable |
| Error Tracking | Sentry | Frontend + backend errors |
| Uptime | Better Uptime (or UptimeRobot) | External health checks |
| APM | OpenTelemetry | Distributed tracing |

### Key Metrics

- API latency (p50, p95, p99) per endpoint
- Queue depth and processing time per queue
- LLM call latency and cost per AI operation
- Active users per tenant
- Document upload/processing throughput
- myDATA transmission success rate

---

## Deployment

| Component | Technology | Notes |
|-----------|-----------|-------|
| Containerization | Docker | Multi-stage builds, minimal images |
| Orchestration | Docker Compose | Per-tenant deployment (1 compose file = 1 firm) |
| Hosting | Hetzner Cloud | CX22 (dev), CX32 (small firm), CX42 (enterprise) |
| Reverse Proxy | nginx | SSL termination, routing, rate limiting |
| TLS | Cloudflare (proxy) + Let's Encrypt (origin) | Edge + origin encryption |
| DNS | Cloudflare | Per-tenant subdomain: `{firm}.themis-os.gr` |
| Process Manager | PM2 (Node.js) + Supervisor (Python) | Process management |
| Secrets | HashiCorp Vault (or encrypted env files for v1) | Secret management |

### Per-Tenant Deployment

```
Docker Compose per tenant:
  - frontend (Next.js)        -> 1 container
  - business-api (Fastify)    -> 1 container
  - aegis (FastAPI)            -> 1 container
  - workers (BullMQ)           -> 1 container
  - postgresql                 -> 1 container (or managed DB for enterprise)
  - redis                      -> 1 container
  
Shared services:
  - qdrant (legal_corpus collection) -> 1 instance serving all tenants
  - nginx -> 1 instance routing to tenant containers
  - monitoring stack -> 1 instance
```

### Sizing Estimates

| Firm Size | CPU | RAM | Storage | Monthly Cost (Hetzner) |
|-----------|-----|-----|---------|----------------------|
| 20 lawyers | 4 vCPU | 8 GB | 80 GB | ~EUR 30-40 |
| 50 lawyers | 8 vCPU | 16 GB | 160 GB | ~EUR 60-80 |
| 100 lawyers | 16 vCPU | 32 GB | 320 GB | ~EUR 120-150 |

---

## CI/CD

| Component | Technology | Notes |
|-----------|-----------|-------|
| Repository | GitHub (private) | Monorepo |
| CI | GitHub Actions | Test, lint, build, security scan |
| Security Scanning | Snyk + Trivy | Dependency + container scanning |
| Code Quality | ESLint + Prettier + Biome | Automated formatting |
| Pre-commit | Husky + lint-staged | Prevent bad commits |
| Staging | Auto-deploy on `develop` branch | Staging tenant for testing |
| Production | Manual approval deploy on `main` | Per-tenant rolling updates |

### CI Pipeline

```
1. Push to branch
2. Lint + Type check (parallel: frontend, business-api)
3. Unit tests (parallel: frontend, business-api, aegis)
4. Integration tests (sequential: requires DB)
5. Build Docker images
6. Security scan (Snyk + Trivy)
7. Push to registry (if main/develop)
8. Deploy to staging (if develop)
9. Manual approval -> Deploy to production (if main)
```

---

## Monorepo Structure

```
themis-os/
├── apps/
│   ├── web/                    # Next.js 16 frontend
│   │   ├── app/                # App Router pages
│   │   ├── components/         # UI components
│   │   ├── lib/                # Utilities
│   │   └── public/             # Static assets
│   ├── api/                    # Fastify business API
│   │   ├── src/
│   │   │   ├── modules/        # Plugin-based modules
│   │   │   │   ├── auth/
│   │   │   │   ├── clients/
│   │   │   │   ├── matters/
│   │   │   │   ├── billing/
│   │   │   │   ├── documents/
│   │   │   │   ├── calendar/
│   │   │   │   ├── intake/
│   │   │   │   ├── conflicts/
│   │   │   │   ├── bar-stamps/
│   │   │   │   ├── mydata/
│   │   │   │   ├── workflows/
│   │   │   │   ├── reports/
│   │   │   │   └── settings/
│   │   │   ├── middleware/     # Auth, RBAC, rate limit, audit
│   │   │   ├── services/       # Business logic
│   │   │   ├── repositories/   # Data access
│   │   │   └── plugins/        # Fastify plugins
│   │   └── prisma/             # Schema + migrations
│   ├── aegis/                  # FastAPI AI orchestrator
│   │   ├── agents/             # AI agent definitions
│   │   ├── prompts/            # Versioned prompt templates
│   │   ├── services/           # AI services
│   │   ├── pipeline/           # PII anonymization pipeline
│   │   └── models/             # Pydantic models
│   └── workers/                # BullMQ worker processes
│       ├── email/
│       ├── mydata/
│       ├── ocr/
│       ├── embeddings/
│       └── reminders/
├── packages/
│   ├── shared/                 # Shared TypeScript types, Zod schemas
│   ├── db/                     # Prisma client package
│   └── ui/                     # Shared UI components (if needed)
├── docker/
│   ├── Dockerfile.web
│   ├── Dockerfile.api
│   ├── Dockerfile.aegis
│   ├── Dockerfile.workers
│   └── docker-compose.yml      # Development
├── deploy/
│   ├── docker-compose.tenant.yml  # Per-tenant template
│   ├── nginx/                     # nginx configs
│   └── scripts/                   # Deploy scripts
├── docs/                       # Architecture docs (this folder)
├── turbo.json                  # Turborepo config
├── package.json                # Root workspace
└── .github/
    └── workflows/              # CI/CD pipelines
```

---

## Key Technical Decisions Log

| Decision | Choice | Alternative Considered | Why |
|----------|--------|----------------------|-----|
| Single-tenant DB | 1 PostgreSQL per firm | Schema-per-tenant | Maximum isolation for attorney-client privilege + GDPR |
| Fastify over Express | Fastify 5 | Express, NestJS, Hono | Performance, schema validation, plugin architecture |
| FastAPI for AI | Python FastAPI | Node.js for everything | Python ML ecosystem (presidio, sentence-transformers, pytesseract) |
| Prisma ORM | Prisma 6 | Drizzle, Knex, raw SQL | Type safety, migration management, developer experience |
| Qdrant over Pinecone | Qdrant self-hosted | Pinecone, Weaviate, Milvus | Already in infrastructure, open-source, hybrid search |
| R2 over S3 | Cloudflare R2 | AWS S3, MinIO | No egress fees, existing Cloudflare infrastructure |
| BullMQ over Temporal | BullMQ | Temporal, RabbitMQ | Simpler for current needs, Redis already required for cache |
| Docker Compose over K8s | Docker Compose | Kubernetes | Overkill for per-tenant single-server deployments at current scale |
| Monorepo | Turborepo | Separate repos | Shared types, atomic deployments, consistent tooling |
