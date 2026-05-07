# ΘΕΜΙΣ OS — API Architecture v0.3

**Spec version:** v0.3 (2026-04-29)
**Author:** Δαίδαλος (Master Coding Architect)
**Predecessor:** v0.2 (2026-04-28, ~250 endpoints across 24 modules + 11 Aegis agents)
**Status:** PROPOSED — awaits Niko sign-off
**Driver:** Sunday §2.B (REST namespace cleanup) + §2.C (drop FastAPI) + Pericles §6 (single-stack consolidation)
**Naming neutrality:** Product name resolved από `process.env.PRODUCT_NAME` (default "ΘΕΜΙΣ OS"). API base path `/api/v1` invariant.

---

## 0. DECISIONS TABLE (τι αλλάζει vs v0.2)

| # | v0.2 | v0.3 | Driver | Aristotle ID |
|---|------|------|--------|--------------|
| D-API-1 | `/api/v1/clients` namespace με 13 endpoints | **KILLED.** All client operations via `/api/v1/parties?role=client` | Sunday §2.B + Aristotle L1 | L1 |
| D-API-2 | `/clients/*` returns 308 redirect | **301 redirect για 6 μήνες, μετά 410 Gone** με sunset header `X-Themis-Sunset: 2026-10-29` | Sunday §2.B | L1 |
| D-API-3 | Separate FastAPI service (Aegis :8000) + Fastify (:4000) | **Single Fastify monolith** με `@themis/aegis` plugin | Sunday §2.C + Pericles §6 | L9 |
| D-API-4 | Separate Portal API (:4010) + Portal Frontend (:3010) | **Phase 1: NO portal. Phase 1.5 (Sprint 11-12): read-only portal as Next.js route group `/p/*`** with separate JWT signing key | Sunday §2.G | — |
| D-API-5 | 25 modules + 8 AI agents Phase 1 | **14 modules + 4 AI agents Phase 1** | Sunday §2.G + Pericles §2 | — |
| D-API-6 | JWT carries no `tid` (DB-per-tenant assumed) | **JWT carries `firm` claim (UUID)** για shared-tier subdomain resolution + `search_path` setting | v0.3 schema-per-tenant | L2 |
| D-API-7 | Tenant resolution από hostname only | **Subdomain `<slug>.themis.gr` → middleware → JWT validation → schema selection** | Two-tier infra | L2 |
| D-API-8 | Rate limit: standard 120/min, portal 60/min | **Per-tier rate limit:** Starter 60/min, Pro 120/min, Firm 300/min, Enterprise 600/min | Sunday §4 pricing | — |
| D-API-9 | Idempotency optional | **Required για all POST που έχουν side effects σε external systems** (myDATA, payments) | Aristotle F8 | F8 |
| D-API-10 | Error envelope inconsistent | **Standardized error envelope** με `code`, `message`, `details`, `trace_id` | Polish | — |
| D-API-11 | Webhook events: 30+ | **Phase 1: 12 essential events**, υπόλοιπα Phase 1.5 | Scope cut | — |
| D-API-12 | BullMQ queues: 17 | **Phase 1: 7 queues** (mydata, ocr, embeddings, reminders, ai, audit, webhooks). Υπόλοιπα Phase 1.5 | Scope cut | — |
| D-API-13 | Single `privilege_tag` field σε document API | **`/documents/:id/privilege` resource** (GET/PUT/DELETE) backing `document_privilege` table | D-DM-16, D-DM-19 | E9 |
| D-API-14 | No privilege-specific endpoints | **`/documents/:id/access-log` + `/audit/privilege-access`** για forensic queries | D-DM-18 | F3 |
| D-API-15 | KMS opaque to API | **`/admin/kms/*` endpoints** για rotation, BYOK setup, Shamir custody mgmt (Enterprise) | D-DM-17 | F3 |
| D-API-16 | Aegis blindly searches all docs | **Aegis MUST query `document_privilege.ai_context_eligible`**; new `403 AI_PRIVILEGE_BLOCKED` if violated | D-DM-19, Invariant #9 | E9 |
| D-API-17 | BullMQ Phase 1 queues = 7 | **8 queues** (+`kms-rotation` for §8.7 background re-encryption) | D-DM-17 | F3 |

---

## 1. SERVICE TOPOLOGY (v0.3)

