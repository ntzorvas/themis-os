#!/usr/bin/env python3
"""
ingest-aiod-qdrant.py — AIoD Program Materials → Qdrant
=========================================================
Runs on PC (sunday@10.0.0.10). Reads .txt and .md files from
the aiod-materials directory, chunks them, embeds with
intfloat/multilingual-e5-base (768d, same as legal stack),
and upserts to Qdrant collection 'aiod_program_docs'.

Usage:
  python3 ingest-aiod-qdrant.py
  python3 ingest-aiod-qdrant.py --dry-run       # chunk stats only, no upsert
  python3 ingest-aiod-qdrant.py --limit 50      # stop after N chunks (testing)

Collection config:
  - dense: multilingual-e5-base, 768d, Cosine
  - sparse: BM25 (same as legal_v2)
  - payload: file_path, file_name, category, chunk_idx, source_url, ingested_at
"""

import argparse
import os
import re
import sys
import time
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict

import numpy as np

# ── Config ────────────────────────────────────────────────────────────────────
SOURCE_DIR   = "/home/sunday/aiod-materials"
QDRANT_HOST  = os.environ.get("QDRANT_HOST", "10.0.0.10")
QDRANT_PORT  = int(os.environ.get("QDRANT_PORT", "6333"))
COLLECTION   = "aiod_program_docs"
DENSE_MODEL  = "intfloat/multilingual-e5-base"   # 768d — same as legal stack
SPARSE_MODEL = "Qdrant/bm25"

# Chunking (512 tokens ≈ 2048 chars for multilingual, 64 token overlap ≈ 256 chars)
MAX_CHUNK    = 2048
OVERLAP      = 256
MIN_CONTENT  = 30

EMBED_BATCH  = 32    # conservative — aiod is small, no need for large batches
UPSERT_BATCH = 100   # points per upsert call

# Category mapping: folder prefix → category tag
CATEGORY_MAP = {
    "01-call-text": "01-call",
    "02-sga":       "02-sga",
    "03-guides":    "03-guide",
    "04-evaluation":"04-eval",
    "05-technical": "05-tech",
    "06-regulations":"06-reg",
    "07-context":   "07-context",
}

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ingest-aiod")


# =============================================================================
# CHUNKING
# =============================================================================

