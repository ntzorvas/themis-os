# THEMIS OS — Aegis AI Orchestrator Specification

**Spec version:** v0.2 (2026-04-28)
**Owner:** claude-engineer
**Predecessor:** v0.1 (2026-04-27)

---

## v0.2 changes at a glance

- **Three new agents** added: Email Classifier (Tachydromos / Ταχυδρόμος), Time Capture Inferrer (Chronografos / Χρονογράφος), Report Generator (Apologistis / Απολογιστής)
- Total agent count: **8 → 11**
- Autonomy matrix updated for new agents — all three are degraded-mode-safe (Invariant #5)
- Per-firm Qdrant collection naming convention updated (no `tenant_id`-based naming): `{firmslug}_documents`
- New PII handling rule for email classification (subject + body anonymized before LLM)
- Cost estimation revised for 3 new flows
- AI interaction log table now per-firm (no `tenant_id` column — Invariant #6)

---

## 1. Overview

Aegis is the AI nervous system of THEMIS OS. It is not a chatbot bolted onto a CRUD app — it is an orchestrating intelligence layer that proactively assists attorneys throughout their workflow.

- **Architecture:** Hub-and-spoke multi-agent system
- **Runtime:** Python FastAPI, separate service (:8000) per firm deployment
- **LLM:** Claude (Anthropic) primary; model selection per agent based on complexity/cost
- **Access:** Internal only — all requests proxied through Business API. Never exposed to frontend directly.
- **Tenancy:** Single-tenant per firm DEPLOYMENT — one Aegis instance per firm DB; per-firm Qdrant collection prefixed by firm slug; per-firm Redis namespace; per-firm KMS keys for prompt audit log encryption.

---

## 2. Architecture

```
                    +-----------------------------+
                    |        Business API          |
                    |        (Fastify)              |
                    +-----------+-----------------+
                                |
                    +-----------+-----------------+
                    |        Aegis Hub             |
                    |    (Request Router)           |
                    |                              |
                    |  +---------------------+     |
                    |  |  PII Anonymizer     |     |
                    |  |  (pre/post LLM)     |     |
                    |  +---------------------+     |
                    |                              |
                    |  +---------------------+     |
                    |  |  Context Builder    |     |
                    |  +---------------------+     |
                    |                              |
                    |  +---------------------+     |
                    |  |  Prompt Manager     |     |
                    |  +---------------------+     |
                    +-----------+-----------------+
                                |
   +----------+----------+------+-----+------------+--------------+----------+
   |          |          |            |            |              |          |
+--+--+   +--+--+   +---+---+    +--+--+      +--+--+        +--+--+    +--+--+
|Eren-|   |Syng-|   |Proth- |    |Logist|     |Eleg-|        |Pros- |    |Peri-|
|itik.|   |ramm-|   |esmios |    |ikos  |     |ktos |        |lepsis|    |lept-|
| 1   |   | 2   |   |  3    |    | 4    |     | 5   |        | 6    |    |  7  |
+--+--+   +--+--+   +---+---+    +--+--+     +--+--+         +--+---+    +--+--+
   |         |          |           |            |              |           |
   |         |          |           |            |              |           |
+--+--+   +--+--+   +---+---+    +--+--+     +--+--+        +---+--+    +---+--+
|Anag-|   |Tach-|   |Chrono-|    |Apol- |    |  ... future agents (12+)  |
|nost.|   |ydro-|   |grafos |    |ogist.|    |                           |
| 8   |   |mos 9|   |  10   |    |  11  |    |                           |
+-----+   +-----+   +-------+    +------+    +---------------------------+

  ┌────────┐  ┌────────┐  ┌─────────┐  ┌──────────┐  ┌─────────────┐
  │Qdrant  │  │ Claude │  │ KPolD   │  │PostgreSQL│  │ Sandboxed   │
  │Legal   │  │  API   │  │ Rules   │  │ Search   │  │ NL→SQL views│
  │Corpus  │  │        │  │ Engine  │  │          │  │             │
  └────────┘  └────────┘  └─────────┘  └──────────┘  └─────────────┘
```

---

## 3. Core Components

### 3.1 Aegis Hub (Router)

The central router that receives all AI requests, determines which agent(s) to invoke, and orchestrates the pipeline.

Responsibilities:
- Request classification (which agent handles this?)
- Context gathering (fetch relevant data from Business API / DB)
- PII anonymization (before any LLM call)
- Agent dispatch (single or multi-agent)
- Response assembly (combine agent outputs)
- PII deanonymization (restore names, IDs in response)
- Result caching (Redis, keyed by input hash + agent version + prompt version)
- Usage tracking (tokens, cost, latency per request)
- Failure isolation: any agent failure returns a structured "AI unavailable, fallback to manual" response — never blocks core ops

### 3.2 PII Anonymizer

Every piece of data that goes to an LLM must pass through PII anonymization.

Pipeline:
```
1. Input text received
2. NER detection (Microsoft Presidio + custom Greek model)
3. Entity classification:
   - PERSON       -> [PERSON_1], [PERSON_2], ...
   - AFM/TAX_ID   -> [TAX_ID_1], ...
   - ADDRESS      -> [ADDRESS_1], ...
   - PHONE        -> [PHONE_1], ...
   - IBAN         -> [IBAN_1], ...
   - ID_NUMBER    -> [ID_1], ...
   - EMAIL        -> [EMAIL_1], ...
4. Build replacement map: {"[PERSON_1]": "Νικόλαος Τζόρβας", ...}
5. Send anonymized text to LLM
6. Receive LLM response (contains [PERSON_1] etc.)
7. Replace placeholders with real values
8. Return deanonymized response
```

Greek-specific PII patterns:
- AFM: 9-digit Greek tax number (check digit validation)
- AMKA: 11-digit social security
- ADT: Greek ID card number (2 letters + 6 digits)
- Greek phone: +30 / 69x patterns
- Greek addresses: Οδός / Λεωφόρος / Πλατεία patterns

### 3.3 Context Builder

Gathers relevant context before LLM call to keep prompts focused.

Sources:
- Matter data (from Business API)
- Related documents (from Qdrant per-firm collection)
- Legal articles (from Qdrant `legal_corpus`)
- Case law (from Qdrant `case_law`)
- Previous AI interactions (from Redis cache)
- Firm-specific settings (rate cards, templates, preferences)

Context window management:
- Token budget per request (configurable, default 100K)
- Priority ranking: user query > matter data > relevant docs > legal articles > case law
- Chunking strategy for large documents (recursive character splitting, 2000 token chunks; 200-token overlap)

### 3.4 Prompt Manager

Versioned prompt templates stored in `/aegis/prompts/`.

```
prompts/
  research/v1.0/{system,user_query}.jinja2
  drafting/v1.0/{system,agogi,exodiko,aitisi,...}.jinja2
  summarization/v1.0/{matter_summary,document_summary}.jinja2
  billing/v1.0/{draft_invoice,time_description}.jinja2
  email/v0.2/{classify,extract_entities}.jinja2          # NEW
  time_capture/v0.2/{cluster,infer_session}.jinja2       # NEW
  reports/v0.2/{nl_to_sql,explain_sql,suggest_chart}.jinja2  # NEW
```

Version selection: default = latest. Pin per agent in config. A/B testing via percentage routing.

---

## 4. Agent Definitions

### Agent 1: Research Agent (Ereynitikos)

**Purpose:** AI-powered legal research across Greek law corpus and jurisprudence.

**Triggers:**
- Manual: User queries from UI
- Automatic: New matter created → suggest relevant articles
- Automatic: Document uploaded → extract legal references

**Capabilities:**
- Semantic search across 24K+ laws, 236K+ articles
- Case law search
- Article cross-referencing
- Citation generation (AP 123/2024 format)
- Research memo drafting
- Relevant article suggestions for matter type

**LLM:** Claude Sonnet
**Autonomy:** Auto for suggestions, Draft+Approve for memos
**Data:** Qdrant `legal_corpus` (RO), Qdrant `case_law` (RO), PostgreSQL matter data

---

### Agent 2: Drafting Agent (Syngrammatos)

**Purpose:** Generate legal documents in proper Greek legal language.

**Triggers:**
- Manual: User requests draft / fills template
- Automatic: Matter stage transition → suggest documents

**Capabilities:**
- Αγωγή, Εξώδικο, Αίτηση, Σύμβαση εντολής, Πληρεξούσιο
- Client letter drafting
- Document summarization & Q&A

**LLM:** Claude Opus (complex drafting), Sonnet (summaries/Q&A)
**Autonomy:** Always Draft+Approve (NEVER auto-submit legal documents)
**Human-in-the-loop:** MANDATORY (Invariant #8). UI marks all output as "AI Draft" with yellow banner.

---

### Agent 3: Deadline Agent (Prothesmios)

**Purpose:** Calculate, extract, and monitor legal deadlines based on KPolD and other procedural codes.

**Triggers:**
- Automatic: Document uploaded → extract dates/deadlines
- Automatic: Hearing outcome recorded → calculate appeal deadlines
- Automatic: Matter stage change → apply stage-specific deadlines
- Manual: User asks "when is the deadline for X?"

**Capabilities:**
- KPolD deadline calculation (50+ rules)
- AK statute of limitations tracking
- Date extraction from court documents (OCR + NLP)
- Holiday-aware calculation (Greek public holidays + court recesses)
- Cascade deadline creation
- Deadline conflict detection (same attorney, overlapping)

**LLM:** Claude Haiku (extraction); rules engine (calculation, no LLM)
**Autonomy:** Auto for calculations, Draft+Approve for AI extractions

---

### Agent 4: Billing Agent (Logistikos)

**Purpose:** AI-assisted invoice drafting, time entry polishing, anomaly detection.

**Triggers:**
- Manual: User requests AI invoice draft / time description polish
- Automatic: Monthly billing reminder → draft invoices for review
- Automatic: Time entry anomaly detected → alert

**Capabilities:**
- Draft invoice from time entries (group, describe, calculate)
- Polish time entry descriptions (vague → professional)
- Detect billing anomalies (unusual hours, duplicates)
- Suggest write-offs for aged WIP
- Payment prediction
- ΔΣΑ minimum fee validation

**LLM:** Claude Haiku
**Autonomy:** Draft+Approve for invoices, Auto for anomaly alerts

---

### Agent 5: Conflict Agent (Elegktos)

**Purpose:** Enhanced conflict-of-interest checking with AI-powered fuzzy and relationship matching.

**Triggers:**
- Automatic: New party / matter / matter_party → run conflict check
- Manual: User runs manual check

**Capabilities:**
- Exact name matching
- Phonetic matching (Greek name variations: Ιωάννης ≈ Γιάννης ≈ Giannis)
- Tax ID matching
- Company officer matching (via GEMI when available)
- Relationship graph traversal
- Risk scoring per match (0–100)

**LLM:** Not needed for basic matching. Claude Haiku for relationship reasoning.
**Autonomy:** Auto for checking, Never Auto for waiver decisions

---

### Agent 6: Intake Agent (Proslepsis)

**Purpose:** Lead qualification and engagement letter drafting.

**Triggers:**
- Automatic: New lead → score
- Manual: User requests engagement letter
- Automatic: Lead → "proposal_sent" → draft engagement letter

**Capabilities:**
- Lead qualification scoring (0–100)
- Practice area classification from intake description
- Follow-up email drafting
- Engagement letter generation
- Conflict check trigger

**LLM:** Claude Haiku
**Autonomy:** Auto for scoring, Draft+Approve for letters

---

### Agent 7: Summary Agent (Perileptikos)

**Purpose:** Generate summaries of matters, documents, and activity.

**Triggers:**
- Manual: "AI Summary" button
- Automatic: Weekly matter digest for partners
- Manual: Pre-hearing briefing

**Capabilities:**
- Matter summary
- Document summary
- Activity summary
- Pre-hearing briefing (matter + checklist + deadlines)
- Client correspondence digest

**LLM:** Claude Sonnet
**Autonomy:** Auto (read-only)

---

### Agent 8: OCR & Extraction Agent (Anagnostis)

**Purpose:** Extract text and structured data from uploaded documents.

**Triggers:**
- Automatic: Document uploaded (PDF/image)
- Automatic: After OCR → extract dates, amounts, parties
- Manual: User requests data extraction

**Capabilities:**
- Greek OCR (pytesseract w/ Greek pack)
- Date / amount / party / case-number / article-reference extraction

**LLM:** Claude Haiku (extraction); pytesseract (OCR, local)
**Autonomy:** Auto (non-destructive)

---

### Agent 9: Email Classifier (Tachydromos / Ταχυδρόμος) — NEW v0.2

**Purpose:** Classify inbound emails (IMAP / Gmail / Microsoft Graph) into the tuple `(matter_id, party_id, category, privilege)` so they can be auto-filed to the right matter.

**Triggers:**
- Automatic: New email arrives via `email-fetch` worker → enqueue classification
- Manual: User clicks "Reclassify" on a message
- Bulk: Admin triggers `bulk-classify` for unclassified backlog

**Capabilities:**
- Match sender/recipient against `party.email_aliases` for party identification
- Match subject + body keywords against open matters (matter_party email aliases, matter title, prior thread context)
- Classify into category: `correspondence | court_document | client_communication | opposing_counsel | court_clerk | invoice | scheduling | other`
- Detect privilege markers: `privileged | work_product | confidential | none`
- Detect attachments worth promoting to `documents` (court filings, signed contracts)
- Extract entities for downstream agents: dates → Prothesmios, monetary amounts → Logistikos, deadlines → Prothesmios
- Produce `confidence_score` (0–1) per classification — UI surfaces low-confidence items as suggestions only

**LLM:** Claude Haiku (cost-sensitive — high volume)
**Autonomy:**
- Auto for classification suggestions stored in `email_message.suggested_*` fields
- Draft+Approve before commit to actual matter linkage if confidence < 0.85
- Auto-link if confidence >= 0.85 AND user has opted-in to auto-link
- Never Auto for privilege override (always defaults to most-restrictive)

**Privacy / PII:**
- Email subject + body run through PII Anonymizer BEFORE LLM call
- Original email body remains encrypted at rest (AES-256-GCM, per-firm KMS)
- LLM never sees real names — only synthetic placeholders during classification

**Data:**
- `email_message`, `email_account`, `party.email_aliases`, `matter`, `matter_party`
- Qdrant per-firm `{firmslug}_documents` for thread similarity (optional, future)

**Failure mode:** If classifier unavailable, emails arrive in an "Unclassified" inbox and user files manually. Core ops unaffected.

---

### Agent 10: Time Capture Inferrer (Chronografos / Χρονογράφος) — NEW v0.2

**Purpose:** Infer "what was the attorney working on?" from passive activity events (window titles, app usage, browser URLs, idle gaps) and produce draft `time_capture_session` records the attorney can promote to `time_entry` with one click.

**Triggers:**
- Scheduled: Every 30 min (per active user) → cluster recent events into candidate sessions
- End-of-day: 18:00 local → run full-day inference for all opted-in users
- Manual: User clicks "Re-infer" on a session

**Capabilities:**
- Cluster raw `time_capture_event` rows into time-coherent sessions (gap > 5 min idle = new session)
- Match cluster to most-likely matter using:
  - Window titles vs. matter party names + matter file numbers
  - Browser URLs against firm document URLs / client portals
  - Email threads worked on (cross-reference with Tachydromos classifications)
  - Calendar events overlapping the timeframe
- Generate professional time-entry description (Greek legal language, billable phrasing)
- Estimate billable duration (subtract idle gaps, brief breaks)
- Return `confidence_score` (0–1)

**LLM:** Claude Haiku + deterministic rules engine (rules first, LLM only for description polish + ambiguous matter matching)
**Autonomy:**
- Auto-draft session records (visible in user's "Time Capture" inbox)
- Draft+Approve before promotion to `time_entry` (always)
- Never auto-bill from inferred sessions

**Privacy / PII:**
- Raw events stored encrypted (AES-256-GCM); window titles + URLs are sensitive
- Events purged after 30 days unless promoted to time_entry
- Per-user opt-in required (firm cannot force-enable; user can pause anytime)
- Excluded apps/domains (banking, personal email) configurable per user
- LLM input is anonymized (window titles run through PII pipeline)

**Data:**
- `time_capture_event`, `time_capture_session`, `matter`, `matter_party`, `calendar_event`, `email_message` (read-only cross-ref)

**Failure mode:** If inferrer unavailable, raw events still captured; user logs time manually. Sessions remain in `pending` state until inferrer recovers.

---

### Agent 11: Report Generator (Apologistis / Απολογιστής) — NEW v0.2

**Purpose:** Natural-language → SQL → chart pipeline for managing-partner dashboard. Lets non-technical partners ask "Top 5 clients by revenue 2026" and get an answer with provenance.

**Triggers:**
- Manual: User submits NL question via dashboard
- Manual: User clicks "Explain this query" on a saved query
- Automatic: Suggest chart type given a result set

**Capabilities:**
- Translate natural-language Greek/English questions to SQL
- Validate generated SQL against allow-list patterns (no DDL, no DML, no joins to PII tables outside scope)
- Execute against **sandboxed read-only views** (`vw_report_*`) — direct table access blocked
- Suggest chart type (line / bar / pie / table) based on result schema
- Explain SQL in Greek for the user ("This query sums revenue grouped by party for 2026")
- Identify which roles have permission for the data and refuse if user lacks scope

**LLM:** Claude Sonnet (reasoning over schema)
**Autonomy:**
- Auto for read-only queries against allow-listed views
- Never Auto for any write/update SQL (rejected at validator)
- Draft+Approve for queries that span >5 views or look anomalous

**Safety gates (NL→SQL):**
1. Generated SQL is parsed (sqlglot) and inspected: must contain only `SELECT`, only target views starting with `vw_report_`, no `;` chaining, no comments hiding statements, no functions outside an allow-list.
2. Estimated row count via `EXPLAIN`. If > 100k rows, user is asked to add a filter.
3. Generated SQL + explanation shown to user BEFORE execution; user must click "Run".
4. Audit log records: question, generated SQL, validation result, executed-by, row count, hash of result.

**Privacy / PII:**
- Query results may contain PII; results not cached beyond 1 hour
- LLM never sees raw data — only schema descriptions of `vw_report_*` views
- Only roles `partner`, `admin`, `accountant` (with `report:read:all` scope) can use NL→SQL

**Data:**
- Read-only access to `vw_report_*` materialized/projected views
- No direct table access ever (enforced at PostgreSQL ROLE level: `aegis_apologistis` role with grants only on `vw_report_*`)

**Failure mode:** If generator unavailable, user falls back to canned reports + saved-query library. Core BI flows remain functional.

---

## 5. Autonomy Levels

| Level | Symbol | Behavior | Example |
|-------|--------|----------|---------|
| Auto | OK | Execute without human intervention | Conflict scan, deadline calc, OCR, email classification (high-conf), time inference draft |
| Draft+Approve | D+A | Generate draft; human approves | Document drafting, invoice creation, engagement letters, low-conf email classifications, time-entry promotion |
| Never Auto | NEVER | Never execute automatically | Conflict waiver, document submission to court, payment processing, ΑΠΕΔ signing, NL→SQL writes |

### Per-Agent Autonomy Matrix (v0.2)

| # | Agent | Create | Read | Suggest | Draft | Execute |
|---|-------|--------|------|---------|-------|---------|
| 1 | Research        | --   | Auto | Auto       | D+A         | --        |
| 2 | Drafting        | --   | Auto | Auto       | D+A         | NEVER     |
| 3 | Deadline        | Auto (calc) | Auto | Auto | D+A (extract)| --        |
| 4 | Billing         | --   | Auto | Auto       | D+A         | NEVER     |
| 5 | Conflict        | Auto (check) | Auto | Auto | --         | NEVER (waive) |
| 6 | Intake          | --   | Auto | Auto (score) | D+A       | --        |
| 7 | Summary         | --   | Auto | --         | Auto         | --        |
| 8 | OCR/Extract     | Auto | Auto | Auto       | --          | --        |
| **9** | **Email Classifier (Tachydromos)** | Auto (suggest) | Auto | Auto | D+A (low-conf) | NEVER (privilege override) |
| **10** | **Time Capture Inferrer (Chronografos)** | Auto (draft session) | Auto | Auto | D+A (promote) | NEVER (auto-bill) |
| **11** | **Report Generator (Apologistis)** | -- | Auto (sandbox views) | Auto | D+A (anomalous queries) | NEVER (writes) |

---

## 6. PII Handling Rules

### What Gets Anonymized

| Data Type | Method | Example |
|-----------|--------|---------|
| Person names | [PERSON_N] | "Νικόλαος Τζόρβας" → "[PERSON_1]" |
| Tax IDs (AFM) | [TAX_ID_N] | "123456789" → "[TAX_ID_1]" |
| Addresses | [ADDRESS_N] | "Ερμού 15, Αθήνα" → "[ADDRESS_1]" |
| Phone numbers | [PHONE_N] | "6912345678" → "[PHONE_1]" |
| IBANs | [IBAN_N] | "GR12..." → "[IBAN_1]" |
| ID numbers | [ID_N] | "ΑΒ123456" → "[ID_1]" |
| Email addresses | [EMAIL_N] | "info@example.gr" → "[EMAIL_1]" |
| Company names (identifiable) | [COMPANY_N] | |

### What Does NOT Get Anonymized

- Legal article references (AK 914)
- Court names
- Case type classifications
- Legal terminology
- Dates / amounts (unless clearly PII-tied)

### Anonymization Exceptions

For relationship reasoning (conflict check, email thread context), use **synthetic but coherent** placeholders:
- [PERSON_1] → "Alex Alpha"
- [PERSON_2] → "Beta Bravo"

This preserves entity relationships while removing real PII.

### v0.2-specific anonymization rules

- **Email Classifier (Tachydromos):** subject + body are anonymized BEFORE LLM. The replacement map is held in Redis (per-firm) for the duration of the request only and discarded after deanonymization.
- **Time Capture Inferrer (Chronografos):** window titles + URLs are anonymized; absolute file paths replaced with `[PATH_N]`; query strings stripped from URLs.
- **Report Generator (Apologistis):** the LLM never sees raw data rows. It only sees view schemas (column names + types + descriptions). The PII-anonymization layer is irrelevant for SQL generation but is applied to natural-language explanations of results.

---

## 7. Shared vs Per-Firm Corpus

### Shared Legal Corpus (Read-Only)

```
legal_corpus (Qdrant collection):
  - 24,136 laws
  - 236,497 articles
  - 538,000+ vectors
  - Access: ALL firm deployments, read-only
  - Update: centrally managed weekly batch
  - Embedding model: consistent across all vectors

case_law (Qdrant collection):
  - Growing jurisprudence database
  - Access: ALL firm deployments, read-only
```

### Per-Firm Private Collections (v0.2 naming)

```
{firmslug}_documents (Qdrant collection):
  - Firm's own uploaded documents (post-OCR)
  - Access: only this firm's Aegis instance
  - Isolation: collection-level (no `tenant_id` field; collection name = isolation)
  - Embedding: same model as shared corpus
```

> v0.1 used `tenant_{tenant_id}_documents`. v0.2 uses `{firmslug}_documents`. There is no `tenant_id` because each Aegis deployment is firm-specific.

### Search Flow

```
User query: "Ποιες είναι οι προϋποθέσεις αδικοπρακτικής ευθύνης;"

1. Aegis receives query
2. Anonymize (this query has no PII)
3. Generate embedding for query
4. Parallel search:
   a. Qdrant legal_corpus: top 10 (laws/articles)
   b. Qdrant case_law: top 5 (jurisprudence)
   c. Qdrant {firmslug}_documents: top 5 (firm precedents)
   d. PostgreSQL FTS: exact phrase matches
5. Reciprocal Rank Fusion
6. Send top 15 results as context to Claude
7. Claude generates answer with citations
8. Return answer + sources
```

---

## 8. Cost Management

### LLM Cost Estimation (per firm/month, ~30 users) — v0.2 revised

| Operation | Model | Calls/mo | Avg tokens/call | Cost (USD) |
|-----------|-------|----------|-----------------|------------|
| Document summaries | Sonnet | 200 | 5K + 1K | ~$15 |
| Document Q&A | Sonnet | 100 | 10K + 2K | ~$20 |
| Legal research | Sonnet | 300 | 8K + 2K | ~$40 |
| Document drafting | Opus | 50 | 10K + 5K | ~$50 |
| Matter summaries | Sonnet | 150 | 5K + 0.5K | ~$8 |
| Time descriptions | Haiku | 500 | 0.5K + 0.2K | ~$2 |
| Billing drafts | Haiku | 30 | 3K + 1K | ~$1 |
| OCR extraction | Haiku | 200 | 2K + 0.5K | ~$2 |
| Conflict matching | Haiku | 100 | 1K + 0.5K | ~$0.5 |
| **NEW Email classify** | Haiku | 2,500 | 1.5K + 0.3K | ~$8 |
| **NEW Time infer** | Haiku | 800 | 1K + 0.4K | ~$3 |
| **NEW NL→SQL** | Sonnet | 80 | 4K + 1K | ~$6 |
| **Total v0.2** |   | **~5,010** |   | **~$155/month** |

At €100–120/user/month (v0.2 pricing), AI costs ~$5.16/user/month = ~3.5–5% of revenue. Within budget.

### Cost Controls

- Redis caching for repeated queries (24h TTL)
- Model selection: Haiku for high-volume / simple, Sonnet for reasoning, Opus for complex drafting only
- Token budget per request (hard limit)
- Monthly usage alerts (80%, 100%, 120% of estimate)
- Rate limiting on AI endpoints
- Email classifier is the highest-volume new flow — caching keyed on `(message_id, classifier_version)` prevents reclassification thrash
- NL→SQL: cached for 1 hour on `(question, schema_version)` tuple

---

## 9. Observability

### Metrics

- Latency per agent per operation (p50, p95)
- Token usage per agent per firm
- LLM cost per firm per month
- Cache hit rate
- PII anonymization coverage (% detected)
- Error rate per agent
- User satisfaction (thumbs up/down on AI results)
- **NEW v0.2:** Email classification confidence histogram (per agent)
- **NEW v0.2:** Time-capture inference acceptance rate (% of drafts promoted to time_entry)
- **NEW v0.2:** NL→SQL safety-gate rejection rate

### Logging

All AI interactions logged to `ai_interaction_log` table (per-firm DB; **no `tenant_id` column** — Invariant #6):

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | NULL if system-triggered |
| agent | VARCHAR(50) | "research", "drafting", "tachydromos", ... |
| operation | VARCHAR(100) | "summarize", "classify_email", ... |
| input_tokens | INTEGER | |
| output_tokens | INTEGER | |
| model | VARCHAR(50) | "claude-haiku-4", ... |
| prompt_version | VARCHAR(20) | e.g. "v1.0", "v0.2" |
| latency_ms | INTEGER | |
| cache_hit | BOOLEAN | |
| cost_usd | DECIMAL(8,4) | |
| confidence | DECIMAL(3,2) | NULL where N/A |
| safety_gate_outcome | VARCHAR(20) | NULL except for Apologistis |
| rating | SMALLINT | User rating (1–5), nullable |
| created_at | TIMESTAMPTZ | |

---

## 10. Error Handling

| Error | Handling |
|-------|----------|
| LLM timeout (>30s) | Retry once; then "AI unavailable, try again" |
| LLM rate limit | Queue and retry with backoff |
| PII detection failure | Fail-open with warning log (never block user, alert) |
| Qdrant unavailable | Degrade gracefully (search unavailable, business ops continue) |
| Hallucination | N/A at runtime; mitigated by human-in-the-loop for actionable AI |
| Invalid response format | Retry with stricter prompt; fall back to raw text |
| Email classifier 5xx | Drop email into "Unclassified" inbox; user files manually |
| Time inferrer 5xx | Sessions remain `pending`; user logs time manually |
| NL→SQL safety gate fail | Show user the rejected query + reason; ask to refine |

**Critical principle (Invariant #5):** AI failure must NEVER block core operations. The system must function fully without Aegis (just without AI enhancements). Each new v0.2 agent is degraded-mode-safe by design — see "Failure mode" notes per agent.

---

## 11. Migration notes (v0.1 → v0.2)

- Existing `tenant_{tenant_id}_documents` Qdrant collections — none exist yet (greenfield project). New deployments use `{firmslug}_documents` directly.
- `ai_interaction_log` schema migration: drop `tenant_id` column (was unused — collected for analytics, but per-firm DB makes it redundant).
- Three new prompt template directories under `/aegis/prompts/`: `email/`, `time_capture/`, `reports/`.
- New roles in PostgreSQL per firm: `aegis_apologistis` (read-only on `vw_report_*` only).

---

*v0.2 lock 2026-04-28. Next review: post-Sprint 13 (auto time capture deploy) and post-Sprint 17 (email auto-filing pilot).*