```
                    +-----------------+
                    |   Cloudflare    |
                    |   (CDN + WAF +  |
                    |    DDoS)        |
                    +--------+--------+
                             |
                    +--------+--------+
                    |     nginx       |
                    |  (TLS, routing) |
                    +--------+--------+
                             |
                    +--------+--------+
                    |   Next.js 16    |
                    |   (App Router)  |
                    |   :3000         |
                    |                 |
                    | + RSC + BFF     |
                    | + /p/* portal   |
                    |   route group   |
                    |   (Phase 1.5)   |
                    +--------+--------+
                             |
                    +--------+--------+
                    |    Fastify      |
                    |    :4000        |
                    |                 |
                    | + REST API      |
                    | + @themis/aegis |
                    |   (TS plugin)   |
                    | + BullMQ disp.  |
                    +--------+--------+
                             |
       +---------+-----------+--------+----------+----------+
       |         |                    |          |          |
   +---+----+ +-+---------+   +------+----+  +--+-----+  +--+-----+
   |Postgres| |   Redis   |   |  Qdrant   |  |   R2   |  | KMS    |
   |  17    | |  (cache + |   |  PC node  |  | EU     |  |Hetzner |
   | shared | |  BullMQ)  |   |10.0.0.10  |  |        |  |        |
   |+ ded.  | |           |   |           |  |        |  |        |
   +--------+ +-----------+   +-----------+  +--------+  +--------+
```

**Differences vs v0.2:**
- DROP FastAPI Aegis :8000 → Aegis becomes Fastify plugin (`@themis/aegis`)
- DROP Portal Frontend :3010 + Portal API :4010 → Phase 1.5 portal lives in same Next.js as `/p/*` route group με separate JWT
- Single Postgres cluster για shared tier, dedicated DB instances για Firm+
- Redis = cache + BullMQ backend (single instance Phase 1)
- Qdrant on PC node 10.0.0.10 (existing infrastructure, shared με legal-platform)

### Services

| Service | Runtime | Port | Responsibility |
|---------|---------|------|---------------|
| **Frontend + Portal** | Next.js 16 | 3000 | App Router SSR, RSC, mobile-first UI, BFF routes, `/p/*` portal subpath |
| **API + Aegis** | Fastify (Node.js/TS) | 4000 | REST API, business logic, AI orchestration, queue dispatch |
| **Workers** | BullMQ (Node.js/TS) | — | Async jobs |
| **PostgreSQL** | Postgres 17 | 5432 | `themis_shared` cluster + per-firm dedicated DBs |
| **Redis** | Redis 7 | 6379 | Cache, sessions, BullMQ |
| **Qdrant** | Qdrant 1.10+ | 6333 (PC) | Vector search (per-firm collection + shared corpus) |
| **R2** | Cloudflare R2 EU | — | Encrypted file storage |

---

## 2. AUTHENTICATION & TENANT RESOLUTION

### 2.1 Tenant resolution flow

```
1. Request comes to https://<slug>.themis.gr/api/v1/...
2. nginx proxies to Next.js → Fastify
3. Fastify hook `resolveTenant`:
   a. Parse subdomain from Host header
   b. Lookup public.tenant_registry WHERE slug = <slug>
   c. If not found → 404 TENANT_NOT_FOUND
   d. If found → set request.firm_uuid, request.tier, request.schema_name
4. Fastify hook `setSearchPath`:
   a. SET LOCAL search_path = <schema_name>, public
   b. SET LOCAL app.firm_uuid = <firm_uuid>  -- για RLS
5. Auth middleware validates JWT
6. Route handler executes
```

### 2.2 JWT Payload (firm users)

```json
{
  "sub": "user_uuid",
  "firm": "firm_uuid",
  "firm_slug": "papadopoulos-law",
  "tier": "professional",
  "role": "partner",
  "permissions": ["matter:*", "party:*", "invoice:create,read,approve"],
  "iat": 1714300000,
  "exp": 1714300900,
  "jti": "token_uuid"
}
```

> **`firm` claim restored σε v0.3** για shared tier subdomain validation. Token issued by single auth service that validates against `<slug>` subdomain.

### 2.3 Auth flow

```
POST /api/v1/auth/login
  Body: {email, password}
  Response: {access_token, refresh_token (httpOnly cookie), user, mfa_required?}

POST /api/v1/auth/mfa/verify
  Body: {mfa_session_token, code}
  Response: {access_token, refresh_token}

POST /api/v1/auth/refresh
  (httpOnly cookie present)
  Response: {access_token, new_refresh_token}

POST /api/v1/auth/logout
  Invalidates session
```

**MFA:** WebAuthn primary (passkey), TOTP fallback. Required for `partner`, `admin` roles. Optional για `associate`, `paralegal`, `secretary`.

### 2.4 RBAC (Phase 1, 4 built-in roles)

```
admin:        *:*:all
partner:      most:*:all + settings:update + invoice:approve:all
associate:    most:crud:own + matter:read:department + invoice:create:own
paralegal:    limited crud:own + document:*:department
secretary:    calendar:*, communication:*, task:crud:department
```

