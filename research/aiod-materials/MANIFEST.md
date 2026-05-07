# AIoD OC #1 Materials Manifest

**Date:** 2026-04-29
**Total files:** 24 (16 documents + ZIP + 6 text extracts + 1 manifest)
**Total size:** ~13MB
**Collector:** Ηρόδοτος (Deep Research Agent)

---

## Files by Category

### 01 Call Text
- `aiodp.ai_open-call-1-overview_2026-04-29.md` (source: https://www.aiodp.ai/open_calls/)
  - Complete call overview: dates, funding structure, 7 challenges, eligibility, application process, required documents, in-person events

### 02 SGA — Sub-Grant Agreement (EXTRACTED from official ZIP)
- `aiodp.ai_subgrant-agreement-annexes_2026-04-29.zip` (source: https://www.aiodp.ai/wp-content/uploads/opencalls/AIOD%20OC1%20-%20SubGrant%20Agreement%20Annexes.zip)
- **AIOD OC1 - SubGrant Agreement Template_Stage1&2_FINAL.pdf** — Primary SGA (Stage 1+2)
- **AIOD OC1 - SubGrant Agreement Template_Stage1&2_FINAL.txt** — Text extract (pdftotext)
- **AIOD OC1 - SubGrant Agreement Template_Stage3_FINAL.pdf** — SGA for Stage 3 consortium
- **AIOD OC1 - SubGrant Agreement Template_Stage3_FINAL.txt** — Text extract
- **AIOD OC1 - Annex 3.1_Declaration of Honour_Stage1&2_FINAL.pdf** + .txt
- **AIOD OC1 - Annex 3.2_Declaration of Honour_Consortium_Stage3_FINAL.pdf** + .txt
- **AIOD OC1 - Annex 4_Bank Information_FINAL.pdf** + .txt
- **AIOD OC1 - Annex 5_SME Declaration_FINAL.pdf** + .txt

### 03 Guides
- `aiodp.ai_guide-for-applicants_2026-04-29.pdf` (473KB) — Official Annex 1 (source: aiodp.ai)
- `aiodp.ai_guide-for-applicants_2026-04-29.txt` — Full text extract (1,593 lines)
- `aiodp.ai_technical-business-proposal-template_2026-04-29.docx` (3.8MB) — Annex 2 application template
- `aiodp.ai_ownership-control-declaration_2026-04-29.docx` (5.3MB) — Annex 6

### 04 Evaluation
- `aiodp.ai_evaluation-criteria-scoring_2026-04-29.md` — Compiled evaluation framework
  - 4 criteria (C1-C4), scoring thresholds (6/10 per criterion, 18/30 overall), 3 evaluation moments, tie-breaking rules, Stage 2+3 weights

### 05 Technical
- `aiod-platform-integration-requirements_2026-04-29.md` — Technical integration specs
  - TRL 7+, Docker mandatory, platform registration, Stage 2-3 deliverables

### 06 Regulations
- `eu-regulations-reference_2026-04-29.md` — Referenced EU regulations
  - Reg 2021/694 (DIGITAL), Reg 2023/2831 (de minimis), GDPR, AI Act, Financial Regulation

### 07 Context
- `deployai-project-context_2026-04-29.md` — Parent project DeployAI full context
- `previous-calls-context_2026-04-29.md` — Comparable programs, success rate estimates, Greek connection

---

## Key Numbers (Quick Reference)
| Parameter | Value |
|-----------|-------|
| Deadline | 8 June 2026, 17:00 CEST |
| Max funding (Provider) | €60,000 (lump sum) |
| Stage 1 selected | 50 |
| Stage 2 selected | 20 |
| Stage 3 selected | 10 consortia |
| TRL requirement | ≥ 7 |
| Containerization | Docker mandatory |
| Scoring minimum (per criterion) | 6/10 |
| Scoring minimum (total) | 18/30 |
| Records retention | 5 years post-project |
| Payment delay max | 30 calendar days |
| IPR | 100% Beneficiary |
| Subcontracting | NOT eligible |
| Treasurer (payment) | F6S Network Ireland Ltd |

---

## SGA Key Legal Terms (Quick Reference)
| Term | Provision |
|------|-----------|
| IPR | Results 100% Beneficiary's property |
| Confidentiality | 5 years from DeployAI end (Dec 2027) |
| Records keeping | 5 years after project termination |
| Double funding | Strictly prohibited |
| Liability cap | Limited to grant received |
| Claw-back triggers | Breach, KYC failure, double funding |
| Payments | Post-stage, 30 days after approval |
| KYC | Mandatory before any payment |
| Invoicing to | F6S Network Ireland Ltd, Dublin |

---

## Critical Gaps (Could Not Fully Retrieve)
1. **Application Form Sections (F6S portal)** — F6S returns 405 error; form sections not extractable. Must complete manually at https://www.f6s.com/aiod-oc1privatesector/apply
2. **Stage 3 SGA full text extract** — PDF extracted but not reviewed in detail (check .txt file)
3. **Previous AIoD OC1 success rates** — This is OC1 of DeployAI (first call), no prior data. AI4Europe predecessor results page shows "no results yet"
4. **Official FAQ document** — No separate FAQ PDF found; FAQ content embedded in aiodp.ai webpage (captured in call text overview)
5. **DOCX content (Annex 2 + Annex 6)** — Binary DOCXs saved locally (3.8MB + 5.3MB) but not readable as text. Must open with LibreOffice/Word for content
6. **Scoring rubric per-criterion detail** — Only thresholds known (6/10 min, 18/30 total); no point-by-point descriptors found publicly
7. **Ownership Control criteria (Art 12(6))** — Full definition in Annex 6 DOCX (not text-extracted)

---

## Next Steps

### Ingest to Qdrant
```bash
python /root/projects/themis-os/scripts/ingest-aiod-qdrant.py
```
Collection target: `aiod_program_docs`
Priority files for ingestion:
1. `03-guides/aiodp.ai_guide-for-applicants_2026-04-29.txt` (full text, 1,593 lines)
2. `02-sga/AIOD OC1 - SubGrant Agreement Template_Stage1&2_FINAL.txt`
3. `02-sga/AIOD OC1 - SubGrant Agreement Template_Stage3_FINAL.txt`
4. All `.md` files in 01/04/05/06/07 directories
5. Convert DOCXs: `soffice --headless --convert-to txt *.docx`

### Agent Reviews (post-ingest)
1. **Θέμης** — Legal review of SGA: claw-back, IPR, liability, GDPR, double funding
2. **grant-application-writer** — Strategic analysis: challenge alignment, competitive positioning, MECE/AROS eligibility
3. **Αθηνά** — HTML preview page for Niko with key facts

### DOCX Conversion
```bash
cd /root/projects/themis-os/research/aiod-materials/03-guides
soffice --headless --convert-to txt "aiodp.ai_technical-business-proposal-template_2026-04-29.docx"
soffice --headless --convert-to txt "aiodp.ai_ownership-control-declaration_2026-04-29.docx"
```

---

## Source URLs
- AIoD Open Calls: https://www.aiodp.ai/open_calls/
- Cascade Funding Hub: https://cascadefunding.eu/open-call/aiod-oc-1-private-sector/
- DeployAI Project: https://www.deployaiproject.eu/
- F6S Application: https://www.f6s.com/aiod-oc1privatesector/apply
- Guide for Applicants PDF: https://www.aiodp.ai/wp-content/uploads/opencalls/AIOD%20OC1%20-%20Annex%201_Guide%20For%20Applicants_FINAL.pdf
- Technical Proposal DOCX: https://www.aiodp.ai/wp-content/uploads/opencalls/AIOD%20OC1%20-%20Annex%202_Technical%20%26%20Business%20Proposal_FINAL.docx
- SGA Annexes ZIP: https://www.aiodp.ai/wp-content/uploads/opencalls/AIOD%20OC1%20-%20SubGrant%20Agreement%20Annexes.zip
- Ownership Declaration DOCX: https://www.aiodp.ai/wp-content/uploads/opencalls/AIOD%20OC1%20-%20Annex%206_Ownership%20Control%20Declaration_FINAL.docx
- EIT DeployAI news: https://www.eit.europa.eu/news-events/news/deployai-brings-ai-demand-platform-market
- De minimis Regulation: https://eur-lex.europa.eu/eli/reg/2023/2831/oj/eng
- DIGITAL Regulation: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32021R0694
