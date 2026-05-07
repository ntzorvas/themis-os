# THEMIS OS — API Architecture

**Spec version:** v0.2 (2026-04-28)
**Owner:** app-specialist
**Predecessor:** v0.1 (2026-04-27)

---

## v0.2 changes at a glance

- ~40 new endpoints added across 8 surfaces (SOLON, Trust, Time Capture, Email, Portal, Reports, ΑΠΕΔ, expanded Aegis)
- `/api/v1/portal/*` introduced as **separate auth domain** (portal_user, portal_session — different lifecycle from firm JWT)
- 3 new Aegis endpoints: `/aegis/v1/email/classify`, `/aegis/v1/time/infer`, `/aegis/v1/reports/nl-to-sql`
- JWT payload **no longer carries `tid` (tenant_id)**: deployment is single-tenant per firm; one JWT issuer per DB; cross-tenant lookup is impossible by construction
- Auth flow updated: portal users authenticate via separate `/api/v1/portal/auth/*` surface with reduced permissions and aggressive ratelimiting
- Webhook event catalog expanded for SOLON / ΑΠΕΔ / portal / time-capture / email
- BullMQ queues expanded: `solon`, `aped`, `email-fetch`, `time-capture`, `portal-notify`, `report-render`

---

## 1. Service Topology

```
                    +-----------------+
                    |   Cloudflare    |
                    |   (CDN + WAF)   |
                    +--------+--------+
                             |
                    +--------+--------+
                    |     nginx       |
                    |  (reverse proxy)|
                    +--------+--------+
                             |
       +---------------------+---------------------+--------------------+
       |                     |                     |                    |
+------+------+      +-------+-------+     +-------+-------+    +------+------+
|  Frontend    |     |  Business     |     |  AI / Aegis   |    |   Portal    |
|  Next.js 16  |     |  API          |     |  FastAPI      |    |   Frontend  |
|  :3000       |     |  Fastify      |     |  :8000        |    |  Next.js    |
|              |     |  :4000        |     |               |    |  :3010      |
+------+-------+     +-------+-------+     +-------+-------+    +------+------+
       |                     |                     |                   |
       |             +-------+-------+             |                   |
       |             |               |             |                   |
       |      +------+------+ +------+-----+      |                   |
       |      | PostgreSQL  | |   Redis    |      |                   |
       |      |   :5432     | |   :6379    |      |                   |
       |      +-------------+ +------+-----+      |                   |
       |                            |              |                   |
       |                     +------+------+       |                   |
       |                     |   BullMQ    |       |                   |
       |                     |   Workers   |       |                   |
       |                     +-------------+       |                   |
       |                                           |                   |
       |   +-------------+ +-------------+         |                   |
       +-->| Cloudflare  | |   Qdrant    |<--------+                   |
           |     R2      | |   :6333     |                             |
           +------+------+ +-------------+                             |
                  ^                                                    |
                  +----------------- portal (read-scoped) -------------+
```

### Services

| Service | Runtime | Port | Responsibility |
|---------|---------|------|---------------|
| **Frontend (firm)** | Next.js 16 (Node.js) | 3000 | SSR pages, React UI, BFF API routes — firm users only |
| **Portal Frontend** | Next.js 16 (Node.js) | 3010 | Client-facing portal SSR — reduced surface, distinct auth |
| **Business API** | Fastify (Node.js/TS) | 4000 | All firm CRUD, business logic, billing, workflow |
| **Portal API** | Fastify (Node.js/TS) | 4010 | Client-facing API surface — scoped reads + secure messages |
| **Aegis AI** | FastAPI (Python) | 8000 | AI orchestrator, LLM calls, RAG, embeddings, NL→SQL |
| **Workers** | BullMQ (Node.js) | -- | Async jobs: emails, myDATA, OCR, SOLON, ΑΠΕΔ, time capture |
| **PostgreSQL** | PostgreSQL 16 | 5432 | Per-firm DB (one per deployment, no `tenant_id`) |
| **Redis** | Redis 7 | 6379 | Cache, sessions, BullMQ queue backend |
| **Qdrant** | Qdrant | 6333 | Vector search (per-firm collection + shared corpus) |
| **R2** | Cloudflare R2 | -- | File storage (encrypted, per-firm bucket prefix) |