> **Phase 1 = 4 roles.** Phase 1.5 expands to 7 (Firm tier): managing_partner, partner, senior_associate, associate, paralegal, secretary, accountant.

---

## 3. REST API ENDPOINTS — PHASE 1 (14 MODULES)

### Conventions

- Base URL: `/api/v1/`
- Plural nouns, kebab-case
- Pagination: `?page=1&per_page=25` (max 100)
- Sorting: `?sort=created_at&order=desc`
- Filtering: `?status=active&role=client`
- Includes: `?include=parties,members`
- Idempotency: `Idempotency-Key` header REQUIRED for myDATA transmit, payment create
- Response envelope: bare object για success, error envelope για errors

### 3.1 Auth (8 endpoints)

```
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/refresh
POST   /api/v1/auth/mfa/setup
POST   /api/v1/auth/mfa/verify
POST   /api/v1/auth/password/reset-request
POST   /api/v1/auth/password/reset
GET    /api/v1/auth/me
```

### 3.2 Parties — Unified Party Model (12 endpoints)

> **v0.3 critical fix (Sunday §2.B + Aristotle L1):** No `/clients` namespace. All persons/orgs (clients, opposing parties, suppliers, witnesses, attorneys) live here. Filter με `?role=client`.

```
GET    /api/v1/parties                          # List, supports ?role=client&status=active
POST   /api/v1/parties                          # Create
GET    /api/v1/parties/:id                      # Read (currently-active roles included)
PUT    /api/v1/parties/:id
DELETE /api/v1/parties/:id                      # Soft delete

GET    /api/v1/parties/:id/roles                # Time-bounded role history
POST   /api/v1/parties/:id/roles                # Add role
PATCH  /api/v1/parties/:id/roles/:roleId        # Set active_until (deactivate)

GET    /api/v1/parties/:id/matters              # Matters this party is in (any role)
GET    /api/v1/parties/:id/financial-summary    # Balance, WIP, only if currently-active client role
GET    /api/v1/parties/:id/conflicts            # Conflicts where this party appears
POST   /api/v1/parties/:id/conflict-check       # Manual run
```

### 3.2.1 Backwards compatibility (`/clients` deprecation)

```
GET    /api/v1/clients                  → 301 to /api/v1/parties?role=client
GET    /api/v1/clients/:id              → 301 to /api/v1/parties/:id
GET    /api/v1/clients/:id/matters      → 301 to /api/v1/parties/:id/matters
GET    /api/v1/clients/:id/contacts     → 301 to /api/v1/parties/:id (contacts are inline JSONB)
GET    /api/v1/clients/:id/invoices     → 301 to /api/v1/parties/:id/financial-summary
```

**Deprecation lifecycle:**
- Sprint 1-12 (Phase 1): 301 redirects με headers:
  - `X-Themis-Deprecated: true`
  - `X-Themis-Sunset: 2026-10-29`
  - `Warning: 299 - "Deprecated. Migrate to /parties?role=client by 2026-10-29"`
- 2026-10-29 onwards: **410 Gone** με body explaining migration

> Aristotle L1 question "What happens when party_role(client) expires? 200 or 404?" — **Answer:** `GET /parties/:id?role=client` returns 200 με `active_role: false` flag. `GET /parties/:id` returns full record always. The client_role expiry is a **state**, not an existence question.

### 3.3 Matters (12 endpoints)

```
GET    /api/v1/matters
POST   /api/v1/matters                          # Triggers conflict check
GET    /api/v1/matters/:id                      # ?include=parties,members
PUT    /api/v1/matters/:id
DELETE /api/v1/matters/:id                      # Soft delete; blocked if billed

GET    /api/v1/matters/:id/parties              # Returns matter_party rows
POST   /api/v1/matters/:id/parties              # Add party with role+side
PATCH  /api/v1/matters/:id/parties/:mpId        # Update role/side/billing_split
DELETE /api/v1/matters/:id/parties/:mpId        # Remove (sets left_at)

GET    /api/v1/matters/:id/members
POST   /api/v1/matters/:id/members
GET    /api/v1/matters/:id/timeline
```

### 3.4 Calendar & Hearings & Deadlines (10 endpoints)

```
GET    /api/v1/calendar/events
POST   /api/v1/calendar/events
PATCH  /api/v1/calendar/events/:id
DELETE /api/v1/calendar/events/:id

GET    /api/v1/hearings
POST   /api/v1/hearings
PATCH  /api/v1/hearings/:id
POST   /api/v1/hearings/:id/outcome
GET    /api/v1/hearings/daily-list              # PDF "ΗΜΕΡΗΣΙΑ ΔΙΚΑΣΙΜΟΣ"

GET    /api/v1/deadlines
POST   /api/v1/deadlines
PATCH  /api/v1/deadlines/:id
POST   /api/v1/deadlines/:id/complete

GET    /api/v1/deadline-rules                   # Read-only Phase 1 (top 30 KPolD)
POST   /api/v1/deadline-rules/calculate         # Engine endpoint
```