def chunk_text(text: str, max_chars: int = MAX_CHUNK, overlap: int = OVERLAP) -> List[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    paragraphs = re.split(r'\n{2,}', text)
    chunks: List[str] = []
    current = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(para) > max_chars:
            sentences = re.split(r'(?<=[.;:\n])\s+', para)
            for sent in sentences:
                if len(current) + len(sent) + 1 > max_chars and current:
                    chunks.append(current.strip())
                    tail = current[-overlap:].strip() if overlap else ""
                    current = (tail + " " + sent).strip() if tail else sent
                else:
                    current = (current + " " + sent).strip() if current else sent
        else:
            if len(current) + len(para) + 2 > max_chars and current:
                chunks.append(current.strip())
                tail = current[-overlap:].strip() if overlap else ""
                current = (tail + "\n\n" + para).strip() if tail else para
            else:
                current = (current + "\n\n" + para).strip() if current else para

    if current.strip():
        chunks.append(current.strip())

    return chunks if chunks else [text[:max_chars]]


# =============================================================================
# FILE DISCOVERY
# =============================================================================

def get_category(file_path: Path, source_dir: Path) -> str:
    """Derive category from parent folder name."""
    try:
        rel = file_path.relative_to(source_dir)
        top_folder = rel.parts[0] if len(rel.parts) > 1 else ""
        return CATEGORY_MAP.get(top_folder, "00-other")
    except ValueError:
        return "00-other"


def discover_files(source_dir: Path) -> List[Path]:
    """Recursively find all .txt and .md files, excluding MANIFEST.md."""
    files = []
    for ext in ("*.txt", "*.md"):
        for p in sorted(source_dir.rglob(ext)):
            if p.name == "MANIFEST.md":
                continue
            files.append(p)
    return sorted(files)


# =============================================================================
# EMBEDDING ENGINE (reuses legal stack model)
# =============================================================================

class EmbeddingEngine:
    def __init__(self):
        self._dense  = None
        self._sparse = None

    def load(self):
        from sentence_transformers import SentenceTransformer
        from fastembed import SparseTextEmbedding

        log.info(f"Loading dense model: {DENSE_MODEL} ...")
        t0 = time.time()
        self._dense = SentenceTransformer(DENSE_MODEL)
        try:
            import torch
            if torch.cuda.is_available():
                self._dense = self._dense.to("cuda")
                log.info(f"  Dense on GPU ({torch.cuda.get_device_name(0)}) — {time.time()-t0:.1f}s")
            else:
                log.info(f"  Dense on CPU — {time.time()-t0:.1f}s")
        except Exception:
            log.info(f"  Dense loaded — {time.time()-t0:.1f}s")

        log.info(f"Loading sparse model: {SPARSE_MODEL} ...")
        t0 = time.time()
        self._sparse = SparseTextEmbedding(model_name=SPARSE_MODEL)
        log.info(f"  Sparse loaded — {time.time()-t0:.1f}s")

    def embed_dense(self, texts: List[str]) -> np.ndarray:
        prefixed = [f"passage: {t}" for t in texts]
        vecs = self._dense.encode(
            prefixed,
            batch_size=EMBED_BATCH,
            show_progress_bar=False,
            normalize_embeddings=True,
        )
        return np.array(vecs, dtype=np.float32)

    def embed_sparse(self, texts: List[str]):
        return list(self._sparse.embed(texts, batch_size=EMBED_BATCH))


# =============================================================================
# QDRANT SETUP
# =============================================================================

def ensure_collection(client):
    from qdrant_client.models import (
        Distance, VectorParams, SparseVectorParams, SparseIndexParams,
        HnswConfigDiff, OptimizersConfigDiff
    )

    existing = [c.name for c in client.get_collections().collections]

    if COLLECTION in existing:
        log.info(f"Collection '{COLLECTION}' already exists — skipping creation.")
        info = client.get_collection(COLLECTION)
        log.info(f"  Points count: {info.points_count}")
        return

    log.info(f"Creating collection '{COLLECTION}' (768d Cosine + BM25 sparse) ...")
    client.create_collection(
        collection_name=COLLECTION,
        vectors_config={"dense": VectorParams(size=768, distance=Distance.COSINE)},
        sparse_vectors_config={
            "bm25": SparseVectorParams(
                index=SparseIndexParams(on_disk=False),
                modifier="idf",
            )
        },
        hnsw_config=HnswConfigDiff(m=16, ef_construct=100),
        optimizers_config=OptimizersConfigDiff(indexing_threshold=20000),
        on_disk_payload=True,
    )

    # Payload indexes for filtering
    from qdrant_client.models import PayloadSchemaType
    for field, ftype in [
        ("category",   PayloadSchemaType.KEYWORD),
        ("file_name",  PayloadSchemaType.KEYWORD),
        ("chunk_idx",  PayloadSchemaType.INTEGER),
    ]:
        client.create_payload_index(COLLECTION, field, ftype)

    log.info(f"  Collection '{COLLECTION}' created.")


def upsert_batch(client, points_batch: list):
    from qdrant_client.models import PointStruct, SparseVector, NamedSparseVector, NamedVector

    qdrant_points = []
    for pt in points_batch:
        qdrant_points.append(PointStruct(
            id=pt["id"],
            vector={
                "dense": pt["dense"].tolist(),
                "bm25": SparseVector(
                    indices=pt["sparse_indices"],
                    values=pt["sparse_values"],
                ),
            },
            payload=pt["payload"],
        ))

    client.upsert(collection_name=COLLECTION, points=qdrant_points)


# =============================================================================
# MAIN INGEST
# =============================================================================

def run(args):
    source_dir = Path(SOURCE_DIR)
    if not source_dir.exists():
        log.error(f"Source directory not found: {source_dir}")
        sys.exit(1)

    files = discover_files(source_dir)
    log.info(f"Discovered {len(files)} files in {source_dir}")
    for f in files:
        log.info(f"  {f.relative_to(source_dir)}")

    # ── Build chunk list ──────────────────────────────────────────────────────
    now_iso = datetime.now(timezone.utc).isoformat()
    all_chunks = []      # [{text, payload}]
    per_category: Dict[str, int] = {}
    skipped = 0

    for fpath in files:
        try:
            raw = fpath.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            log.warning(f"  Cannot read {fpath}: {e}")
            skipped += 1
            continue

        if len(raw.strip()) < MIN_CONTENT:
            log.warning(f"  Too short, skipping: {fpath.name}")
            skipped += 1
            continue

        category = get_category(fpath, source_dir)
        rel_path = str(fpath.relative_to(source_dir))
        chunks = chunk_text(raw)

        for ci, chunk in enumerate(chunks):
            all_chunks.append({
                "text": f"[AIoD {category} | {fpath.name}]\n{chunk}",
                "payload": {
                    "file_path":   rel_path,
                    "file_name":   fpath.name,
                    "category":    category,
                    "chunk_idx":   ci,
                    "source_url":  "",
                    "ingested_at": now_iso,
                    # extra context fields
                    "collection":  COLLECTION,
                    "added_by":    "ingest-aiod-qdrant",
                },
            })
            per_category[category] = per_category.get(category, 0) + 1

        log.info(f"  {fpath.name}: {len(chunks)} chunks (cat={category})")

    total_chunks = len(all_chunks)
    log.info(f"\nTotal chunks: {total_chunks} | Skipped files: {skipped}")
    log.info("Per-category breakdown:")
    for cat, cnt in sorted(per_category.items()):
        log.info(f"  {cat}: {cnt} chunks")

    if args.dry_run:
        log.info("DRY-RUN mode — stopping before embed/upsert.")
        return {"total_chunks": total_chunks, "per_category": per_category, "skipped": skipped}

    if args.limit:
        all_chunks = all_chunks[:args.limit]
        log.info(f"LIMIT mode: using first {len(all_chunks)} chunks")

    # ── Load models ───────────────────────────────────────────────────────────
    engine = EmbeddingEngine()
    engine.load()

    # ── Connect to Qdrant ─────────────────────────────────────────────────────
    from qdrant_client import QdrantClient
    log.info(f"Connecting to Qdrant at {QDRANT_HOST}:{QDRANT_PORT} ...")
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT, timeout=60)
    ensure_collection(client)

    # ── Embed + Upsert ────────────────────────────────────────────────────────
    t_start = time.time()
    total_upserted = 0
    points_buffer = []
    texts = [c["text"] for c in all_chunks]

    log.info(f"Embedding {len(texts)} chunks ...")
    all_dense  = []
    all_sparse = []

    for i in range(0, len(texts), EMBED_BATCH):
        sub = texts[i: i + EMBED_BATCH]
        all_dense.append(engine.embed_dense(sub))
        all_sparse.extend(engine.embed_sparse(sub))
        if (i // EMBED_BATCH + 1) % 10 == 0:
            log.info(f"  Embedded {min(i + EMBED_BATCH, len(texts))}/{len(texts)} chunks")

    dense_arr = np.concatenate(all_dense, axis=0)
    log.info(f"Embedding done — shape: {dense_arr.shape}")

    # Build points and upsert in batches
    for i, chunk in enumerate(all_chunks):
        pt_id = str(uuid.uuid4())
        points_buffer.append({
            "id":             pt_id,
            "dense":          dense_arr[i],
            "sparse_indices": all_sparse[i].indices.tolist(),
            "sparse_values":  all_sparse[i].values.tolist(),
            "payload":        chunk["payload"],
        })

        if len(points_buffer) >= UPSERT_BATCH:
            upsert_batch(client, points_buffer)
            total_upserted += len(points_buffer)
            log.info(f"  Upserted {total_upserted}/{len(all_chunks)} points")
            points_buffer = []

    # Flush remainder
    if points_buffer:
        upsert_batch(client, points_buffer)
        total_upserted += len(points_buffer)
        log.info(f"  Upserted {total_upserted}/{len(all_chunks)} points (final batch)")

    elapsed = time.time() - t_start
    log.info(f"\n=== DONE in {elapsed:.0f}s ({elapsed/60:.1f} min) ===")
    log.info(f"Total upserted: {total_upserted} points into '{COLLECTION}'")

    # Verify
    info = client.get_collection(COLLECTION)
    log.info(f"Collection '{COLLECTION}' points_count: {info.points_count}")

    return {
        "total_chunks":  total_upserted,
        "per_category":  per_category,
        "skipped":       skipped,
        "elapsed_sec":   round(elapsed, 1),
        "points_count":  info.points_count,
    }


# =============================================================================
# TEST QUERY
# =============================================================================

def test_query(query_text: str = "claw-back terms"):
    from qdrant_client import QdrantClient
    from sentence_transformers import SentenceTransformer

    log.info(f"\n=== TEST QUERY: '{query_text}' ===")
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT, timeout=60)

    model = SentenceTransformer(DENSE_MODEL)
    vec = model.encode(f"query: {query_text}", normalize_embeddings=True).tolist()

    results = client.search(
        collection_name=COLLECTION,
        query_vector=("dense", vec),
        limit=3,
        with_payload=True,
    )

    log.info(f"Top {len(results)} results:")
    for i, r in enumerate(results):
        p = r.payload
        log.info(f"  [{i+1}] score={r.score:.4f} | cat={p.get('category')} | "
                 f"file={p.get('file_name')} | chunk={p.get('chunk_idx')}")

    return results


# =============================================================================
# CLI
# =============================================================================

def parse_args():
    p = argparse.ArgumentParser(description="Ingest AIoD materials into Qdrant")
    p.add_argument("--dry-run",   action="store_true", help="Chunk stats only, no embed/upsert")
    p.add_argument("--limit",     type=int, default=0,  help="Stop after N chunks (0=all)")
    p.add_argument("--test-query",action="store_true", help="Run test query after ingest")
    p.add_argument("--query-only",action="store_true", help="Only run test query (skip ingest)")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()

    if args.query_only:
        test_query("claw-back terms")
        sys.exit(0)

    result = run(args)

    if args.test_query and not args.dry_run:
        test_query("claw-back terms")

    if result:
        log.info("\n=== SUMMARY ===")
        log.info(f"  Collection:     {COLLECTION}")
        log.info(f"  Total chunks:   {result['total_chunks']}")
        log.info(f"  Skipped files:  {result['skipped']}")
        if not args.dry_run:
            log.info(f"  Elapsed:        {result.get('elapsed_sec','?')}s")
            log.info(f"  Points in col:  {result.get('points_count','?')}")
        log.info("  Per category:")
        for cat, cnt in sorted(result["per_category"].items()):
            log.info(f"    {cat}: {cnt}")