> **Single-tenant per firm DEPLOYMENT (Invariant #6):** every firm gets a dedicated stack (DB + Qdrant collection + KMS keys + R2 prefix). No `tenant_id` in queries. Service URLs differ per firm via DNS subdomain (`{firmslug}.app.themis.legal`, `{firmslug}.portal.themis.legal`).

### Inter-Service Communication

- Frontend → Business API: HTTP REST (internal network)
- Frontend → Aegis: never direct; always via Business API proxy with privilege/PII guard
- Business API → Aegis: HTTP REST (internal, for AI-enhanced operations)
- Business API → Workers: BullMQ job dispatch (Redis)
- Workers → Business API: internal HTTP callbacks (signed)
- Aegis → Qdrant: Qdrant client SDK (per-firm collection)
- Aegis → PostgreSQL: SQLAlchemy (read-only for legal corpus + read-only for NL→SQL Reports agent against firm DB sandboxed views)
- Business API → PostgreSQL: Prisma ORM
- Portal API → PostgreSQL: Prisma ORM with **scoped views** (no direct table access; only `portal_*_view` materialized/projected views)
- Portal API → Business API: signed internal HTTP for triggers (e.g., new portal message → notify firm)
- All services → Redis: ioredis / aioredis

---

## 2. Authentication & Authorization

### 2.1 Firm User Auth Flow

```
1. POST /api/v1/auth/login {email, password}
   -> Validate credentials (argon2id verify)
   -> If MFA enrolled, return mfa_required=true + mfa_session_token
   -> Else issue JWT access (15min) + refresh (7d httpOnly cookie)

2. POST /api/v1/auth/mfa/verify {mfa_session_token, code}
   -> TOTP verify
   -> Issue JWT access + refresh

3. All API requests:
   -> Authorization: Bearer <access_token>
   -> Middleware validates JWT signature + exp
   -> RBAC check: role.permissions[resource][action] >= required
   -> Ethical wall check: if matter.ethical_wall, user must be in matter_member

4. Token refresh:
   -> POST /api/v1/auth/refresh (httpOnly cookie present)
   -> Rotate refresh token (one-time use, family invalidation on reuse)
```

### 2.2 JWT Payload (firm users) — v0.2

```json
{
  "sub": "user_uuid",
  "role": "partner",
  "permissions": ["matter:*", "party:*", "invoice:create,read"],
  "department_id": "dept_uuid",
  "iat": 1714300000,
  "exp": 1714300900,
  "jti": "token_uuid"
}
```

> **No `tid` field.** Deployment is one-DB-per-firm; the JWT is issued by that firm's auth service and validated against that firm's signing key. The DNS hostname implicitly identifies the firm.

### 2.3 Portal User Auth Flow (NEW v0.2)

Portal users (clients of the firm) live in the `portal_user` table — separate from `app_user`. They have:
- Email + password (argon2id)
- Optional MFA (TOTP)
- Per-portal-user scope: which matters/documents they can see, derived from `matter_party WHERE portal_visible=true`
- Tighter session: 30-min access, 24-hour refresh, single-use refresh tokens, IP+UA fingerprint binding
- Aggressive rate limit (60 req/min per portal_user)
- No access to firm internal endpoints — completely separate API host

```
1. POST /api/v1/portal/auth/invite-redeem {invitation_token, password}
   -> Validate portal_invitation (single-use, 7-day TTL)
   -> Create portal_user
   -> Issue portal JWT

2. POST /api/v1/portal/auth/login {email, password}
   -> Validate, issue portal JWT (30min) + portal refresh (24h httpOnly)

3. All portal requests:
   -> Authorization: Bearer <portal_access_token>
   -> Middleware validates portal JWT
   -> Scope check: requested resource must be in portal_user.allowed_matters
   -> Privilege tag check: documents with privilege=privileged are FORBIDDEN
   -> All access logged to audit_log with actor_type='portal_user'

4. Logout / revocation:
   -> POST /api/v1/portal/auth/logout invalidates session
   -> Firm admin can disable portal_user (cascade revokes all sessions)
```

### 2.4 Portal JWT Payload

```json
{
  "sub": "portal_user_uuid",
  "scope": "portal",
  "party_id": "party_uuid",
  "allowed_matters": ["matter_uuid_1", "matter_uuid_2"],
  "iat": 1714300000,
  "exp": 1714301800,
  "jti": "portal_token_uuid"
}
```

### 2.5 RBAC Model (firm)

```
Permission = resource:action:scope

Resources: party, matter, document, invoice, time_entry, expense,
           hearing, calendar, task, report, settings, user, workflow,
           solon_filing, trust_account, aped_signature, portal_user,
           email_account, email_message, time_capture_session

Actions: create, read, update, delete, export, approve, transmit, sign

Scopes: own (only own records), department, all

Built-in Roles:
  - admin: *:*:all
  - partner: most:*:all + settings:update + invoice:approve:all
  - senior_associate: most:*:all (no settings, limited invoice:approve)
  - associate: most:crud:own + matter:read:department
  - paralegal: limited crud:own + document:*:department + portal_user:read
  - secretary: calendar:*, communication:*, task:crud:department
  - accountant: invoice:*, payment:*, expense:*, trust_account:*, report:read:all
  - trainee: read:own + time_entry:create:own
  - portal_admin: portal_user:* + portal_invitation:* (NEW v0.2)
```

### 2.6 Portal RBAC

Portal users have a fixed, non-configurable permission set:

```
read:matter:own_party        # only matters where their party is linked
read:document:own_party      # only documents shared via portal_visible=true AND privilege!=privileged
read:invoice:own_party       # only finalized invoices
create:portal_message        # secure message to firm
create:portal_payment_intent # initiate payment for invoice
read:portal_signature_request:own  # ΑΠΕΔ signature requests addressed to them
sign:portal_signature_request:own  # complete signing flow
```

### 2.7 Ethical Wall Enforcement

Same as v0.1:
- When `matter.ethical_wall = true`, only users in `matter_member` can access
- All matter queries inject WHERE clause for membership
- Cross-matter searches exclude ethical-walled matters
- Audit log records all access attempts (success or denied)

---

## 3. REST API Endpoints

### Naming Conventions

- Base URL: `/api/v1/` (firm); `/api/v1/portal/` (portal)
- Plural nouns for resources
- kebab-case for multi-word resources
- Query params for filtering: `?status=active&practice_area=civil`
- Pagination: `?page=1&per_page=25` (default 25, max 100)
- Sorting: `?sort=created_at&order=desc`
- Includes: `?include=client,parties` (nested relations)
- Idempotency: `Idempotency-Key` header for POST creates that have side effects (SOLON submit, ΑΠΕΔ sign, payment, myDATA transmit)

---

### 3.1 Auth Module

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

### 3.2 Parties (Unified Party Model)

> v0.2: there are no separate `/clients` endpoints any more. All persons/orgs (clients, opposing parties, suppliers, witnesses) live in `/api/v1/parties`. The relationship type is on `matter_party.role`.

```
GET    /api/v1/parties                          # List
POST   /api/v1/parties                          # Create
GET    /api/v1/parties/:id                      # Read
PUT    /api/v1/parties/:id
DELETE /api/v1/parties/:id                      # Soft delete

GET    /api/v1/parties/:id/contacts
POST   /api/v1/parties/:id/contacts
GET    /api/v1/parties/:id/matters              # Matters this party is in (any role)
GET    /api/v1/parties/:id/invoices             # Only roles where they're invoice payer
GET    /api/v1/parties/:id/documents
GET    /api/v1/parties/:id/communications
GET    /api/v1/parties/:id/financial-summary    # Balance, WIP, trust (only if client role)
GET    /api/v1/parties/:id/audit-trail
GET    /api/v1/parties/:id/conflicts            # Conflicts where this party appears

# Backward-compat thin wrappers (deprecated, planned removal v2)
GET    /api/v1/clients   -> 308 redirect to /api/v1/parties?role=client

# Party groups (formerly client groups)
GET    /api/v1/party-groups
POST   /api/v1/party-groups
PUT    /api/v1/party-groups/:id
POST   /api/v1/party-groups/:id/members
```

### 3.3 Matters

```
GET    /api/v1/matters
POST   /api/v1/matters                          # Triggers conflict check
GET    /api/v1/matters/:id                      # ?include=parties,members,stages
PUT    /api/v1/matters/:id
DELETE /api/v1/matters/:id                      # Soft delete; blocked if billed

GET    /api/v1/matters/:id/parties              # Returns matter_party rows (party_id + role + side)
POST   /api/v1/matters/:id/parties              # Body: {party_id, role, side, ...}
PUT    /api/v1/matters/:id/parties/:matterPartyId
DELETE /api/v1/matters/:id/parties/:matterPartyId

GET    /api/v1/matters/:id/members
POST   /api/v1/matters/:id/members
DELETE /api/v1/matters/:id/members/:userId

GET    /api/v1/matters/:id/stages
POST   /api/v1/matters/:id/stages/transition

GET    /api/v1/matters/:id/timeline
GET    /api/v1/matters/:id/related
POST   /api/v1/matters/:id/related

GET    /api/v1/matters/:id/dashboard
GET    /api/v1/matters/:id/ai-summary

GET    /api/v1/matter-stages
POST   /api/v1/matter-stages
```

### 3.4 Calendar & Hearings

```
GET    /api/v1/calendar/events
POST   /api/v1/calendar/events
PUT    /api/v1/calendar/events/:id
DELETE /api/v1/calendar/events/:id
GET    /api/v1/calendar/sync-status
POST   /api/v1/calendar/sync

GET    /api/v1/hearings
POST   /api/v1/hearings
GET    /api/v1/hearings/:id
PUT    /api/v1/hearings/:id
POST   /api/v1/hearings/:id/outcome
POST   /api/v1/hearings/:id/adjourn
GET    /api/v1/hearings/:id/checklist
PUT    /api/v1/hearings/:id/checklist
GET    /api/v1/hearings/daily-list
GET    /api/v1/hearings/upcoming

GET    /api/v1/deadlines
POST   /api/v1/deadlines
PUT    /api/v1/deadlines/:id
POST   /api/v1/deadlines/:id/complete
POST   /api/v1/deadlines/:id/extend

GET    /api/v1/deadline-rules
POST   /api/v1/deadline-rules
POST   /api/v1/deadline-rules/calculate
```

### 3.5 Documents

```
GET    /api/v1/documents
POST   /api/v1/documents/upload                 # Multipart; returns presigned R2 URL alt
GET    /api/v1/documents/:id
GET    /api/v1/documents/:id/download           # Signed R2 URL, 5min TTL
PUT    /api/v1/documents/:id
DELETE /api/v1/documents/:id                    # Blocked if legal_hold

GET    /api/v1/documents/:id/versions
POST   /api/v1/documents/:id/versions

POST   /api/v1/documents/search                 # FTS + vector
POST   /api/v1/documents/:id/ai-summary
POST   /api/v1/documents/:id/ai-qa

GET    /api/v1/document-templates
POST   /api/v1/document-templates
PUT    /api/v1/document-templates/:id
POST   /api/v1/document-templates/:id/generate
```

### 3.6 Time & Billing

```
GET    /api/v1/time-entries
POST   /api/v1/time-entries
PUT    /api/v1/time-entries/:id
DELETE /api/v1/time-entries/:id                 # Only if not billed
POST   /api/v1/time-entries/bulk
POST   /api/v1/time-entries/:id/approve

GET    /api/v1/timers                           # Active timers
POST   /api/v1/timers/start
POST   /api/v1/timers/:id/pause
POST   /api/v1/timers/:id/resume
POST   /api/v1/timers/:id/stop                  # Creates time_entry

GET    /api/v1/rate-cards
POST   /api/v1/rate-cards
PUT    /api/v1/rate-cards/:id
GET    /api/v1/rate-cards/resolve               # ?user_id=&party_id=&matter_id=
```

### 3.7 Auto Time Capture (NEW v0.2)

> Passive time-tracking pipeline. Desktop client sends activity events; Aegis (Chronografos agent) infers "what was the attorney working on?" Drafts created go to attorney for review and one-click promotion to time_entry.

```
# Event ingestion (from desktop/browser client)
POST   /api/v1/time-capture/events              # Batch ingest activity events
                                                # Body: {events:[{ts, app, window_title, url, idle_ms, ...}]}
                                                # Server-side encryption: window_title + url AES-256-GCM at rest
                                                # Idempotent on (user_id, ts, app)

# Sessions (server-aggregated activity buckets)
GET    /api/v1/time-capture/sessions            # ?status=draft|reviewed|promoted|discarded
GET    /api/v1/time-capture/sessions/:id
PUT    /api/v1/time-capture/sessions/:id        # Edit inferred matter_id, description, duration
POST   /api/v1/time-capture/sessions/:id/promote   # -> creates time_entry
POST   /api/v1/time-capture/sessions/:id/discard
POST   /api/v1/time-capture/sessions/:id/merge      # Merge multiple sessions into one time_entry
                                                    # Body: {session_ids:[...]}

# Inference triggers
POST   /api/v1/time-capture/sessions/:id/reinfer    # Force Aegis re-classification

# Settings (per-user)
GET    /api/v1/time-capture/settings            # User opt-in status, exclusion rules
PUT    /api/v1/time-capture/settings            # {enabled, exclude_apps:[], exclude_domains:[], working_hours:{}}
```

**Privacy note:** time-capture is opt-in per user (not firm-wide forced). User can pause/disable any time. Captured data is purged after 30 days unless promoted to time_entry.

### 3.8 Email Auto-Filing (NEW v0.2)

> IMAP / Gmail / Outlook integration. Inbound emails are fetched, classified by Aegis (Tachydromos agent) into (matter, party, category, privilege), and attached. Manual override always available.

```
# Email accounts (one per user)
GET    /api/v1/email/accounts                   # User's connected email accounts
POST   /api/v1/email/accounts/connect           # OAuth flow: Gmail / Outlook
                                                # Body: {provider, oauth_callback_state}
POST   /api/v1/email/accounts/imap              # IMAP credentials (alternative)
                                                # Body: {server, port, username, password (encrypted))}
DELETE /api/v1/email/accounts/:id               # Revoke + cleanup
GET    /api/v1/email/accounts/:id/health        # Connection status, last fetch, errors

# Messages
GET    /api/v1/email/messages                   # ?matter_id=&party_id=&classified=true|false
GET    /api/v1/email/messages/:id
PUT    /api/v1/email/messages/:id               # Reclassify (override AI suggestion)
                                                # Body: {matter_id?, party_id?, category?, privilege?}
POST   /api/v1/email/messages/:id/attach        # Attach to matter explicitly
POST   /api/v1/email/messages/:id/detach        # Remove matter linkage
POST   /api/v1/email/messages/:id/promote-attachment   # Promote attachment to documents table
                                                       # Body: {attachment_id, matter_id, category}
POST   /api/v1/email/messages/:id/reply         # Compose reply (drafts, not auto-send)

# Bulk operations
POST   /api/v1/email/messages/bulk-classify     # Trigger reclassification for unclassified messages
POST   /api/v1/email/messages/bulk-attach       # Attach N messages to one matter

# Webhooks (inbound from Gmail Pub/Sub or Microsoft Graph)
POST   /api/v1/email/webhooks/gmail             # Pub/Sub delivery
POST   /api/v1/email/webhooks/microsoft         # Microsoft Graph notifications
```

**Privacy note:** message body and attachment metadata encrypted with per-firm KMS. Classification runs on PII-anonymized text via Aegis.

### 3.9 Invoicing & Payments

```
GET    /api/v1/invoices
POST   /api/v1/invoices                         # From time entries + expenses
GET    /api/v1/invoices/:id
PUT    /api/v1/invoices/:id                     # Only if draft
DELETE /api/v1/invoices/:id                     # Only if draft

POST   /api/v1/invoices/:id/approve             # Multi-step approval workflow
GET    /api/v1/invoices/:id/approval-chain      # See chain status
POST   /api/v1/invoices/:id/approval-chain/:stepId/decision
                                                # Body: {decision: approve|reject, reason}

POST   /api/v1/invoices/:id/send
POST   /api/v1/invoices/:id/finalize
POST   /api/v1/invoices/:id/cancel
GET    /api/v1/invoices/:id/pdf

POST   /api/v1/invoices/:id/mydata/transmit
GET    /api/v1/invoices/:id/mydata/status

POST   /api/v1/invoices/:id/ledes-export        # LEDES 1998B format (corporate clients)

GET    /api/v1/invoices/batch-preview
POST   /api/v1/invoices/batch

GET    /api/v1/payments
POST   /api/v1/payments
GET    /api/v1/payments/:id

GET    /api/v1/expenses
POST   /api/v1/expenses
PUT    /api/v1/expenses/:id
DELETE /api/v1/expenses/:id
POST   /api/v1/expenses/:id/approve

# Approval chain templates
GET    /api/v1/invoice-approval-chains
POST   /api/v1/invoice-approval-chains          # Define chain template
PUT    /api/v1/invoice-approval-chains/:id
```

### 3.10 Bar Stamps (Γραμμάτια)

```
GET    /api/v1/bar-stamps
POST   /api/v1/bar-stamps                       # Auto-calculates contributions per ΔΣΑ
GET    /api/v1/bar-stamps/:id
PUT    /api/v1/bar-stamps/:id
POST   /api/v1/bar-stamps/calculate             # Calculate from fee
GET    /api/v1/bar-stamps/report                # Monthly / annual
GET    /api/v1/bar-stamps/rate-config           # Active ΔΣΑ rate table
PUT    /api/v1/bar-stamps/rate-config           # Admin only — update rate constants
```

### 3.11 Trust Accounting (NEW v0.2)

> Greek bar (ΕΔΕ) requires segregation of client funds. Phase 1 = 2-way reconciliation (bank ↔ ledger). Phase 2 = 3-way (bank ↔ ledger ↔ client sub-ledger).

```
GET    /api/v1/trust-accounts                   # List firm trust accounts
POST   /api/v1/trust-accounts
GET    /api/v1/trust-accounts/:id
PUT    /api/v1/trust-accounts/:id
GET    /api/v1/trust-accounts/:id/balance       # Real-time balance per client/matter

# Transactions
GET    /api/v1/trust-transactions               # ?account_id=&matter_id=&party_id=
POST   /api/v1/trust-transactions               # Deposit / withdrawal / transfer
GET    /api/v1/trust-transactions/:id
PUT    /api/v1/trust-transactions/:id           # Only if not reconciled
POST   /api/v1/trust-transactions/:id/void      # Reverses; creates linked counter-tx

# Reconciliation
POST   /api/v1/trust-accounts/:id/reconciliation       # Start reconciliation period
                                                       # Body: {period_start, period_end, statement_url?}
GET    /api/v1/trust-accounts/:id/reconciliation/:recId
POST   /api/v1/trust-accounts/:id/reconciliation/:recId/match-statement
                                                       # Body: {statement_lines:[{date, amount, ref}]}
POST   /api/v1/trust-accounts/:id/reconciliation/:recId/finalize
                                                       # Locks reconciliation; writes audit + report

# Reports
GET    /api/v1/trust-accounts/:id/ledger        # Per-account ledger
GET    /api/v1/trust-accounts/reports/sub-ledger?matter_id=
                                                # Per-matter sub-ledger (Phase 1: read-only)
GET    /api/v1/trust-accounts/reports/three-way      # Phase 2 only
```

### 3.12 Court Fees

```
GET    /api/v1/court-fees
POST   /api/v1/court-fees
PUT    /api/v1/court-fees/:id
POST   /api/v1/court-fees/calculate
```

### 3.13 Conflict Check

```
POST   /api/v1/conflict-checks
GET    /api/v1/conflict-checks/:id
POST   /api/v1/conflict-checks/:id/waive
GET    /api/v1/conflict-checks/history
```

### 3.14 AML/KYC

```
POST   /api/v1/aml-checks                       # Body uses party_id (renamed from client_id)
GET    /api/v1/aml-checks/:id
GET    /api/v1/aml-checks/party/:partyId
```

### 3.15 Contracts

```
GET    /api/v1/contracts
POST   /api/v1/contracts
GET    /api/v1/contracts/:id
PUT    /api/v1/contracts/:id
POST   /api/v1/contracts/:id/sign               # Routes to ΑΠΕΔ if Greek qualified sig required
GET    /api/v1/contracts/expiring
```

### 3.16 ΑΠΕΔ Qualified Signatures (NEW v0.2)

> Greek qualified e-signatures via portal.olomeleia.gr (free service). Required for SOLON e-filings of certain document classes.

```
GET    /api/v1/aped/signature-requests
POST   /api/v1/aped/signature-requests          # Create signature request
                                                # Body: {document_id, signers:[{user_id, party_id?, role}], reason}
GET    /api/v1/aped/signature-requests/:id
DELETE /api/v1/aped/signature-requests/:id      # Cancel (if no signer has signed yet)

# OAuth with portal.olomeleia.gr (per signer attorney)
GET    /api/v1/aped/oauth/authorize             # Redirect to ΑΠΕΔ portal
GET    /api/v1/aped/oauth/callback              # OAuth return
DELETE /api/v1/aped/oauth/disconnect            # Revoke firm-wide ΑΠΕΔ link

# Signing flow (attorney completes via ΑΠΕΔ UI)
POST   /api/v1/aped/signature-requests/:id/sign-init   # Get signing URL for attorney
POST   /api/v1/aped/signature-requests/:id/sign-callback   # ΑΠΕΔ calls back with signed PDF
GET    /api/v1/aped/signature-requests/:id/signed-document # Download signed PDF
GET    /api/v1/aped/signature-requests/:id/audit-trail     # Chain of custody, signer certs

# Verification
POST   /api/v1/aped/verify                      # Verify external ΑΠΕΔ signature on uploaded PDF
                                                # Body: {document_id} -> returns signer certs + validity
```

**Human-in-the-loop (Invariant #8):** every ΑΠΕΔ signature is initiated by an attorney action; system never signs autonomously.

### 3.17 SOLON E-Filing (NEW v0.2)

> Court e-filing per Ν.5221/2025 (active 1.1.2026). Phase 1 = wrapper (system generates compliant ZIP, attorney uploads to SOLON). Phase 2 = full automation.

```
# Filings
GET    /api/v1/solon/filings
POST   /api/v1/solon/filings                    # Create draft filing
                                                # Body: {matter_id, court_id, document_ids:[], type, ...}
GET    /api/v1/solon/filings/:id
PUT    /api/v1/solon/filings/:id                # Edit draft only
DELETE /api/v1/solon/filings/:id                # Cancel draft

# Pre-flight checks
POST   /api/v1/solon/filings/:id/validate       # Validate completeness, ΑΠΕΔ sigs, court fees, format
GET    /api/v1/solon/filings/:id/checklist      # Pre-submission checklist state

# Phase 1: ZIP wrapper flow
POST   /api/v1/solon/filings/:id/build-zip      # Generate compliant submission package (.zip)
GET    /api/v1/solon/filings/:id/zip            # Download .zip for manual upload
POST   /api/v1/solon/filings/:id/mark-submitted # Attorney records submission ID after manual upload
                                                # Body: {solon_submission_id, submitted_at}

# Phase 2: full automation (TAXISnet OAuth)
GET    /api/v1/solon/oauth/authorize            # TAXISnet OAuth init
GET    /api/v1/solon/oauth/callback             # TAXISnet return
POST   /api/v1/solon/filings/:id/submit         # Direct API submission (Phase 2)
                                                # Idempotency-Key required

# Status & certificate
GET    /api/v1/solon/filings/:id/status         # Pending / accepted / rejected / withdrawn
POST   /api/v1/solon/filings/:id/refresh-status # Force-poll SOLON for status
GET    /api/v1/solon/filings/:id/certificate    # Download protocol certificate
GET    /api/v1/solon/filings/:id/audit-trail    # Full chain of custody

# Webhooks (inbound from SOLON Phase 2)
POST   /api/v1/solon/webhooks/status            # SOLON status change push (signed)
```

### 3.18 Communications

```
GET    /api/v1/communications                    # ?matter_id=&party_id=
POST   /api/v1/communications
GET    /api/v1/communications/:id

GET    /api/v1/protocol
POST   /api/v1/protocol
```

### 3.19 Intake / CRM (formerly two modules, merged in v0.2)

```
GET    /api/v1/leads
POST   /api/v1/leads
PUT    /api/v1/leads/:id
POST   /api/v1/leads/:id/convert                # Convert to party + matter

GET    /api/v1/leads/pipeline
GET    /api/v1/consultations
POST   /api/v1/consultations
PUT    /api/v1/consultations/:id
```

### 3.20 Tasks

```
GET    /api/v1/tasks
POST   /api/v1/tasks
PUT    /api/v1/tasks/:id
DELETE /api/v1/tasks/:id
POST   /api/v1/tasks/:id/complete
GET    /api/v1/tasks/my
```

### 3.21 Workflows

```
GET    /api/v1/workflows
POST   /api/v1/workflows
PUT    /api/v1/workflows/:id
DELETE /api/v1/workflows/:id
GET    /api/v1/workflows/:id/logs
POST   /api/v1/workflows/:id/test
```

### 3.22 Reports & Analytics (EXPANDED v0.2)

> Phase 1 ships a managing partner dashboard + library of canned reports + saved-query system. NL→SQL via Aegis Apologistis agent (read-only sandboxed views).

```
# Canned reports (same as v0.1 list)
GET    /api/v1/reports/financial-summary
GET    /api/v1/reports/matter-summary
GET    /api/v1/reports/productivity
GET    /api/v1/reports/collections
GET    /api/v1/reports/client-profitability
GET    /api/v1/reports/attorney-performance
GET    /api/v1/reports/trust-summary
GET    /api/v1/reports/bar-stamps-summary

# Custom report builder
POST   /api/v1/reports/custom
GET    /api/v1/reports/export/:reportId

# Dashboards (NEW v0.2)
GET    /api/v1/reports/dashboards               # User's saved dashboards
POST   /api/v1/reports/dashboards
GET    /api/v1/reports/dashboards/:id
PUT    /api/v1/reports/dashboards/:id
DELETE /api/v1/reports/dashboards/:id
GET    /api/v1/reports/dashboards/:id/data       # Aggregated tile data

# Saved queries (NEW v0.2)
GET    /api/v1/reports/saved-queries            # Read-only library Phase 1
GET    /api/v1/reports/saved-queries/:id
POST   /api/v1/reports/saved-queries/:id/run    # Execute, returns rows + metadata

# NL → SQL (NEW v0.2; routed through Aegis Apologistis)
POST   /api/v1/reports/nl-query                 # Natural language question -> answer + chart
                                                # Body: {question:"top 5 clients by 2026 revenue"}
                                                # Returns: {sql, rows, suggested_chart, run_id}

# Report run logs (audit)
GET    /api/v1/reports/runs                     # ?user_id=&date_range=
GET    /api/v1/reports/runs/:id
```

### 3.23 Users & Settings

```
GET    /api/v1/users
POST   /api/v1/users
PUT    /api/v1/users/:id
GET    /api/v1/users/:id/workload

GET    /api/v1/roles
POST   /api/v1/roles
PUT    /api/v1/roles/:id

GET    /api/v1/departments
POST   /api/v1/departments

GET    /api/v1/settings/firm                    # Renamed from /settings/tenant in v0.2
PUT    /api/v1/settings/firm
GET    /api/v1/settings/courts
GET    /api/v1/settings/custom-fields
POST   /api/v1/settings/custom-fields
GET    /api/v1/settings/invoice-templates
POST   /api/v1/settings/invoice-templates
GET    /api/v1/settings/email-templates
GET    /api/v1/settings/aped-config             # ΑΠΕΔ org credentials
PUT    /api/v1/settings/aped-config
GET    /api/v1/settings/solon-config            # SOLON / TAXISnet config
PUT    /api/v1/settings/solon-config

GET    /api/v1/audit-log                        # Admin only
```

### 3.24 Courts (Shared / Read-Only)

```
GET    /api/v1/courts
GET    /api/v1/courts/:id
GET    /api/v1/courts/search
```

---

## 4. Portal API Surface (NEW v0.2 — separate auth domain)

> **Different host, different JWT, different RBAC, different rate limit.** No firm-internal endpoint reachable from portal token.

### 4.1 Portal Auth

```
POST   /api/v1/portal/auth/invite-redeem
POST   /api/v1/portal/auth/login
POST   /api/v1/portal/auth/logout
POST   /api/v1/portal/auth/refresh
POST   /api/v1/portal/auth/mfa/setup
POST   /api/v1/portal/auth/mfa/verify
POST   /api/v1/portal/auth/password/reset-request
POST   /api/v1/portal/auth/password/reset
GET    /api/v1/portal/auth/me
```

### 4.2 Portal Resources (read-mostly)

```
# Matters (only ones the portal_user is linked to)
GET    /api/v1/portal/matters                   # List visible matters
GET    /api/v1/portal/matters/:id               # Read (filtered, no internal notes)
GET    /api/v1/portal/matters/:id/timeline      # Public-facing timeline
GET    /api/v1/portal/matters/:id/documents     # Documents marked portal_visible AND privilege!=privileged
GET    /api/v1/portal/matters/:id/invoices      # Finalized invoices
GET    /api/v1/portal/matters/:id/payments      # Payment history

# Documents
GET    /api/v1/portal/documents/:id             # Metadata
GET    /api/v1/portal/documents/:id/download    # Signed R2 URL (10min TTL)
                                                # 403 if privilege=privileged
                                                # 403 if not portal_visible

# Invoices
GET    /api/v1/portal/invoices/:id
GET    /api/v1/portal/invoices/:id/pdf

# Payments
POST   /api/v1/portal/invoices/:id/pay-intent   # Initiate payment (Stripe / Viva Wallet)
GET    /api/v1/portal/payments/:id

# Secure messaging
GET    /api/v1/portal/messages
POST   /api/v1/portal/messages                  # To firm matter team
GET    /api/v1/portal/messages/:id
POST   /api/v1/portal/messages/:id/reply

# Signature requests (ΑΠΕΔ)
GET    /api/v1/portal/signature-requests
GET    /api/v1/portal/signature-requests/:id
POST   /api/v1/portal/signature-requests/:id/sign-init    # Begin ΑΠΕΔ flow
POST   /api/v1/portal/signature-requests/:id/sign-callback

# Account
GET    /api/v1/portal/profile
PUT    /api/v1/portal/profile
PUT    /api/v1/portal/password
GET    /api/v1/portal/notifications
PUT    /api/v1/portal/notification-preferences
```

### 4.3 Portal Invitations (firm-side)

```
GET    /api/v1/portal-invitations               # firm endpoint (firm JWT only)
POST   /api/v1/portal-invitations               # Body: {party_id, email, allowed_matters:[], role}
GET    /api/v1/portal-invitations/:id
DELETE /api/v1/portal-invitations/:id           # Revoke

GET    /api/v1/portal-users                     # firm endpoint — list portal users
PUT    /api/v1/portal-users/:id                 # Modify scope, disable, reset
DELETE /api/v1/portal-users/:id                 # Hard disable + revoke all sessions
```

---

## 5. AI Orchestrator API (Aegis — FastAPI)

Aegis exposes internal APIs consumed by the Business API only, never the frontend directly. New v0.2 endpoints below the divider.

### 5.1 Existing v0.1 endpoints (preserved)

```
# Document AI
POST   /aegis/v1/documents/summarize
POST   /aegis/v1/documents/qa
POST   /aegis/v1/documents/extract
POST   /aegis/v1/documents/draft
POST   /aegis/v1/documents/translate

# Legal Research
POST   /aegis/v1/research/query
POST   /aegis/v1/research/case-law
POST   /aegis/v1/research/articles
POST   /aegis/v1/research/citations

# Matter AI
POST   /aegis/v1/matters/summarize
POST   /aegis/v1/matters/next-actions
POST   /aegis/v1/matters/risk-assessment

# Deadline AI
POST   /aegis/v1/deadlines/extract
POST   /aegis/v1/deadlines/calculate

# Billing AI
POST   /aegis/v1/billing/draft-invoice
POST   /aegis/v1/billing/time-descriptions
POST   /aegis/v1/billing/anomaly-check

# Conflict AI
POST   /aegis/v1/conflicts/enhanced-check

# Intake AI
POST   /aegis/v1/intake/score-lead
POST   /aegis/v1/intake/draft-engagement

# PII
POST   /aegis/v1/pii/anonymize
POST   /aegis/v1/pii/deanonymize

# Embeddings
POST   /aegis/v1/embeddings/index
DELETE /aegis/v1/embeddings/remove
POST   /aegis/v1/embeddings/search
```

### 5.2 NEW v0.2 — three new agents

```
# Email Classifier (Tachydromos / Ταχυδρόμος)
POST   /aegis/v1/email/classify                 # Classify email -> (matter, party, category, privilege)
                                                # Body: {message_id} -> {suggested_matter_id, suggested_party_id,
                                                #         category, privilege, confidence, rationale}
POST   /aegis/v1/email/classify-batch           # Batch classify multiple messages
POST   /aegis/v1/email/extract-entities         # Extract dates, deadlines, monetary amounts from email body

# Time Capture Inferrer (Chronografos / Χρονογράφος)
POST   /aegis/v1/time/infer                     # Infer time_capture_session -> matter + description
                                                # Body: {session_id} -> {suggested_matter_id, description,
                                                #         estimated_duration_min, confidence}
POST   /aegis/v1/time/infer-batch
POST   /aegis/v1/time/cluster-events            # Cluster raw events into draft sessions
                                                # Body: {user_id, date_range} -> session draft list

# Report Generator (Apologistis / Απολογιστής)
POST   /aegis/v1/reports/nl-to-sql              # Natural language -> SQL (read-only sandbox views)
                                                # Body: {question} -> {sql, validation:{safe:bool, reasons:[]}}
POST   /aegis/v1/reports/explain-sql            # Explain a SQL query in Greek
POST   /aegis/v1/reports/suggest-chart          # Given rows + columns -> chart spec (line/bar/pie)

# ΑΠΕΔ assist (uses existing agents, no new agent — listed for completeness)
POST   /aegis/v1/aped/pre-sign-validate         # Validate document is ready to sign (PDF/A-2, no annotations issues)
```

**NL→SQL safety gate:** Aegis Apologistis runs queries only against sandboxed read-only views (`vw_report_*`). Direct table access is blocked. The agent must justify its query against an allow-list of patterns; failure → human review.

---

## 6. Rate Limiting

| Tier | Requests/min | Burst |
|------|-------------|-------|
| Standard firm user | 120 | 30 |
| Firm admin | 300 | 60 |
| API key (integrations) | 600 | 120 |
| Aegis (internal) | 1000 | 200 |
| Webhook delivery | 60 | 10 |
| **Portal user** (NEW) | 60 | 15 |
| **Portal auth (login/redeem)** (NEW) | 10 | 3 |
| **SOLON/ΑΠΕΔ external callbacks** (NEW) | 200 | 50 |

Implementation: Redis sliding window counter per user/API key. Portal endpoints use a separate counter namespace from firm endpoints.

---

## 7. Webhook System

### 7.1 Webhook Registration

```
POST   /api/v1/webhooks
{
  "url": "https://example.com/webhook",
  "events": ["matter.created", "invoice.paid", "solon.filing_accepted"],
  "secret": "whsec_...",
  "active": true
}
```

### 7.2 Available Events (EXPANDED v0.2)

```
# Party events (renamed from client.*)
party.created, party.updated, party.archived

# Matter events
matter.created, matter.updated, matter.stage_changed, matter.closed
matter.party_added, matter.party_removed

# Billing events
invoice.created, invoice.approval_step_completed, invoice.sent, invoice.paid, invoice.overdue
payment.received

# Calendar events
hearing.scheduled, hearing.outcome_recorded
deadline.approaching (7d, 1d), deadline.expired

# Document events
document.uploaded, document.signed
document.privilege_changed (NEW)

# Intake events
lead.created, lead.converted

# Workflow events
workflow.triggered, workflow.completed, workflow.failed

# NEW v0.2: SOLON
solon.filing.draft_created
solon.filing.validated
solon.filing.submitted
solon.filing.accepted
solon.filing.rejected
solon.filing.certificate_issued

# NEW v0.2: ΑΠΕΔ
aped.signature_request.created
aped.signature_request.signer_completed
aped.signature_request.fully_signed
aped.signature_request.cancelled
aped.signature_request.expired

# NEW v0.2: Trust
trust.transaction.recorded
trust.reconciliation.started
trust.reconciliation.finalized
trust.reconciliation.discrepancy

# NEW v0.2: Email
email.message.received
email.message.classified
email.message.attached_to_matter
email.account.health_degraded

# NEW v0.2: Time Capture
time_capture.session.drafted
time_capture.session.promoted_to_time_entry

# NEW v0.2: Portal
portal.user.invited
portal.user.activated
portal.message.received
portal.payment.completed
portal.signature.completed

# NEW v0.2: Reports
report.run.completed (long-running exports)
```

### 7.3 Webhook Delivery

- HTTP POST with JSON body
- HMAC-SHA256 signature in `X-Themis-Signature` header
- 3 retry attempts (exponential backoff: 1min, 5min, 30min)
- Webhook logs retained 30 days
- Timeout: 10 seconds per delivery attempt

---

## 8. Background Job Queue (BullMQ)

### Queue Structure (EXPANDED v0.2)

| Queue | Workers | Purpose |
|-------|---------|---------|
| `email` | 3 | Send outbound emails (notifications, invoices, reminders) |
| `mydata` | 1 | AADE myDATA transmissions (sequential, rate-limited) |
| `ocr` | 2 | Document OCR processing |
| `embeddings` | 2 | Document vectorization for Qdrant |
| `reminders` | 1 | Scheduled deadline/calendar reminders |
| `reports` | 1 | Heavy report generation (export) |
| `report-render` | 2 | Dashboard tile rendering, NL→SQL execution (NEW) |
| `sync` | 2 | Google/Outlook calendar sync |
| `webhooks` | 2 | Webhook delivery + retries |
| `ai` | 3 | AI processing (summarization, drafting) |
| `audit` | 1 | Async audit log writes (buffer for performance) |
| `solon` | 1 | SOLON submissions, status polls (rate-limited per Ν.5221/2025 contract) (NEW) |
| `aped` | 1 | ΑΠΕΔ signing API calls, callback processing (NEW) |
| `email-fetch` | 3 | IMAP / Gmail / Microsoft Graph inbound polling (NEW) |
| `email-classify` | 2 | Aegis email classification calls (NEW) |
| `time-capture` | 2 | Aggregate time-capture events into sessions, run inference (NEW) |
| `portal-notify` | 2 | Portal-bound notifications (email, in-app) (NEW) |
| `trust-recon` | 1 | Trust reconciliation matching jobs (NEW) |

### Job Priority

- Critical: deadline reminders, hearing alerts, SOLON submission deadlines (priority 1)
- High: invoice delivery, myDATA, ΑΠΕΔ callbacks, trust reconciliation finalization (priority 2)
- Normal: email send/fetch, sync, time-capture inference, portal notifications (priority 3)
- Low: OCR, embeddings, reports, NL→SQL, classification batches (priority 4)

---

## 9. Error Handling

### 9.1 Standard Error Response

```json
{
  "error": {
    "code": "MATTER_NOT_FOUND",
    "message": "Matter with ID xyz not found",
    "status": 404,
    "details": {}
  }
}
```

### 9.2 Error Codes

- 400: Validation errors (with field-level details)
- 401: Authentication required
- 403: Insufficient permissions / privilege violation / portal scope violation
- 404: Resource not found
- 409: Conflict (duplicate party, ethical wall, idempotency-key reuse with different body)
- 422: Business rule violation (delete blocked, ΑΠΕΔ pre-sign failed, SOLON validation failed)
- 423: Locked (resource in legal_hold or in finalized reconciliation)
- 429: Rate limit exceeded
- 500: Internal server error (logged, alert triggered)
- 502: Upstream provider error (SOLON, ΑΠΕΔ, myDATA, email provider)
- 503: Upstream provider unavailable (degrades gracefully — see Invariant #5)

### 9.3 New v0.2 Error Codes (resource-specific)

```
SOLON_VALIDATION_FAILED       (422) Pre-flight checklist failed
SOLON_UPSTREAM_REJECTED       (502) SOLON returned rejection
SOLON_UPSTREAM_TIMEOUT        (504) Status poll timeout, will retry
APED_OAUTH_REQUIRED           (401) Attorney must reconnect ΑΠΕΔ
APED_SIGNER_DECLINED          (422) Signer declined; flow halted
APED_SIGNATURE_INVALID        (422) Verification failed on uploaded PDF
TRUST_RECONCILIATION_LOCKED   (423) Cannot edit transactions in finalized period
PORTAL_PRIVILEGE_BLOCKED      (403) Document is privileged — never visible to portal
PORTAL_NOT_INVITED_TO_MATTER  (403) Portal user has no scope on this matter
EMAIL_PROVIDER_OAUTH_EXPIRED  (401) User must re-authorize email account
TIME_CAPTURE_OPT_IN_REQUIRED  (403) User has not enabled passive time capture
NL_QUERY_UNSAFE               (422) Apologistis rejected the SQL it generated
```

---

## 10. API Versioning

- URL path versioning: `/api/v1/`, `/api/v2/`
- Breaking changes require version bump
- Previous version supported for 12 months after new version release
- Deprecation headers: `X-Themis-Deprecated: true`, `X-Themis-Sunset: 2027-06-01`
- v0.2 spec changes are within v1 (additive); only `/api/v1/clients` (now thin redirect) is marked deprecated for v2 removal

---

## 11. Idempotency

POST endpoints with side effects accept `Idempotency-Key` header (UUID v4 recommended).

**Required for:**
- `/api/v1/solon/filings/:id/submit`
- `/api/v1/aped/signature-requests` (create) and `/sign-callback`
- `/api/v1/invoices/:id/mydata/transmit`
- `/api/v1/payments` (create)
- `/api/v1/trust-transactions` (create)
- `/api/v1/portal/invoices/:id/pay-intent`

**Behavior:**
- First request with key K: process, store (key, response, hash(body)) for 24h
- Repeat request with K and same body: return stored response, status 200 + `X-Themis-Idempotent-Replay: true`
- Repeat request with K but different body: 409 `IDEMPOTENCY_KEY_REUSED`

---

## 12. Audit Logging

Every state-changing API call is logged to `audit_log` (append-only, partitioned monthly):

```
{
  id, timestamp, actor_id, actor_type ('user'|'portal_user'|'system'|'aegis'),
  action, resource_type, resource_id,
  before_hash, after_hash,
  ip_address, user_agent, request_id,
  outcome ('success'|'denied'|'error'),
  metadata (JSONB)
}
```

Particularly sensitive flows write enriched logs:
- SOLON submissions: include certificate hash, submission ID
- ΑΠΕΔ signings: include signer cert thumbprint, full chain
- Trust reconciliations: snapshot of opening + closing balances
- Portal access: include allowed_matters subset hit
- NL→SQL runs: store generated SQL + row count + hash of result

Audit log is **immutable** (Invariant #4). No update/delete endpoints exist for it.

---

*v0.2 lock 2026-04-28. Next review: post-Sprint 9 (Module 4 KPolD checkpoint) and post-Sprint 17 (SOLON pilot dry-run).*