### 3.5 Documents & Templates (10 endpoints)

```
GET    /api/v1/documents
POST   /api/v1/documents/upload                 # Multipart → R2 presigned URL
GET    /api/v1/documents/:id
GET    /api/v1/documents/:id/download           # Signed R2 URL, 5min TTL
PATCH  /api/v1/documents/:id
DELETE /api/v1/documents/:id                    # Blocked if legal_hold

GET    /api/v1/documents/:id/versions
POST   /api/v1/documents/:id/versions

GET    /api/v1/document-templates               # 5 system templates Phase 1
POST   /api/v1/document-templates/:id/generate  # Merge variables → DOCX/PDF
```

### 3.6 Time & Billing (12 endpoints)

```
GET    /api/v1/time-entries
POST   /api/v1/time-entries
PATCH  /api/v1/time-entries/:id
DELETE /api/v1/time-entries/:id                 # Only if not billed
POST   /api/v1/time-entries/bulk

GET    /api/v1/timers
POST   /api/v1/timers/start                     # Auto-pauses other active timers (Aristotle E16)
POST   /api/v1/timers/:id/pause
POST   /api/v1/timers/:id/resume
POST   /api/v1/timers/:id/stop                  # Creates time_entry

GET    /api/v1/rate-cards
POST   /api/v1/rate-cards
GET    /api/v1/rate-cards/resolve               # ?user_id=&matter_id=
```

### 3.7 Invoicing & Payments (8 endpoints)

```
GET    /api/v1/invoices
POST   /api/v1/invoices                         # From time_entries + expenses
GET    /api/v1/invoices/:id
PATCH  /api/v1/invoices/:id                     # Only if draft
POST   /api/v1/invoices/:id/approve             # Single-approver Phase 1
POST   /api/v1/invoices/:id/finalize
GET    /api/v1/invoices/:id/pdf

POST   /api/v1/invoices/:id/mydata/transmit     # Idempotency-Key REQUIRED
GET    /api/v1/invoices/:id/mydata/status

POST   /api/v1/payments                         # Idempotency-Key REQUIRED
GET    /api/v1/payments/:id
```

### 3.8 Bar Stamps (4 endpoints)

```
GET    /api/v1/bar-stamps
POST   /api/v1/bar-stamps
POST   /api/v1/bar-stamps/calculate             # ΔΣΑ Γραμμάτιο calc από fee
GET    /api/v1/bar-stamps/report                # Monthly/annual export
```

### 3.9 Conflict Check (4 endpoints)

```
POST   /api/v1/conflict-checks
GET    /api/v1/conflict-checks/:id
POST   /api/v1/conflict-checks/:id/waive
GET    /api/v1/conflict-checks/history
```

### 3.10 Aegis AI (4 agents Phase 1, 8 endpoints)

> **v0.3 simplification (Sunday §2.C):** Aegis lives σε Fastify ως plugin. No separate FastAPI service. Internal calls only — frontend calls these via Business API proxy.

```
# Συγγράμματος (Drafting) — Sonnet
POST   /api/v1/aegis/drafting/exodiko            # Generate εξώδικο draft
POST   /api/v1/aegis/drafting/agogi               # Generate αγωγή draft
POST   /api/v1/aegis/drafting/template            # Generic template fill

# Προθεσμίας (Deadline Extractor) — Haiku
POST   /api/v1/aegis/deadlines/extract            # OCR'd court doc → suggested ΚΠολΔ deadline

# Ερευνητικός (Legal Research) — Sonnet
POST   /api/v1/aegis/research/query               # NL question → Greek corpus answer με citations
POST   /api/v1/aegis/research/case-law            # ΑΠ jurisprudence search

# Αναγνώστης (OCR + PII) — Haiku + Tesseract
POST   /api/v1/aegis/ocr/extract                  # Document → text + entities (auto-triggered on upload)
POST   /api/v1/aegis/pii/anonymize                # Internal: pre-LLM anonymization (called by other agents)
```

