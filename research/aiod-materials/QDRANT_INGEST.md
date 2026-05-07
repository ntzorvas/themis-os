# AIoD Program Docs — Qdrant Ingest Manifest

**Date:** 2026-04-29  
**Operator:** Κτησίβιος (PC Compute Node Manager)

## Collection

| Parameter | Value |
|-----------|-------|
| Collection name | `aiod_program_docs` |
| Endpoint | `http://10.0.0.10:6333` (PC, WireGuard) |
| Status | GREEN (optimizer: ok) |
| Points count | **174** |
| Indexed vectors | 174 |

## Vector Config

| Parameter | Value |
|-----------|-------|
| Dense model | `intfloat/multilingual-e5-base` (same as legal stack) |
| Dense dimensions | 768 |
| Distance | Cosine |
| Sparse | BM25 (Qdrant/bm25, IDF modifier) |
| HNSW m | 16 |
| HNSW ef_construct | 100 |

## Payload Schema

| Field | Type | Description |
|-------|------|-------------|
| `file_path` | keyword | Relative path from source dir |
| `file_name` | keyword | Filename only |
| `category` | keyword (indexed) | Category code (01-call/02-sga/...) |
| `chunk_idx` | integer (indexed) | Chunk index within file |
| `source_url` | keyword | URL (empty for local files) |
| `ingested_at` | keyword | ISO timestamp |
| `collection` | keyword | `aiod_program_docs` |
| `added_by` | keyword | `ingest-aiod-qdrant` |

## Source Files

| File | Category | Chunks |
|------|----------|--------|
| aiodp.ai_open-call-1-overview_2026-04-29.md | 01-call | 2 |
| AIOD OC1 - Annex 3.1_Declaration of Honour_Stage1&2_FINAL.txt | 02-sga | 5 |
| AIOD OC1 - Annex 3.2_Declaration of Honour_Consortium_Stage3_FINAL.txt | 02-sga | 4 |
| AIOD OC1 - Annex 4_Bank Information_FINAL.txt | 02-sga | 1 |
| AIOD OC1 - Annex 5_SME Declaration_FINAL.txt | 02-sga | 12 |
| AIOD OC1 - SubGrant Agreement Template_Stage1&2_FINAL.txt | 02-sga | 20 |
| AIOD OC1 - SubGrant Agreement Template_Stage3_FINAL.txt | 02-sga | 21 |
| aiodp.ai_guide-for-applicants_2026-04-29.txt | 03-guide | 35 |
| aiodp.ai_ownership-control-declaration_2026-04-29.txt | 03-guide | 31 |
| aiodp.ai_technical-business-proposal-template_2026-04-29.txt | 03-guide | 33 |
| aiodp.ai_evaluation-criteria-scoring_2026-04-29.md | 04-eval | 2 |
| aiod-platform-integration-requirements_2026-04-29.md | 05-tech | 2 |
| eu-regulations-reference_2026-04-29.md | 06-reg | 2 |
| deployai-project-context_2026-04-29.md | 07-context | 2 |
| previous-calls-context_2026-04-29.md | 07-context | 2 |

## Per-Category Breakdown

| Category | Chunks | % |
|----------|--------|---|
| 01-call | 2 | 1.1% |
| 02-sga | 63 | 36.2% |
| 03-guide | 99 | 56.9% |
| 04-eval | 2 | 1.1% |
| 05-tech | 2 | 1.1% |
| 06-reg | 2 | 1.1% |
| 07-context | 4 | 2.3% |
| **TOTAL** | **174** | 100% |

**Skipped files:** 0  
**DOCX ignored:** 3 (only .txt conversions used as specified)

## Chunking Config

| Parameter | Value |
|-----------|-------|
| Max chars | 2048 (≈512 tokens multilingual) |
| Overlap | 256 chars (≈64 tokens) |
| Min content | 30 chars |
| Strategy | Paragraph-aware, sentence-fallback |

## Ingest Performance

| Metric | Value |
|--------|-------|
| Elapsed | 11 seconds |
| Embed batch | 32 |
| Upsert batch | 100 |
| GPU used | AMD Radeon RX 9060 XT |

## Test Query Results

**Query:** "claw-back terms"

| Rank | Score | Category | File | Chunk |
|------|-------|----------|------|-------|
| 1 | 0.8004 | 03-guide | aiodp.ai_technical-business-proposal-template_2026-04-29.txt | 16 |
| 2 | 0.7997 | 03-guide | aiodp.ai_technical-business-proposal-template_2026-04-29.txt | 20 |
| 3 | 0.7997 | 03-guide | aiodp.ai_technical-business-proposal-template_2026-04-29.txt | 25 |

**Assessment:** Results correct — claw-back terms appear in the technical business proposal template (financial reporting section). Score ~0.80 is solid for a short 3-word query against multilingual model.

## Scripts

- Ingest script: `/root/projects/themis-os/scripts/ingest-aiod-qdrant.py` (Bridge)
- PC copy: `/home/sunday/ingest-aiod-qdrant.py`
- Source data on PC: `/home/sunday/aiod-materials/`

## Safety Notes

- Collection `aiod_program_docs` is isolated — no overlap with `legal_v2` or `mempalace_legal`
- Payload indexes on `category`, `file_name`, `chunk_idx` for filtered search
- Re-ingest safe: script is idempotent (recreates collection only if missing)