**Citation validator (Aristotle Top-10 fix #4):** Every response από `drafting/*` και `research/*` includes `citations[]`. Each citation cross-checked against `case_law` table. Invalid citations marked `valid: false`, mandatory red banner στο UI.

### 3.11 Settings (6 endpoints)

```
GET    /api/v1/settings/firm
PUT    /api/v1/settings/firm
GET    /api/v1/settings/courts                  # Read-only seed
GET    /api/v1/settings/efka-rates              # Editable, annual reminder
PUT    /api/v1/settings/efka-rates
GET    /api/v1/settings/users
POST   /api/v1/settings/users
PATCH  /api/v1/settings/users/:id
```

### 3.12 Reports (3 hardcoded dashboards Phase 1, 3 endpoints)

```
GET    /api/v1/reports/financial-summary
GET    /api/v1/reports/matter-status
GET    /api/v1/reports/bar-stamps
```

> Phase 2 adds custom dashboards + saved queries. Phase 3 adds NL→SQL (Απολογιστής agent).

### 3.13 Audit Log (1 endpoint, admin-only)

```
GET    /api/v1/audit-log                        # ?actor_id=&resource_type=&date_range=
```

### 3.14 Webhooks (2 endpoints)

```
POST   /api/v1/webhooks                         # Register
DELETE /api/v1/webhooks/:id
```

### 3.15 Privilege & Document Access Control (NEW v0.3 — 9 endpoints)

> **Driver:** D-API-13, D-API-14, D-DM-16..19. Backs §8 Privilege Architecture στο data-model-v03.md. Phase 1 ships full CRUD; Phase 1.5 adds team-scoped privilege.

#### 3.15.1 Document privilege (5 endpoints)

```
GET    /api/v1/documents/:id/privilege          # Read current privilege state (tag, ACL, classification basis, review status)
PUT    /api/v1/documents/:id/privilege          # Set/update privilege (triggers DDK wrap if transitioning none→privileged)
DELETE /api/v1/documents/:id/privilege          # Reset to tag='none' (REQUIRES partner role + audit reason)
POST   /api/v1/documents/:id/privilege/review   # Approve AI-inferred privilege (clears review_required)
POST   /api/v1/documents/:id/privilege/share    # Add user/party to visible_to_* (requires owner role)
```

**`PUT /api/v1/documents/:id/privilege` request body:**
```json
{
  "tag": "attorney_client | work_product | joint_defense | common_interest | mediation_privileged | none",
  "classification_basis": "manual | ai_inferred | template_default",
  "visible_to_party_ids": ["uuid", ...] | null,
  "visible_to_user_ids": ["uuid", ...] | null,
  "visible_to_team_ids": ["uuid", ...] | null,
  "ai_context_eligible": false,
  "review_required": false,
  "reason": "Privilege upgrade — partner-only memo about settlement strategy"
}
```

**Response 200:**
```json
{
  "document_id": "uuid",
  "privilege": { ...full state... },
  "ddk_rewrapped": true,
  "audit_id": "uuid"
}
```

**Behavior notes:**
- Transition `none → privileged`: server generates DDK, encrypts content (re-uploads to R2), wraps DDK με tier-appropriate key
- Transition `privileged → none`: REQUIRES partner role + reason; audit row mandatory; DDK destroyed; content re-uploaded με R2 SSE-C
- Transition `privileged → privileged (different tag)`: no re-encryption needed; only metadata + ACL update
- Setting `ai_context_eligible=true` while `tag != 'none' AND classification_basis='ai_inferred'` REQUIRES `review_required=false` AND human approval audit

#### 3.15.2 Privilege access log (2 endpoints)

```
GET    /api/v1/documents/:id/access-log         # Per-document forensic trail. Partner+ only.
                                                # ?from=&to=&accessor_type=&outcome=
GET    /api/v1/audit/privilege-access           # Firm-wide forensic query. Admin+ only.
                                                # ?document_id=&accessor_user_id=&outcome=denied_*&matter_id=
```

**Response 200 (per-document):**
```json
{
  "document_id": "uuid",
  "total_accesses": 47,
  "denied_attempts": 3,
  "entries": [
    {
      "id": "uuid_v7",
      "timestamp": "2026-04-29T10:15:32Z",
      "accessor_user_id": "uuid",
      "accessor_email": "associate@firm.gr",
      "accessor_type": "user",
      "access_method": "download",
      "access_outcome": "granted",
      "ddk_unwrap_performed": true,
      "ip_address": "94.65.x.x",
      "trace_id": "01HQXX..."
    },
    ...
  ],
  "subpoena_export_url": null
}
```

**Subpoena export:** `POST /api/v1/audit/privilege-access/export` (admin only, async via BullMQ) — generates signed PDF + JSON manifest με full chain για legal disclosure. Greek notary timestamping optional (Enterprise). Audit row για export action itself.

#### 3.15.3 KMS administration (2 endpoints, admin only)

```
POST   /api/v1/admin/kms/rotate-dek             # Trigger DEK rotation. Async (BullMQ kms-rotation queue).
                                                # Body: {reason: 'scheduled' | 'compromise' | 'tier_change'}
GET    /api/v1/admin/kms/rotation-status        # Latest rotation job status, progress, ETA
```

**Phase 1.5 Enterprise BYOK additions:**
```
POST   /api/v1/admin/kms/byok/initialize        # Enterprise opt-in flow, returns Shamir setup wizard URL
GET    /api/v1/admin/kms/byok/custody-shares    # List share holders + revocation status
POST   /api/v1/admin/kms/byok/custody-shares/:idx/revoke
POST   /api/v1/admin/kms/byok/recovery-drill    # Quarterly drill, tracks last_recovery_drill_at
```

**Phase 1 ships:** `rotate-dek` + `rotation-status` only. BYOK endpoints stub-return `501 Not Implemented` με sunset header `X-Themis-Available: 2026-Q3`.

---

## 4. PHASE 1.5 ADDITIONS (Sprint 11-12 + 13-18)

| Module | Sprint | Endpoints |
|--------|--------|-----------|
| Client Portal lite (read-only) | 11-12 | `/api/v1/portal/*` (separate JWT signing key, tighter rate limit) |
| Email forwarder | 7-8 (φτάνει σε Phase 1) | `matter-{code}@<slug>.themis.gr` → BullMQ → auto-attach |
| ΑΠΕΔ link (manual) | Phase 1 | UI button → `portal.olomeleia.gr` (no API integration) |
| SOLON wrapper | 14 | `/api/v1/solon/filings/*` |
| Email auto-classify | 15 | `/api/v1/email/*` + Ταχυδρόμος agent |
| Trust accounting | 17 | `/api/v1/trust-accounts/*` (Firm tier only) |
| Multi-tier approval | 18 | `/api/v1/invoices/:id/approval-chain/*` |

---

## 5. ERROR ENVELOPE

### Standard error response

```json
{
  "error": {
    "code": "MATTER_NOT_FOUND",
    "message": "Matter με ID xyz δεν βρέθηκε",
    "message_en": "Matter with ID xyz not found",
    "status": 404,
    "details": {},
    "trace_id": "01HQXX...",
    "timestamp": "2026-04-29T08:30:00Z"
  }
}
```

### HTTP status codes

| Code | Meaning |
|------|---------|
| 400 | Validation error (field-level details) |
| 401 | Authentication required |
| 403 | Insufficient permissions, ethical wall, privilege violation |
| 404 | Resource not found |
| 409 | Conflict (duplicate party, idempotency-key reuse) |
| 410 | Gone (deprecated endpoint after sunset) |
| 422 | Business rule violation (delete blocked, billing split != 100) |
| 423 | Locked (legal_hold, finalized invoice) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 502 | Upstream error (myDATA, Stripe, Anthropic) |
| 503 | Upstream unavailable (degrades gracefully — Invariant #5) |

### v0.3-specific error codes

```
TENANT_NOT_FOUND               (404) Subdomain not registered
TENANT_SUSPENDED               (403) Firm suspended (billing issue)
TENANT_MIGRATING               (503) Migration in progress, retry after window
BILLING_SPLIT_INVALID          (422) Sum != 100 (DB trigger raised)
PRIMARY_CONTACT_CONFLICT       (422) Another primary already exists for this side
ATTORNEY_REQUIRED              (422) representing_counsel_party_id must reference is_attorney=true
MYDATA_DUPLICATE               (409) Same content_hash already transmitted
PAYMENT_IDEMPOTENCY_REUSED     (409) Same Idempotency-Key, different body
AI_DRAFT_CITATION_INVALID      (422) AI output contains fictional case citation, blocked
AI_UNAVAILABLE                 (503) Aegis circuit breaker open
AI_PRIVILEGE_BLOCKED           (403) Aegis attempted to include privileged doc — blocked, audit row written
DEADLINE_RULE_NOT_VALIDATED    (422) Cannot use deadline_rule without attorney sign-off
GDPR_ERASURE_BLOCKED           (422) Active retention obligation prevents erasure
PRIVILEGE_ACL_DENIED           (403) User not in document_privilege.visible_to_* lists
PRIVILEGE_REVIEW_PENDING       (403) AI-inferred privilege awaits human review
PRIVILEGE_KEY_UNAVAILABLE      (503) DDK unwrap failed — key rotation in progress or tier-downgrade lockout
PORTAL_PRIVILEGE_BLOCKED       (403) Portal user attempted privileged doc — never permitted
KMS_ROTATION_IN_PROGRESS       (409) Cannot start new rotation while one is running
BYOK_NOT_INITIALIZED           (412) Enterprise endpoint called before BYOK setup complete
SHAMIR_QUORUM_NOT_MET          (403) Reconstruction attempted with <3 shares
```

---

## 6. RATE LIMITING (per tier)

| Tier | req/min | Burst | Notes |
|------|---------|-------|-------|
| Starter | 60 | 15 | Solo |
| Professional | 120 | 30 | 2-8 users |
| Firm | 300 | 60 | 8-15 users |
| Enterprise | 600 | 120 | Custom SLA |
| Portal user (Phase 1.5) | 60 | 15 | Aggressive |
| Portal auth | 10 | 3 | Brute-force protection |
| Aegis (internal) | 1000 | 200 | Service-to-service |
| Webhook delivery | 60 | 10 | Outbound |

Implementation: Redis sliding window. Counter namespace: `ratelimit:{firm_uuid}:{user_id}:{minute}`.

---

## 7. WEBHOOKS — PHASE 1 EVENTS (15)

```
party.created
party.updated

matter.created
matter.stage_changed
matter.closed

invoice.created
invoice.finalized
invoice.paid

deadline.approaching      # 7d, 1d before
deadline.expired

hearing.scheduled
hearing.outcome_recorded

# NEW v0.3 — privilege events
document.privilege_changed       # tag transition (none↔privileged or privileged↔different tag)
document.privilege_access_denied # forensic alert; HIGH severity if accessor_user is partner
kms.rotation_completed           # DEK rotation finished (admin notification)
```

**Phase 1.5 adds:** SOLON, ΑΠΕΔ, trust, email events + BYOK events (`byok.share_revoked`, `byok.recovery_drill_due`, `byok.quorum_reconstruction_logged`) — ~28 more.

### Delivery

- HTTP POST, JSON body
- HMAC-SHA256 signature σε `X-Themis-Signature`
- 3 retries (exponential backoff: 1m, 5m, 30m)
- 10s timeout per attempt
- Webhook logs retained 30 days

---

## 8. BACKGROUND QUEUES — PHASE 1 (8 queues)

| Queue | Workers | Purpose |
|-------|---------|---------|
| `mydata` | 1 | AADE myDATA transmissions (rate-limited) |
| `ocr` | 2 | Document OCR (Tesseract Greek) |
| `embeddings` | 2 | Document vectorization → Qdrant |
| `reminders` | 1 | Scheduled deadline/calendar reminders + EFKA rate annual reminder |
| `ai` | 3 | Aegis async work (drafting, research) |
| `audit` | 1 | Async audit log writes (buffer για performance) |
| `webhooks` | 2 | Outbound delivery + retries |
| `kms-rotation` | 1 | NEW v0.3 — DEK rotation re-encryption (long-running, low priority). Throttled to ≤1000 rows/sec to avoid impacting OLTP |

**Phase 1.5 adds:** `solon`, `aped`, `email-fetch`, `email-classify`, `portal-notify`, `trust-recon`, `byok-shamir-recovery`.

---

## 9. IDEMPOTENCY POLICY

### Required for

```
POST /api/v1/invoices/:id/mydata/transmit
POST /api/v1/payments
POST /api/v1/portal/payments/pay-intent       (Phase 1.5)
POST /api/v1/solon/filings/:id/submit         (Phase 1.5)
POST /api/v1/aped/signature-requests          (Phase 1.5)
```

### Behavior

```
First request με key K:
  Process, store (key, response, hash(body)) for 24h in Redis

Repeat με K + same body:
  Return stored response, status 200 + X-Themis-Idempotent-Replay: true

Repeat με K + different body:
  Return 409 PAYMENT_IDEMPOTENCY_REUSED
```

---

## 10. AUDIT LOGGING

Every state-changing call appends to `firm_X.audit_log`:

```json
{
  "id": "uuid_v7",
  "timestamp": "2026-04-29T08:30:00Z",
  "actor_id": "user_uuid",
  "actor_type": "user|system|aegis|scheduled_job",
  "action": "create|update|delete|export|login|...",
  "resource_type": "matter|invoice|...",
  "resource_id": "uuid",
  "changes": "<envelope-encrypted JSONB>",
  "changes_summary": "redacted summary για admin UI",
  "ip_address": "...",
  "user_agent": "...",
  "outcome": "success|denied|error",
  "trace_id": "01HQXX..."
}
```

**Particularly sensitive flows write enriched logs:**
- myDATA transmissions: include `mark`, `content_hash`
- ΑΠΕΔ signings (Phase 1.5): signer cert thumbprint
- Login attempts: failed attempts also logged
- Portal access (Phase 1.5): `allowed_matters` subset hit

**Retention:** see data-model-v03.md §3.9.

---

## 11. NAMING NEUTRALITY (rename-friendly)

```typescript
// /apps/api/src/config.ts
export const PRODUCT_NAME = process.env.PRODUCT_NAME || 'ΘΕΜΙΣ OS';
export const PRODUCT_SLUG = process.env.PRODUCT_SLUG || 'themis-os';
export const PRIMARY_DOMAIN = process.env.PRIMARY_DOMAIN || 'themis.gr';
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@themis.gr';
```

**Hardcoded references audit:**
- API routes: `/api/v1/*` (no product name)
- DB schemas: `firm_<slug>` (no product name)
- Subdomain pattern: `{slug}.{PRIMARY_DOMAIN}` (configurable)
- JWT issuer: `${PRODUCT_SLUG}-auth` (configurable)
- Email sender: `noreply@{PRIMARY_DOMAIN}` (configurable)
- Webhook signature header: `X-{PRODUCT_SLUG}-Signature` (configurable)

**Rename effort estimate:** ~2 hours total (env var change + nginx reload + DNS + Stripe customer update). Code untouched.

---

## 12. OPEN QUESTIONS FOR NIKO/SUNDAY

1. **Q-API-1: Subdomain vs path-based tenant routing.** Subdomain `<slug>.themis.gr` requires wildcard SSL + DNS API automation. Path-based `themis.gr/<slug>/...` is simpler αλλά exposes slug σε URLs. Subdomain is cleaner για clients.
   **Δαίδαλος recommendation:** Subdomain. Wildcard cert + Cloudflare API automation set up Sprint 1. ~2-day effort.

2. **Q-API-2: Portal route group vs separate Next.js app.** Phase 1.5 portal lives σε `/p/*` route group ή separate `portal.themis.gr` deployment;
   **Δαίδαλος recommendation:** Same Next.js, route group `/p/*`. Separate JWT signing key + middleware enforcement. Simpler ops, lower cost. Migrate σε separate deployment μόνο αν portal traffic > 30% του total.

3. **Q-API-3: Aegis as Fastify plugin vs separate Fastify service.** Single binary makes deploy simpler αλλά couples AI failures με business API restarts. Separate Fastify (different process) gives isolation χωρίς FastAPI overhead.
   **Δαίδαλος recommendation:** Single binary Phase 1 (simpler ops, lower cost). Split σε separate Fastify process Phase 2 αν AI restart frequency becomes an issue.

4. **Q-API-4: 6-month deprecation window για `/clients`.** Φαίνεται γενναιόδωρο για greenfield project (κανένας πελάτης ακόμα). Μπορούμε να ξεκινήσουμε mε 410 Gone από Day 1;
   **Δαίδαλος recommendation:** YES — greenfield. Skip 301 redirects. `/clients/*` returns 410 από Sprint 1 με body `{"error": {"code": "ENDPOINT_DELETED", "message": "Use /api/v1/parties?role=client"}}`. Simpler.

5. **Q-API-5: WebAuthn passkeys.** Modern, secure, αλλά Greek attorneys 50+ ίσως δυσκολεύονται. TOTP fallback πάντα available;
   **Δαίδαλος recommendation:** WebAuthn primary, TOTP always available, password-only mode για roles `paralegal`/`secretary` αν admin opts. MFA mandatory για `partner`/`admin`.

6. **Q-API-6: GraphQL alternative.** REST is simpler αλλά mobile-first UI με complex includes (matter με parties + members + timeline) θα κάνει N+1 calls. GraphQL θα έλυνε αυτό αλλά adds complexity.
   **Δαίδαλος recommendation:** REST με rich `?include=` parameter Phase 1. Σχεδιασμένο σωστά (RSC fetches), δεν θα έχουμε N+1. GraphQL revisit Phase 2.

7. **Q-API-7: Privilege endpoint authentication grade.** Πρέπει `/documents/:id/privilege` να απαιτεί step-up auth (re-MFA challenge) για transitions `none → privileged` ή `privileged → none`; Aristotle F3 spirit suggests YES.
   **Δαίδαλος recommendation:** YES για `privileged → none` (downgrade is the dangerous direction — once unencrypted, leak risk). NO για `none → privileged` (upgrades should be frictionless to encourage privilege hygiene). Step-up = 5-minute MFA token re-issuance. Implementation: Sprint 4 (parallel με M12 audit).

8. **Q-API-8: Subpoena export — automated or attorney-mediated;** `POST /api/v1/audit/privilege-access/export` could be self-service για admin role, ή require explicit Δαίδαλος+ops approval to prevent insider misuse.
   **Δαίδαλος recommendation:** Self-service για admin role με 2 hard guards: (a) destination email MUST match firm-registered admin, (b) ALL exports auto-notify all firm partners. Greek notary timestamping optional add-on. Insider threat mitigated by mandatory partner notification + 72hr "reverse" window.

---

*Δαίδαλος v0.3 API spec, filed 2026-04-29 (rev. §3.15 + privilege error codes added).*
*Awaits Niko sign-off on Q-API-1..8 + Decisions Table §0 (17 decisions including D-API-13..17).*
